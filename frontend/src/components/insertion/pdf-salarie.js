/**
 * Documents destinés à la PERSONNE accompagnée — PR C, lot 7.
 *
 * Deux impressions A4, même mécanisme que les autres PDF du module (fenêtre
 * dédiée + `window.print()`, aucune librairie ajoutée) :
 *  - `exportMonParcoursPDF` : « Mon parcours en une page » — une page, six
 *    encadrés, ce qui m'engage et ce qui engage la structure ;
 *  - `exportMonRecapPDF`    : « Mon Récap » — les étapes datées du parcours,
 *    que la personne peut montrer à qui elle veut.
 *
 * ═══ CE FICHIER NE FILTRE RIEN, ET C'EST DÉLIBÉRÉ ═════════════════════════
 * Le composeur serveur (`services/mon-parcours.js`) travaille en LISTE BLANCHE :
 * santé, judiciaire, statut social, notes de suivi et textes libres de la CIP
 * n'ont aucune clé dans les données reçues ici. Ajouter un filtre à
 * l'impression en ferait le dernier rempart — c'est-à-dire celui qu'on oublie
 * le jour où un troisième écran imprimera les mêmes données.
 *
 * Ce qu'il s'interdit, en revanche, c'est de RÉINTRODUIRE du vocabulaire : nulle
 * part « seuil », nulle part « 15 h », nulle part « obligation ». « Mon
 * parcours » affiche les heures de la semaine de la personne ; il ne les
 * compare à rien (décision 4, amendement de la CIP).
 *
 * ═══ FALC ════════════════════════════════════════════════════════════════
 * Vouvoiement simple, phrases courtes, une idée par ligne, corps ≥ 12 pt
 * (option `large` de `openPrintWindow`), et un champ absent s'écrit « pas
 * encore renseigné » — jamais un tiret seul, qui ne dit rien à qui lit.
 */

import { openPrintWindow, esc, frDate } from './pdf-insertion';
import { formatEmployeeName } from '../../utils/names';

/** Un champ non renseigné se DIT, en toutes lettres. */
const NR = '<em style="color:#6b7280">pas encore renseigné</em>';

/** Nom affiché de la personne — « NOM Prénom », comme partout dans l'outil. */
const nomPersonne = (p) => formatEmployeeName((p || {}).nom, (p || {}).prenom) || 'Vous';

/** Semaine ISO « 2026-W37 » → « semaine 37 de 2026 » (lisible, sans jargon). */
function semaineLisible(code) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(code || ''));
  return m ? `semaine ${Number(m[2])} de ${m[1]}` : null;
}

/** Heures affichées « 26 h » / « 1 h 30 » — jamais « 26.5 ». */
function heures(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const h = Math.floor(n);
  const min = Math.round((n - h) * 60);
  if (min === 0) return `${h} h`;
  if (h === 0) return `${min} min`;
  return `${h} h ${String(min).padStart(2, '0')}`;
}

/** Encadré FALC : un titre, un contenu. */
const bloc = (titre, contenu) =>
  '<div class="section"><div class="section-title">' + esc(titre) + '</div>'
  + '<div class="card">' + contenu + '</div></div>';

/** Liste à puces, ou une phrase quand il n'y a rien — jamais un cadre vide. */
function liste(items, vide) {
  if (!items || items.length === 0) return '<em style="color:#6b7280">' + esc(vide) + '</em>';
  return '<ul style="margin-left:18px">' + items.map((t) => '<li>' + t + '</li>').join('') + '</ul>';
}

/**
 * « Mon parcours en une page ».
 *
 * UNE page A4 : six encadrés, chacun borné à ce qui tient (engagements et
 * actions limités côté serveur à huit lignes, documents à dix). Le contenu vient
 * EXCLUSIVEMENT de l'objet composé par le serveur.
 *
 * @param {object} contenu réponse de `GET|POST /insertion/salarie/:id/mon-parcours`
 */
export function exportMonParcoursPDF(contenu) {
  const c = contenu || {};
  const nom = nomPersonne(c.personne);
  const structure = c.structure || {};
  const h = c.mes_heures_semaine || null;
  const rdv = c.prochain_rdv || null;
  const ref = c.mon_referent || null;

  const engagements = (c.mes_engagements || []).map((e) =>
    esc(e.titre) + (e.echeance ? ' <span style="color:#6b7280">(avant le ' + frDate(e.echeance) + ')</span>' : ''));

  const structureEngagements = (c.engagements_structure || []).map((a) =>
    esc(a.categorie_libelle)
    + (a.partenaire_nom ? ' — avec ' + esc(a.partenaire_nom) : '')
    + (a.echeance ? ' <span style="color:#6b7280">(avant le ' + frDate(a.echeance) + ')</span>' : ''));

  const documents = (c.mes_documents_remis || []).map((d) =>
    esc(d.libelle) + (d.date ? ' <span style="color:#6b7280">(' + frDate(d.date) + ')</span>' : ''));

  // Les heures : ce que vous avez fait cette semaine-là. Aucune cible, aucune
  // comparaison, aucun commentaire.
  const heuresHtml = h
    ? 'Sur la ' + esc(semaineLisible(h.semaine) || h.semaine) + ' :<br/>'
      + '• au travail : <strong>' + esc(heures(h.travail_h) || 'non relevé') + '</strong><br/>'
      + '• avec votre conseillère : <strong>' + esc(heures(h.accompagnement_h) || '0 min') + '</strong><br/>'
      + '• au total : <strong>' + esc(heures(h.total_h) || 'non relevé') + '</strong>'
    : 'Vos heures ne sont pas encore enregistrées pour la semaine passée.';

  const rdvHtml = rdv
    ? 'Le <strong>' + frDate(rdv.date) + '</strong>'
      + (rdv.heure ? ' à <strong>' + esc(rdv.heure) + '</strong>' : ' <em>(l’heure vous sera confirmée)</em>')
      + (rdv.avec ? '<br/>avec ' + esc(rdv.avec) : '')
      + '<br/><span style="color:#6b7280">Si vous ne pouvez pas venir, prévenez-nous.</span>'
    : 'Aucun rendez-vous n’est prévu pour le moment.';

  const refHtml = ref
    ? '<strong>' + esc(ref.type_libelle) + '</strong>'
      + (ref.nom ? '<br/>' + esc(ref.nom) : '')
      + (ref.contact ? '<br/>' + esc(ref.contact) : '')
    : 'Votre référent vous sera indiqué.';

  const body =
    '<div class="header"><div><h1>Mon parcours</h1>'
    + '<div class="sub">' + esc(nom) + '</div></div>'
    + '<div class="sub" style="text-align:right">' + esc(structure.nom || 'Solidarité Textiles')
    + (structure.cip_nom ? '<br/>Votre conseillère : ' + esc(structure.cip_nom) : '') + '</div></div>'
    + bloc('Ce que je fais', liste(engagements, 'Rien n’est noté pour le moment. Vous pouvez en parler avec votre conseillère.'))
    + bloc('Ce que la structure fait pour moi', liste(structureEngagements, 'Rien n’est noté pour le moment.'))
    + bloc('Mes heures de la semaine', heuresHtml)
    + bloc('Mon prochain rendez-vous', rdvHtml)
    + bloc('Mon référent', refHtml)
    + bloc('Les documents qui m’ont été remis', liste(documents, 'Aucun document ne vous a encore été remis.'))
    + '<div class="footer">Ce document est à vous. Il ne contient aucune information de santé, de justice '
    + 'ni de situation sociale. Vous pouvez demander à le corriger ou à l’effacer auprès de la structure.'
    + ' — édité le ' + new Date().toLocaleDateString('fr-FR') + '</div>';

  return openPrintWindow('Mon parcours — ' + nom, body, { large: true });
}

/**
 * « Mon Récap » — les étapes datées, partageables.
 *
 * C'est le document que la personne peut remettre à un employeur, à un
 * travailleur social, à qui elle veut. La mention de pied n'est donc pas une
 * formule : elle dit au LECTEUR ce que le document ne contient pas, pour qu'il
 * ne cherche pas ailleurs ce qu'il n'y trouvera pas.
 *
 * @param {object} contenu réponse de `GET|POST /insertion/salarie/:id/mon-recap`
 */
export function exportMonRecapPDF(contenu) {
  const c = contenu || {};
  const nom = nomPersonne(c.personne);
  const structure = c.structure || {};
  const obj = c.objectifs || {};
  const sortie = c.sortie || null;

  const contratsRows = (c.contrats || []).map((ct) =>
    '<tr><td>' + esc(ct.type || '—') + '</td>'
    + '<td>' + (ct.poste ? esc(ct.poste) : NR) + '</td>'
    + '<td>' + frDate(ct.du) + '</td>'
    + '<td>' + (ct.au ? frDate(ct.au) : '<em>en cours</em>') + '</td>'
    + '<td>' + (ct.heures_hebdo != null ? esc(ct.heures_hebdo) + ' h/semaine' : NR) + '</td></tr>').join('');

  const etapesRows = (c.etapes || []).map((e) =>
    '<tr><td style="white-space:nowrap">' + frDate(e.date) + '</td>'
    + '<td>' + esc(e.libelle) + '</td></tr>').join('');

  const sortieHtml = sortie
    ? 'Fin du parcours le <strong>' + frDate(sortie.date) + '</strong>'
      + (sortie.classification_libelle ? '<br/>' + esc(sortie.classification_libelle) : '')
      + (sortie.type_libelle ? ' — ' + esc(sortie.type_libelle) : '')
    : null;

  const body =
    '<div class="header"><div><h1>Mon Récap</h1>'
    + '<div class="sub">' + esc(nom) + '</div></div>'
    + '<div class="sub" style="text-align:right">' + esc(structure.nom || 'Solidarité Textiles')
    + (structure.activite ? '<br/>' + esc(structure.activite) : '') + '</div></div>'
    + bloc('Mes contrats',
      contratsRows
        ? '<table><thead><tr><th>Contrat</th><th>Poste</th><th>Du</th><th>Au</th><th>Durée</th></tr></thead>'
          + '<tbody>' + contratsRows + '</tbody></table>'
        : '<em style="color:#6b7280">Aucun contrat enregistré.</em>')
    + bloc('Les étapes de mon parcours',
      etapesRows
        ? '<table><thead><tr><th style="width:110px">Date</th><th>Étape</th></tr></thead>'
          + '<tbody>' + etapesRows + '</tbody></table>'
        : '<em style="color:#6b7280">Aucune étape enregistrée pour le moment.</em>')
    + bloc('Mes objectifs',
      'Objectifs atteints : <strong>' + Number(obj.atteints || 0) + '</strong><br/>'
      + 'Objectifs en cours : <strong>' + Number(obj.en_cours || 0) + '</strong>')
    + (sortieHtml ? bloc('Ma sortie de parcours', sortieHtml) : '')
    + '<div class="footer">Document établi à la demande de la personne — ne contient aucune information de santé, '
    + 'de justice ni de situation sociale. — édité le ' + new Date().toLocaleDateString('fr-FR') + '</div>';

  return openPrintWindow('Mon Récap — ' + nom, body, { large: true });
}

export default { exportMonParcoursPDF, exportMonRecapPDF };
