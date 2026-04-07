import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal } from '../components';
import api from '../services/api';

const FILIERE_COLORS = {
  tri: { bg: 'bg-green-50', border: 'border-green-300', badge: 'bg-green-100 text-green-800', header: 'bg-green-600' },
  collecte: { bg: 'bg-blue-50', border: 'border-blue-300', badge: 'bg-blue-100 text-blue-800', header: 'bg-blue-600' },
  logistique: { bg: 'bg-yellow-50', border: 'border-yellow-300', badge: 'bg-yellow-100 text-yellow-800', header: 'bg-yellow-600' },
  btq: { bg: 'bg-pink-50', border: 'border-pink-300', badge: 'bg-pink-100 text-pink-800', header: 'bg-pink-600' },
};

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const JOURS_MAP = { 'Lundi': 'lundi', 'Mardi': 'mardi', 'Mercredi': 'mercredi', 'Jeudi': 'jeudi', 'Vendredi': 'vendredi', 'Samedi': 'samedi' };

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
  const [monday, setMonday] = useState(() => getMonday(new Date()));
  const [postes, setPostes] = useState([]);
  const [filieres, setFilieres] = useState([]);
  const [planning, setPlanning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(null); // { poste, date, dateIdx }
  const [availableEmps, setAvailableEmps] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expandedFilieres, setExpandedFilieres] = useState({ tri: true, collecte: true, logistique: true, btq: true });

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

  // Trouver les affectations pour un poste a un jour donne
  const getAffectations = (posteId, posteCode, dateStr) => {
    if (!planning) return [];
    return planning.affectations.filter(a => {
      if (a.date !== dateStr) return false;
      // Matcher par poste_code (postes virtuels et postes DB)
      if (a.poste_code && posteCode) return a.poste_code === posteCode;
      // Fallback : matcher par position_id pour les postes DB
      if (posteId.startsWith('pos_')) {
        const posId = parseInt(posteId.replace('pos_', ''));
        return a.position_id === posId;
      }
      return false;
    });
  };

  // Verifier si un employe est indisponible un jour donne
  const isIndispo = (employee, jourFr) => {
    return (employee.jours_off || []).includes(jourFr);
  };

  const isAbsent = (employeeId, dateStr) => {
    if (!planning) return false;
    return !!planning.absences[`${employeeId}_${dateStr}`];
  };

  // Ouvrir le picker d'employe
  const openPicker = async (poste, dateStr, dateIdx) => {
    setShowPicker({ poste, date: dateStr, dateIdx });
    setPickerLoading(true);
    try {
      const res = await api.get('/planning-hebdo/employes-disponibles', {
        params: {
          date: dateStr,
          require_permis: poste.require_permis_b ? 'true' : undefined,
          require_caces: poste.require_caces ? 'true' : undefined,
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
      });
      setShowPicker(null);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de l\'affectation');
    }
  };

  const desaffecter = async (employeeId, dateStr) => {
    if (!confirm('Retirer cette affectation ?')) return;
    try {
      await api.delete('/planning-hebdo/affecter', {
        data: { employee_id: employeeId, date: dateStr },
      });
      loadAll();
    } catch (err) { console.error(err); }
  };

  const confirmerSemaine = async () => {
    setConfirming(true);
    try {
      const res = await api.post('/planning-hebdo/confirmer', { week_start: dates[0] });
      alert(`${res.data.confirmed} affectations confirmees`);
      loadAll();
    } catch (err) { console.error(err); }
    setConfirming(false);
  };

  const toggleFiliere = (code) => {
    setExpandedFilieres(prev => ({ ...prev, [code]: !prev[code] }));
  };

  // Grouper postes par filiere
  const postesByFiliere = {};
  for (const f of (filieres.length > 0 ? filieres : [{ code: 'tri' }, { code: 'collecte' }, { code: 'logistique' }, { code: 'btq' }])) {
    postesByFiliere[f.code] = postes.filter(p => p.filiere === f.code);
  }

  // Stats
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
            <p className="text-sm text-gray-500">Affectation des salaries par poste et filiere</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={confirmerSemaine} disabled={confirming || provisoires === 0}
              className="btn-primary text-sm">
              {confirming ? 'Confirmation...' : `Confirmer (${provisoires})`}
            </button>
          </div>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2 mb-5">
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
        </div>

        {/* Planning grid par filiere */}
        <div className="space-y-4">
          {(filieres.length > 0 ? filieres : [
            { code: 'tri', label: 'Tri' },
            { code: 'collecte', label: 'Collecte' },
            { code: 'logistique', label: 'Logistique' },
            { code: 'btq', label: 'Boutiques' },
          ]).map(filiere => {
            const fp = postesByFiliere[filiere.code] || [];
            if (fp.length === 0) return null;
            const colors = FILIERE_COLORS[filiere.code] || FILIERE_COLORS.tri;
            const isExpanded = expandedFilieres[filiere.code];

            return (
              <div key={filiere.code} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                {/* Filiere header */}
                <button
                  onClick={() => toggleFiliere(filiere.code)}
                  className={`w-full flex items-center justify-between px-4 py-3 ${colors.header} text-white`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">{filiere.label}</span>
                    <span className="text-xs opacity-80">{fp.length} postes</span>
                  </div>
                  <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px]">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="text-left p-2 text-xs font-semibold text-gray-500 w-44 min-w-[176px]">Poste</th>
                          {dates.map((d, i) => {
                            const isToday = d === new Date().toISOString().slice(0, 10);
                            return (
                              <th key={d} className={`text-center p-2 text-xs font-semibold min-w-[100px] ${isToday ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}>
                                <div>{JOURS[i]}</div>
                                <div className="text-[10px] font-normal">{formatDateShort(d)}</div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {fp.map(poste => (
                          <tr key={poste.id} className={`border-b last:border-b-0 ${colors.bg}`}>
                            <td className="p-2">
                              <div className="text-xs font-medium text-gray-800">{poste.nom}</div>
                              <div className="text-[10px] text-gray-500">{poste.detail}</div>
                              {(poste.require_permis_b || poste.require_caces) && (
                                <div className="flex gap-1 mt-0.5">
                                  {poste.require_permis_b && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Permis B</span>}
                                  {poste.require_caces && <span className="text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">CACES</span>}
                                </div>
                              )}
                            </td>
                            {dates.map((d, i) => {
                              const affs = getAffectations(poste.id, poste.code, d);
                              const isToday = d === new Date().toISOString().slice(0, 10);
                              return (
                                <td key={d} className={`p-1 text-center align-top ${isToday ? 'bg-blue-50/50' : ''}`}>
                                  {affs.map(a => (
                                    <div key={a.schedule_id}
                                      className={`text-[11px] rounded px-1.5 py-1 mb-0.5 cursor-pointer hover:opacity-80 ${
                                        a.is_provisional ? 'bg-yellow-100 text-yellow-800 border border-dashed border-yellow-400' : `${colors.badge}`
                                      }`}
                                      onClick={() => desaffecter(a.employee_id, d)}
                                      title="Cliquer pour retirer"
                                    >
                                      {a.first_name} {a.last_name?.charAt(0)}.
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => openPicker(poste, d, i)}
                                    className="w-full mt-0.5 rounded border border-dashed border-gray-300 text-gray-400 text-[10px] py-1 hover:bg-gray-100 hover:text-gray-600 transition"
                                  >
                                    + Affecter
                                  </button>
                                </td>
                              );
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

        {/* Employes non affectes */}
        {planning?.employees && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border p-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3">
              Employes ({planning.employees.length})
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
                    <span className="ml-1 opacity-70">{nbAff}j</span>
                    {emp.jours_off?.length > 0 && (
                      <span className="ml-1 opacity-50" title={`Indispo: ${emp.jours_off.join(', ')}`}>
                        ({emp.jours_off.length} off)
                      </span>
                    )}
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
      <Modal isOpen={!!showPicker} onClose={() => setShowPicker(null)} title={showPicker ? `Affecter a : ${showPicker.poste.nom}` : ''} size="md">
        {showPicker && (
          <>
            <p className="text-xs text-gray-500 -mt-2 mb-3">{JOURS[showPicker.dateIdx]} {formatDateShort(showPicker.date)}</p>

            {showPicker.poste.require_permis_b || showPicker.poste.require_caces ? (
              <div className="px-4 py-2 bg-yellow-50 border rounded-lg text-xs text-yellow-800 flex gap-2 mb-3">
                <span>Competences requises :</span>
                {showPicker.poste.require_permis_b && <span className="font-medium px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Permis B</span>}
                {showPicker.poste.require_caces && <span className="font-medium px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">CACES</span>}
              </div>
            ) : null}

            <div>
              {pickerLoading ? (
                <div className="py-8 text-center text-gray-400">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent mx-auto mb-2" />
                  Chargement du planning...
                </div>
              ) : availableEmps.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">
                  Aucun employe disponible avec les competences requises.
                </div>
              ) : (
                <div className="space-y-1">
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
                          {emp.team_name || 'Sans equipe'} {emp.position ? `— ${emp.position}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {emp.has_permis_b && <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded">P</span>}
                        {emp.has_caces && <span className="text-[9px] px-1 py-0.5 bg-orange-100 text-orange-700 rounded">C</span>}
                        {emp.deja_affecte && <span className="text-[9px] px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded">Deja affecte</span>}
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
