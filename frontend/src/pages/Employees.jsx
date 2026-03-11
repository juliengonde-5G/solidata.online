import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
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
    try {
      const [cRes, aRes] = await Promise.all([
        api.get(`/employees/${emp.id}/contracts`),
        api.get(`/employees/${emp.id}/availability`),
      ]);
      setContracts(cRes.data);
      setDaysOff(aRes.data);
    } catch (err) {
      console.error(err);
      setContracts([]);
      setDaysOff([]);
    }
  };

  const createEmployee = async (e) => {
    e.preventDefault();
    try {
      await api.post('/employees', form);
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

  const handlePhotoUpload = async (employeeId, file) => {
    const formData = new FormData();
    formData.append('photo', file);
    try {
      await api.post(`/employees/${employeeId}/photo`, formData);
      loadData();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Collaborateurs</h1>
            <p className="text-gray-500">{employees.length} collaborateur{employees.length > 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
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
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Collaborateur</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Équipe</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Poste</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Contrat</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Heures/sem</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Statut</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(emp)}>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-solidata-green/20 text-solidata-green flex items-center justify-center text-xs font-bold">
                        {emp.first_name?.[0]}{emp.last_name?.[0]}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{emp.first_name} {emp.last_name}</p>
                        {emp.email && <p className="text-xs text-gray-400">{emp.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-sm">{emp.team_name || '—'}</td>
                  <td className="p-3 text-sm">{emp.position_name || '—'}</td>
                  <td className="p-3">
                    <span className="px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700">
                      {CONTRACT_LABELS[emp.contract_type] || emp.contract_type || '—'}
                    </span>
                  </td>
                  <td className="p-3 text-sm">{emp.weekly_hours || 35}h</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${emp.is_active !== false ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {emp.is_active !== false ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan="6" className="p-8 text-center text-gray-400">Aucun collaborateur</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setSelected(null)}>
            <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 bg-white border-b px-5 py-3 z-10 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-solidata-green to-emerald-600 text-white flex items-center justify-center text-lg font-bold">
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
                ].map(t => (
                  <button key={t.key} onClick={() => setDetailTab(t.key)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
                      detailTab === t.key ? 'border-solidata-green text-solidata-green' : 'border-transparent text-gray-500'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {/* Info tab */}
                {detailTab === 'info' && (
                  <div className="space-y-3 text-sm">
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
                    {selected.hire_date && <Field label="Date d'embauche" value={new Date(selected.hire_date).toLocaleDateString('fr-FR')} />}
                    <div className="mt-4">
                      <label className="text-xs text-gray-500 block mb-1">Photo</label>
                      <input type="file" accept="image/*" onChange={e => e.target.files[0] && handlePhotoUpload(selected.id, e.target.files[0])} className="text-xs" />
                    </div>
                  </div>
                )}

                {/* Contracts tab */}
                {detailTab === 'contracts' && (
                  <div className="space-y-4">
                    <button onClick={() => setShowContractForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-solidata-green-dark">
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
                          <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">Ajouter</button>
                        </div>
                      </form>
                    )}

                    {/* Contracts list */}
                    <div className="space-y-2">
                      {contracts.map(c => (
                        <div key={c.id} className={`border rounded-xl p-4 text-sm ${c.is_current ? 'border-solidata-green bg-solidata-green/5' : 'border-gray-200'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${c.is_current ? 'bg-solidata-green text-white' : 'bg-gray-100 text-gray-600'}`}>
                                {CONTRACT_LABELS[c.contract_type] || c.contract_type}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded ${c.origin === 'embauche' ? 'bg-blue-50 text-blue-600' : 'bg-yellow-50 text-yellow-600'}`}>
                                {c.origin === 'embauche' ? 'Embauche' : 'Renouvellement'}
                              </span>
                              {c.is_current && <span className="text-xs text-solidata-green font-medium">En cours</span>}
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
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">Créer</button>
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
