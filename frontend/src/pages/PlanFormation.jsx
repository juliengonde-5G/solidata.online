import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { PageHeader, Section, KPICard, Modal, ErrorState, LoadingSpinner } from '../components';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { GraduationCap, Plus, RefreshCw, Trash2, Pencil } from 'lucide-react';

// RSEI-12 — Plan de formation (critère RSEi 2.1). Actions non nominatives
// (nb de participants) ; le suivi individuel des heures reste dans work_hours.
const TYPE_LABELS = {
  interne: 'Interne', externe: 'Externe', obligatoire_securite: 'Obligatoire / sécurité',
  habilitation: 'Habilitation', tutorat: 'Tutorat', autre: 'Autre',
};
const ORIGINE_LABELS = {
  entretien: 'Entretien / parcours', reglementaire: 'Réglementaire', projet_entreprise: "Projet d'entreprise",
  souhait_salarie: 'Souhait du salarié', autre: 'Autre',
};
const PUBLIC_LABELS = { permanents: 'Permanents', parcours: 'Parcours', tous: 'Tous' };
const STATUT_LABELS = { identifie: 'Identifiée', planifie: 'Planifiée', realise: 'Réalisée', annule: 'Annulée' };
const STATUT_COLORS = {
  identifie: 'bg-slate-100 text-slate-600', planifie: 'bg-amber-100 text-amber-700',
  realise: 'bg-emerald-100 text-emerald-700', annule: 'bg-red-100 text-red-600',
};
const dash = (v) => (v == null || v === '' ? '—' : v);
const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');

const EMPTY = {
  annee: new Date().getFullYear(), intitule: '', type_formation: 'autre', origine_besoin: 'autre',
  public_cible: 'tous', organisme: '', statut: 'identifie', date_prevue: '', date_realisation: '',
  nb_participants_prevus: '', nb_participants_realises: '', heures_prevues: '', heures_realisees: '',
  cout_prevu: '', cout_realise: '', commentaire: '',
};

export default function PlanFormation() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const canDelete = base === 'ADMIN' || base === 'RH';

  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [statutFiltre, setStatutFiltre] = useState('');
  const [actions, setActions] = useState([]);
  const [bilan, setBilan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = statutFiltre ? `&statut=${statutFiltre}` : '';
      const [aRes, bRes] = await Promise.all([
        api.get(`/employees/formation/actions?annee=${annee}${q}`),
        api.get(`/employees/formation/bilan?annee=${annee}`),
      ]);
      setActions(aRes.data || []);
      setBilan(bRes.data || null);
    } catch (err) {
      setError(err.response?.data?.error || 'Chargement impossible');
    }
    setLoading(false);
  }, [annee, statutFiltre]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY, annee }); setModalOpen(true); };
  const openEdit = (a) => {
    setEditing(a);
    setForm({
      ...EMPTY, ...a,
      date_prevue: fmtDate(a.date_prevue) === '—' ? '' : fmtDate(a.date_prevue),
      date_realisation: fmtDate(a.date_realisation) === '—' ? '' : fmtDate(a.date_realisation),
      organisme: a.organisme || '', commentaire: a.commentaire || '',
      nb_participants_prevus: a.nb_participants_prevus ?? '', nb_participants_realises: a.nb_participants_realises ?? '',
      heures_prevues: a.heures_prevues ?? '', heures_realisees: a.heures_realisees ?? '',
      cout_prevu: a.cout_prevu ?? '', cout_realise: a.cout_realise ?? '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.intitule.trim()) { setError("L'intitulé est obligatoire"); return; }
    setSaving(true); setError(null);
    try {
      if (editing) await api.patch(`/employees/formation/actions/${editing.id}`, form);
      else await api.post('/employees/formation/actions', form);
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Enregistrement impossible');
    }
    setSaving(false);
  };

  const remove = async (a) => {
    if (!window.confirm(`Supprimer l'action « ${a.intitule} » ?`)) return;
    try { await api.delete(`/employees/formation/actions/${a.id}`); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Suppression impossible'); }
  };

  const annees = [];
  for (let y = new Date().getFullYear() + 1; y >= 2024; y--) annees.push(y);
  const eur = (v) => (v == null ? '—' : `${Math.round(Number(v)).toLocaleString('fr-FR')} €`);

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Plan de formation"
          subtitle="Besoins → planifié → réalisé (permanents et parcours) — RSEi 2.1"
          icon={GraduationCap}
        />

        <div className="flex flex-wrap items-center gap-3">
          <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))} className="input-modern text-sm">
            {annees.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)} className="input-modern text-sm">
            <option value="">Tous statuts</option>
            {Object.entries(STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RefreshCw className="w-4 h-4" strokeWidth={1.8} /> Actualiser</button>
          <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 ml-auto"><Plus className="w-4 h-4" strokeWidth={1.8} /> Nouvelle action</button>
        </div>

        {error && <ErrorState variant="card" title="Erreur" message={error} onRetry={load} />}

        {/* Bilan */}
        {bilan && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KPICard title="Actions" value={bilan.total} unit={`(${annee})`} icon={GraduationCap} accent="primary" />
            <KPICard title="Planifié → réalisé" value={`${bilan.planifiees} → ${bilan.realisees}`} icon={GraduationCap} accent="amber" />
            <KPICard
              title="Taux de réalisation"
              value={bilan.taux_realisation_pct != null ? `${bilan.taux_realisation_pct}` : '—'}
              unit={bilan.taux_realisation_pct != null ? '%' : ''}
              icon={GraduationCap} accent="emerald"
            />
            <KPICard title="Heures prév. / réal." value={`${Math.round(bilan.heures_prevues || 0)} / ${Math.round(bilan.heures_realisees || 0)}`} unit="h" icon={GraduationCap} accent="slate" />
            <KPICard title="Coût prév. / réal." value={`${eur(bilan.cout_prevu)} / ${eur(bilan.cout_realise)}`} icon={GraduationCap} accent="slate" />
          </div>
        )}
        {bilan && (
          <p className="text-xs text-slate-500 -mt-2">
            Public : {bilan.pour_permanents} action(s) pour les permanents · {bilan.pour_parcours} pour les parcours ·
            {' '}identifiées {bilan.identifiees} · annulées {bilan.annulees}.
          </p>
        )}

        <Section title={`Actions de formation ${annee}`}>
          {loading ? (
            <LoadingSpinner message="Chargement…" />
          ) : actions.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">Aucune action pour ce filtre</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-2">Intitulé</th>
                    <th className="py-2 px-2">Type</th>
                    <th className="py-2 px-2">Public</th>
                    <th className="py-2 px-2">Organisme</th>
                    <th className="py-2 px-2">Statut</th>
                    <th className="py-2 px-2 text-right">Heures p/r</th>
                    <th className="py-2 px-2 text-right">Coût p/r</th>
                    <th className="py-2 pl-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a) => (
                    <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2 pr-2">
                        <div className="font-medium text-slate-700">{a.intitule}</div>
                        <div className="text-xs text-slate-400">{ORIGINE_LABELS[a.origine_besoin] || a.origine_besoin} · prévue {fmtDate(a.date_prevue)}</div>
                      </td>
                      <td className="py-2 px-2 text-slate-600">{TYPE_LABELS[a.type_formation] || a.type_formation}</td>
                      <td className="py-2 px-2 text-slate-600">{PUBLIC_LABELS[a.public_cible] || a.public_cible}</td>
                      <td className="py-2 px-2 text-slate-600">{dash(a.organisme)}</td>
                      <td className="py-2 px-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUT_COLORS[a.statut] || 'bg-slate-100'}`}>{STATUT_LABELS[a.statut] || a.statut}</span>
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">{dash(a.heures_prevues)} / {dash(a.heures_realisees)}</td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">{a.cout_prevu != null ? eur(a.cout_prevu) : '—'} / {a.cout_realise != null ? eur(a.cout_realise) : '—'}</td>
                      <td className="py-2 pl-2 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(a)} className="text-primary hover:underline mr-3 inline-flex items-center gap-1 text-xs"><Pencil className="w-3.5 h-3.5" /> Modifier</button>
                        {canDelete && <button onClick={() => remove(a)} className="text-red-500 hover:text-red-700" title="Supprimer"><Trash2 className="w-4 h-4 inline" strokeWidth={1.8} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Modifier l'action" : 'Nouvelle action de formation'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Intitulé *</label>
            <input value={form.intitule} onChange={(e) => setForm((f) => ({ ...f, intitule: e.target.value }))} className="input-modern w-full text-sm" placeholder="Ex. Habilitation CACES R489, gestes & postures…" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Année</label>
            <input type="number" value={form.annee} onChange={(e) => setForm((f) => ({ ...f, annee: e.target.value }))} className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Statut</label>
            <select value={form.statut} onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))} className="input-modern w-full text-sm">
              {Object.entries(STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
            <select value={form.type_formation} onChange={(e) => setForm((f) => ({ ...f, type_formation: e.target.value }))} className="input-modern w-full text-sm">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Origine du besoin</label>
            <select value={form.origine_besoin} onChange={(e) => setForm((f) => ({ ...f, origine_besoin: e.target.value }))} className="input-modern w-full text-sm">
              {Object.entries(ORIGINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Public cible</label>
            <select value={form.public_cible} onChange={(e) => setForm((f) => ({ ...f, public_cible: e.target.value }))} className="input-modern w-full text-sm">
              {Object.entries(PUBLIC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Organisme</label>
            <input value={form.organisme} onChange={(e) => setForm((f) => ({ ...f, organisme: e.target.value }))} className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Date prévue</label>
            <input type="date" value={form.date_prevue} onChange={(e) => setForm((f) => ({ ...f, date_prevue: e.target.value }))} className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Date réalisée</label>
            <input type="date" value={form.date_realisation} onChange={(e) => setForm((f) => ({ ...f, date_realisation: e.target.value }))} className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Participants prévus / réalisés</label>
            <div className="flex gap-2">
              <input type="number" value={form.nb_participants_prevus} onChange={(e) => setForm((f) => ({ ...f, nb_participants_prevus: e.target.value }))} className="input-modern w-full text-sm" placeholder="prévus" />
              <input type="number" value={form.nb_participants_realises} onChange={(e) => setForm((f) => ({ ...f, nb_participants_realises: e.target.value }))} className="input-modern w-full text-sm" placeholder="réalisés" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Heures prévues / réalisées</label>
            <div className="flex gap-2">
              <input type="number" step="0.5" value={form.heures_prevues} onChange={(e) => setForm((f) => ({ ...f, heures_prevues: e.target.value }))} className="input-modern w-full text-sm" placeholder="prévues" />
              <input type="number" step="0.5" value={form.heures_realisees} onChange={(e) => setForm((f) => ({ ...f, heures_realisees: e.target.value }))} className="input-modern w-full text-sm" placeholder="réalisées" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Coût prévu / réalisé (€)</label>
            <div className="flex gap-2">
              <input type="number" step="0.01" value={form.cout_prevu} onChange={(e) => setForm((f) => ({ ...f, cout_prevu: e.target.value }))} className="input-modern w-full text-sm" placeholder="prévu" />
              <input type="number" step="0.01" value={form.cout_realise} onChange={(e) => setForm((f) => ({ ...f, cout_realise: e.target.value }))} className="input-modern w-full text-sm" placeholder="réalisé" />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Commentaire</label>
            <textarea rows={2} value={form.commentaire} onChange={(e) => setForm((f) => ({ ...f, commentaire: e.target.value }))} className="input-modern w-full text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Annuler</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </Modal>
    </Layout>
  );
}
