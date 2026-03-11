const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const CryptoJS = require('crypto-js');

router.use(authenticate, authorize('ADMIN', 'RH', 'MANAGER'));

// ══════════════════════════════════════════════════════════════
// AUTO-MIGRATION — Tables insertion_diagnostics + milestones + action_plans
// ══════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS insertion_diagnostics (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        parcours_anterieur TEXT,
        contraintes_sante TEXT, contraintes_mobilite TEXT, contraintes_familiales TEXT, autres_contraintes TEXT,
        frein_mobilite INTEGER DEFAULT 1, frein_mobilite_detail TEXT,
        frein_sante INTEGER DEFAULT 1, frein_sante_detail TEXT,
        frein_finances INTEGER DEFAULT 1, frein_finances_detail TEXT,
        frein_famille INTEGER DEFAULT 1, frein_famille_detail TEXT,
        frein_linguistique INTEGER DEFAULT 1, frein_linguistique_detail TEXT,
        frein_administratif INTEGER DEFAULT 1, frein_administratif_detail TEXT,
        frein_numerique INTEGER DEFAULT 1, frein_numerique_detail TEXT,
        -- Sous-questions freins indirectes (scenarios)
        frein_mobilite_causes TEXT, frein_sante_causes TEXT, frein_finances_causes TEXT,
        frein_famille_causes TEXT, frein_linguistique_causes TEXT, frein_administratif_causes TEXT,
        frein_numerique_causes TEXT,
        obs_taches_realisees TEXT, obs_points_forts TEXT, obs_difficultes TEXT,
        obs_comportement_equipe TEXT, obs_autonomie_ponctualite TEXT,
        pref_aime_faire TEXT, pref_ne_veut_plus TEXT, pref_environnement_prefere TEXT,
        pref_environnement_eviter TEXT, pref_objectifs TEXT,
        explorama_interets TEXT, explorama_rejets TEXT,
        explorama_gestes_positifs TEXT, explorama_gestes_negatifs TEXT,
        explorama_environnements TEXT, explorama_rythme TEXT,
        cip_hypotheses_metiers TEXT, cip_questions TEXT,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id)
      )
    `);
    const addCol = async (col, type) => {
      try { await pool.query(`ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch {}
    };
    await addCol('frein_mobilite_causes', 'TEXT');
    await addCol('frein_sante_causes', 'TEXT');
    await addCol('frein_finances_causes', 'TEXT');
    await addCol('frein_famille_causes', 'TEXT');
    await addCol('frein_linguistique_causes', 'TEXT');
    await addCol('frein_administratif_causes', 'TEXT');
    await addCol('frein_numerique_causes', 'TEXT');
    await addCol('explorama_gestes_positifs', 'TEXT');
    await addCol('explorama_gestes_negatifs', 'TEXT');
    await addCol('explorama_environnements', 'TEXT');
    await addCol('explorama_rythme', 'TEXT');

    // Colonnes insertion sur employees (si init-db pas encore re-execute)
    try {
      await pool.query(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_status VARCHAR(30) DEFAULT 'none';
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_start_date DATE;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_end_date DATE;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS prescripteur VARCHAR(100);
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS visite_medicale_date DATE;
      `);
    } catch {}
    // Ajouter CHECK constraint sur insertion_status si absente
    try {
      await pool.query(`ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_insertion_status_check`);
      await pool.query(`ALTER TABLE employees ADD CONSTRAINT employees_insertion_status_check CHECK (insertion_status IN ('none', 'en_parcours', 'termine', 'abandon'))`);
    } catch {}

    // Creer table milestones si elle n'existe pas encore
    await pool.query(`
      CREATE TABLE IF NOT EXISTS insertion_milestones (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        milestone_type VARCHAR(30) NOT NULL CHECK (milestone_type IN ('Diagnostic accueil', 'Bilan M+3', 'Bilan M+6', 'Bilan M+10', 'Bilan Sortie')),
        due_date DATE NOT NULL,
        completed_date DATE,
        status VARCHAR(30) NOT NULL DEFAULT 'a_planifier'
          CHECK (status IN ('a_planifier', 'planifie', 'realise', 'reporte')),
        interview_date TIMESTAMP,
        interviewer_id INTEGER REFERENCES users(id),
        frein_mobilite INTEGER CHECK (frein_mobilite BETWEEN 1 AND 5),
        frein_sante INTEGER CHECK (frein_sante BETWEEN 1 AND 5),
        frein_finances INTEGER CHECK (frein_finances BETWEEN 1 AND 5),
        frein_famille INTEGER CHECK (frein_famille BETWEEN 1 AND 5),
        frein_linguistique INTEGER CHECK (frein_linguistique BETWEEN 1 AND 5),
        frein_administratif INTEGER CHECK (frein_administratif BETWEEN 1 AND 5),
        frein_numerique INTEGER CHECK (frein_numerique BETWEEN 1 AND 5),
        cip_integration TEXT,
        cip_competences TEXT,
        cip_projet_pro TEXT,
        cip_socialisation TEXT,
        bilan_professionnel TEXT,
        bilan_social TEXT,
        objectifs_realises TEXT,
        objectifs_prochaine_periode TEXT,
        observations TEXT,
        actions_a_mener TEXT,
        avis_global VARCHAR(30) CHECK (avis_global IN ('tres_positif', 'positif', 'mitige', 'insuffisant')),
        sortie_classification VARCHAR(20) CHECK (sortie_classification IN ('positive', 'negative')),
        sortie_type VARCHAR(50),
        sortie_commentaires TEXT,
        sortie_employeur TEXT,
        sortie_formation TEXT,
        ai_recommendations JSONB,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, milestone_type)
      )
    `);

    // Migration milestones : ajouter nouvelles colonnes si table existait deja
    const addMsCol = async (col, type) => {
      try { await pool.query(`ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch {}
    };
    await addMsCol('frein_numerique', 'INTEGER CHECK (frein_numerique BETWEEN 1 AND 5)');
    await addMsCol('cip_integration', 'TEXT');
    await addMsCol('cip_competences', 'TEXT');
    await addMsCol('cip_projet_pro', 'TEXT');
    await addMsCol('cip_socialisation', 'TEXT');
    await addMsCol('sortie_classification', "VARCHAR(20) CHECK (sortie_classification IN ('positive', 'negative'))");
    await addMsCol('sortie_type', 'VARCHAR(50)');
    await addMsCol('sortie_commentaires', 'TEXT');
    await addMsCol('sortie_employeur', 'TEXT');
    await addMsCol('sortie_formation', 'TEXT');
    await addMsCol('ai_recommendations', 'JSONB');

    // Ajuster le CHECK constraint pour les nouveaux types de milestone
    try {
      await pool.query(`ALTER TABLE insertion_milestones DROP CONSTRAINT IF EXISTS insertion_milestones_milestone_type_check`);
      await pool.query(`ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_milestone_type_check CHECK (milestone_type IN ('Diagnostic accueil', 'Bilan M+3', 'Bilan M+6', 'Bilan M+10', 'Bilan Sortie', 'Bilan M+2'))`);
    } catch {}

    // Table action plans CIP
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cip_action_plans (
          id SERIAL PRIMARY KEY,
          milestone_id INTEGER NOT NULL REFERENCES insertion_milestones(id) ON DELETE CASCADE,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          action_label TEXT NOT NULL,
          category VARCHAR(30) NOT NULL CHECK (category IN ('competence', 'insertion', 'socialisation', 'frein')),
          frein_type VARCHAR(30),
          priority VARCHAR(20) DEFAULT 'moyenne' CHECK (priority IN ('haute', 'moyenne', 'basse')),
          status VARCHAR(20) DEFAULT 'a_faire' CHECK (status IN ('a_faire', 'en_cours', 'realise', 'abandonne')),
          echeance DATE,
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
    } catch {}

    // Table alertes entretiens insertion
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS insertion_interview_alerts (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          milestone_type VARCHAR(30) NOT NULL,
          alert_type VARCHAR(30) NOT NULL CHECK (alert_type IN ('planification', 'rappel_j7', 'rappel_j1', 'retard')),
          sent_at TIMESTAMP,
          is_sent BOOLEAN DEFAULT false,
          target_date DATE NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
    } catch {}

    console.log('[INSERTION] Tables insertion OK');
  } catch (err) {
    console.error('[INSERTION] Migration insertion :', err.message);
  }
})();

// ══════════════════════════════════════════════════════════════
// BASE DE CONNAISSANCES — PCM / Postes / Métiers
// ══════════════════════════════════════════════════════════════

const PCM_KNOWLEDGE = {
  analyseur: {
    nom: 'Analyseur',
    niveau_label: 'Logique, organisé, méthodique',
    forces: ['Logique', 'Organisé', 'Responsable', 'Méthodique'],
    faiblesses_stress: ['Sur-détaille', 'Ne délègue pas', 'Sur-contrôle'],
    besoin: 'Reconnaissance du travail bien fait',
    canal: 'Interrogatif / Informatif',
    facteurs_motivation: ['Structure claire', 'Feedback sur la qualité', 'Comprendre le pourquoi'],
    environnement_ideal: 'Structuré, avec des procédures claires et un feedback régulier sur la qualité',
    risques_insertion: 'Peut se sentir submergé si les consignes sont floues.',
    conseils_manager: [
      'Donner des instructions précises et documentées',
      'Reconnaître la qualité et la rigueur de son travail',
      'Lui confier des tâches nécessitant de l\'attention au détail',
      'Éviter l\'improvisation et les changements de dernière minute',
    ],
    axes_developpement: [
      'Apprendre à déléguer et faire confiance aux collègues',
      'Développer la tolérance à l\'imperfection',
      'Travailler la flexibilité face aux imprévus',
    ],
    compatibilites: { empathique: 'haute', perseverant: 'haute', imagineur: 'moyenne', energiseur: 'basse', promoteur: 'moyenne' },
    mots_cles_detection: ['logique', 'organisation', 'méthode', 'précis', 'structuré', 'plan', 'règle', 'procédure', 'données', 'analyse'],
  },
  perseverant: {
    nom: 'Persévérant',
    niveau_label: 'Engagé, consciencieux, observateur',
    forces: ['Engagé', 'Observateur', 'Consciencieux', 'Dévoué'],
    faiblesses_stress: ['Impose ses convictions', 'Méfiance', 'Rigidité'],
    besoin: 'Reconnaissance des opinions et de l\'engagement',
    canal: 'Interrogatif / Informatif',
    facteurs_motivation: ['Sens du travail', 'Valeurs respectées', 'Engagement reconnu'],
    environnement_ideal: 'Où ses valeurs sont respectées et son engagement reconnu',
    risques_insertion: 'Peut entrer en conflit si ses valeurs sont heurtées.',
    conseils_manager: [
      'Lui demander son avis et respecter ses opinions',
      'Valoriser son engagement et sa fiabilité',
      'Lui expliquer le sens et l\'utilité de chaque mission',
      'Éviter de prendre des décisions sans le consulter',
    ],
    axes_developpement: [
      'Développer la tolérance aux opinions différentes',
      'Apprendre à lâcher prise sur ce qui ne dépend pas de soi',
      'Travailler l\'ouverture au changement',
    ],
    compatibilites: { analyseur: 'haute', empathique: 'moyenne', imagineur: 'moyenne', energiseur: 'basse', promoteur: 'basse' },
    mots_cles_detection: ['conviction', 'valeur', 'opinion', 'engagement', 'respect', 'sens', 'utile', 'devoir', 'croyance', 'fidèle'],
  },
  empathique: {
    nom: 'Empathique',
    niveau_label: 'Chaleureux, sensible, attentionné',
    forces: ['Chaleureux', 'Sensible', 'Compatissant', 'Attentionné'],
    faiblesses_stress: ['Sur-adaptation', 'Se sacrifie', 'Fait des erreurs par vouloir plaire'],
    besoin: 'Reconnaissance de la personne, ambiance chaleureuse',
    canal: 'Nourricier',
    facteurs_motivation: ['Ambiance chaleureuse', 'Relations harmonieuses', 'Se sentir apprécié'],
    environnement_ideal: 'Équipe soudée, ambiance bienveillante, contact humain',
    risques_insertion: 'Peut se sur-adapter et ne pas exprimer ses difficultés.',
    conseils_manager: [
      'Créer un climat chaleureux et accueillant',
      'Lui dire régulièrement qu\'on l\'apprécie en tant que personne',
      'Être attentif aux signes de fatigue ou de mal-être',
      'L\'encourager à exprimer ses besoins et limites',
    ],
    axes_developpement: [
      'Apprendre à poser des limites sans culpabiliser',
      'Développer l\'assertivité et la confiance en soi',
      'Ne pas confondre efficacité et sacrifice personnel',
    ],
    compatibilites: { analyseur: 'haute', perseverant: 'moyenne', imagineur: 'haute', energiseur: 'moyenne', promoteur: 'basse' },
    mots_cles_detection: ['ambiance', 'équipe', 'relation', 'chaleur', 'écoute', 'harmonie', 'aide', 'plaire', 'gentil', 'sensible'],
  },
  imagineur: {
    nom: 'Imagineur',
    niveau_label: 'Calme, réfléchi, introspectif',
    forces: ['Imaginatif', 'Réfléchi', 'Calme', 'Introspectif'],
    faiblesses_stress: ['Retrait', 'Passivité', 'Attend les consignes'],
    besoin: 'Solitude, temps calme pour réfléchir',
    canal: 'Directif',
    facteurs_motivation: ['Calme', 'Routine apaisante', 'Pas de pression sociale'],
    environnement_ideal: 'Poste individuel, tâches bien définies, rythme régulier',
    risques_insertion: 'Peut se replier et ne rien demander.',
    conseils_manager: [
      'Donner des consignes claires et directes (pas de sous-entendus)',
      'Respecter son besoin de calme et ne pas le forcer à socialiser',
      'Lui laisser du temps pour s\'adapter aux nouvelles tâches',
      'Vérifier régulièrement sa compréhension sans le mettre en difficulté',
    ],
    axes_developpement: [
      'Développer la prise d\'initiative progressive',
      'Oser demander de l\'aide quand c\'est nécessaire',
      'S\'intégrer progressivement dans les moments collectifs',
    ],
    compatibilites: { empathique: 'haute', analyseur: 'moyenne', perseverant: 'moyenne', energiseur: 'basse', promoteur: 'basse' },
    mots_cles_detection: ['calme', 'seul', 'réfléchir', 'tranquille', 'imagination', 'intérieur', 'rêver', 'paisible', 'silence', 'retrait'],
  },
  energiseur: {
    nom: 'Énergiseur',
    niveau_label: 'Créatif, spontané, dynamique',
    forces: ['Créatif', 'Spontané', 'Ludique', 'Dynamique'],
    faiblesses_stress: ['Blâme les autres', 'Provoque', 'Rejette la faute'],
    besoin: 'Contact ludique, stimulation, variété',
    canal: 'Ludique / Émotif',
    facteurs_motivation: ['Variété', 'Bonne humeur', 'Stimulation', 'Mouvement'],
    environnement_ideal: 'Varié, dynamique, avec de l\'interaction et de la bonne humeur',
    risques_insertion: 'S\'ennuie vite dans la routine. Peut provoquer si non stimulé.',
    conseils_manager: [
      'Varier les tâches et les missions',
      'Utiliser l\'humour pour motiver et recadrer',
      'Éviter la monotonie et les tâches trop répétitives',
      'Lui confier des responsabilités stimulantes',
    ],
    axes_developpement: [
      'Développer la constance et la persévérance dans les tâches',
      'Apprendre à gérer la frustration sans rejeter la faute',
      'Canaliser l\'énergie de façon constructive',
    ],
    compatibilites: { promoteur: 'haute', empathique: 'moyenne', analyseur: 'basse', perseverant: 'basse', imagineur: 'basse' },
    mots_cles_detection: ['amusement', 'humour', 'variété', 'bouger', 'créatif', 'spontané', 'dynamique', 'énergie', 'stimulation', 'rire'],
  },
  promoteur: {
    nom: 'Promoteur',
    niveau_label: 'Adaptable, débrouillard, orienté résultats',
    forces: ['Adaptable', 'Charmeur', 'Débrouillard', 'Efficace'],
    faiblesses_stress: ['Manipulation', 'Prise de risques', 'Exploite les faiblesses'],
    besoin: 'Excitation, défis, résultats rapides',
    canal: 'Directif',
    facteurs_motivation: ['Défis concrets', 'Autonomie', 'Résultats visibles'],
    environnement_ideal: 'Autonome, orienté résultats, avec des défis concrets',
    risques_insertion: 'Peut manipuler ou prendre des raccourcis.',
    conseils_manager: [
      'Fixer des objectifs clairs avec des résultats mesurables',
      'Offrir de l\'autonomie dans un cadre défini',
      'Répondre aux tentatives de manipulation avec fermeté et calme',
      'Valoriser les résultats concrets et l\'efficacité',
    ],
    axes_developpement: [
      'Développer le respect des procédures et du collectif',
      'Apprendre la patience et la collaboration',
      'Construire des relations basées sur la confiance mutuelle',
    ],
    compatibilites: { energiseur: 'haute', analyseur: 'moyenne', perseverant: 'basse', empathique: 'basse', imagineur: 'basse' },
    mots_cles_detection: ['résultat', 'défi', 'action', 'efficace', 'autonome', 'concret', 'rapide', 'challenge', 'gagner', 'décider'],
  },
};

// Métiers cibles pour Solidarité Textile
const METIERS_CIBLES = {
  'Opérateur de tri': {
    famille: 'Textile / Recyclage',
    description: 'Tri des textiles par catégorie, travail en chaîne, attention au détail',
    profils_ideaux: ['analyseur', 'empathique', 'imagineur'],
    qualites_requises: ['Attention au détail', 'Rigueur', 'Régularité', 'Patience'],
    contraintes: ['Travail répétitif', 'Station debout', 'Rythme soutenu'],
    potentiel_evolution: 'Chef d\'équipe tri, Formateur, Référent qualité',
  },
  'Opérateur Logistique': {
    famille: 'Logistique',
    description: 'Gestion des flux entrants/sortants, manutention, organisation du stock',
    profils_ideaux: ['energiseur', 'promoteur', 'empathique'],
    qualites_requises: ['Organisation', 'Dynamisme', 'Force physique', 'Esprit d\'équipe'],
    contraintes: ['Port de charges', 'Travail physique', 'Gestion du stress'],
    potentiel_evolution: 'Responsable logistique, Chauffeur, Chef de quai',
  },
  'Chauffeur / Collecteur': {
    famille: 'Logistique / Collecte',
    description: 'Collecte des textiles en tournée, conduite de véhicule, relation avec les partenaires',
    profils_ideaux: ['promoteur', 'energiseur', 'perseverant'],
    qualites_requises: ['Autonomie', 'Sens de l\'orientation', 'Permis B', 'Ponctualité'],
    contraintes: ['Conduite longue durée', 'Autonomie totale', 'Horaires variables'],
    potentiel_evolution: 'Chauffeur PL, Responsable collecte, Coordinateur terrain',
  },
  'Vendeur en boutique solidaire': {
    famille: 'Vente / Seconde main',
    description: 'Accueil clients, vente, mise en rayon, caisse',
    profils_ideaux: ['empathique', 'energiseur'],
    qualites_requises: ['Relationnel', 'Présentation', 'Patience', 'Écoute'],
    contraintes: ['Contact public', 'Station debout', 'Gestion de caisse'],
    potentiel_evolution: 'Responsable de boutique, Gestionnaire de stock, Merchandiser',
  },
  'Couturier / Retoucheur': {
    famille: 'Textile / Revalorisation',
    description: 'Retouche, réparation et transformation de vêtements',
    profils_ideaux: ['analyseur', 'imagineur'],
    qualites_requises: ['Minutie', 'Créativité', 'Patience', 'Habileté manuelle'],
    contraintes: ['Travail de précision', 'Position assise prolongée'],
    potentiel_evolution: 'Couturier confirmé, Créateur upcycling, Formateur couture',
  },
  'Agent d\'entretien / Services': {
    famille: 'Services de proximité',
    description: 'Nettoyage, entretien des locaux, gestion du matériel',
    profils_ideaux: ['perseverant', 'imagineur', 'empathique'],
    qualites_requises: ['Autonomie', 'Rigueur', 'Discrétion', 'Sens du détail'],
    contraintes: ['Travail physique', 'Horaires décalés possibles'],
    potentiel_evolution: 'Chef d\'équipe entretien, Agent polyvalent, Responsable hygiène',
  },
  'Préparateur de commandes': {
    famille: 'Logistique',
    description: 'Préparation, emballage et expédition de commandes',
    profils_ideaux: ['analyseur', 'perseverant'],
    qualites_requises: ['Organisation', 'Rapidité', 'Précision', 'Résistance physique'],
    contraintes: ['Port de charges', 'Cadence soutenue', 'Travail en entrepôt'],
    potentiel_evolution: 'Chef de quai, Responsable préparation, Gestionnaire de stock',
  },
  'Agent administratif': {
    famille: 'Administration',
    description: 'Saisie, classement, accueil téléphonique, gestion de dossiers',
    profils_ideaux: ['analyseur', 'perseverant', 'empathique'],
    qualites_requises: ['Rigueur', 'Maîtrise informatique', 'Organisation', 'Communication'],
    contraintes: ['Travail sur écran', 'Maîtrise de l\'écrit', 'Multitâche'],
    potentiel_evolution: 'Secrétaire, Assistant de gestion, Gestionnaire RH',
  },
};

// ══════════════════════════════════════════════════════════════
// FREINS SOCIAUX — Grille de diagnostic et priorités
// ══════════════════════════════════════════════════════════════

const FREINS_DEFINITIONS = {
  mobilite: {
    label: 'Mobilite',
    icon: 'car',
    questions_indirectes: [
      { q: 'Racontez-moi comment se passe votre trajet pour venir ici le matin.', indicateurs: ['duree', 'mode_transport', 'fiabilite'] },
      { q: 'Si on vous proposait un poste a 30 minutes d\'ici, comment feriez-vous pour vous y rendre ?', indicateurs: ['autonomie', 'alternatives'] },
      { q: 'Est-ce qu\'il vous est deja arrive de ne pas pouvoir venir quelque part a cause du transport ?', indicateurs: ['frequence_blocage'] },
    ],
    niveaux: {
      1: 'Pas de difficulte, transport autonome',
      2: 'Leger, transports en commun accessibles',
      3: 'Modere, dependance a un tiers ou transports limites',
      4: 'Important, zone mal desservie ou pas de permis necessaire',
      5: 'Bloquant, aucun moyen de deplacement fiable',
    },
    actions_levee: [
      'Aide au passage du permis B (financement via plan d\'insertion)',
      'Information sur les transports en commun et itineraires',
      'Mise en relation avec des solutions de covoiturage',
      'Aide a l\'achat / location de velo ou trottinette',
      'Rapprochement du lieu de travail si possible',
    ],
  },
  sante: {
    label: 'Sante',
    icon: 'heart',
    questions_indirectes: [
      { q: 'Comment vous sentez-vous en general en ce moment ? Vous dormez bien ?', indicateurs: ['forme_generale', 'sommeil'] },
      { q: 'Si vous deviez porter des charges lourdes ou rester debout longtemps, comment ca se passerait ?', indicateurs: ['capacite_physique', 'limitations'] },
      { q: 'Avez-vous un medecin que vous voyez regulierement ?', indicateurs: ['suivi_medical', 'acces_soins'] },
    ],
    niveaux: {
      1: 'Bonne sante, pas de limitation',
      2: 'Leger, petits soucis gerables',
      3: 'Modere, suivi medical en cours',
      4: 'Important, limitations physiques ou psychologiques',
      5: 'Bloquant, incapacite partielle ou arrets frequents',
    },
    actions_levee: [
      'Orientation vers le medecin du travail',
      'Amenagement du poste (ergonomie, rythme)',
      'Mise en relation avec un accompagnement psychologique',
      'Dossier RQTH si adapte',
      'Reduction ou adaptation des horaires',
    ],
  },
  finances: {
    label: 'Finances',
    icon: 'wallet',
    questions_indirectes: [
      { q: 'Si votre machine a laver tombait en panne demain, comment feriez-vous ?', indicateurs: ['capacite_imprevus', 'epargne'] },
      { q: 'Comment ca se passe pour vous en fin de mois en general ?', indicateurs: ['tension_budget', 'regulaire'] },
      { q: 'Est-ce qu\'il y a des choses dont vous avez besoin mais que vous ne pouvez pas vous permettre en ce moment ?', indicateurs: ['privations', 'precarite'] },
    ],
    niveaux: {
      1: 'Situation stable',
      2: 'Leger, fin de mois un peu juste',
      3: 'Modere, difficultes ponctuelles',
      4: 'Important, endettement ou impayes',
      5: 'Bloquant, situation de precarite aigue',
    },
    actions_levee: [
      'Orientation vers l\'assistant(e) social(e)',
      'Aide aux demarches d\'acces aux droits (CAF, APL, prime d\'activite)',
      'Accompagnement a la gestion budgetaire',
      'Aide d\'urgence (epicerie sociale, aide alimentaire)',
      'Signalement au referent RSA si applicable',
    ],
  },
  famille: {
    label: 'Famille',
    icon: 'family',
    questions_indirectes: [
      { q: 'Parlez-moi un peu de votre quotidien a la maison. Comment s\'organise votre journee ?', indicateurs: ['charge_familiale', 'organisation'] },
      { q: 'Si on devait changer vos horaires de travail, est-ce que ca poserait un probleme ?', indicateurs: ['flexibilite', 'contraintes_garde'] },
      { q: 'Y a-t-il des personnes qui comptent sur vous au quotidien ?', indicateurs: ['personnes_a_charge', 'isolement'] },
    ],
    niveaux: {
      1: 'Pas de contrainte',
      2: 'Leger, organisation familiale stable',
      3: 'Modere, garde d\'enfants a organiser',
      4: 'Important, parent isole ou personne a charge',
      5: 'Bloquant, situation familiale empechant la disponibilite',
    },
    actions_levee: [
      'Amenagement des horaires (compatible creche / ecole)',
      'Aide a la recherche de mode de garde',
      'Orientation vers des dispositifs d\'aide aux parents isoles',
      'Adaptation du contrat (temps partiel choisi)',
      'Mise en relation avec les services sociaux',
    ],
  },
  linguistique: {
    label: 'Langue',
    icon: 'language',
    questions_indirectes: [
      { q: 'Si je vous donne une notice a lire, comment ca se passerait ?', indicateurs: ['lecture', 'comprehension_ecrit'] },
      { q: 'Est-ce qu\'il vous arrive de ne pas comprendre ce qu\'on vous dit au travail ?', indicateurs: ['comprehension_orale', 'frequence'] },
      { q: 'Si vous deviez appeler un organisme administratif au telephone, comment ca se passerait ?', indicateurs: ['expression_orale', 'autonomie_communication'] },
    ],
    niveaux: {
      1: 'Maitrise courante',
      2: 'Bon niveau oral, ecrit fragile',
      3: 'Comprehension correcte, expression limitee',
      4: 'Difficultes importantes a l\'oral et a l\'ecrit',
      5: 'Barriere linguistique forte, necessite un interprete',
    },
    actions_levee: [
      'Orientation vers des cours de FLE (Francais Langue Etrangere)',
      'Supports visuels et pictogrammes sur le poste',
      'Binomage avec un collegue parlant la meme langue',
      'Ateliers sociolinguistiques (ASL)',
      'Adaptation des consignes (oral, demonstration)',
    ],
  },
  administratif: {
    label: 'Administratif',
    icon: 'file',
    questions_indirectes: [
      { q: 'Quand vous recevez un courrier officiel, comment reagissez-vous ?', indicateurs: ['comprehension_admin', 'stress_courrier'] },
      { q: 'Si vous deviez faire une demarche a la CAF ou a la prefecture, sauriez-vous comment faire ?', indicateurs: ['autonomie_demarches', 'connaissance_organismes'] },
      { q: 'Est-ce qu\'il y a des papiers ou des demarches que vous n\'avez pas encore pu faire ?', indicateurs: ['retard_administratif', 'blocages'] },
    ],
    niveaux: {
      1: 'Tout est en regle',
      2: 'Leger, quelques demarches en cours',
      3: 'Modere, aide necessaire pour certaines demarches',
      4: 'Important, situation administrative complexe',
      5: 'Bloquant, titre de sejour en cours / probleme majeur',
    },
    actions_levee: [
      'Orientation vers le referent socio-professionnel',
      'Aide aux demarches administratives (CPAM, CAF, Pole Emploi)',
      'Accompagnement pour le renouvellement de titre de sejour',
      'Aide a la constitution de dossiers',
      'Mise en relation avec un ecrivain public ou association d\'aide',
    ],
  },
  numerique: {
    label: 'Numerique',
    icon: 'computer',
    questions_indirectes: [
      { q: 'Si quelqu\'un vous envoyait un email important, comment le liriez-vous ?', indicateurs: ['acces_email', 'maitrise_outil'] },
      { q: 'Montrez-moi comment vous utilisez votre telephone. Quelles applications utilisez-vous ?', indicateurs: ['maitrise_smartphone', 'usages'] },
      { q: 'Si vous deviez remplir un formulaire en ligne, comment ca se passerait ?', indicateurs: ['autonomie_numerique', 'confiance'] },
    ],
    niveaux: {
      1: 'A l\'aise avec le numerique',
      2: 'Basique, sait utiliser un telephone et les messages',
      3: 'Modere, besoin d\'aide pour certaines taches',
      4: 'Important, tres peu a l\'aise',
      5: 'Bloquant, pas d\'acces ou pas de competences numeriques',
    },
    actions_levee: [
      'Ateliers d\'initiation numerique',
      'Aide a la creation d\'adresse email et espace France Connect',
      'Accompagnement individuel pour les demarches en ligne',
      'Pret ou aide a l\'acquisition d\'un smartphone',
      'Fiche reflexe avec les manipulations de base',
    ],
  },
};

// ══════════════════════════════════════════════════════════════
// QUESTIONNAIRE CIP — Grilles d'entretien par jalon
// ══════════════════════════════════════════════════════════════

const CIP_QUESTIONNAIRES = {
  'Diagnostic accueil': {
    titre: 'Diagnostic d\'accueil — M+1 max',
    description: 'Premier entretien CIP. Evaluation initiale des freins, definition du plan d\'action et des priorites.',
    sections: [
      {
        titre: 'Accueil et parcours',
        champ: 'cip_integration',
        questions: [
          'Racontez-moi votre parcours avant d\'arriver ici. Qu\'est-ce que vous avez fait avant ?',
          'Comment s\'est passee votre arrivee dans l\'equipe ? Qu\'est-ce qui vous a surpris ?',
          'Qu\'est-ce que vous avez compris du travail qu\'on va vous demander ici ?',
        ],
      },
      {
        titre: 'Capacites et competences',
        champ: 'cip_competences',
        questions: [
          'Qu\'est-ce que vous savez bien faire ? De quoi etes-vous fier ?',
          'Y a-t-il des choses qui vous semblent difficiles dans le travail actuel ?',
          'Comment apprenez-vous le mieux : en regardant, en ecoutant, ou en faisant ?',
        ],
      },
      {
        titre: 'Projet et aspirations',
        champ: 'cip_projet_pro',
        questions: [
          'Si tout etait possible, quel travail aimeriez-vous faire plus tard ?',
          'Qu\'est-ce qui est important pour vous dans un travail ?',
          'Est-ce qu\'il y a des metiers qui vous font envie ou au contraire qui ne vous interessent pas du tout ?',
        ],
      },
      {
        titre: 'Vie sociale et quotidien',
        champ: 'cip_socialisation',
        questions: [
          'En dehors du travail, comment occupez-vous votre temps ?',
          'Est-ce que vous participez a des activites, des associations, du sport ?',
          'Avez-vous des amis ou de la famille sur qui compter si vous avez un coup dur ?',
        ],
      },
    ],
  },
  'Bilan M+3': {
    titre: 'Bilan M+3 — Premier bilan de suivi',
    description: 'Evaluation des progres depuis le diagnostic. Avancement du plan d\'action, evolution des freins.',
    sections: [
      {
        titre: 'Evolution depuis le diagnostic',
        champ: 'cip_integration',
        questions: [
          'Depuis votre arrivee, qu\'est-ce qui a change pour vous au travail ?',
          'Y a-t-il des choses qui sont plus faciles maintenant qu\'au debut ?',
          'Comment vous entendez-vous avec vos collegues et votre encadrant ?',
        ],
      },
      {
        titre: 'Competences acquises',
        champ: 'cip_competences',
        questions: [
          'Quels gestes professionnels maitrisez-vous bien maintenant ?',
          'Est-ce qu\'on vous a confie de nouvelles responsabilites ?',
          'Y a-t-il des formations ou des apprentissages que vous aimeriez faire ?',
        ],
      },
      {
        titre: 'Projet professionnel',
        champ: 'cip_projet_pro',
        questions: [
          'Votre idee de ce que vous voulez faire apres a-t-elle evolue ?',
          'Avez-vous decouvert des metiers ou des activites qui vous plaisent ici ?',
          'De quoi avez-vous besoin pour avancer vers votre projet ?',
        ],
      },
      {
        titre: 'Vie quotidienne',
        champ: 'cip_socialisation',
        questions: [
          'Comment ca se passe chez vous en ce moment ?',
          'Est-ce que vous avez pu commencer des demarches qu\'on avait prevues ensemble ?',
          'Y a-t-il quelque chose qui vous empeche d\'avancer en ce moment ?',
        ],
      },
    ],
  },
  'Bilan M+6': {
    titre: 'Bilan M+6 — Mi-parcours',
    description: 'Bilan de mi-parcours. Point approfondi sur les competences, le projet pro et la levee des freins.',
    sections: [
      {
        titre: 'Bilan d\'integration',
        champ: 'cip_integration',
        questions: [
          'Aujourd\'hui, comment vous sentez-vous dans votre travail au quotidien ?',
          'Qu\'est-ce qui a le plus change depuis le debut du parcours ?',
          'Si un nouveau collegue arrivait, que lui conseilleriez-vous ?',
        ],
      },
      {
        titre: 'Competences et autonomie',
        champ: 'cip_competences',
        questions: [
          'Sur quelles taches etes-vous maintenant completement autonome ?',
          'Pourriez-vous former quelqu\'un sur certains gestes ?',
          'Quelles competences vous manquent encore pour etre a l\'aise ?',
        ],
      },
      {
        titre: 'Projet de sortie',
        champ: 'cip_projet_pro',
        questions: [
          'Avez-vous une idee plus precise du metier que vous visez ?',
          'Savez-vous comment on cherche un emploi dans ce secteur ?',
          'Avez-vous besoin d\'une formation complementaire ? Laquelle ?',
          'Votre CV est-il a jour ? Savez-vous rediger une lettre de motivation ?',
        ],
      },
      {
        titre: 'Situation globale',
        champ: 'cip_socialisation',
        questions: [
          'Globalement, est-ce que votre situation personnelle s\'est amelioree ?',
          'Quels freins avez-vous reussi a lever ? Lesquels persistent ?',
          'De quel soutien avez-vous encore besoin pour la suite ?',
        ],
      },
    ],
  },
  'Bilan M+10': {
    titre: 'Bilan M+10 — Preparation sortie',
    description: 'Derniere phase avant la sortie. Focus sur la preparation a l\'emploi perenne.',
    sections: [
      {
        titre: 'Bilan du parcours',
        champ: 'cip_integration',
        questions: [
          'Quels sont les 3 progres dont vous etes le plus fier depuis le debut ?',
          'Qu\'est-ce que ce parcours vous a apporte ?',
          'Comment vous sentez-vous a l\'idee de quitter le dispositif ?',
        ],
      },
      {
        titre: 'Competences finales',
        champ: 'cip_competences',
        questions: [
          'Quelles competences maitrisez-vous que vous ne connaissiez pas avant ?',
          'Quels savoir-etre avez-vous developpes (ponctualite, travail en equipe...) ?',
          'Etes-vous pret a occuper un poste similaire chez un autre employeur ?',
        ],
      },
      {
        titre: 'Recherche d\'emploi',
        champ: 'cip_projet_pro',
        questions: [
          'Quel type d\'emploi recherchez-vous concretement ?',
          'Avez-vous deja postule quelque part ? Des entretiens en vue ?',
          'Connaissez-vous les employeurs du secteur sur le territoire ?',
          'Avez-vous besoin d\'aide pour preparer vos entretiens d\'embauche ?',
        ],
      },
      {
        titre: 'Stabilite personnelle',
        champ: 'cip_socialisation',
        questions: [
          'Votre situation de logement est-elle stable ?',
          'Toutes vos demarches administratives sont-elles reglees ?',
          'Avez-vous un reseau de soutien (famille, amis, associations) ?',
          'Y a-t-il encore des freins qui pourraient bloquer votre insertion ?',
        ],
      },
    ],
  },
  'Bilan Sortie': {
    titre: 'Bilan de sortie — Fin de parcours',
    description: 'Bilan final avec rapport de sortie. Classification positive/negative et recommandations CIP.',
    sections: [
      {
        titre: 'Bilan global',
        champ: 'cip_integration',
        questions: [
          'Si vous deviez resume votre parcours en quelques mots, que diriez-vous ?',
          'Qu\'est-ce qui a ete le plus difficile ? Le plus positif ?',
          'Recommanderiez-vous ce dispositif a quelqu\'un dans votre situation ?',
        ],
      },
      {
        titre: 'Acquis definitifs',
        champ: 'cip_competences',
        questions: [
          'Quelles competences allez-vous emmener avec vous ?',
          'Quel est votre niveau d\'autonomie professionnel aujourd\'hui ?',
          'Quels conseils donneriez-vous a votre vous du debut du parcours ?',
        ],
      },
      {
        titre: 'Situation a la sortie',
        champ: 'cip_projet_pro',
        questions: [
          'Avez-vous un emploi ou une formation prevue apres le parcours ?',
          'Si oui, chez quel employeur / quel organisme de formation ?',
          'Si non, quel est votre plan pour les prochaines semaines ?',
        ],
      },
      {
        titre: 'Bilan personnel',
        champ: 'cip_socialisation',
        questions: [
          'Comment evaluez-vous votre situation personnelle par rapport au debut ?',
          'Quels freins avez-vous leves ? Lesquels persistent ?',
          'De quel suivi auriez-vous besoin apres votre sortie ?',
        ],
      },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
// MOTEUR — Analyse complète d'insertion
// ══════════════════════════════════════════════════════════════

function analyzeInsertion(employee, contracts, candidate, pcmReport, teamMembers, position, diagnostic, milestones) {
  // Utiliser le PCM du recrutement (pas de questionnaire PCM en insertion)
  const pcm = pcmReport ? JSON.parse(pcmReport) : null;
  const baseType = pcm?.base?.type?.toLowerCase();
  const pcmKnowledge = baseType ? PCM_KNOWLEDGE[baseType] : null;
  const currentContract = contracts.find(c => c.is_current) || contracts[0];

  // Profil PCM depuis rapport recrutement uniquement
  const profilPCM = buildPCMFromReport(pcm);
  const dominantPCM = pcmKnowledge;

  const ficheSynthese = buildFicheSynthese(employee, dominantPCM, candidate, diagnostic, currentContract);
  const competences = buildCompetences(employee, candidate, diagnostic, dominantPCM);
  const pistesMetiers = buildPistesMetiers(employee, dominantPCM, diagnostic, candidate);
  const parcoursDev = buildParcoursDev(employee, contracts, dominantPCM, diagnostic, pistesMetiers);
  const recommandationsCIP = buildRecommandationsCIP(dominantPCM, diagnostic, candidate);
  const freinsSociaux = diagnostic ? buildFreinsSociaux(diagnostic) : null;

  // Recommandations IA continues (tout au long du parcours)
  const aiRecommendations = buildAIRecommendations(employee, dominantPCM, diagnostic, milestones, freinsSociaux, pistesMetiers);

  // Score de confiance
  let dataPoints = 0;
  if (pcm) dataPoints += 3;
  if (candidate?.cv_raw_text) dataPoints += 2;
  if (candidate?.interview_comment) dataPoints += 2;
  if (candidate?.practical_test_result) dataPoints += 1;
  if (diagnostic) dataPoints += 2;
  if (teamMembers.length > 0) dataPoints += 1;

  const data_sources = {
    pcm: { available: !!pcm, label: 'Profil PCM (recrutement)', detail: pcmKnowledge ? `Type ${pcmKnowledge.nom}` : null },
    cv: { available: !!candidate?.cv_raw_text, label: 'CV', detail: candidate?.cv_raw_text ? `${extractSkillsFromCV(candidate.cv_raw_text).length} competences detectees` : null },
    interview: { available: !!(candidate?.interview_comment), label: 'Entretien recrutement', detail: candidate?.interviewer_name ? `Par ${candidate.interviewer_name}` : null },
    test_pratique: { available: !!(candidate?.practical_test_result), label: 'Test pratique', detail: candidate?.practical_test_result ? `Resultat : ${candidate.practical_test_result}` : null },
    diagnostic: { available: !!diagnostic, label: 'Diagnostic CIP', detail: diagnostic ? `${freinsSociaux?.nb_freins_majeurs || 0} frein(s) majeur(s)` : null },
  };

  return {
    fiche_synthese: ficheSynthese,
    profil_pcm: profilPCM,
    competences,
    pistes_metiers: pistesMetiers,
    parcours_dev: parcoursDev,
    recommandations_cip: recommandationsCIP,
    freins_sociaux: freinsSociaux,
    ai_recommendations: aiRecommendations,
    data_sources,
    profil_synthese: ficheSynthese.resume,
    adequation_poste: pistesMetiers.length > 0 ? { score: pistesMetiers[0].score, niveau: pistesMetiers[0].score >= 75 ? 'Bonne' : 'Acceptable', commentaire: pistesMetiers[0].pourquoi } : null,
    parcours_insertion: parcoursDev,
    recommandations: recommandationsCIP.points_vigilance || [],
    plan_action: freinsSociaux?.plan_actions || [],
    risques: [],
    confiance: Math.min(1, dataPoints / 11),
    score_global: null,
  };
}

function getDominantPCM(pcmFromQuestionnaire) {
  if (!pcmFromQuestionnaire) return null;
  let maxType = null, maxScore = 0;
  for (const [type, data] of Object.entries(pcmFromQuestionnaire)) {
    if (data.score > maxScore) { maxScore = data.score; maxType = type; }
  }
  return maxType ? PCM_KNOWLEDGE[maxType] : null;
}

function buildFicheSynthese(employee, pcm, candidate, diagnostic, currentContract) {
  // Resume en 5 lignes max
  let resume = `${employee.first_name} ${employee.last_name}`;
  if (employee.position) resume += `, ${employee.position}`;
  if (currentContract) resume += ` (${currentContract.contract_type})`;
  resume += '.';

  if (pcm) {
    resume += ` Profil de type ${pcm.nom} : ${pcm.forces.slice(0, 3).join(', ')}.`;
  }
  if (candidate?.interview_comment) {
    const interviewSnippet = candidate.interview_comment.substring(0, 120).trim();
    resume += ` Entretien : ${interviewSnippet}${candidate.interview_comment.length > 120 ? '...' : ''}.`;
  }
  if (diagnostic?.parcours_anterieur) {
    resume += ` Parcours : ${diagnostic.parcours_anterieur.substring(0, 150)}.`;
  }

  const forces = pcm ? [...pcm.forces] : [];
  const vigilance = pcm ? [...pcm.faiblesses_stress] : [];
  const communication = pcm ? `Privilegier le canal ${pcm.canal}` : 'Non evalue';
  const motivation = pcm ? [...pcm.facteurs_motivation] : [];

  // Enrichir avec les donnees CV
  if (candidate?.cv_raw_text) {
    const cvSkills = extractSkillsFromCV(candidate.cv_raw_text);
    if (cvSkills.length > 0) {
      forces.push(...cvSkills.slice(0, 3).map(s => `${s} (CV)`));
    }
  }

  // Enrichir avec les donnees d'entretien
  if (candidate?.practical_test_result === 'conforme') {
    forces.push('Test pratique conforme');
  } else if (candidate?.practical_test_result === 'faible') {
    vigilance.push('Test pratique faible');
  }

  // Enrichir avec le diagnostic
  if (diagnostic?.obs_points_forts) {
    const points = diagnostic.obs_points_forts.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    forces.push(...points.slice(0, 2).map(p => `${p} (obs.)`));
  }

  // Sources de donnees utilisees
  const sources = [];
  if (pcm) sources.push('PCM');
  if (candidate?.cv_raw_text) sources.push('CV');
  if (candidate?.interview_comment) sources.push('Entretien');
  if (candidate?.practical_test_result) sources.push('Test pratique');
  if (diagnostic) sources.push('Diagnostic CIP');

  return {
    resume,
    forces,
    vigilance,
    communication,
    motivation,
    sources,
  };
}

function buildPCMFromReport(pcm) {
  if (!pcm) return null;
  const baseType = pcm.base?.type?.toLowerCase();
  const result = {};
  for (const [type, data] of Object.entries(PCM_KNOWLEDGE)) {
    result[type] = {
      score: 0,
      niveau: type === baseType ? 'FORT' : 'FAIBLE',
      label: data.nom,
      description: data.niveau_label,
    };
  }
  return result;
}

function buildCompetences(employee, candidate, diagnostic, pcm) {
  const techniques = [];
  const transversales = [];
  const savoirEtre = [];
  const aConsolider = [];

  // Depuis le CV
  if (candidate?.cv_raw_text) {
    const skills = extractSkillsFromCV(candidate.cv_raw_text);
    techniques.push(...skills.map(s => ({ competence: s, source: 'CV' })));
  }

  // Depuis les certifications
  if (employee.has_permis_b) techniques.push({ competence: 'Permis B', source: 'Certification' });
  if (employee.has_caces) techniques.push({ competence: 'CACES', source: 'Certification' });

  // Depuis l'entretien candidat
  if (candidate?.interview_comment) {
    const interviewSkills = extractSkillsFromText(candidate.interview_comment);
    transversales.push(...interviewSkills.map(s => ({ competence: s, source: 'Entretien' })));
  }

  // Depuis le test pratique
  if (candidate?.practical_test_comment) {
    const testSkills = extractSkillsFromText(candidate.practical_test_comment);
    transversales.push(...testSkills.map(s => ({ competence: s, source: 'Test pratique' })));
  }
  if (candidate?.practical_test_result === 'conforme') {
    savoirEtre.push({ competence: 'Test pratique reussi', source: 'Evaluation' });
  } else if (candidate?.practical_test_result === 'faible') {
    aConsolider.push({ competence: 'Test pratique a renforcer', source: 'Evaluation' });
  }

  // Depuis les observations CIP
  if (diagnostic?.obs_points_forts) {
    const points = diagnostic.obs_points_forts.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    transversales.push(...points.map(p => ({ competence: p, source: 'Observation CIP' })));
  }

  // Depuis le comportement en equipe (diagnostic)
  if (diagnostic?.obs_comportement_equipe) {
    const comportement = diagnostic.obs_comportement_equipe.trim();
    if (comportement) savoirEtre.push({ competence: comportement.substring(0, 60), source: 'Observation CIP' });
  }

  // Depuis l'autonomie/ponctualite (diagnostic)
  if (diagnostic?.obs_autonomie_ponctualite) {
    const autonomie = diagnostic.obs_autonomie_ponctualite.trim();
    if (autonomie) savoirEtre.push({ competence: autonomie.substring(0, 60), source: 'Observation CIP' });
  }

  // Depuis le PCM
  if (pcm) {
    savoirEtre.push(...pcm.forces.map(f => ({ competence: f, source: 'Profil PCM' })));
  }

  // Difficultes = a consolider
  if (diagnostic?.obs_difficultes) {
    const diffs = diagnostic.obs_difficultes.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
    aConsolider.push(...diffs.map(d => ({ competence: d, source: 'Observation CIP' })));
  }

  // Axes de developpement PCM
  if (pcm) {
    aConsolider.push(...pcm.axes_developpement.map(a => ({ competence: a, source: 'Profil PCM' })));
  }

  return { techniques, transversales, savoir_etre: savoirEtre, a_consolider: aConsolider };
}

function extractSkillsFromText(text) {
  if (!text) return [];
  const qualityPatterns = [
    /ponctuel/gi, /motiv[eé]/gi, /rigoureu[xs]/gi, /autonome/gi,
    /organis[eé]/gi, /dynamique/gi, /s[eé]rieu[xs]/gi, /assidu/gi,
    /volontaire/gi, /polyvalent/gi, /minutieu[xs]/gi, /soigneu[xs]/gi,
    /rapide/gi, /efficace/gi, /communication/gi, /travail.d.equipe/gi,
    /adaptab/gi, /fiable/gi, /respectueu[xs]/gi, /courageuse?/gi,
  ];
  const found = new Set();
  for (const pattern of qualityPatterns) {
    const match = text.match(pattern);
    if (match) found.add(match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase());
  }
  return [...found].slice(0, 5);
}

function buildPistesMetiers(employee, pcm, diagnostic, candidate) {
  const pistes = [];
  const dominantType = pcm ? Object.entries(PCM_KNOWLEDGE).find(([, v]) => v === pcm)?.[0] : null;

  for (const [metier, data] of Object.entries(METIERS_CIBLES)) {
    let score = 40;
    let pourquoi = '';
    const vigilancePoints = [];

    // Score basé sur le profil PCM
    if (dominantType && data.profils_ideaux.includes(dominantType)) {
      score += 35;
      pourquoi = `Le profil ${pcm.nom} est naturellement adapté à ce métier (${data.description}).`;
    } else if (pcm) {
      pourquoi = `Le profil ${pcm.nom} peut exercer ce métier avec un accompagnement adapté.`;
      score += 10;
    }

    // Score base sur les competences CV
    if (candidate?.cv_raw_text) {
      const cvSkills = extractSkillsFromCV(candidate.cv_raw_text);
      if (data.qualites_requises.some(q => cvSkills.some(s => s.toLowerCase().includes(q.toLowerCase().split(' ')[0])))) {
        score += 10;
        pourquoi += ' Competences CV en lien avec ce metier.';
      }
    }

    // Score base sur l'entretien
    if (candidate?.interview_comment) {
      const interview = candidate.interview_comment.toLowerCase();
      if (data.qualites_requises.some(q => interview.includes(q.toLowerCase().split(' ')[0]))) {
        score += 10;
        pourquoi += ' Elements positifs releves en entretien.';
      }
    }

    // Score base sur le test pratique
    if (candidate?.practical_test_result === 'conforme') {
      score += 5;
    } else if (candidate?.practical_test_result === 'recale') {
      score -= 10;
    }

    // Score basé sur les préférences exprimées
    if (diagnostic?.pref_aime_faire) {
      const aime = diagnostic.pref_aime_faire.toLowerCase();
      if (data.qualites_requises.some(q => aime.includes(q.toLowerCase()))) {
        score += 15;
        pourquoi += ' Correspond aux préférences exprimées.';
      }
    }

    // Score base sur les interets Explorama (enrichi)
    if (diagnostic?.explorama_interets) {
      const interets = diagnostic.explorama_interets.toLowerCase();
      if (data.famille.toLowerCase().split(/[\s/]+/).some(f => interets.includes(f))) {
        score += 10;
        pourquoi += ' Interets Explorama en lien.';
      }
    }

    // Score base sur les gestes professionnels Explorama
    if (diagnostic?.explorama_gestes_positifs) {
      const gestes = diagnostic.explorama_gestes_positifs.toLowerCase();
      if (data.qualites_requises.some(q => gestes.includes(q.toLowerCase().split(' ')[0]))) {
        score += 10;
        pourquoi += ' Gestes apprecies en lien avec ce metier.';
      }
    }
    if (diagnostic?.explorama_gestes_negatifs) {
      const gestesNeg = diagnostic.explorama_gestes_negatifs.toLowerCase();
      if (data.qualites_requises.some(q => gestesNeg.includes(q.toLowerCase().split(' ')[0]))) {
        score -= 10;
        vigilancePoints.push('Gestes rejetes en Explorama proches des requis');
      }
    }

    // Score base sur l'environnement Explorama
    if (diagnostic?.explorama_environnements) {
      const env = diagnostic.explorama_environnements.toLowerCase();
      if (data.contraintes.some(c => env.includes(c.toLowerCase().split(' ')[0]))) {
        score += 5;
      }
    }

    // Rejets Explorama vs famille metier
    if (diagnostic?.explorama_rejets) {
      const rejets = diagnostic.explorama_rejets.toLowerCase();
      if (data.famille.toLowerCase().split(/[\s/]+/).some(f => rejets.includes(f))) {
        score -= 15;
        vigilancePoints.push('Univers rejete en Explorama');
      }
    }

    // Verifier les contraintes vs freins
    if (data.contraintes.some(c => c.toLowerCase().includes('physique') || c.toLowerCase().includes('charges'))) {
      if (diagnostic?.frein_sante >= 4) {
        score -= 25;
        vigilancePoints.push('Contraintes physiques vs limitations de santé');
      }
    }
    if (data.contraintes.some(c => c.toLowerCase().includes('écran') || c.toLowerCase().includes('écrit'))) {
      if (diagnostic?.frein_linguistique >= 4) {
        score -= 20;
        vigilancePoints.push('Maîtrise de l\'écrit requise');
      }
    }
    if (data.qualites_requises.some(q => q.toLowerCase().includes('permis'))) {
      if (!employee.has_permis_b) {
        score -= 15;
        vigilancePoints.push('Permis B requis, non obtenu');
      }
    }

    // Ce que la personne ne veut plus
    if (diagnostic?.pref_ne_veut_plus) {
      const refuse = diagnostic.pref_ne_veut_plus.toLowerCase();
      if (data.contraintes.some(c => refuse.includes(c.toLowerCase().split(' ')[0]))) {
        score -= 20;
        vigilancePoints.push('Proche de ce que la personne ne souhaite plus faire');
      }
    }

    score = Math.min(100, Math.max(0, score));

    pistes.push({
      metier,
      famille: data.famille,
      description: data.description,
      score,
      pourquoi: pourquoi || `Métier accessible dans le contexte de Solidarité Textile.`,
      vigilance: vigilancePoints,
      qualites_requises: data.qualites_requises,
      evolution: data.potentiel_evolution,
    });
  }

  // Trier par score décroissant, garder les 5 premiers
  return pistes.sort((a, b) => b.score - a.score).slice(0, 5);
}

function buildParcoursDev(employee, contracts, pcm, diagnostic, pistesMetiers) {
  const parcours = [];
  const currentPosition = employee.position || 'Non défini';
  const topMetier = pistesMetiers.length > 0 ? pistesMetiers[0] : null;
  const totalMonths = contracts.reduce((s, c) => s + (c.duration_months || 0), 0);

  // Parcours A : Consolidation dans le métier actuel
  parcours.push({
    phase: `Parcours A : Consolidation — ${currentPosition}`,
    statut: 'en_cours',
    description: `Renforcer les compétences sur le poste actuel. Objectif : autonomie complète en ${Math.max(3, 6 - totalMonths)} mois.`,
    actions: [
      'Observation en situation avec grille de compétences',
      pcm ? `Communication adaptée au canal ${pcm.canal}` : 'Identifier le style de communication optimal',
      'Missions progressives avec montée en responsabilité',
      'Bilan intermédiaire à mi-parcours avec le CIP',
      'Feedback régulier du manager sur les progrès',
    ],
    duree: `${Math.max(3, 6 - totalMonths)} mois`,
    indicateurs: [
      'Autonomie sur les tâches principales',
      'Qualité du travail (taux d\'erreur)',
      'Ponctualité et assiduité',
      'Capacité à expliquer une tâche à un pair',
    ],
  });

  // Parcours B : Évolution vers un métier proche
  if (topMetier && topMetier.metier !== currentPosition) {
    parcours.push({
      phase: `Parcours B : Évolution — ${topMetier.metier}`,
      statut: 'a_planifier',
      description: `Transition progressive vers ${topMetier.metier} (${topMetier.famille}). ${topMetier.pourquoi}`,
      actions: [
        `Mise en situation ponctuelle sur le poste de ${topMetier.metier}`,
        'Atelier Explorama : identification des gestes professionnels appréciés',
        `Formation aux compétences requises : ${topMetier.qualites_requises.slice(0, 3).join(', ')}`,
        'Entretien CIP : validation de l\'intérêt et de la motivation',
        'Stage interne de 2 semaines sur le nouveau poste',
      ],
      duree: '4 à 6 mois',
      indicateurs: [
        'Intérêt maintenu après la mise en situation',
        'Acquisition des gestes de base',
        'Avis favorable du responsable du poste cible',
      ],
    });
  }

  // Parcours C : Reconversion / sortie positive
  parcours.push({
    phase: 'Parcours C : Sortie positive vers l\'emploi',
    statut: 'objectif',
    description: 'Préparation à la sortie du dispositif d\'insertion vers un emploi pérenne ou une formation qualifiante.',
    actions: [
      'Accompagnement CV et lettre de motivation',
      'Préparation aux entretiens d\'embauche (simulation)',
      'Recherche d\'emploi accompagnée (offres, candidatures)',
      topMetier ? `Cibler les employeurs du secteur ${topMetier.famille}` : 'Explorer les secteurs porteurs du territoire',
      'Mobiliser le réseau de partenaires employeurs de Solidarité Textile',
      'Suivi post-insertion pendant 6 mois',
    ],
    duree: '3 à 6 mois',
    indicateurs: [
      'Nombre de candidatures envoyées',
      'Nombre d\'entretiens obtenus',
      'Obtention d\'un emploi ou d\'une formation',
    ],
  });

  return parcours;
}

function buildRecommandationsCIP(pcm, diagnostic, candidate) {
  const points_vigilance = [];
  const conditions_reussite = [];
  const outils = [];

  if (pcm) {
    points_vigilance.push({
      titre: 'Communication',
      detail: `Privilegier le canal ${pcm.canal}. ${pcm.conseils_manager[0]}`,
    });
    points_vigilance.push({
      titre: 'Gestion du stress',
      detail: `Sous stress : ${pcm.faiblesses_stress.join(', ')}. ${pcm.conseils_manager[2] || ''}`,
    });

    conditions_reussite.push(`Besoin principal : ${pcm.besoin}`);
    conditions_reussite.push(`Environnement ideal : ${pcm.environnement_ideal}`);
    pcm.conseils_manager.forEach(c => conditions_reussite.push(c));
  }

  // Points issus de l'entretien
  if (candidate?.interview_comment) {
    points_vigilance.push({
      titre: 'Entretien',
      detail: candidate.interview_comment.substring(0, 200),
    });
  }

  // Points issus du test pratique
  if (candidate?.practical_test_result === 'faible' && candidate?.practical_test_comment) {
    points_vigilance.push({
      titre: 'Test pratique',
      detail: `Resultat faible : ${candidate.practical_test_comment.substring(0, 150)}`,
    });
    conditions_reussite.push('Prevoir un accompagnement renforce sur les gestes techniques');
  }

  // Points issus du CV
  if (candidate?.cv_raw_text) {
    const cvSkills = extractSkillsFromCV(candidate.cv_raw_text);
    if (cvSkills.length > 0) {
      conditions_reussite.push(`Valoriser les competences identifiees dans le CV : ${cvSkills.slice(0, 4).join(', ')}`);
    }
  }

  // Outils a mobiliser
  outils.push('Photolangage d\'environnements de travail (Explorama)');
  outils.push('Cartes de gestes professionnels');
  outils.push('Grille de reperage de competences en situation');

  if (diagnostic?.frein_linguistique >= 3) {
    outils.push('Supports visuels et pictogrammes');
    outils.push('Consignes orales avec demonstration');
    conditions_reussite.push('Adapter les supports ecrits au niveau linguistique');
  }

  if (diagnostic?.frein_numerique >= 3) {
    outils.push('Ateliers d\'initiation numerique');
    conditions_reussite.push('Accompagner les demarches en ligne');
  }

  return { points_vigilance, conditions_reussite, outils };
}

function buildFreinsSociaux(diagnostic) {
  const freins = [];
  const FREIN_FIELDS = ['mobilite', 'sante', 'finances', 'famille', 'linguistique', 'administratif', 'numerique'];

  for (const key of FREIN_FIELDS) {
    const niveau = diagnostic[`frein_${key}`] || 1;
    const detail = diagnostic[`frein_${key}_detail`] || '';
    const causes = (diagnostic[`frein_${key}_causes`] || '').split(',').filter(Boolean);
    const def = FREINS_DEFINITIONS[key];

    freins.push({
      type: key,
      label: def.label,
      icon: def.icon,
      niveau,
      niveau_label: def.niveaux[niveau],
      detail,
      causes,
      actions: niveau >= 3 ? def.actions_levee.slice(0, Math.min(3, niveau - 1)) : [],
    });
  }

  // Trier par niveau décroissant
  freins.sort((a, b) => b.niveau - a.niveau);

  // Plan d'actions prioritaires
  const plan_actions = freins
    .filter(f => f.niveau >= 3)
    .map(f => ({
      priorite: f.niveau >= 4 ? 'haute' : 'moyenne',
      action: `Lever le frein ${f.label}`,
      detail: f.actions[0] || `Accompagnement ${f.label.toLowerCase()} à mettre en place`,
      echeance: f.niveau >= 4 ? '2 semaines' : '1 mois',
    }));

  return { freins, plan_actions, nb_freins_majeurs: freins.filter(f => f.niveau >= 4).length };
}

// ══════════════════════════════════════════════════════════════
// MOTEUR IA — Recommandations continues tout au long du parcours
// ══════════════════════════════════════════════════════════════

function buildAIRecommendations(employee, pcm, diagnostic, milestones, freinsSociaux, pistesMetiers) {
  const recommandations = { alertes: [], propositions: [], accompagnement: [] };
  const ms = milestones || [];

  // Alertes basees sur les freins
  if (freinsSociaux) {
    const freinsBloquants = freinsSociaux.freins.filter(f => f.niveau >= 4);
    for (const f of freinsBloquants) {
      recommandations.alertes.push({
        type: 'frein_bloquant',
        urgence: 'haute',
        message: `Frein ${f.label} a niveau ${f.niveau}/5 — action prioritaire requise`,
        actions_suggerees: f.actions.slice(0, 2),
      });
    }
    const freinsModeres = freinsSociaux.freins.filter(f => f.niveau === 3);
    for (const f of freinsModeres) {
      recommandations.alertes.push({
        type: 'frein_modere',
        urgence: 'moyenne',
        message: `Frein ${f.label} modere (${f.niveau}/5) — surveiller l'evolution`,
        actions_suggerees: f.actions.slice(0, 1),
      });
    }
  }

  // Analyse evolution freins entre bilans
  if (ms.length >= 2) {
    const sorted = [...ms].filter(m => m.status === 'realise' && m.frein_mobilite != null).sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    if (sorted.length >= 2) {
      const last = sorted[sorted.length - 1];
      const prev = sorted[sorted.length - 2];
      const freinKeys = ['mobilite', 'sante', 'finances', 'famille', 'linguistique', 'administratif', 'numerique'];
      for (const key of freinKeys) {
        const lastVal = last[`frein_${key}`] || 0;
        const prevVal = prev[`frein_${key}`] || 0;
        if (lastVal > prevVal) {
          recommandations.alertes.push({
            type: 'frein_regression',
            urgence: 'haute',
            message: `Frein ${key} en regression (${prevVal} -> ${lastVal}) entre ${prev.milestone_type} et ${last.milestone_type}`,
            actions_suggerees: ['Entretien urgent avec la CIP', 'Revoir le plan d\'action sur ce frein'],
          });
        } else if (lastVal < prevVal) {
          recommandations.propositions.push({
            type: 'frein_progression',
            message: `Bonne progression sur ${key} (${prevVal} -> ${lastVal}). Continuer le plan d\'action.`,
          });
        }
      }
    }
  }

  // Propositions basees sur le PCM
  if (pcm) {
    recommandations.accompagnement.push({
      type: 'communication',
      message: `Utiliser le canal ${pcm.canal} pour communiquer avec ${employee.first_name}`,
      detail: pcm.conseils_manager.join('. '),
    });
    recommandations.accompagnement.push({
      type: 'motivation',
      message: `Besoin principal : ${pcm.besoin}`,
      detail: `Environnement ideal : ${pcm.environnement_ideal}`,
    });
    recommandations.accompagnement.push({
      type: 'vigilance_stress',
      message: `Sous stress : ${pcm.faiblesses_stress.join(', ')}`,
      detail: pcm.risques_insertion,
    });
  }

  // Propositions metiers
  if (pistesMetiers && pistesMetiers.length > 0) {
    const topMetier = pistesMetiers[0];
    if (topMetier.score >= 70) {
      recommandations.propositions.push({
        type: 'metier_adapte',
        message: `Metier recommande : ${topMetier.metier} (score ${topMetier.score}%)`,
        detail: topMetier.pourquoi,
      });
    }
  }

  // Alertes de planification
  const msNonRealises = ms.filter(m => m.status === 'a_planifier');
  for (const m of msNonRealises) {
    const dueDate = new Date(m.due_date);
    const daysUntil = Math.round((dueDate - new Date()) / 86400000);
    if (daysUntil < 0) {
      recommandations.alertes.push({
        type: 'retard_jalon',
        urgence: 'haute',
        message: `${m.milestone_type} en retard de ${Math.abs(daysUntil)} jours — planifier en urgence`,
        actions_suggerees: ['Fixer une date d\'entretien immediatement'],
      });
    } else if (daysUntil <= 14) {
      recommandations.alertes.push({
        type: 'jalon_proche',
        urgence: 'moyenne',
        message: `${m.milestone_type} prevu dans ${daysUntil} jours — penser a planifier`,
        actions_suggerees: ['Verifier la disponibilite du CIP', 'Preparer les documents'],
      });
    }
  }

  return recommandations;
}

function extractSkillsFromCV(cvText) {
  if (!cvText) return [];
  const skillPatterns = [
    /permis\s*b/gi, /caces/gi, /cariste/gi, /manutention/gi,
    /logistique/gi, /tri/gi, /recyclage/gi, /textile/gi,
    /chauffeur/gi, /conduite/gi, /informatique/gi, /bureautique/gi,
    /word/gi, /excel/gi, /anglais/gi, /espagnol/gi, /arabe/gi,
    /management/gi, /encadrement/gi, /vente/gi, /commerce/gi,
    /cuisine/gi, /ménage/gi, /nettoyage/gi, /bâtiment/gi,
    /couture/gi, /retouche/gi, /repassage/gi, /soudure/gi,
  ];
  const found = new Set();
  for (const pattern of skillPatterns) {
    const match = cvText.match(pattern);
    if (match) found.add(match[0].trim());
  }
  return [...found].slice(0, 10);
}

// ══════════════════════════════════════════════════════════════
// TIMELINE — Historique visuel du parcours embauche → sortie
// ══════════════════════════════════════════════════════════════

function buildTimeline(employee, contracts, milestones, diagnostic) {
  const events = [];
  const currentContract = contracts.find(c => c.is_current) || contracts[0];
  const startDate = employee.insertion_start_date || currentContract?.start_date;
  const endDate = currentContract?.end_date;

  // 1. Embauche
  if (startDate) {
    events.push({
      type: 'embauche',
      label: 'Embauche',
      date: startDate,
      status: 'realise',
      description: `Debut du contrat ${currentContract?.contract_type || 'CDDI'}`,
    });
  }

  // 2. Diagnostic d'accueil
  const diagMilestone = milestones.find(m => m.milestone_type === 'Diagnostic accueil');
  events.push({
    type: 'milestone',
    label: 'Diagnostic accueil',
    date: diagMilestone?.completed_date || diagMilestone?.due_date || (startDate ? addMonths(startDate, 1) : null),
    status: diagMilestone?.status || 'a_planifier',
    milestone_id: diagMilestone?.id,
    has_diagnostic: !!diagnostic,
  });

  // 3-5. Bilans M+3, M+6, M+10
  for (const type of ['Bilan M+3', 'Bilan M+6', 'Bilan M+10']) {
    const ms = milestones.find(m => m.milestone_type === type);
    const monthOffset = type === 'Bilan M+3' ? 3 : type === 'Bilan M+6' ? 6 : 10;
    events.push({
      type: 'milestone',
      label: type,
      date: ms?.completed_date || ms?.due_date || (startDate ? addMonths(startDate, monthOffset) : null),
      status: ms?.status || 'a_planifier',
      milestone_id: ms?.id,
      avis_global: ms?.avis_global,
    });
  }

  // 6. Bilan Sortie
  const sortieMilestone = milestones.find(m => m.milestone_type === 'Bilan Sortie');
  events.push({
    type: 'milestone',
    label: 'Bilan Sortie',
    date: sortieMilestone?.completed_date || sortieMilestone?.due_date || endDate,
    status: sortieMilestone?.status || 'a_planifier',
    milestone_id: sortieMilestone?.id,
    sortie_classification: sortieMilestone?.sortie_classification,
  });

  // 7. Fin de contrat
  if (endDate) {
    events.push({
      type: 'fin_contrat',
      label: 'Fin de contrat',
      date: endDate,
      status: new Date(endDate) < new Date() ? 'realise' : 'a_venir',
    });
  }

  return {
    events,
    start_date: startDate,
    end_date: endDate,
    duree_totale_mois: startDate && endDate ? Math.round((new Date(endDate) - new Date(startDate)) / (30.44 * 86400000)) : null,
    progression: calculateProgression(events),
  };
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function calculateProgression(events) {
  const milestones = events.filter(e => e.type === 'milestone');
  const realised = milestones.filter(e => e.status === 'realise').length;
  return milestones.length > 0 ? Math.round((realised / milestones.length) * 100) : 0;
}

// ══════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════

const PCM_KEY = process.env.JWT_SECRET || 'solidata-pcm-encryption-key';

// GET /api/insertion/freins-definitions — Référentiel des freins (pour le frontend)
router.get('/freins-definitions', (req, res) => {
  res.json(FREINS_DEFINITIONS);
});

// GET /api/insertion/diagnostic/:employeeId — Récupérer le diagnostic CIP
router.get('/diagnostic/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM insertion_diagnostics WHERE employee_id = $1',
      [req.params.employeeId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('[INSERTION] Erreur diagnostic GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/diagnostic/:employeeId — Sauvegarder/mettre a jour le diagnostic
router.put('/diagnostic/:employeeId', async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    if (isNaN(empId)) return res.status(400).json({ error: 'ID employe invalide' });
    const d = req.body;

    const result = await pool.query(`
      INSERT INTO insertion_diagnostics (
        employee_id, created_by, updated_by,
        parcours_anterieur, contraintes_sante, contraintes_mobilite, contraintes_familiales, autres_contraintes,
        frein_mobilite, frein_mobilite_detail, frein_mobilite_causes,
        frein_sante, frein_sante_detail, frein_sante_causes,
        frein_finances, frein_finances_detail, frein_finances_causes,
        frein_famille, frein_famille_detail, frein_famille_causes,
        frein_linguistique, frein_linguistique_detail, frein_linguistique_causes,
        frein_administratif, frein_administratif_detail, frein_administratif_causes,
        frein_numerique, frein_numerique_detail, frein_numerique_causes,
        obs_taches_realisees, obs_points_forts, obs_difficultes,
        obs_comportement_equipe, obs_autonomie_ponctualite,
        pref_aime_faire, pref_ne_veut_plus, pref_environnement_prefere,
        pref_environnement_eviter, pref_objectifs,
        explorama_interets, explorama_rejets,
        explorama_gestes_positifs, explorama_gestes_negatifs,
        explorama_environnements, explorama_rythme,
        cip_hypotheses_metiers, cip_questions
      ) VALUES (
        $1, $2, $2,
        $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31, $32, $33,
        $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43, $44,
        $45, $46
      )
      ON CONFLICT (employee_id) DO UPDATE SET
        updated_by = $2, updated_at = NOW(),
        parcours_anterieur = $3, contraintes_sante = $4, contraintes_mobilite = $5,
        contraintes_familiales = $6, autres_contraintes = $7,
        frein_mobilite = $8, frein_mobilite_detail = $9, frein_mobilite_causes = $10,
        frein_sante = $11, frein_sante_detail = $12, frein_sante_causes = $13,
        frein_finances = $14, frein_finances_detail = $15, frein_finances_causes = $16,
        frein_famille = $17, frein_famille_detail = $18, frein_famille_causes = $19,
        frein_linguistique = $20, frein_linguistique_detail = $21, frein_linguistique_causes = $22,
        frein_administratif = $23, frein_administratif_detail = $24, frein_administratif_causes = $25,
        frein_numerique = $26, frein_numerique_detail = $27, frein_numerique_causes = $28,
        obs_taches_realisees = $29, obs_points_forts = $30, obs_difficultes = $31,
        obs_comportement_equipe = $32, obs_autonomie_ponctualite = $33,
        pref_aime_faire = $34, pref_ne_veut_plus = $35,
        pref_environnement_prefere = $36, pref_environnement_eviter = $37,
        pref_objectifs = $38,
        explorama_interets = $39, explorama_rejets = $40,
        explorama_gestes_positifs = $41, explorama_gestes_negatifs = $42,
        explorama_environnements = $43, explorama_rythme = $44,
        cip_hypotheses_metiers = $45, cip_questions = $46
      RETURNING *
    `, [
      empId, req.user.id,
      d.parcours_anterieur || null, d.contraintes_sante || null,
      d.contraintes_mobilite || null, d.contraintes_familiales || null,
      d.autres_contraintes || null,
      d.frein_mobilite || 1, d.frein_mobilite_detail || null, d.frein_mobilite_causes || null,
      d.frein_sante || 1, d.frein_sante_detail || null, d.frein_sante_causes || null,
      d.frein_finances || 1, d.frein_finances_detail || null, d.frein_finances_causes || null,
      d.frein_famille || 1, d.frein_famille_detail || null, d.frein_famille_causes || null,
      d.frein_linguistique || 1, d.frein_linguistique_detail || null, d.frein_linguistique_causes || null,
      d.frein_administratif || 1, d.frein_administratif_detail || null, d.frein_administratif_causes || null,
      d.frein_numerique || 1, d.frein_numerique_detail || null, d.frein_numerique_causes || null,
      d.obs_taches_realisees || null, d.obs_points_forts || null,
      d.obs_difficultes || null, d.obs_comportement_equipe || null,
      d.obs_autonomie_ponctualite || null,
      d.pref_aime_faire || null, d.pref_ne_veut_plus || null,
      d.pref_environnement_prefere || null, d.pref_environnement_eviter || null,
      d.pref_objectifs || null,
      d.explorama_interets || null, d.explorama_rejets || null,
      d.explorama_gestes_positifs || null, d.explorama_gestes_negatifs || null,
      d.explorama_environnements || null, d.explorama_rythme || null,
      d.cip_hypotheses_metiers || null, d.cip_questions || null,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur diagnostic PUT :', err.message, err.detail || '');
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

// GET /api/insertion/:employeeId — Analyse complète
router.get('/:employeeId', async (req, res) => {
  try {
    const empId = req.params.employeeId;

    // 1. Données employé
    const empRes = await pool.query(`
      SELECT e.*, t.name as team_name, p.title as position_title
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN positions p ON p.title = e.position
      WHERE e.id = $1
    `, [empId]);
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Employé non trouvé' });
    const employee = empRes.rows[0];

    // 2. Contrats
    let contractsRes = { rows: [] };
    try {
      contractsRes = await pool.query(
        'SELECT ec.*, t.name as team_name, p.title as position_title FROM employee_contracts ec LEFT JOIN teams t ON ec.team_id = t.id LEFT JOIN positions p ON ec.position_id = p.id WHERE ec.employee_id = $1 ORDER BY ec.start_date DESC',
        [empId]
      );
    } catch { /* table might not exist */ }

    // 3. Candidat (par nom ou candidate_id)
    let candidate = null;
    try {
      if (employee.candidate_id) {
        const candRes = await pool.query('SELECT * FROM candidates WHERE id = $1', [employee.candidate_id]);
        candidate = candRes.rows[0] || null;
      }
      if (!candidate) {
        const candRes = await pool.query(
          'SELECT * FROM candidates WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) ORDER BY created_at DESC LIMIT 1',
          [employee.first_name, employee.last_name]
        );
        candidate = candRes.rows[0] || null;
      }
    } catch { /* table might not exist */ }

    // 4. Rapport PCM
    let pcmReport = null;
    if (candidate) {
      try {
        const pcmRes = await pool.query(
          'SELECT encrypted_report FROM pcm_reports WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1',
          [candidate.id]
        );
        if (pcmRes.rows[0]?.encrypted_report) {
          const bytes = CryptoJS.AES.decrypt(pcmRes.rows[0].encrypted_report, PCM_KEY);
          pcmReport = bytes.toString(CryptoJS.enc.Utf8);
        }
      } catch { /* pcm might not exist */ }
    }

    // 5. Membres de l'équipe
    let teamMembers = [];
    if (employee.team_id) {
      try {
        const teamRes = await pool.query(
          'SELECT id, first_name, last_name FROM employees WHERE team_id = $1 AND is_active = true AND id != $2',
          [employee.team_id, empId]
        );
        teamMembers = teamRes.rows;
      } catch { /* ignore */ }
    }

    // 6. Position
    let position = null;
    const currentContract = contractsRes.rows.find(c => c.is_current);
    if (currentContract?.position_id) {
      try {
        const posRes = await pool.query('SELECT * FROM positions WHERE id = $1', [currentContract.position_id]);
        position = posRes.rows[0] || null;
      } catch { /* ignore */ }
    }

    // 7. Diagnostic CIP
    let diagnostic = null;
    try {
      const diagRes = await pool.query('SELECT * FROM insertion_diagnostics WHERE employee_id = $1', [empId]);
      diagnostic = diagRes.rows[0] || null;
    } catch { /* table might not exist yet */ }

    // 8. Jalons insertion
    let milestones = [];
    try {
      const msRes = await pool.query(
        'SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date', [empId]
      );
      milestones = msRes.rows;
    } catch { /* table might not exist yet */ }

    // 9. Plan d'action CIP
    let actionPlans = [];
    try {
      const apRes = await pool.query(
        'SELECT * FROM cip_action_plans WHERE employee_id = $1 ORDER BY created_at', [empId]
      );
      actionPlans = apRes.rows;
    } catch { /* table might not exist yet */ }

    // 10. Analyse complete
    const analysis = analyzeInsertion(
      employee, contractsRes.rows, candidate, pcmReport,
      teamMembers, position, diagnostic, milestones
    );

    // 11. Timeline du parcours
    const timeline = buildTimeline(employee, contractsRes.rows, milestones, diagnostic);

    res.json({
      employee: {
        id: employee.id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        team_name: employee.team_name,
        position: employee.position,
        is_active: employee.is_active,
        insertion_start_date: employee.insertion_start_date,
        insertion_status: employee.insertion_status,
      },
      has_pcm: !!pcmReport,
      has_candidate_data: !!candidate,
      has_cv: !!candidate?.cv_raw_text,
      has_interview: !!candidate?.interview_comment,
      has_diagnostic: !!diagnostic,
      nb_contracts: contractsRes.rows.length,
      milestones,
      action_plans: actionPlans,
      timeline,
      ...analysis,
    });
  } catch (err) {
    console.error('[INSERTION] Erreur analyse :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion — Vue d'ensemble de tous les employés actifs
router.get('/', async (req, res) => {
  try {
    // Detecter quelles tables existent pour adapter la requete
    const tablesCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('employee_contracts', 'pcm_reports', 'insertion_diagnostics')
    `);
    const existingTables = new Set(tablesCheck.rows.map(r => r.table_name));

    let subqueries = '';
    if (existingTables.has('employee_contracts')) {
      subqueries += `,
        COALESCE((SELECT COUNT(*)::int FROM employee_contracts WHERE employee_id = e.id), 0) as nb_contracts,
        (SELECT ec.contract_type FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as current_contract_type,
        (SELECT ec.end_date FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as contract_end_date`;
    } else {
      subqueries += `, 0 as nb_contracts, e.contract_type as current_contract_type, e.contract_end as contract_end_date`;
    }
    if (existingTables.has('pcm_reports')) {
      subqueries += `,
        CASE WHEN e.candidate_id IS NOT NULL THEN
          COALESCE((SELECT COUNT(*)::int FROM pcm_reports pr WHERE pr.candidate_id = e.candidate_id), 0)
        ELSE 0 END as has_pcm`;
    } else {
      subqueries += `, 0 as has_pcm`;
    }
    if (existingTables.has('insertion_diagnostics')) {
      subqueries += `,
        COALESCE((SELECT COUNT(*)::int FROM insertion_diagnostics diag WHERE diag.employee_id = e.id), 0) as has_diagnostic`;
    } else {
      subqueries += `, 0 as has_diagnostic`;
    }

    const result = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.is_active,
        t.name as team_name, e.position, e.contract_type, e.contract_start, e.contract_end
        ${subqueries}
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE e.is_active = true
      ORDER BY e.last_name, e.first_name
    `);

    const now = new Date();
    const employees = result.rows.map(e => {
      let urgency = null;
      if (e.contract_end_date) {
        const days = Math.round((new Date(e.contract_end_date) - now) / 86400000);
        if (days <= 30) urgency = 'critique';
        else if (days <= 60) urgency = 'attention';
      }
      return { ...e, urgency, has_pcm: e.has_pcm > 0, has_diagnostic: e.has_diagnostic > 0 };
    });

    console.log(`[INSERTION] GET / → ${employees.length} salaries actifs`);
    res.json(employees);
  } catch (err) {
    console.error('[INSERTION] Erreur liste :', err.message, err.detail || '');
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// JALONS INSERTION — Diagnostic accueil, M+3, M+6, M+10, Sortie
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/milestones/:employeeId — Tous les jalons d'un salarié
router.get('/milestones/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT im.*, u.first_name as interviewer_first, u.last_name as interviewer_last
       FROM insertion_milestones im
       LEFT JOIN users u ON im.interviewer_id = u.id
       WHERE im.employee_id = $1
       ORDER BY im.due_date`,
      [req.params.employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur milestones GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/milestones — Créer un jalon manuellement
router.post('/milestones', async (req, res) => {
  try {
    const { employee_id, milestone_type, due_date } = req.body;
    if (!employee_id || !milestone_type) return res.status(400).json({ error: 'employee_id et milestone_type requis' });

    const result = await pool.query(
      `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, milestone_type) DO UPDATE SET
         due_date = COALESCE($3, insertion_milestones.due_date),
         updated_at = NOW()
       RETURNING *`,
      [employee_id, milestone_type, due_date || new Date().toISOString().split('T')[0], req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur milestones POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/milestones/:id — Mettre a jour un jalon (entretien bilan)
router.put('/milestones/:id', async (req, res) => {
  try {
    const d = req.body;
    const result = await pool.query(
      `UPDATE insertion_milestones SET
        status = COALESCE($1, status),
        interview_date = COALESCE($2, interview_date),
        interviewer_id = COALESCE($3, interviewer_id),
        completed_date = COALESCE($4, completed_date),
        frein_mobilite = COALESCE($5, frein_mobilite),
        frein_sante = COALESCE($6, frein_sante),
        frein_finances = COALESCE($7, frein_finances),
        frein_famille = COALESCE($8, frein_famille),
        frein_linguistique = COALESCE($9, frein_linguistique),
        frein_administratif = COALESCE($10, frein_administratif),
        frein_numerique = COALESCE($11, frein_numerique),
        cip_integration = COALESCE($12, cip_integration),
        cip_competences = COALESCE($13, cip_competences),
        cip_projet_pro = COALESCE($14, cip_projet_pro),
        cip_socialisation = COALESCE($15, cip_socialisation),
        bilan_professionnel = COALESCE($16, bilan_professionnel),
        bilan_social = COALESCE($17, bilan_social),
        objectifs_realises = COALESCE($18, objectifs_realises),
        objectifs_prochaine_periode = COALESCE($19, objectifs_prochaine_periode),
        observations = COALESCE($20, observations),
        actions_a_mener = COALESCE($21, actions_a_mener),
        avis_global = COALESCE($22, avis_global),
        sortie_classification = COALESCE($23, sortie_classification),
        sortie_type = COALESCE($24, sortie_type),
        sortie_commentaires = COALESCE($25, sortie_commentaires),
        sortie_employeur = COALESCE($26, sortie_employeur),
        sortie_formation = COALESCE($27, sortie_formation),
        ai_recommendations = COALESCE($28, ai_recommendations),
        updated_at = NOW()
      WHERE id = $29 RETURNING *`,
      [
        d.status, d.interview_date, d.interviewer_id, d.completed_date,
        d.frein_mobilite, d.frein_sante, d.frein_finances, d.frein_famille,
        d.frein_linguistique, d.frein_administratif, d.frein_numerique,
        d.cip_integration, d.cip_competences, d.cip_projet_pro, d.cip_socialisation,
        d.bilan_professionnel, d.bilan_social,
        d.objectifs_realises, d.objectifs_prochaine_periode,
        d.observations, d.actions_a_mener, d.avis_global,
        d.sortie_classification, d.sortie_type, d.sortie_commentaires,
        d.sortie_employeur, d.sortie_formation,
        d.ai_recommendations ? JSON.stringify(d.ai_recommendations) : null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Jalon non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur milestones PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/milestones/:employeeId/radar — Données radar chart (évolution freins)
router.get('/milestones/:employeeId/radar', async (req, res) => {
  try {
    const empId = req.params.employeeId;

    // Diagnostic initial
    const diagRes = await pool.query(
      'SELECT frein_mobilite, frein_sante, frein_finances, frein_famille, frein_linguistique, frein_administratif FROM insertion_diagnostics WHERE employee_id = $1',
      [empId]
    );

    // Jalons réalisés avec scores
    const milestonesRes = await pool.query(
      `SELECT milestone_type, completed_date,
        frein_mobilite, frein_sante, frein_finances, frein_famille, frein_linguistique, frein_administratif
       FROM insertion_milestones
       WHERE employee_id = $1 AND status = 'realise'
       AND frein_mobilite IS NOT NULL
       ORDER BY due_date`,
      [empId]
    );

    const axes = ['Mobilite', 'Sante', 'Finances', 'Famille', 'Langue', 'Administratif', 'Numerique'];
    const axeKeys = ['frein_mobilite', 'frein_sante', 'frein_finances', 'frein_famille', 'frein_linguistique', 'frein_administratif', 'frein_numerique'];

    const series = [];

    // Série initiale (diagnostic)
    if (diagRes.rows.length > 0) {
      const d = diagRes.rows[0];
      series.push({
        label: 'Diagnostic initial',
        data: axeKeys.map(k => d[k] || 1),
      });
    }

    // Séries jalons
    for (const ms of milestonesRes.rows) {
      series.push({
        label: ms.milestone_type,
        date: ms.completed_date,
        data: axeKeys.map(k => ms[k] || 1),
      });
    }

    res.json({ axes, series });
  } catch (err) {
    console.error('[INSERTION] Erreur radar :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/milestones-overview — Vue d'ensemble jalons (tous les employés en parcours)
router.get('/milestones-overview', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT im.*, e.first_name, e.last_name, e.insertion_start_date,
        u.first_name as interviewer_first, u.last_name as interviewer_last
      FROM insertion_milestones im
      JOIN employees e ON im.employee_id = e.id
      LEFT JOIN users u ON im.interviewer_id = u.id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
      ORDER BY im.due_date
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur milestones overview :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/interview-template/:milestoneType — Questionnaire CIP par jalon
router.get('/interview-template/:milestoneType', (req, res) => {
  const template = CIP_QUESTIONNAIRES[req.params.milestoneType];
  if (!template) return res.status(404).json({ error: 'Type de bilan inconnu' });
  res.json(template);
});

// POST /api/insertion/milestones/:employeeId/initialize — Creer tous les jalons d'un parcours
router.post('/milestones/:employeeId/initialize', async (req, res) => {
  try {
    const empId = req.params.employeeId;
    const emp = await pool.query('SELECT insertion_start_date FROM employees WHERE id = $1', [empId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employe non trouve' });

    const startDate = emp.rows[0].insertion_start_date || new Date().toISOString().split('T')[0];
    const milestonesDef = [
      { type: 'Diagnostic accueil', months: 1 },
      { type: 'Bilan M+3', months: 3 },
      { type: 'Bilan M+6', months: 6 },
      { type: 'Bilan M+10', months: 10 },
      { type: 'Bilan Sortie', months: 12 },
    ];

    const results = [];
    for (const ms of milestonesDef) {
      const dueDate = addMonths(startDate, ms.months);
      const result = await pool.query(
        `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id, milestone_type) DO UPDATE SET
           due_date = COALESCE(NULLIF(insertion_milestones.due_date::text, ''), $3::date),
           updated_at = NOW()
         RETURNING *`,
        [empId, ms.type, dueDate, req.user.id]
      );
      results.push(result.rows[0]);
    }

    res.status(201).json(results);
  } catch (err) {
    console.error('[INSERTION] Erreur initialize milestones :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// PLAN D'ACTION CIP
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/action-plans/:employeeId — Tous les plans d'action
router.get('/action-plans/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ap.*, im.milestone_type
       FROM cip_action_plans ap
       JOIN insertion_milestones im ON ap.milestone_id = im.id
       WHERE ap.employee_id = $1
       ORDER BY ap.priority DESC, ap.created_at`,
      [req.params.employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/action-plans — Creer une action
router.post('/action-plans', async (req, res) => {
  try {
    const { milestone_id, employee_id, action_label, category, frein_type, priority, echeance, notes } = req.body;
    if (!milestone_id || !employee_id || !action_label || !category) {
      return res.status(400).json({ error: 'milestone_id, employee_id, action_label et category requis' });
    }
    const result = await pool.query(
      `INSERT INTO cip_action_plans (milestone_id, employee_id, action_label, category, frein_type, priority, echeance, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [milestone_id, employee_id, action_label, category, frein_type || null, priority || 'moyenne', echeance || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/action-plans/:id — Mettre a jour une action
router.put('/action-plans/:id', async (req, res) => {
  try {
    const d = req.body;
    const result = await pool.query(
      `UPDATE cip_action_plans SET
        action_label = COALESCE($1, action_label),
        status = COALESCE($2, status),
        priority = COALESCE($3, priority),
        echeance = COALESCE($4, echeance),
        notes = COALESCE($5, notes),
        updated_at = NOW()
      WHERE id = $6 RETURNING *`,
      [d.action_label, d.status, d.priority, d.echeance, d.notes, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Action non trouvee' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/insertion/action-plans/:id
router.delete('/action-plans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM cip_action_plans WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/timeline/:employeeId — Timeline du parcours
router.get('/timeline/:employeeId', async (req, res) => {
  try {
    const empId = req.params.employeeId;
    const empRes = await pool.query(
      'SELECT e.*, ec.start_date, ec.end_date, ec.contract_type FROM employees e LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true WHERE e.id = $1',
      [empId]
    );
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Employe non trouve' });

    const msRes = await pool.query('SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date', [empId]);
    let diagnostic = null;
    try {
      const diagRes = await pool.query('SELECT created_at FROM insertion_diagnostics WHERE employee_id = $1', [empId]);
      diagnostic = diagRes.rows[0] || null;
    } catch {}

    const timeline = buildTimeline(empRes.rows[0], [empRes.rows[0]], msRes.rows, diagnostic);
    res.json(timeline);
  } catch (err) {
    console.error('[INSERTION] Erreur timeline :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
