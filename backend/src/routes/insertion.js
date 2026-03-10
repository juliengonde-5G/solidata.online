const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const CryptoJS = require('crypto-js');

router.use(authenticate, authorize('ADMIN', 'RH', 'MANAGER'));

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
    label: 'Mobilité',
    icon: 'car',
    question_simple: 'Comment venez-vous au travail ?',
    niveaux: {
      1: 'Pas de difficulté, transport autonome',
      2: 'Léger, transports en commun accessibles',
      3: 'Modéré, dépendance à un tiers ou transports limités',
      4: 'Important, zone mal desservie ou pas de permis nécessaire',
      5: 'Bloquant, aucun moyen de déplacement fiable',
    },
    actions_levee: [
      'Aide au passage du permis B (financement via plan d\'insertion)',
      'Information sur les transports en commun et itinéraires',
      'Mise en relation avec des solutions de covoiturage',
      'Aide à l\'achat / location de vélo ou trottinette',
      'Rapprochement du lieu de travail si possible',
    ],
  },
  sante: {
    label: 'Santé',
    icon: 'heart',
    question_simple: 'Comment vous sentez-vous physiquement pour travailler ?',
    niveaux: {
      1: 'Bonne santé, pas de limitation',
      2: 'Léger, petits soucis gérables',
      3: 'Modéré, suivi médical en cours',
      4: 'Important, limitations physiques ou psychologiques',
      5: 'Bloquant, incapacité partielle ou arrêts fréquents',
    },
    actions_levee: [
      'Orientation vers le médecin du travail',
      'Aménagement du poste (ergonomie, rythme)',
      'Mise en relation avec un accompagnement psychologique',
      'Dossier RQTH si adapté',
      'Réduction ou adaptation des horaires',
    ],
  },
  finances: {
    label: 'Finances',
    icon: 'wallet',
    question_simple: 'Arrivez-vous à couvrir vos dépenses courantes ?',
    niveaux: {
      1: 'Situation stable',
      2: 'Léger, fin de mois un peu juste',
      3: 'Modéré, difficultés ponctuelles',
      4: 'Important, endettement ou impayés',
      5: 'Bloquant, situation de précarité aiguë',
    },
    actions_levee: [
      'Orientation vers l\'assistant(e) social(e)',
      'Aide aux démarches d\'accès aux droits (CAF, APL, prime d\'activité)',
      'Accompagnement à la gestion budgétaire',
      'Aide d\'urgence (épicerie sociale, aide alimentaire)',
      'Signalement au référent RSA si applicable',
    ],
  },
  famille: {
    label: 'Famille',
    icon: 'family',
    question_simple: 'Avez-vous des contraintes familiales pour vos horaires ?',
    niveaux: {
      1: 'Pas de contrainte',
      2: 'Léger, organisation familiale stable',
      3: 'Modéré, garde d\'enfants à organiser',
      4: 'Important, parent isolé ou personne à charge',
      5: 'Bloquant, situation familiale empêchant la disponibilité',
    },
    actions_levee: [
      'Aménagement des horaires (compatible crèche / école)',
      'Aide à la recherche de mode de garde',
      'Orientation vers des dispositifs d\'aide aux parents isolés',
      'Adaptation du contrat (temps partiel choisi)',
      'Mise en relation avec les services sociaux',
    ],
  },
  linguistique: {
    label: 'Langue',
    icon: 'language',
    question_simple: 'Comprenez-vous bien le français au travail ?',
    niveaux: {
      1: 'Maîtrise courante',
      2: 'Bon niveau oral, écrit fragile',
      3: 'Compréhension correcte, expression limitée',
      4: 'Difficultés importantes à l\'oral et à l\'écrit',
      5: 'Barrière linguistique forte, nécessite un interprète',
    },
    actions_levee: [
      'Orientation vers des cours de FLE (Français Langue Étrangère)',
      'Supports visuels et pictogrammes sur le poste',
      'Binômage avec un collègue parlant la même langue',
      'Ateliers sociolinguistiques (ASL)',
      'Adaptation des consignes (oral, démonstration)',
    ],
  },
  administratif: {
    label: 'Administratif',
    icon: 'file',
    question_simple: 'Vos papiers et démarches sont-ils à jour ?',
    niveaux: {
      1: 'Tout est en règle',
      2: 'Léger, quelques démarches en cours',
      3: 'Modéré, aide nécessaire pour certaines démarches',
      4: 'Important, situation administrative complexe',
      5: 'Bloquant, titre de séjour en cours / problème majeur',
    },
    actions_levee: [
      'Orientation vers le référent socio-professionnel',
      'Aide aux démarches administratives (CPAM, CAF, Pôle Emploi)',
      'Accompagnement pour le renouvellement de titre de séjour',
      'Aide à la constitution de dossiers',
      'Mise en relation avec un écrivain public ou association d\'aide',
    ],
  },
  numerique: {
    label: 'Numérique',
    icon: 'computer',
    question_simple: 'Utilisez-vous un téléphone ou un ordinateur facilement ?',
    niveaux: {
      1: 'À l\'aise avec le numérique',
      2: 'Basique, sait utiliser un téléphone et les messages',
      3: 'Modéré, besoin d\'aide pour certaines tâches',
      4: 'Important, très peu à l\'aise',
      5: 'Bloquant, pas d\'accès ou pas de compétences numériques',
    },
    actions_levee: [
      'Ateliers d\'initiation numérique',
      'Aide à la création d\'adresse email et espace France Connect',
      'Accompagnement individuel pour les démarches en ligne',
      'Prêt ou aide à l\'acquisition d\'un smartphone',
      'Fiche réflexe avec les manipulations de base',
    ],
  },
};

// ══════════════════════════════════════════════════════════════
// MOTEUR D'ANALYSE — Profil PCM simplifié depuis questionnaire
// ══════════════════════════════════════════════════════════════

function detectPCMFromQuestionnaire(diagnostic) {
  const scores = {};
  Object.keys(PCM_KNOWLEDGE).forEach(k => { scores[k] = 0; });

  // Combiner toutes les réponses textuelles
  const responses = [
    diagnostic.pcm_q_travail_ideal,
    diagnostic.pcm_q_reaction_stress,
    diagnostic.pcm_q_relation_equipe,
    diagnostic.pcm_q_motivation,
    diagnostic.pcm_q_apprentissage,
    diagnostic.pcm_q_communication,
  ].filter(Boolean).join(' ').toLowerCase();

  if (!responses) return null;

  // Score par mots-clés
  for (const [type, data] of Object.entries(PCM_KNOWLEDGE)) {
    for (const mot of data.mots_cles_detection) {
      const regex = new RegExp(mot, 'gi');
      const matches = responses.match(regex);
      if (matches) scores[type] += matches.length;
    }
  }

  // Normaliser en FAIBLE / MODÉRÉ / FORT
  const maxScore = Math.max(...Object.values(scores), 1);
  const result = {};
  for (const [type, score] of Object.entries(scores)) {
    const ratio = score / maxScore;
    result[type] = {
      score,
      niveau: ratio >= 0.6 ? 'FORT' : ratio >= 0.3 ? 'MODÉRÉ' : 'FAIBLE',
      label: PCM_KNOWLEDGE[type].nom,
      description: PCM_KNOWLEDGE[type].niveau_label,
    };
  }

  return result;
}

// ══════════════════════════════════════════════════════════════
// MOTEUR — Analyse complète d'insertion
// ══════════════════════════════════════════════════════════════

function analyzeInsertion(employee, contracts, candidate, pcmReport, teamMembers, position, diagnostic) {
  const pcm = pcmReport ? JSON.parse(pcmReport) : null;
  const baseType = pcm?.base?.type?.toLowerCase();
  const pcmKnowledge = baseType ? PCM_KNOWLEDGE[baseType] : null;
  const currentContract = contracts.find(c => c.is_current) || contracts[0];
  const positionName = position?.title || employee.position || 'Non défini';

  // Détecter PCM depuis questionnaire si pas de rapport officiel
  const pcmFromQuestionnaire = diagnostic ? detectPCMFromQuestionnaire(diagnostic) : null;
  const dominantPCM = pcmKnowledge || getDominantPCM(pcmFromQuestionnaire);

  // ═══════════════════════════════════════
  // 1) FICHE SYNTHÈSE PROFIL
  // ═══════════════════════════════════════
  const ficheSynthese = buildFicheSynthese(employee, dominantPCM, candidate, diagnostic, currentContract);

  // ═══════════════════════════════════════
  // 2) PROFIL PCM SIMPLIFIÉ
  // ═══════════════════════════════════════
  const profilPCM = pcmFromQuestionnaire || buildPCMFromReport(pcm);

  // ═══════════════════════════════════════
  // 3) CARTOGRAPHIE DES COMPÉTENCES
  // ═══════════════════════════════════════
  const competences = buildCompetences(employee, candidate, diagnostic, dominantPCM);

  // ═══════════════════════════════════════
  // 4) PISTES DE MÉTIERS
  // ═══════════════════════════════════════
  const pistesMetiers = buildPistesMetiers(employee, dominantPCM, diagnostic, candidate);

  // ═══════════════════════════════════════
  // 5) PARCOURS DE DÉVELOPPEMENT
  // ═══════════════════════════════════════
  const parcoursDev = buildParcoursDev(employee, contracts, dominantPCM, diagnostic, pistesMetiers);

  // ═══════════════════════════════════════
  // 6) RECOMMANDATIONS CIP
  // ═══════════════════════════════════════
  const recommandationsCIP = buildRecommandationsCIP(dominantPCM, diagnostic, candidate);

  // ═══════════════════════════════════════
  // DIAGNOSTIC FREINS SOCIAUX
  // ═══════════════════════════════════════
  const freinsSociaux = diagnostic ? buildFreinsSociaux(diagnostic) : null;

  // Score de confiance
  let dataPoints = 0;
  if (pcm || pcmFromQuestionnaire) dataPoints += 3;
  if (candidate?.cv_raw_text) dataPoints += 2;
  if (candidate?.interview_comment) dataPoints += 2;
  if (candidate?.practical_test_result) dataPoints += 1;
  if (diagnostic) dataPoints += 2;
  if (teamMembers.length > 0) dataPoints += 1;

  // Sources de donnees utilisees pour l'analyse
  const data_sources = {
    pcm: { available: !!(pcm || pcmFromQuestionnaire), label: 'Profil PCM', detail: pcm ? `Type ${pcmKnowledge?.nom || 'detecte'}` : pcmFromQuestionnaire ? 'Questionnaire CIP' : null },
    cv: { available: !!candidate?.cv_raw_text, label: 'CV', detail: candidate?.cv_raw_text ? `${extractSkillsFromCV(candidate.cv_raw_text).length} competences detectees` : null },
    interview: { available: !!(candidate?.interview_comment), label: 'Entretien', detail: candidate?.interviewer_name ? `Par ${candidate.interviewer_name}` : candidate?.interview_comment ? 'Commentaire disponible' : null },
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
    data_sources,
    // Retrocompatibilite
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

    // Score basé sur les intérêts Explorama
    if (diagnostic?.explorama_interets) {
      const interets = diagnostic.explorama_interets.toLowerCase();
      if (data.famille.toLowerCase().split(/[\s/]+/).some(f => interets.includes(f))) {
        score += 10;
      }
    }

    // Vérifier les contraintes vs freins
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
    const def = FREINS_DEFINITIONS[key];

    freins.push({
      type: key,
      label: def.label,
      icon: def.icon,
      niveau,
      niveau_label: def.niveaux[niveau],
      detail,
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

// PUT /api/insertion/diagnostic/:employeeId — Sauvegarder/mettre à jour le diagnostic
router.put('/diagnostic/:employeeId', async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const d = req.body;

    const result = await pool.query(`
      INSERT INTO insertion_diagnostics (
        employee_id, created_by, updated_by,
        parcours_anterieur, contraintes_sante, contraintes_mobilite, contraintes_familiales, autres_contraintes,
        frein_mobilite, frein_mobilite_detail,
        frein_sante, frein_sante_detail,
        frein_finances, frein_finances_detail,
        frein_famille, frein_famille_detail,
        frein_linguistique, frein_linguistique_detail,
        frein_administratif, frein_administratif_detail,
        frein_numerique, frein_numerique_detail,
        pcm_q_travail_ideal, pcm_q_reaction_stress, pcm_q_relation_equipe,
        pcm_q_motivation, pcm_q_apprentissage, pcm_q_communication,
        obs_taches_realisees, obs_points_forts, obs_difficultes,
        obs_comportement_equipe, obs_autonomie_ponctualite,
        pref_aime_faire, pref_ne_veut_plus, pref_environnement_prefere,
        pref_environnement_eviter, pref_objectifs,
        explorama_interets, explorama_rejets,
        cip_hypotheses_metiers, cip_questions
      ) VALUES (
        $1, $2, $2,
        $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26, $27,
        $28, $29, $30, $31, $32,
        $33, $34, $35, $36, $37,
        $38, $39, $40, $41
      )
      ON CONFLICT (employee_id) DO UPDATE SET
        updated_by = $2, updated_at = NOW(),
        parcours_anterieur = $3, contraintes_sante = $4, contraintes_mobilite = $5,
        contraintes_familiales = $6, autres_contraintes = $7,
        frein_mobilite = $8, frein_mobilite_detail = $9,
        frein_sante = $10, frein_sante_detail = $11,
        frein_finances = $12, frein_finances_detail = $13,
        frein_famille = $14, frein_famille_detail = $15,
        frein_linguistique = $16, frein_linguistique_detail = $17,
        frein_administratif = $18, frein_administratif_detail = $19,
        frein_numerique = $20, frein_numerique_detail = $21,
        pcm_q_travail_ideal = $22, pcm_q_reaction_stress = $23,
        pcm_q_relation_equipe = $24, pcm_q_motivation = $25,
        pcm_q_apprentissage = $26, pcm_q_communication = $27,
        obs_taches_realisees = $28, obs_points_forts = $29, obs_difficultes = $30,
        obs_comportement_equipe = $31, obs_autonomie_ponctualite = $32,
        pref_aime_faire = $33, pref_ne_veut_plus = $34,
        pref_environnement_prefere = $35, pref_environnement_eviter = $36,
        pref_objectifs = $37,
        explorama_interets = $38, explorama_rejets = $39,
        cip_hypotheses_metiers = $40, cip_questions = $41
      RETURNING *
    `, [
      empId, req.user.id,
      d.parcours_anterieur || null, d.contraintes_sante || null,
      d.contraintes_mobilite || null, d.contraintes_familiales || null,
      d.autres_contraintes || null,
      d.frein_mobilite || 1, d.frein_mobilite_detail || null,
      d.frein_sante || 1, d.frein_sante_detail || null,
      d.frein_finances || 1, d.frein_finances_detail || null,
      d.frein_famille || 1, d.frein_famille_detail || null,
      d.frein_linguistique || 1, d.frein_linguistique_detail || null,
      d.frein_administratif || 1, d.frein_administratif_detail || null,
      d.frein_numerique || 1, d.frein_numerique_detail || null,
      d.pcm_q_travail_ideal || null, d.pcm_q_reaction_stress || null,
      d.pcm_q_relation_equipe || null, d.pcm_q_motivation || null,
      d.pcm_q_apprentissage || null, d.pcm_q_communication || null,
      d.obs_taches_realisees || null, d.obs_points_forts || null,
      d.obs_difficultes || null, d.obs_comportement_equipe || null,
      d.obs_autonomie_ponctualite || null,
      d.pref_aime_faire || null, d.pref_ne_veut_plus || null,
      d.pref_environnement_prefere || null, d.pref_environnement_eviter || null,
      d.pref_objectifs || null,
      d.explorama_interets || null, d.explorama_rejets || null,
      d.cip_hypotheses_metiers || null, d.cip_questions || null,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur diagnostic PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
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
    const contractsRes = await pool.query(
      'SELECT ec.*, t.name as team_name, p.title as position_title FROM employee_contracts ec LEFT JOIN teams t ON ec.team_id = t.id LEFT JOIN positions p ON ec.position_id = p.id WHERE ec.employee_id = $1 ORDER BY ec.start_date DESC',
      [empId]
    );

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

    // 8. Analyse complète
    const analysis = analyzeInsertion(
      employee, contractsRes.rows, candidate, pcmReport,
      teamMembers, position, diagnostic
    );

    res.json({
      employee: {
        id: employee.id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        team_name: employee.team_name,
        position: employee.position,
        is_active: employee.is_active,
      },
      has_pcm: !!pcmReport,
      has_candidate_data: !!candidate,
      has_cv: !!candidate?.cv_raw_text,
      has_interview: !!candidate?.interview_comment,
      has_diagnostic: !!diagnostic,
      nb_contracts: contractsRes.rows.length,
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
    const result = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.is_active,
        t.name as team_name, e.position, e.contract_type, e.contract_start, e.contract_end,
        COALESCE((SELECT COUNT(*)::int FROM employee_contracts WHERE employee_id = e.id), 0) as nb_contracts,
        (SELECT ec.contract_type FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as current_contract_type,
        (SELECT ec.end_date FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as contract_end_date,
        CASE WHEN e.candidate_id IS NOT NULL THEN
          COALESCE((SELECT COUNT(*)::int FROM pcm_reports pr WHERE pr.candidate_id = e.candidate_id), 0)
        ELSE 0 END as has_pcm,
        COALESCE((SELECT COUNT(*)::int FROM insertion_diagnostics id WHERE id.employee_id = e.id), 0) as has_diagnostic
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

    res.json(employees);
  } catch (err) {
    console.error('[INSERTION] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
