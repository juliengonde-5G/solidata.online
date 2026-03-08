const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const CryptoJS = require('crypto-js');

router.use(authenticate, authorize('ADMIN', 'RH', 'MANAGER'));

// ══════════════════════════════════════════════════════════════
// BASE DE CONNAISSANCES — Adéquation PCM / Postes / Équipe
// ══════════════════════════════════════════════════════════════

const PCM_KNOWLEDGE = {
  analyseur: {
    nom: 'Analyseur',
    forces: ['Logique', 'Organisé', 'Responsable', 'Méthodique'],
    faiblesses_stress: ['Sur-détaille', 'Ne délègue pas', 'Sur-contrôle'],
    besoin: 'Reconnaissance du travail bien fait',
    canal: 'Interrogatif / Informatif',
    postes_ideaux: ['Opérateur de tri', 'Suiveur'],
    postes_compatibles: ['Opérateur Logistique'],
    postes_difficiles: ['Chauffeur'],
    environnement_ideal: 'Structuré, avec des procédures claires et un feedback régulier sur la qualité',
    risques_insertion: 'Peut se sentir submergé si les consignes sont floues. Besoin de comprendre le "pourquoi" des tâches.',
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
  },
  perseverant: {
    nom: 'Persévérant',
    forces: ['Engagé', 'Observateur', 'Consciencieux', 'Dévoué'],
    faiblesses_stress: ['Impose ses convictions', 'Méfiance', 'Rigidité'],
    besoin: 'Reconnaissance des opinions et engagement',
    canal: 'Interrogatif / Informatif',
    postes_ideaux: ['Suiveur', 'Opérateur de tri'],
    postes_compatibles: ['Chauffeur'],
    postes_difficiles: ['Opérateur Logistique'],
    environnement_ideal: 'Où ses valeurs sont respectées et son engagement reconnu',
    risques_insertion: 'Peut entrer en conflit si ses valeurs sont heurtées. Besoin de sens dans le travail.',
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
  },
  empathique: {
    nom: 'Empathique',
    forces: ['Chaleureux', 'Sensible', 'Compatissant', 'Attentionné'],
    faiblesses_stress: ['Sur-adaptation', 'Se sacrifie', 'Fait des erreurs par vouloir plaire'],
    besoin: 'Reconnaissance de la personne, ambiance chaleureuse',
    canal: 'Nourricier',
    postes_ideaux: ['Opérateur de tri', 'Opérateur Logistique'],
    postes_compatibles: ['Suiveur'],
    postes_difficiles: ['Chauffeur'],
    environnement_ideal: 'Équipe soudée, ambiance bienveillante, contact humain',
    risques_insertion: 'Peut se sur-adapter et ne pas exprimer ses difficultés. Risque d\'épuisement.',
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
  },
  imagineur: {
    nom: 'Imagineur',
    forces: ['Imaginatif', 'Réfléchi', 'Calme', 'Introspectif'],
    faiblesses_stress: ['Retrait', 'Passivité', 'Attend les consignes'],
    besoin: 'Solitude, temps calme pour réfléchir',
    canal: 'Directif',
    postes_ideaux: ['Opérateur de tri'],
    postes_compatibles: ['Opérateur Logistique'],
    postes_difficiles: ['Chauffeur', 'Suiveur'],
    environnement_ideal: 'Poste individuel, tâches bien définies, rythme régulier',
    risques_insertion: 'Peut se replier et ne rien demander. Besoin de consignes claires et directes.',
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
  },
  energiseur: {
    nom: 'Énergiseur',
    forces: ['Créatif', 'Spontané', 'Ludique', 'Dynamique'],
    faiblesses_stress: ['Blâme les autres', 'Provoque', 'Rejette la faute'],
    besoin: 'Contact ludique, stimulation, variété',
    canal: 'Ludique / Émotif',
    postes_ideaux: ['Chauffeur', 'Opérateur Logistique'],
    postes_compatibles: ['Opérateur de tri'],
    postes_difficiles: ['Suiveur'],
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
  },
  promoteur: {
    nom: 'Promoteur',
    forces: ['Adaptable', 'Charmeur', 'Débrouillard', 'Efficace'],
    faiblesses_stress: ['Manipulation', 'Prise de risques', 'Exploite les faiblesses'],
    besoin: 'Excitation, défis, résultats rapides',
    canal: 'Directif',
    postes_ideaux: ['Chauffeur', 'Opérateur Logistique'],
    postes_compatibles: ['Suiveur'],
    postes_difficiles: ['Opérateur de tri'],
    environnement_ideal: 'Autonome, orienté résultats, avec des défis concrets',
    risques_insertion: 'Peut manipuler ou prendre des raccourcis. Besoin de cadre ferme mais respectueux.',
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
  },
};

// Adéquation poste → profil PCM idéal
const POSTE_PROFILS = {
  'Opérateur de tri': {
    description: 'Tri des textiles par catégorie, travail en chaîne, attention au détail',
    profils_ideaux: ['analyseur', 'empathique', 'imagineur'],
    qualites_requises: ['Attention au détail', 'Rigueur', 'Régularité', 'Patience'],
    contraintes: ['Travail répétitif', 'Station debout', 'Rythme soutenu'],
    potentiel_evolution: 'Chef d\'équipe tri, Formateur, Référent qualité',
  },
  'Opérateur Logistique': {
    description: 'Gestion des flux entrants/sortants, manutention, organisation du stock',
    profils_ideaux: ['energiseur', 'promoteur', 'empathique'],
    qualites_requises: ['Organisation', 'Dynamisme', 'Force physique', 'Esprit d\'équipe'],
    contraintes: ['Port de charges', 'Travail physique', 'Gestion du stress'],
    potentiel_evolution: 'Responsable logistique, Chauffeur, Chef de quai',
  },
  'Chauffeur': {
    description: 'Collecte des textiles en tournée, conduite de véhicule, relation avec les partenaires',
    profils_ideaux: ['promoteur', 'energiseur', 'perseverant'],
    qualites_requises: ['Autonomie', 'Sens de l\'orientation', 'Permis B obligatoire', 'Ponctualité'],
    contraintes: ['Conduite longue durée', 'Autonomie totale', 'Horaires variables'],
    potentiel_evolution: 'Chauffeur PL, Responsable collecte, Coordinateur terrain',
  },
  'Suiveur': {
    description: 'Suivi administratif et qualité, reporting, interface entre équipes',
    profils_ideaux: ['analyseur', 'perseverant'],
    qualites_requises: ['Rigueur', 'Communication', 'Organisation', 'Suivi'],
    contraintes: ['Travail sur écran', 'Multitâche', 'Gestion de données'],
    potentiel_evolution: 'Responsable qualité, Coordinateur, Assistant de direction',
  },
};

// ══════════════════════════════════════════════════════════════
// MOTEUR D'ANALYSE — Parcours d'insertion
// ══════════════════════════════════════════════════════════════

function analyzeInsertion(employee, contracts, availability, candidate, pcmReport, teamMembers, position) {
  const analysis = {
    profil_synthese: null,
    adequation_poste: null,
    adequation_equipe: null,
    parcours_insertion: null,
    risques: [],
    recommandations: [],
    plan_action: [],
    score_global: 0,
    confiance: 0,
  };

  const pcm = pcmReport ? JSON.parse(pcmReport) : null;
  const baseType = pcm?.base?.type?.toLowerCase();
  const phaseType = pcm?.phase?.type?.toLowerCase();
  const pcmKnowledge = baseType ? PCM_KNOWLEDGE[baseType] : null;
  const currentContract = contracts.find(c => c.is_current) || contracts[0];
  const positionName = position?.title || employee.position || 'Non défini';
  const posteProfil = Object.entries(POSTE_PROFILS).find(([k]) =>
    positionName.toLowerCase().includes(k.toLowerCase())
  )?.[1];

  let dataPoints = 0;
  let totalScore = 0;

  // ── 1. SYNTHÈSE DU PROFIL ──
  const profilParts = [];

  if (pcmKnowledge) {
    profilParts.push(`**Type de base : ${pcmKnowledge.nom}** — ${pcmKnowledge.forces.join(', ')}.`);
    if (phaseType && phaseType !== baseType) {
      const phaseK = PCM_KNOWLEDGE[phaseType];
      profilParts.push(`Phase actuelle : ${phaseK?.nom || phaseType} — motivation actuelle orientée vers : ${phaseK?.besoin || 'non identifié'}.`);
    }
    profilParts.push(`Canal de communication privilégié : ${pcmKnowledge.canal}.`);
    profilParts.push(`Besoin psychologique principal : ${pcmKnowledge.besoin}.`);
    dataPoints += 3;
  }

  if (candidate?.cv_raw_text) {
    const skills = extractSkillsFromCV(candidate.cv_raw_text);
    if (skills.length > 0) {
      profilParts.push(`Compétences identifiées dans le CV : ${skills.join(', ')}.`);
    }
    dataPoints += 1;
  }

  if (candidate?.interview_comment) {
    profilParts.push(`Notes d'entretien : ${candidate.interview_comment}`);
    dataPoints += 1;
  }

  if (employee.has_permis_b) profilParts.push('Titulaire du Permis B.');
  if (employee.has_caces) profilParts.push('Titulaire du CACES.');

  analysis.profil_synthese = profilParts.length > 0
    ? profilParts.join('\n\n')
    : 'Données insuffisantes pour établir un profil complet. Nous recommandons de réaliser un test PCM et un entretien approfondi.';

  // ── 2. ADÉQUATION POSTE ──
  if (pcmKnowledge && posteProfil) {
    const isIdeal = posteProfil.profils_ideaux.includes(baseType);
    let posteScore = isIdeal ? 85 : 50;

    // Vérifier les qualités requises vs forces PCM
    const matchingQualities = posteProfil.qualites_requises.filter(q =>
      pcmKnowledge.forces.some(f => f.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes(f.toLowerCase()))
    );
    posteScore += matchingQualities.length * 5;

    // Vérifier si le poste est dans les "difficiles"
    if (pcmKnowledge.postes_difficiles.some(p => positionName.toLowerCase().includes(p.toLowerCase()))) {
      posteScore -= 20;
      analysis.risques.push({
        niveau: 'attention',
        titre: 'Adéquation poste limitée',
        detail: `Le profil ${pcmKnowledge.nom} n'est pas naturellement à l'aise dans ce type de poste. Un accompagnement renforcé est recommandé.`,
      });
    }

    // Permis B pour chauffeur
    if (positionName.toLowerCase().includes('chauffeur') && !employee.has_permis_b) {
      posteScore -= 30;
      analysis.risques.push({
        niveau: 'critique',
        titre: 'Permis B manquant',
        detail: 'Le poste de chauffeur nécessite le Permis B. Planifier le passage du permis en priorité.',
      });
    }

    posteScore = Math.min(100, Math.max(0, posteScore));
    totalScore += posteScore;
    dataPoints += 2;

    analysis.adequation_poste = {
      score: posteScore,
      niveau: posteScore >= 75 ? 'Bonne' : posteScore >= 50 ? 'Acceptable' : 'Faible',
      poste: positionName,
      description: posteProfil.description,
      qualites_matchees: matchingQualities,
      qualites_requises: posteProfil.qualites_requises,
      contraintes: posteProfil.contraintes,
      evolution: posteProfil.potentiel_evolution,
      commentaire: isIdeal
        ? `Le profil ${pcmKnowledge.nom} est particulièrement adapté à ce poste. Ses forces naturelles (${pcmKnowledge.forces.join(', ')}) correspondent aux exigences du poste.`
        : `Le profil ${pcmKnowledge.nom} peut occuper ce poste avec un accompagnement adapté. Attention particulière aux contraintes : ${posteProfil.contraintes.join(', ')}.`,
    };
  } else {
    analysis.adequation_poste = {
      score: null,
      niveau: 'Non évaluable',
      commentaire: !pcmKnowledge
        ? 'Test PCM non réalisé. L\'évaluation de l\'adéquation poste/personne nécessite le profil de personnalité.'
        : 'Poste non référencé dans la base de connaissances.',
    };
  }

  // ── 3. ADÉQUATION ÉQUIPE ──
  if (pcmKnowledge && teamMembers.length > 0) {
    const teamPcmTypes = teamMembers
      .filter(m => m.pcm_base_type && m.id !== employee.id)
      .map(m => m.pcm_base_type.toLowerCase());

    if (teamPcmTypes.length > 0) {
      let compatScore = 0;
      let nbRelations = 0;

      for (const memberType of teamPcmTypes) {
        const compat = pcmKnowledge.compatibilites[memberType];
        if (compat === 'haute') compatScore += 3;
        else if (compat === 'moyenne') compatScore += 2;
        else if (compat === 'basse') compatScore += 1;
        nbRelations++;
      }

      const avgCompat = nbRelations > 0 ? (compatScore / nbRelations / 3) * 100 : 50;
      totalScore += avgCompat;
      dataPoints += 1;

      const incompatibles = teamPcmTypes.filter(t => pcmKnowledge.compatibilites[t] === 'basse');
      if (incompatibles.length > 0) {
        const uniqueIncompat = [...new Set(incompatibles)].map(t => PCM_KNOWLEDGE[t]?.nom || t);
        analysis.risques.push({
          niveau: 'attention',
          titre: 'Tensions potentielles en équipe',
          detail: `Compatibilité limitée avec les profils ${uniqueIncompat.join(', ')} présents dans l'équipe. Prévoir un accompagnement pour faciliter la communication.`,
        });
      }

      analysis.adequation_equipe = {
        score: Math.round(avgCompat),
        niveau: avgCompat >= 70 ? 'Bonne' : avgCompat >= 45 ? 'Acceptable' : 'Difficile',
        nb_collegues_analyses: teamPcmTypes.length,
        commentaire: avgCompat >= 70
          ? `Bonne intégration potentielle dans l'équipe. Le profil ${pcmKnowledge.nom} est complémentaire avec les profils présents.`
          : avgCompat >= 45
          ? `Intégration possible avec un accompagnement. Certaines personnalités de l'équipe nécessiteront une communication adaptée.`
          : `Intégration délicate. Le profil ${pcmKnowledge.nom} peut rencontrer des frictions avec plusieurs membres de l'équipe. Un suivi rapproché est indispensable.`,
      };
    } else {
      analysis.adequation_equipe = {
        score: null,
        niveau: 'Non évaluable',
        commentaire: 'Les profils PCM des membres de l\'équipe ne sont pas disponibles.',
      };
    }
  }

  // ── 4. PARCOURS D'INSERTION ──
  const parcours = [];
  const contractCount = contracts.length;
  const totalMonths = contracts.reduce((s, c) => s + (c.duration_months || 0), 0);
  const isFirstContract = contractCount <= 1;

  // Phase actuelle
  if (isFirstContract && currentContract) {
    const startDate = new Date(currentContract.start_date);
    const now = new Date();
    const monthsIn = Math.round((now - startDate) / (30.44 * 86400000));

    if (monthsIn <= 1) {
      parcours.push({
        phase: 'Intégration',
        statut: 'en_cours',
        description: 'Période d\'accueil et de découverte. Accompagnement rapproché nécessaire.',
        actions: [
          'Désigner un tuteur/parrain dans l\'équipe',
          'Présenter les règles de vie collective et le fonctionnement',
          pcmKnowledge ? `Adapter la communication au canal ${pcmKnowledge.canal}` : 'Identifier le style de communication',
          'Fixer des objectifs simples et atteignables la 1ère semaine',
        ],
      });
    } else if (monthsIn <= 3) {
      parcours.push({
        phase: 'Montée en compétences',
        statut: 'en_cours',
        description: 'Apprentissage du métier et renforcement de l\'autonomie.',
        actions: [
          'Évaluer les progrès techniques',
          'Identifier les besoins de formation complémentaire',
          pcmKnowledge ? `Nourrir le besoin : ${pcmKnowledge.besoin}` : 'Observer et identifier les besoins de motivation',
          'Commencer à travailler le projet professionnel',
        ],
      });
    } else {
      parcours.push({
        phase: 'Consolidation',
        statut: 'en_cours',
        description: 'Consolidation des acquis et préparation de la suite.',
        actions: [
          'Bilan de compétences informel',
          'Travailler le CV et les techniques d\'entretien',
          'Explorer les pistes de sortie positive (formation qualifiante, CDI externe)',
          'Mettre en avant les réussites dans le parcours',
        ],
      });
    }
  } else if (contractCount > 1) {
    parcours.push({
      phase: 'Renouvellement',
      statut: 'en_cours',
      description: `${contractCount}ème contrat (${totalMonths} mois cumulés). Focus sur l'autonomie et la projection vers l'emploi pérenne.`,
      actions: [
        'Faire le bilan du parcours global',
        'Définir un objectif de sortie à 6 mois',
        'Intensifier les ateliers de recherche d\'emploi',
        'Valider les compétences acquises (attestation, certification)',
      ],
    });
  }

  // Phases futures recommandées
  parcours.push({
    phase: 'Formation & Qualification',
    statut: 'a_planifier',
    description: 'Développer les compétences transférables pour l\'employabilité future.',
    actions: pcmKnowledge
      ? pcmKnowledge.axes_developpement.concat([
          `Formation : ${posteProfil?.potentiel_evolution || 'compétences métier'}`,
        ])
      : ['Identifier les axes de développement personnels', 'Planifier des formations adaptées'],
  });

  parcours.push({
    phase: 'Sortie positive',
    statut: 'objectif',
    description: 'Accès à un emploi pérenne ou une formation qualifiante.',
    actions: [
      'Accompagnement à la rédaction du CV',
      'Préparation aux entretiens d\'embauche',
      'Mise en relation avec des employeurs partenaires',
      'Suivi post-insertion pendant 6 mois',
    ],
  });

  analysis.parcours_insertion = parcours;

  // ── 5. RECOMMANDATIONS MANAGÉRIALES ──
  if (pcmKnowledge) {
    analysis.recommandations = [
      {
        titre: 'Communication',
        detail: `Privilégier le canal ${pcmKnowledge.canal}. ${pcmKnowledge.conseils_manager[0]}`,
      },
      {
        titre: 'Motivation',
        detail: `Nourrir le besoin principal : ${pcmKnowledge.besoin}. ${pcmKnowledge.conseils_manager[1]}`,
      },
      {
        titre: 'Environnement',
        detail: `Environnement idéal : ${pcmKnowledge.environnement_ideal}`,
      },
      {
        titre: 'Vigilance stress',
        detail: `En situation de stress, ${pcmKnowledge.nom} peut : ${pcmKnowledge.faiblesses_stress.join(', ')}. ${pcmKnowledge.conseils_manager[2]}`,
      },
    ];
  }

  // ── 6. PLAN D'ACTION ──
  const actions = [];

  if (!pcm) {
    actions.push({
      priorite: 'haute',
      action: 'Réaliser le test PCM',
      detail: 'Le profil de personnalité est essentiel pour personnaliser l\'accompagnement.',
      echeance: 'Semaine 1',
    });
  }

  if (isFirstContract) {
    actions.push({
      priorite: 'haute',
      action: 'Entretien de suivi à 1 mois',
      detail: 'Évaluer l\'intégration, identifier les difficultés, ajuster l\'accompagnement.',
      echeance: '1 mois',
    });
  }

  if (pcmKnowledge) {
    actions.push({
      priorite: 'moyenne',
      action: `Former le manager au canal ${pcmKnowledge.canal}`,
      detail: `Adapter la communication pour maximiser la collaboration avec ce profil ${pcmKnowledge.nom}.`,
      echeance: '2 semaines',
    });
  }

  if (currentContract?.contract_type === 'CDD') {
    const endDate = currentContract.end_date ? new Date(currentContract.end_date) : null;
    const now = new Date();
    if (endDate) {
      const daysLeft = Math.round((endDate - now) / 86400000);
      if (daysLeft <= 60) {
        actions.push({
          priorite: 'haute',
          action: 'Préparer la suite du parcours',
          detail: `Le contrat se termine dans ${daysLeft} jours. Décider : renouvellement, CDI insertion, ou sortie accompagnée.`,
          echeance: `${daysLeft} jours`,
        });
      }
    }
  }

  actions.push({
    priorite: 'normale',
    action: 'Bilan de compétences trimestriel',
    detail: 'Évaluer les progrès, ajuster le plan de formation, nourrir la dynamique d\'insertion.',
    echeance: 'Trimestriel',
  });

  analysis.plan_action = actions;

  // ── 7. SCORE GLOBAL ──
  analysis.confiance = Math.min(1, dataPoints / 6);
  analysis.score_global = dataPoints > 0 ? Math.round(totalScore / Math.max(1, Math.floor(dataPoints / 2))) : null;

  return analysis;
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
    /électricité/gi, /plomberie/gi, /peinture/gi, /soudure/gi,
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

    // 3. Disponibilité
    const availRes = await pool.query(
      'SELECT day_off FROM employee_availability WHERE employee_id = $1',
      [empId]
    );

    // 4. Chercher le candidat correspondant (par nom)
    let candidate = null;
    try {
      const candRes = await pool.query(
        'SELECT * FROM candidates WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) ORDER BY created_at DESC LIMIT 1',
        [employee.first_name, employee.last_name]
      );
      candidate = candRes.rows[0] || null;
    } catch { /* table might not exist */ }

    // 5. Rapport PCM (via le candidat)
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

    // 6. Membres de l'équipe (pour analyse dynamique)
    let teamMembers = [];
    if (employee.team_id) {
      try {
        const teamRes = await pool.query(`
          SELECT e.id, e.first_name, e.last_name,
            (SELECT pr.encrypted_report FROM pcm_reports pr
             JOIN candidates c ON pr.candidate_id = c.id
             WHERE LOWER(c.first_name) = LOWER(e.first_name) AND LOWER(c.last_name) = LOWER(e.last_name)
             ORDER BY pr.created_at DESC LIMIT 1) as pcm_encrypted
          FROM employees e WHERE e.team_id = $1 AND e.is_active = true
        `, [employee.team_id]);

        teamMembers = teamRes.rows.map(m => {
          let pcm_base_type = null;
          if (m.pcm_encrypted) {
            try {
              const bytes = CryptoJS.AES.decrypt(m.pcm_encrypted, PCM_KEY);
              const data = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
              pcm_base_type = data.base?.type || null;
            } catch { /* ignore */ }
          }
          return { id: m.id, first_name: m.first_name, last_name: m.last_name, pcm_base_type };
        });
      } catch { /* ignore */ }
    }

    // 7. Position
    let position = null;
    const currentContract = contractsRes.rows.find(c => c.is_current);
    if (currentContract?.position_id) {
      try {
        const posRes = await pool.query('SELECT * FROM positions WHERE id = $1', [currentContract.position_id]);
        position = posRes.rows[0] || null;
      } catch { /* ignore */ }
    }

    // 8. Analyse
    const analysis = analyzeInsertion(
      employee,
      contractsRes.rows,
      availRes.rows.map(r => r.day_off),
      candidate,
      pcmReport,
      teamMembers,
      position
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
        t.name as team_name, e.position,
        (SELECT COUNT(*)::int FROM employee_contracts WHERE employee_id = e.id) as nb_contracts,
        (SELECT ec.contract_type FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as current_contract_type,
        (SELECT ec.end_date FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as contract_end_date,
        (SELECT COUNT(*)::int FROM pcm_reports pr JOIN candidates c ON pr.candidate_id = c.id
         WHERE LOWER(c.first_name) = LOWER(e.first_name) AND LOWER(c.last_name) = LOWER(e.last_name)) as has_pcm
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE e.is_active = true
      ORDER BY e.last_name, e.first_name
    `);

    // Flag les urgences (fin de contrat proche)
    const now = new Date();
    const employees = result.rows.map(e => {
      let urgency = null;
      if (e.contract_end_date) {
        const days = Math.round((new Date(e.contract_end_date) - now) / 86400000);
        if (days <= 30) urgency = 'critique';
        else if (days <= 60) urgency = 'attention';
      }
      return { ...e, urgency, has_pcm: e.has_pcm > 0 };
    });

    res.json(employees);
  } catch (err) {
    console.error('[INSERTION] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
