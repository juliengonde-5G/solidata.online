import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { LoadingSpinner, DataTable, StatusBadge, Modal, PageHeader, Section, ErrorState } from '../components';
import { Users } from 'lucide-react';
import useAsyncData from '../hooks/useAsyncData';
import api from '../services/api';
import AlertesBloc from '../components/insertion/AlertesBloc';
import ObjectifsPanel from '../components/insertion/ObjectifsPanel';
import ActionsPanel from '../components/insertion/ActionsPanel';
import FriseParcours from '../components/insertion/FriseParcours';
import CompetencesETI from '../components/insertion/CompetencesETI';
import ChecklistEmbauche from '../components/insertion/ChecklistEmbauche';
import {
  ENTRETIEN_STATUS_LABELS, ENTRETIEN_STATUS_COLORS, frDate as frDateIns,
} from '../components/insertion/freins';

const CONTRACT_LABELS = {
  CDI: 'CDI', CDD: 'CDD', CDDI: 'CDDI', interim: 'Intérim', stage: 'Stage', apprentissage: 'Apprentissage',
};

// Badge de durée cumulée CDDI (plafond légal 24 mois) : ambre ≥ 20, rouge ≥ 23.
function CddiBadge({ data }) {
  if (!data || !data.is_cddi) return null;
  const m = data.months_total ?? 0;
  const tone = m >= 23 ? 'bg-red-100 text-red-700 border-red-200'
    : m >= 20 ? 'bg-amber-100 text-amber-800 border-amber-200'
    : 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Durée cumulée CDDI</span>
        <span className="font-semibold">{m} / {data.cap_months} mois</span>
      </div>
      <p className="text-xs mt-0.5 opacity-90">
        {m >= 23 ? '⚠ Plafond légal 24 mois quasi atteint — vérifier une éventuelle dérogation.'
          : m >= 20 ? 'Approche du plafond légal (24 mois).'
          : `Écoulé : ${data.months_elapsed} mois · reste ~${data.remaining_months} mois avant le plafond.`}
      </p>
    </div>
  );
}

const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export default function Employees() {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState({ team_id: '', search: '' });

  // Liaison fiche de recrutement (candidat) ↔ ce collaborateur
  const [linkCandidateOpen, setLinkCandidateOpen] = useState(false);

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
  const [cddiDuration, setCddiDuration] = useState(null);
  const [saving, setSaving] = useState(false);
  const firstInputRef = useRef(null);
  const [contractForm, setContractForm] = useState({
    contract_type: 'CDI', duration_months: '', start_date: '', end_date: '',
    weekly_hours: 35, team_id: '', position_id: '',
  });

  // Pattern useAsyncData (cf docs/UX_PATTERNS.md)
  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter.team_id) params.append('team_id', filter.team_id);
    if (filter.search) params.append('search', filter.search);
    const [empRes, teamRes, posRes, prescRes] = await Promise.all([
      api.get(`/employees?${params}`),
      api.get('/teams'),
      api.get('/referentiels/positions').catch(() => ({ data: [] })),
      api.get('/prescripteurs').catch(() => ({ data: [] })),
    ]);
    return {
      employees: empRes.data || [],
      teams: teamRes.data || [],
      positions: posRes.data || [],
      prescripteurs: prescRes.data || [],
    };
  }, [filter.team_id, filter.search]);
  const { data, loading, error, reload: loadData } = useAsyncData(fetchData, {
    initialData: { employees: [], teams: [], positions: [], prescripteurs: [] },
  });
  const { employees = [], teams = [], positions = [], prescripteurs = [] } = data || {};

  // Collaborateurs dont le contrat se termine sous 60 jours (encart RH — item 41b).
  const endingSoon = employees.filter((e) => {
    if (e.is_active === false || !e.contract_end) return false;
    const end = new Date(e.contract_end);
    if (isNaN(end)) return false;
    const days = Math.ceil((end - new Date()) / 86400000);
    return days >= 0 && days <= 60;
  }).sort((a, b) => new Date(a.contract_end) - new Date(b.contract_end));

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
      // Champs étendus (import Malibou) — édition complète de la fiche
      malibou_id: emp.malibou_id || '',
      birth_name: emp.birth_name || '',
      civility: emp.civility || '',
      gender: emp.gender || '',
      birth_date: emp.birth_date ? emp.birth_date.slice(0, 10) : '',
      birth_city: emp.birth_city || '',
      birth_country: emp.birth_country || '',
      nationality: emp.nationality || '',
      personal_email: emp.personal_email || '',
      address: emp.address || '',
      postal_code: emp.postal_code || '',
      city: emp.city || '',
      country: emp.country || '',
      qualification: emp.qualification || '',
      disability_status: emp.disability_status || '',
      residence_permit_type: emp.residence_permit_type || '',
      residence_permit_number: emp.residence_permit_number || '',
      seniority_date: emp.seniority_date ? emp.seniority_date.slice(0, 10) : '',
      visite_medicale_date: emp.visite_medicale_date ? emp.visite_medicale_date.slice(0, 10) : '',
      prescripteur: emp.prescripteur || '',
      prescripteur_id: emp.prescripteur_id || '',
      date_prescription: emp.date_prescription ? emp.date_prescription.slice(0, 10) : '',
      has_permis_b: emp.has_permis_b === true,
      has_caces: emp.has_caces === true,
    });
    setCddiDuration(null);
    try {
      const [cRes, aRes] = await Promise.all([
        api.get(`/employees/${emp.id}/contracts`),
        api.get(`/employees/${emp.id}/availability`),
      ]);
      setContracts(cRes.data);
      setDaysOff(aRes.data);
      // Durée cumulée CDDI (plafond 24 mois) — chargée seulement si pertinent.
      api.get(`/employees/${emp.id}/cddi-duration`).then(r => setCddiDuration(r.data)).catch(() => setCddiDuration(null));
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

  // Rattache CE collaborateur à une fiche de recrutement (candidat) existante.
  // Réutilise l'endpoint candidat (POST /candidates/:candidateId/link-employee).
  const linkCandidate = async (candidateId) => {
    try {
      await api.post(`/candidates/${candidateId}/link-employee`, { employee_id: selected.id });
      setLinkCandidateOpen(false);
      setSelected(prev => ({ ...prev, candidate_id: candidateId }));
      loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la liaison');
    }
  };

  const unlinkCandidate = async () => {
    if (!selected?.candidate_id) return;
    try {
      await api.post(`/candidates/${selected.candidate_id}/unlink-employee`);
      setSelected(prev => ({ ...prev, candidate_id: null }));
      setPcmProfile(null);
      setCandidateData(null);
      loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors du retrait du lien');
    }
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
      const clean = (v) => { const s = (v || '').toString().trim(); return s || null; };
      const payload = {
        first_name: firstName,
        last_name: lastName,
        email: clean(editForm.email),
        phone: clean(editForm.phone),
        team_id: editForm.team_id ? Number(editForm.team_id) : null,
        position: clean(editForm.position),
        contract_type: editForm.contract_type || null,
        contract_start: editForm.contract_start || null,
        contract_end: editForm.contract_end || null,
        weekly_hours: editForm.weekly_hours != null && editForm.weekly_hours !== '' ? Number(editForm.weekly_hours) : 35,
        is_active: editForm.is_active,
        // Champs étendus
        malibou_id: clean(editForm.malibou_id),
        birth_name: clean(editForm.birth_name),
        civility: clean(editForm.civility),
        gender: clean(editForm.gender),
        birth_date: editForm.birth_date || null,
        birth_city: clean(editForm.birth_city),
        birth_country: clean(editForm.birth_country),
        nationality: clean(editForm.nationality),
        personal_email: clean(editForm.personal_email),
        address: clean(editForm.address),
        postal_code: clean(editForm.postal_code),
        city: clean(editForm.city),
        country: clean(editForm.country),
        qualification: clean(editForm.qualification),
        disability_status: clean(editForm.disability_status),
        residence_permit_type: clean(editForm.residence_permit_type),
        residence_permit_number: clean(editForm.residence_permit_number),
        seniority_date: editForm.seniority_date || null,
        visite_medicale_date: editForm.visite_medicale_date || null,
        prescripteur: clean(editForm.prescripteur),
        prescripteur_id: editForm.prescripteur_id ? Number(editForm.prescripteur_id) : null,
        date_prescription: editForm.date_prescription || null,
        has_permis_b: editForm.has_permis_b === true,
        has_caces: editForm.has_caces === true,
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
  if (error) return <Layout><div className="p-6"><ErrorState title="Impossible de charger les employés" onRetry={loadData} variant="card" /></div></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Collaborateurs"
          subtitle={`${employees.length} collaborateur${employees.length > 1 ? 's' : ''}`}
          icon={Users}
          actions={
            <span className="text-xs text-slate-400 max-w-[240px] text-right hidden sm:block">
              Les collaborateurs sont créés via la synchronisation RH (import du logiciel de paye).
            </span>
          }
        />

        {endingSoon.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
              <span>⏳</span> Contrats se terminant sous 60 jours ({endingSoon.length})
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {endingSoon.map((e) => {
                const days = Math.ceil((new Date(e.contract_end) - new Date()) / 86400000);
                return (
                  <button key={e.id} onClick={() => openDetail(e)}
                    className="text-left rounded-lg bg-white border border-amber-200 px-3 py-1.5 text-xs hover:border-amber-400">
                    <span className="font-medium">{e.first_name} {e.last_name}</span>
                    <span className="text-amber-700"> · fin {new Date(e.contract_end).toLocaleDateString('fr-FR')} ({days} j)</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Section title="Liste">
          <div className="flex gap-3 mb-4">
            <input placeholder="Rechercher..." value={filter.search}
              onChange={e => setFilter({ ...filter, search: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && loadData()}
              className="input-modern w-64" />
            <select value={filter.team_id} onChange={e => setFilter({ ...filter, team_id: e.target.value })} className="select-modern w-auto">
              <option value="">Toutes les équipes</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

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
            { key: 'position_name', label: 'Poste', sortable: true, render: (emp) => emp.position_name || emp.position || '—' },
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
        </Section>

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
              <div className="flex border-b px-5 overflow-x-auto">
                {[
                  { key: 'info', label: 'Informations' },
                  { key: 'contracts', label: 'Contrats' },
                  { key: 'availability', label: 'Disponibilités' },
                  { key: 'pcm', label: 'Profil PCM' },
                  { key: 'insertion', label: 'Parcours insertion' },
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
                          <Field label="Matricule" value={selected.malibou_id} />
                        </div>
                        {(selected.contract_start || selected.hire_date) && (
                          <Field label="Date d'embauche" value={new Date(selected.contract_start || selected.hire_date).toLocaleDateString('fr-FR')} />
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {selected.has_permis_b && <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700">🚗 Permis B</span>}
                          {selected.has_caces && <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700">🏗️ CACES</span>}
                          {(() => {
                            const p = prescripteurs.find(x => String(x.id) === String(selected.prescripteur_id));
                            const name = p ? `${p.nom}${p.type ? ` (${p.type})` : ''}` : selected.prescripteur;
                            return name ? <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700">Prescripteur : {name}</span> : null;
                          })()}
                        </div>
                        {cddiDuration?.is_cddi && <div className="mt-2"><CddiBadge data={cddiDuration} /></div>}
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
                            <input ref={firstInputRef} value={editForm.first_name} onChange={e => { setEditForm({ ...editForm, first_name: e.target.value }); setEditError(''); }} className="input-modern mt-1" placeholder="Obligatoire" aria-required="true" />
                          </div>
                          <div>
                            <label className="text-gray-700 text-xs font-medium">Nom <span className="text-red-500" aria-hidden="true">*</span></label>
                            <input value={editForm.last_name} onChange={e => { setEditForm({ ...editForm, last_name: e.target.value }); setEditError(''); }} className="input-modern mt-1" placeholder="Obligatoire" aria-required="true" />
                          </div>
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs">Email</label>
                          <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="input-modern mt-1" />
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs">Téléphone</label>
                          <input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} className="input-modern mt-1" />
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs">Équipe</label>
                          <select value={editForm.team_id} onChange={e => setEditForm({ ...editForm, team_id: e.target.value })} className="input-modern mt-1">
                            <option value="">—</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs">Poste</label>
                          <input value={editForm.position} onChange={e => setEditForm({ ...editForm, position: e.target.value })} placeholder="Ex: Chauffeur" className="input-modern mt-1" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-gray-500 text-xs">Type de contrat</label>
                            <select value={editForm.contract_type} onChange={e => setEditForm({ ...editForm, contract_type: e.target.value })} className="input-modern mt-1">
                              {Object.entries(CONTRACT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-gray-500 text-xs">Heures/sem</label>
                            <input type="number" min="0" step="0.5" value={editForm.weekly_hours} onChange={e => setEditForm({ ...editForm, weekly_hours: e.target.value })} className="input-modern mt-1" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-gray-500 text-xs">Début contrat</label>
                            <input type="date" value={editForm.contract_start} onChange={e => setEditForm({ ...editForm, contract_start: e.target.value })} className="input-modern mt-1" />
                          </div>
                          <div>
                            <label className="text-gray-500 text-xs">Fin contrat</label>
                            <input type="date" value={editForm.contract_end} onChange={e => setEditForm({ ...editForm, contract_end: e.target.value })} className="input-modern mt-1" />
                          </div>
                        </div>
                        <details className="rounded-lg border border-slate-200 bg-slate-50/50">
                          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            Informations détaillées (identité, coordonnées, IAE)
                          </summary>
                          <div className="p-3 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-gray-500 text-xs">Matricule (Malibou)</label>
                                <input value={editForm.malibou_id} onChange={e => setEditForm({ ...editForm, malibou_id: e.target.value })} className="input-modern mt-1" />
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">Nom de naissance</label>
                                <input value={editForm.birth_name} onChange={e => setEditForm({ ...editForm, birth_name: e.target.value })} className="input-modern mt-1" />
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">Civilité</label>
                                <select value={editForm.civility} onChange={e => setEditForm({ ...editForm, civility: e.target.value })} className="input-modern mt-1">
                                  <option value="">—</option>
                                  <option value="M.">M.</option>
                                  <option value="Mme">Mme</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">Sexe</label>
                                <select value={editForm.gender} onChange={e => setEditForm({ ...editForm, gender: e.target.value })} className="input-modern mt-1">
                                  <option value="">—</option>
                                  <option value="F">Féminin</option>
                                  <option value="M">Masculin</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="text-gray-500 text-xs">Email personnel</label>
                              <input type="email" value={editForm.personal_email} onChange={e => setEditForm({ ...editForm, personal_email: e.target.value })} className="input-modern mt-1" />
                            </div>
                            <div>
                              <label className="text-gray-500 text-xs">Adresse</label>
                              <input value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} className="input-modern mt-1" />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="text-gray-500 text-xs">Code postal</label>
                                <input value={editForm.postal_code} onChange={e => setEditForm({ ...editForm, postal_code: e.target.value })} className="input-modern mt-1" />
                              </div>
                              <div className="col-span-2">
                                <label className="text-gray-500 text-xs">Ville</label>
                                <input value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })} className="input-modern mt-1" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-gray-500 text-xs">Date de naissance</label>
                                <input type="date" value={editForm.birth_date} onChange={e => setEditForm({ ...editForm, birth_date: e.target.value })} className="input-modern mt-1" />
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">Nationalité</label>
                                <input value={editForm.nationality} onChange={e => setEditForm({ ...editForm, nationality: e.target.value })} className="input-modern mt-1" />
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">Ville de naissance</label>
                                <input value={editForm.birth_city} onChange={e => setEditForm({ ...editForm, birth_city: e.target.value })} className="input-modern mt-1" />
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">Pays de naissance</label>
                                <input value={editForm.birth_country} onChange={e => setEditForm({ ...editForm, birth_country: e.target.value })} className="input-modern mt-1" />
                              </div>
                            </div>
                            <div>
                              <label className="text-gray-500 text-xs">Qualification</label>
                              <input value={editForm.qualification} onChange={e => setEditForm({ ...editForm, qualification: e.target.value })} className="input-modern mt-1" placeholder="Ex: Niveau C, coeff. 345" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-gray-500 text-xs">Ancienneté (date)</label>
                                <input type="date" value={editForm.seniority_date} onChange={e => setEditForm({ ...editForm, seniority_date: e.target.value })} className="input-modern mt-1" />
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">Dernière visite médicale</label>
                                <input type="date" value={editForm.visite_medicale_date} onChange={e => setEditForm({ ...editForm, visite_medicale_date: e.target.value })} className="input-modern mt-1" />
                              </div>
                            </div>
                            <div>
                              <label className="text-gray-500 text-xs">Statut handicap (RQTH)</label>
                              <input value={editForm.disability_status} onChange={e => setEditForm({ ...editForm, disability_status: e.target.value })} className="input-modern mt-1" />
                            </div>
                            <div>
                              <label className="text-gray-500 text-xs block mb-1">Compétences opérationnelles (planning)</label>
                              <div className="flex items-center gap-5">
                                <label className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={editForm.has_permis_b} onChange={e => setEditForm({ ...editForm, has_permis_b: e.target.checked })} className="rounded" />
                                  🚗 Permis B
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={editForm.has_caces} onChange={e => setEditForm({ ...editForm, has_caces: e.target.checked })} className="rounded" />
                                  🏗️ CACES
                                </label>
                              </div>
                              <p className="text-[11px] text-gray-400 mt-1">Conditionnent l'affectation « chauffeur » / « cariste » dans le planning hebdo.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-gray-500 text-xs">Prescripteur (organisme IAE)</label>
                                <select value={editForm.prescripteur_id} onChange={e => setEditForm({ ...editForm, prescripteur_id: e.target.value })} className="input-modern mt-1">
                                  <option value="">— Aucun / non renseigné</option>
                                  {prescripteurs.filter(p => p.actif !== false || String(p.id) === String(editForm.prescripteur_id)).map(p => (
                                    <option key={p.id} value={p.id}>{p.nom}{p.type ? ` (${p.type})` : ''}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">Date de prescription</label>
                                <input type="date" value={editForm.date_prescription} onChange={e => setEditForm({ ...editForm, date_prescription: e.target.value })} className="input-modern mt-1" />
                              </div>
                            </div>
                            <div>
                              <label className="text-gray-500 text-xs">Prescripteur — texte libre (hérité)</label>
                              <input value={editForm.prescripteur} onChange={e => setEditForm({ ...editForm, prescripteur: e.target.value })} className="input-modern mt-1" placeholder="Laisser vide si l'organisme est sélectionné ci-dessus" />
                              <p className="text-[11px] text-gray-400 mt-1">Les organismes se gèrent dans « Prescripteurs » (menu RH et Insertion).</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-gray-500 text-xs">Titre de séjour</label>
                                <input value={editForm.residence_permit_type} onChange={e => setEditForm({ ...editForm, residence_permit_type: e.target.value })} className="input-modern mt-1" />
                              </div>
                              <div>
                                <label className="text-gray-500 text-xs">N° titre de séjour</label>
                                <input value={editForm.residence_permit_number} onChange={e => setEditForm({ ...editForm, residence_permit_number: e.target.value })} className="input-modern mt-1" />
                              </div>
                            </div>
                          </div>
                        </details>
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
                            <select value={contractForm.contract_type} onChange={e => setContractForm({...contractForm, contract_type: e.target.value})} className="input-modern mt-1">
                              {Object.entries(CONTRACT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Durée (mois)</span>
                            <input type="number" placeholder="Durée" value={contractForm.duration_months} onChange={e => setContractForm({...contractForm, duration_months: e.target.value})} className="input-modern mt-1" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-gray-500 text-xs">Date début *</span>
                            <input type="date" value={contractForm.start_date} onChange={e => setContractForm({...contractForm, start_date: e.target.value})} className="input-modern mt-1" required />
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Date fin</span>
                            <input type="date" value={contractForm.end_date} onChange={e => setContractForm({...contractForm, end_date: e.target.value})} className="input-modern mt-1" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-gray-500 text-xs">Temps de travail</span>
                            <select value={contractForm.weekly_hours} onChange={e => setContractForm({...contractForm, weekly_hours: parseInt(e.target.value)})} className="input-modern mt-1">
                              <option value={26}>26h/semaine</option>
                              <option value={35}>35h/semaine</option>
                            </select>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Équipe</span>
                            <select value={contractForm.team_id} onChange={e => setContractForm({...contractForm, team_id: e.target.value})} className="input-modern mt-1">
                              <option value="">—</option>
                              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Poste</span>
                          <select value={contractForm.position_id} onChange={e => setContractForm({...contractForm, position_id: e.target.value})} className="input-modern mt-1">
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
                      <div className="space-y-3">
                        <p className="text-gray-500 italic">Ce collaborateur n'est lié à aucune fiche de recrutement. Le profil PCM du recrutement ne remonte donc pas ici ni dans le module Insertion.</p>
                        <button onClick={() => setLinkCandidateOpen(true)} className="btn-primary text-sm">
                          Lier une fiche de recrutement
                        </button>
                        <p className="text-[11px] text-gray-400">Rattache la fiche candidat (recrutement) à ce collaborateur. Aucune donnée RH n'est modifiée.</p>
                      </div>
                    ) : !pcmProfile ? (
                      <div className="space-y-3">
                        <p className="text-gray-500 italic">Aucun profil PCM enregistré pour la fiche de recrutement liée.</p>
                        <button onClick={unlinkCandidate} className="text-xs px-2.5 py-1 rounded-full bg-white border border-red-200 text-red-600 hover:bg-red-50 font-medium">Délier la fiche de recrutement</button>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-end">
                          <button onClick={unlinkCandidate} className="text-xs px-2.5 py-1 rounded-full bg-white border border-red-200 text-red-600 hover:bg-red-50 font-medium">Délier</button>
                        </div>
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

                {/* Parcours insertion (lecture seule — REC-UX-12 : un seul chemin
                    d'édition, l'espace CIP ; les champs sensibles sont masqués
                    par le backend selon le rôle) */}
                {detailTab === 'insertion' && (
                  <InsertionReadOnlyTab employee={selected} />
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

        {/* Liaison à une fiche de recrutement (candidat) */}
        {linkCandidateOpen && selected && (
          <LinkCandidateModal
            employee={selected}
            onClose={() => setLinkCandidateOpen(false)}
            onLink={linkCandidate}
          />
        )}
      </div>
    </Layout>
  );
}

// Modale : rattache une fiche de recrutement (candidat) à CE collaborateur, afin
// que le profil PCM passé au recrutement remonte dans le module Insertion.
function LinkCandidateModal({ employee, onClose, onLink }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.get(`/employees/${employee.id}/candidate-matches`)
      .then(r => { if (active) setSuggestions(r.data?.suggestions || []); })
      .catch(err => { if (active) setError(err.response?.data?.error || 'Erreur de chargement des candidats'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employee.id]);

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const filtered = search.trim()
    ? suggestions.filter(c => norm(`${c.first_name} ${c.last_name} ${c.email || ''}`).includes(norm(search).trim()))
    : suggestions;

  return (
    <Modal isOpen onClose={onClose} title={`Lier une fiche de recrutement à ${employee.first_name} ${employee.last_name}`} size="md">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Sélectionnez la fiche de recrutement (candidat) correspondant à ce collaborateur.
          Le profil PCM du candidat sera alors visible ici et dans le module Insertion.
        </p>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
        <input autoFocus placeholder="Rechercher un candidat (nom, email)…" value={search}
          onChange={e => setSearch(e.target.value)} className="input-modern w-full" />
        {loading ? (
          <p className="text-sm text-slate-400 py-6 text-center">Chargement…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">Aucune fiche de recrutement disponible.</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y border rounded-lg">
            {filtered.slice(0, 100).map(c => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {c.first_name} {c.last_name}
                    {c.match_score >= 100 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">correspondance exacte</span>}
                    {c.match_score >= 40 && c.match_score < 100 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">nom proche</span>}
                    {c.has_pcm && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">PCM</span>}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{c.email || 'Email non renseigné'}</div>
                </div>
                <button onClick={() => onLink(c.id)} className="text-xs px-3 py-1.5 rounded-lg btn-primary shrink-0">Lier</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
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

// Onglet « Parcours insertion » de la fiche collaborateur — CONSULTATION
// uniquement (points d'attention + historique + objectifs/actions en lecture).
// Toute saisie passe par l'espace CIP (« Ouvrir dans l'espace CIP »).
function InsertionReadOnlyTab({ employee }) {
  const navigate = useNavigate();
  const [parcours, setParcours] = useState(null); // réponse GET /insertion/:id (timeline, milestones, objectifs, pmsmp…)
  const [contracts, setContracts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.get(`/insertion/${employee.id}`),
      api.get(`/employees/${employee.id}/contracts`).catch(() => ({ data: [] })),
    ])
      .then(([pRes, cRes]) => {
        if (!alive) return;
        setParcours(pRes.data);
        setContracts(Array.isArray(cRes.data) ? cRes.data : []);
        setError(null);
      })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [employee.id]);

  const timeline = parcours?.timeline || null;
  // Lecture seule (REC-UX-12) : tout clic sur la frise ouvre l'espace CIP,
  // seul chemin d'édition.
  const openCip = () => navigate(`/insertion?employee=${employee.id}`);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-gray-400">Consultation — la saisie (diagnostic, bilans, actions) se fait dans l'espace CIP.</p>
        <Link to={`/insertion?employee=${employee.id}`}
          className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 whitespace-nowrap">
          Ouvrir dans l'espace CIP
        </Link>
      </div>

      <AlertesBloc employeeId={employee.id} />

      <ChecklistEmbauche employeeId={employee.id} canEdit={false} />

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">Parcours indisponible : {error}</div>}
      {loading && <p className="text-xs text-gray-400">Chargement du parcours…</p>}

      {!loading && !error && parcours && (
        <div>
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Frise du parcours</h4>
          <FriseParcours
            employee={parcours.employee || employee}
            contracts={contracts}
            milestones={parcours.milestones || []}
            objectifs={parcours.objectifs || []}
            pmsmp={parcours.pmsmp || []}
            hasCandidate={!!parcours.has_candidate_data}
            hasPcm={!!parcours.has_pcm}
            onSelect={openCip}
          />
        </div>
      )}

      {timeline?.events?.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Historique du parcours</h4>
          <div className="relative">
            <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-gray-200" />
            {timeline.events.map((ev, i) => (
              <div key={i} className="relative flex items-start mb-3 pl-8">
                <div className={`absolute left-1.5 w-2.5 h-2.5 rounded-full border-2 ${
                  ev.status === 'realise' ? 'bg-green-500 border-green-500' :
                  ev.status === 'planifie' ? 'bg-blue-500 border-blue-500' : 'bg-white border-gray-300'
                }`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm ${ev.status === 'realise' ? 'text-green-700 font-medium' : 'text-gray-600'}`}>{ev.label}</span>
                    {ev.type === 'milestone' && ev.status && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${ENTRETIEN_STATUS_COLORS[ev.status] || ''}`}>
                        {ENTRETIEN_STATUS_LABELS[ev.status] || ev.status}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-400">{ev.date ? frDateIns(ev.date) : 'Date non définie'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && !error && (!timeline || !timeline.events?.length) && (
        <p className="text-xs text-gray-400 border border-dashed rounded-lg p-3 text-center">
          Aucun parcours d'insertion démarré pour ce collaborateur.
        </p>
      )}

      <div className="border-t pt-3">
        <ObjectifsPanel employeeId={employee.id} canEdit={false} />
      </div>
      <div className="border-t pt-3">
        <ActionsPanel employeeId={employee.id} readOnly compact />
      </div>
      <div className="border-t pt-3">
        <CompetencesETI employeeId={employee.id} employee={employee} canEdit={false} />
      </div>
    </div>
  );
}
