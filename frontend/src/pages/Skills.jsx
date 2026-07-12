import { useState, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Section, ErrorState } from '../components';
import { Star } from 'lucide-react';
import useAsyncData from '../hooks/useAsyncData';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const SKILL_CATEGORIES = {
  permis_b: { label: 'Permis B', icon: '🚗', color: 'bg-blue-100 text-blue-700' },
  caces: { label: 'CACES', icon: '🏗️', color: 'bg-purple-100 text-purple-700' },
  permis_c: { label: 'Permis C', icon: '🚛', color: 'bg-blue-100 text-blue-700' },
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

// Compétences opérationnelles éditables (booléens de la fiche collaborateur,
// source du planning hebdo chauffeur/cariste) → colonne = champ employees.
const OPERATIONAL = { permis_b: 'has_permis_b', caces: 'has_caces' };

export default function Skills() {
  const { user } = useAuth();
  const canEdit = ['ADMIN', 'RH'].includes(user?.base_role || user?.role);
  const [view, setView] = useState('matrix'); // matrix, bySkill
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [overrides, setOverrides] = useState({}); // id -> { has_permis_b, has_caces } (édition optimiste)
  const [savingKey, setSavingKey] = useState(null);
  const [saveError, setSaveError] = useState('');

  // Part des EMPLOYÉS (et non plus d'un mauvais id candidat). Les compétences
  // du candidat lié sont chargées UNIQUEMENT quand candidate_id existe (bon
  // identifiant), ce qui corrige la jointure fautive et réduit les appels.
  const fetchData = useCallback(async () => {
    const res = await api.get('/employees');
    const emps = res.data || [];
    return Promise.all(emps.map(async (emp) => {
      let candSkills = [];
      if (emp.candidate_id) {
        try { const r = await api.get(`/candidates/${emp.candidate_id}/skills`); candSkills = r.data || []; }
        catch { candSkills = []; }
      }
      return { ...emp, _candSkills: candSkills };
    }));
  }, []);
  const { data: employees = [], loading, error, reload } = useAsyncData(fetchData, { initialData: [] });

  const empBool = (emp, field) => (overrides[emp.id]?.[field] ?? emp[field]) === true;

  const hasSkill = (emp, key) => {
    if (OPERATIONAL[key]) return empBool(emp, OPERATIONAL[key]);
    if ((emp.skills || []).includes(key)) return true;
    return (emp._candSkills || []).some((s) => s.skill_name === key && (s.status === 'confirmed' || s.status === 'detected'));
  };

  const toggleOperational = async (emp, key) => {
    if (!canEdit || !OPERATIONAL[key]) return;
    const field = OPERATIONAL[key];
    const next = !empBool(emp, field);
    setSavingKey(`${emp.id}:${key}`); setSaveError('');
    setOverrides((o) => ({ ...o, [emp.id]: { ...o[emp.id], [field]: next } }));
    try {
      await api.put(`/employees/${emp.id}`, { [field]: next });
    } catch (err) {
      setOverrides((o) => ({ ...o, [emp.id]: { ...o[emp.id], [field]: !next } })); // rollback
      setSaveError(err.response?.data?.error || 'Erreur lors de la mise à jour de la compétence.');
    } finally { setSavingKey(null); }
  };

  const skillCounts = Object.keys(SKILL_CATEGORIES).reduce((acc, key) => {
    acc[key] = employees.filter((e) => hasSkill(e, key)).length;
    return acc;
  }, {});

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des compétences..." /></Layout>;
  if (error) return <Layout><div className="p-6"><ErrorState title="Impossible de charger les compétences" onRetry={reload} variant="card" /></div></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Compétences"
          subtitle={`Matrice des compétences — ${employees.length} collaborateurs`}
          icon={Star}
          actions={
            <div className="flex gap-2">
              <button onClick={() => setView('matrix')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'matrix' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Matrice</button>
              <button onClick={() => setView('bySkill')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'bySkill' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Par compétence</button>
            </div>
          }
        />

        {saveError && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
            <span>⚠</span><span>{saveError}</span>
            <button onClick={() => setSaveError('')} className="ml-auto text-red-500 hover:text-red-700" aria-label="Fermer">×</button>
          </div>
        )}
        {canEdit && (
          <p className="mb-4 text-xs text-gray-500">
            🚗 Permis B et 🏗️ CACES sont <strong>éditables</strong> (cliquez sur une case pour basculer) — ils conditionnent
            l'affectation chauffeur/cariste du planning hebdo. Les autres compétences sont issues de la fiche de recrutement liée.
          </p>
        )}

        {view === 'bySkill' && (
          <Section title="Répartition par compétence">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(SKILL_CATEGORIES).map(([key, cat]) => (
                <div key={key}
                  className={`card-modern p-4 cursor-pointer hover:shadow-md transition ${selectedSkill === key ? 'ring-2 ring-primary' : ''}`}
                  onClick={() => setSelectedSkill(selectedSkill === key ? null : key)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cat.icon}</span>
                      <h3 className="font-semibold text-sm">{cat.label}</h3>
                      {OPERATIONAL[key] && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">planning</span>}
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${cat.color}`}>{skillCounts[key]}</span>
                  </div>
                  {selectedSkill === key && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {employees.filter((e) => hasSkill(e, key)).map((e) => (
                        <p key={e.id} className="text-xs text-gray-600">{e.first_name} {e.last_name}</p>
                      ))}
                      {skillCounts[key] === 0 && <p className="text-xs text-gray-400">Aucun collaborateur</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {view === 'matrix' && (
          <Section title="Matrice" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-500 sticky left-0 bg-gray-50 min-w-[160px]">Collaborateur</th>
                    {Object.entries(SKILL_CATEGORIES).map(([key, cat]) => (
                      <th key={key} className="p-2 font-semibold text-gray-500 text-center min-w-[40px]" title={`${cat.label}${OPERATIONAL[key] ? ' (éditable)' : ''}`}>
                        <span className="text-sm">{cat.icon}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id} className="border-t hover:bg-gray-50">
                      <td className="p-2 font-medium sticky left-0 bg-white">{emp.first_name} {emp.last_name}</td>
                      {Object.keys(SKILL_CATEGORIES).map((key) => {
                        const on = hasSkill(emp, key);
                        const editable = canEdit && OPERATIONAL[key];
                        const busy = savingKey === `${emp.id}:${key}`;
                        if (editable) {
                          return (
                            <td key={key} className="p-2 text-center">
                              <button
                                onClick={() => toggleOperational(emp, key)}
                                disabled={busy}
                                title={on ? 'Cliquer pour retirer' : 'Cliquer pour attribuer'}
                                className={`inline-block w-5 h-5 rounded-full text-[10px] leading-5 transition ${on ? 'bg-primary text-white hover:bg-primary/80' : 'bg-gray-100 text-gray-300 hover:bg-gray-200'} ${busy ? 'opacity-50' : ''}`}>
                                {on ? '✓' : '+'}
                              </button>
                            </td>
                          );
                        }
                        return (
                          <td key={key} className="p-2 text-center">
                            {on
                              ? <span className="inline-block w-5 h-5 rounded-full bg-primary text-white text-[10px] leading-5">✓</span>
                              : <span className="inline-block w-5 h-5 rounded-full bg-gray-100 text-gray-300 text-[10px] leading-5">—</span>}
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
          </Section>
        )}
      </div>
    </Layout>
  );
}
