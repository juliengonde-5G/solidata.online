import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Filter, Calendar, Truck, Info, ExternalLink, Users } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, PageHeader, ConfirmDialog, useToast } from '../components';
import api from '../services/api';
import { formatEmployeeName } from '../utils/names';

// ═══════════════════════════════════════════════════════════════════════════
// PLANNING HEBDOMADAIRE — refonte du 26/08/2026 (lot L5)
// ───────────────────────────────────────────────────────────────────────────
//   • Les BOUTIQUES ont quitté cet écran : leur planning est géré hors
//     logiciel (page « Planning boutiques » conservée en information).
//   • La COLLECTE se lit par VÉHICULE : une ligne par camion du parc réel,
//     et l'équipage du jour (chauffeur + suiveurs) REMONTE des tournées.
//     Ici on affiche, on ne re-saisit pas : l'équipage s'affecte au Planning
//     tournées, source unique de vérité.
//   • Les SALARIÉS PERMANENTS (encadrants, fonctions support) apparaissent
//     au même titre que les salariés en parcours, avec un badge distinctif.
// ═══════════════════════════════════════════════════════════════════════════

const FILIERE_COLORS = {
  tri: { bg: 'bg-green-50', badge: 'bg-green-100 text-green-800', header: 'bg-green-600', badgeProv: 'bg-yellow-100 text-yellow-800 border border-dashed border-yellow-400' },
  collecte: { bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-800', header: 'bg-blue-600', badgeProv: 'bg-yellow-100 text-yellow-800 border border-dashed border-yellow-400' },
  logistique: { bg: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-800', header: 'bg-yellow-600', badgeProv: 'bg-orange-100 text-orange-800 border border-dashed border-orange-400' },
  anciens: { bg: 'bg-slate-50', badge: 'bg-slate-200 text-slate-700', header: 'bg-slate-500', badgeProv: 'bg-slate-100 text-slate-600 border border-dashed border-slate-400' },
};

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const PERIODES = [
  { key: 'matin', label: 'Matin', short: 'M' },
  { key: 'apres_midi', label: 'Après-midi', short: 'AM' },
];

// Statuts de tournée — jamais affichés en anglais brut à l'écran.
const STATUT_TOURNEE = {
  planned: { label: 'Planifiée', cls: 'bg-slate-200 text-slate-700' },
  in_progress: { label: 'En cours', cls: 'bg-blue-600 text-white' },
  paused: { label: 'En pause', cls: 'bg-amber-200 text-amber-900' },
  returning: { label: 'Retour au centre', cls: 'bg-indigo-200 text-indigo-900' },
  completed: { label: 'Terminée', cls: 'bg-green-200 text-green-900' },
  cancelled: { label: 'Annulée', cls: 'bg-red-200 text-red-800' },
};
const libelleStatut = (s) => STATUT_TOURNEE[s] || { label: s || 'Statut inconnu', cls: 'bg-slate-200 text-slate-700' };

// ── Dates ──────────────────────────────────────────────────────────────────
// Les jours sont manipulés en date CIVILE locale. `toISOString()` convertit en
// UTC : à l'heure de Paris, minuit local retombe la veille — le lundi affiché
// portait alors la date du dimanche. On lit donc les composantes locales.
function isoLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseLocal(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function getMonday(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function getDates(monday) {
  return JOURS.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return isoLocal(d);
  });
}

function formatDateShort(dateStr) {
  return parseLocal(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** « NOM Prénom » d'une personne d'équipage (repli sur le nom déjà formaté). */
function nomPersonne(p) {
  if (!p) return null;
  return formatEmployeeName(p.last_name, p.first_name) || p.nom || null;
}

/** Nombre de personnes DISTINCTES dans un lot d'affectations. */
function compterEffectifs(affectations) {
  return new Set(affectations.map(a => a.employee_id)).size;
}

// ═══════════════════════════════════════════════════════════════════════════

export default function PlanningHebdo() {
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [monday, setMonday] = useState(() => {
    const weekStart = searchParams.get('week_start');
    return weekStart ? getMonday(parseLocal(weekStart)) : getMonday(new Date());
  });
  const [postes, setPostes] = useState([]);
  const [filieres, setFilieres] = useState([]);
  const [planning, setPlanning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [indisponibilites, setIndisponibilites] = useState([]);
  const [showPicker, setShowPicker] = useState(null);
  const [availableEmps, setAvailableEmps] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [aRetirer, setARetirer] = useState(null);
  const [expandedFilieres, setExpandedFilieres] = useState({ tri: true, collecte: true, logistique: true, anciens: false });
  const [filterFiliere, setFilterFiliere] = useState('all');

  const dates = useMemo(() => getDates(monday), [monday]);
  const weekStart = dates[0];

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [postesRes, planningRes] = await Promise.all([
        api.get('/planning-hebdo/postes'),
        api.get('/planning-hebdo', { params: { week_start: weekStart } }),
      ]);
      setFilieres(postesRes.data.filieres || []);
      setPostes(postesRes.data.postes || []);
      setPlanning(planningRes.data);
      // Sources indisponibles : on les DIT, on ne les déguise pas en « rien ».
      setIndisponibilites([postesRes.data.collecte_indisponible, planningRes.data.collecte_indisponible].filter(Boolean));
    } catch (err) {
      setError(err.response?.data?.error || 'Le planning de la semaine n\'a pas pu être chargé. Réessayez ou contactez un administrateur.');
    }
    setLoading(false);
  }, [weekStart]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const navigateWeek = (delta) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + 7 * delta);
    setMonday(d);
  };
  const goThisWeek = () => setMonday(getMonday(new Date()));

  const affectations = planning?.affectations || [];

  // Affectations d'un poste sur un jour/période (une journée entière couvre
  // les deux demi-journées). `posteCode` null = affectation sans poste.
  const getAffectations = useCallback((posteCode, dateStr, periode) => (
    affectations.filter(a => {
      if (a.date !== dateStr) return false;
      if ((a.poste_code || null) !== (posteCode || null)) return false;
      if (!periode) return true;
      const per = a.periode || 'journee';
      return per === 'journee' || per === periode;
    })
  ), [affectations]);

  // ── Postes obligatoires non couverts ─────────────────────────────────────
  const uncoveredAlerts = useMemo(() => {
    if (!planning) return [];
    const alerts = [];
    for (const poste of postes.filter(p => p.obligatoire)) {
      for (const d of dates) {
        for (const per of PERIODES) {
          if (getAffectations(poste.code, d, per.key).length === 0) {
            alerts.push({ poste: poste.nom, periodeLabel: per.label, jour: JOURS[dates.indexOf(d)] });
          }
        }
      }
    }
    return alerts;
  }, [planning, postes, dates, getAffectations]);

  // ── Équipages du jour, indexés par véhicule + date ────────────────────────
  const tourneesParVehicule = useMemo(() => {
    const map = {};
    for (const t of planning?.collecte_tournees || []) {
      (map[`${t.vehicle_id}_${t.date}`] ||= []).push(t);
    }
    return map;
  }, [planning]);
  const tourneesIndisponibles = planning ? planning.collecte_tournees === null : false;

  // ── Effectifs par jour (personnes distinctes, toutes filières) ────────────
  const effectifsJour = useMemo(() => {
    const map = {};
    for (const d of dates) {
      map[d] = compterEffectifs(affectations.filter(a => a.date === d));
    }
    return map;
  }, [affectations, dates]);

  // ── Postes historiques hors référentiel : rien n'est masqué ───────────────
  const anciensPostes = useMemo(() => {
    const connus = new Set(postes.map(p => p.code));
    const inconnus = new Map();
    for (const a of affectations) {
      if (a.poste_code && connus.has(a.poste_code)) continue;
      const code = a.poste_code || null;
      if (!inconnus.has(code)) {
        inconnus.set(code, { code, nom: code || 'Sans poste renseigné' });
      }
    }
    return [...inconnus.values()].sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
  }, [affectations, postes]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const openPicker = async (poste, dateStr, dateIdx, periode) => {
    setShowPicker({ poste, date: dateStr, dateIdx, periode });
    setPickerLoading(true);
    setPickerError(null);
    setAvailableEmps([]);
    try {
      const res = await api.get('/planning-hebdo/employes-disponibles', {
        params: {
          date: dateStr,
          require_permis: poste.require_permis_b ? 'true' : undefined,
          require_caces: poste.require_caces ? 'true' : undefined,
          periode,
        },
      });
      setAvailableEmps(res.data || []);
    } catch (err) {
      setPickerError(err.response?.data?.error || 'La liste des salariés disponibles n\'a pas pu être chargée.');
    }
    setPickerLoading(false);
  };

  const affecter = async (employeeId) => {
    if (!showPicker) return;
    try {
      await api.post('/planning-hebdo/affecter', {
        employee_id: employeeId,
        date: showPicker.date,
        poste_id: showPicker.poste.id,
        poste_code: showPicker.poste.code,
        periode: showPicker.periode,
      });
      setShowPicker(null);
      toast.success('Affectation enregistrée');
      loadAll();
    } catch (err) {
      setPickerError(err.response?.data?.error || "L'affectation n'a pas pu être enregistrée.");
    }
  };

  const confirmerRetrait = async () => {
    if (!aRetirer) return;
    try {
      await api.delete('/planning-hebdo/affecter', {
        data: { employee_id: aRetirer.employee_id, date: aRetirer.date, periode: aRetirer.periode || undefined },
      });
      setARetirer(null);
      toast.success('Affectation retirée');
      loadAll();
    } catch (err) {
      setARetirer(null);
      setError(err.response?.data?.error || "L'affectation n'a pas pu être retirée.");
    }
  };

  const confirmerSemaine = async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await api.post('/planning-hebdo/confirmer', { week_start: weekStart });
      toast.success(`${res.data.confirmed} affectation${res.data.confirmed > 1 ? 's' : ''} confirmée${res.data.confirmed > 1 ? 's' : ''}`);
      loadAll();
    } catch (err) {
      setError(err.response?.data?.error || "La semaine n'a pas pu être confirmée.");
    }
    setConfirming(false);
  };

  const toggleFiliere = (code) => setExpandedFilieres(prev => ({ ...prev, [code]: !prev[code] }));

  // ── Regroupements ────────────────────────────────────────────────────────
  const displayFilieres = filieres.length > 0 ? filieres : [
    { code: 'tri', label: 'Tri' }, { code: 'collecte', label: 'Collecte' }, { code: 'logistique', label: 'Logistique' },
  ];
  const filieresVisibles = displayFilieres.filter(f => filterFiliere === 'all' || f.code === filterFiliere);
  const postesDe = (code) => postes
    .filter(p => p.filiere === code)
    .sort((a, b) => (b.obligatoire ? 1 : 0) - (a.obligatoire ? 1 : 0));

  const permanents = (planning?.employees || []).filter(e => e.est_permanent);
  const enParcours = (planning?.employees || []).filter(e => !e.est_permanent);

  const totalAffectations = affectations.length;
  const provisoires = affectations.filter(a => a.is_provisional).length;
  const weekLabel = `${formatDateShort(dates[0])} — ${formatDateShort(dates[5])}`;
  const aujourdhui = isoLocal(new Date());

  // ── Fragments de rendu partagés ──────────────────────────────────────────
  const enteteJours = (
    <tr className="bg-gray-50 border-b">
      <th className="text-left p-2 text-xs font-semibold text-gray-500 w-48 min-w-[192px]">Poste</th>
      {dates.map((d, i) => (
        <th key={d} colSpan={2} className={`text-center p-2 text-xs font-semibold min-w-[140px] ${d === aujourdhui ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}>
          <div>{JOURS[i]}</div>
          <div className="text-[10px] font-normal">{formatDateShort(d)}</div>
          <div className="flex justify-center gap-0 mt-0.5">
            <span className="text-[9px] text-gray-400 w-1/2">M</span>
            <span className="text-[9px] text-gray-400 w-1/2">AM</span>
          </div>
        </th>
      ))}
    </tr>
  );

  /** Pied de tableau : effectifs distincts par demi-journée sur un lot de postes. */
  const piedEffectifs = (codes) => (
    <tfoot>
      <tr className="bg-gray-100 border-t-2 border-gray-200">
        <td className="p-2 text-[11px] font-semibold text-gray-600">Effectifs affectés</td>
        {dates.map(d => PERIODES.map(per => {
          const n = compterEffectifs(
            affectations.filter(a => a.date === d && codes.has(a.poste_code || null)
              && ((a.periode || 'journee') === 'journee' || a.periode === per.key))
          );
          return (
            <td key={`${d}_${per.key}`} className="p-1 text-center border-l border-gray-200">
              <span className={`text-[11px] font-semibold ${n > 0 ? 'text-gray-700' : 'text-gray-300'}`}>{n}</span>
            </td>
          );
        }))}
      </tr>
    </tfoot>
  );

  /** Cellule d'affectation (badges retirables + bouton d'ajout). */
  const celluleAffectation = (poste, d, dateIdx, per, { manquant = false } = {}) => {
    const affs = getAffectations(poste.code, d, per.key);
    return (
      <td key={`${d}_${per.key}`}
        className={`p-0.5 text-center align-top border-l border-gray-100 ${d === aujourdhui ? 'bg-blue-50/50' : ''} ${manquant ? 'bg-red-50/60' : ''}`}
        style={{ minWidth: '70px' }}
      >
        {affs.map(a => (
          <button key={a.id || `${a.employee_id}_${per.key}`}
            type="button"
            className={`block w-full text-[10px] rounded px-1 py-0.5 mb-0.5 truncate hover:opacity-80 ${a.is_provisional ? FILIERE_COLORS[poste.filiere]?.badgeProv || FILIERE_COLORS.anciens.badgeProv : FILIERE_COLORS[poste.filiere]?.badge || FILIERE_COLORS.anciens.badge} ${a.est_permanent ? 'ring-1 ring-indigo-400' : ''}`}
            onClick={() => setARetirer({
              employee_id: a.employee_id, date: d, periode: a.periode,
              label: `${formatEmployeeName(a.last_name, a.first_name)} — ${JOURS[dateIdx]} ${formatDateShort(d)} (${a.periode === 'journee' ? 'journée' : per.label.toLowerCase()})`,
            })}
            title={`${formatEmployeeName(a.last_name, a.first_name)}${a.est_permanent ? ' (permanent)' : ''} — cliquer pour retirer`}
          >
            {a.first_name} {a.last_name?.charAt(0)}.
          </button>
        ))}
        <button
          onClick={() => openPicker(poste, d, dateIdx, per.key)}
          className={`w-full mt-0.5 rounded border border-dashed text-[9px] py-0.5 transition ${manquant ? 'border-red-300 text-red-400 hover:bg-red-100 hover:text-red-600' : 'border-gray-300 text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
          title="Affecter un salarié"
        >
          +
        </button>
      </td>
    );
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement du planning..." /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Planning hebdomadaire"
          subtitle="Affectation des salariés par poste et filière — demi-journée"
          icon={Calendar}
          actions={
            <button onClick={confirmerSemaine} disabled={confirming || provisoires === 0} className="btn-primary text-sm">
              {confirming ? 'Confirmation...' : `Confirmer (${provisoires})`}
            </button>
          }
        />

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-800">{error}</p>
              <button onClick={loadAll} className="mt-1 text-xs font-semibold text-red-700 underline">Réessayer</button>
            </div>
          </div>
        )}

        {indisponibilites.map((motif, i) => (
          <div key={i} className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900">
              <span className="font-semibold">Donnée indisponible — </span>{motif}
              {' '}Ce qui n'a pas pu être lu n'est pas affiché comme vide.
            </p>
          </div>
        ))}

        {/* Postes obligatoires non couverts */}
        {uncoveredAlerts.length > 0 && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">
                  {uncoveredAlerts.length} poste{uncoveredAlerts.length > 1 ? 's' : ''} obligatoire{uncoveredAlerts.length > 1 ? 's' : ''} non couvert{uncoveredAlerts.length > 1 ? 's' : ''}
                </p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {uncoveredAlerts.slice(0, 12).map((a, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                      {a.poste} — {a.jour} {a.periodeLabel}
                    </span>
                  ))}
                  {uncoveredAlerts.length > 12 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-200 text-red-800 font-medium">
                      +{uncoveredAlerts.length - 12} autres
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {uncoveredAlerts.length === 0 && postes.some(p => p.obligatoire) && totalAffectations > 0 && (
          <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <p className="text-sm font-medium text-green-800">Tous les postes obligatoires sont couverts</p>
          </div>
        )}

        {/* Navigation + filtre */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={() => navigateWeek(-1)} className="p-2 rounded-lg border hover:bg-gray-50" title="Semaine précédente">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={goThisWeek} className="px-3 py-1.5 rounded-lg border hover:bg-gray-50 text-sm font-medium">Cette semaine</button>
          <button onClick={() => navigateWeek(1)} className="p-2 rounded-lg border hover:bg-gray-50" title="Semaine suivante">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
          <span className="text-sm font-semibold text-gray-700 ml-2">{weekLabel}</span>
          <span className="text-xs text-gray-400 ml-2">{totalAffectations} affectations</span>

          <div className="ml-auto flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={filterFiliere} onChange={e => setFilterFiliere(e.target.value)} className="input-modern text-xs py-1 w-auto">
              <option value="all">Toutes les équipes</option>
              {displayFilieres.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
            </select>
          </div>
        </div>

        {/* Effectifs par jour — toutes filières confondues */}
        <div className="card-modern p-3 mb-4 overflow-x-auto">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-slate-400" />
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide">Effectifs affectés par jour</h3>
          </div>
          <div className="flex gap-2 min-w-[600px]">
            {dates.map((d, i) => (
              <div key={d} className={`flex-1 rounded-lg border p-2 text-center ${d === aujourdhui ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                <div className="text-[10px] text-gray-500">{JOURS[i]} {formatDateShort(d)}</div>
                <div className={`text-lg font-bold ${effectifsJour[d] > 0 ? 'text-gray-800' : 'text-gray-300'}`}>{effectifsJour[d]}</div>
                <div className="text-[9px] text-gray-400">salarié{effectifsJour[d] > 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Sections par filière ─────────────────────────────────────────── */}
        <div className="space-y-4">
          {filieresVisibles.map(filiere => {
            const fp = postesDe(filiere.code);
            const colors = FILIERE_COLORS[filiere.code] || FILIERE_COLORS.anciens;
            const isExpanded = expandedFilieres[filiere.code];
            const estCollecte = filiere.code === 'collecte';
            const codes = new Set(fp.map(p => p.code));
            const nbOblig = fp.filter(p => p.obligatoire).length;

            return (
              <div key={filiere.code} className="card-modern overflow-hidden">
                <button onClick={() => toggleFiliere(filiere.code)} className={`w-full flex items-center justify-between px-4 py-3 ${colors.header} text-white`}>
                  <div className="flex items-center gap-2">
                    {estCollecte && <Truck className="w-4 h-4" />}
                    <span className="font-bold text-sm">{filiere.label}</span>
                    <span className="text-xs opacity-80">
                      {estCollecte ? `${fp.length} véhicule${fp.length > 1 ? 's' : ''}` : `${fp.length} poste${fp.length > 1 ? 's' : ''}`}
                    </span>
                    {nbOblig > 0 && (
                      <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">{nbOblig} obligatoire{nbOblig > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && estCollecte && (
                  <>
                    <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-start gap-2">
                      <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-blue-900">
                        Une ligne par véhicule du parc. L'<span className="font-semibold">équipage</span> (chauffeur et suiveurs) est repris
                        de la gestion de la collecte et n'est <span className="font-semibold">pas modifiable ici</span> :
                        il s'affecte au <Link to="/planning-tournees" className="underline font-semibold inline-flex items-center gap-0.5">Planning tournées <ExternalLink className="w-3 h-3" /></Link>.
                        Les cases M / AM restent affectables pour compléter l'équipe au sol.
                      </p>
                    </div>
                    {fp.length === 0 ? (
                      <div className="p-6 text-center text-sm text-gray-400">
                        Aucun véhicule de collecte disponible dans le parc (les véhicules hors service et de formation sont exclus).
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[1000px]">
                          <thead>{enteteJours}</thead>
                          <tbody>
                            {fp.map(poste => (
                              <Fragment key={poste.id}>
                                {/* Ligne 1 — équipage du jour, en LECTURE SEULE */}
                                <tr className={`border-t ${colors.bg}`}>
                                  <td rowSpan={2} className="p-2 align-top border-r border-gray-100">
                                    <div className="flex items-center gap-1.5">
                                      <Truck className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                                      <span className="text-xs font-bold text-gray-800">{poste.nom}</span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">{poste.detail}</div>
                                  </td>
                                  {dates.map(d => {
                                    const tournees = tourneesParVehicule[`${poste.vehicle_id}_${d}`] || [];
                                    return (
                                      <td key={`${d}_eq`} colSpan={2} className={`p-1 align-top border-l border-gray-100 ${d === aujourdhui ? 'bg-blue-50/60' : ''}`}>
                                        {tourneesIndisponibles ? (
                                          <div className="text-[10px] text-amber-700 italic">Tournées non lisibles</div>
                                        ) : tournees.length === 0 ? (
                                          <div className="text-[10px] text-gray-400 italic py-1">Aucune tournée planifiée</div>
                                        ) : tournees.map(t => {
                                          const st = libelleStatut(t.statut);
                                          return (
                                            <div key={t.tour_id} className="mb-1 last:mb-0 text-left">
                                              <div className="flex items-center gap-1 flex-wrap">
                                                <span className={`text-[9px] px-1 py-0.5 rounded font-semibold ${st.cls}`}>{st.label}</span>
                                                <span className="text-[9px] text-gray-400">n° {t.tour_id}</span>
                                              </div>
                                              <div className="text-[10px] text-gray-800 truncate" title={nomPersonne(t.chauffeur) || 'Chauffeur non identifié'}>
                                                <span className="text-gray-400">Chauffeur : </span>
                                                {nomPersonne(t.chauffeur) || <span className="italic text-gray-400">non identifié</span>}
                                              </div>
                                              {t.suiveurs?.map(s => (
                                                <div key={s.employee_id} className="text-[10px] text-gray-600 truncate" title={nomPersonne(s)}>
                                                  <span className="text-gray-400">Suiveur : </span>{nomPersonne(s)}
                                                </div>
                                              ))}
                                            </div>
                                          );
                                        })}
                                      </td>
                                    );
                                  })}
                                </tr>
                                {/* Ligne 2 — affectations du planning hebdo (M / AM) */}
                                <tr className={`border-b ${colors.bg}`}>
                                  {dates.map((d, i) => PERIODES.map(per => celluleAffectation(poste, d, i, per)))}
                                </tr>
                              </Fragment>
                            ))}
                          </tbody>
                          {piedEffectifs(codes)}
                        </table>
                      </div>
                    )}
                  </>
                )}

                {isExpanded && !estCollecte && (
                  fp.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-400">Aucun poste défini pour cette filière.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px]">
                        <thead>{enteteJours}</thead>
                        <tbody>
                          {fp.map(poste => (
                            <tr key={poste.id} className={`border-b last:border-b-0 ${colors.bg}`}>
                              <td className="p-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-gray-800">{poste.nom}</span>
                                  {poste.obligatoire
                                    ? <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 font-semibold flex-shrink-0">Obligatoire</span>
                                    : <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">Facultatif</span>}
                                </div>
                                <div className="text-[10px] text-gray-500">{poste.detail}</div>
                                {(poste.require_permis_b || poste.require_caces) && (
                                  <div className="flex gap-1 mt-0.5">
                                    {poste.require_permis_b && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Permis B</span>}
                                    {poste.require_caces && <span className="text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">CACES</span>}
                                  </div>
                                )}
                              </td>
                              {dates.map((d, i) => PERIODES.map(per => celluleAffectation(poste, d, i, per, {
                                manquant: poste.obligatoire && getAffectations(poste.code, d, per.key).length === 0,
                              })))}
                            </tr>
                          ))}
                        </tbody>
                        {piedEffectifs(codes)}
                      </table>
                    </div>
                  )
                )}
              </div>
            );
          })}

          {/* ── Anciens postes : rien n'est masqué ──────────────────────────── */}
          {filterFiliere === 'all' && anciensPostes.length > 0 && (
            <div className="card-modern overflow-hidden">
              <button onClick={() => toggleFiliere('anciens')} className={`w-full flex items-center justify-between px-4 py-3 ${FILIERE_COLORS.anciens.header} text-white`}>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">Anciens postes</span>
                  <span className="text-xs opacity-80">{anciensPostes.length} libellé{anciensPostes.length > 1 ? 's' : ''} hors référentiel</span>
                </div>
                <svg className={`w-4 h-4 transition-transform ${expandedFilieres.anciens ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedFilieres.anciens && (
                <>
                  <div className="px-4 py-2 bg-slate-50 border-b text-[11px] text-slate-600">
                    Affectations posées sur des postes qui n'existent plus au référentiel (ancienne organisation de la collecte,
                    saisie sans poste). Elles restent visibles et retirables — rien n'est effacé sans décision.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px]">
                      <thead>{enteteJours}</thead>
                      <tbody>
                        {anciensPostes.map(poste => (
                          <tr key={poste.code || 'sans-poste'} className={`border-b last:border-b-0 ${FILIERE_COLORS.anciens.bg}`}>
                            <td className="p-2">
                              <span className="text-xs font-medium text-gray-700">{poste.nom}</span>
                              <div className="text-[10px] text-gray-500">Hors référentiel</div>
                            </td>
                            {dates.map((d, i) => PERIODES.map(per => {
                              const affs = getAffectations(poste.code, d, per.key);
                              return (
                                <td key={`${d}_${per.key}`} className={`p-0.5 text-center align-top border-l border-gray-100 ${d === aujourdhui ? 'bg-blue-50/50' : ''}`} style={{ minWidth: '70px' }}>
                                  {affs.map(a => (
                                    <button key={a.id || `${a.employee_id}_${per.key}`} type="button"
                                      className={`block w-full text-[10px] rounded px-1 py-0.5 mb-0.5 truncate hover:opacity-80 ${FILIERE_COLORS.anciens.badge}`}
                                      onClick={() => setARetirer({
                                        employee_id: a.employee_id, date: d, periode: a.periode,
                                        label: `${formatEmployeeName(a.last_name, a.first_name)} — ${JOURS[i]} ${formatDateShort(d)}`,
                                      })}
                                      title={`${formatEmployeeName(a.last_name, a.first_name)} — cliquer pour retirer`}
                                    >
                                      {a.first_name} {a.last_name?.charAt(0)}.
                                    </button>
                                  ))}
                                </td>
                              );
                            }))}
                          </tr>
                        ))}
                      </tbody>
                      {piedEffectifs(new Set(anciensPostes.map(p => p.code)))}
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Vivier : permanents / en parcours ────────────────────────────── */}
        {planning?.employees && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <VivierSalaries titre="Salariés permanents" sousTitre="Encadrement et fonctions support"
              salaries={permanents} affectations={affectations} accent="indigo" />
            <VivierSalaries titre="Salariés en parcours" sousTitre="Parcours d'insertion en cours"
              salaries={enParcours} affectations={affectations} accent="teal" />
          </div>
        )}
      </div>

      {/* Sélection d'un salarié à affecter */}
      <Modal isOpen={!!showPicker} onClose={() => setShowPicker(null)}
        title={showPicker ? `Affecter à : ${showPicker.poste.nom}` : ''} size="md">
        {showPicker && (
          <>
            <p className="text-xs text-gray-500 -mt-2 mb-3">
              {JOURS[showPicker.dateIdx]} {formatDateShort(showPicker.date)} —{' '}
              <span className="font-semibold">{showPicker.periode === 'matin' ? 'Matin' : 'Après-midi'}</span>
              {showPicker.poste.vehicle_id && <> — véhicule <span className="font-semibold">{showPicker.poste.nom}</span></>}
            </p>

            {pickerError && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{pickerError}</div>
            )}

            {(showPicker.poste.require_permis_b || showPicker.poste.require_caces) && (
              <div className="px-4 py-2 bg-yellow-50 border rounded-lg text-xs text-yellow-800 flex gap-2 mb-3">
                <span>Compétences requises :</span>
                {showPicker.poste.require_permis_b && <span className="font-medium px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Permis B</span>}
                {showPicker.poste.require_caces && <span className="font-medium px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">CACES</span>}
              </div>
            )}

            {pickerLoading ? (
              <div className="py-8 text-center text-gray-400">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent mx-auto mb-2" />
                Chargement...
              </div>
            ) : availableEmps.length === 0 && !pickerError ? (
              <div className="py-8 text-center text-gray-400 text-sm">Aucun salarié disponible avec les compétences requises.</div>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {availableEmps.map(emp => (
                  <button key={emp.id} onClick={() => affecter(emp.id)} disabled={emp.deja_affecte}
                    className={`w-full text-left flex items-center gap-3 p-3 rounded-lg transition ${emp.deja_affecte ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'hover:bg-gray-50 active:bg-gray-100'}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {emp.first_name?.charAt(0)}{emp.last_name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{formatEmployeeName(emp.last_name, emp.first_name)}</p>
                      <p className="text-[10px] text-gray-500">{emp.team_name || 'Sans équipe'}{emp.position ? ` — ${emp.position}` : ''}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {emp.est_permanent && <span className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">Permanent</span>}
                      {emp.has_permis_b && <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">P</span>}
                      {emp.has_caces && <span className="text-[9px] px-1 py-0.5 bg-orange-100 text-orange-700 rounded">C</span>}
                      {emp.deja_affecte && <span className="text-[9px] px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded">Déjà affecté</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!aRetirer}
        onCancel={() => setARetirer(null)}
        onConfirm={confirmerRetrait}
        title="Retirer cette affectation ?"
        confirmLabel="Retirer"
        message={aRetirer ? `${aRetirer.label} — cette affectation sera supprimée du planning.` : ''}
      />
    </Layout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
/** Vivier d'un groupe de salariés, avec le nombre d'affectations de la semaine. */
function VivierSalaries({ titre, sousTitre, salaries, affectations, accent }) {
  const styles = accent === 'indigo'
    ? { titre: 'text-indigo-800', puce: 'bg-indigo-100 text-indigo-700' }
    : { titre: 'text-teal-800', puce: 'bg-teal-100 text-teal-700' };

  return (
    <div className="card-modern p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className={`text-sm font-bold ${styles.titre}`}>{titre}</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${styles.puce}`}>{salaries.length}</span>
      </div>
      <p className="text-[11px] text-gray-500 mb-3">{sousTitre}</p>
      {salaries.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Aucun salarié dans ce groupe.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {salaries.map(emp => {
            const nbAff = affectations.filter(a => a.employee_id === emp.id).length;
            return (
              <div key={emp.id} className={`text-xs rounded-lg px-2.5 py-1.5 border ${
                nbAff === 0 ? 'bg-red-50 border-red-200 text-red-700'
                  : nbAff < 5 ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                    : 'bg-green-50 border-green-200 text-green-700'
              }`} title={formatEmployeeName(emp.last_name, emp.first_name)}>
                <span className="font-medium">{emp.first_name} {emp.last_name?.charAt(0)}.</span>
                <span className="ml-1 opacity-70">{nbAff} aff.</span>
                {emp.team_name && <span className="ml-1 opacity-50 text-[10px]">{emp.team_name}</span>}
                {emp.has_permis_b && <span className="ml-1 text-blue-600" title="Permis B">P</span>}
                {emp.has_caces && <span className="ml-0.5 text-orange-600" title="CACES">C</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
