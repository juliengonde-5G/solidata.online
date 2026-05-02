import { useEffect, useState, useCallback } from 'react';
import { Bell, Save } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, ErrorState, useToast } from '../components';
import api from '../services/api';

const SEVERITES = [
  { value: 'info', label: 'Information' },
  { value: 'warning', label: 'Avertissement' },
  { value: 'error', label: 'Erreur' },
  { value: 'critical', label: 'Critique' },
];

export default function AdminAlertThresholds() {
  const toast = useToast();
  const [thresholds, setThresholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/alert-thresholds');
      setThresholds(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateDraft = (indicateur, field, value) => {
    setDrafts((d) => ({ ...d, [indicateur]: { ...d[indicateur], [field]: value } }));
  };

  const save = async (t) => {
    setSavingId(t.indicateur);
    try {
      const draft = drafts[t.indicateur] || {};
      const payload = {
        domaine: t.domaine,
        libelle: t.libelle,
        unite: t.unite,
        severite: draft.severite ?? t.severite,
        actif: draft.actif ?? t.actif,
        seuil_min: draft.seuil_min !== undefined
          ? (draft.seuil_min === '' ? null : parseFloat(draft.seuil_min))
          : t.seuil_min,
        seuil_max: draft.seuil_max !== undefined
          ? (draft.seuil_max === '' ? null : parseFloat(draft.seuil_max))
          : t.seuil_max,
        notes: draft.notes ?? t.notes,
      };
      await api.put(`/alert-thresholds/${t.indicateur}`, payload);
      toast?.success?.(`Seuil "${t.libelle}" mis à jour.`);
      setDrafts((d) => { const { [t.indicateur]: _, ...rest } = d; return rest; });
      await load();
    } catch (err) {
      toast?.error?.(err?.response?.data?.error || 'Erreur lors de l\'enregistrement.');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des seuils..." /></Layout>;

  const grouped = thresholds.reduce((acc, t) => {
    (acc[t.domaine] = acc[t.domaine] || []).push(t);
    return acc;
  }, {});

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader
          title="Seuils d'alerte"
          subtitle="Configurer les seuils min/max des KPI du dashboard exécutif"
          icon={Bell}
        />

        {error ? (
          <ErrorState
            title="Impossible de charger les seuils"
            onRetry={load}
            variant="card"
          />
        ) : Object.entries(grouped).map(([domaine, items]) => (
          <section key={domaine} className="mb-6">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">
              {domaine}
            </h2>
            <div className="card-modern overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left">Indicateur</th>
                    <th scope="col" className="px-4 py-2 text-right">Min</th>
                    <th scope="col" className="px-4 py-2 text-right">Max</th>
                    <th scope="col" className="px-4 py-2 text-left">Unité</th>
                    <th scope="col" className="px-4 py-2 text-left">Sévérité</th>
                    <th scope="col" className="px-4 py-2 text-center">Actif</th>
                    <th scope="col" className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => {
                    const draft = drafts[t.indicateur] || {};
                    const isDirty = Object.keys(draft).length > 0;
                    return (
                      <tr key={t.indicateur} className="border-t border-slate-100">
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-800">{t.libelle}</div>
                          {t.notes && <div className="text-xs text-slate-500">{t.notes}</div>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <label className="sr-only" htmlFor={`min-${t.indicateur}`}>Seuil minimal</label>
                          <input
                            id={`min-${t.indicateur}`}
                            type="number"
                            step="any"
                            defaultValue={t.seuil_min ?? ''}
                            onChange={(e) => updateDraft(t.indicateur, 'seuil_min', e.target.value)}
                            className="input-modern w-24 text-right"
                            placeholder="—"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <label className="sr-only" htmlFor={`max-${t.indicateur}`}>Seuil maximal</label>
                          <input
                            id={`max-${t.indicateur}`}
                            type="number"
                            step="any"
                            defaultValue={t.seuil_max ?? ''}
                            onChange={(e) => updateDraft(t.indicateur, 'seuil_max', e.target.value)}
                            className="input-modern w-24 text-right"
                            placeholder="—"
                          />
                        </td>
                        <td className="px-4 py-2 text-slate-500">{t.unite || '—'}</td>
                        <td className="px-4 py-2">
                          <label className="sr-only" htmlFor={`sev-${t.indicateur}`}>Sévérité</label>
                          <select
                            id={`sev-${t.indicateur}`}
                            defaultValue={t.severite}
                            onChange={(e) => updateDraft(t.indicateur, 'severite', e.target.value)}
                            className="input-modern"
                          >
                            {SEVERITES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            defaultChecked={t.actif}
                            onChange={(e) => updateDraft(t.indicateur, 'actif', e.target.checked)}
                            aria-label={`Activer le seuil ${t.libelle}`}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => save(t)}
                            disabled={!isDirty || savingId === t.indicateur}
                            className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" aria-hidden="true" />
                            {savingId === t.indicateur ? '…' : 'Enregistrer'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </Layout>
  );
}
