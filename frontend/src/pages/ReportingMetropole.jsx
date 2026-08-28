import { useState, useEffect, useCallback, useMemo } from 'react';
import { Building2, Map as MapIcon, BarChart3, Bot, Radio, Filter, Download, Printer, Clock, Users } from 'lucide-react';
import Layout from '../components/Layout';
import api from '../services/api';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { PageHeader, Section, MapSizeFix } from '../components';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import 'leaflet/dist/leaflet.css';
import FondCarte from '../components/FondCarte';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function ReportingMetropole() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [communeFilter, setCommuneFilter] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [cavList, setCavList] = useState([]);
  const [selectedCav, setSelectedCav] = useState(null);
  const [cavDetail, setCavDetail] = useState(null);
  const [cavActivity, setCavActivity] = useState(null);
  const [cavDetailError, setCavDetailError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortieDyn, setSortieDyn] = useState(null);
  const [serviceCav, setServiceCav] = useState([]);
  const [captation, setCaptation] = useState([]);
  const [delaiIncidents, setDelaiIncidents] = useState(null);
  const [kpiInsertion, setKpiInsertion] = useState(null);
  const [errors, setErrors] = useState({});

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    const errs = {};
    const msg = (err, fallback) => err?.response?.data?.error || err?.message || fallback;

    // Section critique : tableau de bord + carte CAV
    try {
      const [dashRes, cavRes] = await Promise.all([
        api.get(`/metropole/dashboard?year=${year}&month=${month}`),
        api.get('/metropole/cav'),
      ]);
      setDashboard(dashRes.data);
      setCavList(cavRes.data || []);
    } catch (err) {
      console.error(err);
      setDashboard(null);
      setCavList([]);
      errs.dashboard = msg(err, 'Impossible de charger le tableau de bord Métropole.');
    }

    // Sections secondaires (en parallèle) : on REMONTE l'erreur au lieu de
    // l'avaler (résidu 6), sans casser l'affichage des sections saines.
    const [sd, sc, capt, delai, kpiIns] = await Promise.all([
      api.get(`/metropole/sortie-dynamique?annee=${year}`)
        .then((r) => r.data)
        .catch((err) => { errs.sortie = msg(err, 'Indicateur de sortie dynamique indisponible.'); return null; }),
      api.get('/metropole/service-cav?months=6')
        .then((r) => r.data)
        .catch((err) => { errs.service = msg(err, 'Taux de service CAV indisponible.'); return []; }),
      api.get(`/metropole/captation-par-commune?annee=${year}`)
        .then((r) => r.data)
        .catch((err) => { errs.captation = msg(err, 'Captation par commune indisponible.'); return []; }),
      api.get('/metropole/delai-intervention-incidents?months=12')
        .then((r) => r.data)
        .catch((err) => { errs.delai = msg(err, "Délai d'intervention des incidents indisponible."); return null; }),
      api.get(`/metropole/kpi-insertion?annee=${year}`)
        .then((r) => r.data)
        .catch((err) => { errs.kpiInsertion = msg(err, 'Indicateurs insertion / ETP indisponibles.'); return null; }),
    ]);

    setSortieDyn(sd);
    setServiceCav(sc || []);
    setCaptation(capt || []);
    setDelaiIncidents(delai);
    setKpiInsertion(kpiIns);
    setErrors(errs);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // Export CSV de la captation par commune (donnée clé de la convention) —
  // génération côté client, BOM UTF-8 pour ouverture directe dans Excel FR.
  const exportCaptationCsv = () => {
    const esc = (v) => { if (v == null) return ''; const s = String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const header = ['Commune', 'Code INSEE', 'Population', 'Tournées', 'Poids (kg)', 'kg/hab/an'];
    const lines = captation.map((c) => [c.commune, c.code_insee || '', c.population || '', c.nb_tournees, c.poids_kg, c.kg_par_hab != null ? c.kg_par_hab : ''].map(esc).join(';'));
    const csv = '﻿' + [header.join(';'), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `captation-par-commune-${year}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // Revue de convention (PDF) — fenêtre d'impression A4 (même mécanisme que les
  // autres exports du projet : PCM, parcours d'insertion). Synthèse agrégée non
  // nominative pour le dossier de l'auditeur Métropole.
  const printReview = () => {
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) return;
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const nf = (n, dec = 1) => (n == null || isNaN(Number(n)) ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: dec }));
    const d0 = dashboard || {};
    const captRows = captation.map((c) => `<tr><td>${esc(c.commune)}</td><td>${esc(c.code_insee || '—')}</td><td class="r">${c.population ? nf(c.population, 0) : '—'}</td><td class="r">${nf((Number(c.poids_kg) || 0) / 1000, 2)} t</td><td class="r">${c.kg_par_hab != null ? nf(c.kg_par_hab, 2) : '—'}</td></tr>`).join('');
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Revue de convention — Métropole ${year}</title>
      <style>
        @page { size: A4; margin: 16mm; }
        body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1e293b; font-size: 12px; }
        h1 { background: #0D9488; color: #fff; padding: 12px 16px; border-radius: 8px; font-size: 18px; margin: 0 0 6px; }
        .sub { color: #64748b; margin: 0 0 16px; }
        h2 { font-size: 13px; color: #0f766e; border-bottom: 2px solid #99f6e4; padding-bottom: 3px; margin: 18px 0 8px; }
        .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; }
        .kpi .l { color: #64748b; font-size: 10px; text-transform: uppercase; }
        .kpi .v { font-size: 18px; font-weight: 800; }
        table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        th, td { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; }
        th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; color: #475569; }
        td.r, th.r { text-align: right; }
        .foot { margin-top: 20px; color: #94a3b8; font-size: 10px; }
      </style></head><body>
      <h1>SOLIDATA — Revue de convention Métropole de Rouen</h1>
      <p class="sub">Année ${year} · édité le ${new Date().toLocaleDateString('fr-FR')}</p>
      <div class="kpis">
        <div class="kpi"><div class="l">Volume collecté</div><div class="v">${nf(d0.collecte?.total_tonnes, 1)} t</div></div>
        <div class="kpi"><div class="l">CO2 évité (mix ${d0.emissions_evitees?.mix_source === 'observe' ? 'mesuré' : 'forfaitaire'})</div><div class="v">${nf(d0.emissions_evitees?.co2_total_tonnes, 1)} t</div></div>
        <div class="kpi"><div class="l">Taux captation</div><div class="v">${d0.taux_captation ? nf(d0.taux_captation.kg_par_hab_an, 2) + ' kg/hab' : '—'}</div></div>
        <div class="kpi"><div class="l">Sortie dynamique</div><div class="v">${sortieDyn?.taux_dynamique_pct != null ? sortieDyn.taux_dynamique_pct + ' %' : '—'}</div></div>
        <div class="kpi"><div class="l">ETP réalisés</div><div class="v">${kpiInsertion?.total_etp != null ? nf(kpiInsertion.total_etp, 2) : '—'}</div></div>
        <div class="kpi"><div class="l">Délai interv. incidents</div><div class="v">${delaiIncidents?.global?.delai_moyen_jours != null ? nf(delaiIncidents.global.delai_moyen_jours, 1) + ' j' : '—'}</div></div>
      </div>
      <h2>Captation par commune (kg/habitant/an)</h2>
      <table><thead><tr><th>Commune</th><th>INSEE</th><th class="r">Population</th><th class="r">Tonnage</th><th class="r">kg/hab/an</th></tr></thead>
      <tbody>${captRows || '<tr><td colspan="5">Aucune donnée</td></tr>'}</tbody></table>
      <p class="foot">Document généré par SOLIDATA ERP — Solidarité Textiles. Indicateurs agrégés non nominatifs.</p>
      </body></html>`;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch (_) { /* impression annulée */ } }, 400);
  };

  const openCavDetail = async (cav) => {
    setSelectedCav(cav);
    setCavDetail(null);
    setCavActivity(null);
    setCavDetailError(null);
    try {
      // Le détail est essentiel ; la prévision d'activité (J-15/J+15) est optionnelle
      // et se dégrade sans casser la fiche (le graphe disparaît simplement).
      const [detailRes, actRes] = await Promise.all([
        api.get(`/metropole/cav/${cav.id}/details`),
        api.get(`/cav/${cav.id}/activity?days_before=15&days_after=15`).catch(() => ({ data: null })),
      ]);
      setCavDetail(detailRes.data);
      setCavActivity(actRes.data);
    } catch (err) {
      console.error(err);
      setCavDetail(null);
      setCavDetailError(err.response?.data?.error || err.message || 'Impossible de charger le détail de ce CAV.');
    }
  };

  const d = dashboard;

  // Filtre commune client-side
  const communes = useMemo(() => {
    const set = new Set(cavList.map((c) => c.commune).filter(Boolean));
    return Array.from(set).sort();
  }, [cavList]);

  const filteredCavList = useMemo(() => {
    if (!communeFilter) return cavList;
    return cavList.filter((c) => c.commune === communeFilter);
  }, [cavList, communeFilter]);

  // Part de tonnage « non rattaché » (CAV sans commune du référentiel INSEE) —
  // affichée honnêtement plutôt qu'omise (constat auditeur Métropole 2.2).
  const captTotals = useMemo(() => {
    const total = captation.reduce((s, c) => s + (Number(c.poids_kg) || 0), 0);
    const nonRattache = captation
      .filter((c) => !c.code_insee)
      .reduce((s, c) => s + (Number(c.poids_kg) || 0), 0);
    const nbRattachees = captation.filter((c) => c.code_insee).length;
    return {
      total,
      nonRattache,
      nonRattachePct: total ? Math.round((nonRattache / total) * 1000) / 10 : 0,
      nbRattachees,
    };
  }, [captation]);

  // Plage d'années étendue (10 ans en arrière, 1 an en avant)
  const years = useMemo(
    () => Array.from({ length: 12 }, (_, i) => currentYear - 10 + i),
    [currentYear]
  );

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Reporting Métropole de Rouen"
          subtitle="Suivi des indicateurs environnementaux et sociaux"
          icon={Building2}
          actions={
            <div className="flex flex-wrap gap-2 items-center">
              <select value={month} onChange={e => setMonth(parseInt(e.target.value))} className="input-modern w-auto" title="Mois">
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="input-modern w-auto" title="Année">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 ml-2">
                <Filter className="w-3.5 h-3.5" /> Commune :
              </span>
              <select value={communeFilter} onChange={(e) => setCommuneFilter(e.target.value)} className="input-modern w-auto" title="Filtrer par commune">
                <option value="">Toutes ({communes.length})</option>
                {communes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={exportCaptationCsv} disabled={!captation.length}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold disabled:opacity-40"
                title="Exporter la captation par commune (CSV)">
                <Download className="w-4 h-4" /> CSV
              </button>
              <button onClick={printReview} disabled={!dashboard}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40"
                title="Revue de convention (PDF imprimable)">
                <Printer className="w-4 h-4" /> Revue (PDF)
              </button>
            </div>
          }
        />

        {/* Erreur section critique (résidu 6) — visible même si le tableau de bord ne charge pas */}
        {!loading && errors.dashboard && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
            <p className="font-semibold">Tableau de bord Métropole indisponible</p>
            <p className="mt-0.5">{errors.dashboard}</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : d && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <KPI label="Volume collecté" value={`${(d.collecte.total_tonnes).toFixed(1)} t`} sub={`${d.collecte.tours_completees} tournées`} color="green" />
              <KPI label="CO2 évité" value={`${d.emissions_evitees.co2_total_tonnes} t`} sub={`Réemploi ${d.emissions_evitees.detail.reemploi_tonnes}t · mix ${d.emissions_evitees.mix_source === 'observe' ? 'mesuré' : 'forfaitaire'}`} color="blue" />
              <KPI label="Effectifs" value={d.effectifs.total} sub={`CDI/CDD: ${d.effectifs.cdi_cdd} | Intérim: ${d.effectifs.interimaires}`} color="purple" />
              <KPI label="CAV actifs" value={d.cav.actifs} sub={`dont ${d.cav.indisponibles} indisponible(s)`} color="amber" />
              <KPI label="CAV total" value={d.cav.total} sub={`${d.effectifs.formation} en formation`} color="gray" />
              {d.taux_captation && (
                <KPI
                  label="Taux captation"
                  value={`${d.taux_captation.kg_par_hab_an} kg/hab/an`}
                  sub={`Objectif Refashion: ${d.taux_captation.objectif_refashion_kg} kg | Pop: ${(d.taux_captation.population_totale / 1000).toFixed(0)}k hab`}
                  color={d.taux_captation.kg_par_hab_an >= d.taux_captation.objectif_refashion_kg ? 'green' : 'amber'}
                />
              )}
            </div>

            {/* KPIs P0-E audit Métropole */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {errors.sortie ? (
                <SectionErrorCard title={`Taux de sortie dynamique ${year}`} msg={errors.sortie} />
              ) : sortieDyn && (
                <div className="bg-white rounded-2xl shadow p-5 border border-emerald-100">
                  <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Taux de sortie dynamique {sortieDyn.annee}</div>
                  <div className="text-4xl font-extrabold text-emerald-600">
                    {sortieDyn.taux_dynamique_pct != null ? `${sortieDyn.taux_dynamique_pct}%` : '—'}
                  </div>
                  <div className="text-sm text-slate-500 mt-2">
                    {sortieDyn.dynamiques}/{sortieDyn.total_sorties} sorties — CDI {sortieDyn.cdi} · CDD {sortieDyn.cdd} · Formation {sortieDyn.formation} · Création {sortieDyn.creation}
                  </div>
                </div>
              )}
              {errors.service ? (
                <SectionErrorCard title="Taux de service CAV" msg={errors.service} />
              ) : serviceCav.length > 0 && (() => {
                const last = serviceCav[serviceCav.length - 1];
                return (
                  <div className="bg-white rounded-2xl shadow p-5 border border-blue-100">
                    <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Taux de service CAV (dernier mois)</div>
                    <div className="text-4xl font-extrabold text-blue-600">
                      {last.taux_service_pct != null ? `${last.taux_service_pct}%` : '—'}
                    </div>
                    <div className="text-sm text-slate-500 mt-2">
                      {last.collectes} collectes / {last.sautes} sautées sur {last.planifies} planifiées
                    </div>
                  </div>
                );
              })()}
              {errors.captation ? (
                <SectionErrorCard title="Captation par commune" msg={errors.captation} />
              ) : captation.length > 0 && (
                <div className="bg-white rounded-2xl shadow p-5 border border-amber-100">
                  <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Captation par commune (top 3)</div>
                  <div className="space-y-1 text-sm mt-2">
                    {captation.slice(0, 3).map((c) => (
                      <div key={c.code_insee || c.commune} className="flex justify-between text-slate-700">
                        <span className="truncate font-medium">{c.commune}</span>
                        <span className="tabular-nums text-amber-700 font-bold">{c.kg_par_hab != null ? `${c.kg_par_hab} kg/hab` : `${(c.poids_kg / 1000).toFixed(1)}t`}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    {captation.length} commune(s) · non rattaché {(captTotals.nonRattache / 1000).toFixed(1)}t ({captTotals.nonRattachePct}%)
                  </div>
                </div>
              )}
            </div>

            {/* Contrepartie sociale (ETP, absentéisme, formation, insertion) +
                délai d'intervention incidents — vague 2, items 53b/53c. Agrégats. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {errors.delai ? (
                <SectionErrorCard title="Délai d'intervention incidents" msg={errors.delai} />
              ) : delaiIncidents?.global && (
                <div className="bg-white rounded-2xl shadow p-5 border border-rose-100">
                  <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Délai moyen d'intervention</div>
                  <div className="text-4xl font-extrabold text-rose-600">
                    {delaiIncidents.global.delai_moyen_jours != null ? `${delaiIncidents.global.delai_moyen_jours} j` : '—'}
                  </div>
                  <div className="text-sm text-slate-500 mt-2">
                    {delaiIncidents.global.resolus}/{delaiIncidents.global.total} incidents résolus · {delaiIncidents.global.ouverts} en cours
                  </div>
                </div>
              )}
              {errors.kpiInsertion ? (
                <SectionErrorCard title="Indicateurs insertion / ETP" msg={errors.kpiInsertion} />
              ) : kpiInsertion && (
                <div className="bg-white rounded-2xl shadow p-5 border border-indigo-100">
                  <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> ETP réalisés {kpiInsertion.annee}</div>
                  <div className="text-4xl font-extrabold text-indigo-600">{kpiInsertion.total_etp != null ? kpiInsertion.total_etp : '—'}</div>
                  <div className="text-sm text-slate-500 mt-2">{kpiInsertion.total_salaries_actifs ?? '—'} salariés actifs · base {kpiInsertion.etp_reference_heures} h/an</div>
                </div>
              )}
              {kpiInsertion && !errors.kpiInsertion && (
                <div className="bg-white rounded-2xl shadow p-5 border border-amber-100">
                  <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Absentéisme global {kpiInsertion.annee}</div>
                  <div className="text-4xl font-extrabold text-amber-600">{kpiInsertion.absenteisme_taux_pct != null ? `${kpiInsertion.absenteisme_taux_pct}%` : '—'}</div>
                  <div className="text-sm text-slate-500 mt-2">Formation : {kpiInsertion.formation_total_heures != null ? `${Math.round(kpiInsertion.formation_total_heures)} h` : '—'}</div>
                </div>
              )}
              {kpiInsertion?.insertion && !errors.kpiInsertion && (
                <div className="bg-white rounded-2xl shadow p-5 border border-emerald-100">
                  <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">En parcours d'insertion</div>
                  <div className="text-4xl font-extrabold text-emerald-600">{kpiInsertion.insertion.en_parcours ?? '—'}</div>
                  <div className="text-sm text-slate-500 mt-2">sur {kpiInsertion.insertion.actifs ?? '—'} salariés actifs</div>
                </div>
              )}
            </div>

            {/* Historique mensuel */}
            {d.historique_mensuel?.length > 0 && (
              <Section title="Évolution mensuelle du tonnage collecté" icon={BarChart3}>
                <div className="flex items-end gap-1 h-48">
                  {d.historique_mensuel.map((h, i) => {
                    const maxKg = Math.max(...d.historique_mensuel.map(x => parseFloat(x.total_kg)));
                    const pct = maxKg > 0 ? (parseFloat(h.total_kg) / maxKg) * 100 : 0;
                    const moisLabel = new Date(h.mois).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[10px] text-gray-500 font-medium">{(parseFloat(h.total_kg) / 1000).toFixed(1)}t</span>
                        <div className="w-full bg-primary/80 rounded-t" style={{ height: `${Math.max(pct, 2)}%` }} />
                        <span className="text-[10px] text-gray-400">{moisLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Captation par commune (kg/habitant) — vue détaillée, part « non rattaché » affichée honnêtement */}
            {(errors.captation || captation.length > 0) && (
              <Section title="Captation par commune (kg/habitant/an)" icon={BarChart3}>
                {errors.captation ? (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
                    {errors.captation}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-3 mb-4 text-sm">
                      <span className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700">
                        {captTotals.nbRattachees} commune(s) rattachée(s)
                      </span>
                      <span className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                        Tonnage réparti : {(captTotals.total / 1000).toFixed(1)} t
                      </span>
                      <span className={`px-3 py-1.5 rounded-lg border ${captTotals.nonRattache > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                        Non rattaché : {(captTotals.nonRattache / 1000).toFixed(1)} t ({captTotals.nonRattachePct}%)
                      </span>
                    </div>
                    {captTotals.nonRattache > 0 && (
                      <p className="text-xs text-slate-500 mb-3">
                        Le tonnage « non rattaché » provient de CAV sans commune du référentiel INSEE : il ne peut pas être rapporté à une population.
                        Rattachez ces CAV depuis <span className="font-medium">Gestion des CAV</span> pour le ventiler par commune.
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="text-left py-2 px-3">Commune</th>
                            <th className="text-left py-2 px-3">INSEE</th>
                            <th className="text-right py-2 px-3">Population</th>
                            <th className="text-right py-2 px-3">Tournées</th>
                            <th className="text-right py-2 px-3">Tonnage</th>
                            <th className="text-right py-2 px-3">kg/hab/an</th>
                          </tr>
                        </thead>
                        <tbody>
                          {captation.map((c) => {
                            const kgHab = c.kg_par_hab != null ? Number(c.kg_par_hab) : null;
                            const objectif = d?.taux_captation?.objectif_refashion_kg || 3.6;
                            const atteint = kgHab != null ? kgHab >= objectif : null;
                            return (
                              <tr key={c.code_insee || c.commune} className={`border-b border-slate-100 last:border-0 ${!c.code_insee ? 'bg-amber-50/40' : ''}`}>
                                <td className="py-2 px-3 font-medium text-slate-700">
                                  {c.code_insee ? c.commune : (
                                    <span className="inline-flex items-center gap-1.5 text-amber-700">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" /> {c.commune}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono text-xs text-slate-500">{c.code_insee || '—'}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{c.population ? Number(c.population).toLocaleString('fr-FR') : '—'}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-slate-500">{c.nb_tournees}</td>
                                <td className="py-2 px-3 text-right tabular-nums font-semibold text-slate-700">{(Number(c.poids_kg) / 1000).toFixed(2)} t</td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {kgHab != null
                                    ? <span className={atteint ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>{kgHab.toFixed(2)}</span>
                                    : <span className="text-slate-400">—</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-slate-400 mt-3">
                      Tonnage réparti au prorata des CAV collectés par commune dans chaque tournée (objectif Refashion {d?.taux_captation?.objectif_refashion_kg || 3.6} kg/hab/an).
                    </p>
                  </>
                )}
              </Section>
            )}

            {/* Carte des CAV */}
            <Section title="Carte des Conteneurs d'Apport Volontaire" icon={MapIcon}>
              {/* Carte Leaflet */}
              <div className="rounded-lg overflow-hidden border mb-4" style={{ height: '400px' }}>
                <MapContainer center={[49.4231, 1.0993]} zoom={11} style={{ height: '100%', width: '100%' }}>
                  <MapSizeFix />
                  <FondCarte />
                  {filteredCavList.filter(c => c.latitude && c.longitude).map(c => (
                    <CircleMarker
                      key={c.id}
                      center={[c.latitude, c.longitude]}
                      radius={8}
                      pathOptions={{
                        color: c.status === 'active' ? '#22C55E' : '#EF4444',
                        fillColor: c.status === 'active' ? '#22C55E' : '#EF4444',
                        fillOpacity: 0.6,
                      }}
                      eventHandlers={{ click: () => openCavDetail(c) }}
                    >
                      <Popup>
                        <div className="text-xs">
                          <p className="font-bold">{c.name}</p>
                          <p>{c.commune}</p>
                          <p>Collectes (12m) : {c.nb_collectes_12m || 0}</p>
                          <p>Total : {((parseFloat(c.total_kg_12m) || 0) / 1000).toFixed(2)} t</p>
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}
                </MapContainer>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Liste des CAV */}
                <div className="lg:col-span-1 max-h-96 overflow-y-auto space-y-1">
                  {filteredCavList.map(c => (
                    <button key={c.id} onClick={() => openCavDetail(c)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                        selectedCav?.id === c.id ? 'bg-primary/10 border border-primary' : 'hover:bg-gray-50 border border-transparent'
                      }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-gray-500">{c.commune}</p>
                        </div>
                        <span className={`w-2.5 h-2.5 rounded-full ${c.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                      </div>
                    </button>
                  ))}
                </div>

                {/* Détail CAV sélectionné */}
                <div className="lg:col-span-2">
                  {!selectedCav ? (
                    <div className="flex items-center justify-center h-64 text-gray-400">Cliquez sur un CAV pour voir ses détails</div>
                  ) : cavDetailError ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center px-4">
                      <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm max-w-sm">
                        <p className="font-semibold">Détail du CAV indisponible</p>
                        <p className="mt-0.5">{cavDetailError}</p>
                      </div>
                      <button onClick={() => openCavDetail(selectedCav)} className="text-sm text-primary hover:underline">Réessayer</button>
                    </div>
                  ) : !cavDetail ? (
                    <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-lg font-bold">{cavDetail.cav.name}</h4>
                          <p className="text-sm text-gray-500">{cavDetail.cav.address} — {cavDetail.cav.commune}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${cavDetail.cav.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {cavDetail.cav.status === 'active' ? 'Actif' : `Indisponible${cavDetail.cav.unavailable_reason ? ` — ${cavDetail.cav.unavailable_reason}` : ''}`}
                        </span>
                      </div>

                      {/* Stats résumées */}
                      <div className="grid grid-cols-3 gap-3">
                        <MiniCard label="Collectes (12m)" value={cavDetail.stats.nb_collectes} />
                        <MiniCard label="Total (12m)" value={`${(parseFloat(cavDetail.stats.total_kg) / 1000).toFixed(2)} t`} />
                        <MiniCard label="Moyenne" value={`${Math.round(cavDetail.stats.avg_kg)} kg`} />
                      </div>

                      {/* Évolution remplissage : 15j historique + 15j prévision */}
                      {cavActivity?.jours?.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase">Évolution du remplissage (J-15 → J+15)</p>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500">
                              <span className="inline-flex items-center gap-1"><Radio className="w-3 h-3 text-teal-600" /> Sonde</span>
                              <span className="inline-flex items-center gap-1"><Bot className="w-3 h-3 text-blue-500" /> Prédiction</span>
                              <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500" /> Seuil 80%</span>
                            </div>
                          </div>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart
                              data={cavActivity.jours.map((j) => ({
                                ...j,
                                label: new Date(j.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
                                shortLabel: new Date(j.date).getDate().toString(),
                              }))}
                              margin={{ top: 5, right: 8, left: -20, bottom: 0 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis dataKey="shortLabel" tick={{ fontSize: 10 }} interval={1} />
                              <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 120]} />
                              <Tooltip
                                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                formatter={(val) => [`${val}%`, 'Remplissage']}
                                labelFormatter={(_, payload) => {
                                  const p = payload?.[0]?.payload;
                                  if (!p) return '';
                                  const tag = p.type === 'prevision' ? ' 🤖 (prévision)'
                                    : p.source === 'sensor' ? ' 📡 (sonde)'
                                    : ' (estimé)';
                                  return (p.label || '') + tag;
                                }}
                              />
                              <ReferenceLine y={80} stroke="#EF4444" strokeDasharray="3 3" />
                              <Bar dataKey="fill_pct" radius={[3, 3, 0, 0]} maxBarSize={14}>
                                {cavActivity.jours.map((j, i) => (
                                  <Cell
                                    key={i}
                                    fill={
                                      j.type === 'prevision' ? '#93C5FD'
                                        : j.source === 'sensor' ? '#0D9488'
                                        : '#94A3B8'
                                    }
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Tableau des 3 derniers passages */}
                      {cavDetail.fill_history?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">3 derniers passages chauffeur</p>
                          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                              <tr>
                                <th className="text-left py-2 px-3">Date</th>
                                <th className="text-left py-2 px-3">Heure</th>
                                <th className="text-right py-2 px-3">Remplissage déclaré</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cavDetail.fill_history.slice(0, 3).map((f, i) => {
                                const date = new Date(f.date);
                                const fillPct = f.fill_level ? Math.round((f.fill_level / 5) * 100) : null;
                                const colorClass = fillPct == null ? 'text-slate-400'
                                  : fillPct >= 80 ? 'text-red-600 font-semibold'
                                  : fillPct >= 60 ? 'text-orange-600 font-semibold'
                                  : fillPct >= 40 ? 'text-amber-600'
                                  : 'text-green-600';
                                return (
                                  <tr key={i} className="border-b border-slate-100 last:border-0">
                                    <td className="py-2 px-3">{date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                    <td className="py-2 px-3 text-slate-500">{date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td className={`py-2 px-3 text-right ${colorClass}`}>
                                      {fillPct != null ? `${fillPct}% (niv. ${f.fill_level}/5)` : '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* QR Code info */}
                      {cavDetail.cav.qr_code_data && (
                        <div className="text-xs text-gray-500">
                          QR Code : <span className="font-mono">{cavDetail.cav.qr_code_data}</span>
                          {cavDetail.qr_scans?.length > 0 && ` — ${cavDetail.qr_scans.length} scan(s) enregistré(s)`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Section>
          </>
        )}
      </div>
    </Layout>
  );
}

function KPI({ label, value, sub, color }) {
  const colors = {
    green: 'border-green-200 bg-green-50', blue: 'border-blue-200 bg-blue-50',
    purple: 'border-purple-200 bg-purple-50', amber: 'border-amber-200 bg-amber-50',
    gray: 'border-gray-200 bg-gray-50',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function MiniCard({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center">
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

// Carte d'erreur pour un indicateur secondaire en échec (résidu 6) — remplace
// le silence : l'auditeur voit qu'un indicateur n'a pas pu être calculé.
function SectionErrorCard({ title, msg }) {
  return (
    <div className="bg-amber-50 rounded-2xl shadow-sm p-5 border border-amber-200">
      <div className="text-xs uppercase tracking-wider text-amber-600 font-semibold mb-1">{title}</div>
      <div className="text-sm text-amber-800 font-medium mt-1">Indicateur indisponible</div>
      <div className="text-xs text-amber-700 mt-1">{msg}</div>
    </div>
  );
}
