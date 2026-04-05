import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, DataTable, StatusBadge } from '../components';
import { Users } from 'lucide-react';
import api from '../services/api';

const CONTRACT_LABELS = {
  CDI: 'CDI', CDD: 'CDD', interim: 'Intérim', stage: 'Stage', apprentissage: 'Apprentissage',
};

const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState({ team_id: '', search: '' });
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    position_id: '', team_id: '', contract_type: 'CDI', hire_date: '',
  });

  // Detail tabs
  const [detailTab, setDetailTab] = useState('info');
  const [contracts, setContracts] = useState([]);
  const [daysOff, setDaysOff] = useState([]);
  const [showContractForm, setShowContractForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState('');
  const [pcmProfile, setPcmProfile] = useState(null);
  const [candidateData, setCandidateData] = useState(null);
  const [saving, setSaving] = useState(false);
  const firstInputRef = useRef(null);
  const [contractForm, setContractForm] = useState({
    contract_type: 'CDI', duration_months: '', start_date: '', end_date: '',
    weekly_hours: 35, team_id: '', position_id: '',
  });

  useEffect(() => { loadData(); }, [filter.team_id]);

  const loadData = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.team_id) params.append('team_id', filter.team_id);
      if (filter.search) params.append('search', filter.search);
      const [empRes, teamRes, posRes] = await Promise.all([
        api.get(`/employees?${params}`),
        api.get('/teams'),
        api.get('/referentiels/positions').catch(() => ({ data: [] })),
      ]);
      setEmployees(empRes.data);
      setTeams(teamRes.data);
      setPositions(posRes.data || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const openDetail = async (emp) => {
    setSelected(emp);
    setDetailTab('info');
    setShowContractForm(false);
    setEditingEmployee(false);
    setEditForm({
      first_name: emp.first_name || '',
      last_name: emp.last_name || '',
      email: emp.email || '',
      phone: emp.phone || '',
      team_id: emp.team_id || '',
      position: emp.position || '',
      contract_type: emp.contract_type || 'CDI',
      contract_start: emp.contract_start ? emp.contract_start.slice(0, 10) : '',
      contract_end: emp.contract_end ? emp.contract_end.slice(0, 10) : '',
      weekly_hours: emp.weekly_hours ?? 35,
      is_active: emp.is_active !== false,
    });
    try {
      const [cRes, aRes] = await Promise.all([
        api.get(`/employees/${emp.id}/contracts`),
        api.get(`/employees/${emp.id}/availability`),
      ]);
      setContracts(cRes.data);
      setDaysOff(aRes.data);
      // Charger le profil PCM et les données candidat si lié
      if (emp.candidate_id) {
        api.get(`/pcm/profiles/${emp.candidate_id}`).then(r => setPcmProfile(r.data)).catch(() => setPcmProfile(null));
        api.get(`/candidates/${emp.candidate_id}`).then(r => setCandidateData(r.data)).catch(() => setCandidateData(null));
      } else {
        setPcmProfile(null);
        setCandidateData(null);
      }
    } catch (err) {
      console.error(err);
      setContracts([]);
      setDaysOff([]);
      setPcmProfile(null);
    }
  };

  const createEmployee = async (e) => {
    e.preventDefault();
    try {
      const selectedPosition = positions.find(p => String(p.id) === String(form.position_id));
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email || null,
        phone: form.phone || null,
        team_id: form.team_id ? Number(form.team_id) : null,
        position: selectedPosition ? (selectedPosition.title || selectedPosition.name) : null,
        contract_type: form.contract_type || 'CDI',
        contract_start: form.hire_date || null,
      };
      await api.post('/employees', payload);
      setShowForm(false);
      setForm({ first_name: '', last_name: '', email: '', phone: '', position_id: '', team_id: '', contract_type: 'CDI', hire_date: '' });
      loadData();
    } catch (err) { console.error(err); }
  };

  const addContract = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/employees/${selected.id}/contracts`, contractForm);
      setShowContractForm(false);
      setContractForm({ contract_type: 'CDI', duration_months: '', start_date: '', end_date: '', weekly_hours: 35, team_id: '', position_id: '' });
      const cRes = await api.get(`/employees/${selected.id}/contracts`);
      setContracts(cRes.data);
      loadData();
    } catch (err) { console.error(err); }
  };

  const toggleDayOff = async (day) => {
    const newDays = daysOff.includes(day) ? daysOff.filter(d => d !== day) : [...daysOff, day];
    setDaysOff(newDays);
    try {
      await api.put(`/employees/${selected.id}/availability`, { days_off: newDays });
    } catch (err) { console.error(err); }
  };

  const updateEmployee = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selected) return;
    setEditError('');
    const firstName = (editForm.first_name || '').trim();
    const lastName = (editForm.last_name || '').trim();
    if (!firstName || !lastName) {
      setEditError('Le prénom et le nom sont obligatoires.');
      firstInputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const payload = {
        first_name: firstName,
        last_name: lastName,
        email: (editForm.email || '').trim() || null,
        phone: (editForm.phone || '').trim() || null,
        team_id: editForm.team_id ? Number(editForm.team_id) : null,
        position: (editForm.position || '').trim() || null,
        contract_type: editForm.contract_type || null,
        contract_start: editForm.contract_start || null,
        contract_end: editForm.contract_end || null,
        weekly_hours: editForm.weekly_hours != null && editForm.weekly_hours !== '' ? Number(editForm.weekly_hours) : 35,
        is_active: editForm.is_active,
      };
      const res = await api.put(`/employees/${selected.id}`, payload);
      setSelected({ ...selected, ...res.data, team_name: teams.find(t => t.id === res.data.team_id)?.name });
      setEditingEmployee(false);
      loadData();
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.error || err.message || 'Erreur lors de l\'enregistrement';
      setEditError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (employeeId, file) => {
    const formData = new FormData();
    formData.append('photo', file);
    try {
      await api.post(`/employees/${employeeId}/photo`, formData);
      loadData();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des employés..." /></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Collaborateurs</h1>
            <p className="text-gray-500">{employees.length} collaborateur{employees.length > 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
            + Nouveau collaborateur
          </button>
        </div>

        {/* Filtres */}
        <div className="flex gap-3 mb-4">
          <input placeholder="Rechercher..." value={filter.search}
            onChange={e => setFilter({ ...filter, search: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && loadData()}
            className="border rounded-lg px-3 py-2 text-sm w-64" />
          <select value={filter.team_id} onChange={e => setFilter({ ...filter, team_id: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Toutes les équipes</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {/* Table */}
        <DataTable
          columns={[
            { key: 'name', label: 'Collaborateur', sortable: true, render: (emp) => (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                  {emp.first_name?.[0]}{emp.last_name?.[0]}
                </div>
                <div>
                  <p className="font-medium text-sm">{emp.first_name} {emp.last_name}</p>
                  {emp.email && <p className="text-xs text-gray-400">{emp.email}</p>}
                </div>
              </div>
            )},
            { key: 'team_name', label: 'Équipe', sortable: true, render: (emp) => emp.team_name || '—' },
            { key: 'position_name', label: 'Poste', sortable: true, render: (emp) => emp.position_name || '—' },
            { key: 'contract_type', label: 'Contrat', render: (emp) => (
              <span className="px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700">
                {CONTRACT_LABELS[emp.contract_type] || emp.contract_type || '—'}
              </span>
            )},
            { key: 'weekly_hours', label: 'Heures/sem', render: (emp) => `${emp.weekly_hours || 35}h` },
            { key: 'is_active', label: 'Statut', render: (emp) => <StatusBadge status={emp.is_active !== false ? 'active' : 'inactive'} size="sm" /> },
          ]}
          data={employees}
          loading={false}
          onRowClick={openDetail}
          emptyIcon={Users}
          emptyMessage="Aucun collaborateur"
        />

        {/* Detail Panel */}
        {selected && (
          <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setSelected(null)}>
            <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 bg-white border-b px-5 py-3 z-10 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-emerald-600 text-white flex items-center justify-center text-lg font-bold">
                    {selected.first_name?.[0]}{selected.last_name?.[0]}
                  </div>
                  <div>
                    <h2 className="font-bold text-lg">{selected.first_name} {selected.last_name}</h2>
                    <p className="text-sm text-gray-500">{selected.position_name || 'Poste non défini'}</p>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
              </div>

              {/* Tabs */}
              <div className="flex border-b px-5">
                {[
                  { key: 'info', label: 'Informations' },
                  { key: 'contracts', label: 'Contrats' },
                  { key: 'availability', label: 'Disponibilités' },
                  { key: 'pcm', label: 'Profil PCM' },
                ].map(t => (
                  <button key={t.key} onClick={() => setDetailTab(t.key)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
                      detailTab === t.key ? 'border-primary text-primary' : 'border-transparent text-gray-500'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {/* Info tab */}
                {detailTab === 'info' && (
                  <div className="space-y-3 text-sm">
                    {!editingEmployee ? (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Prénom" value={selected.first_name} />
                          <Field label="Nom" value={selected.last_name} />
                          <Field label="Email" value={selected.email} />
                          <Field label="Téléphone" value={selected.phone} />
                          <Field label="Équipe" value={selected.team_name} />
                          <Field label="Contrat" value={CONTRACT_LABELS[selected.contract_type] || selected.contract_type} />
                          <Field label="Heures/sem" value={selected.weekly_hours ? `${selected.weekly_hours}h` : null} />
                          <Field label="Matricule" value={selected.matricule} />
                        </div>
                        {(selected.contract_start || selected.hire_date) && (
                          <Field label="Date d'embauche" value={new Date(selected.contract_start || selected.hire_date).toLocaleDateString('fr-FR')} />
                        )}
                        {candidateData?.cv_file_path && (
                          <div className="mt-3">
                            <label className="text-xs text-gray-500 block mb-1">CV du candidat</label>
                            <a href={`/api/candidates/${selected.candidate_id}/download-cv`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              Telecharger le CV
                            </a>
                          </div>
                        )}
                        <div className="mt-4">
                          <label className="text-xs text-gray-500 block mb-1">Photo</label>
                          <input type="file" accept="image/*" onChange={e => e.target.files[0] && handlePhotoUpload(selected.id, e.target.files[0])} className="text-xs" />
                        </div>
                        <p className="text-xs text-gray-400 mt-2">En mode modification, le prénom et le nom sont obligatoires pour enregistrer.</p>
                        <button type="button" onClick={() => { setEditingEmployee(true); setEditError(''); }} className="mt-2 w-full btn-primary text-sm">
                          Modifier
                        </button>
                      </>
                    ) : (
                      <form id="employee-edit-form" onSubmit={updateEmployee} noValidate className="space-y-3">
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm text-amber-800">
                          <strong>Champs obligatoires :</strong> Prénom et Nom (marqués <span className="text-red-600 font-semibold">*</span>). Les autres champs sont facultatifs.
                        </div>
                        {editError && (
                          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                            <span className="flex-shrink-0">⚠</span>
                            <span>{editError}</span>
                            <button type="button" onClick={() => setEditError('')} className="ml-auto text-red-500 hover:text-red-700" aria-label="Fermer">×</button>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-gray-700 text-xs font-medium">Prénom <span className="text-red-500" aria-hidden="true">*</span></label>
                            <input ref={firstInputRef} value={editForm.first_name} onChange={e => { setEditForm({ ...editForm, first_name: e.target.value }); setEditError(''); }} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="Obligatoire" aria-required="true" />
                          </div>
                          <div>
                            <label className="text-gray-700 text-xs font-medium">Nom <span className="text-red-500" aria-hidden="true">*</span></label>
                            <input value={editForm.last_name} onChange={e => { setEditForm({ ...editForm, last_name: e.target.value }); setEditError(''); }} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="Obligatoire" aria-required="true" />
                          </div>
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs">Email</label>
                          <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs">Téléphone</label>
                          <input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs">Équipe</label>
                          <select value={editForm.team_id} onChange={e => setEditForm({ ...editForm, team_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                            <option value="">—</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs">Poste</label>
                          <input value={editForm.position} onChange={e => setEditForm({ ...editForm, position: e.target.value })} placeholder="Ex: Chauffeur" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-gray-500 text-xs">Type de contrat</label>
                            <select value={editForm.contract_type} onChange={e => setEditForm({ ...editForm, contract_type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                              {Object.entries(CONTRACT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-gray-500 text-xs">Heures/sem</label>
                            <input type="number" min="0" step="0.5" value={editForm.weekly_hours} onChange={e => setEditForm({ ...editForm, weekly_hours: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-gray-500 text-xs">Début contrat</label>
                            <input type="date" value={editForm.contract_start} onChange={e => setEditForm({ ...editForm, contract_start: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                          </div>
                          <div>
                            <label className="text-gray-500 text-xs">Fin contrat</label>
                            <input type="date" value={editForm.contract_end} onChange={e => setEditForm({ ...editForm, contract_end: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" id="emp-active" checked={editForm.is_active} onChange={e => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded" />
                          <label htmlFor="emp-active" className="text-sm">Actif</label>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <button type="button" onClick={() => setEditingEmployee(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                          <button type="submit" form="employee-edit-form" disabled={saving} onClick={e => e.stopPropagation()} className="flex-1 btn-primary text-sm">
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* Contracts tab */}
                {detailTab === 'contracts' && (
                  <div className="space-y-4">
                    <button onClick={() => setShowContractForm(true)} className="btn-primary text-sm">
                      + Nouveau contrat
                    </button>

                    {showContractForm && (
                      <form onSubmit={addContract} className="bg-gray-50 rounded-xl p-4 space-y-3 border">
                        <p className="text-xs font-semibold text-gray-500 uppercase">Nouveau contrat</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-gray-500 text-xs">Type *</span>
                            <select value={contractForm.contract_type} onChange={e => setContractForm({...contractForm, contract_type: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                              {Object.entries(CONTRACT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Durée (mois)</span>
                            <input type="number" placeholder="Durée" value={contractForm.duration_months} onChange={e => setContractForm({...contractForm, duration_months: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-gray-500 text-xs">Date début *</span>
                            <input type="date" value={contractForm.start_date} onChange={e => setContractForm({...contractForm, start_date: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" required />
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Date fin</span>
                            <input type="date" value={contractForm.end_date} onChange={e => setContractForm({...contractForm, end_date: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-gray-500 text-xs">Temps de travail</span>
                            <select value={contractForm.weekly_hours} onChange={e => setContractForm({...contractForm, weekly_hours: parseInt(e.target.value)})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                              <option value={26}>26h/semaine</option>
                              <option value={35}>35h/semaine</option>
                            </select>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Équipe</span>
                            <select value={contractForm.team_id} onChange={e => setContractForm({...contractForm, team_id: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                              <option value="">—</option>
                              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Poste</span>
                          <select value={contractForm.position_id} onChange={e => setContractForm({...contractForm, position_id: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                            <option value="">—</option>
                            {positions.map(p => <option key={p.id} value={p.id}>{p.name || p.title}</option>)}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setShowContractForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                          <button type="submit" className="flex-1 btn-primary text-sm">Ajouter</button>
                        </div>
                      </form>
                    )}

                    {/* Contracts list */}
                    <div className="space-y-2">
                      {contracts.map(c => (
                        <div key={c.id} className={`border rounded-xl p-4 text-sm ${c.is_current ? 'border-primary bg-primary/5' : 'border-gray-200'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${c.is_current ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
                                {CONTRACT_LABELS[c.contract_type] || c.contract_type}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded ${c.origin === 'embauche' ? 'bg-blue-50 text-blue-600' : 'bg-yellow-50 text-yellow-600'}`}>
                                {c.origin === 'embauche' ? 'Embauche' : 'Renouvellement'}
                              </span>
                              {c.is_current && <span className="text-xs text-primary font-medium">En cours</span>}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                            <div>Début : <strong>{new Date(c.start_date).toLocaleDateString('fr-FR')}</strong></div>
                            {c.end_date && <div>Fin : <strong>{new Date(c.end_date).toLocaleDateString('fr-FR')}</strong></div>}
                            {c.duration_months && <div>Durée : <strong>{c.duration_months} mois</strong></div>}
                            <div>Temps : <strong>{c.weekly_hours}h/sem</strong></div>
                            {c.team_name && <div>Équipe : <strong>{c.team_name}</strong></div>}
                            {c.position_title && <div>Poste : <strong>{c.position_title}</strong></div>}
                          </div>
                        </div>
                      ))}
                      {contracts.length === 0 && <p className="text-gray-400 text-sm">Aucun contrat enregistré</p>}
                    </div>
                  </div>
                )}

                {/* Availability tab */}
                {detailTab === 'pcm' && (
                  <div className="space-y-3 text-sm">
                    {!selected.candidate_id ? (
                      <p className="text-gray-500 italic">Cet employé n'est pas lié à un candidat. Pas de profil PCM disponible.</p>
                    ) : !pcmProfile ? (
                      <p className="text-gray-500 italic">Aucun profil PCM enregistré pour ce candidat.</p>
                    ) : (
                      <>
                        <div className="bg-purple-50 rounded-lg p-3">
                          <p className="font-semibold text-purple-800 mb-1">Type de base</p>
                          <p className="text-lg font-bold text-purple-900 capitalize">{pcmProfile.baseType || pcmProfile.base_type || '—'}</p>
                        </div>
                        {pcmProfile.phaseType && (
                          <div className="bg-blue-50 rounded-lg p-3">
                            <p className="font-semibold text-blue-800 mb-1">Phase actuelle</p>
                            <p className="text-lg font-bold text-blue-900 capitalize">{pcmProfile.phaseType || pcmProfile.phase_type}</p>
                          </div>
                        )}
                        {pcmProfile.report?.scores && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Scores PCM</p>
                            <div className="grid grid-cols-2 gap-2">
                              {Object.entries(pcmProfile.report.scores).map(([type, score]) => (
                                <div key={type} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5">
                                  <span className="text-sm capitalize">{type}</span>
                                  <span className="font-bold">{score}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {pcmProfile.riskAlert && (
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                            <p className="font-semibold text-orange-800 text-xs">Alerte RPS detectee — un suivi est recommande</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {detailTab === 'availability' && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-500">Jours d'indisponibilité hebdomadaire :</p>
                    <div className="grid grid-cols-2 gap-2">
                      {DAYS.map(day => (
                        <button
                          key={day}
                          onClick={() => toggleDayOff(day)}
                          className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition ${
                            daysOff.includes(day)
                              ? 'border-red-400 bg-red-50 text-red-700'
                              : 'border-green-300 bg-green-50 text-green-700'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full ${daysOff.includes(day) ? 'bg-red-400' : 'bg-green-400'}`} />
                          <span className="capitalize">{day}</span>
                          <span className="ml-auto text-xs">{daysOff.includes(day) ? 'Indisponible' : 'Disponible'}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400">Cliquez sur un jour pour basculer la disponibilité. Les changements sont sauvegardés automatiquement.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* New Employee Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
            <form onSubmit={createEmployee} className="bg-white rounded-xl p-6 w-[440px] shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-4">Nouveau collaborateur</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Prénom *" value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" required />
                  <input placeholder="Nom *" value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" required />
                </div>
                <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Téléphone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <select value={form.team_id} onChange={e => setForm({ ...form, team_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">Équipe</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select value={form.position_id} onChange={e => setForm({ ...form, position_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">Poste</option>
                  {positions.map(p => <option key={p.id} value={p.id}>{p.name || p.title}</option>)}
                </select>
                <select value={form.contract_type} onChange={e => setForm({ ...form, contract_type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  {Object.entries(CONTRACT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div>
                  <label className="text-xs text-gray-500">Date d'embauche</label>
                  <input type="date" value={form.hire_date} onChange={e => setForm({ ...form, hire_date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <span className="text-gray-500 text-xs">{label}</span>
      <p className="font-medium">{value || '—'}</p>
    </div>
  );
}
