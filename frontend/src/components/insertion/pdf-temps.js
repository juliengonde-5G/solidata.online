/**
 * PR B lot 4 — Feuille de temps d'accompagnement en PDF (export (c) de
 * l'autorité, 09 § 2 (c)). Réutilise `openPrintWindow` de `pdf-insertion.js` :
 * même gabarit A4, même charte teal, aucune librairie ajoutée.
 *
 * TROIS RÈGLES QUI SE VOIENT SUR LE PAPIER.
 *  1. **Jamais le nom du bénéficiaire** — seulement son identifiant interne.
 *     Ce document sort de la structure ; il n'a aucune raison de nommer des
 *     personnes accompagnées pour justifier le temps d'un salarié.
 *  2. **Les signatures sont HORODATÉES** et une signature manquante est écrite
 *     « manquante » en toutes lettres : c'est l'une des quatre raisons qui
 *     font écarter la dépense, elle doit se voir sans avoir à la chercher.
 *  3. **La ligne de cohérence est imprimée même quand elle est bonne.** Son
 *     absence fait écarter la dépense ; l'imprimer seulement en cas d'anomalie
 *     rendrait un document conforme indiscernable d'un document incomplet.
 *
 * Les durées sont DÉCLARATIVES et le document le dit : elles sont saisies par
 * l'intervenant à la clôture des entretiens, elles ne sortent d'aucun
 * chronomètre.
 */
import { openPrintWindow } from './pdf-insertion';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const LIBELLES_ACTIVITE = {
  entretien: 'Entretien', action: 'Action',
  atelier_collectif: 'Atelier collectif', reunion_projet: 'Réunion de projet', autre: 'Autre',
};
const LIBELLES_ORIGINE = { composee: 'Composée automatiquement', saisie: 'Saisie manuelle' };
const LIBELLES_STATUT = {
  brouillon: 'Brouillon — non signée',
  validee_intervenant: "Validée par l'intervenant",
  validee_rh: 'Validée par la RH',
};

const frDate = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '');
const frDateHeure = (v) => (v ? new Date(v).toLocaleString('fr-FR') : '');
/** Minutes en heures lisibles : 195 → « 3 h 15 ». Jamais un décimal trompeur. */
function enHeures(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')}`;
}

/**
 * @param {object} p
 * @param {object} p.feuille { annee, mois, statut, lignes, totaux, coherence,
 *                             validation_intervenant, validation_rh }
 * @param {object} [p.intervenant] { nom }
 */
export function exportFeuilleTempsPDF({ feuille = {}, intervenant = null } = {}) {
  const annee = feuille.annee;
  const mois = feuille.mois;
  const periode = `${MOIS[(Number(mois) || 1) - 1]} ${annee}`;
  const nom = (intervenant && intervenant.nom) || feuille.intervenant_nom || `Intervenant #${feuille.user_id}`;
  const lignes = Array.isArray(feuille.lignes) ? feuille.lignes : [];
  const t = feuille.totaux || { total_minutes: 0, par_projet: {}, quotites: {}, taux_forfaitaire: {} };
  const coh = feuille.coherence || { conforme: true, anomalies: [] };

  const corps = lignes.map((l) => {
    const projet = l.projet_code === 'HORS_PROJET' ? 'Hors projet' : l.projet_code;
    return '<tr>'
      + '<td>' + esc(frDate(l.date)) + '</td>'
      + '<td>' + esc(projet) + '</td>'
      + '<td>' + esc(LIBELLES_ACTIVITE[l.activite] || l.activite) + '</td>'
      // IDENTIFIANT INTERNE SEUL — jamais le nom (09 § 2 (c)).
      + '<td>' + (l.employee_id == null ? '<span style="color:#9ca3af">—</span>' : '#' + esc(l.employee_id)) + '</td>'
      + '<td style="text-align:right">' + esc(l.duree_minutes) + '</td>'
      + '<td>' + esc(LIBELLES_ORIGINE[l.origine] || l.origine) + '</td>'
      + '</tr>';
  }).join('');

  const parProjet = Object.entries(t.par_projet || {}).map(([code, minutes]) => {
    const libelle = code === 'HORS_PROJET' ? 'Hors projet' : code;
    const q = t.quotites && t.quotites[code] != null ? t.quotites[code] + ' %' : '<em>non renseignée</em>';
    const tf = t.taux_forfaitaire && t.taux_forfaitaire[code] != null ? t.taux_forfaitaire[code] + ' %' : '<em>non renseigné</em>';
    return '<tr><td>' + esc(libelle) + '</td>'
      + '<td style="text-align:right">' + esc(minutes) + ' min (' + esc(enHeures(minutes)) + ')</td>'
      + '<td>' + q + '</td><td>' + tf + '</td></tr>';
  }).join('');

  const anomalies = (coh.anomalies || []).map((a) => '<li>'
    + (a.date ? '<strong>' + esc(frDate(a.date)) + '</strong> — ' : '')
    + esc(a.detail || a.type) + '</li>').join('');

  const ligneCoherence = coh.conforme
    ? '<div class="hl" style="background:#ECFDF5;border-color:#A7F3D0">'
      + '<strong>Cohérence avec les congés : conforme.</strong> Aucune journée déclarée un jour d’absence, '
      + 'aucun dépassement du temps de travail contractuel.</div>'
    : '<div class="hl" style="background:#FFFBEB;border-color:#FDE68A">'
      + '<strong>Cohérence avec les congés : à expliquer.</strong>'
      + '<ul>' + anomalies + '</ul>'
      + '<p style="margin-top:6px;color:#92400e">Une anomalie n’empêche pas la signature : elle appelle une explication.</p></div>';

  const bloc = (v, role) => {
    if (!v) {
      return '<div><strong>' + esc(role) + '</strong><br/>'
        + '<span style="color:#b91c1c;font-weight:600">Signature manquante</span></div>';
    }
    return '<div><strong>' + esc(role) + '</strong><br/>'
      + esc(v.nom || 'utilisateur #' + v.user_id) + '<br/>'
      + '<span style="color:#64748b">signé le ' + esc(frDateHeure(v.at)) + '</span></div>';
  };

  const body =
    '<div class="header"><div><h1>SOLIDATA — Feuille de temps d’accompagnement</h1>'
    + '<div class="sub">' + esc(nom) + ' · ' + esc(periode) + '</div></div>'
    + '<div class="sub" style="text-align:right">' + esc(LIBELLES_STATUT[feuille.statut] || feuille.statut || '') + '</div></div>'

    + '<div class="section"><div class="card">'
    + '<strong>Total mensuel :</strong> ' + esc(t.total_minutes) + ' minutes (' + esc(enHeures(t.total_minutes)) + ')'
    + ' &nbsp;·&nbsp; <strong>Lignes :</strong> ' + lignes.length
    + '<br/><span style="color:#64748b">Durées déclarées par l’intervenant à la clôture des entretiens.</span>'
    + '</div></div>'

    + '<div class="section"><div class="section-title">Détail des temps</div>'
    + '<table><thead><tr><th>Date</th><th>Projet</th><th>Activité</th>'
    + '<th>Bénéficiaire (identifiant interne)</th><th style="text-align:right">Durée (min)</th><th>Origine</th>'
    + '</tr></thead><tbody>' + (corps || '<tr><td colspan="6"><em>Aucune ligne</em></td></tr>') + '</tbody></table></div>'

    + '<div class="section"><div class="section-title">Totaux par projet</div>'
    + '<table><thead><tr><th>Projet</th><th style="text-align:right">Temps</th>'
    + '<th>Quotité d’affectation</th><th>Taux forfaitaire</th></tr></thead>'
    + '<tbody>' + (parProjet || '<tr><td colspan="4"><em>Aucun projet</em></td></tr>') + '</tbody></table></div>'

    + '<div class="section">' + ligneCoherence + '</div>'

    + '<div class="section"><div class="section-title">Signatures</div>'
    + '<div class="sign">'
    + bloc(feuille.validation_intervenant, 'L’intervenant')
    + bloc(feuille.validation_rh, 'La RH')
    + '</div></div>'

    + '<div class="footer">SOLIDATA ERP — Feuille de temps d’accompagnement, pièce de justification d’une dépense cofinancée. '
    + 'Aucun nom de bénéficiaire n’y figure : seul l’identifiant interne permet le rapprochement avec le dossier. '
    + 'Document de travail ERP — les saisies officielles (Ma Démarche FSE+) font foi. '
    + 'Édité le ' + new Date().toLocaleDateString('fr-FR') + '</div>';

  openPrintWindow('Feuille_de_temps_' + String(nom).replace(/\s+/g, '_') + '_' + annee + '-' + String(mois).padStart(2, '0'), body);
}

export default exportFeuilleTempsPDF;
