import { useState, useEffect, useCallback } from 'react';
import { UserCog, Plus, Link2, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, Modal, DataTable, useToast } from '../../components';
import { formatEmployeeName, compareByName } from '../../utils/names';
import {
  apiErr, fmtDateTimeParis, employeeName, todayISO, offsetDaysISO,
  SOURCE_LABELS, STATUT_POINTAGE_LABELS, ORPHELIN_RAISON_LABELS,
  MOTIFS_CORRECTION,
  SensBadge, StatutPointageBadge, ChaineWarning,
} from './badgeuseShared';

const PAGE_SIZE = 30;

// ── Modale « Rattacher un pointage orphelin » ────────────────────────────────
function RattacherModal({ open, onClose, pointage, employees, onDone }) {
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setEmployeeId(''); setError(null); } }, [open, pointage]);

  const submit = async (e) => {
    e.preventDefault();
    if (!employeeId) { setError('Choisissez un salarié.'); return; }
    setSaving(true); setError(null);
    try {
      await api.post(`/badgeuse/orphelins/${pointage.id}/rattacher`, { employee_id: parseInt(employeeId, 10) });
      toast.success('Pointage rattaché.');
      onDone();
    } catch (err) { setError(apiErr(err, 'Rattachement impossible.')); setSaving(false); }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Rattacher le pointage orphelin" size="sm"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Annuler</button>
        <button type="submit" form="rattacher-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Rattachement…' : 'Rattacher'}</button>
      </>}>
      <form id="rattacher-form" onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        {pointage && (
          <p className="text-sm text-slate-600">
            Pointage du <strong>{fmtDateTimeParis(pointage.horodatage_utc)}</strong> (heure de Paris)
            {pointage.orphelin_raison && <> — motif : {ORPHELIN_RAISON_LABELS[pointage.orphelin_raison] || pointage.orphelin_raison}</>}
          </p>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Salarié</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="input-modern py-2 text-sm w-full" required>
            <option value="">— Choisir —</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{formatEmployeeName(emp.last_name, emp.first_name)}</option>)}
          </select>
        </div>
      </form>
    </Modal>
  );
}

// ── Modale « + Correction » ──────────────────────────────────────────────────
function CorrectionModal({ open, onClose, employees, prefill, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ employee_id: '', type: 'ajout', date: todayISO(), heure: '08:00', sens_corrige: 'entree', motif_code: 'oubli_badge', motif_detail: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [errorHint, setErrorHint] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      employee_id: prefill?.employee_id ? String(prefill.employee_id) : '',
      type: 'ajout',
      date: prefill?.date || todayISO(),
      heure: prefill?.heure || '08:00',
      sens_corrige: 'entree',
      motif_code: 'oubli_badge',
      motif_detail: '',
    });
    setError(null); setErrorHint(null);
  }, [open, prefill]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.employee_id) { setError('Le salarié est requis.'); return; }
    if (form.motif_code === 'autre' && !form.motif_detail.trim()) { setError('Précisez le motif (« autre »).'); return; }
    setSaving(true); setError(null); setErrorHint(null);
    try {
      const payload = {
        employee_id: parseInt(form.employee_id, 10),
        type: form.type,
        horodatage_corrige: `${form.date}T${form.heure}:00`,
        motif_code: form.motif_code,
        motif_detail: form.motif_code === 'autre' ? form.motif_detail.trim() : null,
      };
      if (form.type !== 'annulation') payload.sens_corrige = form.sens_corrige;
      await api.post('/badgeuse/corrections', payload);
      toast.success('Correction enregistrée.');
      onDone();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 403) {
        setError("Correction refusée : un encadrant ne peut pas corriger ses propres pointages. Cette correction doit être saisie par le RH (ou un tiers désigné pour la Direction).");
      } else if (status === 409) {
        setError("Correction refusée : la période concernée a déjà été validée par le RH. Une contestation postérieure suit la procédure de réclamation ordinaire.");
      } else {
        setError(apiErr(err, 'Enregistrement de la correction impossible.'));
      }
      setErrorHint(err?.response?.data?.hint || null);
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Nouvelle correction de pointage" size="md"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Annuler</button>
        <button type="submit" form="correction-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer la correction'}</button>
      </>}>
      <form id="correction-form" onSubmit={submit} className="space-y-3">
        {error && (
          <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">
            {error}{errorHint && <span className="block text-xs text-red-600 mt-1">{errorHint}</span>}
          </div>
        )}
        <p className="text-xs text-slate-400">L'enregistrement brut n'est jamais modifié : la correction s'ajoute, avec motif obligatoire et auteur tracé.</p>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Salarié</label>
          <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className="input-modern py-2 text-sm w-full" required>
            <option value="">— Choisir —</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{formatEmployeeName(emp.last_name, emp.first_name)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type de correction</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-modern py-2 text-sm w-full">
              <option value="ajout">Ajout d'un pointage manquant</option>
              <option value="modification">Modification d'un pointage existant</option>
              <option value="annulation">Annulation d'un pointage erroné</option>
            </select>
          </div>
          {form.type !== 'annulation' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Sens</label>
              <select value={form.sens_corrige} onChange={(e) => setForm({ ...form, sens_corrige: e.target.value })} className="input-modern py-2 text-sm w-full">
                <option value="entree">Entrée</option>
                <option value="sortie">Sortie</option>
              </select>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-modern py-2 text-sm w-full" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Heure</label>
            <input type="time" value={form.heure} onChange={(e) => setForm({ ...form, heure: e.target.value })} className="input-modern py-2 text-sm w-full" required />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Motif</label>
          <select value={form.motif_code} onChange={(e) => setForm({ ...form, motif_code: e.target.value })} className="input-modern py-2 text-sm w-full">
            {MOTIFS_CORRECTION.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        {form.motif_code === 'autre' && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Précision du motif</label>
            <input value={form.motif_detail} onChange={(e) => setForm({ ...form, motif_detail: e.target.value })} className="input-modern py-2 text-sm w-full" maxLength={200} required />
          </div>
        )}
      </form>
    </Modal>
  );
}

// ── Onglet Journal ────────────────────────────────────────────────────────────
// `externalPrefill` : { employee_id, date } transmis depuis l'onglet Anomalies
// pour ouvrir directement la modale de correction pré-remplie.
// Habilitations (MODELE_DONNEES.md §3) : les corrections sont ouvertes à
// ADMIN+RH+MANAGER (`canCorrect`), mais le rattachement d'un orphelin est
// WRITE_RH (ADMIN/RH uniquement, `canWriteRh`) — un encadrant ne rattache pas.
export default function JournalPointages({ canCorrect, canWriteRh, externalPrefill, onConsumeExternalPrefill }) {
  const toast = useToast();
  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filters, setFilters] = useState({ employee_id: '', du: offsetDaysISO(-7), au: todayISO(), statut: '' });

  const [orphelins, setOrphelins] = useState([]);
  const [orphLoading, setOrphLoading] = useState(true);
  const [rattacher, setRattacher] = useState(null); // { pointage }
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionPrefill, setCorrectionPrefill] = useState(null);

  useEffect(() => {
    api.get('/employees?is_active=true')
      .then((r) => setEmployees((Array.isArray(r.data) ? r.data : []).sort(compareByName)))
      .catch(() => setEmployees([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.employee_id) params.append('employee_id', filters.employee_id);
    if (filters.du) params.append('du', filters.du);
    if (filters.au) params.append('au', filters.au);
    if (filters.statut) params.append('statut', filters.statut);
    params.append('limit', String(PAGE_SIZE));
    params.append('offset', String((page - 1) * PAGE_SIZE));
    api.get(`/badgeuse/pointages?${params}`)
      .then((r) => {
        const d = r.data;
        const list = Array.isArray(d) ? d : (d.pointages || d.rows || d.items || []);
        setRows(list);
        setTotal(d.total ?? (Array.isArray(d) ? list.length : list.length));
        setError(null);
      })
      .catch((err) => setError(apiErr(err, 'Chargement du journal impossible.')))
      .finally(() => setLoading(false));
  }, [filters, page]);
  useEffect(() => { load(); }, [load]);

  const loadOrphelins = useCallback(() => {
    setOrphLoading(true);
    api.get('/badgeuse/orphelins')
      .then((r) => {
        const d = r.data;
        setOrphelins(Array.isArray(d) ? d : (d.orphelins || d.pointages || d.rows || []));
      })
      .catch(() => setOrphelins([]))
      .finally(() => setOrphLoading(false));
  }, []);
  useEffect(() => { loadOrphelins(); }, [loadOrphelins]);

  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const reloadAll = () => { load(); loadOrphelins(); };

  // Arrivée depuis l'onglet Anomalies : ouvre la modale pré-remplie une fois.
  useEffect(() => {
    if (externalPrefill && canCorrect) {
      setCorrectionPrefill(externalPrefill);
      setCorrectionOpen(true);
      onConsumeExternalPrefill?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPrefill]);

  const columns = [
    {
      key: 'horodatage_utc', label: 'Date / heure (Paris)',
      render: (r) => <span className="whitespace-nowrap">{fmtDateTimeParis(r.horodatage_utc)}</span>,
    },
    { key: 'employee', label: 'Salarié', render: (r) => employeeName(r) },
    { key: 'sens', label: 'Sens', render: (r) => <SensBadge sens={r.sens} /> },
    { key: 'source', label: 'Source', render: (r) => SOURCE_LABELS[r.source] || r.source || '—' },
    { key: 'statut', label: 'Statut', render: (r) => <StatutPointageBadge statut={r.statut} /> },
    {
      key: 'anomalie', label: 'Chaîne', align: 'center',
      render: (r) => <ChaineWarning chaineValide={r.chaine_valide} />,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Filtres */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="jrn-emp" className="block text-xs font-medium text-slate-600 mb-1">Salarié</label>
          <select id="jrn-emp" value={filters.employee_id} onChange={(e) => setFilter('employee_id', e.target.value)} className="input-modern py-2 text-sm min-w-[200px]">
            <option value="">Tous</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{formatEmployeeName(emp.last_name, emp.first_name)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="jrn-du" className="block text-xs font-medium text-slate-600 mb-1">Du</label>
          <input id="jrn-du" type="date" value={filters.du} onChange={(e) => setFilter('du', e.target.value)} className="input-modern py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="jrn-au" className="block text-xs font-medium text-slate-600 mb-1">Au</label>
          <input id="jrn-au" type="date" value={filters.au} onChange={(e) => setFilter('au', e.target.value)} className="input-modern py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="jrn-statut" className="block text-xs font-medium text-slate-600 mb-1">Statut</label>
          <select id="jrn-statut" value={filters.statut} onChange={(e) => setFilter('statut', e.target.value)} className="input-modern py-2 text-sm">
            <option value="">Tous</option>
            {Object.entries(STATUT_POINTAGE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <button onClick={reloadAll} className="text-xs text-slate-400 hover:text-teal-700 inline-flex items-center gap-1 mb-2" title="Actualiser">
          <RefreshCw className="w-3.5 h-3.5" /> Actualiser
        </button>
        {canCorrect && (
          <button onClick={() => { setCorrectionPrefill(null); setCorrectionOpen(true); }} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Correction
          </button>
        )}
      </div>

      {/* Encart pointages orphelins */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-2">
          <UserCog className="w-4 h-4 text-amber-600" /> Pointages orphelins
          {orphelins.length > 0 && <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{orphelins.length}</span>}
        </h3>
        <p className="text-xs text-slate-400 mb-3">Badge non reconnu par le poste au moment du pointage — à rattacher manuellement au salarié concerné (PST-04).</p>
        {orphLoading ? (
          <LoadingSpinner size="sm" />
        ) : orphelins.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">Aucun pointage orphelin en attente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-2">Date / heure (Paris)</th>
                  <th className="text-left py-2 px-2">Motif</th>
                  <th className="text-left py-2 px-2">Poste</th>
                  {canWriteRh && <th className="text-right py-2 px-2">Action</th>}
                </tr>
              </thead>
              <tbody>
                {orphelins.map((o) => (
                  <tr key={o.id} className="border-b border-slate-50">
                    <td className="py-2 px-2 whitespace-nowrap">{fmtDateTimeParis(o.horodatage_utc)}</td>
                    <td className="py-2 px-2 text-amber-700">{ORPHELIN_RAISON_LABELS[o.orphelin_raison] || o.orphelin_raison || '—'}</td>
                    <td className="py-2 px-2 text-slate-500">{o.device_code || o.device_libelle || '—'}</td>
                    {canWriteRh && (
                      <td className="py-2 px-2 text-right">
                        <button onClick={() => setRattacher(o)} className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 text-xs font-medium">
                          <Link2 className="w-3.5 h-3.5" /> Rattacher
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Journal */}
      {error ? (
        <ErrorState variant="card" title="Journal indisponible" message={error} onRetry={load} />
      ) : (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800 mb-3">Journal des pointages</h3>
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            emptyMessage="Aucun pointage sur cette période."
            pagination={{ page, pageSize: PAGE_SIZE, total, onPageChange: setPage }}
          />
        </div>
      )}

      <RattacherModal open={!!rattacher} pointage={rattacher} employees={employees}
        onClose={() => setRattacher(null)}
        onDone={() => { setRattacher(null); reloadAll(); }} />

      <CorrectionModal open={correctionOpen} employees={employees} prefill={correctionPrefill}
        onClose={() => setCorrectionOpen(false)}
        onDone={() => { setCorrectionOpen(false); reloadAll(); toast.success('Le journal a été mis à jour.'); }} />
    </div>
  );
}
