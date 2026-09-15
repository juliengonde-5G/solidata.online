/**
 * CONTRAT D'INSERTION — la règle de périmètre, source unique.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 *
 * Deux modules ont besoin de la même réponse à la même question — « cette
 * personne est-elle en insertion ? » : le module **Effectifs ETP**, qui compte
 * les postes conventionnés face aux états ASP, et le module **Insertion**, dont
 * l'espace CIP ne doit lister que les personnes accompagnées. La règle est
 * subtile (un CDI « Inclusion » compte, un CDI ordinaire non ; un CDD dont le
 * poste porte « Cddi » compte, un « Cariste Manutentionnaire » non), elle a été
 * établie contre les états ASP réels en 2.24.0, et elle a déjà été resserrée
 * une fois. La recopier ailleurs, c'est garantir que les deux écrans finiront
 * par donner deux périmètres différents de la même structure.
 *
 * Module PUR : aucune requête, aucun état. Il décide sur ce qu'on lui donne.
 */

const stripAccents = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');

const isCddi = (t) => String(t || '').toUpperCase() === 'CDDI';
const isCdi = (t) => String(t || '').toUpperCase() === 'CDI';
const isCdd = (t) => String(t || '').toUpperCase() === 'CDD';
/** Le salarié a (ou a eu) un parcours d'insertion dans l'ERP. */
const hasParcours = (emp) => !!emp.insertion_status && emp.insertion_status !== 'none';

/**
 * Types de contrat JAMAIS conventionnés à l'aide au poste, quel que soit le
 * statut de la personne : apprentissage, stage, contrat de professionnalisation,
 * intérim. (Le libellé Malibou brut est parfois conservé tel quel à l'import —
 * on teste donc de façon insensible aux accents et à la casse.)
 */
function typeHorsInsertion(contractType) {
  const s = stripAccents(String(contractType || '')).toLowerCase();
  return /appren|stage|stagiaire|profession|interim/.test(s);
}

/** Intitulé de poste marquant l'insertion (« … Cddi », « CDI Inclusion »). */
function posteInsertion(positionTitle) {
  return /cddi|inclusion/i.test(stripAccents(String(positionTitle || '')));
}

/**
 * RÈGLE DE PÉRIMÈTRE — quels contrats entrent dans le décompte des ETP
 * conventionnés (correction 2026-08 : le décompte comptait des personnes qui
 * NE SONT PAS en insertion, d'où une SURESTIMATION des mois récents face aux
 * états ASP).
 *
 *   (a) EXCLUSION ABSOLUE des contrats d'apprentissage / stage / contrat de
 *       professionnalisation / intérim : ces contrats ne sont jamais
 *       conventionnés au titre de l'aide au poste, même si la personne a par
 *       ailleurs un parcours d'insertion dans l'ERP.
 *   (b) CDI : retenu UNIQUEMENT si l'intitulé de poste porte la marque de
 *       l'insertion (« … Cddi », « CDI Inclusion ») ou si la fiche porte le
 *       motif explicite `cdi_inclusion`. Un CDI ordinaire ne compte jamais —
 *       y compris pour un ancien salarié en parcours : l'avenant de passage en
 *       CDI (dont l'intitulé perd la mention « Cddi ») fait sortir la personne
 *       du décompte À PARTIR DE SA DATE D'EFFET, les périodes CDDI antérieures
 *       restant comptées (le filtrage est fait ligne à ligne sur les périodes
 *       effectives chaînées d'employee_contracts).
 *   (c) CDD : requalification en CDDI de fait (données héritées d'avant
 *       l'import 2.20.0, qui stockait le type brut Malibou « CDD ») si
 *       l'intitulé de poste contient « Cddi », OU si le salarié est déclaré à
 *       l'ASP (`emp.declare_asp`, jointure etp_asp_salaries), OU — repli des
 *       bases anciennes — si AUCUN intitulé de poste n'est connu et que la
 *       personne a un parcours d'insertion (`emp.insertion_status` ≠ 'none').
 *       L'ancienne règle « tout CDD d'un salarié ayant un parcours » était
 *       trop large dès lors que le poste EST connu : elle faisait entrer des
 *       CDD ordinaires (« Cariste Manutentionnaire ») et les permanents issus
 *       d'un parcours clôturé. Un poste connu SANS mention « Cddi » exclut
 *       donc désormais, tandis qu'un poste inconnu conserve le comportement
 *       historique (aucune régression sur une base non réimportée).
 *
 * @param {Object} contrat { contract_type, position_title }
 * @param {Object} emp     { cddi_derogation_motif, declare_asp, … }
 */
function keepContractForInsertion(contrat, emp) {
  const type = contrat && contrat.contract_type;
  const poste = contrat && contrat.position_title;
  if (typeHorsInsertion(type)) return false;                            // (a)
  if (isCddi(type)) return true;
  if (isCdi(type)) {                                                    // (b)
    return posteInsertion(poste) || (emp && emp.cddi_derogation_motif === 'cdi_inclusion');
  }
  if (isCdd(type)) {                                                    // (c)
    if (posteInsertion(poste)) return true;
    if (emp && emp.declare_asp) return true;
    const posteConnu = poste != null && String(poste).trim() !== '';
    if (posteConnu) return false;
    return !!(emp && emp.insertion_status && emp.insertion_status !== 'none');
  }
  return false;
}

/**
 * PÉRIMÈTRE DE L'ESPACE CIP — cette personne relève-t-elle de l'accompagnement ?
 *
 * Plus large que `keepContractForInsertion`, et pour une raison précise : ce
 * dernier répond à « ce CONTRAT est-il conventionné ce mois-ci ? », question
 * comptable qui sort une personne dès la date d'effet de son avenant en CDI
 * ordinaire. La CIP, elle, garde le dossier ouvert après la sortie — les
 * entretiens de **suivi post-sortie** existent précisément pour cela (M+3,
 * M+6). Une personne recrutée en permanent à la fin de son parcours doit donc
 * rester dans l'espace CIP alors qu'elle a quitté le décompte ASP.
 *
 * Est retenue la personne qui remplit AU MOINS l'une des deux conditions :
 *   1. un parcours d'insertion est ouvert, clôturé ou abandonné dans l'ERP
 *      (`insertion_status` ≠ 'none') — la CIP en est responsable ;
 *   2. au moins un de ses contrats est un contrat d'insertion au sens de
 *      `keepContractForInsertion` — elle vient d'arriver et son parcours n'a
 *      pas encore été ouvert : la faire disparaître empêcherait justement de
 *      l'ouvrir.
 *
 * Sont donc écartés les permanents jamais passés par un parcours, les
 * apprentis, les stagiaires et les CDD ordinaires — c'est-à-dire exactement
 * les personnes dont la CIP n'a pas la charge (demande client du 10/09/2026).
 *
 * @param {Object} emp      { insertion_status, cddi_derogation_motif, declare_asp, position }
 * @param {Array}  contrats [{ contract_type, position_title }] — peut être vide
 * @returns {boolean}
 */
function relevantDeLaCip(emp, contrats) {
  if (hasParcours(emp)) return true;
  return (contrats || []).some((c) => keepContractForInsertion(
    { contract_type: c.contract_type, position_title: c.position_title || (emp && emp.position) },
    emp
  ));
}

module.exports = {
  stripAccents,
  isCddi, isCdi, isCdd,
  hasParcours,
  typeHorsInsertion,
  posteInsertion,
  keepContractForInsertion,
  relevantDeLaCip,
};
