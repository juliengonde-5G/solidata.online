/**
 * Exports PDF du profil PCM — fiche de résultats et fiche technique.
 *
 * POURQUOI CE MODULE EXISTE.
 * Ces deux exports vivaient dans `pages/PersonalityMatrix.jsx`, l'écran
 * autonome qui listait les profils. Cet écran ne restitue plus de résultats :
 * le test « reste ancré dans la fiche du candidat et n'est plus accessible sur
 * un autre écran ». Les exports suivent donc les résultats — ils sont appelés
 * depuis l'onglet PCM du dossier candidat (`pages/Candidates.jsx`), écran
 * ADMIN/RH, et non plus depuis une liste transverse.
 *
 * Le rendu A4 est repris À L'IDENTIQUE : ces PDF circulent hors de
 * l'application (dossier de recrutement, entretien), les faire varier au
 * passage aurait rendu incomparables deux fiches éditées à quelques semaines
 * d'écart. Seul changement : une popup bloquée renvoie `false` au lieu
 * d'ouvrir un `alert()` natif — l'appelant en fait un bandeau.
 *
 * Les mentions de méthode ne sont PAS redéfinies ici : elles viennent de
 * `utils/pcm.js`, source unique partagée avec les écrans (audit PCM 2.43.0,
 * R1/R2). Une mise en garde qui varie d'un support à l'autre cesse d'en être
 * une — et un PDF est justement le support qui se lit seul.
 */
import {
  PCM_MENTION_METHODE, PCM_LIBELLE_COHERENCE, PCM_MENTION_COHERENCE,
  PCM_MENTION_CONSERVATION, PCM_MENTION_DROITS, echapperHtml,
} from './pcm';

export const TYPE_COLORS = {
  analyseur: '#3B82F6',
  perseverant: '#8B5CF6',
  empathique: '#EC4899',
  imagineur: '#6366F1',
  energiseur: '#F59E0B',
  promoteur: '#EF4444',
};

export const TYPE_LABELS = {
  analyseur: 'Analyseur',
  perseverant: 'Perseverant',
  empathique: 'Empathique',
  imagineur: 'Imagineur',
  energiseur: 'Energiseur',
  promoteur: 'Promoteur',
};

export const CATEGORY_LABELS = {
  perception: 'Perception (Base)',
  points_forts: 'Points forts',
  relation: 'Relation',
  motivation: 'Motivation (Phase)',
  stress: 'Stress (Phase)',
  communication: 'Communication',
  besoin: 'Besoins psychologiques',
  situation: 'Situation',
};

// ───────────────────────────────────────────
// Export helpers : ouvre une fenêtre A4 pour impression/PDF
// ───────────────────────────────────────────
export function openPrintWindow(title, bodyHtml) {
  const w = window.open('', '_blank', 'width=800,height=1100');
  // Popup bloquée : on REND LA MAIN à l'appelant (false) au lieu d'un alert().
  // Seul l'onglet PCM du dossier candidat appelle encore ces exports, et il
  // affiche un bandeau — un alert() natif y serait le seul de l'écran.
  if (!w) return false;
  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/>
<title>${title}</title>
<style>
  @page { size: A4; margin: 15mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.45; padding: 0; }
  .header { background: #0D9488; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 18px; font-weight: 700; }
  .header .sub { font-size: 11px; opacity: .85; }
  .section { margin: 12px 0; padding: 0 4px; }
  .section-title { font-size: 13px; font-weight: 700; color: #0D9488; border-bottom: 2px solid #0D9488; padding-bottom: 3px; margin-bottom: 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; color: white; font-size: 10px; font-weight: 600; }
  .bar-bg { background: #f3f4f6; border-radius: 4px; height: 22px; position: relative; margin-bottom: 3px; }
  .bar-fill { height: 22px; border-radius: 4px; display: flex; align-items: center; padding-left: 6px; color: white; font-size: 10px; font-weight: 600; min-width: 50px; }
  .bar-label { font-size: 9px; color: #6b7280; position: absolute; left: 4px; top: 50%; transform: translateY(-50%); }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #f9fafb; text-align: left; padding: 5px 6px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
  td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .tip-do { color: #15803d; } .tip-dont { color: #dc2626; }
  .stress-badge { display: inline-block; width: 20px; height: 20px; border-radius: 50%; text-align: center; line-height: 20px; color: white; font-size: 9px; font-weight: 700; margin-right: 4px; }
  /* Information de LECTURE, pas alarme : gris-bleu neutre et non plus rouge
     (audit PCM 2.43.0 R1 — la couleur portait à elle seule le message). */
  .lecture-note { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; margin-top: 8px; }
  .lecture-note h4 { color: #334155; font-weight: 700; margin-bottom: 4px; }
  .methode { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; margin-top: 10px; font-size: 9.5px; color: #475569; line-height: 1.5; }
  .methode strong { color: #334155; }
  .footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
  return true;
}

export function exportResultsPDF(profile) {
  const r = profile.report;
  const cand = profile.candidate;
  const date = new Date(profile.createdAt).toLocaleDateString('fr-FR');

  const immeubleHtml = (r.immeuble || []).map(e =>
    `<div class="bar-bg"><div class="bar-fill" style="width:${Math.max(e.score, 15)}%;background:${TYPE_COLORS[e.type]}">${e.nom} (${e.score}%)</div></div>`
  ).join('');

  const stressHtml = (r.phase?.stressNiveaux || []).map(s => {
    const bg = s.niveau === 1 ? '#facc15' : s.niveau === 2 ? '#f97316' : '#dc2626';
    return `<div style="margin-bottom:4px"><span class="stress-badge" style="background:${bg}">${s.niveau}</span> ${s.comportement}</div>`;
  }).join('');

  const doHtml = (r.comportementsPrincipaux?.avecManager?.do || []).map(t => `<li class="tip-do">&#10003; ${t}</li>`).join('');
  const dontHtml = (r.comportementsPrincipaux?.avecManager?.dont || []).map(t => `<li class="tip-dont">&#10007; ${t}</li>`).join('');

  // Indicateur de cohérence — jamais « alerte RPS » (audit PCM 2.43.0, R1).
  // La mention l'accompagne DANS le bloc : ce PDF circule hors de
  // l'application, il doit se lire seul.
  const coherenceHtml = profile.riskAlert
    ? `<div class="lecture-note"><h4>${echapperHtml(PCM_LIBELLE_COHERENCE)}</h4>`
      + `<ul>${(r.rpsIndicators || []).map(i => `<li>${echapperHtml(i)}</li>`).join('')}</ul>`
      + `<p style="margin-top:4px;font-size:9.5px;color:#475569">${echapperHtml(PCM_MENTION_COHERENCE)}</p></div>`
    : '';

  const methodeHtml = `<div class="methode"><strong>Méthode — à lire avant d'interpréter.</strong> ${echapperHtml(PCM_MENTION_METHODE)}</div>`;

  const body = `
    <div class="header"><div><h1>SOLIDATA — Profil PCM</h1><div class="sub">${cand.first_name} ${cand.last_name} | ${date}</div></div><div style="text-align:right"><div class="sub">Process Communication Model</div></div></div>

    <div class="section"><div class="grid2">
      <div>
        <div class="section-title">Immeuble de personnalite</div>
        ${immeubleHtml}
      </div>
      <div>
        <div class="section-title">Base et Phase</div>
        <div class="card" style="margin-bottom:8px">
          <div style="font-weight:700;margin-bottom:4px">Base : <span class="badge" style="background:${TYPE_COLORS[r.base?.type]}">${r.base?.nom}</span></div>
          <div style="font-size:10px;color:#4b5563">Perception : ${r.base?.perception || ''}</div>
          <div style="font-size:10px;color:#4b5563">Canal : ${r.base?.canal || ''}</div>
          <div style="font-size:10px;color:#4b5563">Points forts : ${(r.base?.pointsForts || []).join(', ')}</div>
          <div style="font-size:10px;color:#4b5563">Besoin : ${r.base?.besoinPsychologique || ''}</div>
        </div>
        <div class="card">
          <div style="font-weight:700;margin-bottom:4px">Phase : <span class="badge" style="background:${TYPE_COLORS[r.phase?.type]}">${r.phase?.nom}</span></div>
          <div style="font-size:10px;color:#4b5563">Besoin : ${r.phase?.besoinPsychologique || ''}</div>
          <div style="font-size:10px;color:#4b5563">Driver : ${r.phase?.driverPrincipal || ''}</div>
        </div>
      </div>
    </div></div>

    <div class="section"><div class="section-title">Comportements principaux</div>
      <div class="card" style="margin-bottom:6px"><strong>Avec les autres :</strong> ${r.comportementsPrincipaux?.avecAutres || ''}</div>
      <div class="card" style="margin-bottom:6px"><strong>Sous stress :</strong> ${r.comportementsPrincipaux?.sousStress || ''}</div>
    </div>

    <div class="section"><div class="grid2">
      <div><div class="section-title">Guide Manager</div>
        <ul style="list-style:none;padding:0">${doHtml}${dontHtml}</ul>
      </div>
      <div><div class="section-title">Niveaux de stress (Phase)</div>${stressHtml}</div>
    </div></div>

    ${coherenceHtml}
    ${methodeHtml}
    <div class="footer">SOLIDATA ERP — Document confidentiel — ${date}</div>
  `;

  return openPrintWindow(`PCM_${cand.last_name}_${cand.first_name}`, body);
}

/**
 * RESTITUTION AU CANDIDAT (2.45.0) — le document que la personne emporte.
 *
 * Elle ne voyait que son type de base à la fin du test, et aucun canal ne lui
 * rendait son résultat accessible (audit PCM, défaut D6 ; art. 15 RGPD et
 * principe déontologique de restitution). Ce document est édité depuis l'écran
 * de fin de test, par son seul jeton de passation.
 *
 * IL RÉUTILISE `openPrintWindow` — le même moteur, la même feuille de style A4
 * que les deux exports internes : un second générateur divergerait au premier
 * ajustement, et la personne recevrait un document d'une autre facture que
 * celui qui circule en interne.
 *
 * CE QU'IL NE CONTIENT PAS, et c'est le cœur du sujet :
 *   - l'indicateur de cohérence des réponses (ex-« alerte RPS ») — l'audit a
 *     mesuré 32 % de déclenchements sur des réponses aléatoires ; remettre à
 *     quelqu'un un signal de « stress élevé » tiré d'un artefact serait le
 *     contraire d'une restitution ;
 *   - les paliers de stress rédigés en vocabulaire clinique (« dépression »,
 *     « paranoïa »), le « driver » et les « masques » ;
 *   - le guide manager, qui parle d'elle à quelqu'un d'autre.
 * Le serveur ne les envoie déjà pas (`restitutionCandidat`, routes/pcm.js) :
 * cette fonction ne sait donc même pas les afficher. Deux verrous, pas un.
 *
 * @param {object} r  charge utile de GET /pcm/sessions/:token/restitution
 * @returns {boolean} false si la fenêtre d'impression a été bloquée
 */
export function exportRestitutionCandidatPDF(r) {
  const date = r?.date_passation ? new Date(r.date_passation).toLocaleDateString('fr-FR') : '';
  const base = r?.base || {};

  const puces = (liste) => (liste || []).map((t) => `<li>${echapperHtml(t)}</li>`).join('');

  const immeubleHtml = Array.isArray(r?.immeuble) && r.immeuble.length
    ? `<div class="section"><div class="section-title">Ce qui vous ressemble aussi</div>`
      + `<p style="font-size:10px;color:#475569;margin-bottom:6px">Les autres manières de fonctionner, `
      + `de la plus proche de vous à la moins proche.</p>`
      + r.immeuble.map((e) => `<div style="padding:3px 0">${e.etage}. ${echapperHtml(e.nom)}</div>`).join('')
      + `</div>`
    // Absence NOMMÉE : on ne fabrique pas un classement qu'on n'a plus.
    : (r?.note_immeuble ? `<div class="card" style="margin:12px 4px">${echapperHtml(r.note_immeuble)}</div>` : '');

  const peuMarqueHtml = r?.profil_peu_marque
    ? `<div class="card" style="margin:8px 4px"><strong>Profil peu marqué.</strong> `
      + `Plusieurs manières de fonctionner vous correspondent presque autant. `
      + `C'est fréquent, et ce n'est pas un problème.</div>`
    : '';

  const phaseHtml = r?.phase
    ? `<div class="card"><div style="font-weight:700;margin-bottom:4px">En ce moment</div>`
      + `<div style="font-size:10px;color:#4b5563">Ce qui compte le plus pour vous en ce moment : `
      + `${echapperHtml(r.phase.besoin || '')}</div></div>`
    : '';

  const body = `
    <div class="header"><div><h1>Votre résultat</h1><div class="sub">${echapperHtml(r?.prenom || '')}${date ? ` | ${date}` : ''}</div></div><div style="text-align:right"><div class="sub">SOLIDATA — Solidarité Textiles</div></div></div>

    <div class="section">
      <p style="font-size:11px;color:#334155">Voici ce que vos réponses disent de votre façon de communiquer.
      C'est une piste de discussion, pas un jugement sur vous.</p>
    </div>

    <div class="section"><div class="section-title">Votre manière de communiquer</div>
      <div class="grid2">
        <div class="card">
          <div style="font-weight:700;margin-bottom:4px">${echapperHtml(base.nom || '')}</div>
          <div style="font-size:10px;color:#4b5563">Ce à quoi vous êtes attentif d'abord : ${echapperHtml(base.perception || '')}</div>
          <div style="font-size:10px;color:#4b5563;margin-top:3px">La façon de vous parler qui marche le mieux : ${echapperHtml(base.canal || '')}</div>
          <div style="font-size:10px;color:#4b5563;margin-top:3px">Ce dont vous avez besoin pour vous sentir bien : ${echapperHtml(base.besoin || '')}</div>
        </div>
        <div>
          <div class="card" style="margin-bottom:8px">
            <div style="font-weight:700;margin-bottom:4px">Vos points forts</div>
            <ul style="padding-left:14px;font-size:10px;color:#4b5563">${puces(base.points_forts)}</ul>
          </div>
          ${phaseHtml}
        </div>
      </div>
    </div>

    ${base.avec_les_autres ? `<div class="section"><div class="section-title">Avec les autres</div><div class="card">${echapperHtml(base.avec_les_autres)}</div></div>` : ''}
    ${base.ce_qui_aide ? `<div class="section"><div class="section-title">Ce qui vous aide à bien travailler</div><div class="card">${echapperHtml(base.ce_qui_aide)}</div></div>` : ''}

    ${immeubleHtml}
    ${peuMarqueHtml}

    <div class="methode"><strong>Comment lire ce document.</strong> ${echapperHtml(PCM_MENTION_METHODE)}</div>
    <div class="methode"><strong>Vos données.</strong> ${echapperHtml(PCM_MENTION_CONSERVATION)} ${echapperHtml(PCM_MENTION_DROITS)}</div>
    <div class="footer">Document remis à la personne concernée — ${date}</div>
  `;

  return openPrintWindow(`PCM_MON_RESULTAT${r?.prenom ? `_${r.prenom}` : ''}`, body);
}

export function exportTechnicalPDF(profile, rawAnswers) {
  const cand = profile.candidate;
  const date = new Date(profile.createdAt).toLocaleDateString('fr-FR');
  const scores = profile.report.scores || {};

  const scoresHtml = Object.entries(scores).map(([type, pct]) =>
    `<tr><td><span class="badge" style="background:${TYPE_COLORS[type]}">${TYPE_LABELS[type] || type}</span></td><td style="text-align:right;font-weight:600">${pct}%</td>
    <td><div style="background:#f3f4f6;border-radius:3px;height:14px;width:100%"><div style="height:14px;border-radius:3px;width:${pct}%;background:${TYPE_COLORS[type]}"></div></div></td></tr>`
  ).join('');

  const groupedByCategory = {};
  for (const a of (rawAnswers || [])) {
    if (!groupedByCategory[a.category]) groupedByCategory[a.category] = [];
    groupedByCategory[a.category].push(a);
  }

  // Absence NOMMÉE (2.45.0). Les réponses détaillées sont purgées 30 jours
  // après la passation (settings « rgpd.pcm_reponses_retention_jours ») : passé
  // ce délai, `rawAnswers` arrive vide. La tolérance existait déjà — la fiche
  // se composait sans elles —, mais elle affichait « 0 question » au-dessus
  // d'un tableau vide, ce qui se lit comme un défaut d'affichage. On dit
  // pourquoi. Le cas « chargement en échec » est distinct et reste signalé par
  // l'écran appelant (bandeau) : ici on décrit ce que le PDF sait, à savoir
  // qu'il n'a pas de réponses.
  let answersHtml = '';
  if (!(rawAnswers || []).length) {
    answersHtml = `<tr><td colspan="4" style="padding:10px;color:#475569">`
      + `Le détail des réponses n'est plus conservé. Les réponses au questionnaire sont `
      + `supprimées peu après la passation (minimisation des données) ; seuls la synthèse, `
      + `les scores et les types de base et de phase ci-dessus sont conservés.`
      + `</td></tr>`;
  }
  for (const [cat, answers] of Object.entries(groupedByCategory)) {
    answersHtml += `<tr><td colspan="4" style="background:#F0FDFA;font-weight:700;color:#0D9488;padding:6px">${CATEGORY_LABELS[cat] || cat}</td></tr>`;
    for (const a of answers) {
      answersHtml += `<tr>
        <td style="width:30px;text-align:center;color:#9ca3af">Q${a.question_number}</td>
        <td style="width:45%">${a.question_text}</td>
        <td><span class="badge" style="background:${TYPE_COLORS[a.answer_value] || '#6b7280'}">${TYPE_LABELS[a.answer_value] || a.answer_value}</span></td>
        <td style="font-size:9px;color:#4b5563">${a.answer_label}</td>
      </tr>`;
    }
  }

  const body = `
    <div class="header"><div><h1>SOLIDATA — Fiche Technique PCM</h1><div class="sub">${cand.first_name} ${cand.last_name} | ${date} | Document interne</div></div><div style="text-align:right"><div class="sub">Resultats bruts du questionnaire</div></div></div>

    <div class="section"><div class="grid2">
      <div><div class="section-title">Synthese</div>
        <div class="card">
          <div>Base : <span class="badge" style="background:${TYPE_COLORS[profile.baseType]}">${TYPE_LABELS[profile.baseType] || profile.baseType}</span></div>
          <div style="margin-top:4px">Phase : <span class="badge" style="background:${TYPE_COLORS[profile.phaseType]}">${TYPE_LABELS[profile.phaseType] || profile.phaseType}</span></div>
          <div style="margin-top:4px">${echapperHtml(PCM_LIBELLE_COHERENCE)} : ${profile.riskAlert ? '<span style="font-weight:700;color:#334155">Oui</span>' : '<span style="color:#64748b">Non</span>'}</div>
          <div style="margin-top:2px;font-size:9px;color:#64748b">${echapperHtml(PCM_MENTION_COHERENCE)}</div>
        </div>
      </div>
      <div><div class="section-title">Scores normalises (0-100%)</div>
        <table>${scoresHtml}</table>
      </div>
    </div></div>

    <div class="section"><div class="section-title">Reponses detaillees${(rawAnswers || []).length ? ` (${rawAnswers.length} questions)` : ' — non conservees'}</div>
      <table>
        <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Reponse choisie</th></tr></thead>
        <tbody>${answersHtml}</tbody>
      </table>
    </div>

    <div class="methode"><strong>Méthode — à lire avant d'interpréter.</strong> ${echapperHtml(PCM_MENTION_METHODE)}</div>
    <div class="footer">SOLIDATA ERP — Fiche technique confidentielle — ${date}</div>
  `;

  return openPrintWindow(`PCM_TECHNIQUE_${cand.last_name}_${cand.first_name}`, body);
}
