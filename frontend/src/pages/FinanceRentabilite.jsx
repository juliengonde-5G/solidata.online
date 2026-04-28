import { useState, useEffect, useCallback } from 'react';
import { BadgeCheck, BarChart3, Euro, Factory, Target, Truck } from 'lucide-react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, KPICard, LoadingSpinner, Section } from '../components';

// ══════════════════════════════════════════
// FINANCE RENTABILITE MATIERE
// Cout complet Collecte → Tri → Qualites
// Logique: Charges directes + FG alloues = Cout complet
// ══════════════════════════════════════════

const fmt = (v) => v != null ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '—';
const fmtK = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return fmt(v);
};
const fmtPct = (v) => v != null ? `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%` : '—';

export default function FinanceRentabilite() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/rentabilite/${year}`);
      setData(res.data);
    } catch (err) {
      console.error('Erreur chargement rentabilite:', err);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => { loadData(); }, [loadData]);

  const c = data?.collecte || {};
  const t = data?.tri || {};
  const fg = data?.frais_generaux || {};
  const qualites = data?.qualites || [];
  const totaux = data?.totaux || {};

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Rentabilite Matiere"
          subtitle="Cout complet par activite et marge par qualite"
          icon={BarChart3}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Rentabilite' },
          ]}
          actions={
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          }
        />

        {loading ? (
          <div className="flex items-center justify-center py-32"><LoadingSpinner /></div>
        ) : !data ? (
          <div className="card-modern p-16 text-center text-slate-400">Aucune donnee disponible</div>
        ) : (
          <>
            {/* KPIs synthèse */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KPICard title="Cout / tonne collecte" value={fmt(totaux.cout_tonne_collecte)} unit="EUR/t" icon={Truck} accent="primary" />
              <KPICard title="Cout / tonne tri" value={fmt(totaux.cout_tonne_tri)} unit="EUR/t" icon={Factory} accent="amber" />
              <KPICard title="CA total exutoires" value={fmtK(totaux.ca_total)} unit="EUR" icon={Euro} accent="emerald" />
              <KPICard title="Marge totale" value={fmtK(totaux.marge_totale)} unit="EUR" icon={Target} accent={totaux.marge_totale >= 0 ? 'emerald' : 'red'} />
            </div>

            {/* Flux matière : Collecte → Tri → Qualités */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* COLLECTE */}
              <CostCard
                title="Collecte"
                subtitle={c.centre || 'Centre Collecte'}
                icon="🚛"
                color="teal"
                rows={[
                  { label: 'Charges directes', value: c.charges_directes },
                  { label: 'Frais generaux alloues', value: c.fg_alloues, sub: true },
                  { label: 'COUT COMPLET', value: c.cout_complet, bold: true },
                  { label: 'Tonnes collectees', value: c.tonnes, unit: 't' },
                  { label: 'Cout / tonne', value: c.cout_tonne, unit: 'EUR/t', bold: true, accent: true },
                  { label: 'Produits', value: c.produits },
                  { label: 'MARGE', value: c.marge, bold: true, color: c.marge >= 0 ? 'emerald' : 'red' },
                ]}
              />

              {/* TRI */}
              <CostCard
                title="Tri & Recyclage"
                subtitle={t.centre || 'Centre Tri'}
                icon="🏭"
                color="amber"
                rows={[
                  { label: 'Charges directes', value: t.charges_directes },
                  { label: 'Frais generaux alloues', value: t.fg_alloues, sub: true },
                  { label: 'Transfert interne collecte', value: t.transfert_interne, sub: true },
                  { label: 'COUT COMPLET', value: t.cout_complet, bold: true },
                  { label: 'Tonnes au tri', value: t.tonnes, unit: 't' },
                  { label: 'Cout / tonne', value: t.cout_tonne, unit: 'EUR/t', bold: true, accent: true },
                  { label: 'Produits', value: t.produits },
                  { label: 'MARGE', value: t.marge, bold: true, color: t.marge >= 0 ? 'emerald' : 'red' },
                ]}
              />

              {/* FRAIS GENERAUX */}
              <CostCard
                title="Frais Generaux"
                subtitle="Repartition par cle de volume"
                icon="📊"
                color="slate"
                rows={[
                  { label: 'Total frais generaux', value: fg.total, bold: true },
                  { label: 'Alloue Collecte', value: fg.alloue_collecte },
                  { label: 'Alloue Tri', value: fg.alloue_tri },
                  { label: 'Ratio tri (cle)', value: fg.ratio_tri, unit: '%', accent: true },
                ]}
              />
            </div>

            {/* Rentabilité par qualité */}
            <Section title="Rentabilite par qualite de matiere" subtitle="Cout complet tri applique a chaque qualite, compare au prix de vente moyen" icon={BadgeCheck}>
              {qualites.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Aucune donnee d'expedition disponible. Renseignez les expeditions pour voir la marge par qualite.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Qualite</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Tonnes</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">CA HT</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">PV moyen / t</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Ct complet / t</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Marge / t</th>
                        <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase">Marge %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qualites.map((q, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-800">{q.qualite}</td>
                          <td className="text-right px-4 py-3">{q.tonnes}</td>
                          <td className="text-right px-4 py-3">{fmt(q.ca_ht)}</td>
                          <td className="text-right px-4 py-3 font-medium">{fmt(q.pv_moyen)}</td>
                          <td className="text-right px-4 py-3 text-slate-500">{fmt(q.cout_complet)}</td>
                          <td className={`text-right px-4 py-3 font-bold ${q.marge >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(q.marge)}</td>
                          <td className={`text-right px-4 py-3 font-medium ${q.marge_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtPct(q.marge_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Note méthodologique */}
            <div className="card-modern p-5 bg-slate-50 border-slate-200">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Methodologie de calcul</h4>
              <div className="text-xs text-slate-500 space-y-1.5 leading-relaxed">
                <p><strong>Cout complet collecte</strong> = Charges directes collecte + Quote-part frais generaux (cle de repartition : ratio volumique tonnes tri / tonnes collectees)</p>
                <p><strong>Transfert interne</strong> = Cout / tonne collecte x Tonnes entrees au tri (valorisation de la matiere brute livree par la collecte au tri)</p>
                <p><strong>Cout complet tri</strong> = Charges directes tri + Quote-part frais generaux + Transfert interne collecte</p>
                <p><strong>Marge par qualite</strong> = Prix de vente moyen / tonne - Cout complet tri / tonne</p>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// Cost Card Component
// ══════════════════════════════════════════

function CostCard({ title, subtitle, icon, color, rows }) {
  const borderColors = { teal: 'border-teal-200', amber: 'border-amber-200', slate: 'border-slate-200' };
  const bgColors = { teal: 'bg-teal-50', amber: 'bg-amber-50', slate: 'bg-slate-50' };

  return (
    <div className={`card-modern overflow-hidden`}>
      <div className={`px-5 py-4 ${bgColors[color] || 'bg-slate-50'} border-b ${borderColors[color] || 'border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="p-5 space-y-2">
        {rows.map((row, i) => (
          <div key={i} className={`flex justify-between items-center ${row.bold ? 'pt-2 border-t border-slate-100' : ''} ${row.sub ? 'pl-3' : ''}`}>
            <span className={`text-sm ${row.bold ? 'font-semibold text-slate-800' : row.sub ? 'text-slate-400 text-xs' : 'text-slate-600'}`}>
              {row.label}
            </span>
            <span className={`text-sm font-mono ${
              row.color === 'emerald' ? 'text-emerald-600 font-bold' :
              row.color === 'red' ? 'text-red-600 font-bold' :
              row.accent ? 'text-teal-700 font-bold' :
              row.bold ? 'font-bold text-slate-900' :
              'text-slate-700'
            }`}>
              {row.value != null ? (row.unit === 't' ? `${Number(row.value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t`
                : row.unit === '%' ? `${Number(row.value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%`
                : row.unit === 'EUR/t' ? `${fmt(row.value)} EUR/t`
                : `${fmt(row.value)} EUR`) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

