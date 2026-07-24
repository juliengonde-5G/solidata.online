import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, AlertTriangle, IdCard, HardHat, RefreshCw, Plus, Trash2, Info,
  FileText, ClipboardCheck, Download, Paperclip,
} from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Modal, ErrorState } from '../components';
import api from '../services/api';

// ══════════════════════════════════════════════════════════════════════════
// Module QHSE minimal (item 58) — 3 onglets : Accidents / Habilitations / EPI.
// Publics : ADMIN, MANAGER, QHSE. Données de santé minimisées (pas de
// diagnostic médical) — un bandeau RGPD le rappelle sur l'onglet accidents.
// ══════════════════════════════════════════════════════════════════════════

const EVENT_TYPE_LABELS = {
  accident_travail: 'Accident du travail',
  accident_trajet: 'Accident de trajet',
  presqu_accident: "Presqu'accident",
  soin_benin: 'Soin bénin',
};
const LIEU_LABELS = { tri: 'Site de tri', collecte: 'Collecte', boutique: 'Boutique', autre: 'Autre' };
const GRAVITE_LABELS = { mineure: 'Mineure', moderee: 'Modérée', grave: 'Grave', critique: 'Critique' };
const EVENT_STATUT_LABELS = { declare: 'Déclaré', analyse: 'Analysé', clos: 'Clos' };
const EVENT_STATUT_COLORS = {
  declare: 'bg-amber-100 text-amber-700 border-amber-200',
  analyse: 'bg-blue-100 text-blue-700 border-blue-200',
  clos: 'bg-slate-100 text-slate-600 border-slate-200',
};

const HAB_TYPE_LABELS = {
  caces_1: 'CACES 1', caces_3: 'CACES 3', caces_5: 'CACES 5', sst: 'SST',
  habilitation_electrique: 'Habilitation électrique', permis: 'Permis', autre: 'Autre',
};
const HAB_STATUT_LABELS = {
  valide: 'Valide', expire_90: 'Expire < 90 j', expire_60: 'Expire < 60 j',
  expiree: 'Expirée', sans_echeance: 'Sans échéance',
};
const HAB_STATUT_COLORS = {
  valide: 'bg-green-100 text-green-700 border-green-200',
  expire_90: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  expire_60: 'bg-amber-100 text-amber-700 border-amber-200',
  expiree: 'bg-red-100 text-red-700 border-red-200',
  sans_echeance: 'bg-slate-100 text-slate-500 border-slate-200',
};

const EPI_TYPE_LABELS = {
  chaussures: 'Chaussures de sécurité', gants: 'Gants', gilet_hv: 'Gilet haute visibilité',
  casque_antibruit: 'Casque anti-bruit', autre: 'Autre',
};
const EPI_ETAT_LABELS = { valide: 'Valide', bientot: 'Péremption < 60 j', perimee: 'Périmé', sans_echeance: 'Sans péremption' };
const EPI_ETAT_COLORS = {
  valide: 'bg-green-100 text-green-700 border-green-200',
  bientot: 'bg-amber-100 text-amber-700 border-amber-200',
  perimee: 'bg-red-100 text-red-700 border-red-200',
  sans_echeance: 'bg-slate-100 text-slate-500 border-slate-200',
};

// ── Documents de prévention (RSEI-06) ──────────────────────────────────────
const DOC_TYPE_LABELS = {
  duerp: 'DUERP',
  plan_prevention: 'Plan de prévention',
  rps: 'Risques psychosociaux (RPS)',
  protocole_securite: 'Protocole de sécurité',
  consignes: 'Consignes',
  autre: 'Autre',
};
const DOC_REV_LABELS = {
  a_reviser: 'À réviser', bientot: 'Révision proche', a_jour: 'À jour', sans_echeance: 'Sans échéance',
};
const DOC_REV_COLORS = {
  a_reviser: 'bg-red-100 text-red-700 border-red-200',
  bientot: 'bg-amber-100 text-amber-700 border-amber-200',
  a_jour: 'bg-green-100 text-green-700 border-green-200',
  sans_echeance: 'bg-slate-100 text-slate-500 border-slate-200',
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const truncate = (s, n = 90) => (s && s.length > n ? `${s.slice(0, n)}…` : (s || ''));
const Pill = ({ label, color }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>{label}</span>
);

const TABS = [
  { key: 'accidents', label: 'Accidents & presqu\'accidents', path: '/qhse/accidents', icon: AlertTriangle },
  { key: 'documents', label: 'Documents de prévention', path: '/qhse/documents', icon: FileText },
  { key: 'rex', label: "Retours d'expérience", path: '/qhse/rex', icon: ClipboardCheck },
  { key: 'habilitations', label: 'Habilitations', path: '/qhse/habilitations', icon: IdCard },
  { key: 'epi', label: 'Dotation EPI', path: '/qhse/epi', icon: HardHat },
];

export default function Qhse({ tab = 'accidents' }) {
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    api.get('/qhse/employees').then((r) => setEmployees(r.data || [])).catch(() => setEmployees([]));
  }, []);

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="QHSE"
          subtitle="Qualité-Hygiène-Sécurité-Environnement — accidents, documents de prévention, retours d'expérience, habilitations, EPI"
          icon={ShieldCheck}
        />

        {/* Onglets */}
        <div className="flex flex-wrap gap-2 mb-5 border-b border-slate-200">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.key === tab;
            return (
              <Link
                key={t.key}
                to={t.path}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                  active ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.8} /> {t.label}
              </Link>
            );
          })}
        </div>

        {tab === 'accidents' && <AccidentsTab employees={employees} />}
        {tab === 'documents' && <DocumentsTab />}
        {tab === 'rex' && <RexTab />}
        {tab === 'habilitations' && <HabilitationsTab employees={employees} />}
        {tab === 'epi' && <EpiTab employees={employees} />}

        {/* Encart périmètre */}
        <div className="mt-8 card-modern p-4 bg-slate-50/60 flex items-start gap-3 text-sm text-slate-500">
          <Info className="w-5 h-5 flex-shrink-0 text-slate-400" strokeWidth={1.8} />
          <div>
            <p className="font-medium text-slate-600">Périmètre du module QHSE</p>
            <p className="mt-1">
              Ce module couvre le registre des accidents/presqu'accidents (taux de fréquence et de gravité),
              le registre des documents de prévention (DUERP, plan de prévention, RPS…) avec trace de consultation
              des IRP/CSE et échéance de révision, les retours d'expérience SST (analyse des causes → action corrective
              → efficacité vérifiée), le suivi des habilitations à échéance et la dotation EPI. Les élections et
              procès-verbaux du CSE restent gérés hors outil.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ONGLET (a) — ACCIDENTS / PRESQU'ACCIDENTS
// ══════════════════════════════════════════════════════════════════════════
const EMPTY_EVENT = {
  type: 'accident_travail', employee_id: '', date_event: '', lieu: 'tri',
  gravite: '', jours_arret: 0, avec_arret: false, description: '', mesures_prises: '', statut: 'declare',
  analyse_causes: '', action_corrective: '', efficacite_verifiee_le: '', efficacite_constat: '',
};

function AccidentsTab({ employees }) {
  const currentYear = new Date().getFullYear();
  const [annee, setAnnee] = useState(currentYear);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ type: '', statut: '', lieu: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_EVENT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { annee };
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const [evRes, stRes] = await Promise.all([
        api.get('/qhse/events', { params }),
        api.get('/qhse/events/stats', { params: { annee } }).catch(() => ({ data: null })),
      ]);
      setEvents(evRes.data || []);
      setStats(stRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger le registre des accidents.');
    }
    setLoading(false);
  }, [annee, filters]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_EVENT }); setFormError(''); setModalOpen(true); };
  const openEdit = (ev) => {
    setEditing(ev);
    setForm({
      type: ev.type, employee_id: ev.employee_id || '', date_event: ev.date_event ? ev.date_event.slice(0, 10) : '',
      lieu: ev.lieu, gravite: ev.gravite || '', jours_arret: ev.jours_arret || 0, avec_arret: !!ev.avec_arret,
      description: ev.description || '', mesures_prises: ev.mesures_prises || '', statut: ev.statut,
      analyse_causes: ev.analyse_causes || '', action_corrective: ev.action_corrective || '',
      efficacite_verifiee_le: ev.efficacite_verifiee_le ? ev.efficacite_verifiee_le.slice(0, 10) : '',
      efficacite_constat: ev.efficacite_constat || '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.type) { setFormError('Le type est obligatoire.'); return; }
    if (!form.date_event) { setFormError("La date de l'évènement est obligatoire."); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      ...form,
      employee_id: form.employee_id || null,
      gravite: form.gravite || null,
      jours_arret: parseInt(form.jours_arret, 10) || 0,
      analyse_causes: form.analyse_causes || null,
      action_corrective: form.action_corrective || null,
      efficacite_verifiee_le: form.efficacite_verifiee_le || null,
      efficacite_constat: form.efficacite_constat || null,
    };
    try {
      if (editing) await api.patch(`/qhse/events/${editing.id}`, payload);
      else await api.post('/qhse/events', payload);
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || "Échec de l'enregistrement.");
    }
    setSaving(false);
  };

  const years = [];
  for (let y = currentYear; y >= currentYear - 5; y--) years.push(y);

  return (
    <div>
      {/* Bandeau RGPD */}
      <div className="card-modern p-3 mb-4 bg-blue-50/60 border border-blue-100 flex items-start gap-2.5 text-sm text-blue-800">
        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
        <span>
          <strong>RGPD :</strong> décrivez uniquement les <em>faits</em> (circonstances, lieu, jours d'arrêt).
          N'inscrivez <strong>aucun diagnostic médical</strong> ni donnée de santé détaillée.
        </span>
      </div>

      {/* Cartes TF/TG */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="card-modern p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Taux de fréquence TF1</p>
            <p className="text-2xl font-bold mt-1 text-slate-800">{stats.tf1 != null ? stats.tf1 : '—'}</p>
            <p className="text-[11px] text-slate-400 mt-1">AT avec arrêt × 10⁶ / h travaillées</p>
          </div>
          <div className="card-modern p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Taux de gravité TG</p>
            <p className="text-2xl font-bold mt-1 text-slate-800">{stats.tg != null ? stats.tg : '—'}</p>
            <p className="text-[11px] text-slate-400 mt-1">Jours d'arrêt × 10³ / h travaillées</p>
          </div>
          <div className="card-modern p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Évènements {annee}</p>
            <p className="text-2xl font-bold mt-1 text-slate-800">{stats.total_events}</p>
            <p className="text-[11px] text-slate-400 mt-1">dont {stats.total_avec_arret} avec arrêt</p>
          </div>
          <div className="card-modern p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide">Jours d'arrêt (AT)</p>
            <p className="text-2xl font-bold mt-1 text-slate-800">{stats.jours_arret_accidents_travail}</p>
            <p className="text-[11px] text-slate-400 mt-1">{Math.round(stats.heures_travaillees).toLocaleString('fr-FR')} h travaillées</p>
          </div>
        </div>
      )}
      {stats?.heures_source === 'estimation_etp' && stats?.heures_note && (
        <p className="text-xs text-amber-600 mb-4 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.8} /> {stats.heures_note}
        </p>
      )}

      {/* Répartition par type */}
      {stats?.par_type && (
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(EVENT_TYPE_LABELS).map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 rounded-full px-3 py-1">
              {label} <strong className="text-slate-800">{stats.par_type[k]?.nb ?? 0}</strong>
            </span>
          ))}
        </div>
      )}

      {/* Filtres + actions */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))} className="input-modern text-sm">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))} className="input-modern text-sm">
          <option value="">Tous types</option>
          {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.statut} onChange={(e) => setFilters((f) => ({ ...f, statut: e.target.value }))} className="input-modern text-sm">
          <option value="">Tous statuts</option>
          {Object.entries(EVENT_STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.lieu} onChange={(e) => setFilters((f) => ({ ...f, lieu: e.target.value }))} className="input-modern text-sm">
          <option value="">Tous lieux</option>
          {Object.entries(LIEU_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw className="w-4 h-4" strokeWidth={1.8} /> Actualiser</button>
        <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 ml-auto"><Plus className="w-4 h-4" strokeWidth={1.8} /> Déclarer</button>
      </div>

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement…" />
      ) : error ? (
        <ErrorState variant="card" title="Registre indisponible" message={error} onRetry={load} />
      ) : events.length === 0 ? (
        <div className="card-modern p-12 text-center text-slate-400">Aucun évènement enregistré pour cette période.</div>
      ) : (
        <div className="card-modern overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Salarié</th>
                  <th className="px-4 py-2.5">Lieu</th>
                  <th className="px-4 py-2.5">Arrêt</th>
                  <th className="px-4 py-2.5">Statut</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => openEdit(ev)}>
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDate(ev.date_event)}</td>
                    <td className="px-4 py-3 font-medium">{EVENT_TYPE_LABELS[ev.type] || ev.type}</td>
                    <td className="px-4 py-3 text-slate-600">{ev.employee_name?.trim() || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-500">{LIEU_LABELS[ev.lieu] || ev.lieu}</td>
                    <td className="px-4 py-3 text-slate-500">{ev.avec_arret ? `${ev.jours_arret} j` : 'Non'}</td>
                    <td className="px-4 py-3"><Pill label={EVENT_STATUT_LABELS[ev.statut] || ev.statut} color={EVENT_STATUT_COLORS[ev.statut]} /></td>
                    <td className="px-4 py-3 text-right"><button onClick={(e) => { e.stopPropagation(); openEdit(ev); }} className="text-primary text-xs font-medium hover:underline">Analyser</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Évènement #${editing.id}` : 'Déclarer un évènement'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label-modern">Type *</span>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="input-modern w-full text-sm">
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-modern">Date *</span>
              <input type="date" value={form.date_event} onChange={(e) => setForm((f) => ({ ...f, date_event: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
            <label className="block">
              <span className="label-modern">Salarié concerné</span>
              <select value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} className="input-modern w-full text-sm">
                <option value="">— (non nominatif)</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-modern">Lieu</span>
              <select value={form.lieu} onChange={(e) => setForm((f) => ({ ...f, lieu: e.target.value }))} className="input-modern w-full text-sm">
                {Object.entries(LIEU_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-modern">Gravité</span>
              <select value={form.gravite} onChange={(e) => setForm((f) => ({ ...f, gravite: e.target.value }))} className="input-modern w-full text-sm">
                <option value="">— non évaluée</option>
                {Object.entries(GRAVITE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-modern">Jours d'arrêt</span>
              <input type="number" min="0" value={form.jours_arret}
                onChange={(e) => { const j = e.target.value; setForm((f) => ({ ...f, jours_arret: j, avec_arret: (parseInt(j, 10) || 0) > 0 ? true : f.avec_arret })); }}
                className="input-modern w-full text-sm" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.avec_arret} onChange={(e) => setForm((f) => ({ ...f, avec_arret: e.target.checked }))} className="rounded" />
            Avec arrêt de travail
          </label>
          <label className="block">
            <span className="label-modern">Description factuelle des faits</span>
            <textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Circonstances, sans donnée médicale…" className="input-modern w-full text-sm" />
          </label>
          <label className="block">
            <span className="label-modern">Mesures prises / analyse</span>
            <textarea rows={2} value={form.mesures_prises} onChange={(e) => setForm((f) => ({ ...f, mesures_prises: e.target.value }))} className="input-modern w-full text-sm" />
          </label>
          <label className="block">
            <span className="label-modern">Statut</span>
            <select value={form.statut} onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))} className="input-modern w-full text-sm">
              {Object.entries(EVENT_STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>

          {/* Boucle REX (RSEi 2.4) — uniquement en édition d'un évènement existant */}
          {editing && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
              <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <ClipboardCheck className="w-4 h-4 text-slate-500" strokeWidth={1.8} /> Retour d'expérience (RSEi 2.4)
              </p>
              <label className="block">
                <span className="label-modern">Analyse des causes</span>
                <textarea rows={2} value={form.analyse_causes} onChange={(e) => setForm((f) => ({ ...f, analyse_causes: e.target.value }))} placeholder="Causes racines identifiées (5 pourquoi, arbre des causes…)" className="input-modern w-full text-sm" />
              </label>
              <label className="block">
                <span className="label-modern">Action corrective</span>
                <textarea rows={2} value={form.action_corrective} onChange={(e) => setForm((f) => ({ ...f, action_corrective: e.target.value }))} placeholder="Mesure de prévention décidée pour éviter la récidive" className="input-modern w-full text-sm" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label-modern">Efficacité vérifiée le</span>
                  <input type="date" value={form.efficacite_verifiee_le} onChange={(e) => setForm((f) => ({ ...f, efficacite_verifiee_le: e.target.value }))} className="input-modern w-full text-sm" />
                </label>
              </div>
              <label className="block">
                <span className="label-modern">Constat d'efficacité</span>
                <textarea rows={2} value={form.efficacite_constat} onChange={(e) => setForm((f) => ({ ...f, efficacite_constat: e.target.value }))} placeholder="Constat après mise en œuvre (action efficace ? récidive ?)" className="input-modern w-full text-sm" />
              </label>
            </div>
          )}

          {formError && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" strokeWidth={1.8} /> {formError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Annuler</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ONGLET (b) — HABILITATIONS
// ══════════════════════════════════════════════════════════════════════════
const EMPTY_HAB = { employee_id: '', type: 'caces_3', libelle: '', date_obtention: '', date_expiration: '', organisme: '' };

function HabilitationsTab({ employees }) {
  const [rows, setRows] = useState([]);
  const [echeances, setEcheances] = useState(null);
  const [filterType, setFilterType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_HAB);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filterType) params.type = filterType;
      const [listRes, echRes] = await Promise.all([
        api.get('/qhse/habilitations', { params }),
        api.get('/qhse/habilitations/echeances').catch(() => ({ data: null })),
      ]);
      setRows(listRes.data || []);
      setEcheances(echRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger les habilitations.');
    }
    setLoading(false);
  }, [filterType]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_HAB }); setFormError(''); setModalOpen(true); };
  const openEdit = (h) => {
    setEditing(h);
    setForm({
      employee_id: h.employee_id, type: h.type, libelle: h.libelle || '',
      date_obtention: h.date_obtention ? h.date_obtention.slice(0, 10) : '',
      date_expiration: h.date_expiration ? h.date_expiration.slice(0, 10) : '',
      organisme: h.organisme || '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.employee_id) { setFormError('Le salarié est obligatoire.'); return; }
    if (!form.type) { setFormError('Le type est obligatoire.'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      type: form.type, libelle: form.libelle || null,
      date_obtention: form.date_obtention || null, date_expiration: form.date_expiration || null,
      organisme: form.organisme || null,
    };
    try {
      if (editing) await api.patch(`/qhse/habilitations/${editing.id}`, payload);
      else await api.post('/qhse/habilitations', { ...payload, employee_id: form.employee_id });
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || "Échec de l'enregistrement.");
    }
    setSaving(false);
  };

  const remove = async (h) => {
    if (!window.confirm(`Supprimer l'habilitation « ${HAB_TYPE_LABELS[h.type] || h.type} » de ${h.employee_name} ?`)) return;
    try { await api.delete(`/qhse/habilitations/${h.id}`); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Échec de la suppression.'); }
  };

  return (
    <div>
      {echeances && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="card-modern p-4"><p className="text-xs text-slate-400 uppercase tracking-wide">Expirées</p><p className="text-2xl font-bold mt-1 text-red-600">{echeances.counts.expirees}</p></div>
          <div className="card-modern p-4"><p className="text-xs text-slate-400 uppercase tracking-wide">Sous 60 jours</p><p className="text-2xl font-bold mt-1 text-amber-600">{echeances.counts.sous_60j}</p></div>
          <div className="card-modern p-4"><p className="text-xs text-slate-400 uppercase tracking-wide">Sous 90 jours</p><p className="text-2xl font-bold mt-1 text-yellow-600">{echeances.counts.sous_90j}</p></div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input-modern text-sm">
          <option value="">Tous types</option>
          {Object.entries(HAB_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw className="w-4 h-4" strokeWidth={1.8} /> Actualiser</button>
        <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 ml-auto"><Plus className="w-4 h-4" strokeWidth={1.8} /> Ajouter</button>
      </div>

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement…" />
      ) : error ? (
        <ErrorState variant="card" title="Habilitations indisponibles" message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <div className="card-modern p-12 text-center text-slate-400">Aucune habilitation enregistrée.</div>
      ) : (
        <div className="card-modern overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-2.5">Salarié</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Obtention</th>
                  <th className="px-4 py-2.5">Expiration</th>
                  <th className="px-4 py-2.5">Statut</th>
                  <th className="px-4 py-2.5">Organisme</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium cursor-pointer" onClick={() => openEdit(h)}>{h.employee_name}</td>
                    <td className="px-4 py-3">{HAB_TYPE_LABELS[h.type] || h.type}{h.libelle ? <span className="text-slate-400 text-xs"> — {h.libelle}</span> : ''}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(h.date_obtention)}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(h.date_expiration)}</td>
                    <td className="px-4 py-3"><Pill label={HAB_STATUT_LABELS[h.statut] || h.statut} color={HAB_STATUT_COLORS[h.statut]} /></td>
                    <td className="px-4 py-3 text-slate-500">{h.organisme || '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(h)} className="text-primary text-xs font-medium hover:underline mr-3">Modifier</button>
                      <button onClick={() => remove(h)} className="text-red-500 hover:text-red-700" title="Supprimer"><Trash2 className="w-4 h-4 inline" strokeWidth={1.8} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Modifier une habilitation' : 'Ajouter une habilitation'}>
        <div className="space-y-3">
          <label className="block">
            <span className="label-modern">Salarié *</span>
            <select value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} disabled={!!editing} className="input-modern w-full text-sm disabled:bg-slate-100">
              <option value="">— choisir —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label-modern">Type *</span>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="input-modern w-full text-sm">
                {Object.entries(HAB_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-modern">Libellé</span>
              <input type="text" value={form.libelle} onChange={(e) => setForm((f) => ({ ...f, libelle: e.target.value }))} className="input-modern w-full text-sm" placeholder="Précision (facultatif)" />
            </label>
            <label className="block">
              <span className="label-modern">Date d'obtention</span>
              <input type="date" value={form.date_obtention} onChange={(e) => setForm((f) => ({ ...f, date_obtention: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
            <label className="block">
              <span className="label-modern">Date d'expiration</span>
              <input type="date" value={form.date_expiration} onChange={(e) => setForm((f) => ({ ...f, date_expiration: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="label-modern">Organisme</span>
            <input type="text" value={form.organisme} onChange={(e) => setForm((f) => ({ ...f, organisme: e.target.value }))} className="input-modern w-full text-sm" />
          </label>
          <p className="text-xs text-slate-400">Une habilitation CACES ou permis met à jour la compétence du salarié utilisée par le planning.</p>
          {formError && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" strokeWidth={1.8} /> {formError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Annuler</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ONGLET (c) — DOTATION EPI
// ══════════════════════════════════════════════════════════════════════════
const EMPTY_EPI = { employee_id: '', type_epi: 'chaussures', taille: '', date_dotation: '', date_peremption: '', quantite: 1, remarque: '' };

function EpiTab({ employees }) {
  const [rows, setRows] = useState([]);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_EPI);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filterEmployee) params.employee_id = filterEmployee;
      const r = await api.get('/qhse/epi', { params });
      setRows(r.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger les dotations EPI.');
    }
    setLoading(false);
  }, [filterEmployee]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_EPI, date_dotation: new Date().toISOString().slice(0, 10) }); setFormError(''); setModalOpen(true); };
  const openEdit = (d) => {
    setEditing(d);
    setForm({
      employee_id: d.employee_id, type_epi: d.type_epi, taille: d.taille || '',
      date_dotation: d.date_dotation ? d.date_dotation.slice(0, 10) : '',
      date_peremption: d.date_peremption ? d.date_peremption.slice(0, 10) : '',
      quantite: d.quantite || 1, remarque: d.remarque || '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    if (!editing && !form.employee_id) { setFormError('Le salarié est obligatoire.'); return; }
    if (!form.date_dotation) { setFormError('La date de dotation est obligatoire.'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      type_epi: form.type_epi, taille: form.taille || null, date_dotation: form.date_dotation,
      date_peremption: form.date_peremption || null, quantite: parseInt(form.quantite, 10) || 1, remarque: form.remarque || null,
    };
    try {
      if (editing) await api.patch(`/qhse/epi/${editing.id}`, payload);
      else await api.post('/qhse/epi', { ...payload, employee_id: form.employee_id });
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || "Échec de l'enregistrement.");
    }
    setSaving(false);
  };

  const remove = async (d) => {
    if (!window.confirm(`Supprimer la dotation « ${EPI_TYPE_LABELS[d.type_epi] || d.type_epi} » de ${d.employee_name} ?`)) return;
    try { await api.delete(`/qhse/epi/${d.id}`); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Échec de la suppression.'); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className="input-modern text-sm">
          <option value="">Tous les salariés</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw className="w-4 h-4" strokeWidth={1.8} /> Actualiser</button>
        <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 ml-auto"><Plus className="w-4 h-4" strokeWidth={1.8} /> Doter</button>
      </div>

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement…" />
      ) : error ? (
        <ErrorState variant="card" title="Dotations indisponibles" message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <div className="card-modern p-12 text-center text-slate-400">Aucune dotation enregistrée.</div>
      ) : (
        <div className="card-modern overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-2.5">Salarié</th>
                  <th className="px-4 py-2.5">EPI</th>
                  <th className="px-4 py-2.5">Taille</th>
                  <th className="px-4 py-2.5">Qté</th>
                  <th className="px-4 py-2.5">Dotation</th>
                  <th className="px-4 py-2.5">Péremption</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium cursor-pointer" onClick={() => openEdit(d)}>{d.employee_name}</td>
                    <td className="px-4 py-3">{EPI_TYPE_LABELS[d.type_epi] || d.type_epi}</td>
                    <td className="px-4 py-3 text-slate-500">{d.taille || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{d.quantite}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(d.date_dotation)}</td>
                    <td className="px-4 py-3">
                      {d.date_peremption ? <span className="mr-2 text-slate-500">{fmtDate(d.date_peremption)}</span> : null}
                      <Pill label={EPI_ETAT_LABELS[d.etat_peremption] || d.etat_peremption} color={EPI_ETAT_COLORS[d.etat_peremption]} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(d)} className="text-primary text-xs font-medium hover:underline mr-3">Modifier</button>
                      <button onClick={() => remove(d)} className="text-red-500 hover:text-red-700" title="Supprimer"><Trash2 className="w-4 h-4 inline" strokeWidth={1.8} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Modifier une dotation' : 'Nouvelle dotation EPI'}>
        <div className="space-y-3">
          <label className="block">
            <span className="label-modern">Salarié *</span>
            <select value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} disabled={!!editing} className="input-modern w-full text-sm disabled:bg-slate-100">
              <option value="">— choisir —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.last_name} {e.first_name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label-modern">Type d'EPI *</span>
              <select value={form.type_epi} onChange={(e) => setForm((f) => ({ ...f, type_epi: e.target.value }))} className="input-modern w-full text-sm">
                {Object.entries(EPI_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-modern">Taille</span>
              <input type="text" value={form.taille} onChange={(e) => setForm((f) => ({ ...f, taille: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
            <label className="block">
              <span className="label-modern">Date de dotation *</span>
              <input type="date" value={form.date_dotation} onChange={(e) => setForm((f) => ({ ...f, date_dotation: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
            <label className="block">
              <span className="label-modern">Date de péremption</span>
              <input type="date" value={form.date_peremption} onChange={(e) => setForm((f) => ({ ...f, date_peremption: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
            <label className="block">
              <span className="label-modern">Quantité</span>
              <input type="number" min="1" value={form.quantite} onChange={(e) => setForm((f) => ({ ...f, quantite: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="label-modern">Remarque</span>
            <input type="text" value={form.remarque} onChange={(e) => setForm((f) => ({ ...f, remarque: e.target.value }))} className="input-modern w-full text-sm" />
          </label>
          {formError && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" strokeWidth={1.8} /> {formError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Annuler</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ONGLET (d) — DOCUMENTS DE PRÉVENTION (RSEI-06)
// ══════════════════════════════════════════════════════════════════════════
const EMPTY_DOC = {
  type: 'duerp', titre: '', version: '', date_document: '', date_maj: '',
  date_revision_prevue: '', irp_consultation_date: '', irp_consultation_avis: '', remarque: '',
};

// Carte de présence d'un socle documentaire (DUERP / plan de prévention / RPS).
function SocleCard({ label, socle }) {
  if (!socle) return null;
  if (!socle.present) {
    return (
      <div className="card-modern p-4 border border-red-100 bg-red-50/40">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">À créer</span>
        </div>
        <p className="text-sm text-slate-400 mt-1">Document socle absent du registre.</p>
      </div>
    );
  }
  return (
    <div className="card-modern p-4 border border-green-100 bg-green-50/40">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</p>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Présent</span>
      </div>
      {socle.titre && <p className="text-sm font-medium text-slate-700 mt-1 truncate" title={socle.titre}>{socle.titre}</p>}
      <div className="flex items-center flex-wrap gap-1.5 mt-2">
        {socle.statut_revision && <Pill label={DOC_REV_LABELS[socle.statut_revision] || socle.statut_revision} color={DOC_REV_COLORS[socle.statut_revision] || DOC_REV_COLORS.sans_echeance} />}
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${socle.irp_consulte ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {socle.irp_consulte ? 'IRP consulté ✓' : 'IRP non tracée ✗'}
        </span>
      </div>
      {socle.date_maj && <p className="text-[11px] text-slate-400 mt-1">Mise à jour {fmtDate(socle.date_maj)}</p>}
    </div>
  );
}

// Cellule pièce jointe d'un document : téléchargement + envoi (multipart), par ligne
// (même pattern que le registre FDS des achats responsables).
function DocFichierCell({ doc, onChanged, onError }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    try {
      const res = await api.get(`/qhse/documents/${doc.id}/fichier`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fichier_original_name || `document-${doc.id}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { onError(err.response?.data?.error || 'Téléchargement impossible.'); }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); onError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/qhse/documents/${doc.id}/fichier`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChanged();
    } catch (err) { onError(err.response?.data?.error || "Échec de l'envoi du fichier."); }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-2">
      {doc.has_fichier ? (
        <button onClick={download} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" title={doc.fichier_original_name || 'Télécharger'}>
          <Download className="w-3.5 h-3.5" strokeWidth={1.8} /> Télécharger
        </button>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={busy}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-primary disabled:opacity-50" title="Joindre une pièce">
          <Paperclip className="w-3.5 h-3.5" strokeWidth={1.8} /> {busy ? '…' : 'Joindre'}
        </button>
      )}
      {doc.has_fichier && (
        <button onClick={() => inputRef.current?.click()} disabled={busy}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-primary disabled:opacity-50" title="Remplacer la pièce">
          <Paperclip className="w-3.5 h-3.5" strokeWidth={1.8} /> {busy ? '…' : 'Remplacer'}
        </button>
      )}
      <input ref={inputRef} type="file" onChange={upload} className="hidden" />
    </div>
  );
}

function DocumentsTab() {
  const [docs, setDocs] = useState([]);
  const [synthese, setSynthese] = useState(null);
  const [filterType, setFilterType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_DOC);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const modalFileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filterType) params.type = filterType;
      const [docRes, synRes] = await Promise.all([
        api.get('/qhse/documents', { params }),
        api.get('/qhse/documents/synthese').catch(() => ({ data: null })),
      ]);
      setDocs(docRes.data || []);
      setSynthese(synRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger le registre des documents de prévention.');
    }
    setLoading(false);
  }, [filterType]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_DOC }); setFormError(''); setModalOpen(true); };
  const openEdit = (d) => {
    setEditing(d);
    setForm({
      type: d.type || 'autre', titre: d.titre || '', version: d.version || '',
      date_document: d.date_document ? d.date_document.slice(0, 10) : '',
      date_maj: d.date_maj ? d.date_maj.slice(0, 10) : '',
      date_revision_prevue: d.date_revision_prevue ? d.date_revision_prevue.slice(0, 10) : '',
      irp_consultation_date: d.irp_consultation_date ? d.irp_consultation_date.slice(0, 10) : '',
      irp_consultation_avis: d.irp_consultation_avis || '', remarque: d.remarque || '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.titre.trim()) { setFormError('Le titre est obligatoire.'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      type: form.type,
      titre: form.titre.trim(),
      version: form.version || null,
      date_document: form.date_document || null,
      date_maj: form.date_maj || null,
      date_revision_prevue: form.date_revision_prevue || null,
      irp_consultation_date: form.irp_consultation_date || null,
      irp_consultation_avis: form.irp_consultation_avis || null,
      remarque: form.remarque || null,
    };
    try {
      if (editing) await api.patch(`/qhse/documents/${editing.id}`, payload);
      else await api.post('/qhse/documents', payload);
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || "Échec de l'enregistrement.");
    }
    setSaving(false);
  };

  const remove = async (d) => {
    if (!window.confirm(`Supprimer le document « ${d.titre} » ?`)) return;
    try { await api.delete(`/qhse/documents/${d.id}`); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Échec de la suppression.'); }
  };

  // Envoi de la pièce jointe depuis le modal d'édition (le document doit exister).
  const uploadInModal = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editing) return;
    setUploadBusy(true);
    setFormError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/qhse/documents/${editing.id}/fichier`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data) setEditing(res.data);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || "Échec de l'envoi du fichier.");
    }
    setUploadBusy(false);
  };

  return (
    <div>
      {/* Synthèse — présence des socles + compteurs */}
      {synthese && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <SocleCard label="DUERP" socle={synthese.presence_socles?.duerp} />
            <SocleCard label="Plan de prévention" socle={synthese.presence_socles?.plan_prevention} />
            <SocleCard label="Risques psychosociaux (RPS)" socle={synthese.presence_socles?.rps} />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card-modern p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Documents référencés</p>
              <p className="text-2xl font-bold mt-1 text-slate-800">{synthese.total ?? 0}</p>
            </div>
            <div className="card-modern p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">À réviser</p>
              <p className="text-2xl font-bold mt-1 text-red-600">{synthese.counts?.a_reviser ?? 0}</p>
            </div>
            <div className="card-modern p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Révision proche</p>
              <p className="text-2xl font-bold mt-1 text-amber-600">{synthese.counts?.bientot ?? 0}</p>
            </div>
          </div>
        </>
      )}

      {/* Filtres + actions */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="input-modern text-sm">
          <option value="">Tous types</option>
          {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw className="w-4 h-4" strokeWidth={1.8} /> Actualiser</button>
        <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 ml-auto"><Plus className="w-4 h-4" strokeWidth={1.8} /> Nouveau document</button>
      </div>

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement…" />
      ) : error ? (
        <ErrorState variant="card" title="Registre indisponible" message={error} onRetry={load} />
      ) : docs.length === 0 ? (
        <div className="card-modern p-12 text-center text-slate-400">Aucun document de prévention enregistré.</div>
      ) : (
        <div className="card-modern overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Titre</th>
                  <th className="px-4 py-2.5">Dernière MAJ</th>
                  <th className="px-4 py-2.5">Révision prévue</th>
                  <th className="px-4 py-2.5">Consultation IRP/CSE</th>
                  <th className="px-4 py-2.5">Pièce jointe</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t hover:bg-slate-50 align-top">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{DOC_TYPE_LABELS[d.type] || d.type}</td>
                    <td className="px-4 py-3 font-medium cursor-pointer min-w-[180px]" onClick={() => openEdit(d)}>
                      {d.titre}{d.version ? <span className="text-slate-400 text-xs"> — v{d.version}</span> : ''}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(d.date_maj)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {d.date_revision_prevue ? <span className="mr-2 text-slate-500">{fmtDate(d.date_revision_prevue)}</span> : null}
                      <Pill label={DOC_REV_LABELS[d.statut_revision] || d.statut_revision} color={DOC_REV_COLORS[d.statut_revision] || DOC_REV_COLORS.sans_echeance} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {d.irp_consulte ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 font-medium">Consulté le {fmtDate(d.irp_consultation_date)}</span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium">Non tracée</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap"><DocFichierCell doc={d} onChanged={load} onError={setError} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(d)} className="text-primary text-xs font-medium hover:underline mr-3">Modifier</button>
                      <button onClick={() => remove(d)} className="text-red-500 hover:text-red-700" title="Supprimer"><Trash2 className="w-4 h-4 inline" strokeWidth={1.8} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Document — ${editing.titre}` : 'Nouveau document de prévention'} size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label-modern">Type</span>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="input-modern w-full text-sm">
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-modern">Version</span>
              <input type="text" value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))} className="input-modern w-full text-sm" placeholder="Ex. 2026-1" />
            </label>
          </div>
          <label className="block">
            <span className="label-modern">Titre *</span>
            <input type="text" value={form.titre} onChange={(e) => setForm((f) => ({ ...f, titre: e.target.value }))} className="input-modern w-full text-sm" placeholder="Ex. Document unique d'évaluation des risques" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="label-modern">Date du document</span>
              <input type="date" value={form.date_document} onChange={(e) => setForm((f) => ({ ...f, date_document: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
            <label className="block">
              <span className="label-modern">Dernière mise à jour</span>
              <input type="date" value={form.date_maj} onChange={(e) => setForm((f) => ({ ...f, date_maj: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
            <label className="block">
              <span className="label-modern">Révision prévue</span>
              <input type="date" value={form.date_revision_prevue} onChange={(e) => setForm((f) => ({ ...f, date_revision_prevue: e.target.value }))} className="input-modern w-full text-sm" />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
            <p className="text-sm font-medium text-slate-700">Consultation IRP/CSE</p>
            <div className="grid grid-cols-1 gap-3">
              <label className="block">
                <span className="label-modern">Date de consultation</span>
                <input type="date" value={form.irp_consultation_date} onChange={(e) => setForm((f) => ({ ...f, irp_consultation_date: e.target.value }))} className="input-modern w-full text-sm" />
              </label>
              <label className="block">
                <span className="label-modern">Avis / observations</span>
                <textarea rows={2} value={form.irp_consultation_avis} onChange={(e) => setForm((f) => ({ ...f, irp_consultation_avis: e.target.value }))} className="input-modern w-full text-sm" placeholder="Avis rendu par les représentants du personnel…" />
              </label>
            </div>
          </div>

          <label className="block">
            <span className="label-modern">Remarque</span>
            <textarea rows={2} value={form.remarque} onChange={(e) => setForm((f) => ({ ...f, remarque: e.target.value }))} className="input-modern w-full text-sm" />
          </label>

          {/* Pièce jointe — se joint après création */}
          {editing ? (
            <div className="border-t border-slate-100 pt-3">
              <span className="label-modern">Pièce jointe</span>
              <div className="flex items-center flex-wrap gap-3 mt-1">
                {editing.has_fichier ? (
                  <span className="text-sm text-slate-600 inline-flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4 text-slate-400" strokeWidth={1.8} /> {editing.fichier_original_name || 'Fichier joint'}
                  </span>
                ) : (
                  <span className="text-sm text-slate-400">Aucune pièce jointe.</span>
                )}
                <button type="button" onClick={() => modalFileRef.current?.click()} disabled={uploadBusy} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Paperclip className="w-4 h-4" strokeWidth={1.8} /> {uploadBusy ? 'Envoi…' : (editing.has_fichier ? 'Remplacer le fichier' : 'Joindre un fichier')}
                </button>
                <input ref={modalFileRef} type="file" onChange={uploadInModal} className="hidden" />
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">La pièce jointe se joint après l'enregistrement, en rouvrant le document depuis le registre.</p>
          )}

          {formError && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" strokeWidth={1.8} /> {formError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Annuler</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ONGLET (e) — RETOURS D'EXPÉRIENCE SST (RSEI-07)
// ══════════════════════════════════════════════════════════════════════════
function RexTab() {
  const currentYear = new Date().getFullYear();
  const [annee, setAnnee] = useState(currentYear);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/qhse/rex', { params: { annee } });
      setData(r.data);
    } catch (err) {
      setError(err.response?.data?.error || "Impossible de charger les retours d'expérience SST.");
    }
    setLoading(false);
  }, [annee]);

  useEffect(() => { load(); }, [load]);

  const years = [];
  for (let y = currentYear; y >= currentYear - 5; y--) years.push(y);

  const evAnalyser = data?.a_analyser || [];
  const evenements = data?.evenements || [];
  const inc = data?.incidents_terrain || {};

  return (
    <div>
      {/* Rappel de la boucle SST */}
      <div className="card-modern p-3 mb-4 bg-blue-50/60 border border-blue-100 flex items-start gap-2.5 text-sm text-blue-800">
        <ClipboardCheck className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
        <span>
          <strong>Boucle SST (RSEi 2.4) :</strong> chaque accident ou presqu'accident significatif fait l'objet d'une
          <em> analyse des causes</em>, d'une <em>action corrective</em>, puis d'une <em>vérification d'efficacité</em>.
          L'analyse se saisit depuis la fiche de l'évènement, dans l'onglet « Accidents & presqu'accidents ».
        </span>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))} className="input-modern text-sm">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw className="w-4 h-4" strokeWidth={1.8} /> Actualiser</button>
      </div>

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement…" />
      ) : error ? (
        <ErrorState variant="card" title="Retours d'expérience indisponibles" message={error} onRetry={load} />
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
            <div className="card-modern p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Évènements soumis à REX</p>
              <p className="text-2xl font-bold mt-1 text-slate-800">{data?.total_evenements_rex ?? 0}</p>
              <p className="text-[11px] text-slate-400 mt-1">{annee}</p>
            </div>
            <div className="card-modern p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Taux d'analyse</p>
              <p className="text-2xl font-bold mt-1 text-slate-800">{data?.taux_analyse != null ? `${data.taux_analyse}%` : '—'}</p>
              <p className="text-[11px] text-slate-400 mt-1">{data?.nb_avec_analyse ?? 0} analysé(s)</p>
            </div>
            <div className="card-modern p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Actions correctives</p>
              <p className="text-2xl font-bold mt-1 text-slate-800">{data?.nb_avec_action_corrective ?? 0}</p>
            </div>
            <div className="card-modern p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Efficacité vérifiée</p>
              <p className="text-2xl font-bold mt-1 text-green-600">{data?.nb_efficacite_verifiee ?? 0}</p>
            </div>
            <div className="card-modern p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide">Incidents terrain</p>
              <p className="text-2xl font-bold mt-1 text-slate-800">{inc.total ?? 0}</p>
              <p className="text-[11px] text-slate-400 mt-1">
                {inc.resolus ?? 0} résolus{inc.delai_moyen_jours != null ? ` • délai moyen ${inc.delai_moyen_jours} j` : ''}
              </p>
            </div>
          </div>

          {/* À analyser */}
          {evAnalyser.length > 0 && (
            <div className="card-modern p-4 mb-4 border border-amber-100 bg-amber-50/40">
              <p className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" strokeWidth={1.8} /> À analyser ({evAnalyser.length})
              </p>
              <ul className="divide-y divide-amber-100">
                {evAnalyser.map((ev) => (
                  <li key={ev.id} className="py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700">
                        <span className="font-medium">{EVENT_TYPE_LABELS[ev.type] || ev.type}</span>
                        <span className="text-slate-400"> — {fmtDate(ev.date_event)}</span>
                        {ev.lieu ? <span className="text-slate-400"> • {LIEU_LABELS[ev.lieu] || ev.lieu}</span> : ''}
                      </p>
                      {ev.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{ev.description}</p>}
                    </div>
                    <Link to="/qhse/accidents" className="text-primary text-xs font-medium hover:underline whitespace-nowrap flex-shrink-0">Analyser →</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tableau de la boucle REX */}
          {evenements.length === 0 ? (
            <div className="card-modern p-12 text-center text-slate-400">Aucun évènement soumis à REX pour {annee}.</div>
          ) : (
            <div className="card-modern overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Analyse des causes</th>
                      <th className="px-4 py-2.5">Action corrective</th>
                      <th className="px-4 py-2.5">Efficacité vérifiée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evenements.map((ev) => (
                      <tr key={ev.id} className="border-t hover:bg-slate-50 align-top">
                        <td className="px-4 py-3 whitespace-nowrap">{fmtDate(ev.date_event)}</td>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">{EVENT_TYPE_LABELS[ev.type] || ev.type}</td>
                        <td className="px-4 py-3 text-slate-600 min-w-[180px]">{ev.analyse_causes ? truncate(ev.analyse_causes) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-slate-600 min-w-[180px]">{ev.action_corrective ? truncate(ev.action_corrective) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 text-slate-500 min-w-[160px]">
                          {ev.efficacite_verifiee_le ? (
                            <>
                              <div className="text-slate-600">{fmtDate(ev.efficacite_verifiee_le)}</div>
                              {ev.efficacite_constat && <div className="text-xs text-slate-400">{truncate(ev.efficacite_constat, 60)}</div>}
                            </>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
