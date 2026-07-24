/**
 * Helpers partagés du module « Achats responsables » (RSEI-17) :
 * libellés des familles d'achat (miroir des CATEGORIES de backend/src/routes/
 * achats.js), statuts « responsable » (local / inclusif / démarche RSE /
 * labellisé), petits formateurs, cartes KPI et miroir de l'oracle aggregateFds
 * pour le statut d'une FDS (fiche manquante / sans date / périmée).
 *
 * Doctrine « jamais de valeur inventée » : une donnée manquante s'affiche
 * « — » ou un libellé honnête, JAMAIS 0 / un faux chiffre.
 */

// ── Familles d'achat (miroir des CATEGORIES backend) ──────────────────────────
export const CATEGORIES = ['fournitures', 'epi', 'transport', 'prestations', 'energie', 'alimentaire', 'autre'];
export const CATEGORIE_LABELS = {
  fournitures: 'Fournitures', epi: 'EPI', transport: 'Transport', prestations: 'Prestations',
  energie: 'Énergie', alimentaire: 'Alimentaire', autre: 'Autre', transverse: 'Transverse',
};
export const categorieLabel = (c) => CATEGORIE_LABELS[c] || c || '—';

// Familles proposées pour un critère (datalist) — familles d'achat + transverse.
export const FAMILLE_OPTIONS = [...CATEGORIES, 'transverse'];

// ── Statuts « responsable » (4 drapeaux ; responsable = au moins un vrai) ──────
export const STATUT_FLAGS = [
  { key: 'local', label: 'Local', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'inclusif', label: 'Inclusif', badge: 'bg-teal-100 text-teal-700' },
  { key: 'demarche_rse', label: 'Démarche RSE', badge: 'bg-blue-100 text-blue-700' },
  { key: 'labellise', label: 'Labellisé', badge: 'bg-violet-100 text-violet-700' },
];
export const STATUT_COLORS = { local: '#059669', inclusif: '#0d9488', demarche_rse: '#3b82f6', labellise: '#7c3aed' };

// isResponsable : miroir de l'oracle backend (au moins un des 4 drapeaux).
export const isResponsable = (f) => !!(f && (f.local || f.inclusif || f.demarche_rse || f.labellise));

// ── Uploads FDS : aligné sur documentFilter (backend/src/utils/upload-filters) ─
export const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx';
export const UPLOAD_MAX = 15 * 1024 * 1024; // 15 Mo (limite multer)

// ── Fraîcheur FDS : défaut backend FDS_FRAICHEUR_DEFAUT (365 j). Le setting
// achats.fds_fraicheur_jours peut le surcharger côté serveur ; GET /achats/fds
// ne l'expose pas, donc le registre calcule le badge « périmée » avec ce défaut.
// Le compteur « à traiter » du tableau de bord (agrégat serveur) fait foi. ──────
export const FDS_FRAICHEUR_DEFAUT = 365;

// fdsStatus : miroir de l'oracle aggregateFds (fiche manquante / sans date / périmée).
export function fdsStatus(fds, fraicheurJours = FDS_FRAICHEUR_DEFAUT) {
  const seuil = Number(fraicheurJours) > 0 ? Number(fraicheurJours) : FDS_FRAICHEUR_DEFAUT;
  const limiteT = Date.now() - seuil * 86400000;
  const hasFichier = !!fds.has_fichier;
  const refDate = fds.date_revision || fds.date_fds || null;
  const refT = refDate ? new Date(refDate).getTime() : null;
  const sansFichier = !hasFichier;
  const sansDate = !fds.date_fds && !fds.date_revision;
  const perimee = refT != null && Number.isFinite(refT) && refT < limiteT;
  const motifs = [];
  if (sansFichier) motifs.push('document FDS non joint');
  if (sansDate) motifs.push('aucune date de FDS/révision');
  if (perimee) motifs.push('FDS périmée');
  return { sansFichier, sansDate, perimee, aTraiter: sansFichier || sansDate || perimee, motifs };
}

// ── Formateurs (jamais de faux zéro) ──────────────────────────────────────────
export const apiErr = (err, fallback = 'Une erreur est survenue.') =>
  err?.response?.data?.error || err?.message || fallback;
export const frDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-FR');
};
export const isoDate = (d) => (d ? String(d).slice(0, 10) : '');
export const fmtEur = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €` : '—';
};
export const yearsList = (n = 6) => {
  const y = new Date().getFullYear();
  return Array.from({ length: n }, (_, i) => y - i);
};

// Libellé de la source de la part en montant (dashboard.montant.part_source).
export const PART_SOURCE_LABELS = { estimation_gl: 'estimation Grand Livre' };
export const partSourceLabel = (s) => PART_SOURCE_LABELS[s] || s || 'source inconnue';

// ── Carte KPI (même look que Pilotage RSE / Énergie & GES) ─────────────────────
export function StatCard({ icon: Icon, label, value, sub, tone = 'emerald' }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    teal: 'bg-teal-50 text-teal-700 border-teal-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.emerald}`}>
      <div className="flex items-center gap-2 text-xs font-medium opacity-80">{Icon && <Icon className="w-4 h-4" />}{label}</div>
      <div className="mt-1 text-2xl font-bold">{value ?? '—'}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Badges des statuts « responsable » d'un fournisseur ────────────────────────
export function StatutBadges({ fournisseur, empty = '—' }) {
  const flags = STATUT_FLAGS.filter((s) => fournisseur && fournisseur[s.key]);
  if (flags.length === 0) return <span className="text-slate-300 text-xs">{empty}</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((s) => (
        <span key={s.key} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.badge}`}>{s.label}</span>
      ))}
    </span>
  );
}
