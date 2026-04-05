import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

const TYPES_PRODUIT = {
  original: 'Original', csr: 'CSR', effilo_blanc: 'Effilo Blanc', effilo_couleur: 'Effilo Couleur',
  jean: 'Jean', coton_blanc: 'Coton Blanc', coton_couleur: 'Coton Couleur'
};

const TYPE_COLORS = {
  original: 'bg-red-400',
  csr: 'bg-blue-400',
  effilo_blanc: 'bg-gray-300',
  effilo_couleur: 'bg-purple-400',
  jean: 'bg-indigo-400',
  coton_blanc: 'bg-yellow-300',
  coton_couleur: 'bg-green-400',
};

const ALERT_TYPES = {
  surcharge_lieu: 'Surcharge lieu de chargement',
  semaine_vide: 'Semaine sans expédition',
  stock_insuffisant: 'Stock insuffisant',
  preparation_manquante: 'Préparation manquante',
};

const SEVERITY_STYLES = {
  danger: { bg: 'bg-red-50 border-red-300', icon: 'text-red-500', badge: 'bg-red-100 text-red-700' },
  warning: { bg: 'bg-yellow-50 border-yellow-300', icon: 'text-yellow-500', badge: 'bg-yellow-100 text-yellow-700' },
  info: { bg: 'bg-blue-50 border-blue-300', icon: 'text-blue-500', badge: 'bg-blue-100 text-blue-700' },
};

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const MOIS_NOMS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - ((startDate.getDay() + 6) % 7));

  const weeks = [];
  let current = new Date(startDate);
  while (current <= lastDay || weeks.length < 6) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    if (current > lastDay && weeks.length >= 4) break;
  }
  return weeks;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function AlertIcon({ severity }) {
  if (severity === 'danger') {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (severity === 'warning') {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M10.29 3.86l-8.7 15.04A1 1 0 002.46 20h17.08a1 1 0 00.87-1.5l-8.7-15.04a1 1 0 00-1.74 0z" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
    </svg>
  );
}

export default function ExutoiresCalendrier() {
  const [currentMonth, setCurrentMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [viewMode, setViewMode] = useState('mensuel');
  const [calendarData, setCalendarData] = useState(null);
  const [alertes, setAlertes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [showAlertes, setShowAlertes] = useState(true);

  useEffect(() => { loadData(); }, [currentMonth]);

  const loadData = async () => {
    setLoading(true);
    try {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const dateFrom = formatDate(new Date(year, month, 1));
      const dateTo = formatDate(new Date(year, month + 1, 0));

      const [calRes, alertRes] = await Promise.all([
        api.get('/calendrier-logistique', { params: { date_from: dateFrom, date_to: dateTo } }),
        api.get('/calendrier-logistique/alertes'),
      ]);
      // Normaliser la reponse : aplatir les expeditions depuis les semaines
      const data = calRes.data || {};
      const semaines = data.semaines || [];
      const allExpeditions = semaines.flatMap(s => (s.expeditions || []).map(e => ({
        ...e,
        semaine: s.semaine,
      })));
      // Normaliser les semaines : convertir occupation_lieux (objet) en lieux (tableau)
      for (const sem of semaines) {
        if (sem.occupation_lieux && !sem.lieux) {
          sem.lieux = Object.entries(sem.occupation_lieux).map(([nom, occupation_pct]) => ({
            nom, occupation_pct
          }));
        }
      }
      // Normaliser le resume
      const resume = data.resume || {};
      setCalendarData({
        semaines,
        expeditions: allExpeditions,
        resume: {
          total_expeditions: resume.total_expeditions ?? 0,
          tonnage_total: resume.total_tonnage ?? resume.tonnage_total ?? 0,
          ca_previsionnel: resume.total_ca ?? resume.ca_previsionnel ?? 0,
          taux_moyen_occupation: resume.taux_moyen_occupation ?? null,
        },
      });
      setAlertes(Array.isArray(alertRes.data) ? alertRes.data : alertRes.data?.alertes || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const navigateMonth = (delta) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
  };

  const goToCurrentMonth = () => {
    setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  };

  const resume = calendarData?.resume || {};
  const expeditions = calendarData?.expeditions || [];
  const semaines = calendarData?.semaines || [];

  const expeditionsByDate = {};
  expeditions.forEach((exp) => {
    const dateKey = exp.date_expedition?.slice(0, 10);
    if (dateKey) {
      if (!expeditionsByDate[dateKey]) expeditionsByDate[dateKey] = [];
      expeditionsByDate[dateKey].push(exp);
    }
  });

  const today = new Date();
  const monthGrid = getMonthGrid(currentMonth.getFullYear(), currentMonth.getMonth());

  return (
    <Layout>
      <div className="p-6 max-w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Calendrier Prévisionnel Logistique</h1>
          <button
            onClick={() => setShowAlertes(!showAlertes)}
            className="relative inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 text-sm font-medium text-gray-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            Alertes
            {alertes.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {alertes.length}
              </span>
            )}
          </button>
        </div>

        <div className={`flex gap-6 ${showAlertes ? '' : ''}`}>
          {/* Main calendar area */}
          <div className={`${showAlertes ? 'flex-1 min-w-0' : 'w-full'}`}>
            {/* Summary cards */}
            {!loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                  <p className="text-sm text-gray-500">Total expéditions</p>
                  <p className="text-2xl font-bold text-gray-900">{resume.total_expeditions ?? 0}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                  <p className="text-sm text-gray-500">Tonnage total</p>
                  <p className="text-2xl font-bold text-gray-900">{resume.tonnage_total != null ? `${Number(resume.tonnage_total).toFixed(1)} t` : '0 t'}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                  <p className="text-sm text-gray-500">CA prévisionnel</p>
                  <p className="text-2xl font-bold text-gray-900">{resume.ca_previsionnel != null ? `${Number(resume.ca_previsionnel).toLocaleString('fr-FR')} €` : '0 €'}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
                  <p className="text-sm text-gray-500">Taux moyen d'occupation</p>
                  <p className="text-2xl font-bold text-gray-900">{resume.taux_moyen_occupation != null ? `${Number(resume.taux_moyen_occupation).toFixed(0)}%` : '—'}</p>
                </div>
              </div>
            )}

            {/* Navigation + view toggle */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <button onClick={() => navigateMonth(-1)} className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button onClick={goToCurrentMonth} className="px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm font-medium text-gray-700">
                  Mois actuel
                </button>
                <button onClick={() => navigateMonth(1)} className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <h2 className="text-lg font-semibold text-gray-800 ml-3">
                  {MOIS_NOMS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                </h2>
              </div>

              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('mensuel')}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'mensuel' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Mensuel
                </button>
                <button
                  onClick={() => setViewMode('hebdomadaire')}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'hebdomadaire' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Hebdomadaire
                </button>
              </div>
            </div>

            {loading ? (
              <LoadingSpinner size="lg" message="Chargement du calendrier..." />
            ) : viewMode === 'mensuel' ? (
              /* Monthly calendar grid */
              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                {/* Day headers */}
                <div className="grid grid-cols-7 border-b border-gray-200">
                  {JOURS.map((jour) => (
                    <div key={jour} className="px-2 py-2 text-center text-xs font-semibold text-gray-500 uppercase">
                      {jour}
                    </div>
                  ))}
                </div>

                {/* Week rows */}
                {monthGrid.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
                    {week.map((day, di) => {
                      const dateKey = formatDate(day);
                      const dayExps = expeditionsByDate[dateKey] || [];
                      const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                      const isToday = isSameDay(day, today);
                      const hasExps = dayExps.length > 0;

                      return (
                        <div
                          key={di}
                          className={`min-h-[80px] p-1.5 border-r border-gray-100 last:border-r-0 transition-colors
                            ${isCurrentMonth ? 'bg-white' : 'bg-gray-50'}
                            ${hasExps ? 'bg-blue-50/50' : ''}
                            ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
                          `}
                        >
                          <div className={`text-xs font-medium mb-1 ${isCurrentMonth ? 'text-gray-900' : 'text-gray-400'}`}>
                            {day.getDate()}
                          </div>
                          {dayExps.length > 0 && (
                            <div className="space-y-0.5">
                              <div className="text-[10px] text-gray-500 font-medium">{dayExps.length} exp.</div>
                              <div className="flex flex-wrap gap-0.5">
                                {dayExps.slice(0, 6).map((exp, ei) => {
                                  const tp = Array.isArray(exp.type_produit) ? exp.type_produit[0] : exp.type_produit;
                                  return (
                                    <div
                                      key={ei}
                                      className={`w-2.5 h-2.5 rounded-full ${TYPE_COLORS[tp] || 'bg-gray-400'}`}
                                      title={`${TYPES_PRODUIT[tp] || tp} — ${exp.client || ''}`}
                                    />
                                  );
                                })}
                                {dayExps.length > 6 && (
                                  <span className="text-[9px] text-gray-400">+{dayExps.length - 6}</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Legend */}
                <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex flex-wrap gap-3">
                  {Object.entries(TYPES_PRODUIT).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-1">
                      <div className={`w-2.5 h-2.5 rounded-full ${TYPE_COLORS[key] || 'bg-gray-400'}`} />
                      <span className="text-[10px] text-gray-500">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Weekly detail view */
              <div className="space-y-4">
                {semaines.length === 0 && (
                  <div className="bg-white rounded-lg shadow border border-gray-200 p-8 text-center text-gray-500">
                    Aucune donnée pour ce mois.
                  </div>
                )}
                {semaines.map((sem) => {
                  const isExpanded = expandedWeek === sem.semaine;
                  return (
                    <div key={sem.semaine} className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                      {/* Week header */}
                      <button
                        onClick={() => setExpandedWeek(isExpanded ? null : sem.semaine)}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div>
                          <span className="text-sm font-bold text-gray-900">Semaine {sem.semaine}</span>
                          {sem.date_debut && sem.date_fin && (
                            <span className="ml-2 text-sm text-gray-500">
                              {new Date(sem.date_debut).toLocaleDateString('fr-FR')} — {new Date(sem.date_fin).toLocaleDateString('fr-FR')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {sem.nb_expeditions ?? 0} expéditions
                          </span>
                          <span className="text-xs text-gray-500">{sem.tonnage_prevu != null ? `${Number(sem.tonnage_prevu).toFixed(1)} t` : '—'}</span>
                          <span className="text-xs text-gray-500">{sem.ca_previsionnel != null ? `${Number(sem.ca_previsionnel).toLocaleString('fr-FR')} €` : '—'}</span>
                          <svg className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-200 px-5 py-4 space-y-4">
                          {/* Occupation bars by lieu */}
                          {sem.lieux && sem.lieux.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Occupation des lieux</h4>
                              <div className="space-y-2">
                                {sem.lieux.map((lieu) => (
                                  <div key={lieu.nom} className="flex items-center gap-3">
                                    <span className="text-sm text-gray-700 w-40 truncate">{lieu.nom}</span>
                                    <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          (lieu.occupation_pct || 0) > 90 ? 'bg-red-500' :
                                          (lieu.occupation_pct || 0) > 70 ? 'bg-yellow-500' : 'bg-green-500'
                                        }`}
                                        style={{ width: `${Math.min(100, lieu.occupation_pct || 0)}%` }}
                                      />
                                    </div>
                                    <span className="text-sm font-medium text-gray-600 w-12 text-right">
                                      {lieu.occupation_pct != null ? `${Number(lieu.occupation_pct).toFixed(0)}%` : '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Expeditions list */}
                          {sem.expeditions && sem.expeditions.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Expéditions</h4>
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-gray-200">
                                      <th className="text-left py-2 pr-4 font-medium text-gray-500">Réf. commande</th>
                                      <th className="text-left py-2 pr-4 font-medium text-gray-500">Client</th>
                                      <th className="text-left py-2 pr-4 font-medium text-gray-500">Produit</th>
                                      <th className="text-left py-2 pr-4 font-medium text-gray-500">Date expédition</th>
                                      <th className="text-right py-2 font-medium text-gray-500">Tonnage</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sem.expeditions.map((exp, idx) => (
                                      <tr key={idx} className="border-b border-gray-100 last:border-b-0">
                                        <td className="py-2 pr-4 text-gray-900 font-medium">{exp.commande_ref || '—'}</td>
                                        <td className="py-2 pr-4 text-gray-700">{exp.client || '—'}</td>
                                        <td className="py-2 pr-4">
                                          <span className="inline-flex items-center gap-1">
                                            {(Array.isArray(exp.type_produit) ? exp.type_produit : [exp.type_produit]).map((tp, tpi) => (
                                              <span key={tpi} className="inline-flex items-center gap-1">
                                                <span className={`w-2 h-2 rounded-full ${TYPE_COLORS[tp] || 'bg-gray-400'}`} />
                                                {TYPES_PRODUIT[tp] || tp}
                                              </span>
                                            ))}
                                          </span>
                                        </td>
                                        <td className="py-2 pr-4 text-gray-700">
                                          {exp.date_expedition ? new Date(exp.date_expedition).toLocaleDateString('fr-FR') : '—'}
                                        </td>
                                        <td className="py-2 text-right text-gray-700">
                                          {exp.tonnage != null ? `${Number(exp.tonnage).toFixed(1)} t` : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {(!sem.expeditions || sem.expeditions.length === 0) && (
                            <p className="text-sm text-gray-400 italic">Aucune expédition planifiée cette semaine.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Alerts sidebar */}
          {showAlertes && (
            <div className="w-80 flex-shrink-0">
              <div className="bg-white rounded-lg shadow border border-gray-200 sticky top-6">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    Alertes
                    {alertes.length > 0 && (
                      <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                        {alertes.length}
                      </span>
                    )}
                  </h3>
                  <button onClick={() => setShowAlertes(false)} className="text-gray-400 hover:text-gray-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-3 space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
                  {alertes.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">Aucune alerte active.</p>
                  )}
                  {alertes.map((alerte, idx) => {
                    const severity = alerte.severity || 'info';
                    const styles = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;

                    return (
                      <div key={idx} className={`rounded-lg border p-3 ${styles.bg}`}>
                        <div className="flex items-start gap-2">
                          <div className={`mt-0.5 ${styles.icon}`}>
                            <AlertIcon severity={severity} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className={`inline-block text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded mb-1 ${styles.badge}`}>
                              {ALERT_TYPES[alerte.type] || alerte.type}
                            </span>
                            <p className="text-sm text-gray-800">{alerte.message}</p>
                            {(alerte.semaine || alerte.commande_ref || alerte.lieu) && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {alerte.semaine && (
                                  <span className="text-[10px] bg-white/60 rounded px-1.5 py-0.5 text-gray-600">
                                    Sem. {alerte.semaine}
                                  </span>
                                )}
                                {alerte.commande_ref && (
                                  <span className="text-[10px] bg-white/60 rounded px-1.5 py-0.5 text-gray-600">
                                    Cmd. {alerte.commande_ref}
                                  </span>
                                )}
                                {alerte.lieu && (
                                  <span className="text-[10px] bg-white/60 rounded px-1.5 py-0.5 text-gray-600">
                                    {alerte.lieu}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
