/**
 * Moteur d'insertion — Base de connaissances, questionnaires, analyse IA
 * Extrait de insertion.js monolithique pour maintenabilité
 */
const CryptoJS = require('crypto-js');

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


module.exports = {
  PCM_KNOWLEDGE,
  METIERS_CIBLES,
  FREINS_DEFINITIONS,
  CIP_QUESTIONNAIRES,
  analyzeInsertion,
  buildAIRecommendations,
  buildTimeline,
};
