import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

export default function ReportingRH() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [candidates, setCandidates] = useState([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [empRes, teamRes, candRes] = await Promise.all([
        api.get('/employees?is_active=true'),
        api.get('/teams'),
        api.get('/candidates'),
      ]);
      setEmployees(empRes.data);
      setTeams(teamRes.data);
      setCandidates(candRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  // Compute stats
  const totalEmployees = employees.length;
  const teamCounts = teams.map(t => ({
    name: t.name,
    count: parseInt(t.member_count) || 0,
  })).sort((a, b) => b.count - a.count);

  // Candidate pipeline stats
  const candidateStatuses = {};
  candidates.forEach(c => {
    const s = c.status || 'inconnu';
    candidateStatuses[s] = (candidateStatuses[s] || 0) + 1;
  });
  const statusLabels = {
    received: 'Recus',
    screening: 'Pre-selection',
    interview: 'Entretien',
    trial: 'Essai',
    recruited: 'Recrutes',
    rejected: 'Refuses',
    withdrawn: 'Desistes',
  };

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Reporting RH</h1>
          <p className="text-gray-500">Effectifs, recrutement et indicateurs RH</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <KPICard label="Collaborateurs actifs" value={totalEmployees} icon="🏢" color="text-purple-600" />
          <KPICard label="Equipes" value={teams.length} icon="👥" color="text-blue-600" />
          <KPICard label="Candidatures totales" value={candidates.length} icon="📋" color="text-orange-600" />
          <KPICard label="Recrutes" value={candidateStatuses['recruited'] || 0} icon="✅" color="text-primary" />
          <KPICard label="Absentéisme" value="—" icon="📊" color="text-red-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Employees by team */}
          <div className="bg-white rounded-xl shadow-sm border">
            <div className="p-4 border-b">
              <h3 className="font-semibold text-slate-800">Effectifs par equipe</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Equipe</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Effectif</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">% du total</th>
                  </tr>
                </thead>
                <tbody>
                  {teamCounts.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Aucune equipe</td></tr>
                  ) : (
                    teamCounts.map((t, i) => (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{t.name}</td>
                        <td className="px-4 py-3 text-right font-semibold">{t.count}</td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {totalEmployees > 0 ? Math.round((t.count / totalEmployees) * 100) : 0}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {teamCounts.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 bg-gray-50 font-semibold">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-right">{teamCounts.reduce((s, t) => s + t.count, 0)}</td>
                      <td className="px-4 py-3 text-right">100%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Candidate pipeline */}
          <div className="bg-white rounded-xl shadow-sm border">
            <div className="p-4 border-b">
              <h3 className="font-semibold text-slate-800">Pipeline de recrutement</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Statut</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Nombre</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">% du total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(candidateStatuses).length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Aucune candidature</td></tr>
                  ) : (
                    Object.entries(candidateStatuses)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count], i) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
                              {statusLabels[status] || status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">{count}</td>
                          <td className="px-4 py-3 text-right text-gray-500">
                            {candidates.length > 0 ? Math.round((count / candidates.length) * 100) : 0}%
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
                {Object.keys(candidateStatuses).length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 bg-gray-50 font-semibold">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-right">{candidates.length}</td>
                      <td className="px-4 py-3 text-right">100%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

        {/* Candidate funnel visual */}
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="font-semibold text-slate-800 mb-4">Entonnoir de recrutement</h3>
          <div className="space-y-2">
            {['received', 'screening', 'interview', 'trial', 'recruited'].map((status) => {
              const count = candidateStatuses[status] || 0;
              const maxCount = Math.max(...Object.values(candidateStatuses), 1);
              const pct = Math.round((count / maxCount) * 100);
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-28 text-right">{statusLabels[status] || status}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 relative">
                    <div
                      className={`h-6 rounded-full ${getFunnelColor(status)} transition-all`}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
                      {count}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function getStatusColor(status) {
  const colors = {
    received: 'bg-blue-100 text-blue-700',
    screening: 'bg-yellow-100 text-yellow-700',
    interview: 'bg-purple-100 text-purple-700',
    trial: 'bg-orange-100 text-orange-700',
    recruited: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    withdrawn: 'bg-gray-100 text-gray-700',
  };
  return colors[status] || 'bg-gray-100 text-gray-700';
}

function getFunnelColor(status) {
  const colors = {
    received: 'bg-blue-400',
    screening: 'bg-yellow-400',
    interview: 'bg-purple-400',
    trial: 'bg-orange-400',
    recruited: 'bg-primary',
  };
  return colors[status] || 'bg-gray-400';
}

function KPICard({ label, value, icon, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
