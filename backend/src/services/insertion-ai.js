const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../config/database');

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

const SYSTEM_INSERTION = `Tu es l'IA d'accompagnement insertion de Solidata, une SIAE (Structure d'Insertion par l'Activité Économique) spécialisée dans le textile à Rouen.

Tu accompagnes le CIP (Conseiller en Insertion Professionnelle) dans le suivi des salariés en parcours d'insertion (CDDI max 24 mois).

Contexte métier :
- 4 filières : collecte (chauffeurs), tri (opérateurs chaîne de tri), logistique, boutique
- 7 freins périphériques suivis (échelle 1-5, 1=pas de frein, 5=frein majeur) :
  mobilité, santé, finances, famille, linguistique, administratif, numérique
- Jalons obligatoires : Diagnostic accueil, Bilan M+3, M+6, M+10, Sortie
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

  const [employee, diagnostic, milestones, actionPlans, pcmReport, candidate] = await Promise.all([
    pool.query(`
      SELECT e.*, e.position as position_name, t.name as team_name
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE e.id = $1
    `, [employeeId]).catch((e) => {
      console.error(`[INSERTION-AI] requête salarié dégradée (${e.code || '?'}) : ${e.message}`);
      return pool.query(`SELECT * FROM employees WHERE id = $1`, [employeeId]);
    }),
    soft(`SELECT * FROM insertion_diagnostics WHERE employee_id = $1`, [employeeId], 'diagnostic'),
    soft(`SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date`, [employeeId], 'jalons'),
    soft(`SELECT * FROM cip_action_plans WHERE employee_id = $1 ORDER BY priority, created_at`, [employeeId], 'plans'),
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
    try {
      const CryptoJS = require('crypto-js');
      const key = process.env.PCM_ENCRYPTION_KEY || process.env.JWT_SECRET;
      let decrypted = CryptoJS.AES.decrypt(pcmReport.rows[0].encrypted_report, key).toString(CryptoJS.enc.Utf8);
      if (!decrypted && process.env.JWT_SECRET && key !== process.env.JWT_SECRET) {
        // Rapports historiques chiffrés avec JWT_SECRET (avant alignement clé PCM)
        decrypted = CryptoJS.AES.decrypt(pcmReport.rows[0].encrypted_report, process.env.JWT_SECRET).toString(CryptoJS.enc.Utf8);
      }
      pcmData = JSON.parse(decrypted);
    } catch {
      pcmData = { base_type: pcmReport.rows[0].base_type, phase_type: pcmReport.rows[0].phase_type };
    }
  }

  return {
    employee: employee.rows[0],
    diagnostic: diagnostic.rows[0] || null,
    milestones: milestones.rows,
    actionPlans: actionPlans.rows,
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

  const profil = {
    salarie: {
      prenom: emp.first_name,
      nom: emp.last_name,
      poste: emp.position_name || 'Non affecté',
      equipe: emp.team_name || 'Non affecté',
      filiere: emp.team_name || emp.position_name || 'Non précisé',
      insertion_status: emp.insertion_status,
      date_debut: emp.insertion_start_date || emp.contract_start,
    },
    pcm: data.pcm ? {
      type_base: data.pcm.base?.type || data.pcm.base_type,
      type_phase: data.pcm.phase?.type || data.pcm.phase_type,
      scores: data.pcm.scores || null,
      alerte_risque: data.pcm.risk_alert || false,
    } : null,
    freins: diag ? {
      mobilite: { score: diag.frein_mobilite || diag.mobilite, detail: diag.frein_mobilite_detail },
      sante: { score: diag.frein_sante || diag.sante, detail: diag.frein_sante_detail },
      finances: { score: diag.frein_finances || diag.finances, detail: diag.frein_finances_detail },
      famille: { score: diag.frein_famille || diag.famille, detail: diag.frein_famille_detail },
      linguistique: { score: diag.frein_linguistique || diag.linguistique, detail: diag.frein_linguistique_detail },
      administratif: { score: diag.frein_administratif || diag.administratif, detail: diag.frein_administratif_detail },
      numerique: { score: diag.frein_numerique || diag.numerique, detail: diag.frein_numerique_detail },
    } : null,
    observations: diag ? {
      points_forts: diag.obs_points_forts,
      difficultes: diag.obs_difficultes,
      comportement_equipe: diag.obs_comportement_equipe,
      parcours_anterieur: diag.parcours_anterieur,
    } : null,
    jalons: data.milestones.map(m => ({
      type: m.milestone_type,
      statut: m.status,
      date_prevue: m.due_date,
      date_realise: m.completed_date,
      avis_global: m.avis_global,
      bilan: m.bilan_professionnel,
    })),
    actions_en_cours: data.actionPlans.filter(a => a.status !== 'realise' && a.status !== 'abandonne').map(a => ({
      label: a.action_label,
      categorie: a.category,
      priorite: a.priority,
      statut: a.status,
      echeance: a.echeance,
    })),
    entretien_recrutement: data.candidate?.interview_comment || null,
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2500,
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

  const text = response.content[0]?.text || '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { synthese: text };
  } catch {
    return { synthese: text };
  }
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

  const context = {
    salarie: { prenom: emp.first_name, poste: emp.position_name, equipe: emp.team_name },
    type_entretien: milestoneType,
    pcm_type: data.pcm?.base?.type || data.pcm?.base_type || null,
    freins_actuels: diag ? {
      mobilite: diag.frein_mobilite || diag.mobilite,
      sante: diag.frein_sante || diag.sante,
      finances: diag.frein_finances || diag.finances,
      famille: diag.frein_famille || diag.famille,
      linguistique: diag.frein_linguistique || diag.linguistique,
      administratif: diag.frein_administratif || diag.administratif,
      numerique: diag.frein_numerique || diag.numerique,
    } : null,
    jalons_precedents: data.milestones.filter(m => m.status === 'realise').map(m => ({
      type: m.milestone_type, avis: m.avis_global, bilan: m.bilan_professionnel,
    })),
    actions_en_cours: data.actionPlans.filter(a => a.status === 'en_cours').map(a => a.action_label),
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
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

  const text = response.content[0]?.text || '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { intro_conseillee: text };
  } catch {
    return { intro_conseillee: text };
  }
}

// ──────────────────────────────────────────────────────────────
// Bilan de cohorte — Analyse globale des parcours actifs
// ──────────────────────────────────────────────────────────────

async function bilanCohorte() {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  // Tous les salariés en parcours actif avec diagnostic
  const actifs = await pool.query(`
    SELECT e.id, e.first_name, e.last_name, e.insertion_status,
           e.insertion_start_date, e.contract_start,
           e.position as position_name, t.name as team_name,
           d.frein_mobilite, d.frein_sante, d.frein_finances, d.frein_famille,
           d.frein_linguistique, d.frein_administratif, d.frein_numerique
    FROM employees e
    LEFT JOIN insertion_diagnostics d ON d.employee_id = e.id
    LEFT JOIN teams t ON e.team_id = t.id
    WHERE e.is_active = true
      AND (e.insertion_status = 'en_parcours' OR d.id IS NOT NULL)
    ORDER BY e.insertion_start_date NULLS LAST
  `);

  // Jalons en retard (secondaire : ne doit pas casser le bilan si colonne absente)
  const retards = await pool.query(`
    SELECT m.employee_id, e.first_name, e.last_name, m.milestone_type,
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

  const cohorteData = {
    nb_salaries_actifs: actifs.rows.length,
    profils: actifs.rows.map(e => ({
      nom: `${e.first_name} ${e.last_name}`,
      poste: e.position_name,
      equipe: e.team_name,
      anciennete_mois: e.insertion_start_date
        ? Math.round((Date.now() - new Date(e.insertion_start_date)) / (30 * 86400000))
        : null,
      freins: {
        mobilite: e.frein_mobilite || e.mobilite,
        sante: e.frein_sante || e.sante,
        finances: e.frein_finances || e.finances,
        famille: e.frein_famille || e.famille,
        linguistique: e.frein_linguistique || e.linguistique,
        administratif: e.frein_administratif || e.administratif,
        numerique: e.frein_numerique || e.numerique,
      },
    })),
    jalons_en_retard: retards.rows.map(r => ({
      salarie: `${r.first_name} ${r.last_name}`,
      jalon: r.milestone_type,
      date_prevue: r.due_date,
    })),
    actions_en_retard: actionsRetard.rows.map(a => ({
      salarie: `${a.first_name} ${a.last_name}`,
      action: a.action_label,
      echeance: a.echeance,
      priorite: a.priority,
    })),
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
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

  const text = response.content[0]?.text || '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { synthese: text };
  } catch {
    return { synthese: text };
  }
}

// ──────────────────────────────────────────────────────────────
// Audit insertion — Rapport de situation globale de la structure
// (direction + CIP) à partir des indicateurs chiffrés ET des
// verbatims anonymisés des CIP/agents.
// ──────────────────────────────────────────────────────────────

async function auditGlobalReport({ kpis, verbatims }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  const payload = { indicateurs_chiffres: kpis, verbatims_anonymises: verbatims };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
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

  const text = response.content[0]?.text || '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { synthese_direction: text };
  } catch {
    return { synthese_direction: text };
  }
}

module.exports = {
  analyseProfilComplet,
  preparerEntretien,
  bilanCohorte,
  auditGlobalReport,
  getEmployeeInsertionData,
};
