import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, KPICard, PageHeader, Section } from '../components';
import api from '../services/api';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Users, UserPlus, Heart, ClipboardList, BarChart3 } from 'lucide-react';

// ══════════════════════════════════════════
// REPORTING RH — enrichi avec graphiques
// ══════════════════════════════════════════

const TEAM_COLORS = ['#0D9488', '#6366F1', '#F59E0B', '#EC4899', '#8B5CF6', '#10B981', '#EF4444', '#64748B'];
const STATUS_COLORS_MAP = {
  received: '#3B82F6', screening: '#FBBF24', interview: '#8B5CF6',
  trial: '#F97316', recruited: '#10B981', rejected: '#EF4444', withdrawn: '#94A3B8',
};

export default function ReportingRH() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [insertionStats, setInsertionStats] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [empRes, teamRes, candRes, insRes] = await Promise.all([
        api.get('/employees?is_active=true'),
        api.get('/teams'),
        api.get('/candidates'),
        api.get('/performance/industrial-kpis').catch(() => ({ data: null })),
      ]);
      const empData = Array.isArray(empRes.data) ? empRes.data : (empRes.data?.employees || []);
      setEmployees(empData);
      setTeams(teamRes.data || []);
      setCandidates(candRes.data || []);
      setInsertionStats(insRes.data?.insertion || null);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  const totalEmployees = employees.length;

  // Team data for bar chart
  const teamData = teams.map(t => ({
    name: t.name,
    effectif: parseInt(t.member_count) || 0,
  })).sort((a, b) => b.effectif - a.effectif);

  // Candidate pipeline
  const candidateStatuses = {};
  candidates.forEach(c => {
    const s = c.status || 'inconnu';
    candidateStatuses[s] = (candidateStatuses[s] || 0) + 1;
  });

  const statusLabels = {
    received: 'Reçus', screening: 'Pré-sélection', interview: 'Entretien',
    trial: 'Essai', recruited: 'Recrutés', rejected: 'Refusés', withdrawn: 'Désistés',
  };

  // Funnel data
  const funnelSteps = ['received', 'screening', 'interview', 'trial', 'recruited'];
  const funnelData = funnelSteps.map(s => ({
    step: statusLabels[s] || s,
    count: candidateStatuses[s] || 0,
    fill: STATUS_COLORS_MAP[s] || '#94A3B8',
  }));

  // Pie data for candidate distribution
  const pieData = Object.entries(candidateStatuses).map(([status, count]) => ({
    name: statusLabels[status] || status,
    value: count,
    fill: STATUS_COLORS_MAP[status] || '#94A3B8',
  }));

  // Insertion stats
  const sortiesPositives = insertionStats && insertionStats.total > 0
    ? Math.round(insertionStats.parcours_termines / insertionStats.total * 100) : 0;

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

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Team bar chart */}
          <Section title="Effectifs par équipe">
            {teamData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={teamData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="effectif" name="Effectif" fill="#0D9488" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400 text-center py-12">Aucune équipe</p>
            )}
          </Section>

          {/* Candidate pie chart */}
          <Section title="Répartition candidatures">
            {pieData.length > 0 ? (
              <div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  {pieData.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="truncate">{d.name}</span>
                      <span className="font-medium ml-auto">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-12">Aucune candidature</p>
            )}
          </Section>
        </div>

        {/* Funnel */}
        <Section title="Entonnoir de recrutement">
          {funnelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={funnelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="step" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="Candidats">
                  {funnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 text-center py-12">Aucune donnée</p>
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
