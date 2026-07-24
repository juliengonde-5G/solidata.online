import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { PageHeader, LoadingSpinner, ErrorState, ConfirmDialog } from '../components';
import {
  MessageSquare, FileText, Send, BarChart3, Plus, Pencil, Trash2, ClipboardList,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ModeleEditor from '../components/enquetes/ModeleEditor';
import CampagnesList from '../components/enquetes/CampagnesList';
import ResultatsEnquete from '../components/enquetes/ResultatsEnquete';
import {
  CATEGORIE_LABELS, STATUT_LABELS, apiErr,
} from '../components/enquetes/enquetesShared';

const TABS = [
  { id: 'modeles', label: 'Modèles', icon: FileText },
  { id: 'campagnes', label: 'Campagnes', icon: Send },
  { id: 'resultats', label: 'Résultats', icon: BarChart3 },
];

// Module « Enquêtes » (RSEI-13) — mini-moteur de questionnaires anonymes :
// modèles administrables, campagnes diffusées par lien, restitution agrégée avec
// seuil d'anonymat n ≥ 5. Interface 100 % française.
export default function Enquetes() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const canWrite = ['ADMIN', 'RH', 'MANAGER', 'QHSE'].includes(base);

  const [tab, setTab] = useState('modeles');

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <PageHeader
          title="Enquêtes"
          subtitle="Questionnaires anonymes (QVCT, satisfaction, intégration…) — diffusion par lien, restitution agrégée avec seuil d'anonymat"
          icon={MessageSquare}
        />

        <div className="border-b border-slate-200 mb-5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  aria-current={active ? 'page' : undefined}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'modeles' && <ModelesTab canWrite={canWrite} />}
        {tab === 'campagnes' && <CampagnesList canWrite={canWrite} />}
        {tab === 'resultats' && <ResultatsTab />}
      </div>
    </Layout>
  );
}

// ── Onglet Modèles ───────────────────────────────────────────────────────────
function ModelesTab({ canWrite }) {
  const [modeles, setModeles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editorFor, setEditorFor] = useState(undefined); // undefined = fermé, null = création, id = édition
  const [confirmDel, setConfirmDel] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api.get('/enquetes/modeles')
      .then((r) => { if (alive) { setModeles(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  const remove = async (m) => {
    try {
      await api.delete(`/enquetes/modeles/${m.id}`);
      setConfirmDel(null);
      load();
    } catch (err) { setError(apiErr(err)); setConfirmDel(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Modèles de questionnaire</h2>
        {canWrite && (
          <button onClick={() => setEditorFor(null)} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouveau modèle
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement des modèles…" />
      ) : error && modeles.length === 0 ? (
        <ErrorState variant="card" title="Modèles indisponibles" message={error} onRetry={load} />
      ) : modeles.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
          <ClipboardList className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">Aucun modèle de questionnaire.</p>
          {canWrite && <p className="text-xs mt-1">Créez un modèle (QVCT, satisfaction, intégration…) pour lancer une campagne.</p>}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
                <th className="px-3 py-2 font-medium">Titre</th>
                <th className="px-3 py-2 font-medium">Catégorie</th>
                <th className="px-3 py-2 font-medium text-center">Questions</th>
                <th className="px-3 py-2 font-medium text-center">Campagnes</th>
                <th className="px-3 py-2 font-medium text-center">Anonyme</th>
                <th className="px-3 py-2 font-medium text-center">Actif</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {modeles.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <button onClick={() => setEditorFor(m.id)} className="text-slate-700 hover:text-teal-700 font-medium text-left">{m.titre}</button>
                    {m.description && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{m.description}</p>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{CATEGORIE_LABELS[m.categorie] || m.categorie}</td>
                  <td className="px-3 py-2 text-center text-slate-600">{m.nb_questions ?? 0}</td>
                  <td className="px-3 py-2 text-center text-slate-600">{m.nb_campagnes ?? 0}</td>
                  <td className="px-3 py-2 text-center">{m.anonyme ? <span className="text-teal-600">✓</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-center">
                    {m.actif
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">actif</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">inactif</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button onClick={() => setEditorFor(m.id)} className="text-slate-400 hover:text-teal-600 p-1" title={canWrite ? 'Modifier' : 'Consulter'} aria-label="Ouvrir le modèle">
                      <Pencil className="w-4 h-4" />
                    </button>
                    {canWrite && (
                      <button onClick={() => setConfirmDel(m)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer le modèle">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorFor !== undefined && (
        <ModeleEditor
          modeleId={editorFor}
          canWrite={canWrite}
          onClose={() => setEditorFor(undefined)}
          onSaved={() => { setEditorFor(undefined); load(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmDel}
        title="Supprimer le modèle ?"
        message={confirmDel ? `« ${confirmDel.titre} » et ses questions seront supprimés. Impossible s'il est utilisé par des campagnes.` : ''}
        confirmLabel="Supprimer"
        confirmVariant="danger"
        onConfirm={() => remove(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

// ── Onglet Résultats ─────────────────────────────────────────────────────────
function ResultatsTab() {
  const [campagnes, setCampagnes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState('');

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api.get('/enquetes/campagnes')
      .then((r) => {
        if (!alive) return;
        const list = Array.isArray(r.data) ? r.data : [];
        setCampagnes(list);
        setSelected((cur) => cur || (list[0] ? String(list[0].id) : ''));
        setError(null);
      })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  if (loading) return <LoadingSpinner size="lg" message="Chargement des campagnes…" />;
  if (error) return <ErrorState variant="card" title="Campagnes indisponibles" message={error} onRetry={load} />;
  if (campagnes.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
        <p className="text-sm">Aucune campagne à analyser pour l'instant.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor="res-campagne" className="text-sm text-slate-500">Campagne</label>
        <select id="res-campagne" value={selected} onChange={(e) => setSelected(e.target.value)} className="input-modern py-1.5 text-sm w-auto max-w-full">
          {campagnes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.titre} — {STATUT_LABELS[c.statut] || c.statut} · {c.nb_reponses ?? 0} rép.
            </option>
          ))}
        </select>
      </div>

      {selected && <ResultatsEnquete campagneId={selected} />}
    </div>
  );
}
