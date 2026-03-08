const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const CryptoJS = require('crypto-js');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════
// MOTEUR PCM (Process Communication Model) — Kahler 2024
// 6 types de personnalité : Analyseur, Persévérant, Empathique,
// Imagineur, Énergiseur, Promoteur
// ══════════════════════════════════════════════════════════════

const PCM_TYPES = {
  analyseur: {
    nom: 'Analyseur',
    ancienNom: 'Travaillomane',
    perception: 'Pensées factuelles',
    canal: 'Interrogatif / Informatif',
    pointsForts: ['Responsable', 'Logique', 'Organisé'],
    besoinPsychologique: 'Reconnaissance du travail',
    driverPrincipal: 'Sois parfait',
    masqueStress: ['Sur-détaille', 'Ne délègue pas', 'Sur-contrôle'],
    stressNiveaux: [
      { niveau: 1, comportement: 'Attend la perfection de soi et des autres, sur-détaille' },
      { niveau: 2, comportement: 'Frustré, critique, ne délègue pas, fait tout soi-même' },
      { niveau: 3, comportement: 'Rejet des autres, dépression, sentiment d\'incompétence' },
    ],
    guideManager: {
      do: ['Donner des informations factuelles', 'Reconnaître la qualité du travail', 'Structurer les tâches clairement', 'Respecter les délais et processus'],
      dont: ['Être flou ou approximatif', 'Négliger les détails', 'Imposer sans expliquer', 'Changer les règles sans préavis'],
    },
    environnement: 'Bureau organisé, tâches structurées, délais clairs',
    correspondanceTP: 'Consciencieux (Big Five), ISTJ/INTJ (MBTI)',
  },
  perseverant: {
    nom: 'Persévérant',
    ancienNom: 'Persévérant',
    perception: 'Opinions',
    canal: 'Interrogatif / Informatif',
    pointsForts: ['Engagé', 'Observateur', 'Consciencieux'],
    besoinPsychologique: 'Reconnaissance des opinions et convictions',
    driverPrincipal: 'Sois parfait pour les autres',
    masqueStress: ['Croisade', 'Imposer ses convictions', 'Méfiance'],
    stressNiveaux: [
      { niveau: 1, comportement: 'Impose son point de vue, attend que les autres partagent ses valeurs' },
      { niveau: 2, comportement: 'Part en croisade, ne lâche pas, moralisateur' },
      { niveau: 3, comportement: 'Paranoïa, méfiance généralisée, rigidité extrême' },
    ],
    guideManager: {
      do: ['Demander leur avis', 'Reconnaître leur engagement', 'Écouter leurs opinions', 'Donner du sens aux missions'],
      dont: ['Ignorer leurs convictions', 'Remettre en question leur intégrité', 'Être superficiel', 'Manquer de cohérence'],
    },
    environnement: 'Mission porteuse de sens, espace pour s\'exprimer',
    correspondanceTP: 'Agréabilité faible + Consciencieux (Big Five), INFJ/ENFJ (MBTI)',
  },
  empathique: {
    nom: 'Empathique',
    ancienNom: 'Empathique',
    perception: 'Émotions',
    canal: 'Nourricier',
    pointsForts: ['Chaleureux', 'Sensible', 'Compatissant'],
    besoinPsychologique: 'Reconnaissance de la personne, besoins sensoriels',
    driverPrincipal: 'Fais plaisir',
    masqueStress: ['Sur-adaptation', 'Se sacrifie', 'Fait des erreurs'],
    stressNiveaux: [
      { niveau: 1, comportement: 'Sur-adapté, dit oui à tout, manque d\'affirmation' },
      { niveau: 2, comportement: 'Se sacrifie, ne prend plus soin de soi, erreurs inhabituelles' },
      { niveau: 3, comportement: 'Se sent victime, rejet de soi, auto-sabotage' },
    ],
    guideManager: {
      do: ['Accueillir chaleureusement', 'Reconnaître la personne (pas juste le travail)', 'Créer un environnement agréable', 'Prendre des nouvelles personnelles'],
      dont: ['Être froid ou distant', 'Critiquer sans bienveillance', 'Ignorer les émotions', 'Négliger l\'ambiance'],
    },
    environnement: 'Cadre chaleureux, relations harmonieuses, feedback positif',
    correspondanceTP: 'Agréabilité haute (Big Five), ISFJ/ESFJ (MBTI)',
  },
  imagineur: {
    nom: 'Imagineur',
    ancienNom: 'Rêveur',
    perception: 'Imagination (Inactions)',
    canal: 'Directif',
    pointsForts: ['Imaginatif', 'Réfléchi', 'Calme'],
    besoinPsychologique: 'Solitude, temps pour soi',
    driverPrincipal: 'Sois fort (pour toi)',
    masqueStress: ['Retrait', 'Passivité', 'Attend qu\'on lui dise'],
    stressNiveaux: [
      { niveau: 1, comportement: 'Se retire, attend passivement, retrait dans l\'imaginaire' },
      { niveau: 2, comportement: 'Passivité totale, incapable de prendre des initiatives' },
      { niveau: 3, comportement: 'Retrait complet, sentiment d\'inutilité, exclusion' },
    ],
    guideManager: {
      do: ['Donner des directives claires et précises', 'Laisser du temps de réflexion', 'Respecter le besoin de solitude', 'Découper les tâches en étapes'],
      dont: ['Mettre sous pression temporelle', 'Demander de l\'improvisation', 'Forcer les interactions sociales', 'Attendre de l\'initiative spontanée'],
    },
    environnement: 'Calme, peu de sollicitations, instructions claires',
    correspondanceTP: 'Introversion haute (Big Five), INTP/INFP (MBTI)',
  },
  energiseur: {
    nom: 'Énergiseur',
    ancienNom: 'Rebelle',
    perception: 'Réactions (J\'aime / J\'aime pas)',
    canal: 'Ludique / Émotif',
    pointsForts: ['Créatif', 'Spontané', 'Ludique'],
    besoinPsychologique: 'Contact ludique, stimulation',
    driverPrincipal: 'Fais effort',
    masqueStress: ['Blâme', 'Rejette la faute', 'Provoque'],
    stressNiveaux: [
      { niveau: 1, comportement: 'Râle, se plaint, \"c\'est nul\", \"j\'y comprends rien\"' },
      { niveau: 2, comportement: 'Blâme les autres, rejette la responsabilité, provocateur' },
      { niveau: 3, comportement: 'Vengeur, destructeur, sabotage intentionnel' },
    ],
    guideManager: {
      do: ['Utiliser l\'humour', 'Proposer des défis créatifs', 'Rendre le travail ludique', 'Féliciter avec enthousiasme'],
      dont: ['Être trop sérieux ou rigide', 'Imposer des procédures lourdes', 'Ignorer les blagues', 'Être monotone'],
    },
    environnement: 'Dynamique, varié, interactions fréquentes, challenges',
    correspondanceTP: 'Extraversion + Ouverture hautes (Big Five), ENFP/ESTP (MBTI)',
  },
  promoteur: {
    nom: 'Promoteur',
    ancienNom: 'Promoteur',
    perception: 'Actions',
    canal: 'Directif',
    pointsForts: ['Adaptable', 'Charmeur', 'Débrouillard'],
    besoinPsychologique: 'Excitation, stimulation',
    driverPrincipal: 'Sois fort',
    masqueStress: ['Manipulation', 'Prend des risques', 'Exploite les faiblesses'],
    stressNiveaux: [
      { niveau: 1, comportement: 'Attend des autres qu\'ils se débrouillent seuls, exigeant' },
      { niveau: 2, comportement: 'Manipulateur, joue sur les faiblesses, cherche le conflit' },
      { niveau: 3, comportement: 'Vengeur, destructeur, actes antisociaux possibles' },
    ],
    guideManager: {
      do: ['Être direct et concis', 'Donner de l\'autonomie', 'Proposer des défis concrets', 'Aller droit au but'],
      dont: ['Être dans l\'émotion', 'Imposer des processus longs', 'Micro-manager', 'Être indécis'],
    },
    environnement: 'Action, résultats rapides, autonomie, variété',
    correspondanceTP: 'Extraversion + Ouverture (Big Five), ESTP/ENTJ (MBTI)',
  },
};

// ══════════════════════════════════════════
// QUESTIONNAIRE PCM (20 questions)
// ══════════════════════════════════════════
const PCM_QUESTIONS = [
  // Questions 1-5 : Perception dominante (Base)
  { num: 1, category: 'perception', text: 'Quand vous devez prendre une décision importante, vous vous basez principalement sur :', options: [
    { value: 'analyseur', label: 'Les faits et les données objectives' },
    { value: 'perseverant', label: 'Vos convictions et valeurs personnelles' },
    { value: 'empathique', label: 'Ce que vous ressentez profondément' },
    { value: 'imagineur', label: 'Votre réflexion intérieure, après un temps de recul' },
    { value: 'energiseur', label: 'Votre première réaction spontanée' },
    { value: 'promoteur', label: 'L\'action qui semble la plus efficace immédiatement' },
  ]},
  { num: 2, category: 'perception', text: 'Dans un groupe de travail, on vous reconnaît surtout pour :', options: [
    { value: 'analyseur', label: 'Votre rigueur et votre sens de l\'organisation' },
    { value: 'perseverant', label: 'Votre engagement et vos prises de position' },
    { value: 'empathique', label: 'Votre écoute et votre bienveillance' },
    { value: 'imagineur', label: 'Votre calme et votre capacité de réflexion' },
    { value: 'energiseur', label: 'Votre créativité et votre énergie' },
    { value: 'promoteur', label: 'Votre efficacité et votre charisme' },
  ]},
  { num: 3, category: 'perception', text: 'Quand quelqu\'un vous explique quelque chose, vous êtes plus attentif à :', options: [
    { value: 'analyseur', label: 'La logique et la cohérence du raisonnement' },
    { value: 'perseverant', label: 'La sincérité et les valeurs derrière le propos' },
    { value: 'empathique', label: 'Le ton et l\'émotion avec lesquels c\'est dit' },
    { value: 'imagineur', label: 'Les idées et possibilités que cela ouvre' },
    { value: 'energiseur', label: 'Ce qui est fun ou intéressant dans le message' },
    { value: 'promoteur', label: 'Ce qui peut être fait concrètement' },
  ]},
  { num: 4, category: 'points_forts', text: 'Votre plus grande qualité au travail est :', options: [
    { value: 'analyseur', label: 'Ma capacité d\'analyse et mon sens du détail' },
    { value: 'perseverant', label: 'Mon sens des responsabilités et mes convictions' },
    { value: 'empathique', label: 'Ma capacité à créer du lien et à comprendre les autres' },
    { value: 'imagineur', label: 'Ma capacité à imaginer des solutions nouvelles' },
    { value: 'energiseur', label: 'Ma spontanéité et ma créativité' },
    { value: 'promoteur', label: 'Mon sens de l\'action et mon pragmatisme' },
  ]},
  { num: 5, category: 'relation', text: 'Dans vos relations avec les autres, vous recherchez avant tout :', options: [
    { value: 'analyseur', label: 'Le respect mutuel et les échanges structurés' },
    { value: 'perseverant', label: 'La confiance et le partage de valeurs communes' },
    { value: 'empathique', label: 'La chaleur humaine et la bienveillance' },
    { value: 'imagineur', label: 'Le respect de votre espace personnel' },
    { value: 'energiseur', label: 'Le plaisir et les moments partagés' },
    { value: 'promoteur', label: 'L\'excitation et les challenges' },
  ]},
  // Questions 6-10 : Motivation / Phase
  { num: 6, category: 'motivation', text: 'Ce qui vous motive le plus dans votre travail :', options: [
    { value: 'analyseur', label: 'Être reconnu pour la qualité de mon travail' },
    { value: 'perseverant', label: 'Défendre des causes qui me tiennent à cœur' },
    { value: 'empathique', label: 'Me sentir apprécié en tant que personne' },
    { value: 'imagineur', label: 'Avoir du temps pour réfléchir en paix' },
    { value: 'energiseur', label: 'M\'amuser et partager de bons moments' },
    { value: 'promoteur', label: 'Relever des défis et obtenir des résultats' },
  ]},
  { num: 7, category: 'motivation', text: 'Quand vous êtes stressé(e), vous avez tendance à :', options: [
    { value: 'analyseur', label: 'Vouloir tout contrôler et sur-détailler' },
    { value: 'perseverant', label: 'Imposer votre point de vue avec insistance' },
    { value: 'empathique', label: 'Tout accepter et vous oublier' },
    { value: 'imagineur', label: 'Vous replier sur vous-même et attendre' },
    { value: 'energiseur', label: 'Râler et rejeter la faute sur les autres' },
    { value: 'promoteur', label: 'Prendre des risques excessifs ou manipuler' },
  ]},
  { num: 8, category: 'stress', text: 'Face à un conflit, votre réaction naturelle est de :', options: [
    { value: 'analyseur', label: 'Analyser la situation objectivement et proposer des solutions rationnelles' },
    { value: 'perseverant', label: 'Défendre votre position avec conviction' },
    { value: 'empathique', label: 'Chercher l\'harmonie et le compromis' },
    { value: 'imagineur', label: 'Prendre du recul et observer' },
    { value: 'energiseur', label: 'Dédramatiser avec de l\'humour' },
    { value: 'promoteur', label: 'Agir vite pour résoudre le problème' },
  ]},
  { num: 9, category: 'motivation', text: 'Votre environnement de travail idéal :', options: [
    { value: 'analyseur', label: 'Structuré, avec des procédures claires et des objectifs précis' },
    { value: 'perseverant', label: 'Engagé, avec une mission porteuse de sens' },
    { value: 'empathique', label: 'Chaleureux, avec une bonne ambiance d\'équipe' },
    { value: 'imagineur', label: 'Calme, avec du temps pour réfléchir' },
    { value: 'energiseur', label: 'Dynamique, avec de la variété et des surprises' },
    { value: 'promoteur', label: 'Orienté résultats, avec de l\'autonomie' },
  ]},
  { num: 10, category: 'stress', text: 'Quand rien ne va plus, vous avez tendance à vous dire :', options: [
    { value: 'analyseur', label: '"Je n\'ai pas assez bien fait, il faut que je recommence"' },
    { value: 'perseverant', label: '"Les gens ne comprennent rien, personne n\'est fiable"' },
    { value: 'empathique', label: '"C\'est de ma faute, je n\'aurais pas dû..."' },
    { value: 'imagineur', label: '"Je ne sais pas quoi faire, j\'attends que ça passe"' },
    { value: 'energiseur', label: '"C\'est nul ! Pourquoi c\'est toujours à moi que ça arrive ?"' },
    { value: 'promoteur', label: '"Il faut que quelqu\'un agisse, maintenant"' },
  ]},
  // Questions 11-15 : Communication / Renforcement
  { num: 11, category: 'communication', text: 'Le type de communication que vous préférez recevoir :', options: [
    { value: 'analyseur', label: 'Des informations claires, factuelles et structurées' },
    { value: 'perseverant', label: 'Des échanges profonds sur les valeurs et le sens' },
    { value: 'empathique', label: 'Des paroles chaleureuses et encourageantes' },
    { value: 'imagineur', label: 'Des instructions précises, sans ambiguïté' },
    { value: 'energiseur', label: 'Des échanges légers, drôles et spontanés' },
    { value: 'promoteur', label: 'Des messages courts et orientés action' },
  ]},
  { num: 12, category: 'communication', text: 'Quand vous expliquez quelque chose à quelqu\'un, vous :', options: [
    { value: 'analyseur', label: 'Structurez votre explication de manière logique' },
    { value: 'perseverant', label: 'Partagez votre vision et vos convictions' },
    { value: 'empathique', label: 'Vous assurez que l\'autre se sent bien dans l\'échange' },
    { value: 'imagineur', label: 'Prenez le temps de formuler précisément votre pensée' },
    { value: 'energiseur', label: 'Utilisez des exemples amusants ou des métaphores' },
    { value: 'promoteur', label: 'Allez droit au but, sans détour' },
  ]},
  { num: 13, category: 'communication', text: 'Ce qui vous met le plus mal à l\'aise :', options: [
    { value: 'analyseur', label: 'Le manque de rigueur et l\'approximation' },
    { value: 'perseverant', label: 'L\'injustice et le manque d\'éthique' },
    { value: 'empathique', label: 'La froideur et le rejet' },
    { value: 'imagineur', label: 'La pression et le manque de temps pour réfléchir' },
    { value: 'energiseur', label: 'L\'ennui et la routine' },
    { value: 'promoteur', label: 'L\'inaction et les tergiversations' },
  ]},
  // Questions 14-17 : Besoins psychologiques
  { num: 14, category: 'besoin', text: 'Pour vous sentir bien, vous avez surtout besoin de :', options: [
    { value: 'analyseur', label: 'Savoir que votre travail est reconnu et bien fait' },
    { value: 'perseverant', label: 'Que vos opinions et convictions soient respectées' },
    { value: 'empathique', label: 'Vous sentir aimé(e) et apprécié(e)' },
    { value: 'imagineur', label: 'Avoir des moments de tranquillité et de solitude' },
    { value: 'energiseur', label: 'Avoir du fun et des contacts stimulants' },
    { value: 'promoteur', label: 'Vivre de l\'excitation et des challenges' },
  ]},
  { num: 15, category: 'besoin', text: 'Le compliment qui vous touche le plus :', options: [
    { value: 'analyseur', label: '"Ton travail est vraiment impeccable et précis"' },
    { value: 'perseverant', label: '"J\'admire ton engagement et ta détermination"' },
    { value: 'empathique', label: '"Tu es quelqu\'un de formidable, on a de la chance de t\'avoir"' },
    { value: 'imagineur', label: '"Ton idée est vraiment originale et intéressante"' },
    { value: 'energiseur', label: '"Tu mets une super ambiance, c\'est cool de bosser avec toi"' },
    { value: 'promoteur', label: '"Bravo, tu as relevé ce défi avec brio"' },
  ]},
  { num: 16, category: 'besoin', text: 'Pendant une journée de repos, vous préférez :', options: [
    { value: 'analyseur', label: 'Organiser et planifier des projets personnels' },
    { value: 'perseverant', label: 'Lire, vous informer sur des sujets qui vous tiennent à cœur' },
    { value: 'empathique', label: 'Passer du temps avec vos proches' },
    { value: 'imagineur', label: 'Rester seul(e), rêver, imaginer' },
    { value: 'energiseur', label: 'Sortir, voir du monde, vous amuser' },
    { value: 'promoteur', label: 'Faire une activité physique ou un défi sportif' },
  ]},
  { num: 17, category: 'besoin', text: 'Si vous deviez choisir un mot pour vous décrire :', options: [
    { value: 'analyseur', label: 'Rigoureux(se)' },
    { value: 'perseverant', label: 'Engagé(e)' },
    { value: 'empathique', label: 'Bienveillant(e)' },
    { value: 'imagineur', label: 'Réfléchi(e)' },
    { value: 'energiseur', label: 'Spontané(e)' },
    { value: 'promoteur', label: 'Déterminé(e)' },
  ]},
  // Questions 18-20 : Situation
  { num: 18, category: 'situation', text: 'En réunion, vous avez tendance à :', options: [
    { value: 'analyseur', label: 'Prendre des notes et demander des précisions' },
    { value: 'perseverant', label: 'Donner votre avis sur le fond du sujet' },
    { value: 'empathique', label: 'Être attentif au bien-être de chacun' },
    { value: 'imagineur', label: 'Écouter en silence et réfléchir' },
    { value: 'energiseur', label: 'Animer les échanges et apporter de la légèreté' },
    { value: 'promoteur', label: 'Pousser à la prise de décision rapide' },
  ]},
  { num: 19, category: 'situation', text: 'Quand vous faites face à un imprévu au travail :', options: [
    { value: 'analyseur', label: 'Vous analysez la situation avant d\'agir' },
    { value: 'perseverant', label: 'Vous vous appuyez sur vos principes pour décider' },
    { value: 'empathique', label: 'Vous consultez les personnes concernées' },
    { value: 'imagineur', label: 'Vous prenez du recul pour y réfléchir' },
    { value: 'energiseur', label: 'Vous improvisez avec créativité' },
    { value: 'promoteur', label: 'Vous agissez immédiatement' },
  ]},
  { num: 20, category: 'situation', text: 'Ce qui vous fatigue le plus :', options: [
    { value: 'analyseur', label: 'Le travail bâclé et le manque de méthode' },
    { value: 'perseverant', label: 'Le manque de sens et les compromissions' },
    { value: 'empathique', label: 'Les conflits et le manque de reconnaissance personnelle' },
    { value: 'imagineur', label: 'La sur-stimulation et le manque de calme' },
    { value: 'energiseur', label: 'La routine et les contraintes rigides' },
    { value: 'promoteur', label: 'L\'attente et les processus lents' },
  ]},
];

// ══════════════════════════════════════════
// SCORING PCM
// ══════════════════════════════════════════
function calculatePCMProfile(answers) {
  const scores = { analyseur: 0, perseverant: 0, empathique: 0, imagineur: 0, energiseur: 0, promoteur: 0 };

  // Poids par catégorie de question
  const weights = {
    perception: 3,    // Questions 1-3 : poids fort (déterminent la Base)
    points_forts: 2,  // Question 4
    relation: 2,      // Question 5
    motivation: 2.5,  // Questions 6-7, 9 : influencent la Phase
    stress: 2.5,      // Questions 8, 10 : confirment la Phase
    communication: 1.5, // Questions 11-13
    besoin: 2,        // Questions 14-17
    situation: 1.5,   // Questions 18-20
  };

  const categoryScores = {
    base: { analyseur: 0, perseverant: 0, empathique: 0, imagineur: 0, energiseur: 0, promoteur: 0 },
    phase: { analyseur: 0, perseverant: 0, empathique: 0, imagineur: 0, energiseur: 0, promoteur: 0 },
  };

  for (const answer of answers) {
    const question = PCM_QUESTIONS.find(q => q.num === answer.question_number);
    if (!question) continue;

    const weight = weights[question.category] || 1;
    const type = answer.answer_value;
    if (scores[type] !== undefined) {
      scores[type] += weight;

      // Base = perception + points_forts + relation + communication
      if (['perception', 'points_forts', 'relation', 'communication'].includes(question.category)) {
        categoryScores.base[type] += weight;
      }
      // Phase = motivation + stress + besoin + situation
      if (['motivation', 'stress', 'besoin', 'situation'].includes(question.category)) {
        categoryScores.phase[type] += weight;
      }
    }
  }

  // Déterminer Base et Phase
  const baseType = Object.entries(categoryScores.base).sort((a, b) => b[1] - a[1])[0][0];
  const phaseType = Object.entries(categoryScores.phase).sort((a, b) => b[1] - a[1])[0][0];

  // Normaliser les scores (0-100)
  const maxScore = Math.max(...Object.values(scores));
  const normalizedScores = {};
  for (const [type, score] of Object.entries(scores)) {
    normalizedScores[type] = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  }

  // Construire l'immeuble PCM (ordre des étages)
  const immeuble = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([type], index) => ({
      etage: 6 - index,
      type,
      nom: PCM_TYPES[type].nom,
      score: normalizedScores[type],
    }));

  // Évaluation du risque RPS
  const stressAnswers = answers.filter(a => {
    const q = PCM_QUESTIONS.find(qu => qu.num === a.question_number);
    return q && q.category === 'stress';
  });
  const phaseData = PCM_TYPES[phaseType];
  const riskAlert = stressAnswers.length >= 2 && stressAnswers.every(a => a.answer_value === phaseType);

  // Rapport complet
  const report = {
    base: {
      type: baseType,
      ...PCM_TYPES[baseType],
    },
    phase: {
      type: phaseType,
      ...PCM_TYPES[phaseType],
    },
    scores: normalizedScores,
    immeuble,
    riskAlert,
    rpsIndicators: riskAlert ? [
      `Profil de phase ${PCM_TYPES[phaseType].nom} avec indices de stress élevé`,
      `Driver principal : "${phaseData.driverPrincipal}"`,
      `Masques de stress observables : ${phaseData.masqueStress.join(', ')}`,
    ] : [],
    communicationTips: [
      `Canal privilégié : ${PCM_TYPES[baseType].canal}`,
      `Besoin psychologique : ${PCM_TYPES[baseType].besoinPsychologique}`,
      `Points forts : ${PCM_TYPES[baseType].pointsForts.join(', ')}`,
    ],
  };

  return { baseType, phaseType, report, riskAlert, normalizedScores };
}

// Clé de chiffrement AES-256
const ENCRYPTION_KEY = process.env.JWT_SECRET || 'solidata-pcm-encryption-key';

function encryptReport(report) {
  return CryptoJS.AES.encrypt(JSON.stringify(report), ENCRYPTION_KEY).toString();
}

function decryptReport(encrypted) {
  const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

// ══════════════════════════════════════════
// ROUTES API
// ══════════════════════════════════════════

// GET /api/pcm/questionnaire — Retourne les 20 questions
router.get('/questionnaire', (req, res) => {
  res.json(PCM_QUESTIONS.map(q => ({
    num: q.num,
    category: q.category,
    text: q.text,
    options: q.options.map(o => ({ value: o.value, label: o.label })),
  })));
});

// GET /api/pcm/types — Référence des 6 types PCM
router.get('/types', (req, res) => {
  const types = Object.entries(PCM_TYPES).map(([key, data]) => ({
    key,
    ...data,
  }));
  res.json(types);
});

// GET /api/pcm/types/:typeKey — Détail d'un type
router.get('/types/:typeKey', (req, res) => {
  const data = PCM_TYPES[req.params.typeKey];
  if (!data) return res.status(404).json({ error: 'Type PCM inconnu' });
  res.json({ key: req.params.typeKey, ...data });
});

// POST /api/pcm/sessions — Créer une session de test
router.post('/sessions', authenticate, authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { candidate_id, mode } = req.body;
    if (!candidate_id || !mode) {
      return res.status(400).json({ error: 'candidate_id et mode requis' });
    }

    const accessToken = crypto.randomBytes(32).toString('hex');

    const result = await pool.query(
      `INSERT INTO pcm_sessions (candidate_id, mode, access_token, status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [candidate_id, mode, accessToken]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[PCM] Erreur création session :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pcm/sessions/:token — Accéder à une session (mode autonome)
router.get('/sessions/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ps.*, c.first_name, c.last_name FROM pcm_sessions ps
       JOIN candidates c ON ps.candidate_id = c.id
       WHERE ps.access_token = $1`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session non trouvée' });

    const session = result.rows[0];
    if (session.status === 'completed') {
      return res.status(400).json({ error: 'Cette session est déjà terminée' });
    }

    // Passer en in_progress
    if (session.status === 'pending') {
      await pool.query(
        'UPDATE pcm_sessions SET status = $1, started_at = NOW() WHERE id = $2',
        ['in_progress', session.id]
      );
    }

    const candidateName = [session.first_name, session.last_name].filter(Boolean).join(' ') || 'Candidat';
    res.json({
      session: { ...session, candidate_name: candidateName },
      questions: PCM_QUESTIONS.map(q => ({ num: q.num, id: q.num, category: q.category, text: q.text, options: q.options })),
    });
  } catch (err) {
    console.error('[PCM] Erreur accès session :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/pcm/submit — Soumettre les réponses et calculer le profil
router.post('/submit', async (req, res) => {
  try {
    const { session_id, access_token, answers } = req.body;

    // Trouver la session
    let session;
    if (access_token) {
      const r = await pool.query('SELECT * FROM pcm_sessions WHERE access_token = $1', [access_token]);
      session = r.rows[0];
    } else if (session_id) {
      const r = await pool.query('SELECT * FROM pcm_sessions WHERE id = $1', [session_id]);
      session = r.rows[0];
    }

    if (!session) return res.status(404).json({ error: 'Session non trouvée' });
    if (session.status === 'completed') return res.status(400).json({ error: 'Session déjà terminée' });

    if (!answers || answers.length < 15) {
      return res.status(400).json({ error: 'Minimum 15 réponses requises' });
    }

    // Enregistrer les réponses
    for (const answer of answers) {
      await pool.query(
        'INSERT INTO pcm_answers (session_id, question_number, answer_value, answer_voice_text) VALUES ($1, $2, $3, $4)',
        [session.id, answer.question_number, answer.answer_value, answer.answer_voice_text || null]
      );
    }

    // Calculer le profil
    const { baseType, phaseType, report, riskAlert } = calculatePCMProfile(answers);

    // Chiffrer et stocker le rapport
    const encryptedReport = encryptReport(report);

    await pool.query(
      `INSERT INTO pcm_reports (session_id, candidate_id, base_type, phase_type, encrypted_report, risk_alert)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.id, session.candidate_id, baseType, phaseType, encryptedReport, riskAlert]
    );

    // Marquer la session comme terminée
    await pool.query(
      'UPDATE pcm_sessions SET status = $1, completed_at = NOW() WHERE id = $2',
      ['completed', session.id]
    );

    res.json({
      message: 'Profil PCM calculé avec succès',
      profile: {
        baseType,
        phaseType,
        baseNom: PCM_TYPES[baseType].nom,
        phaseNom: PCM_TYPES[phaseType].nom,
        riskAlert,
      },
      report,
    });
  } catch (err) {
    console.error('[PCM] Erreur soumission :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pcm/profiles — Tous les profils
router.get('/profiles', authenticate, authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.id, pr.session_id, pr.candidate_id, pr.base_type, pr.phase_type,
       pr.risk_alert, pr.created_at,
       c.first_name, c.last_name, c.email
       FROM pcm_reports pr
       JOIN candidates c ON pr.candidate_id = c.id
       ORDER BY pr.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[PCM] Erreur liste profils :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pcm/profiles/:candidateId — Profil d'un candidat (déchiffré)
router.get('/profiles/:candidateId', authenticate, authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*, c.first_name, c.last_name, c.email
       FROM pcm_reports pr
       JOIN candidates c ON pr.candidate_id = c.id
       WHERE pr.candidate_id = $1
       ORDER BY pr.created_at DESC LIMIT 1`,
      [req.params.candidateId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Profil non trouvé' });

    const row = result.rows[0];
    const report = decryptReport(row.encrypted_report);

    res.json({
      id: row.id,
      candidate: { id: row.candidate_id, first_name: row.first_name, last_name: row.last_name, email: row.email },
      baseType: row.base_type,
      phaseType: row.phase_type,
      riskAlert: row.risk_alert,
      report,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('[PCM] Erreur profil candidat :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
