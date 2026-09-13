/**
 * Documents destinés au référent unique — PR B, lot 3.
 *
 * Deux impressions A4, même mécanisme que les autres PDF du module (fenêtre
 * dédiée + `window.print()`, aucune librairie ajoutée) :
 *  - `exportFicheReferentPDF` : le point de situation transmis au référent ;
 *  - `exportReleveAssiduitePDF` : le relevé d'assiduité, en deux variantes.
 *
 * ═══ CE QUE CES DOCUMENTS NE DISENT JAMAIS ════════════════════════════════
 * Le composeur serveur (`services/fiche-referent.js`) travaille en LISTE
 * BLANCHE : santé et judiciaire n'ont aucune clé dans les données reçues ici.
 * Ce fichier n'a donc rien à filtrer — et c'est délibéré : un filtrage côté
 * impression serait le dernier rempart, c'est-à-dire un rempart qu'on oublie.
 * Il se contente de ne pas RÉINTRODUIRE de vocabulaire : jamais « seuil »,
 * jamais « obligation », jamais « injustifiée ».
 *
 * Le pied de page porte la mention de remise à la PERSONNE : ce qu'on dit
 * d'elle à un tiers, elle doit pouvoir le lire (matrice autorité 09 (f)).
 */

import { openPrintWindow, esc, frDate } from './pdf-insertion';
import { formatEmployeeName } from '../../utils/names';
import { DESTINATAIRE_LABELS, MOMENT_LABELS, TYPE_LABELS_RSA } from './entretiens-rsa';

const NR = '<em style="color:#9ca3af">non renseigné</em>';
const val = (v) => (v == null || v === '' ? NR : esc(String(v)));

/** Motifs d'absence — vocabulaire volontairement grossier, jamais médical. */
const MOTIF_LABELS = {
  sante: 'Santé',
  administratif: 'Démarche administrative',
  garde: 'Garde d’enfant',
  transport: 'Transport',
  autre: 'Autre',
  // La règle centrale de ces documents : on constate qu'on ne sait pas, on
  // n'accuse pas. « Injustifiée » n'existe nulle part dans ce fichier.
  sans_motif: 'Motif non renseigné',
};

const PRESENCE_LABELS = { present: 'Présent', absent: 'Absent', excuse: 'Excusé' };
const ORIGINE_LABELS = { salarie: 'Exprimé par la personne', cip: 'Proposé par la conseillère' };
const OBJ_STATUT_LABELS = {
  a_venir: 'À venir', en_cours: 'En cours', atteint: 'Atteint',
  partiellement_atteint: 'Partiellement atteint', abandonne: 'Abandonné', reporte: 'Reporté',
};
const NATURE_LABELS = {
  competence: 'Compétence', insertion: 'Insertion professionnelle',
  socialisation: 'Socialisation', frein: 'Levée de frein',
  job_dating: 'Job dating', formation: 'Formation',
};
const CATEGORIE_PAIE_LABELS = { sick: 'Arrêt de travail', absence: 'Absence', holiday: 'Congés' };

/** En-tête commun aux deux documents. */
function entete(titre, nom, sousTitre) {
  return '<div class="header"><div><h1>' + esc(titre) + '</h1>'
    + '<div class="sub">' + esc(nom) + (sousTitre ? ' — ' + esc(sousTitre) : '') + '</div></div>'
    + '<div class="sub" style="text-align:right">Solidarité Textiles<br/>Structure d\'accueil (ACI)</div></div>';
}

/** Pied de page commun : mentions de droits + double remise. */
function pied(mentions) {
  const droits = mentions && mentions.droits
    ? mentions.droits
    : "Document transmis au référent unique dans le cadre de l'accompagnement socio-professionnel. "
      + "La personne concernée dispose d'un droit d'accès, de rectification et d'opposition auprès de la structure.";
  return '<div class="section"><div class="card" style="background:#F8FAFC;font-size:9px;color:#475569">'
    + esc(droits) + '</div></div>'
    + '<div class="sign">'
    + '<div>La conseillère en insertion professionnelle :<br/>Date et signature<br/><br/></div>'
    + '<div>Exemplaire remis à la personne concernée le : ……… / ……… / …………<br/>Signature<br/><br/></div>'
    + '</div>'
    + '<div class="footer">SOLIDATA ERP — Document confidentiel. Solidarité Textiles est structure d\'accueil : '
    + 'elle alimente le référent unique désigné par l\'orienteur, elle ne tient pas le contrat d\'engagements '
    + 'réciproques. — édité le ' + new Date().toLocaleDateString('fr-FR') + '</div>';
}

/**
 * FICHE POUR LE RÉFÉRENT — les neuf rubriques du contrat, dans l'ordre.
 * @param {object} contenu objet rendu par le serveur (liste blanche)
 * @param {object} meta { moment, genere_le } — facultatif
 */
export function exportFicheReferentPDF(contenu, meta = {}) {
  const c = contenu || {};
  const id = c.identite || {};
  const nom = formatEmployeeName(id.nom, id.prenom);
  const periode = id.periode || {};
  const emploi = c.situation_emploi || {};
  const act = c.activite || {};
  const ass = c.assiduite || {};

  // ── 1-2. Identité, destinataire, situation d'emploi ─────────────────────
  const dest = id.destinataire || {};
  const cons = id.conseillere || {};
  const identite =
    '<div class="section"><div class="section-title">Destinataire et période</div><div class="card">'
    + '<strong>Personne accompagnée :</strong> ' + esc(nom)
    + '   <strong>Identifiant interne :</strong> ' + val(id.identifiant_interne)
    + (id.matricule ? '   <strong>Matricule :</strong> ' + esc(id.matricule) : '') + '\n'
    + '<strong>Référent unique :</strong> ' + esc(DESTINATAIRE_LABELS[dest.type] || dest.type || '—')
    + (dest.nom ? ' — ' + esc(dest.nom) : '') + (dest.contact ? ' (' + esc(dest.contact) + ')' : '') + '\n'
    + '<strong>Période couverte :</strong> du ' + frDate(periode.du) + ' au ' + frDate(periode.au)
    + (meta.moment ? '   <strong>Motif :</strong> ' + esc(MOMENT_LABELS[meta.moment] || meta.moment) : '') + '\n'
    + '<strong>Conseillère en insertion :</strong> ' + val(cons.nom)
    + (cons.contact ? ' (' + esc(cons.contact) + ')' : '')
    + '</div></div>';

  const situation =
    '<div class="section"><div class="section-title">Situation d\'emploi</div><div class="card">'
    + '<strong>Contrat :</strong> ' + val(emploi.type_contrat)
    + '   <strong>Du :</strong> ' + frDate(emploi.date_debut)
    + '   <strong>Au :</strong> ' + frDate(emploi.date_fin_prevue) + '\n'
    + '<strong>Quotité hebdomadaire :</strong> ' + (emploi.quotite_hebdo != null ? esc(emploi.quotite_hebdo) + ' h' : NR)
    + '   <strong>Parcours n° :</strong> ' + val(emploi.parcours_num) + '\n'
    + '<strong>Pass IAE :</strong> ' + val((emploi.pass_iae || {}).statut)
    + ((emploi.pass_iae || {}).fin ? '   <strong>Échéance :</strong> ' + frDate(emploi.pass_iae.fin) : '')
    + '</div></div>';

  // ── 3. Activité hebdomadaire ────────────────────────────────────────────
  // Le titre dit « Activité hebdomadaire » et la ligne de synthèse « Semaines
  // en dessous de 15 h : N ». Jamais « seuil », jamais « obligation » : ce
  // document peut être lu par la personne, et le compteur n'est pas une règle
  // qu'on lui oppose.
  const semaines = Array.isArray(act.semaines) ? act.semaines : [];
  const activiteRows = semaines.map((s) =>
    '<tr><td>S' + esc(s.iso_week) + '</td>'
    + '<td>' + (s.heures_travail == null ? '<em>non relevé</em>' : esc(s.heures_travail) + ' h') + '</td>'
    + '<td>' + (s.minutes_accompagnement ? esc(s.minutes_accompagnement) + ' min' : '—') + '</td>'
    + '<td>' + (s.jours_pmsmp ? esc(s.jours_pmsmp) + ' j' : '—') + '</td></tr>'
  ).join('');
  const activite =
    '<div class="section"><div class="section-title">Activité hebdomadaire</div>'
    + '<div class="card">Semaines en dessous de 15 h sur la période : <strong>' + (act.nb_semaines_sous_seuil || 0) + '</strong>'
    + (Array.isArray(act.raisons_categorisees) && act.raisons_categorisees.length
      ? '\nExplications relevées : ' + esc(act.raisons_categorisees.map((r) => `S${r.iso_week} (${r.categorie})`).join(', '))
      : '')
    + '\nUne semaine dont les heures ne sont pas encore relevées par la paie n\'est pas comptée comme une semaine sans activité.'
    + '</div>'
    + (activiteRows
      ? '<table><thead><tr><th>Semaine</th><th>Heures travaillées</th><th>Accompagnement</th><th>Immersion</th></tr></thead>'
        + '<tbody>' + activiteRows + '</tbody></table>'
      : '<div class="card">Aucune semaine relevée sur la période.</div>')
    + '</div>';

  // ── 4. Assiduité ────────────────────────────────────────────────────────
  const motifs = ass.absences_par_motif || {};
  const motifsLigne = Object.entries(motifs)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => (MOTIF_LABELS[k] || k) + ' : ' + n)
    .join('   ');
  const assiduite =
    '<div class="section"><div class="section-title">Assiduité aux rendez-vous</div><div class="card">'
    + '<strong>Rendez-vous proposés :</strong> ' + (ass.rdv_proposes != null ? ass.rdv_proposes : 0)
    + '   <strong>Honorés :</strong> ' + (ass.rdv_honores != null ? ass.rdv_honores : 0)
    + (motifsLigne ? '\n<strong>Absences par motif :</strong> ' + esc(motifsLigne) : '\nAucune absence enregistrée.')
    + '</div></div>';

  // ── 5. Freins (7 axes — ni santé, ni judiciaire) ────────────────────────
  const freins = Array.isArray(c.freins) ? c.freins : [];
  const freinsRows = freins.map((f) =>
    '<tr><td>' + esc(f.libelle || f.axe) + '</td>'
    + '<td>' + (f.niveau_debut == null ? '<em>non évalué</em>' : f.niveau_debut + '/5') + '</td>'
    + '<td>' + (f.niveau_fin == null ? '<em>non évalué</em>' : f.niveau_fin + '/5') + '</td></tr>'
  ).join('');
  const freinsBloc = freinsRows
    ? '<div class="section"><div class="section-title">Freins périphériques suivis</div>'
      + '<table><thead><tr><th>Domaine</th><th>Début de période</th><th>Fin de période</th></tr></thead>'
      + '<tbody>' + freinsRows + '</tbody></table>'
      + '<p style="margin-top:4px;color:#64748b;font-size:9px;">1 = pas de difficulté, 5 = frein bloquant. '
      + 'Seuls les niveaux sont transmis, et seulement pour les domaines qui ne relèvent ni de la santé ni de données '
      + 'protégées par les articles 9 et 10 du RGPD.</p></div>'
    : '';

  // ── 6. Actions et orientations ──────────────────────────────────────────
  const actions = Array.isArray(c.actions) ? c.actions : [];
  const actionsRows = actions.map((a) =>
    '<tr><td>' + frDate(a.date) + '</td>'
    + '<td>' + esc(NATURE_LABELS[a.nature] || a.nature || '—') + '</td>'
    + '<td>' + val(a.partenaire) + (a.orientation_dora ? ' <span class="badge" style="background:#0D9488">DORA</span>' : '') + '</td>'
    + '<td>' + val(a.resultat) + '</td></tr>'
  ).join('');
  const actionsBloc =
    '<div class="section"><div class="section-title">Actions d\'accompagnement et orientations</div>'
    + (actionsRows
      ? '<table><thead><tr><th>Date</th><th>Nature</th><th>Partenaire</th><th>Résultat</th></tr></thead><tbody>' + actionsRows + '</tbody></table>'
      : '<div class="card">Aucune action enregistrée sur la période.</div>')
    + '</div>';

  // ── 7. Objectifs en cours ───────────────────────────────────────────────
  const objectifs = Array.isArray(c.objectifs) ? c.objectifs : [];
  const objRows = objectifs.map((o) =>
    '<tr><td>' + val(o.libelle) + '</td>'
    + '<td>' + esc(ORIGINE_LABELS[o.origine] || o.origine || '—') + '</td>'
    + '<td>' + esc(OBJ_STATUT_LABELS[o.statut] || o.statut || '—') + '</td>'
    + '<td>' + frDate(o.echeance) + '</td></tr>'
  ).join('');
  const objBloc =
    '<div class="section"><div class="section-title">Objectifs en cours</div>'
    + (objRows
      ? '<table><thead><tr><th>Objectif</th><th>Origine</th><th>Statut</th><th>Échéance</th></tr></thead><tbody>' + objRows + '</tbody></table>'
      : '<div class="card">Aucun objectif en cours enregistré.</div>')
    + '</div>';

  // ── 8. Prochaines échéances ─────────────────────────────────────────────
  const ech = c.prochaines_echeances || {};
  const echBloc =
    '<div class="section"><div class="section-title">Prochaines échéances</div><div class="hl">'
    + '<strong>Prochain rendez-vous :</strong> ' + frDate(ech.prochain_rdv) + '\n'
    + '<strong>Fin de contrat :</strong> ' + frDate(ech.fin_contrat) + '\n'
    + '<strong>Prochain point avec le référent :</strong> ' + frDate(ech.prochain_point_referent)
    + '</div></div>';

  openPrintWindow(
    'Fiche_referent_' + (id.nom || id.identifiant_interne || ''),
    entete('Fiche pour le référent unique', nom, 'point de situation')
      + identite + situation + activite + assiduite + freinsBloc + actionsBloc + objBloc + echBloc
      + pied(c.mentions)
  );
}

/**
 * RELEVÉ D'ASSIDUITÉ — deux variantes.
 * En variante « tiers » (défaut), aucune référence de pièce justificative : le
 * serveur ne l'a même pas lue. En variante « dossier », elle figure, parce que
 * c'est elle qui prouve que l'absence a été justifiée.
 */
export function exportReleveAssiduitePDF(releve) {
  const r = releve || {};
  const id = r.identite || {};
  const nom = formatEmployeeName(id.nom, id.prenom);
  const periode = id.periode || {};
  const dossier = r.variante === 'dossier';
  const t = r.totaux || {};

  const entRows = (r.entretiens || []).map((e) =>
    '<tr><td>' + frDate(e.date) + '</td>'
    + '<td>' + esc(e.type_libelle || TYPE_LABELS_RSA[e.milestone_type] || '—') + '</td>'
    + '<td>' + (e.presence ? esc(PRESENCE_LABELS[e.presence] || e.presence) : '<em>non renseignée</em>') + '</td>'
    + '<td>' + (e.presence === 'present' ? '—'
      : esc(MOTIF_LABELS[e.absence_motif] || MOTIF_LABELS.sans_motif)) + '</td>'
    + (dossier ? '<td>' + val(e.absence_piece_ref) + '</td>' : '') + '</tr>'
  ).join('');

  const actRows = (r.actions || []).map((a) =>
    '<tr><td>' + frDate(a.date) + '</td><td>' + val(a.libelle) + '</td><td>' + val(a.statut) + '</td></tr>'
  ).join('');

  const congesRows = (r.absences_paie || []).map((c) =>
    '<tr><td>' + frDate(c.du) + '</td><td>' + frDate(c.au) + '</td>'
    + '<td>' + esc(CATEGORIE_PAIE_LABELS[c.categorie] || c.categorie || '—') + '</td></tr>'
  ).join('');

  const body =
    entete('Relevé d\'assiduité', nom, dossier ? 'exemplaire dossier' : 'exemplaire pour le référent')
    + '<div class="section"><div class="card">'
    + '<strong>Période :</strong> du ' + frDate(periode.du) + ' au ' + frDate(periode.au)
    + '   <strong>Identifiant interne :</strong> ' + val(id.identifiant_interne) + '</div></div>'
    + '<div class="section"><div class="section-title">Synthèse</div><div class="hl">'
    + '<strong>Rendez-vous proposés :</strong> ' + (t.rdv_proposes || 0)
    + '   <strong>Honorés :</strong> ' + (t.rdv_honores || 0)
    + '   <strong>Absents :</strong> ' + (t.absents || 0)
    + '   <strong>Excusés :</strong> ' + (t.excuses || 0)
    + '   <strong>Sans motif renseigné :</strong> ' + (t.sans_motif || 0)
    + '\nUne absence dont le motif n\'a pas été renseigné est portée comme telle : la structure constate qu\'elle ne '
    + 'dispose pas de l\'information, elle ne se prononce pas sur son bien-fondé.'
    + '</div></div>'
    + '<div class="section"><div class="section-title">Rendez-vous d\'accompagnement</div>'
    + (entRows
      ? '<table><thead><tr><th>Date</th><th>Entretien</th><th>Présence</th><th>Motif d\'absence</th>'
        + (dossier ? '<th>Justificatif</th>' : '') + '</tr></thead><tbody>' + entRows + '</tbody></table>'
      : '<div class="card">Aucun rendez-vous sur la période.</div>')
    + '</div>'
    + (actRows
      ? '<div class="section"><div class="section-title">Actions engagées</div>'
        + '<table><thead><tr><th>Date</th><th>Action</th><th>Statut</th></tr></thead><tbody>' + actRows + '</tbody></table></div>'
      : '')
    + (congesRows
      ? '<div class="section"><div class="section-title">Absences enregistrées par la paie</div>'
        + '<table><thead><tr><th>Du</th><th>Au</th><th>Catégorie</th></tr></thead><tbody>' + congesRows + '</tbody></table>'
        + '<p style="margin-top:4px;color:#64748b;font-size:9px;">Seule la catégorie est transmise : aucun libellé de '
        + 'paie, aucune nature médicale.</p></div>'
      : '')
    + pied(null);

  openPrintWindow('Releve_assiduite_' + (id.nom || id.identifiant_interne || ''), body);
}
