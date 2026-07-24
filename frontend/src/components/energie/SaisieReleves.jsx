import { useState, useEffect, useCallback, useMemo } from 'react';
import { Gauge, Save, Zap, Flame, Droplets, Settings } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, EmptyState, useToast } from '../index';
import { MOIS, posteLabel, num, fmtEur, fmtUnite, yearsList, StatCard } from './energieShared';

const TYPE_ICON = { electricite: Zap, gaz: Flame, eau: Droplets };

// Construit la grille 12 mois d'un compteur à partir des relevés de l'année.
function buildGrid(releves, compteurId, annee) {
  return Array.from({ length: 12 }, (_, i) => {
    const mois = i + 1;
    const r = releves.find((x) => x.compteur_id === compteurId && x.periode_mois === mois && x.periode_annee === annee);
    return {
      periode_mois: mois,
      id: r?.id ?? null,
      valeur: r?.valeur != null ? String(r.valeur) : '',
      cout_euros: r?.cout_euros != null ? String(r.cout_euros) : '',
      _ov: r?.valeur != null ? String(r.valeur) : '',
      _oc: r?.cout_euros != null ? String(r.cout_euros) : '',
    };
  });
}

// Onglet « Relevés énergie » : saisie par compteur × mois + totaux annuels par type.
export default function SaisieReleves({ annee, setAnnee, canWrite }) {
  const toast = useToast();
  const [compteurs, setCompteurs] = useState([]);
  const [releves, setReleves] = useState([]);
  const [selected, setSelected] = useState('');
  const [grid, setGrid] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadCompteurs = useCallback(() => {
    api.get('/energie/compteurs')
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        setCompteurs(list);
        setSelected((cur) => (cur && list.some((c) => String(c.id) === String(cur)) ? cur : (list[0] ? String(list[0].id) : '')));
      })
      .catch((err) => setError(err.response?.data?.error || err.message));
  }, []);

  const loadReleves = useCallback(() => {
    setLoading(true);
    api.get(`/energie/releves?annee=${annee}`)
      .then((r) => { setReleves(Array.isArray(r.data) ? r.data : []); setError(null); })
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [annee]);

  useEffect(() => { loadCompteurs(); }, [loadCompteurs]);
  useEffect(() => { loadReleves(); }, [loadReleves]);

  // (Re)construit la grille quand le compteur sélectionné, l'année ou les relevés changent.
  useEffect(() => {
    const cid = selected ? parseInt(selected, 10) : null;
    setGrid(cid ? buildGrid(releves, cid, annee) : []);
  }, [selected, releves, annee]);

  const compteur = useMemo(() => compteurs.find((c) => String(c.id) === String(selected)) || null, [compteurs, selected]);
  const unite = compteur?.unite || '';

  const updateCell = (i, field, value) => {
    setGrid((g) => g.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  };

  const dirty = grid.some((r) => r.valeur !== r._ov || r.cout_euros !== r._oc);

  const save = async () => {
    if (!compteur) return;
    setSaving(true);
    const ops = [];
    for (const row of grid) {
      const changed = row.valeur !== row._ov || row.cout_euros !== row._oc;
      if (!changed) continue;
      const v = num(row.valeur);
      const cout = num(row.cout_euros);
      if (v == null) {
        if (row.id != null) ops.push(api.delete(`/energie/releves/${row.id}`));
      } else if (row.id != null) {
        ops.push(api.put(`/energie/releves/${row.id}`, { valeur: v, cout_euros: cout }));
      } else {
        ops.push(api.post('/energie/releves', {
          compteur_id: compteur.id, periode_annee: annee, periode_mois: row.periode_mois, valeur: v, cout_euros: cout,
        }));
      }
    }
    try {
      const results = await Promise.allSettled(ops);
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        const first = failed[0].reason;
        toast.error(first?.response?.data?.error || `${failed.length} relevé(s) non enregistré(s).`);
      } else {
        toast.success('Relevés enregistrés.');
      }
      loadReleves();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'enregistrement.');
    }
    setSaving(false);
  };

  // Totaux annuels par type de compteur (tous compteurs confondus).
  const totauxParType = useMemo(() => {
    const acc = {};
    for (const r of releves) {
      const t = r.compteur_type || 'autre';
      if (!acc[t]) acc[t] = { conso: 0, cout: 0, unite: r.compteur_unite || '', nb: 0 };
      acc[t].conso += num(r.valeur) || 0;
      acc[t].cout += num(r.cout_euros) || 0;
      acc[t].nb += 1;
      if (!acc[t].unite && r.compteur_unite) acc[t].unite = r.compteur_unite;
    }
    return acc;
  }, [releves]);

  if (error && compteurs.length === 0) {
    return <ErrorState variant="card" title="Relevés indisponibles" message={error} onRetry={loadCompteurs} />;
  }

  const groupedOptions = compteurs.reduce((acc, c) => {
    (acc[c.site_nom || 'Sans site'] = acc[c.site_nom || 'Sans site'] || []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Filtres */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="rel-compteur" className="block text-xs font-medium text-slate-600 mb-1">Compteur</label>
          <select id="rel-compteur" value={selected} onChange={(e) => setSelected(e.target.value)}
            className="input-modern py-2 text-sm min-w-[220px]" disabled={compteurs.length === 0}>
            {compteurs.length === 0 && <option value="">Aucun compteur</option>}
            {Object.entries(groupedOptions).map(([site, list]) => (
              <optgroup key={site} label={site}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>{posteLabel(c.type)}{c.reference ? ` — ${c.reference}` : ''} ({c.unite})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rel-year" className="block text-xs font-medium text-slate-600 mb-1">Année</label>
          <select id="rel-year" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}
            className="input-modern py-2 text-sm">
            {yearsList().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {!canWrite && <p className="text-xs text-slate-400">Lecture seule — la saisie est réservée aux rôles ADMIN / RH / MANAGER.</p>}
      </div>

      {compteurs.length === 0 ? (
        <EmptyState icon={Settings} title="Aucun compteur configuré"
          description="Créez d'abord un site et ses compteurs (électricité, gaz, eau) dans l'onglet Réglages pour saisir des relevés." />
      ) : loading ? (
        <LoadingSpinner size="lg" message="Chargement des relevés…" />
      ) : (
        <>
          {/* Grille de saisie 12 mois */}
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <Gauge className="w-4 h-4 text-teal-600" />
                Relevés {annee} — {compteur ? `${posteLabel(compteur.type)}${compteur.reference ? ` (${compteur.reference})` : ''}` : ''}
              </h3>
              {canWrite && (
                <button onClick={save} disabled={saving || !dirty}
                  className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Save className="w-4 h-4" /> {saving ? 'Enregistrement…' : 'Enregistrer les relevés'}
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2 px-2">Mois</th>
                    <th className="text-right py-2 px-2">Consommation ({unite})</th>
                    <th className="text-right py-2 px-2">Coût (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, i) => (
                    <tr key={row.periode_mois} className="border-b border-slate-100">
                      <td className="py-2 px-2 font-medium text-slate-700">{MOIS[i]}</td>
                      <td className="py-2 px-2 text-right">
                        <input type="number" min="0" step="0.001" value={row.valeur} disabled={!canWrite}
                          onChange={(e) => updateCell(i, 'valeur', e.target.value)}
                          placeholder="—"
                          className="w-32 border border-slate-300 rounded px-2 py-1 text-right disabled:bg-slate-50 disabled:text-slate-400" />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <input type="number" min="0" step="0.01" value={row.cout_euros} disabled={!canWrite}
                          onChange={(e) => updateCell(i, 'cout_euros', e.target.value)}
                          placeholder="—"
                          className="w-28 border border-slate-300 rounded px-2 py-1 text-right disabled:bg-slate-50 disabled:text-slate-400" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 font-semibold text-slate-700">
                    <td className="py-2 px-2">Total {annee}</td>
                    <td className="py-2 px-2 text-right">{fmtUnite(grid.reduce((s, r) => s + (num(r.valeur) || 0), 0), unite, 1)}</td>
                    <td className="py-2 px-2 text-right">{fmtEur(grid.reduce((s, r) => s + (num(r.cout_euros) || 0), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Un champ vidé supprime le relevé du mois. Un relevé par compteur et par mois.</p>
          </div>

          {/* Totaux annuels par type */}
          <div className="bg-white rounded-xl border p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Totaux annuels {annee} par type d'énergie</h3>
            {Object.keys(totauxParType).length === 0 ? (
              <p className="text-sm text-slate-400 py-2">Aucun relevé saisi pour {annee}.</p>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(totauxParType).map(([type, t]) => (
                  <StatCard key={type} icon={TYPE_ICON[type] || Gauge} label={posteLabel(type)}
                    value={fmtUnite(t.conso, t.unite, 1)} sub={`${fmtEur(t.cout)} · ${t.nb} relevé(s)`}
                    tone={type === 'electricite' ? 'blue' : type === 'gaz' ? 'amber' : type === 'eau' ? 'slate' : 'teal'} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
