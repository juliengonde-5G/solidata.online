import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Filter } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal } from '../components';
import api from '../services/api';

const FILIERE_COLORS = {
  tri: { bg: 'bg-green-50', border: 'border-green-300', badge: 'bg-green-100 text-green-800', header: 'bg-green-600', badgeProv: 'bg-yellow-100 text-yellow-800 border border-dashed border-yellow-400' },
  collecte: { bg: 'bg-blue-50', border: 'border-blue-300', badge: 'bg-blue-100 text-blue-800', header: 'bg-blue-600', badgeProv: 'bg-yellow-100 text-yellow-800 border border-dashed border-yellow-400' },
  logistique: { bg: 'bg-yellow-50', border: 'border-yellow-300', badge: 'bg-yellow-100 text-yellow-800', header: 'bg-yellow-600', badgeProv: 'bg-orange-100 text-orange-800 border border-dashed border-orange-400' },
  btq: { bg: 'bg-pink-50', border: 'border-pink-300', badge: 'bg-pink-100 text-pink-800', header: 'bg-pink-600', badgeProv: 'bg-yellow-100 text-yellow-800 border border-dashed border-yellow-400' },
};

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const PERIODES = [
  { key: 'matin', label: 'Matin', short: 'M' },
  { key: 'apres_midi', label: 'Après-midi', short: 'AM' },
];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - ((day + 6) % 7));
  date.setHours(0, 0, 0, 0);
  return date;
}

function getDates(monday) {
  return JOURS.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function PlanningHebdo() {
  const [searchParams] = useSearchParams();
  const [monday, setMonday] = useState(() => {
    const weekStart = searchParams.get('week_start');
    return weekStart ? getMonday(new Date(weekStart)) : getMonday(new Date());
  });
  const [postes, setPostes] = useState([]);
  const [filieres, setFilieres] = useState([]);
  const [planning, setPlanning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(null);
  const [availableEmps, setAvailableEmps] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expandedFilieres, setExpandedFilieres] = useState({ tri: true, collecte: true, logistique: true, btq: true });
  const [filterFiliere, setFilterFiliere] = useState('all');

  const dates = getDates(monday);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [postesRes, planningRes] = await Promise.all([
        api.get('/planning-hebdo/postes'),
        api.get('/planning-hebdo', { params: { week_start: dates[0] } }),
      ]);
      setFilieres(postesRes.data.filieres);
      setPostes(postesRes.data.postes);
      setPlanning(planningRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [dates[0]]);

  useEffect(() => { loadAll(); }, [monday]);

  const navigateWeek = (delta) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + 7 * delta);
    setMonday(d);
  };

  const goThisWeek = () => setMonday(getMonday(new Date()));

  // Affectations pour un poste/jour/période
  const getAffectations = (posteCode, dateStr, periode) => {
    if (!planning) return [];
    return planning.affectations.filter(a => {
      if (a.date !== dateStr) return false;
      if (a.poste_code !== posteCode) return false;
      if (!periode) return true;
      const aPeriode = a.periode || 'journee';
      if (aPeriode === 'journee') return true;
      return aPeriode === periode;
    });
  };

  // Toutes les affectations d'un poste sur un jour (toutes périodes)
  const getAllAffectationsForDay = (posteCode, dateStr) => {
    if (!planning) return [];
    return planning.affectations.filter(a => a.date === dateStr && a.poste_code === posteCode);
  };

  // Postes obligatoires non couverts
  const uncoveredAlerts = useMemo(() => {
    if (!planning) return [];
    const alerts = [];
    const obligatoires = postes.filter(p => p.obligatoire);

    for (const poste of obligatoires) {
      for (const d of dates) {
        // Vérifier chaque demi-journée
        for (const per of PERIODES) {
          const affs = getAffectations(poste.code, d, per.key);
          if (affs.length === 0) {
            alerts.push({
              poste: poste.nom,
              posteCode: poste.code,
              filiere: poste.filiere,
              date: d,
              periode: per.key,
              periodeLabel: per.label,
              jour: JOURS[dates.indexOf(d)],
            });
          }
        }
      }
    }
    return alerts;
  }, [planning, postes, dates]);

  // Ouvrir le picker
  const openPicker = async (poste, dateStr, dateIdx, periode) => {
    setShowPicker({ poste, date: dateStr, dateIdx, periode });
    setPickerLoading(true);
    try {
      const res = await api.get('/planning-hebdo/employes-disponibles', {
        params: {
          date: dateStr,
          require_permis: poste.require_permis_b ? 'true' : undefined,
          require_caces: poste.require_caces ? 'true' : undefined,
          periode,
        },
      });
      setAvailableEmps(res.data);
    } catch (err) { console.error(err); }
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
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || "Erreur lors de l'affectation");
    }
  };

  const desaffecter = async (employeeId, dateStr, periode) => {
    if (!confirm('Retirer cette affectation ?')) return;
    try {
      await api.delete('/planning-hebdo/affecter', {
        data: { employee_id: employeeId, date: dateStr, periode: periode || undefined },
      });
      loadAll();
    } catch (err) { console.error(err); }
  };

  const confirmerSemaine = async () => {
    setConfirming(true);
    try {
      const res = await api.post('/planning-hebdo/confirmer', { week_start: dates[0] });
      alert(`${res.data.confirmed} affectations confirmées`);
      loadAll();
    } catch (err) { console.error(err); }
    setConfirming(false);
  };

  const toggleFiliere = (code) => {
    setExpandedFilieres(prev => ({ ...prev, [code]: !prev[code] }));
  };

  // Grouper postes par filière, filtré
  const postesByFiliere = {};
  const displayFilieres = filieres.length > 0 ? filieres : [
    { code: 'tri', label: 'Tri' }, { code: 'collecte', label: 'Collecte' },
    { code: 'logistique', label: 'Logistique' }, { code: 'btq', label: 'Boutiques' },
  ];
  for (const f of displayFilieres) {
    if (filterFiliere !== 'all' && f.code !== filterFiliere) continue;
    const fp = postes.filter(p => p.filiere === f.code);
    // Trier : obligatoires d'abord, puis facultatifs
    fp.sort((a, b) => (b.obligatoire ? 1 : 0) - (a.obligatoire ? 1 : 0));
    postesByFiliere[f.code] = fp;
  }

  const totalAffectations = planning?.affectations?.length || 0;
  const provisoires = planning?.affectations?.filter(a => a.is_provisional)?.length || 0;
  const weekLabel = `${formatDateShort(dates[0])} — ${formatDateShort(dates[5])}`;

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement du planning..." /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Planning hebdomadaire</h1>
            <p className="text-sm text-gray-500">Affectation des salariés par poste et filière — demi-journée</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={confirmerSemaine} disabled={confirming || provisoires === 0}
              className="btn-primary text-sm">
              {confirming ? 'Confirmation...' : `Confirmer (${provisoires})`}
            </button>
          </div>
        </div>

        {/* Bandeau d'alerte postes obligatoires non couverts */}
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

        {/* Week navigation + Filtre par équipe */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button onClick={() => navigateWeek(-1)} className="p-2 rounded-lg border hover:bg-gray-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={goThisWeek} className="px-3 py-1.5 rounded-lg border hover:bg-gray-50 text-sm font-medium">
            Cette semaine
          </button>
          <button onClick={() => navigateWeek(1)} className="p-2 rounded-lg border hover:bg-gray-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
          <span className="text-sm font-semibold text-gray-700 ml-2">{weekLabel}</span>
          <span className="text-xs text-gray-400 ml-2">{totalAffectations} affectations</span>

          {/* Filtre par équipe */}
          <div className="ml-auto flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-slate-400" />
            <select value={filterFiliere} onChange={e => setFilterFiliere(e.target.value)}
              className="input-modern text-xs py-1 w-auto">
              <option value="all">Toutes les équipes</option>
              {displayFilieres.map(f => (
                <option key={f.code} value={f.code}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Planning grid par filiere */}
        <div className="space-y-4">
          {displayFilieres.filter(f => filterFiliere === 'all' || f.code === filterFiliere).map(filiere => {
            const fp = postesByFiliere[filiere.code] || [];
            if (fp.length === 0) return null;
            const colors = FILIERE_COLORS[filiere.code] || FILIERE_COLORS.tri;
            const isExpanded = expandedFilieres[filiere.code];
            const nbOblig = fp.filter(p => p.obligatoire).length;

            return (
              <div key={filiere.code} className="card-modern overflow-hidden">
                {/* Filiere header */}
                <button
                  onClick={() => toggleFiliere(filiere.code)}
                  className={`w-full flex items-center justify-between px-4 py-3 ${colors.header} text-white`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">{filiere.label}</span>
                    <span className="text-xs opacity-80">{fp.length} postes</span>
                    {nbOblig > 0 && (
                      <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">
                        {nbOblig} obligatoire{nbOblig > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px]">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="text-left p-2 text-xs font-semibold text-gray-500 w-48 min-w-[192px]">Poste</th>
                          {dates.map((d, i) => {
                            const isToday = d === new Date().toISOString().slice(0, 10);
                            return (
                              <th key={d} colSpan={2} className={`text-center p-2 text-xs font-semibold min-w-[140px] ${isToday ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}>
                                <div>{JOURS[i]}</div>
                                <div className="text-[10px] font-normal">{formatDateShort(d)}</div>
                                <div className="flex justify-center gap-0 mt-0.5">
                                  <span className="text-[9px] text-gray-400 w-1/2">M</span>
                                  <span className="text-[9px] text-gray-400 w-1/2">AM</span>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {fp.map(poste => (
                          <tr key={poste.id} className={`border-b last:border-b-0 ${colors.bg}`}>
                            <td className="p-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-800">{poste.nom}</span>
                                {poste.obligatoire ? (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 font-semibold flex-shrink-0">Obligatoire</span>
                                ) : (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">Facultatif</span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-500">{poste.detail}</div>
                              {(poste.require_permis_b || poste.require_caces) && (
                                <div className="flex gap-1 mt-0.5">
                                  {poste.require_permis_b && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Permis B</span>}
                                  {poste.require_caces && <span className="text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">CACES</span>}
                                </div>
                              )}
                            </td>
                            {dates.map((d, i) => {
                              const isToday = d === new Date().toISOString().slice(0, 10);
                              return PERIODES.map(per => {
                                const affs = getAffectations(poste.code, d, per.key);
                                const isMissing = poste.obligatoire && affs.length === 0;
                                return (
                                  <td key={`${d}_${per.key}`}
                                    className={`p-0.5 text-center align-top border-l border-gray-100 ${
                                      isToday ? 'bg-blue-50/50' : ''
                                    } ${isMissing ? 'bg-red-50/60' : ''}`}
                                    style={{ minWidth: '70px' }}
                                  >
                                    {affs.map(a => (
                                      <div key={a.id || `${a.employee_id}_${per.key}`}
                                        className={`text-[10px] rounded px-1 py-0.5 mb-0.5 cursor-pointer hover:opacity-80 ${
                                          a.is_provisional ? colors.badgeProv : colors.badge
                                        }`}
                                        onClick={() => desaffecter(a.employee_id, d, a.periode)}
                                        title={`${a.first_name} ${a.last_name} — cliquer pour retirer`}
                                      >
                                        {a.first_name} {a.last_name?.charAt(0)}.
                                      </div>
                                    ))}
                                    <button
                                      onClick={() => openPicker(poste, d, i, per.key)}
                                      className={`w-full mt-0.5 rounded border border-dashed text-[9px] py-0.5 transition ${
                                        isMissing
                                          ? 'border-red-300 text-red-400 hover:bg-red-100 hover:text-red-600'
                                          : 'border-gray-300 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                                      }`}
                                    >
                                      +
                                    </button>
                                  </td>
                                );
                              });
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Employés non affectés */}
        {planning?.employees && (
          <div className="mt-6 card-modern p-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3">
              Employés ({planning.employees.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {planning.employees.map(emp => {
                const nbAff = planning.affectations.filter(a => a.employee_id === emp.id).length;
                return (
                  <div key={emp.id} className={`text-xs rounded-lg px-2.5 py-1.5 border ${
                    nbAff === 0 ? 'bg-red-50 border-red-200 text-red-700' :
                    nbAff < 5 ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                    'bg-green-50 border-green-200 text-green-700'
                  }`}>
                    <span className="font-medium">{emp.first_name} {emp.last_name?.charAt(0)}.</span>
                    <span className="ml-1 opacity-70">{nbAff} aff.</span>
                    {emp.team_name && <span className="ml-1 opacity-50 text-[10px]">{emp.team_name}</span>}
                    {emp.has_permis_b && <span className="ml-1 text-blue-600" title="Permis B">P</span>}
                    {emp.has_caces && <span className="ml-0.5 text-orange-600" title="CACES">C</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Picker modal */}
      <Modal isOpen={!!showPicker} onClose={() => setShowPicker(null)}
        title={showPicker ? `Affecter à : ${showPicker.poste.nom}` : ''} size="md">
        {showPicker && (
          <>
            <p className="text-xs text-gray-500 -mt-2 mb-3">
              {JOURS[showPicker.dateIdx]} {formatDateShort(showPicker.date)}
              {' — '}
              <span className="font-semibold">
                {showPicker.periode === 'matin' ? 'Matin' : 'Après-midi'}
              </span>
            </p>

            {(showPicker.poste.require_permis_b || showPicker.poste.require_caces) && (
              <div className="px-4 py-2 bg-yellow-50 border rounded-lg text-xs text-yellow-800 flex gap-2 mb-3">
                <span>Compétences requises :</span>
                {showPicker.poste.require_permis_b && <span className="font-medium px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Permis B</span>}
                {showPicker.poste.require_caces && <span className="font-medium px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">CACES</span>}
              </div>
            )}

            <div>
              {pickerLoading ? (
                <div className="py-8 text-center text-gray-400">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent mx-auto mb-2" />
                  Chargement...
                </div>
              ) : availableEmps.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">
                  Aucun employé disponible avec les compétences requises.
                </div>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {availableEmps.map(emp => (
                    <button
                      key={emp.id}
                      onClick={() => affecter(emp.id)}
                      disabled={emp.deja_affecte}
                      className={`w-full text-left flex items-center gap-3 p-3 rounded-lg transition ${
                        emp.deja_affecte
                          ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                          : 'hover:bg-gray-50 active:bg-gray-100'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {emp.first_name?.charAt(0)}{emp.last_name?.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{emp.first_name} {emp.last_name}</p>
                        <p className="text-[10px] text-gray-500">
                          {emp.team_name || 'Sans équipe'} {emp.position ? `— ${emp.position}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {emp.has_permis_b && <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">P</span>}
                        {emp.has_caces && <span className="text-[9px] px-1 py-0.5 bg-orange-100 text-orange-700 rounded">C</span>}
                        {emp.deja_affecte && <span className="text-[9px] px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded">Déjà affecté</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Modal>
    </Layout>
  );
}
