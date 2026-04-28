import { useState, useEffect, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight, UserCheck } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, useToast, PageHeader } from '../components';
import api from '../services/api';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const PERIODES = [{ key: 'matin', label: 'Matin' }, { key: 'apres_midi', label: 'Après-midi' }];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }

export default function BoutiquesPlanning() {
  const toast = useToast();
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [postes, setPostes] = useState([]);
  const [affectations, setAffectations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [weekStart]);

  async function load() {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([
        api.get('/planning-hebdo/postes'),
        api.get(`/planning-hebdo?week_start=${fmtDate(weekStart)}`),
      ]);
      // Filtrer uniquement les postes boutique
      const btqPostes = (p.data?.postes || []).filter(po => po.filiere === 'btq');
      setPostes(btqPostes);
      // Filtrer uniquement les affectations BTQ
      setAffectations((a.data || []).filter(af => String(af.poste_code || '').toUpperCase().startsWith('BTQ_')));
    } catch (e) {
      toast.error('Erreur chargement planning');
    }
    setLoading(false);
  }

  const postesParBoutique = useMemo(() => {
    const groups = {};
    for (const p of postes) {
      const key = p.code?.includes('ST_SEVER') ? 'St-Sever' : p.code?.includes('LHOPITAL') ? "L'Hopital" : 'Autre';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }, [postes]);

  function getAffectation(date, poste_code, periode) {
    return affectations.find(a =>
      a.date?.slice(0, 10) === date &&
      a.poste_code === poste_code &&
      (a.periode === periode || a.periode === 'journee')
    );
  }

  if (loading) return <Layout><LoadingSpinner size="lg" /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Planning boutiques"
          subtitle="Affectation vendeurs et caissiers (extrait du planning hebdo)"
          icon={Calendar}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-2 hover:bg-slate-100 rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
              <span className="font-medium text-sm">
                Semaine du {weekStart.toLocaleDateString('fr-FR')}
              </span>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-2 hover:bg-slate-100 rounded-lg"><ChevronRight className="w-4 h-4" /></button>
            </div>
          }
        />

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
          <UserCheck className="inline w-4 h-4 mr-1" />
          Vue en lecture seule. Pour affecter ou modifier, utilisez la page <a href="/planning-hebdo" className="underline font-medium">Planning Hebdo</a>.
        </div>

        {Object.entries(postesParBoutique).map(([btq, btqPostes]) => (
          <div key={btq} className="bg-white rounded-card shadow-card p-4 mb-4 overflow-x-auto">
            <h3 className="font-semibold text-pink-700 mb-3">{btq}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-2 text-xs uppercase text-slate-500">Poste</th>
                  {JOURS.map((j, i) => (
                    <th key={j} className="text-center py-2 px-2 text-xs uppercase text-slate-500">
                      {j}<br /><span className="font-normal text-slate-400">{addDays(weekStart, i).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {btqPostes.map(p => (
                  <tr key={p.code} className="border-b border-slate-100">
                    <td className="py-2 px-2 font-medium text-slate-700">{p.nom}</td>
                    {JOURS.map((_, i) => {
                      const date = fmtDate(addDays(weekStart, i));
                      return (
                        <td key={i} className="py-2 px-1 align-top">
                          <div className="space-y-1">
                            {PERIODES.map(pe => {
                              const af = getAffectation(date, p.code, pe.key);
                              return (
                                <div key={pe.key} className={`text-xs rounded px-1.5 py-0.5 ${af ? 'bg-pink-50 text-pink-700 border border-pink-200' : 'bg-slate-50 text-slate-400 border border-dashed border-slate-200'}`}>
                                  <span className="font-semibold">{pe.label.charAt(0)}</span>
                                  {af ? ` ${af.first_name} ${af.last_name?.charAt(0) || ''}` : ' —'}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Layout>
  );
}
