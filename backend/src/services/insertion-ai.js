const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../config/database');
const { createPseudonymizer, redactContactInfo, ageBracket } = require('../utils/pii-pseudonymize');
const { FREINS, FREIN_KEYS, freinColumns } = require('../routes/insertion/freins-registry');
const { SENSITIVE_DIAG_FIELDS, decryptField, encryptField } = require('../utils/field-crypto');
const { milestoneLabel } = require('../routes/insertion/engine');

// Axes transmis à l'IA : le DÉTAIL du frein judiciaire (art. 10 RGPD) n'est
// JAMAIS envoyé au sous-traitant IA — seul le score 1-5 (impact organisationnel)
// est transmis. Les détails santé le sont (déchiffrés puis pseudonymisés),
// comme historiquement.
const IA_FREINS = FREINS.map((f) => ({ key: f.key, column: f.column, withDetail: f.key !== 'judiciaire' }));

// ══════════════════════════════════════════════════════════════
// SERVICE IA INSERTION — Analyse Claude des profils PCM
// et recommandations d'adaptation des parcours d'insertion
// ══════════════════════════════════════════════════════════════

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Modèle par défaut à jour (claude-sonnet-4-20250514 était déprécié).
// Surchargeable sans redéploiement via la variable d'env CLAUDE_MODEL.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

// Extrait le texte de TOUS les blocs `text` de la réponse (et pas seulement
// content[0]) : selon le modèle, le 1er bloc peut être autre chose (ex. bloc
// de raisonnement), et lire content[0].text renverrait alors une chaîne vide.
function extractText(response) {
  const blocks = (response && response.content) || [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Parse tolérant du JSON renvoyé par le modèle : retire les fences markdown
// (```json … ```), tente le parse direct puis, en repli, du 1er { au dernier }.
// Renvoie null si rien d'exploitable (ex. JSON tronqué par max_tokens).
function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try { return JSON.parse(cleaned); } catch { /* essaie l'extraction par accolades */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* tronqué / invalide */ } }
  return null;
}

const SYSTEM_INSERTION = `Tu es l'IA d'accompagnement insertion de Solidata, une SIAE (Structure d'Insertion par l'Activité Économique) spécialisée dans le textile à Rouen.

Tu accompagnes le CIP (Conseiller en Insertion Professionnelle) dans le suivi des salariés en parcours d'insertion (CDDI max 24 mois).

Contexte métier :
- 4 filières : collecte (chauffeurs), tri (opérateurs chaîne de tri), logistique, boutique
- 9 freins périphériques suivis (échelle 1-5, 1=pas de frein, 5=frein majeur) :
  mobilité, santé, finances, famille, linguistique, administratif, numérique, logement, judiciaire
- Frein judiciaire : tu ne reçois QUE le niveau (impact organisationnel) — ne spécule JAMAIS sur la nature de faits
- Entretiens du parcours : diagnostic d'accueil (M+1), bilans intermédiaires à fréquence libre, renouvellement de contrat, bilan de sortie, suivi post-sortie
- 6 types de personnalité PCM : Analyseur, Persévérant, Empathique, Imagineur, Énergiseur, Promoteur

Ton rôle :
- Analyser le profil PCM pour adapter la communication et le management
- Croiser les freins périphériques avec la personnalité pour des recommandations ciblées
- Proposer des actions concrètes et réalistes (partenaires locaux Rouen/Normandie)
- Identifier les risques de décrochage
- Adapter le ton et le rythme au profil PCM du salarié

Réponds toujours en français, de façon structurée et actionnable.`;

// ──────────────────────────────────────────────────────────────
// Collecte des données d'un salarié pour analyse
// ──────────────────────────────────────────────────────────────

async function getEmployeeInsertionData(employeeId) {
  // Fault-isolation : une requête AUXILIAIRE qui échoue (colonne absente sur
  // une base ancienne, table non migrée, jointure candidat manquante…) ne doit
  // PAS faire échouer toute l'analyse IA. Chaque requête secondaire dégrade en
  // { rows: [] } et logue sa cause côté serveur ; seule la requête « salarié »
  // est essentielle (avec repli minimal SELECT * si une colonne jointe manque).
  const soft = (text, params, label) => pool.query(text, params).catch((e) => {
    console.error(`[INSERTION-AI] requête « ${label} » ignorée (${e.code || '?'}) : ${e.message}`);
    return { rows: [] };
  });

  const [employee, diagnostic, milestones, actionPlans, objectifs, pcmReport, candidate] = await Promise.all([
    pool.query(`
      SELECT e.*, e.position as position_name, t.name as team_name
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE e.id = $1
    `, [employeeId]).catch((e) => {
      console.error(`[INSERTION-AI] requête salarié dégradée (${e.code || '?'}) : ${e.message}`);
      return pool.query(`SELECT * FROM employees WHERE id = $1`, [employeeId]);
    }),
    soft(`SELECT * FROM insertion_diagnostics WHERE employee_id = $1 ORDER BY parcours_num DESC LIMIT 1`, [employeeId], 'diagnostic'),
    soft(`SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date`, [employeeId], 'jalons'),
    soft(`SELECT * FROM cip_action_plans WHERE employee_id = $1 ORDER BY priority, created_at`, [employeeId], 'plans'),
    soft(`SELECT * FROM insertion_objectifs WHERE employee_id = $1 ORDER BY parent_id NULLS FIRST, ordre, id LIMIT 40`, [employeeId], 'objectifs'),
    // PCM : chercher via le candidat lié
    soft(`
      SELECT pr.encrypted_report, pr.base_type, pr.phase_type, pr.risk_alert
      FROM pcm_reports pr
      JOIN pcm_sessions ps ON pr.session_id = ps.id
      JOIN candidates c ON ps.candidate_id = c.id
      JOIN employees e ON e.candidate_id = c.id
      WHERE e.id = $1
      ORDER BY pr.created_at DESC LIMIT 1
    `, [employeeId], 'pcm'),
    soft(`
      SELECT c.interview_comment, c.practical_test_result, c.cv_raw_text,
             c.first_name, c.last_name
      FROM candidates c
      JOIN employees e ON e.candidate_id = c.id
      WHERE e.id = $1
    `, [employeeId], 'candidat'),
  ]);

  if (!employee.rows[0]) throw new Error('Salarié non trouvé');

  // Déchiffrer le rapport PCM si disponible
  let pcmData = null;
  if (pcmReport.rows[0]?.encrypted_report) {
    // Source unique des clés (utils/pcm-crypto.js) : cet endroit gardait sa
    // propre liste à deux clés, d'où des rapports lisibles ailleurs et pas ici.
    // Rapport illisible → on retombe sur les types Base/Phase, stockés EN CLAIR
    // et donc toujours disponibles : mieux vaut un contexte réduit qu'aucun.
    const { decryptReport } = require('../utils/pcm-crypto');
    pcmData = decryptReport(pcmReport.rows[0].encrypted_report)
      || { base_type: pcmReport.rows[0].base_type, phase_type: pcmReport.rows[0].phase_type };
  }

  // Déchiffrement applicatif des champs sensibles du diagnostic (santé) —
  // AVANT pseudonymisation. Le détail JUDICIAIRE est ensuite EXCLU des
  // payloads IA (IA_FREINS.withDetail=false) : il est déchiffré ici uniquement
  // pour rester cohérent côté serveur, jamais transmis à Anthropic.
  const diag = diagnostic.rows[0] || null;
  if (diag) {
    for (const f of SENSITIVE_DIAG_FIELDS) {
      if (diag[f] !== undefined) diag[f] = decryptField(diag[f]);
    }
  }

  return {
    employee: employee.rows[0],
    diagnostic: diag,
    milestones: milestones.rows,
    actionPlans: actionPlans.rows,
    objectifs: objectifs.rows,
    pcm: pcmData,
    candidate: candidate.rows[0] || null,
  };
}

// ──────────────────────────────────────────────────────────────
// Analyse approfondie du profil — PCM × Freins × Parcours
// ──────────────────────────────────────────────────────────────

async function analyseProfilComplet(employeeId) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  const data = await getEmployeeInsertionData(employeeId);
  const emp = data.employee;
  const diag = data.diagnostic;

  // RGPD (item 3.C-5) : pseudonymisation AVANT envoi à Anthropic. Le prénom/nom
  // (et le nom du candidat lié, même personne) sont remplacés par un jeton stable
  // « Salarié A » ; ils sont aussi retirés des textes libres via scrubText. Le
  // patronyme réel ne quitte pas le serveur ; il est ré-injecté à l'affichage via
  // rehydrate() (donnée déjà chez nous → confort CIP préservé, RGPD respecté).
  const pseudo = createPseudonymizer();
  const ref = pseudo.person({
    key: `emp-${employeeId}`,
    first: emp.first_name,
    last: emp.last_name,
    names: data.candidate ? [{ first: data.candidate.first_name, last: data.candidate.last_name }] : [],
  });

  const profil = {
    salarie: {
      reference: ref,
      poste: emp.position_name || 'Non affecté',
      equipe: emp.team_name || 'Non affecté',
      filiere: emp.team_name || emp.position_name || 'Non précisé',
      tranche_age: ageBracket(emp.birth_date),
      insertion_status: emp.insertion_status,
      date_debut: emp.insertion_start_date || emp.contract_start,
    },
    // PCM — `alerte_risque` RETIRÉ (2.43.0, audit du module PCM §3.3.a).
    // Cet indicateur (`pcm_reports.risk_alert`) ne mesure pas une détresse mais
    // la COHÉRENCE des réponses : il vérifie que les 3 items « stress » — ceux-là
    // mêmes qui pèsent 12 des 34,5 points déterminant la Phase — désignent bien
    // cette Phase. Le calcul est donc circulaire, et l'audit a mesuré 32 % de
    // déclenchements sur 20 000 jeux de réponses ALÉATOIRES. Le transmettre
    // faisait entrer un artefact statistique comme prémisse du raisonnement de
    // l'IA sur une personne réelle. Il n'est plus envoyé ; le calcul et la
    // colonne restent en base (la refonte de l'indicateur est un chantier à
    // part). `analyserProfilInitial` applique déjà la même liste blanche.
    pcm: data.pcm ? {
      type_base: data.pcm.base?.type || data.pcm.base_type,
      type_phase: data.pcm.phase?.type || data.pcm.phase_type,
      scores: data.pcm.scores || null,
    } : null,
    // 9 axes du registre — le détail judiciaire n'est JAMAIS transmis (art. 10).
    freins: diag ? Object.fromEntries(IA_FREINS.map((f) => [f.key, {
      score: diag[f.column] ?? null,
      ...(f.withDetail ? { detail: pseudo.scrubText(diag[`${f.column}_detail`]) } : {}),
    }])) : null,
    observations: diag ? {
      points_forts: pseudo.scrubText(diag.obs_points_forts),
      difficultes: pseudo.scrubText(diag.obs_difficultes),
      comportement_equipe: pseudo.scrubText(diag.obs_comportement_equipe),
      parcours_anterieur: pseudo.scrubText(diag.parcours_anterieur),
    } : null,
    jalons: data.milestones.map(m => ({
      type: m.milestone_type,
      titre: milestoneLabel(m),
      statut: m.status,
      date_prevue: m.due_date,
      date_realise: m.completed_date,
      avis_global: pseudo.scrubText(m.avis_global),
      bilan: pseudo.scrubText(m.bilan_professionnel),
    })),
    objectifs: (data.objectifs || []).filter(o => !['atteint', 'abandonne'].includes(o.statut)).map(o => ({
      titre: pseudo.scrubText(o.titre),
      description: pseudo.scrubText(o.description),
      statut: o.statut,
      origine: o.origine,
      echeance: o.echeance,
      sous_objectif: o.parent_id != null,
    })),
    actions_en_cours: data.actionPlans.filter(a => a.status !== 'realise' && a.status !== 'abandonne').map(a => ({
      label: pseudo.scrubText(a.action_label),
      categorie: a.category,
      priorite: a.priority,
      statut: a.status,
      echeance: a.echeance,
    })),
    entretien_recrutement: pseudo.scrubText(data.candidate?.interview_comment || null),
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_INSERTION,
    messages: [{
      role: 'user',
      content: `Analyse approfondie du profil d'insertion de ce salarié. Croise le type PCM avec les freins périphériques pour des recommandations personnalisées.

${JSON.stringify(profil, null, 2)}

Réponds en JSON avec les clés :
- synthese : résumé en 3-4 phrases du profil et de la situation
- pcm_adaptation : { communication: string, management: string, vigilances: string[] }
- freins_prioritaires : [{ frein: string, score: number, analyse: string, actions: string[] }] (max 3, les plus urgents)
- risque_decrochage : { niveau: "faible"|"moyen"|"eleve", facteurs: string[], signaux_alerte: string[] }
- plan_action_propose : [{ action: string, categorie: string, echeance: string, justification: string }] (max 5)
- prochaine_etape : string (action immédiate recommandée pour le CIP)
- score_progression : number (0-100, estimation de progression globale)`,
    }],
  });

  const text = extractText(response);
  const parsed = parseJsonLoose(text) || { synthese: text || 'Aucun contenu renvoyé par le modèle.' };
  // Ré-hydratation : le jeton « Salarié A » redevient le nom réel pour le CIP.
  return pseudo.rehydrate(parsed);
}

// ──────────────────────────────────────────────────────────────
// Préparation d'entretien — Guide CIP adapté au profil PCM
// ──────────────────────────────────────────────────────────────

async function preparerEntretien(employeeId, milestoneType) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  const data = await getEmployeeInsertionData(employeeId);
  const emp = data.employee;
  const diag = data.diagnostic;

  // RGPD (item 3.C-5) : pseudonymisation avant Anthropic (cf. analyseProfilComplet).
  const pseudo = createPseudonymizer();
  const ref = pseudo.person({
    key: `emp-${employeeId}`,
    first: emp.first_name,
    last: emp.last_name,
    names: data.candidate ? [{ first: data.candidate.first_name, last: data.candidate.last_name }] : [],
  });

  const context = {
    salarie: { reference: ref, poste: emp.position_name, equipe: emp.team_name, tranche_age: ageBracket(emp.birth_date) },
    type_entretien: milestoneType,
    // PCM : le TYPE DE BASE seul — un repère de communication. Aucun indicateur
    // de « risque » PCM ne transite ici (audit 2.43.0 §3.3.a, cf. le commentaire
    // d'analyseProfilComplet) : préparer un entretien n'a pas à partir d'un
    // artefact de cohérence des réponses.
    pcm_type: data.pcm?.base?.type || data.pcm?.base_type || null,
    // 9 axes du registre (scores seulement — pas de détail dans la préparation)
    freins_actuels: diag ? Object.fromEntries(FREIN_KEYS.map((k) => [k, diag[`frein_${k}`] ?? null])) : null,
    jalons_precedents: data.milestones.filter(m => m.status === 'realise').map(m => ({
      type: m.milestone_type, titre: milestoneLabel(m), avis: pseudo.scrubText(m.avis_global), bilan: pseudo.scrubText(m.bilan_professionnel),
    })),
    objectifs_en_cours: (data.objectifs || []).filter(o => ['a_venir', 'en_cours', 'reporte'].includes(o.statut)).map(o => ({
      titre: pseudo.scrubText(o.titre), statut: o.statut, echeance: o.echeance,
    })),
    actions_en_cours: data.actionPlans.filter(a => a.status === 'en_cours').map(a => pseudo.scrubText(a.action_label)),
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: SYSTEM_INSERTION,
    messages: [{
      role: 'user',
      content: `Prépare un guide d'entretien "${milestoneType}" pour le CIP. Adapte les questions et le ton au profil PCM.

${JSON.stringify(context, null, 2)}

Réponds en JSON :
- intro_conseillee : string (comment ouvrir l'entretien selon le type PCM)
- questions_cles : [{ question: string, objectif: string, conseil_pcm: string }] (5-7 questions)
- points_vigilance : string[] (ce qu'il faut observer pendant l'entretien)
- freins_a_aborder : [{ frein: string, formulation_adaptee: string }]
- conclusion_conseillee : string
- duree_estimee : string`,
    }],
  });

  const text = extractText(response);
  const parsed = parseJsonLoose(text) || { intro_conseillee: text || 'Aucun contenu renvoyé par le modèle.' };
  return pseudo.rehydrate(parsed);
}

// ──────────────────────────────────────────────────────────────
// Bilan de cohorte — Analyse globale des parcours actifs
// ──────────────────────────────────────────────────────────────

async function bilanCohorte() {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  // Tous les salariés en parcours actif avec diagnostic (9 axes du registre)
  const actifs = await pool.query(`
    SELECT e.id, e.first_name, e.last_name, e.insertion_status,
           e.insertion_start_date, e.contract_start,
           e.position as position_name, t.name as team_name,
           ${freinColumns('d.').join(', ')}
    FROM employees e
    LEFT JOIN insertion_diagnostics d ON d.employee_id = e.id
    LEFT JOIN teams t ON e.team_id = t.id
    WHERE e.is_active = true
      AND (e.insertion_status = 'en_parcours' OR d.id IS NOT NULL)
    ORDER BY e.insertion_start_date NULLS LAST
  `);

  // Jalons en retard (secondaire : ne doit pas casser le bilan si colonne absente)
  const retards = await pool.query(`
    SELECT m.employee_id, e.first_name, e.last_name, m.milestone_type, m.titre,
           m.due_date, m.status
    FROM insertion_milestones m
    JOIN employees e ON m.employee_id = e.id
    WHERE m.status IN ('a_planifier', 'planifie')
      AND m.due_date < CURRENT_DATE
      AND e.is_active = true
  `).catch((e) => { console.error(`[INSERTION-AI] cohorte/retards ignoré (${e.code || '?'}) : ${e.message}`); return { rows: [] }; });

  // Actions en retard (secondaire)
  const actionsRetard = await pool.query(`
    SELECT a.employee_id, e.first_name, e.last_name, a.action_label,
           a.echeance, a.priority
    FROM cip_action_plans a
    JOIN employees e ON a.employee_id = e.id
    WHERE a.status = 'a_faire'
      AND a.echeance < CURRENT_DATE
      AND e.is_active = true
  `).catch((e) => { console.error(`[INSERTION-AI] cohorte/actions ignoré (${e.code || '?'}) : ${e.message}`); return { rows: [] }; });

  // RGPD (item 3.C-5) : chaque salarié de la cohorte reçoit un jeton stable par id
  // (« Salarié A »…), partagé entre profils / jalons en retard / actions en retard.
  // Anthropic ne voit que les jetons ; rehydrate() restitue les noms au CIP.
  const pseudo = createPseudonymizer();
  const cohorteData = {
    nb_salaries_actifs: actifs.rows.length,
    profils: actifs.rows.map(e => ({
      reference: pseudo.person({ key: `emp-${e.id}`, first: e.first_name, last: e.last_name }),
      poste: e.position_name,
      equipe: e.team_name,
      anciennete_mois: e.insertion_start_date
        ? Math.round((Date.now() - new Date(e.insertion_start_date)) / (30 * 86400000))
        : null,
      freins: Object.fromEntries(FREIN_KEYS.map((k) => [k, e[`frein_${k}`] ?? null])),
    })),
    jalons_en_retard: retards.rows.map(r => ({
      salarie: pseudo.person({ key: `emp-${r.employee_id}`, first: r.first_name, last: r.last_name }),
      jalon: milestoneLabel(r),
      date_prevue: r.due_date,
    })),
    actions_en_retard: actionsRetard.rows.map(a => ({
      salarie: pseudo.person({ key: `emp-${a.employee_id}`, first: a.first_name, last: a.last_name }),
      action: pseudo.scrubText(a.action_label),
      echeance: a.echeance,
      priorite: a.priority,
    })),
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_INSERTION,
    messages: [{
      role: 'user',
      content: `Analyse globale de la cohorte en insertion. Identifie les tendances, les risques et les priorités.

${JSON.stringify(cohorteData, null, 2)}

Réponds en JSON :
- synthese : string (3-4 phrases)
- indicateurs : { nb_actifs: number, nb_a_risque: number, frein_dominant: string, taux_retard_jalons: number }
- alertes : [{ salarie: string, niveau: "urgent"|"attention"|"suivi", raison: string }] (max 5)
- tendances : string[] (observations sur la cohorte)
- recommandations_cip : string[] (actions prioritaires pour le CIP)
- score_cohorte : number (0-100, santé globale de la cohorte)`,
    }],
  });

  const text = extractText(response);
  const parsed = parseJsonLoose(text) || { synthese: text || 'Aucun contenu renvoyé par le modèle.' };
  // Ré-hydratation des jetons « Salarié X » → noms réels dans les alertes de cohorte.
  return pseudo.rehydrate(parsed);
}

// ──────────────────────────────────────────────────────────────
// Audit insertion — Rapport de situation globale de la structure
// (direction + CIP) à partir des indicateurs chiffrés ET des
// verbatims anonymisés des CIP/agents.
// ──────────────────────────────────────────────────────────────

async function auditGlobalReport({ kpis, verbatims }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  // RGPD (item 3.C-5) : les verbatims sont déjà agrégés/anonymisés en amont
  // (gatherAuditVerbatims + consigne système « ne cite AUCUN nom »). Défense en
  // profondeur : on masque en plus toute coordonnée résiduelle (email, téléphone,
  // NIR, titre de séjour…) qu'un agent aurait pu saisir dans un texte libre.
  const redactDeep = (v) => {
    if (typeof v === 'string') return redactContactInfo(v);
    if (Array.isArray(v)) return v.map(redactDeep);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = redactDeep(v[k]); return o; }
    return v;
  };
  const payload = { indicateurs_chiffres: kpis, verbatims_anonymises: redactDeep(verbatims) };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: SYSTEM_INSERTION,
    messages: [{
      role: 'user',
      content: `Tu rédiges un RAPPORT DE SITUATION GLOBALE d'insertion, destiné à la DIRECTION et aux CIP d'une SIAE (Solidarité Textiles). Ce rapport sera partagé pour alimenter les actions d'accompagnement global des publics.

Appuie-toi sur DEUX sources :
1. Les indicateurs chiffrés consolidés (parcours, taux de réalisation des jalons, freins moyens, plans d'action, sorties).
2. Les verbatims ANONYMISÉS des CIP et agents (observations de diagnostic, bilans de jalons, notes d'actions) — ils reflètent le vécu de terrain et le profil réel du public.

Ne cite AUCUN nom. Reste factuel, nuancé et actionnable. Adapte le ton à un comité de direction.

${JSON.stringify(payload, null, 2)}

Réponds STRICTEMENT en JSON avec les clés :
- synthese_direction : string (5-6 phrases, l'essentiel pour la direction)
- situation_globale : string (état des lieux détaillé de l'insertion dans la structure)
- profil_public : string (portrait du public accompagné : freins dominants, dynamique, difficultés récurrentes issues des verbatims)
- points_forts : string[] (ce qui fonctionne, appuyé sur les chiffres et les verbatims)
- points_vigilance : string[] (risques, retards, freins critiques, signaux faibles)
- recommandations_structure : [{ action: string, objectif: string, echeance_suggeree: string }] (actions concrètes au niveau de la STRUCTURE, pas individuelles)
- conclusion : string (1-2 phrases de cadrage pour la direction)`,
    }],
  });

  const text = extractText(response);
  const blocs = (response.content || []).map((b) => b.type).join(',');
  console.log(`[INSERTION][AUDIT-IA] blocs=[${blocs}] len=${text.length} stop=${response.stop_reason} out=${response.usage?.output_tokens}`);
  if (!text) {
    // Le modèle n'a produit aucun bloc texte (budget consommé par le
    // raisonnement, refus, ou format inattendu).
    return { synthese_direction: `Le modèle IA n'a renvoyé aucun contenu texte (blocs=[${blocs}], stop=${response.stop_reason}). Réessayez ; si cela persiste, vérifiez CLAUDE_MODEL et le quota Anthropic (logs serveur [AUDIT-IA]).` };
  }
  const parsed = parseJsonLoose(text);
  // JAMAIS silencieux : si le JSON attendu n'est pas exploitable (parse KO,
  // objet vide, clés inattendues, ou réponse tronquée max_tokens), on renvoie
  // le texte brut sous `_raw` (l'UI l'affiche en bloc, pas dans « Synthèse »).
  const hasContent = parsed && (parsed.synthese_direction || parsed.situation_globale || parsed.profil_public
    || (Array.isArray(parsed.points_forts) && parsed.points_forts.length)
    || (Array.isArray(parsed.recommandations_structure) && parsed.recommandations_structure.length));
  if (hasContent) {
    if (response.stop_reason === 'max_tokens') parsed._tronque = true;
    return parsed;
  }
  console.warn(`[INSERTION][AUDIT-IA] JSON non exploitable (stop=${response.stop_reason}) — repli texte brut`);
  return { _raw: text, _tronque: response.stop_reason === 'max_tokens' };
}

// ══════════════════════════════════════════════════════════════
// NOTE DE PROFIL INITIAL CIP (2.43.0)
// Analyse systématique du dossier de recrutement (CV + entretien structuré +
// mises en situation + PCM) remise à la CIP EN PRÉAMBULE du diagnostic
// d'accueil. Ce n'est ni un diagnostic, ni un critère de sélection : ce sont
// des HYPOTHÈSES DE TRAVAIL à vérifier avec la personne.
// ══════════════════════════════════════════════════════════════

// Prompt système DÉDIÉ (variante de SYSTEM_INSERTION) — les garde-fous
// déontologiques y sont OPPOSABLES : ils sont dans le prompt, pas seulement
// dans la documentation. Rédigés avec le rapport de recherche bibliographique
// du chantier (formulation PCM, vocabulaire non clinique, absence de pronostic).
const SYSTEM_NOTE_PROFIL = `${SYSTEM_INSERTION}

MISSION PARTICULIÈRE — NOTE DE PROFIL INITIAL
Tu rédiges une note de PRÉPARATION remise au CIP avant le premier entretien
(diagnostic d'accueil) d'un salarié qui vient d'être recruté. Elle sert à
préparer une RENCONTRE, pas à décider quoi que ce soit.

RÈGLES DE FORMULATION — OPPOSABLES, sans exception :
1. Le PCM est un outil de COMMUNICATION, jamais un outil de diagnostic
   psychologique ni de sélection. N'écris JAMAIS « c'est un [type] », ni un
   portrait figé de la personne. Écris des repères pour ajuster la
   communication DU PROFESSIONNEL : « s'engage plus volontiers quand… »,
   « attache de l'importance à… », « répond mieux à une consigne qui… ».
2. AUCUN vocabulaire clinique : jamais « détresse », « désespoir »,
   « dépression », « fragile psychologiquement », « troubles », « pathologie ».
   Un signe de tension s'écrit en trois temps : le signal à observer, ce qui
   aide alors, et — si le signal est sérieux — orienter vers la médecine du
   travail ou un professionnel de santé. Tu ne poses aucun avis médical.
3. AUCUNE prédiction : pas de pronostic d'employabilité, pas de score de
   réussite, pas de « risque de rupture », pas de compatibilité métier, pas de
   probabilité de sortie. Tu ne classes pas, tu ne notes pas la personne.
4. PROVENANCE OBLIGATOIRE : chaque frein pressenti et chaque hypothèse porte
   sa source (cv / entretien / mise_en_situation / pcm) et une formulation
   FACTUELLE (ce qui a été dit ou observé, pas ton interprétation présentée
   comme un fait).
5. CE QUI N'A PAS ÉTÉ ABORDÉ EST NOMMÉ « non évalué » — jamais deviné, jamais
   comblé. Un frein sans élément dans le dossier n'apparaît pas dans la liste.
6. Le bloc de repères de communication (PCM) ne reprend, ne reformule et ne
   laisse déduire AUCUN élément de santé ni judiciaire. Ces deux registres
   restent strictement hors de ce bloc.
7. Tout est présenté comme une HYPOTHÈSE à vérifier avec la personne au premier
   entretien. Si l'expérience contredit la note, c'est l'expérience qui a raison.

Réponds en français, sobre et factuel.`;

/**
 * Collecte élargie propre à la note de profil : ce que
 * `getEmployeeInsertionData` ne rapporte pas (entretien de recrutement
 * STRUCTURÉ complet, mises en situation). Chaque requête dégrade seule.
 */
async function getRecrutementData(employeeId) {
  const soft = (text, params, label) => pool.query(text, params).catch((e) => {
    console.error(`[INSERTION-AI] note-profil « ${label} » ignorée (${e.code || '?'}) : ${e.message}`);
    return { rows: [] };
  });
  const [interview, situations, candidat] = await Promise.all([
    soft(`SELECT ri.* FROM recruitment_interviews ri
          JOIN employees e ON e.candidate_id = ri.candidate_id
          WHERE e.id = $1 ORDER BY ri.created_at DESC LIMIT 1`, [employeeId], 'entretien structuré'),
    soft(`SELECT ms.* FROM mise_en_situation ms
          JOIN employees e ON e.candidate_id = ms.candidate_id
          WHERE e.id = $1 ORDER BY ms.type`, [employeeId], 'mises en situation'),
    soft(`SELECT c.id, c.interviewer_name, c.practical_test_comment
          FROM candidates c JOIN employees e ON e.candidate_id = c.id
          WHERE e.id = $1`, [employeeId], 'candidat (complément)'),
  ]);
  return {
    interview: interview.rows[0] || null,
    situations: situations.rows,
    candidatPlus: candidat.rows[0] || null,
  };
}

// Champs texte libre de l'entretien structuré transmis à l'IA — TOUS passent
// par scrubText. Les tableaux (TEXT[]) sont transmis tels quels (valeurs de
// listes fermées, aucun patronyme possible).
const ITW_TEXT_FIELDS = [
  'presentation_mots', 'parcours_professionnel', 'experiences_marquantes',
  'situation_actuelle_autre', 'difficultes_recherche_autre', 'freins_emploi_autre',
  'contraintes_horaires_detail', 'structure_accompagnement_autre',
  'motivation_integration', 'motivation_reprise', 'attentes_autre',
  'comportement_equipe', 'reaction_consigne', 'disponibilite_autre',
  'organisation_ponctualite', 'idee_metier_detail', 'amelioration_souhaitee',
  'question_ouverte', 'commentaire_evaluateur',
];
const ITW_LIST_FIELDS = [
  'difficultes_recherche', 'freins_emploi', 'structure_accompagnement',
  'attentes', 'experience_activite',
];
const ITW_ENUM_FIELDS = [
  'situation_actuelle', 'duree_sans_emploi', 'contraintes_horaires',
  'travail_physique', 'disponibilite_horaires', 'idee_metier', 'evaluation_globale',
];
const MES_CRITERES = [
  'respect_consignes', 'capacite_physique', 'endurance', 'comprehension',
  'qualite_travail', 'rapidite', 'securite', 'autonomie',
];

/**
 * Note de profil initial — génération + PERSISTANCE (chiffrée).
 * @param {number} employeeId
 * @param {object} [opts]
 * @param {number|null} [opts.generatedBy] utilisateur déclencheur (NULL = automatique)
 * @returns {Promise<{note: object, sources: object, parcours_num: number}>}
 */
async function analyserProfilInitial(employeeId, { generatedBy = null } = {}) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  const data = await getEmployeeInsertionData(employeeId);
  const rec = await getRecrutementData(employeeId);
  const emp = data.employee;
  const cand = data.candidate;

  // RGPD : pseudonymisation AVANT tout envoi (doctrine du fichier). Le CV brut
  // et TOUS les textes libres d'entretien passent par scrubText ; la date de
  // naissance ne part jamais (tranche d'âge seule) ; le détail judiciaire n'est
  // jamais transmis (il n'existe d'ailleurs pas à ce stade du dossier).
  const pseudo = createPseudonymizer();
  const ref = pseudo.person({
    key: `emp-${employeeId}`,
    first: emp.first_name,
    last: emp.last_name,
    names: cand ? [{ first: cand.first_name, last: cand.last_name }] : [],
  });

  const itw = rec.interview;
  const entretienStructure = itw ? {
    ...Object.fromEntries(ITW_ENUM_FIELDS.map((k) => [k, itw[k] ?? null])),
    ...Object.fromEntries(ITW_LIST_FIELDS.map((k) => [k, Array.isArray(itw[k]) ? itw[k] : null])),
    ...Object.fromEntries(ITW_TEXT_FIELDS.map((k) => [k, pseudo.scrubText(itw[k] || null)])),
  } : null;

  const misesEnSituation = (rec.situations || []).map((s) => ({
    type: s.type,
    resultat: s.resultat || null,
    criteres: Object.fromEntries(MES_CRITERES.map((c) => [c, s[c] ?? null])),
    points_forts: pseudo.scrubText(s.points_forts || null),
    points_amelioration: pseudo.scrubText(s.points_amelioration || null),
    commentaire: pseudo.scrubText(s.commentaire || null),
    duree_minutes: s.duree_minutes ?? null,
  }));

  // PCM — LISTE BLANCHE stricte. `riskAlert` / `rpsIndicators` sont
  // VOLONTAIREMENT EXCLUS : l'audit du module PCM (chantier 2.43.0) a établi
  // que cet indicateur est un artefact statistique (≈32 % de faux positifs sur
  // des réponses aléatoires) — le transmettre à l'IA, ou l'afficher dans une
  // note de préparation, ferait porter à la personne une alerte que la mesure
  // ne soutient pas. Les scores bruts et l'indice de confiance ne servent pas
  // à préparer un entretien : ils ne partent pas non plus.
  const pcmSrc = data.pcm;
  const pcmPayload = pcmSrc ? {
    type_base: pcmSrc.base?.type || pcmSrc.base_type || null,
    nom_base: pcmSrc.base?.nom || null,
    type_phase: pcmSrc.phase?.type || pcmSrc.phase_type || null,
    nom_phase: pcmSrc.phase?.nom || null,
    canal_communication: pcmSrc.base?.canal || null,
    besoin_psychologique: pcmSrc.base?.besoinPsychologique || null,
    points_forts: Array.isArray(pcmSrc.base?.pointsForts) ? pcmSrc.base.pointsForts : null,
    reperes_communication: Array.isArray(pcmSrc.communicationTips) ? pcmSrc.communicationTips : null,
    a_faire_a_eviter: pcmSrc.comportementsPrincipaux?.avecManager || null,
    signaux_de_tension: pcmSrc.comportementsPrincipaux?.sousStress || null,
  } : null;

  const dossier = {
    personne: {
      reference: ref,
      poste: emp.position_name || emp.position || 'Non affecté',
      equipe: emp.team_name || null,
      tranche_age: ageBracket(emp.birth_date),
      date_debut: emp.insertion_start_date || emp.contract_start || null,
      permis_b: emp.has_permis_b ?? null,
      caces: emp.has_caces ?? null,
    },
    cv_texte_brut: pseudo.scrubText(cand?.cv_raw_text || null),
    entretien_recrutement: {
      commentaire_evaluateur_libre: pseudo.scrubText(cand?.interview_comment || null),
      structure: entretienStructure,
    },
    mises_en_situation: misesEnSituation.length ? misesEnSituation : null,
    test_pratique_resultat: cand?.practical_test_result || null,
    test_pratique_commentaire: pseudo.scrubText(rec.candidatPlus?.practical_test_comment || null),
    reperes_pcm: pcmPayload,
    freins_registre_disponibles: FREIN_KEYS,
  };

  // Traçabilité HONNÊTE des sources : ce qui manque est NOMMÉ, jamais comblé.
  const manques = [];
  if (!cand) manques.push('Aucune fiche de recrutement liée à ce collaborateur');
  if (!dossier.cv_texte_brut) manques.push('CV non disponible (aucun texte de CV enregistré)');
  if (!entretienStructure) manques.push("Entretien de recrutement structuré non renseigné");
  if (!cand?.interview_comment) manques.push("Commentaire libre de l'entretien de recrutement absent");
  if (!misesEnSituation.length) manques.push('Aucune mise en situation enregistrée');
  if (!pcmPayload) manques.push('Profil PCM non disponible (test non passé ou rapport illisible)');
  const sources = {
    has_cv: !!dossier.cv_texte_brut,
    has_interview_form: !!entretienStructure,
    has_interview_comment: !!cand?.interview_comment,
    has_mise_en_situation: misesEnSituation.map((s) => s.type),
    has_pcm: !!pcmPayload,
    manques,
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: SYSTEM_NOTE_PROFIL,
    messages: [{
      role: 'user',
      content: `Rédige la NOTE DE PROFIL INITIAL de cette personne, à remettre au CIP avant le diagnostic d'accueil.

Dossier disponible (les sources absentes valent « non renseigné » — ne les comble pas) :
${JSON.stringify(dossier, null, 2)}

Réponds STRICTEMENT en JSON avec les clés :
- synthese : string (4-6 phrases, factuelles, sans pronostic ; ce que le dossier montre et ce qu'il ne montre pas)
- expression_de_la_personne : string[] (ce que LA PERSONNE dit d'elle-même — son projet, ses attentes, les contraintes qu'elle pose, ce qu'elle refuse — EN SES MOTS, entre guillemets, tirés des sections motivation / projet professionnel / organisation de l'entretien structuré ; tableau vide si l'entretien n'a pas été renseigné)
- structure_personnalite : { type_pcm_base: string|null, phase: string|null, canaux_communication: string, besoins_psychologiques: string, points_forts: string[], signaux_stress_a_observer: string[], conseils_posture_cip: string[] } (repères de COMMUNICATION uniquement ; null partout si aucun PCM ; signaux formulés « signal observable → ce qui aide », jamais en termes cliniques)
- freins_pressentis : [{ frein: une clé parmi ${FREIN_KEYS.join('|')}, niveau_suggere: 1-5 ou null si non évaluable, justification: string factuelle et sourcée, source: "cv"|"entretien"|"mise_en_situation"|"pcm" }] (UNIQUEMENT les freins pour lesquels le dossier apporte un élément ; ces niveaux sont des SUGGESTIONS que le CIP confirme ou corrige au diagnostic)
- competences_observees : string[] (avec la provenance entre parenthèses)
- points_vigilance_entretien : string[] (points à aborder avec tact au premier entretien, formulés comme des questions à poser, jamais comme des conclusions)
- questions_suggerees_diagnostic : string[] (5 à 8 questions ouvertes concrètes)
- limites : string (ce que cette note ne permet PAS de dire, compte tenu des sources manquantes : ${manques.length ? manques.join(' ; ') : 'aucune source manquante'})`,
    }],
  });

  const text = extractText(response);
  const blocs = (response.content || []).map((b) => b.type).join(',');
  console.log(`[INSERTION][NOTE-PROFIL] emp=${employeeId} blocs=[${blocs}] len=${text.length} stop=${response.stop_reason}`);
  let contenu;
  if (!text) {
    contenu = { synthese: `Le modèle IA n'a renvoyé aucun contenu texte (blocs=[${blocs}], stop=${response.stop_reason}). Relancez la génération ; si cela persiste, vérifiez CLAUDE_MODEL et le quota Anthropic.` };
  } else {
    const parsed = parseJsonLoose(text);
    // JAMAIS silencieux (doctrine auditGlobalReport) : un JSON inexploitable
    // renvoie le texte brut sous `_raw`, jamais une note faussement structurée.
    const hasContent = parsed && (parsed.synthese
      || (Array.isArray(parsed.freins_pressentis) && parsed.freins_pressentis.length)
      || (Array.isArray(parsed.questions_suggerees_diagnostic) && parsed.questions_suggerees_diagnostic.length)
      || parsed.structure_personnalite);
    if (hasContent) {
      contenu = parsed;
      if (response.stop_reason === 'max_tokens') contenu._tronque = true;
    } else {
      console.warn(`[INSERTION][NOTE-PROFIL] JSON non exploitable (stop=${response.stop_reason}) — repli texte brut`);
      contenu = { _raw: text, _tronque: response.stop_reason === 'max_tokens' };
    }
  }

  // Ré-hydratation côté serveur : le jeton « Salarié A » redevient le nom réel
  // pour le CIP (la donnée est déjà chez nous ; elle n'a jamais quitté le
  // serveur en clair).
  contenu = pseudo.rehydrate(contenu);
  // Garde-fou structurel : les suggestions de freins ne sont QUE des
  // suggestions — elles n'écrivent jamais dans insertion_diagnostics.frein_*
  // (même doctrine que computeSuggestionsFreins). Rien ici ne fait d'UPDATE.
  if (Array.isArray(contenu.freins_pressentis)) {
    contenu.freins_pressentis = contenu.freins_pressentis
      .filter((f) => f && FREIN_KEYS.includes(f.frein))
      .map((f) => ({
        frein: f.frein,
        niveau_suggere: Number.isInteger(f.niveau_suggere) && f.niveau_suggere >= 1 && f.niveau_suggere <= 5
          ? f.niveau_suggere : null,
        justification: f.justification || null,
        source: ['cv', 'entretien', 'mise_en_situation', 'pcm'].includes(f.source) ? f.source : null,
      }));
  }

  // Parcours courant (une note par salarié ET par parcours, comme le diagnostic).
  let parcoursNum = 1;
  try {
    const pn = await pool.query('SELECT COALESCE(parcours_num, 1) AS pn FROM employees WHERE id = $1', [employeeId]);
    if (pn.rows[0]) parcoursNum = Number(pn.rows[0].pn) || 1;
  } catch (e) { /* base ancienne : parcours 1 */ }

  // Persistance CHIFFRÉE (la note croise entretien de recrutement, freins
  // pressentis et repères PCM → même registre de sensibilité que le diagnostic).
  // La régénération remplace la note du parcours ; la trace de communication à
  // la CIP est CONSERVÉE (elle atteste d'un geste passé, elle ne se rejoue pas).
  const saved = await pool.query(
    `INSERT INTO insertion_notes_profil
       (employee_id, parcours_num, contenu_chiffre, sources, modele, generated_at, generated_by)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)
     ON CONFLICT (employee_id, parcours_num) DO UPDATE SET
       contenu_chiffre = EXCLUDED.contenu_chiffre,
       sources = EXCLUDED.sources,
       modele = EXCLUDED.modele,
       generated_at = NOW(),
       generated_by = EXCLUDED.generated_by
     RETURNING id, parcours_num, generated_at, communiquee_cip_at`,
    [employeeId, parcoursNum, encryptField(JSON.stringify(contenu)),
      JSON.stringify(sources), MODEL, generatedBy || null]
  );

  return {
    note: contenu,
    sources,
    parcours_num: parcoursNum,
    id: saved.rows[0]?.id || null,
    generated_at: saved.rows[0]?.generated_at || null,
    communiquee_cip_at: saved.rows[0]?.communiquee_cip_at || null,
  };
}

module.exports = {
  analyseProfilComplet,
  preparerEntretien,
  bilanCohorte,
  auditGlobalReport,
  getEmployeeInsertionData,
  analyserProfilInitial,
};
