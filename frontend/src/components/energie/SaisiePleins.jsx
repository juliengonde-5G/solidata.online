import { useState, useEffect, useCallback, useMemo } from 'react';
import { Fuel, Plus, Pencil, Trash2, Truck } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, EmptyState, Modal, useToast, ConfirmDialog } from '../index';
import { TYPES_CARBURANT, posteLabel, num, fmtNum, fmtEur, frDate, isoDate, todayISO, yearsList, StatCard } from './energieShared';

// Conso L/100 km par plein (méthode plein à plein) : la conso d'un plein utilise
// ses litres et la distance depuis le plein précédent du même véhicule. Le 1er
// plein (par km) n'a pas de conso (réservoir de départ inconnu).
function consoParPlein(pleins) {
  const map = new Map();
  const byVeh = {};
  for (const p of pleins) {
    if (p.vehicle_id == null || p.km_compteur == null) continue;
    (byVeh[p.vehicle_id] = byVeh[p.vehicle_id] || []).push(p);
  }
  for (const list of Object.values(byVeh)) {
    const sorted = list.slice().sort((a, b) => a.km_compteur - b.km_compteur);
    for (let i = 1; i < sorted.length; i++) {
      const dkm = sorted[i].km_compteur - sorted[i - 1].km_compteur;
      const litres = num(sorted[i].litres);
      if (dkm > 0 && litres != null) map.set(sorted[i].id, Math.round((litres / dkm) * 100 * 100) / 100);
    }
  }
  return map;
}

// Consommation globale d'un véhicule sur la sélection (plein à plein).
function consoGlobale(pleins) {
  const pts = pleins.filter((p) => p.km_compteur != null).map((p) => ({ km: p.km_compteur, litres: num(p.litres) || 0 }))
    .sort((a, b) => a.km - b.km);
  if (pts.length < 2) return null;
  const km = pts[pts.length - 1].km - pts[0].km;
  if (!(km > 0)) return null;
  const litres = pts.slice(1).reduce((s, p) => s + p.litres, 0);
  return { conso: Math.round((litres / km) * 100 * 100) / 100, km, litres };
}

const EMPTY = { vehicle_id: '', date_plein: todayISO(), litres: '', cout_euros: '', km_compteur: '', type_carburant: 'gazole' };

function PleinForm({ open, onClose, onSaved, vehicles, editing }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        vehicle_id: editing.vehicle_id != null ? String(editing.vehicle_id) : '',
        date_plein: isoDate(editing.date_plein) || todayISO(),
        litres: editing.litres != null ? String(editing.litres) : '',
        cout_euros: editing.cout_euros != null ? String(editing.cout_euros) : '',
        km_compteur: editing.km_compteur != null ? String(editing.km_compteur) : '',
        type_carburant: editing.type_carburant || 'gazole',
      });
    } else {
      setForm(EMPTY);
    }
    setError(null);
  }, [open, editing]);

  const submit = async (e) => {
    e.preventDefault();
    const litres = num(form.litres);
    if (litres == null || litres < 0) { setError('Le volume (litres) est requis.'); return; }
    if (!form.date_plein) { setError('La date du plein est requise.'); return; }
    setSaving(true); setError(null);
    const kmClean = String(form.km_compteur ?? '').replace(/[^\d]/g, '');
    const payload = {
      vehicle_id: form.vehicle_id ? parseInt(form.vehicle_id, 10) : null,
      date_plein: form.date_plein,
      litres,
      cout_euros: num(form.cout_euros),
      km_compteur: kmClean === '' ? null : parseInt(kmClean, 10),
      type_carburant: form.type_carburant,
    };
    try {
      if (editing) await api.put(`/energie/pleins/${editing.id}`, payload);
      else await api.post('/energie/pleins', payload);
      toast.success(editing ? 'Plein modifié.' : 'Plein ajouté.');
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={editing ? 'Modifier le plein' : 'Ajouter un plein'} size="md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuler</button>
          <button type="submit" form="plein-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      )}
    >
      <form id="plein-form" onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Véhicule</label>
          <select value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })} className="input-modern py-2 text-sm w-full">
            <option value="">— Aucun / hors flotte —</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration || v.name || `#${v.id}`}{v.registration && v.name ? ` · ${v.name}` : ''}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date du plein</label>
            <input type="date" required value={form.date_plein} onChange={(e) => setForm({ ...form, date_plein: e.target.value })} className="input-modern py-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type de carburant</label>
            <select value={form.type_carburant} onChange={(e) => setForm({ ...form, type_carburant: e.target.value })} className="input-modern py-2 text-sm w-full">
              {TYPES_CARBURANT.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Litres</label>
            <input type="number" min="0" step="0.01" required value={form.litres} onChange={(e) => setForm({ ...form, litres: e.target.value })} className="input-modern py-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Coût (€)</label>
            <input type="number" min="0" step="0.01" value={form.cout_euros} onChange={(e) => setForm({ ...form, cout_euros: e.target.value })} placeholder="optionnel" className="input-modern py-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Km au compteur</label>
            <input type="number" min="0" step="1" value={form.km_compteur} onChange={(e) => setForm({ ...form, km_compteur: e.target.value })} placeholder="optionnel" className="input-modern py-2 text-sm w-full" />
          </div>
        </div>
        <p className="text-[11px] text-slate-400">Le kilométrage relevé à la pompe permet de calculer la consommation L/100 km (méthode plein à plein).</p>
      </form>
    </Modal>
  );
}

// Onglet « Carburant » : saisie des pleins + liste filtrable + conso L/100 km.
export default function SaisiePleins({ annee, setAnnee, canWrite }) {
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [pleins, setPleins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  useEffect(() => {
    api.get('/vehicles').then((r) => setVehicles(Array.isArray(r.data) ? r.data : [])).catch(() => setVehicles([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = [`annee=${annee}`];
    if (vehicleFilter) params.push(`vehicle=${vehicleFilter}`);
    api.get(`/energie/pleins?${params.join('&')}`)
      .then((r) => { setPleins(Array.isArray(r.data) ? r.data : []); setError(null); })
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [annee, vehicleFilter]);

  useEffect(() => { load(); }, [load]);

  const consoMap = useMemo(() => consoParPlein(pleins), [pleins]);
  const aggregate = useMemo(() => (vehicleFilter ? consoGlobale(pleins) : null), [pleins, vehicleFilter]);

  const confirmDelete = async () => {
    try {
      await api.delete(`/energie/pleins/${toDelete.id}`);
      toast.success('Plein supprimé.');
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Suppression impossible.');
    }
  };

  const onSaved = () => { setFormOpen(false); setEditing(null); load(); };

  return (
    <div className="space-y-5">
      {/* Filtres + action */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="pl-veh" className="block text-xs font-medium text-slate-600 mb-1">Véhicule</label>
          <select id="pl-veh" value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} className="input-modern py-2 text-sm min-w-[200px]">
            <option value="">Tous les véhicules</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration || v.name || `#${v.id}`}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pl-year" className="block text-xs font-medium text-slate-600 mb-1">Année</label>
          <select id="pl-year" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className="input-modern py-2 text-sm">
            {yearsList().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="ml-auto">
          {canWrite && (
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Ajouter un plein
            </button>
          )}
        </div>
      </div>

      {/* Agrégat véhicule sélectionné */}
      {aggregate && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard icon={Fuel} label="Consommation moyenne" value={`${fmtNum(aggregate.conso, 2)} L/100 km`} sub="sur la période filtrée" tone="teal" />
          <StatCard icon={Truck} label="Distance parcourue" value={`${fmtNum(aggregate.km, 0)} km`} tone="slate" />
          <StatCard icon={Fuel} label="Litres consommés" value={`${fmtNum(aggregate.litres, 1)} L`} sub="hors 1er plein de référence" tone="amber" />
        </div>
      )}

      {error ? (
        <ErrorState variant="card" title="Pleins indisponibles" message={error} onRetry={load} />
      ) : loading ? (
        <LoadingSpinner size="lg" message="Chargement des pleins…" />
      ) : pleins.length === 0 ? (
        <EmptyState icon={Fuel} title="Aucun plein enregistré"
          description={`Aucun plein pour ${annee}${vehicleFilter ? ' sur ce véhicule' : ''}.`}
          action={canWrite ? { label: 'Ajouter un plein', onClick: () => { setEditing(null); setFormOpen(true); } } : undefined} />
      ) : (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-3"><Fuel className="w-4 h-4 text-amber-500" /> Pleins {annee} ({pleins.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Véhicule</th>
                  <th className="text-left py-2 px-2">Carburant</th>
                  <th className="text-right py-2 px-2">Litres</th>
                  <th className="text-right py-2 px-2">Coût</th>
                  <th className="text-right py-2 px-2">Km</th>
                  <th className="text-right py-2 px-2">L/100 km</th>
                  {canWrite && <th className="text-right py-2 px-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pleins.map((p) => {
                  const conso = consoMap.get(p.id);
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2 px-2 text-slate-700">{frDate(p.date_plein)}</td>
                      <td className="py-2 px-2 text-slate-700">{p.vehicle_registration || p.vehicle_name || <span className="text-slate-400">hors flotte</span>}</td>
                      <td className="py-2 px-2 text-slate-600">{posteLabel(p.type_carburant)}</td>
                      <td className="py-2 px-2 text-right text-slate-600">{fmtNum(p.litres, 2)} L</td>
                      <td className="py-2 px-2 text-right text-slate-600">{fmtEur(p.cout_euros)}</td>
                      <td className="py-2 px-2 text-right text-slate-600">{p.km_compteur != null ? `${fmtNum(p.km_compteur, 0)}` : '—'}</td>
                      <td className="py-2 px-2 text-right font-medium text-slate-800">{conso != null ? fmtNum(conso, 2) : '—'}</td>
                      {canWrite && (
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditing(p); setFormOpen(true); }} className="text-slate-400 hover:text-teal-700 p-1" title="Modifier" aria-label="Modifier"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setToDelete(p)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">La consommation L/100 km d'un plein est calculée avec la distance depuis le plein précédent du même véhicule (kilométrage requis).</p>
        </div>
      )}

      <PleinForm open={formOpen} editing={editing} vehicles={vehicles}
        onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={onSaved} />

      <ConfirmDialog isOpen={!!toDelete} onCancel={() => setToDelete(null)} onConfirm={confirmDelete}
        title="Supprimer ce plein ?" message={toDelete ? `Plein du ${frDate(toDelete.date_plein)} — ${fmtNum(toDelete.litres, 2)} L. Cette action est définitive.` : ''}
        confirmLabel="Supprimer" confirmVariant="danger" />
    </div>
  );
}
