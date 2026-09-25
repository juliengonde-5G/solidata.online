/**
 * SUIVI LOGISTIQUE UNIFIÉ — règles pures du tableau des commandes (2.59.0).
 *
 * Deux sortes de commandes passent par l'équipe logistique de Solidarité
 * Textiles : celles des EXUTOIRES (original, CSR… — tonnage, transporteur,
 * pesée client, facture) et celles des BOUTIQUES (cartons par catégorie du stock
 * de produits finis). Elles restent chacune dans leur table, mais se suivent sur
 * UN SEUL tableau, avec les mêmes colonnes. Ce fichier dit :
 *   - dans quelle colonne tombe une commande selon son statut ;
 *   - ce que fait le glisser-déposer d'une carte vers une colonne : un simple
 *     changement de statut (appel direct), une étape qui demande une saisie
 *     (la fiche s'ouvre à la bonne section), ou un refus motivé.
 * Aucune E/S ici : c'est testable et c'est la même règle pour la fiche et le
 * tableau.
 */

export const COLONNES = [
  { key: 'a_traiter', label: 'À traiter', accent: 'bg-slate-400' },
  { key: 'validee', label: 'Validée', accent: 'bg-sky-500' },
  { key: 'en_preparation', label: 'En préparation', accent: 'bg-amber-500' },
  { key: 'prete', label: 'Prête / chargée', accent: 'bg-orange-500' },
  { key: 'expediee', label: 'Expédiée', accent: 'bg-indigo-500' },
  { key: 'terminee', label: 'Terminée', accent: 'bg-emerald-500' },
];

// statut natif → colonne
const COLONNE_EXUTOIRE = {
  en_attente: 'a_traiter',
  confirmee: 'validee',
  en_preparation: 'en_preparation',
  chargee: 'prete',
  expediee: 'expediee',
  pesee_recue: 'terminee',
  facturee: 'terminee',
  cloturee: 'terminee',
};
const COLONNE_BOUTIQUE = {
  envoyee: 'a_traiter',
  ajustee: 'validee',
  en_preparation: 'en_preparation',
  expediee: 'expediee',
};

export const STATUTS_EXUTOIRE = {
  en_attente: 'En attente',
  confirmee: 'Confirmée',
  en_preparation: 'En préparation',
  chargee: 'Chargée',
  expediee: 'Expédiée',
  pesee_recue: 'Pesée reçue',
  facturee: 'Facturée',
  cloturee: 'Clôturée',
  annulee: 'Annulée',
};
export const STATUTS_BOUTIQUE = {
  brouillon: 'Brouillon (non envoyée)',
  envoyee: 'Reçue',
  ajustee: 'Validée',
  en_preparation: 'En préparation',
  expediee: 'Expédiée',
  annulee: 'Annulée',
};

export const STATUTS_PREPARATION = {
  planifiee: 'Planifiée',
  remorque_livree: 'Remorque livrée',
  en_chargement: 'En chargement',
  prete: 'Chargement terminé',
  expediee: 'Expédiée',
};

export function libelleStatut(cmd) {
  const table = cmd.type === 'boutique' ? STATUTS_BOUTIQUE : STATUTS_EXUTOIRE;
  return table[cmd.statut] || cmd.statut || '—';
}

/** Colonne d'une commande ; `null` = hors tableau (brouillon, annulée). */
export function colonneDe(cmd) {
  if (!cmd) return null;
  const table = cmd.type === 'boutique' ? COLONNE_BOUTIQUE : COLONNE_EXUTOIRE;
  return table[cmd.statut] || null;
}

/** Normalise une commande exutoire (réponse de /commandes-exutoires). */
export function depuisExutoire(c) {
  const types = Array.isArray(c.type_produit) ? c.type_produit : (c.type_produit ? [c.type_produit] : []);
  return {
    id: `exu-${c.id}`,
    type: 'exutoire',
    nativeId: c.id,
    reference: c.reference,
    destinataire: c.raison_sociale || c.client_nom || null,
    date_commande: c.date_commande,
    date_prevue: c.date_expedition_prevue || null,
    statut: c.statut,
    statut_preparation: c.statut_preparation || null,
    types_produit: types,
    tonnage_prevu: c.tonnage_prevu,
    updated_at: c.updated_at,
    raw: c,
  };
}

/** Normalise une commande boutique (réponse de /boutique-commandes). */
export function depuisBoutique(c) {
  return {
    id: `btq-${c.id}`,
    type: 'boutique',
    nativeId: c.id,
    reference: c.reference,
    destinataire: c.boutique_nom || null,
    date_commande: c.date_commande,
    date_prevue: c.date_livraison_souhaitee || null,
    statut: c.statut,
    nb_lignes: c.nb_lignes,
    nb_cartons_demande: c.nb_cartons_demande,
    nb_cartons_voulu: c.nb_cartons_voulu,
    nb_cartons_scannes: c.nb_cartons_scannes,
    poids_total_demande_kg: c.poids_total_demande_kg,
    updated_at: c.updated_at,
    raw: c,
  };
}

const ORDRE = COLONNES.map((c) => c.key);
// Une commande boutique n'a ni chargement de remorque ni pesée client : elle
// part quand ses cartons sont scannés, et c'est fini. Son parcours saute donc
// « Prête / chargée » et s'arrête à « Expédiée ».
const ORDRE_BOUTIQUE = ['a_traiter', 'validee', 'en_preparation', 'expediee'];

/**
 * Que faire quand une carte est déposée dans une colonne ?
 * @returns {{ kind: 'rien' }
 *   | { kind: 'api', method: 'patch', url: string, body?: object, succes: string }
 *   | { kind: 'fiche', section: string, message: string }
 *   | { kind: 'refus', message: string }}
 */
export function actionDeplacement(cmd, cible) {
  const source = colonneDe(cmd);
  if (!source || source === cible) return { kind: 'rien' };
  const boutique = cmd.type === 'boutique';
  const ordre = boutique ? ORDRE_BOUTIQUE : ORDRE;
  if (!ordre.includes(cible)) {
    return {
      kind: 'refus',
      message: cible === 'prete'
        ? 'Une commande boutique n\'a pas de chargement de remorque : glissez-la directement dans « Expédiée » une fois ses cartons scannés.'
        : 'Une commande boutique est terminée à son expédition.',
    };
  }
  if (ordre.indexOf(cible) < ordre.indexOf(source)) {
    return { kind: 'refus', message: 'Une commande ne revient pas en arrière. Pour la corriger, ouvrez sa fiche.' };
  }
  if (ordre.indexOf(cible) > ordre.indexOf(source) + 1) {
    return { kind: 'refus', message: 'Une étape à la fois : faites avancer la commande colonne par colonne.' };
  }

  const id = cmd.nativeId;
  if (boutique) {
    if (cible === 'validee') {
      return { kind: 'api', method: 'patch', url: `/boutique-commandes/${id}/ajuster`, body: {}, succes: 'Commande validée telle que demandée' };
    }
    if (cible === 'en_preparation') {
      return { kind: 'api', method: 'patch', url: `/boutique-commandes/${id}/preparer`, body: {}, succes: 'Préparation lancée — les cartons se scannent en « Sortie cartons »' };
    }
    // cible === 'expediee'
    return { kind: 'api', method: 'patch', url: `/boutique-commandes/${id}/expedier`, body: {}, succes: 'Commande expédiée — les cartons scannés sortent du stock' };
  }

  // Exutoire
  if (cible === 'validee') {
    return { kind: 'api', method: 'patch', url: `/commandes-exutoires/${id}/statut`, body: { statut: 'confirmee' }, succes: 'Commande confirmée' };
  }
  if (cible === 'en_preparation') {
    return { kind: 'fiche', section: 'preparation', message: 'Planifiez la préparation (transporteur, remorque, lieu de chargement) pour passer la commande en préparation.' };
  }
  if (cible === 'prete') {
    return { kind: 'fiche', section: 'preparation', message: 'Terminez le chargement et saisissez la pesée interne pour passer la commande « chargée ».' };
  }
  if (cible === 'expediee') {
    return { kind: 'fiche', section: 'preparation', message: "Expédiez depuis la préparation : c'est elle qui sort la marchandise du stock." };
  }
  // cible === 'terminee'
  return { kind: 'api', method: 'patch', url: `/commandes-exutoires/${id}/statut`, body: { statut: 'pesee_recue' }, succes: 'Pesée client reçue' };
}

/**
 * Une commande terminée depuis plus de `jours` quitte le tableau par défaut
 * (elle reste consultable via « Afficher tout l'historique »).
 */
export function estAncienneTerminee(cmd, jours = 30, maintenant = Date.now()) {
  const finale = cmd.type === 'boutique' ? cmd.statut === 'expediee' : cmd.statut === 'cloturee';
  if (!finale || !cmd.updated_at) return false;
  const t = new Date(cmd.updated_at).getTime();
  return Number.isFinite(t) && maintenant - t > jours * 86400000;
}
