import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, KPICard, PageHeader, Section } from '../components';
import api from '../services/api';
import {
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { Users, UserPlus, Heart, ClipboardList, AlertTriangle } from 'lucide-react';

// ══════════════════════════════════════════
// REPORTING RH
// ══════════════════════════════════════════

const STATUS_COLORS_MAP = {
  received: '#3B82F6', screening: '#FBBF24', interview: '#8B5CF6',
  trial: '#F97316', recruited: '#10B981',
};

export default function ReportingRH() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [insertionStats, setInsertionStats] = useState(null);
  const [absenteeism, setAbsenteeism] = useState([]);
  const [formation, setFormation] = useState(null);
  const [etp, setEtp] = useState(null);
  const [absent, setAbsent] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const annee = new Date().getFullYear();
    try {
      const [empRes, teamRes, candRes, insRes, absRes, formRes, etpRes, absKpiRes] = await Promise.all([
        api.get('/employees?is_active=true'),
        api.get('/teams'),
        api.get('/candidates'),
        api.get('/performance/industrial-kpis').catch(() => ({ data: null })),
        api.get('/employees/absenteeism/monthly?months=12').catch(() => ({ data: [] })),
        api.get(`/employees/kpi/formation?annee=${annee}`).catch(() => ({ data: null })),
        api.get(`/employees/kpi/etp?annee=${annee}`).catch(() => ({ data: null })),
        api.get(`/employees/kpi/absenteisme?annee=${annee}`).catch(() => ({ data: null })),
      ]);
      const empData = Array.isArray(empRes.data) ? empRes.data : (empRes.data?.employees || []);
      setEmployees(empData);
      setTeams(teamRes.data || []);
      setCandidates(candRes.data || []);
      setInsertionStats(insRes.data?.insertion || null);
      setAbsenteeism(absRes.data || []);
      setFormation(formRes.data);
      setEtp(etpRes.data);
      setAbsent(absKpiRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  const totalEmployees = employees.length;

  const teamData = teams.map((t) => ({
    name: t.name,
    effectif: parseInt(t.member_count) || 0,
  })).sort((a, b) => b.effectif - a.effectif);

  // Pipeline candidatures
  const candidateStatuses = {};
  candidates.forEach((c) => {
    const s = c.status || 'inconnu';
    candidateStatuses[s] = (candidateStatuses[s] || 0) + 1;
  });

  const statusLabels = {
    received: 'Reçus', screening: 'Pré-sélection', interview: 'Entretien',
    trial: 'Essai', recruited: 'Recrutés',
  };

  // Entonnoir horizontal — chaque étape conserve les candidats des étapes suivantes
  // (plus on avance, plus on perd → effet entonnoir)
  const funnelSteps = ['received', 'screening', 'interview', 'trial', 'recruited'];
  const cumulativeCounts = {};
  funnelSteps.slice().reverse().forEach((step, idx, arr) => {
    const successors = arr.slice(0, idx);
    cumulativeCounts[step] = (candidateStatuses[step] || 0)
      + successors.reduce((sum, s) => sum + (cumulativeCounts[s] || 0), 0);
  });

  const funnelData = funnelSteps.map((s) => ({
    step: statusLabels[s] || s,
    count: cumulativeCounts[s] || 0,
    fill: STATUS_COLORS_MAP[s] || '#94A3B8',
  }));

  const sortiesPositives = insertionStats && insertionStats.total > 0
    ? Math.round(insertionStats.parcours_termines / insertionStats.total * 100) : 0;

  // Absentéisme : transformer pour le chart (format mois court FR)
  const monthLabel = (yyyymm) => {
    if (!yyyymm) return '';
    const [y, m] = yyyymm.split('-');
    const moisCourts = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
    return `${moisCourts[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  };
  const absenteeismChart = absenteeism.map((row) => ({
    mois: monthLabel(row.mois),
    planifies: Number(row.jours_planifies) || 0,
    realises: (Number(row.jours_travailles) || 0) + (Number(row.jours_absents) || 0),
    absences: Number(row.jours_absents) || 0,
    taux: Number(row.taux_absenteisme) || 0,
  }));

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Reporting RH"
          subtitle="Effectifs, recrutement et indicateurs RH"
          icon={Users}
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard title="Collaborateurs actifs" value={totalEmployees} icon={Users} accent="primary" />
          <KPICard title="Équipes" value={teams.length} icon={ClipboardList} accent="slate" />
          <KPICard title="Candidatures" value={candidates.length} icon={UserPlus} accent="amber" />
          <KPICard title="Recrutés" value={candidateStatuses.recruited || 0} icon={UserPlus} accent="emerald" />
          <KPICard title="Parcours insertion" value={insertionStats?.parcours_actifs || '—'} unit="actifs" icon={Heart} accent="red" />
        </div>

        {/* KPI audit Métropole (P1-D) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl shadow p-5 border border-blue-100">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Heures de formation {formation?.annee ?? new Date().getFullYear()}</div>
            <div className="text-3xl font-extrabold text-blue-700">
              {formation?.total_heures != null ? `${Math.round(formation.total_heures)} h` : '—'}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              {formation?.par_personne?.length || 0} salarié(s) avec formation
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow p-5 border border-emerald-100">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">ETP total {etp?.annee ?? new Date().getFullYear()}</div>
            <div className="text-3xl font-extrabold text-emerald-700">
              {etp?.total_etp != null ? etp.total_etp : '—'}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              Base {etp?.etp_reference_heures || 1607}h/an · {etp?.par_equipe?.length || 0} équipes
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow p-5 border border-amber-100">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Absentéisme moyen (équipe la plus haute)</div>
            <div className="text-3xl font-extrabold text-amber-700">
              {absent?.par_equipe?.[0]?.taux_pct != null ? `${absent.par_equipe[0].taux_pct} %` : '—'}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              {absent?.par_equipe?.[0]?.equipe || '—'}
            </div>
          </div>
        </div>

        {/* Effectifs par équipe */}
        <Section title="Effectifs par équipe">
          {teamData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={teamData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="effectif" name="Effectif" fill="#0D9488" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 text-center py-12">Aucune équipe</p>
          )}
        </Section>

        {/* Entonnoir horizontal */}
        <Section title="Entonnoir de recrutement" subtitle="Cumul des candidats à chaque étape (passé ou en cours)">
          {funnelData.some((f) => f.count > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={funnelData} layout="vertical" margin={{ left: 20, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="step" width={110} tick={{ fontSize: 12, fontWeight: 600 }} />
                <Tooltip />
                <Bar dataKey="count" name="Candidats" radius={[0, 6, 6, 0]} label={{ position: 'right', fill: '#475569', fontSize: 11, fontWeight: 600 }}>
                  {funnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 text-center py-12">Aucune candidature</p>
          )}
        </Section>

        {/* Absentéisme — planning prévu vs réel */}
        <Section
          title="Suivi de l'absentéisme"
          subtitle="Comparaison planning prévisionnel vs réalisé sur 12 mois — taux d'absentéisme calculé sur le réalisé"
          icon={AlertTriangle}
        >
          {absenteeismChart.length === 0 || absenteeismChart.every((d) => d.planifies === 0 && d.realises === 0) ? (
            <p className="text-sm text-slate-400 text-center py-12">
              Données insuffisantes pour calculer l'absentéisme
              <br />
              <span className="text-xs">(planning prévisionnel ou heures déclarées manquantes)</span>
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={absenteeismChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mois" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: 'Jours', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#64748B' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit="%" />
                <Tooltip
                  formatter={(val, name) => {
                    if (name === "Taux d'absentéisme") return `${val} %`;
                    return val;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="planifies" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 5" name="Planning prévu (j)" dot={{ r: 3 }} />
                <Line yAxisId="left" type="monotone" dataKey="realises" stroke="#0D9488" strokeWidth={2} name="Planning réalisé (j)" dot={{ r: 3 }} />
                <Line yAxisId="left" type="monotone" dataKey="absences" stroke="#EF4444" strokeWidth={2} name="Absences (j)" dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="taux" stroke="#F59E0B" strokeWidth={2.5} name="Taux d'absentéisme" dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Section>

        {/* Insertion summary */}
        {insertionStats && (
          <Section title="Insertion professionnelle" icon={Heart}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-50 rounded-card p-4 text-center">
                <p className="text-2xl font-bold text-slate-800">{insertionStats.parcours_actifs}</p>
                <p className="text-xs text-slate-500 mt-1">Parcours actifs</p>
              </div>
              <div className="bg-slate-50 rounded-card p-4 text-center">
                <p className="text-2xl font-bold text-emerald-600">{insertionStats.parcours_termines}</p>
                <p className="text-xs text-slate-500 mt-1">Terminés</p>
              </div>
              <div className="bg-slate-50 rounded-card p-4 text-center">
                <p className="text-2xl font-bold text-slate-800">{insertionStats.total}</p>
                <p className="text-xs text-slate-500 mt-1">Total historique</p>
              </div>
              <div className="bg-slate-50 rounded-card p-4 text-center">
                <p className="text-2xl font-bold text-primary">{sortiesPositives}%</p>
                <p className="text-xs text-slate-500 mt-1">Sorties positives</p>
              </div>
            </div>
          </Section>
        )}
      </div>
    </Layout>
  );
}
