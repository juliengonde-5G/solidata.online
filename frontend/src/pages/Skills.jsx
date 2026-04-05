import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

const SKILL_CATEGORIES = {
  permis_b: { label: 'Permis B', icon: '🚗', color: 'bg-blue-100 text-blue-700' },
  permis_c: { label: 'Permis C', icon: '🚛', color: 'bg-blue-100 text-blue-700' },
  caces: { label: 'CACES', icon: '🏗️', color: 'bg-purple-100 text-purple-700' },
  tri_textile: { label: 'Tri textile', icon: '👕', color: 'bg-green-100 text-green-700' },
  controle_qualite: { label: 'Contrôle qualité', icon: '✅', color: 'bg-green-100 text-green-700' },
  gestion_equipe: { label: 'Gestion équipe', icon: '👥', color: 'bg-orange-100 text-orange-700' },
  sst: { label: 'SST', icon: '🏥', color: 'bg-red-100 text-red-700' },
  habilitation_electrique: { label: 'Hab. électrique', icon: '⚡', color: 'bg-yellow-100 text-yellow-700' },
  logistique: { label: 'Logistique', icon: '📦', color: 'bg-indigo-100 text-indigo-700' },
  manutention: { label: 'Manutention', icon: '🔧', color: 'bg-gray-100 text-gray-700' },
  collecte: { label: 'Collecte', icon: '♻️', color: 'bg-teal-100 text-teal-700' },
  environnement: { label: 'Environnement', icon: '🌿', color: 'bg-emerald-100 text-emerald-700' },
  couture: { label: 'Couture', icon: '🧵', color: 'bg-pink-100 text-pink-700' },
  vente: { label: 'Vente', icon: '🏪', color: 'bg-amber-100 text-amber-700' },
  informatique: { label: 'Informatique', icon: '💻', color: 'bg-cyan-100 text-cyan-700' },
};

export default function Skills() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('matrix'); // matrix, bySkill
  const [selectedSkill, setSelectedSkill] = useState(null);

  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    try {
      const res = await api.get('/employees');
      // Load skills for each employee
      const empsWithSkills = await Promise.all(
        res.data.map(async (emp) => {
          try {
            const skillsRes = await api.get(`/candidates/${emp.candidate_id || emp.id}/skills`);
            return { ...emp, skills: skillsRes.data };
          } catch {
            return { ...emp, skills: [] };
          }
        })
      );
      setEmployees(empsWithSkills);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const skillCounts = Object.keys(SKILL_CATEGORIES).reduce((acc, key) => {
    acc[key] = employees.filter(e => e.skills?.some(s => s.skill_name === key)).length;
    return acc;
  }, {});

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des compétences..." /></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Compétences</h1>
            <p className="text-gray-500">Matrice des compétences — {employees.length} collaborateurs</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView('matrix')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'matrix' ? 'bg-primary text-white' : 'bg-gray-100'}`}>
              Matrice
            </button>
            <button onClick={() => setView('bySkill')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'bySkill' ? 'bg-primary text-white' : 'bg-gray-100'}`}>
              Par compétence
            </button>
          </div>
        </div>

        {view === 'bySkill' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(SKILL_CATEGORIES).map(([key, cat]) => (
              <div
                key={key}
                className={`bg-white rounded-xl shadow-sm border p-4 cursor-pointer hover:shadow-md transition ${selectedSkill === key ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setSelectedSkill(selectedSkill === key ? null : key)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{cat.icon}</span>
                    <h3 className="font-semibold text-sm">{cat.label}</h3>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${cat.color}`}>
                    {skillCounts[key]}
                  </span>
                </div>
                {selectedSkill === key && (
                  <div className="mt-3 pt-3 border-t space-y-1">
                    {employees.filter(e => e.skills?.some(s => s.skill_name === key)).map(e => (
                      <p key={e.id} className="text-xs text-gray-600">{e.first_name} {e.last_name}</p>
                    ))}
                    {skillCounts[key] === 0 && <p className="text-xs text-gray-400">Aucun collaborateur</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {view === 'matrix' && (
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 font-semibold text-gray-500 sticky left-0 bg-gray-50 min-w-[160px]">Collaborateur</th>
                  {Object.entries(SKILL_CATEGORIES).map(([key, cat]) => (
                    <th key={key} className="p-2 font-semibold text-gray-500 text-center min-w-[40px]" title={cat.label}>
                      <span className="text-sm">{cat.icon}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id} className="border-t hover:bg-gray-50">
                    <td className="p-2 font-medium sticky left-0 bg-white">
                      {emp.first_name} {emp.last_name}
                    </td>
                    {Object.keys(SKILL_CATEGORIES).map(key => {
                      const hasSkill = emp.skills?.some(s => s.skill_name === key);
                      return (
                        <td key={key} className="p-2 text-center">
                          {hasSkill ? (
                            <span className="inline-block w-5 h-5 rounded-full bg-primary text-white text-[10px] leading-5">✓</span>
                          ) : (
                            <span className="inline-block w-5 h-5 rounded-full bg-gray-100 text-gray-300 text-[10px] leading-5">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr><td colSpan={Object.keys(SKILL_CATEGORIES).length + 1} className="p-8 text-center text-gray-400">Aucun collaborateur</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
