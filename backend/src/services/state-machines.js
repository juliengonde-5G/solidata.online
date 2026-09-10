/**
 * Définitions déclaratives des machines à états métier.
 * Source de vérité unique des transitions autorisées (Enterprise Architect Ch2).
 *
 * Chaque machine déclare :
 *   - states: liste plate des états valides (utilisée pour CHECK PostgreSQL)
 *   - initial: état de création par défaut
 *   - terminal: états finaux (aucune transition sortante)
 *   - transitions: { from: { to: { roles: [...], precondition?, postAction? } } }
 *
 * Conventions :
 *   - tous les noms d'état sont en snake_case ASCII (pas d'accent), pour
 *     compatibilité maximale entre PostgreSQL, JSON, URLs, frontend.
 *   - les états dépréciés (ex: 'chargee' avec accent legacy) sont alias-és
 *     dans `aliases` pour rétrocompat lecture, jamais écriture.
 */

const COMMANDE_EXUTOIRE = {
  name: 'commande_exutoire',
  description: 'Workflow d\'une commande exutoire : réception → préparation → expédition → facturation.',
  initial: 'en_attente',
  terminal: ['cloturee', 'annulee'],
  states: [
    'en_attente',      // créée, pas encore confirmée (défaut DB commandes_exutoires.statut)
    'confirmee',       // ordre client validé
    'en_preparation',  // préparation logistique en cours
    'chargee',         // chargement remorque effectué (= ancienne 'chargée')
    'expediee',        // partie du centre
    'pesee_recue',     // ticket pesée client reçu
    'facturee',        // facture envoyée
    'cloturee',        // payée / clos
    'annulee',         // abandon volontaire
  ],
  aliases: {
    // Rétrocompat lecture : anciens libellés accentués/français
    'chargée': 'chargee',
    'expédiée': 'expediee',
    'cloturée': 'cloturee',
    'annulée': 'annulee',
  },
  transitions: {
    en_attente: { confirmee: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    confirmee: { en_preparation: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    en_preparation: { chargee: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    chargee: { expediee: { roles: ['ADMIN'] } },
    expediee: { pesee_recue: { roles: ['ADMIN'] } },
    pesee_recue: { facturee: { roles: ['ADMIN'] } },
    facturee: { cloturee: { roles: ['ADMIN'] } },
    cloturee: {},
    annulee: {},
  },
};

const PREPARATION_EXPEDITION = {
  name: 'preparation_expedition',
  description: 'Préparation physique d\'une expédition : planification → préparation → contrôle pesée → finalisation.',
  initial: 'planifiee',
  terminal: ['finalisee', 'annulee'],
  states: ['planifiee', 'en_chargement', 'pesee_interne', 'en_controle', 'finalisee', 'annulee'],
  aliases: {
    'planifiée': 'planifiee',
    'finalisée': 'finalisee',
  },
  transitions: {
    planifiee: { en_chargement: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    en_chargement: { pesee_interne: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    pesee_interne: { en_controle: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    en_controle: { finalisee: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    finalisee: {},
    annulee: {},
  },
};

const CONTROLE_PESEE = {
  name: 'controle_pesee',
  description: 'Contrôle de la pesée client vs interne : ouvert → conforme | ecart_acceptable | litige.',
  initial: 'ouvert',
  terminal: ['conforme', 'ecart_acceptable', 'litige_clos'],
  states: ['ouvert', 'conforme', 'ecart_acceptable', 'litige', 'litige_clos'],
  transitions: {
    ouvert: {
      conforme: { roles: ['ADMIN'] },
      ecart_acceptable: { roles: ['ADMIN'] },
      litige: { roles: ['ADMIN'] },
    },
    conforme: {},
    ecart_acceptable: {},
    litige: { litige_clos: { roles: ['ADMIN'] } },
    litige_clos: {},
  },
};

const FACTURE_EXUTOIRE = {
  name: 'facture_exutoire',
  description: 'Cycle d\'une facture exutoire : recue → conforme/ecart → validee → cloturee.',
  initial: 'recue',
  terminal: ['validee', 'rejetee'],
  states: ['recue', 'conforme', 'ecart', 'validee', 'rejetee'],
  transitions: {
    recue: {
      conforme: { roles: ['ADMIN'] },
      ecart: { roles: ['ADMIN'] },
      rejetee: { roles: ['ADMIN'] },
    },
    conforme: { validee: { roles: ['ADMIN'] } },
    ecart: { validee: { roles: ['ADMIN'] }, rejetee: { roles: ['ADMIN'] } },
    validee: {},
    rejetee: {},
  },
};

const BOUTIQUE_COMMANDE = {
  name: 'boutique_commande',
  description: 'Commande boutique (réappro 2nde main) : brouillon → envoyée → ajustée → préparation → expédiée.',
  initial: 'brouillon',
  terminal: ['expediee', 'annulee'],
  states: ['brouillon', 'envoyee', 'ajustee', 'en_preparation', 'expediee', 'annulee'],
  transitions: {
    // Vague 3 — un RESP_BTQ peut annuler SA commande tant qu'elle est en
    // brouillon (symétrie avec l'envoi). Le cloisonnement « sa boutique » est
    // garanti au niveau de la route (enforceBoutiqueForEntity) ; ici on n'ouvre
    // l'annulation qu'AU STATUT brouillon (les statuts avancés restent ADMIN/MANAGER).
    brouillon: { envoyee: { roles: ['ADMIN', 'RESP_BTQ'] }, annulee: { roles: ['ADMIN', 'RESP_BTQ'] } },
    envoyee: { ajustee: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    ajustee: { en_preparation: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    en_preparation: { expediee: { roles: ['ADMIN'] }, annulee: { roles: ['ADMIN'] } },
    expediee: {},
    annulee: {},
  },
};

const MACHINES = {
  commande_exutoire: COMMANDE_EXUTOIRE,
  preparation_expedition: PREPARATION_EXPEDITION,
  controle_pesee: CONTROLE_PESEE,
  facture_exutoire: FACTURE_EXUTOIRE,
  boutique_commande: BOUTIQUE_COMMANDE,
};

module.exports = { MACHINES };
