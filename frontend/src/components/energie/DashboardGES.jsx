import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { Gauge, Zap, Fuel, TrendingUp, Truck, Droplets, Flame, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState } from '../index';
import {
  StatCard, DeriveBadge, FacteursWarning, posteLabel, POSTE_COLORS,
  fmtNum, fmtEur, fmtUnite, tco2eLabel, caSourceLabel, yearsList,
} from './energieShared';

// Onglet « Tableau de bord GES » : KPI, avertissement facteurs, émissions par
// poste (barres), L/100 km par véhicule (badge dérive), encart VSME B3/B6.
export default function DashboardGES({ annee, setAnnee }) {
  const [dash, setDash] = useState(null);
  const [vsme, setVsme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/energie/dashboard?annee=${annee}`),
      api.get(`/energie/vsme-b3b6?annee=${annee}`),
    ])
      .then(([d, v]) => { setDash(d.data); setVsme(v.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [annee]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner size="lg" message="Chargement du tableau de bord GES…" />;
  if (error) return <ErrorState variant="card" title="Tableau de bord indisponible" message={error} onRetry={load} />;
  if (!dash) return null;

  const energie = dash.energie_batiments || [];
  const carburant = dash.carburant_flotte || [];
  const totaux = dash.totaux || {};
  const intensite = dash.intensite || {};
  const vehicules = dash.vehicules || [];
  const seuil = dash.seuil_derive_pct;

  // Émissions par poste (barres) — on ne trace QUE les postes dont le tCO2e est
  // calculable ; les postes sans facteur sont listés à part (jamais un faux 0).
  const tous = [...energie, ...carburant];
  const chartData = tous
    .filter((e) => e.tco2e != null)
    .map((e) => ({ poste: posteLabel(e.poste), key: e.poste, tco2e: e.tco2e }));
  const sansFacteur = tous.filter((e) => e.facteur_manquant);

  const b3 = vsme?.b3_energie_ges || {};
  const b3e = b3.energie || {};
  const b3g = b3.ges || {};
  const b6 = vsme?.b6_eau || {};

  const intensiteVal = intensite.tco2e_par_keuro_ca;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <FacteursWarning message={dash.avertissement_facteurs} />
        <div className="flex items-center gap-2">
          <label htmlFor="ges-year" className="text-sm text-slate-500">Année</label>
          <select id="ges-year" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}
            className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
            {yearsList().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={load} className="text-xs text-slate-400 hover:text-teal-700 inline-flex items-center gap-1" title="Actualiser">
            <RefreshCw className="w-3.5 h-3.5" /> Actualiser
          </button>
        </div>
      </div>

      {/* KPI principaux */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Gauge} label={`Émissions totales ${annee}`}
          value={totaux.tco2e_total != null ? `${fmtNum(totaux.tco2e_total, 3)} tCO2e` : '—'}
          sub="énergie + carburant" tone="teal" />
        <StatCard icon={Zap} label="Énergie bâtiments"
          value={totaux.tco2e_energie != null ? `${fmtNum(totaux.tco2e_energie, 3)} tCO2e` : '—'}
          sub="électricité, gaz, eau" tone="blue" />
        <StatCard icon={Fuel} label="Carburant flotte"
          value={totaux.tco2e_carburant != null ? `${fmtNum(totaux.tco2e_carburant, 3)} tCO2e` : '—'}
          sub="pleins véhicules" tone="amber" />
        <StatCard icon={TrendingUp} label="Intensité carbone"
          value={intensiteVal != null ? `${fmtNum(intensiteVal, 3)} tCO2e/k€` : '—'}
          sub={intensite.ca_reference != null
            ? `CA réf. ${fmtEur(intensite.ca_reference)} · ${caSourceLabel(intensite.ca_source)}`
            : 'CA non renseigné'}
          tone={intensiteVal != null ? 'emerald' : 'slate'} />
      </div>

      {/* Émissions par poste (barres) */}
      <div className="bg-white rounded-xl border p-4">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Émissions par poste ({annee})</h2>
        <p className="text-xs text-slate-400 mb-3">En tCO2e — facteurs d'émission indicatifs et paramétrables.</p>
        {chartData.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">
            Aucune émission calculable pour {annee}. Saisissez des relevés / pleins et vérifiez que les facteurs d'émission sont renseignés.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="poste" fontSize={12} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => [`${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} tCO2e`, 'Émissions']} />
              <Bar dataKey="tco2e" name="tCO2e" radius={[4, 4, 0, 0]}>
                {chartData.map((d) => <Cell key={d.key} fill={POSTE_COLORS[d.key] || '#0d9488'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {sansFacteur.length > 0 && (
          <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
            Poste(s) sans facteur d'émission (exclus du graphe, à renseigner dans Réglages) :{' '}
            {sansFacteur.map((e) => posteLabel(e.poste)).join(', ')}.
          </p>
        )}
      </div>

      {/* Détail énergie & carburant */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><Zap className="w-4 h-4 text-blue-500" /> Énergie des bâtiments</h3>
          {energie.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">Aucun relevé saisi pour {annee}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr><th className="text-left py-2 pr-2">Poste</th><th className="text-right py-2 px-2">Conso.</th><th className="text-right py-2 px-2">Coût</th><th className="text-right py-2 pl-2">Émissions</th></tr>
                </thead>
                <tbody>
                  {energie.map((e) => (
                    <tr key={e.poste} className="border-b border-slate-50">
                      <td className="py-2 pr-2 font-medium text-slate-700">{posteLabel(e.poste)}</td>
                      <td className="py-2 px-2 text-right text-slate-600">{fmtUnite(e.conso, e.facteur_unite || '', 1)}</td>
                      <td className="py-2 px-2 text-right text-slate-600">{fmtEur(e.cout_euros)}</td>
                      <td className={`py-2 pl-2 text-right ${e.facteur_manquant ? 'text-amber-600' : 'text-slate-700 font-medium'}`}>{tco2eLabel(e.tco2e, e.facteur_manquant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><Fuel className="w-4 h-4 text-amber-500" /> Carburant de la flotte</h3>
          {carburant.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">Aucun plein saisi pour {annee}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr><th className="text-left py-2 pr-2">Type</th><th className="text-right py-2 px-2">Litres</th><th className="text-right py-2 px-2">Coût</th><th className="text-right py-2 pl-2">Émissions</th></tr>
                </thead>
                <tbody>
                  {carburant.map((e) => (
                    <tr key={e.poste} className="border-b border-slate-50">
                      <td className="py-2 pr-2 font-medium text-slate-700">{posteLabel(e.poste)}</td>
                      <td className="py-2 px-2 text-right text-slate-600">{fmtUnite(e.litres, 'L', 1)}</td>
                      <td className="py-2 px-2 text-right text-slate-600">{fmtEur(e.cout_euros)}</td>
                      <td className={`py-2 pl-2 text-right ${e.facteur_manquant ? 'text-amber-600' : 'text-slate-700 font-medium'}`}>{tco2eLabel(e.tco2e, e.facteur_manquant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* L/100 km par véhicule + dérive */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Truck className="w-4 h-4 text-teal-600" /> Consommation L/100 km par véhicule</h3>
          {seuil != null && <span className="text-[11px] text-slate-400">Seuil de dérive : +{seuil} % vs moyenne</span>}
        </div>
        <p className="text-xs text-slate-400 mb-3">Méthode « plein à plein » (le 1er plein sert de référence). Une dérive signale une hausse anormale — piste maintenance.</p>
        {vehicules.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">
            Aucune consommation calculable pour {annee} — il faut au moins deux pleins avec kilométrage relevé pour un même véhicule.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 pr-2">Véhicule</th>
                  <th className="text-right py-2 px-2">L/100 km</th>
                  <th className="text-right py-2 px-2">Dernière</th>
                  <th className="text-right py-2 px-2">Moy. antérieure</th>
                  <th className="text-right py-2 px-2">Km parcourus</th>
                  <th className="text-center py-2 pl-2">État</th>
                </tr>
              </thead>
              <tbody>
                {vehicules.map((v) => (
                  <tr key={v.vehicle_id} className={`border-b border-slate-50 ${v.derive ? 'bg-red-50/40' : ''}`}>
                    <td className="py-2 pr-2 font-medium text-slate-700">{v.registration || v.name || `#${v.vehicle_id}`}{v.registration && v.name ? <span className="text-slate-400 font-normal"> · {v.name}</span> : null}</td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-800">{fmtNum(v.conso_l_100km, 2)}</td>
                    <td className="py-2 px-2 text-right text-slate-600">{fmtNum(v.derniere_conso, 2)}</td>
                    <td className="py-2 px-2 text-right text-slate-600">{v.moyenne_hors_derniere != null ? fmtNum(v.moyenne_hors_derniere, 2) : '—'}</td>
                    <td className="py-2 px-2 text-right text-slate-600">{fmtNum(v.km_parcourus, 0)} km</td>
                    <td className="py-2 pl-2 text-center"><DeriveBadge derive={v.derive} seuil={seuil} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Encart VSME B3 / B6 */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 mb-1">Indicateurs VSME (B3 énergie/GES · B6 eau)</h3>
        <p className="text-xs text-slate-400 mb-3">{vsme?.note || 'Structure préparatoire à l\'export VSME (RSEI-09).'}</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Zap} label="Électricité" value={`${fmtNum(b3e.electricite_kwh, 0)} kWh`} tone="blue" />
          <StatCard icon={Flame} label="Gaz" value={`${fmtNum(b3e.gaz_kwh, 0)} kWh`} tone="amber" />
          <StatCard icon={Gauge} label="Énergie totale" value={`${fmtNum(b3e.total_energie_kwh, 0)} kWh`}
            sub={b3e.part_renouvelable_pct != null ? `${fmtNum(b3e.part_renouvelable_pct, 0)} % renouvelable` : 'part renouvelable non renseignée'} tone="teal" />
          <StatCard icon={Droplets} label="Eau (B6)" value={`${fmtNum(b6.consommation_eau_m3, 0)} m³`} tone="slate" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Scope 1 (direct)</div>
            <div className="mt-1 text-xl font-bold text-slate-800">{fmtNum(b3g.scope1_tco2e, 3)} tCO2e</div>
            <div className="text-[10px] text-slate-400 mt-0.5">carburant flotte + gaz bâtiment</div>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Scope 2 (indirect)</div>
            <div className="mt-1 text-xl font-bold text-slate-800">{fmtNum(b3g.scope2_tco2e, 3)} tCO2e</div>
            <div className="text-[10px] text-slate-400 mt-0.5">électricité achetée</div>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Total GES</div>
            <div className="mt-1 text-xl font-bold text-slate-800">{fmtNum(b3g.total_tco2e, 3)} tCO2e</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{b3g.methode || 'méthode ADEME'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
