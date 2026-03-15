import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../services/api';

const STATUSES = ['received', 'interview', 'hired', 'rejected'];

const STATUS_LABELS = {
  received: 'Recus',
  interview: 'Entretien',
  hired: 'Recrutes',
  rejected: 'Refuses',
};

const STATUS_COLORS = {
  received:    { bg: 'bg-blue-50',   border: 'border-blue-200',   drop: 'bg-blue-100 border-blue-400',     badge: 'bg-blue-500' },
  interview:   { bg: 'bg-purple-50', border: 'border-purple-200', drop: 'bg-purple-100 border-purple-400', badge: 'bg-purple-500' },
  hired:       { bg: 'bg-green-50',  border: 'border-green-200',  drop: 'bg-green-100 border-green-400',   badge: 'bg-green-500' },
  rejected:    { bg: 'bg-red-50',    border: 'border-red-200',    drop: 'bg-red-100 border-red-400',       badge: 'bg-red-500' },
};

// Onglets visibles selon le statut du candidat
const TABS_BY_STATUS = {
  received:  ['info', 'history'],
  interview: ['info', 'history', 'situation', 'entretien', 'pcm', 'documents'],
  hired:     ['info', 'history', 'situation', 'entretien', 'pcm', 'documents'],
  rejected:  ['info', 'history'],
};

const TAB_LABELS = {
  info: 'Fiche', entretien: 'Entretien', situation: 'Mise en situation',
  documents: 'Documents', history: 'Historique', pcm: 'PCM',
};

export default function Candidates() {
  const navigate = useNavigate();
  const [pageTab, setPageTab] = useState('kanban');
  const [kanban, setKanban] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [positions, setPositions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [history, setHistory] = useState([]);
  const [skills, setSkills] = useState([]);
  const [pcmProfile, setPcmProfile] = useState(null);
  const [interviewForm, setInterviewForm] = useState(null);
  const [miseEnSituation, setMiseEnSituation] = useState([]);
  const [candidateDocuments, setCandidateDocuments] = useState([]);
  const [detailTab, setDetailTab] = useState('info');
  const [draggedId, setDraggedId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [cvDragActive, setCvDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', position_id: '' });
  const [posForm, setPosForm] = useState({ title: '', type: '', month: '', slots_open: 1 });
  const fileInputRef = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const [k, s, p] = await Promise.all([
        api.get('/candidates/kanban'),
        api.get('/candidates/stats').catch(() => ({ data: null })),
        api.get('/candidates/positions/list').catch(() => ({ data: [] })),
      ]);
      setKanban(k.data);
      setStats(s.data);
      setPositions(p.data || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadDetails = async (c) => {
    setSelected(c);
    setDetailTab('info');
    setEditing(false);
    setPcmProfile(null);
    setInterviewForm(null);
    setMiseEnSituation([]);
    setCandidateDocuments([]);
    try {
      const [h, sk] = await Promise.all([
        api.get(`/candidates/${c.id}/history`),
        api.get(`/candidates/${c.id}/skills`),
      ]);
      setHistory(h.data);
      setSkills(sk.data.filter(s => s.status !== 'not_mentioned'));
    } catch (err) { console.error(err); }
    try {
      const p = await api.get(`/pcm/profiles/${c.id}`);
      setPcmProfile(p.data);
    } catch { setPcmProfile(null); }
    try {
      const [iForm, mes, docs] = await Promise.all([
        api.get(`/candidates/${c.id}/interview-form`).catch(() => ({ data: null })),
        api.get(`/candidates/${c.id}/mise-en-situation`).catch(() => ({ data: [] })),
        api.get(`/candidates/${c.id}/documents`).catch(() => ({ data: [] })),
      ]);
      setInterviewForm(iForm.data);
      setMiseEnSituation(mes.data);
      setCandidateDocuments(docs.data);
    } catch (err) { console.error(err); }
  };

  const handleConvertToEmployee = async (candidate) => {
    if (!window.confirm(`Convertir ${candidate.first_name} ${candidate.last_name} en employé ?`)) return;
    try {
      const res = await api.post(`/candidates/${candidate.id}/convert-to-employee`, {
        contract_type: 'CDD',
        contract_start: new Date().toISOString().split('T')[0],
      });
      alert(`Employé créé avec succès (#${res.data.employee.id})`);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la conversion');
    }
  };

  const moveCandidate = async (id, newStatus) => {
    try {
      await api.put(`/candidates/${id}/status`, { status: newStatus });
      loadAll();
      if (selected?.id === id) {
        setSelected(prev => ({ ...prev, status: newStatus }));
        // Réinitialiser l'onglet si celui en cours n'est plus visible pour le nouveau statut
        const allowedTabs = TABS_BY_STATUS[newStatus] || ['info', 'history'];
        setDetailTab(prev => allowedTabs.includes(prev) ? prev : 'info');
        const h = await api.get(`/candidates/${id}/history`);
        setHistory(h.data);
      }
    } catch (err) { console.error(err); }
  };

  const createCandidate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/candidates', { ...form, position_id: form.position_id || null });
      setShowAddModal(false);
      setForm({ first_name: '', last_name: '', email: '', phone: '', position_id: '' });
      loadAll();
    } catch (err) { console.error(err); }
  };

  const [uploadMsg, setUploadMsg] = useState(null);

  const handleCVUpload = async (file) => {
    if (!file) return;
    setUploadMsg(null);
    setUploading(true);
    const fd = new FormData();
    fd.append('cv', file);
    try {
      const res = await api.post('/candidates/upload-cv-new', fd, {
        timeout: 120000,
      });
      loadAll();
      loadDetails(res.data.candidate);
      const name = [res.data.candidate?.first_name, res.data.candidate?.last_name].filter(Boolean).join(' ') || 'Nouveau candidat';
      setUploadMsg({ type: 'success', text: `CV analysé — ${name} ajouté` });
    } catch (err) {
      console.error('[CV Upload]', err);
      const msg = err.response?.data?.error || err.message || 'Erreur inconnue';
      setUploadMsg({ type: 'error', text: `Erreur upload CV : ${msg}` });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deleteCandidate = async (id) => {
    if (!window.confirm('Supprimer ce candidat ?')) return;
    try {
      await api.delete(`/candidates/${id}`);
      setSelected(null);
      loadAll();
    } catch (err) { console.error(err); }
  };

  const startPCMTest = async (candidateId) => {
    try {
      const res = await api.post('/pcm/sessions', { candidate_id: candidateId, mode: 'autonomous' });
      const link = `${window.location.origin}/pcm-test/${res.data.access_token}`;
      await navigator.clipboard.writeText(link);
      alert(`Lien du test PCM copié :\n${link}`);
    } catch (err) { console.error(err); alert('Erreur création test PCM'); }
  };

  const openPCMTestInApp = async (candidateId) => {
    try {
      const res = await api.post('/pcm/sessions', { candidate_id: candidateId, mode: 'autonomous' });
      navigate(`/pcm-test/${res.data.access_token}`);
    } catch (err) { console.error(err); alert('Erreur création test PCM'); }
  };

  const openEdit = (c) => {
    setEditForm({
      first_name: c.first_name || '', last_name: c.last_name || '',
      email: c.email || '', phone: c.phone || '',
      has_permis_b: c.has_permis_b || false, has_caces: c.has_caces || false,
      position_id: c.position_id || '', comment: c.comment || '',
      interviewer_name: c.interviewer_name || '', interview_comment: c.interview_comment || '',
      appointment_date: c.appointment_date ? c.appointment_date.split('T')[0] : '',
      appointment_location: c.appointment_location || '',
      practical_test_done: c.practical_test_done || false,
      practical_test_result: c.practical_test_result || '',
      practical_test_comment: c.practical_test_comment || '',
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    try {
      const payload = { ...editForm, position_id: editForm.position_id || null };
      // Convertir les chaînes vides en null pour les champs date et CHECK constraints
      if (payload.appointment_date === '') payload.appointment_date = null;
      if (!payload.practical_test_result) payload.practical_test_result = null;
      const res = await api.put(`/candidates/${selected.id}`, payload);
      setEditing(false);
      setSelected(res.data);
      loadAll();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    }
  };

  const createPosition = async (e) => {
    e.preventDefault();
    try {
      await api.post('/candidates/positions', posForm);
      setPosForm({ title: '', type: '', month: '', slots_open: 1 });
      setShowPositionModal(false);
      loadAll();
    } catch (err) { console.error(err); }
  };

  // Drag & drop kanban
  const onDragStart = (e, id) => { setDraggedId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); };
  const onDragEnd = () => { setDraggedId(null); setDragOver(null); };
  const onDragOverCol = (e, s) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(s); };
  const onDragLeaveCol = (e, s) => { if (e.currentTarget.contains(e.relatedTarget)) return; if (dragOver === s) setDragOver(null); };
  const onDropCol = (e, s) => { e.preventDefault(); setDragOver(null); const id = parseInt(e.dataTransfer.getData('text/plain')); if (id) moveCandidate(id, s); setDraggedId(null); };

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-solidata-green" /></div></Layout>;

  return (
    <Layout>
      <div className="p-4 lg:p-6 h-full flex flex-col">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-4 gap-3">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Recrutement</h1>
            <div className="flex gap-1 mt-1">
              {[['kanban', 'Kanban'], ['plan', 'Plan de recrutement']].map(([k, label]) => (
                <button key={k} onClick={() => setPageTab(k)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition ${pageTab === k ? 'bg-solidata-green text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {stats && (
              <div className="flex gap-2 mr-2">
                <Pill label="Total" value={stats.total} color="gray" />
                <Pill label="Ce mois" value={stats.thisMonth} color="blue" />
                <Pill label="PCM" value={stats.withPCM} color="purple" />
                <Pill label="Recrutés" value={stats.byStatus?.hired || 0} color="green" />
              </div>
            )}
            <button onClick={() => setShowPositionModal(true)} className="text-sm border border-gray-300 text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-50">Postes ({positions.length})</button>
            <button onClick={() => setShowAddModal(true)} className="text-sm bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark font-medium">+ Candidat</button>
          </div>
        </div>

        {pageTab === 'plan' && <RecruitmentPlanView positions={positions} />}

        {pageTab === 'kanban' && <>
        {/* CV Drop Zone */}
        <div
          className={`mb-4 border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer ${cvDragActive ? 'border-solidata-green bg-solidata-green/10' : 'border-gray-300 bg-gray-50 hover:border-solidata-green/50'}`}
          onDragOver={(e) => { e.preventDefault(); setCvDragActive(true); }}
          onDragLeave={() => setCvDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setCvDragActive(false); handleCVUpload(e.dataTransfer.files[0]); }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="hidden" onChange={(e) => handleCVUpload(e.target.files[0])} />
          {uploading
            ? <div className="flex items-center justify-center gap-2 text-solidata-green"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-solidata-green" /><span className="text-sm font-medium">Analyse du CV en cours...</span></div>
            : <p className="text-sm text-gray-500"><span className="font-medium text-solidata-green">Glissez un CV ici</span> ou cliquez pour importer (PDF, Word, Image)</p>
          }
        </div>

        {/* Upload feedback */}
        {uploadMsg && (
          <div className={`mb-3 px-4 py-2 rounded-lg text-sm flex items-center justify-between ${uploadMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            <span>{uploadMsg.text}</span>
            <button onClick={() => setUploadMsg(null)} className="ml-3 text-lg leading-none opacity-60 hover:opacity-100">&times;</button>
          </div>
        )}

        {/* Kanban */}
        <div className="flex gap-3 overflow-x-auto flex-1 pb-2">
          {STATUSES.map(status => {
            const col = STATUS_COLORS[status];
            const items = kanban?.[status] || [];
            return (
              <div key={status}
                className={`flex-shrink-0 w-64 lg:w-72 rounded-xl border-2 p-3 transition-all flex flex-col ${dragOver === status ? col.drop : `${col.bg} ${col.border}`}`}
                onDragOver={(e) => onDragOverCol(e, status)} onDragLeave={(e) => onDragLeaveCol(e, status)} onDrop={(e) => onDropCol(e, status)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${col.badge}`} />
                    <h3 className="font-semibold text-sm">{STATUS_LABELS[status]}</h3>
                  </div>
                  <span className="bg-white/80 rounded-full px-2 py-0.5 text-xs font-bold text-gray-600 shadow-sm">{items.length}</span>
                </div>
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[60vh]">
                  {items.map(c => (
                    <div key={c.id} draggable onDragStart={(e) => onDragStart(e, c.id)} onDragEnd={onDragEnd} onClick={() => loadDetails(c)}
                      className={`bg-white rounded-lg p-3 shadow-sm cursor-grab hover:shadow-md transition border active:cursor-grabbing ${draggedId === c.id ? 'opacity-30 scale-95' : ''}`}>
                      <p className="font-medium text-sm text-solidata-dark truncate">{c.first_name || '?'} {c.last_name || '?'}</p>
                      {c.email && <p className="text-xs text-gray-500 mt-0.5 truncate">{c.email}</p>}
                      {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.has_permis_b && <Tag text="Permis B" c="blue" />}
                        {c.has_caces && <Tag text="CACES" c="purple" />}
                        {c.cv_file_path && <Tag text="CV" c="green" />}
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <div className="text-center py-8 text-gray-400 text-xs">Aucun candidat</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => { setSelected(null); setEditing(false); }}>
            <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between z-10">
                <div>
                  <h2 className="font-bold text-lg">{selected.first_name || '?'} {selected.last_name || '?'}</h2>
                  <span className={`inline-block text-xs text-white px-2 py-0.5 rounded mt-1 ${STATUS_COLORS[selected.status]?.badge}`}>{STATUS_LABELS[selected.status]}</span>
                </div>
                <div className="flex gap-1">
                  {!editing && <button onClick={() => openEdit(selected)} className="text-xs bg-solidata-green text-white px-3 py-1.5 rounded-lg">Modifier</button>}
                  <button onClick={() => deleteCandidate(selected.id)} className="text-xs bg-red-500 text-white px-3 py-1.5 rounded-lg">Suppr.</button>
                  <button onClick={() => { setSelected(null); setEditing(false); }} className="text-gray-400 hover:text-gray-600 text-xl ml-2">&times;</button>
                </div>
              </div>
              <div className="flex border-b px-5 overflow-x-auto">
                {(TABS_BY_STATUS[selected.status] || ['info', 'history']).map(t => (
                  <button key={t} onClick={() => setDetailTab(t)}
                    className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap ${detailTab === t ? 'border-solidata-green text-solidata-green' : 'border-transparent text-gray-500'}`}>
                    {TAB_LABELS[t]}
                  </button>
                ))}
              </div>
              <div className="p-5">
                {detailTab === 'info' && (editing
                  ? <EditForm ef={editForm} set={setEditForm} save={saveEdit} cancel={() => setEditing(false)} positions={positions} />
                  : <InfoView s={selected} skills={skills} positions={positions} onMove={(st) => moveCandidate(selected.id, st)} onConvert={handleConvertToEmployee} />
                )}
                {detailTab === 'entretien' && <InterviewFormView candidateId={selected.id} data={interviewForm} onSaved={(d) => setInterviewForm(d)} />}
                {detailTab === 'situation' && <MiseEnSituationView candidateId={selected.id} data={miseEnSituation} onSaved={(d) => setMiseEnSituation(d)} />}
                {detailTab === 'documents' && <DocumentsView candidateId={selected.id} delivered={candidateDocuments} onDelivered={(d) => setCandidateDocuments(d)} />}
                {detailTab === 'history' && <HistoryView history={history} />}
                {detailTab === 'pcm' && <PCMView profile={pcmProfile} onStart={() => startPCMTest(selected.id)} onOpenInApp={() => openPCMTestInApp(selected.id)} />}
              </div>
            </div>
          </div>
        )}

        </>}

        {/* Add Modal */}
        {showAddModal && (
          <Modal title="Nouveau candidat" onClose={() => setShowAddModal(false)}>
            <form onSubmit={createCandidate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Prénom *" value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Nom *" value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" required />
              </div>
              <input placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" type="email" />
              <input placeholder="Téléphone" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" />
              {positions.length > 0 && (
                <select value={form.position_id} onChange={e => setForm({...form, position_id: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">Poste (optionnel)</option>
                  {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">Créer</button>
              </div>
            </form>
          </Modal>
        )}

        {/* Positions Modal */}
        {showPositionModal && (
          <Modal title="Gestion des postes" onClose={() => setShowPositionModal(false)} wide>
            <div className="space-y-4">
              {positions.map(p => (
                <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 text-sm">
                  <div><span className="font-medium">{p.title}</span>{p.type && <span className="text-gray-400 ml-2">({p.type})</span>}{p.month && <span className="text-gray-400 ml-2">- {p.month}</span>}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{p.filled || 0}/{p.slots_open || 1}</span>
                    <button onClick={async () => { await api.delete(`/candidates/positions/${p.id}`); loadAll(); }} className="text-red-400 hover:text-red-600 text-xs">Suppr.</button>
                  </div>
                </div>
              ))}
              <form onSubmit={createPosition} className="border-t pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase">Ajouter un poste</p>
                <input placeholder="Intitulé *" value={posForm.title} onChange={e => setPosForm({...posForm, title: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <div className="grid grid-cols-3 gap-2">
                  <input placeholder="Type" value={posForm.type} onChange={e => setPosForm({...posForm, type: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" />
                  <input placeholder="Mois" value={posForm.month} onChange={e => setPosForm({...posForm, month: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" />
                  <input placeholder="Places" value={posForm.slots_open} onChange={e => setPosForm({...posForm, slots_open: parseInt(e.target.value) || 1})} className="border rounded-lg px-3 py-2 text-sm" type="number" />
                </div>
                <button type="submit" className="w-full bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">Ajouter</button>
              </form>
            </div>
          </Modal>
        )}
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// Sub-components
// ══════════════════════════════════════════

function Tag({ text, c }) {
  const m = { blue: 'bg-blue-50 text-blue-600', purple: 'bg-purple-50 text-purple-600', green: 'bg-green-50 text-green-600', gray: 'bg-gray-100 text-gray-600', orange: 'bg-orange-50 text-orange-600' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${m[c] || m.gray}`}>{text}</span>;
}

function Pill({ label, value, color }) {
  const m = { gray: 'bg-gray-100 text-gray-700', blue: 'bg-blue-100 text-blue-700', purple: 'bg-purple-100 text-purple-700', green: 'bg-green-100 text-green-700' };
  return <div className={`px-3 py-1 rounded-full text-xs font-medium ${m[color]}`}>{label}: <strong>{value}</strong></div>;
}

function InfoView({ s, skills, positions, onMove, onConvert }) {
  const pos = positions.find(p => p.id === s.position_id);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Field l="Prénom" v={s.first_name} /><Field l="Nom" v={s.last_name} />
        <Field l="Email" v={s.email} /><Field l="Téléphone" v={s.phone} />
        <Field l="Poste" v={pos?.title} />
      </div>
      <div className="pt-2">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Déplacer vers</p>
        <div className="flex flex-wrap gap-1">
          {STATUSES.filter(st => st !== s.status).map(st => (
            <button key={st} onClick={() => onMove(st)} className={`text-xs px-2.5 py-1 rounded-full text-white font-medium ${STATUS_COLORS[st].badge}`}>{STATUS_LABELS[st]}</button>
          ))}
        </div>
      </div>
      {s.status === 'hired' && !s.employee_id && (
        <div className="pt-3">
          <button onClick={() => onConvert && onConvert(s)} className="w-full bg-solidata-green text-white rounded-lg py-2 text-sm font-medium hover:bg-solidata-green/90 flex items-center justify-center gap-2">
            <span>Créer un employé</span>
          </button>
        </div>
      )}
      {skills.length > 0 && (
        <div className="pt-2"><p className="text-xs font-semibold text-gray-500 uppercase mb-2">Compétences</p>
          <div className="flex flex-wrap gap-1">{skills.map(sk => <Tag key={sk.skill_name} text={sk.skill_name.replace(/_/g, ' ')} c={sk.status === 'confirmed' ? 'green' : 'orange'} />)}</div>
        </div>
      )}
      {s.cv_file_path && <a href={s.cv_file_path} target="_blank" rel="noopener noreferrer" className="text-solidata-green hover:underline text-sm font-medium block pt-2">Voir le CV</a>}
      {(s.interviewer_name || s.appointment_date) && (
        <div className="pt-2 border-t">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Entretien</p>
          {s.interviewer_name && <Field l="Intervieweur" v={s.interviewer_name} />}
          {s.interview_comment && <Field l="Commentaire" v={s.interview_comment} />}
          {s.appointment_date && <Field l="Date RDV" v={new Date(s.appointment_date).toLocaleDateString('fr-FR')} />}
          {s.appointment_location && <Field l="Lieu" v={s.appointment_location} />}
        </div>
      )}
      {s.practical_test_done && (
        <div className="pt-2 border-t">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Test pratique</p>
          <Field l="Résultat" v={s.practical_test_result} />
          {s.practical_test_comment && <Field l="Commentaire" v={s.practical_test_comment} />}
        </div>
      )}
      {s.comment && <div className="pt-2 border-t"><Field l="Commentaire" v={s.comment} /></div>}
    </div>
  );
}

function HistoryView({ history }) {
  if (!history.length) return <p className="text-sm text-gray-400">Aucun mouvement</p>;
  return (
    <div className="space-y-3">
      {history.map(h => (
        <div key={h.id} className="flex gap-3 items-start">
          <div className="w-2 h-2 rounded-full bg-solidata-green mt-1.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium">{h.from_status ? `${STATUS_LABELS[h.from_status] || h.from_status} → ` : ''}{STATUS_LABELS[h.to_status] || h.to_status}</p>
            {h.comment && <p className="text-gray-500 text-xs">{h.comment}</p>}
            <p className="text-gray-400 text-xs mt-0.5">{new Date(h.created_at).toLocaleString('fr-FR')}{h.changed_by_name && ` — ${h.changed_by_name} ${h.changed_by_lastname || ''}`}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PCMView({ profile, onStart, onOpenInApp }) {
  const PCM_C = { analyseur: 'bg-blue-100 text-blue-700', perseverant: 'bg-green-100 text-green-700', empathique: 'bg-pink-100 text-pink-700', imagineur: 'bg-indigo-100 text-indigo-700', energiseur: 'bg-orange-100 text-orange-700', promoteur: 'bg-red-100 text-red-700' };
  if (!profile) return (
    <div className="text-center py-8">
      <p className="text-gray-500 text-sm mb-4">Aucun profil PCM</p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <button onClick={onOpenInApp} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 font-medium">
          Ouvrir le questionnaire
        </button>
        <button onClick={onStart} className="border border-purple-300 text-purple-600 px-4 py-2 rounded-lg text-sm hover:bg-purple-50 font-medium">
          Copier le lien à partager
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-3">Ouvrir dans l’app ou copier le lien pour l’envoyer au candidat</p>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Base</p><p className={`inline-block mt-1 px-2 py-0.5 rounded text-sm font-bold ${PCM_C[profile.base_type] || 'bg-gray-100'}`}>{profile.base_type}</p></div>
        <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Phase</p><p className={`inline-block mt-1 px-2 py-0.5 rounded text-sm font-bold ${PCM_C[profile.phase_type] || 'bg-gray-100'}`}>{profile.phase_type}</p></div>
      </div>
      {profile.risk_alert && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 font-medium">Alerte RPS</div>}
      {profile.immeuble && (
        <div><p className="text-xs font-semibold text-gray-500 uppercase mb-2">Immeuble PCM</p>
          <div className="space-y-1">{profile.immeuble.map((f, i) => (
            <div key={i} className={`rounded px-3 py-1.5 text-sm font-medium ${PCM_C[f.type] || 'bg-gray-100'}`} style={{ opacity: 1 - i * 0.12 }}>{f.type} — {f.score}%</div>
          ))}</div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={onOpenInApp} className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 font-medium">Ouvrir le questionnaire</button>
        <button onClick={onStart} className="flex-1 border border-purple-300 text-purple-600 px-4 py-2 rounded-lg text-sm hover:bg-purple-50 font-medium">Copier le lien</button>
      </div>
    </div>
  );
}

function EditForm({ ef, set, save, cancel, positions }) {
  const u = (k, v) => set(prev => ({ ...prev, [k]: v }));
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <EF l="Prénom" v={ef.first_name} o={v => u('first_name', v)} />
        <EF l="Nom" v={ef.last_name} o={v => u('last_name', v)} />
      </div>
      <EF l="Email" v={ef.email} o={v => u('email', v)} t="email" />
      <EF l="Téléphone" v={ef.phone} o={v => u('phone', v)} />
      {positions.length > 0 && (
        <div><span className="text-gray-500 text-xs">Poste</span>
          <select value={ef.position_id} onChange={e => u('position_id', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
            <option value="">— Aucun —</option>
            {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      )}
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ef.has_permis_b} onChange={e => u('has_permis_b', e.target.checked)} /> Permis B</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ef.has_caces} onChange={e => u('has_caces', e.target.checked)} /> CACES</label>
      </div>
      <hr />
      <p className="text-xs font-semibold text-gray-600 uppercase">Entretien</p>
      <EF l="Intervieweur" v={ef.interviewer_name} o={v => u('interviewer_name', v)} />
      <div><span className="text-gray-500 text-xs">Commentaire entretien</span><textarea value={ef.interview_comment} onChange={e => u('interview_comment', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" rows={2} /></div>
      <EF l="Date RDV" v={ef.appointment_date} o={v => u('appointment_date', v)} t="date" />
      <EF l="Lieu RDV" v={ef.appointment_location} o={v => u('appointment_location', v)} />
      <hr />
      <p className="text-xs font-semibold text-gray-600 uppercase">Test pratique</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ef.practical_test_done} onChange={e => u('practical_test_done', e.target.checked)} /> Test effectué</label>
      <div><span className="text-gray-500 text-xs">Résultat</span>
        <select value={ef.practical_test_result} onChange={e => u('practical_test_result', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
          <option value="">—</option><option value="conforme">Conforme</option><option value="faible">Faible</option><option value="recale">Recalé</option>
        </select>
      </div>
      <div><span className="text-gray-500 text-xs">Commentaire test</span><textarea value={ef.practical_test_comment} onChange={e => u('practical_test_comment', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" rows={2} /></div>
      <hr />
      <div><span className="text-gray-500 text-xs">Commentaire général</span><textarea value={ef.comment} onChange={e => u('comment', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" rows={2} /></div>
      <div className="flex gap-2 mt-4">
        <button onClick={cancel} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
        <button onClick={save} className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">Enregistrer</button>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`bg-white rounded-xl p-6 shadow-xl ${wide ? 'max-w-xl' : 'max-w-md'} w-full max-h-[80vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ l, v }) { return <div><span className="text-gray-500 text-xs">{l}</span><p className="font-medium">{v || '—'}</p></div>; }
function EF({ l, v, o, t = 'text' }) { return <div><span className="text-gray-500 text-xs">{l}</span><input type={t} value={v} onChange={e => o(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>; }

// ══════════════════════════════════════════
// TRAME ENTRETIEN DE RECRUTEMENT
// ══════════════════════════════════════════
function InterviewFormView({ candidateId, data, onSaved }) {
  const [editing, setEditing] = useState(!data);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(data || {
    presentation_mots: '', parcours_professionnel: '', experiences_marquantes: '',
    situation_actuelle: '', situation_actuelle_autre: '',
    duree_sans_emploi: '', difficultes_recherche: [], difficultes_recherche_autre: '',
    freins_emploi: [], freins_emploi_autre: '',
    contraintes_horaires: '', contraintes_horaires_detail: '',
    structure_accompagnement: [], structure_accompagnement_autre: '',
    motivation_integration: '', motivation_reprise: '', attentes: [], attentes_autre: '',
    experience_activite: [], comportement_equipe: '', reaction_consigne: '', travail_physique: '',
    disponibilite_horaires: '', disponibilite_autre: '', organisation_ponctualite: '',
    idee_metier: '', idee_metier_detail: '', amelioration_souhaitee: '', question_ouverte: '',
    evaluation_globale: '', commentaire_evaluateur: '',
  });

  const u = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const toggleArr = (k, v) => setForm(prev => {
    const arr = prev[k] || [];
    return { ...prev, [k]: arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] };
  });

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.post(`/candidates/${candidateId}/interview-form`, form);
      onSaved(res.data);
      setEditing(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    }
    setSaving(false);
  };

  if (!editing && data) {
    return (
      <div className="space-y-4 text-sm">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-base">Trame d'entretien</h3>
          <button onClick={() => setEditing(true)} className="text-xs bg-solidata-green text-white px-3 py-1.5 rounded-lg">Modifier</button>
        </div>
        {data.evaluation_globale && (
          <div className={`px-3 py-2 rounded-lg font-medium text-sm ${data.evaluation_globale === 'favorable' ? 'bg-green-50 text-green-700' : data.evaluation_globale === 'reserve' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'}`}>
            Evaluation : {data.evaluation_globale}
          </div>
        )}
        <Section title="I. Présentation">
          <Field l="Présentation en quelques mots" v={data.presentation_mots} />
          <Field l="Parcours professionnel" v={data.parcours_professionnel} />
          <Field l="Expériences marquantes" v={data.experiences_marquantes} />
        </Section>
        <Section title="II. Situation actuelle">
          <Field l="Situation" v={{ reconversion: 'En reconversion', retour_emploi: 'En recherche de retour à l\'emploi', autre: data.situation_actuelle_autre || 'Autre' }[data.situation_actuelle]} />
          <Field l="Durée sans emploi" v={{ moins_6_mois: 'Moins de 6 mois', '6_mois_1_an': 'Entre 6 mois et un an', plus_1_an: 'Plus d\'un an' }[data.duree_sans_emploi]} />
          {data.difficultes_recherche?.length > 0 && <Field l="Difficultés de recherche" v={data.difficultes_recherche.join(', ')} />}
        </Section>
        <Section title="III. Freins à l'emploi">
          {data.freins_emploi?.length > 0 && <Field l="Freins" v={data.freins_emploi.join(', ')} />}
          <Field l="Contraintes horaires" v={{ oui: 'Oui', certainement: 'Certainement à l\'avenir', non: 'Non' }[data.contraintes_horaires]} />
          {data.structure_accompagnement?.length > 0 && <Field l="Structure d'accompagnement" v={data.structure_accompagnement.join(', ')} />}
        </Section>
        <Section title="IV. Motivation">
          <Field l="Motivation à intégrer le chantier" v={data.motivation_integration} />
          <Field l="Motivation de reprise" v={data.motivation_reprise} />
          {data.attentes?.length > 0 && <Field l="Attentes" v={data.attentes.join(', ')} />}
        </Section>
        <Section title="V. Compétences et savoir-être">
          {data.experience_activite?.length > 0 && <Field l="Expérience dans l'activité" v={data.experience_activite.join(', ')} />}
          <Field l="Comportement en équipe" v={data.comportement_equipe} />
          <Field l="Réaction aux consignes" v={data.reaction_consigne} />
          <Field l="Travail physique" v={{ oui: 'Oui', non: 'Non', ne_sais_pas: 'Ne sais pas' }[data.travail_physique]} />
        </Section>
        <Section title="VI. Organisation">
          <Field l="Disponibilité horaires" v={{ oui: 'Oui', non: 'Non', autre: data.disponibilite_autre || 'Autre' }[data.disponibilite_horaires]} />
          <Field l="Organisation ponctualité" v={data.organisation_ponctualite} />
        </Section>
        <Section title="VII. Projet professionnel">
          <Field l="Idée de métier" v={{ oui: 'Oui', non: 'Non', autre: data.idee_metier_detail || 'Autre' }[data.idee_metier]} />
          <Field l="Amélioration souhaitée" v={data.amelioration_souhaitee} />
          <Field l="Question ouverte" v={data.question_ouverte} />
        </Section>
        {data.commentaire_evaluateur && <Section title="Commentaire évaluateur"><p className="text-gray-700">{data.commentaire_evaluateur}</p></Section>}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <h3 className="font-bold text-base">Trame d'entretien de recrutement</h3>
      <Section title="I. Questions de présentation">
        <TA l="Pouvez-vous vous présenter en quelques mots ?" v={form.presentation_mots || ''} o={v => u('presentation_mots', v)} />
        <TA l="Parcours professionnel ?" v={form.parcours_professionnel || ''} o={v => u('parcours_professionnel', v)} />
        <TA l="Expériences de travail marquantes ?" v={form.experiences_marquantes || ''} o={v => u('experiences_marquantes', v)} />
      </Section>

      <Section title="II. Situation actuelle">
        <p className="text-xs text-gray-500 mb-1">Que faites-vous actuellement ?</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {[['reconversion', 'En reconversion'], ['retour_emploi', 'Retour à l\'emploi'], ['autre', 'Autre']].map(([k, l]) => (
            <CB key={k} label={l} checked={form.situation_actuelle === k} onChange={() => u('situation_actuelle', k)} />
          ))}
        </div>
        {form.situation_actuelle === 'autre' && <EF l="Précisez" v={form.situation_actuelle_autre || ''} o={v => u('situation_actuelle_autre', v)} />}
        <p className="text-xs text-gray-500 mt-3 mb-1">Durée sans emploi</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {[['moins_6_mois', 'Moins de 6 mois'], ['6_mois_1_an', '6 mois - 1 an'], ['plus_1_an', 'Plus d\'un an']].map(([k, l]) => (
            <CB key={k} label={l} checked={form.duree_sans_emploi === k} onChange={() => u('duree_sans_emploi', k)} />
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3 mb-1">Difficultés de recherche d'emploi</p>
        <div className="flex flex-wrap gap-2">
          {['Freins personnels/sociaux', 'Freins psychologiques', 'Manque de compétences', 'Confiance fragile', 'Parcours difficile', 'Problèmes administratifs'].map(d => (
            <CB key={d} label={d} checked={(form.difficultes_recherche || []).includes(d)} onChange={() => toggleArr('difficultes_recherche', d)} multi />
          ))}
        </div>
      </Section>

      <Section title="III. Freins à l'emploi">
        <p className="text-xs text-gray-500 mb-1">Difficultés particulières</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {['Transport', 'Santé', 'Logement', 'Administratif', 'Langue'].map(f => (
            <CB key={f} label={f} checked={(form.freins_emploi || []).includes(f)} onChange={() => toggleArr('freins_emploi', f)} multi />
          ))}
        </div>
        <EF l="Autre frein" v={form.freins_emploi_autre || ''} o={v => u('freins_emploi_autre', v)} />
        <p className="text-xs text-gray-500 mt-3 mb-1">Contraintes d'horaires ?</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {[['oui', 'Oui'], ['certainement', 'Certainement'], ['non', 'Non']].map(([k, l]) => (
            <CB key={k} label={l} checked={form.contraintes_horaires === k} onChange={() => u('contraintes_horaires', k)} />
          ))}
        </div>
        {form.contraintes_horaires === 'oui' && <EF l="Précisez" v={form.contraintes_horaires_detail || ''} o={v => u('contraintes_horaires_detail', v)} />}
        <p className="text-xs text-gray-500 mt-3 mb-1">Accompagné par une structure ?</p>
        <div className="flex flex-wrap gap-2">
          {['Mission locale', 'France Travail', 'Travailleur social', 'Aucune'].map(s => (
            <CB key={s} label={s} checked={(form.structure_accompagnement || []).includes(s)} onChange={() => toggleArr('structure_accompagnement', s)} multi />
          ))}
        </div>
      </Section>

      <Section title="IV. Motivation">
        <TA l="Pourquoi intégrer ce chantier d'insertion ?" v={form.motivation_integration || ''} o={v => u('motivation_integration', v)} />
        <TA l="Motivation à reprendre une activité ?" v={form.motivation_reprise || ''} o={v => u('motivation_reprise', v)} />
        <p className="text-xs text-gray-500 mt-2 mb-1">Attentes</p>
        <div className="flex flex-wrap gap-2">
          {['Documents administratifs', 'Retour à l\'emploi', 'Formation/stage/immersion'].map(a => (
            <CB key={a} label={a} checked={(form.attentes || []).includes(a)} onChange={() => toggleArr('attentes', a)} multi />
          ))}
        </div>
      </Section>

      <Section title="V. Compétences et savoir-être">
        <p className="text-xs text-gray-500 mb-1">Expérience dans ce type d'activité ?</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {['Bâtiment', 'Espaces verts', 'Nettoyage', 'Recyclerie'].map(a => (
            <CB key={a} label={a} checked={(form.experience_activite || []).includes(a)} onChange={() => toggleArr('experience_activite', a)} multi />
          ))}
        </div>
        <TA l="Comportement en équipe ?" v={form.comportement_equipe || ''} o={v => u('comportement_equipe', v)} />
        <TA l="Réaction aux consignes/critiques ?" v={form.reaction_consigne || ''} o={v => u('reaction_consigne', v)} />
        <p className="text-xs text-gray-500 mt-2 mb-1">À l'aise avec le travail physique ?</p>
        <div className="flex flex-wrap gap-2">
          {[['oui', 'Oui'], ['non', 'Non'], ['ne_sais_pas', 'Ne sais pas']].map(([k, l]) => (
            <CB key={k} label={l} checked={form.travail_physique === k} onChange={() => u('travail_physique', k)} />
          ))}
        </div>
      </Section>

      <Section title="VI. Organisation et engagement">
        <p className="text-xs text-gray-500 mb-1">Disponible aux horaires proposés ?</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {[['oui', 'Oui'], ['non', 'Non'], ['autre', 'Autre']].map(([k, l]) => (
            <CB key={k} label={l} checked={form.disponibilite_horaires === k} onChange={() => u('disponibilite_horaires', k)} />
          ))}
        </div>
        {form.disponibilite_horaires === 'autre' && <EF l="Précisez" v={form.disponibilite_autre || ''} o={v => u('disponibilite_autre', v)} />}
        <TA l="Comment vous organisez-vous pour être ponctuel ?" v={form.organisation_ponctualite || ''} o={v => u('organisation_ponctualite', v)} />
      </Section>

      <Section title="VII. Projet professionnel">
        <p className="text-xs text-gray-500 mb-1">Idée de métier ?</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {[['oui', 'Oui'], ['non', 'Non'], ['autre', 'Autre']].map(([k, l]) => (
            <CB key={k} label={l} checked={form.idee_metier === k} onChange={() => u('idee_metier', k)} />
          ))}
        </div>
        {(form.idee_metier === 'oui' || form.idee_metier === 'autre') && <EF l="Précisez" v={form.idee_metier_detail || ''} o={v => u('idee_metier_detail', v)} />}
        <TA l="Qu'aimeriez-vous améliorer à la fin du chantier ?" v={form.amelioration_souhaitee || ''} o={v => u('amelioration_souhaitee', v)} />
        <TA l="Y a-t-il quelque chose d'important dans votre situation ?" v={form.question_ouverte || ''} o={v => u('question_ouverte', v)} />
      </Section>

      <Section title="Évaluation globale">
        <div className="flex flex-wrap gap-2 mb-3">
          {[['favorable', 'Favorable'], ['reserve', 'Réservé'], ['defavorable', 'Défavorable']].map(([k, l]) => (
            <CB key={k} label={l} checked={form.evaluation_globale === k} onChange={() => u('evaluation_globale', k)} />
          ))}
        </div>
        <TA l="Commentaire de l'évaluateur" v={form.commentaire_evaluateur || ''} o={v => u('commentaire_evaluateur', v)} />
      </Section>

      <div className="flex gap-2 pt-3">
        {data && <button onClick={() => setEditing(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>}
        <button onClick={save} disabled={saving} className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
          {saving ? 'Enregistrement...' : 'Enregistrer l\'entretien'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// FICHES DE MISE EN SITUATION
// ══════════════════════════════════════════
const MES_TYPES = {
  collecte_manutention: { label: 'Collecte / Manutention', color: 'blue', desc: "Évaluer la capacité physique, l'endurance et la compréhension des consignes. Sélection des sacs, contrôle d'humidité, tri sec/mouillé." },
  craquage: { label: 'Craquage', color: 'orange', desc: "Ouvrir les sacs, vider le contenu, séparer textile/chaussures. Mise sous élastique des chaussures bon état." },
  qualite: { label: 'Qualité', color: 'purple', desc: "Craquage + tri qualité : très bonne qualité (réutilisation) vs recyclage. Évaluation de la précision du tri." },
};

const MES_CRITERIA = [
  { key: 'respect_consignes', label: 'Respect des consignes' },
  { key: 'capacite_physique', label: 'Capacité physique' },
  { key: 'endurance', label: 'Endurance' },
  { key: 'comprehension', label: 'Compréhension' },
  { key: 'qualite_travail', label: 'Qualité du travail' },
  { key: 'rapidite', label: 'Rapidité' },
  { key: 'securite', label: 'Sécurité' },
  { key: 'autonomie', label: 'Autonomie' },
];

function MiseEnSituationView({ candidateId, data, onSaved }) {
  const [activeType, setActiveType] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const startEval = (type) => {
    const existing = data.find(d => d.type === type);
    setForm(existing || { type, respect_consignes: 3, capacite_physique: 3, endurance: 3, comprehension: 3, qualite_travail: 3, rapidite: 3, securite: 3, autonomie: 3, resultat: '', points_forts: '', points_amelioration: '', commentaire: '', duree_minutes: 45 });
    setActiveType(type);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/candidates/${candidateId}/mise-en-situation`, form);
      const res = await api.get(`/candidates/${candidateId}/mise-en-situation`);
      onSaved(res.data);
      setActiveType(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur');
    }
    setSaving(false);
  };

  if (activeType) {
    const meta = MES_TYPES[activeType];
    return (
      <div className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base">{meta.label}</h3>
          <button onClick={() => setActiveType(null)} className="text-gray-400 hover:text-gray-600 text-sm">Retour</button>
        </div>
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">{meta.desc}</p>

        <div className="space-y-3">
          {MES_CRITERIA.map(c => (
            <div key={c.key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">{c.label}</span>
                <span className="text-xs font-bold text-solidata-green">{form[c.key]}/5</span>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(v => (
                  <button key={v} onClick={() => setForm(prev => ({ ...prev, [c.key]: v }))}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition ${form[c.key] >= v ? 'bg-solidata-green text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          <span className="text-xs text-gray-500">Durée (minutes)</span>
          <input type="number" value={form.duree_minutes || ''} onChange={e => setForm(prev => ({ ...prev, duree_minutes: parseInt(e.target.value) || null }))} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
        </div>

        <div>
          <span className="text-xs text-gray-500">Résultat global</span>
          <div className="flex gap-2 mt-1">
            {[['conforme', 'Conforme', 'bg-green-100 text-green-700 border-green-300'], ['a_ameliorer', 'À améliorer', 'bg-yellow-100 text-yellow-700 border-yellow-300'], ['non_conforme', 'Non conforme', 'bg-red-100 text-red-700 border-red-300']].map(([k, l, c]) => (
              <button key={k} onClick={() => setForm(prev => ({ ...prev, resultat: k }))}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${form.resultat === k ? c : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <TA l="Points forts" v={form.points_forts || ''} o={v => setForm(prev => ({ ...prev, points_forts: v }))} />
        <TA l="Points d'amélioration" v={form.points_amelioration || ''} o={v => setForm(prev => ({ ...prev, points_amelioration: v }))} />
        <TA l="Commentaire" v={form.commentaire || ''} o={v => setForm(prev => ({ ...prev, commentaire: v }))} />

        <div className="flex gap-2 pt-2">
          <button onClick={() => setActiveType(null)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
          <button onClick={save} disabled={saving} className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <h3 className="font-bold text-base">Mises en situation</h3>
      <p className="text-xs text-gray-500">Évaluez le candidat sur 3 postes de travail (durée max : 45 min chacun)</p>

      <div className="space-y-3">
        {Object.entries(MES_TYPES).map(([type, meta]) => {
          const existing = data.find(d => d.type === type);
          const tagColors = { blue: 'bg-blue-50 border-blue-200', orange: 'bg-orange-50 border-orange-200', purple: 'bg-purple-50 border-purple-200' };
          const avg = existing ? Math.round(MES_CRITERIA.reduce((s, c) => s + (existing[c.key] || 0), 0) / MES_CRITERIA.length * 10) / 10 : null;
          return (
            <div key={type} className={`border rounded-xl p-4 ${tagColors[meta.color]} cursor-pointer hover:shadow-md transition`} onClick={() => startEval(type)}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold">{meta.label}</span>
                {existing ? (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${existing.resultat === 'conforme' ? 'bg-green-200 text-green-800' : existing.resultat === 'a_ameliorer' ? 'bg-yellow-200 text-yellow-800' : 'bg-red-200 text-red-800'}`}>
                    {existing.resultat === 'conforme' ? 'Conforme' : existing.resultat === 'a_ameliorer' ? 'À améliorer' : 'Non conforme'}
                  </span>
                ) : <span className="text-xs text-gray-400">Non évalué</span>}
              </div>
              <p className="text-xs text-gray-500">{meta.desc}</p>
              {existing && (
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-xs text-gray-600">Moyenne : <strong>{avg}/5</strong></span>
                  {existing.duree_minutes && <span className="text-xs text-gray-400">{existing.duree_minutes} min</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// DOCUMENTS RECRUTEMENT
// ══════════════════════════════════════════
const DOC_LABELS = {
  livret_accueil: "Livret d'accueil",
  charte_insertion: "Charte d'insertion",
  procedure_recrutement: 'Procédure de recrutement',
  fiche_mise_en_situation_collecte: 'Fiche - Collecte/Manutention',
  fiche_mise_en_situation_craquage: 'Fiche - Craquage',
  fiche_mise_en_situation_qualite: 'Fiche - Qualité',
};

function DocumentsView({ candidateId, delivered, onDelivered }) {
  const [docs, setDocs] = useState([]);
  const [livretContent, setLivretContent] = useState(null);
  const [showLivret, setShowLivret] = useState(false);
  const [delivering, setDelivering] = useState(null);

  useEffect(() => {
    api.get('/candidates/documents/list').then(r => setDocs(r.data)).catch(() => {});
  }, []);

  const viewLivret = async () => {
    if (!livretContent) {
      try {
        const r = await api.get('/candidates/documents/livret-content');
        setLivretContent(r.data);
      } catch { return; }
    }
    setShowLivret(!showLivret);
  };

  const deliverDoc = async (docKey, method) => {
    setDelivering(docKey);
    try {
      await api.post(`/candidates/${candidateId}/documents/deliver`, { document_type: docKey, delivery_method: method });
      const r = await api.get(`/candidates/${candidateId}/documents`);
      onDelivered(r.data);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur');
    }
    setDelivering(null);
  };

  const isDelivered = (key) => delivered.find(d => d.document_type === key);

  return (
    <div className="space-y-4 text-sm">
      <h3 className="font-bold text-base">Documents du parcours</h3>

      <div className="space-y-2">
        {docs.map(doc => {
          const del = isDelivered(doc.key);
          return (
            <div key={doc.key} className={`border rounded-lg p-3 ${del ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{doc.label}</span>
                  {del && <span className="text-xs text-green-600 ml-2">Remis le {new Date(del.delivered_at).toLocaleDateString('fr-FR')}</span>}
                </div>
                <div className="flex gap-1">
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200">PDF</a>
                  {doc.key === 'livret_accueil' && <button onClick={viewLivret} className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded hover:bg-blue-200">{showLivret ? 'Masquer' : 'Lire'}</button>}
                  {!del && (
                    <button onClick={() => deliverDoc(doc.key, 'remise_main')} disabled={delivering === doc.key} className="text-xs bg-solidata-green text-white px-2 py-1 rounded hover:bg-solidata-green/80 disabled:opacity-50">
                      {delivering === doc.key ? '...' : 'Remettre'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showLivret && livretContent && (
        <div className="border rounded-xl p-4 bg-white space-y-4 max-h-[50vh] overflow-y-auto">
          <h4 className="font-bold text-lg text-center text-solidata-green">{livretContent.title}</h4>
          {livretContent.sections.map((s, i) => (
            <div key={i} className="border-t pt-3">
              <h5 className="font-semibold text-sm mb-1">{s.title}</h5>
              <p className="text-xs text-gray-600 leading-relaxed">{s.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// Plan de recrutement mensuel
// ══════════════════════════════════════════
function RecruitmentPlanView({ positions }) {
  const [plan, setPlan] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [months, setMonths] = useState(() => {
    const arr = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return arr;
  });

  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/candidates/recruitment-plan?from=${months[0]}&to=${months[months.length - 1]}`);
      setPlan(res.data || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [months]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  const updateSlots = async (positionId, month, slots) => {
    try {
      await api.post('/candidates/recruitment-plan', { position_id: positionId, month, slots_needed: Math.max(0, parseInt(slots) || 0) });
      loadPlan();
    } catch (err) { console.error(err); }
  };

  const getSlots = (positionId, month) => {
    const entry = plan.find(p => p.position_id === positionId && p.month === month);
    return entry ? entry.slots_needed : 0;
  };

  const getHired = (positionId, month) => {
    const entry = plan.find(p => p.position_id === positionId && p.month === month);
    return entry ? (parseInt(entry.hired_count) || 0) : 0;
  };

  const formatMonth = (m) => {
    const [y, mo] = m.split('-');
    const names = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    return `${names[parseInt(mo) - 1]} ${y}`;
  };

  if (loading) return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-solidata-green" /></div>;

  const totalNeeded = (month) => positions.reduce((sum, p) => sum + getSlots(p.id, month), 0);
  const totalHired = (month) => positions.reduce((sum, p) => sum + getHired(p.id, month), 0);

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[180px]">Poste</th>
              {months.map(m => (
                <th key={m} className="px-3 py-3 text-center font-medium text-gray-600 min-w-[90px]">
                  <span className={m === selectedMonth ? 'text-solidata-green font-bold' : ''}>{formatMonth(m)}</span>
                </th>
              ))}
              <th className="px-4 py-3 text-center font-semibold text-gray-700 min-w-[80px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(pos => {
              const totalPos = months.reduce((sum, m) => sum + getSlots(pos.id, m), 0);
              const totalPosHired = months.reduce((sum, m) => sum + getHired(pos.id, m), 0);
              return (
                <tr key={pos.id} className="border-b hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-medium text-gray-800 sticky left-0 bg-white">
                    {pos.title}
                    {pos.type && <span className="text-gray-400 text-xs ml-1">({pos.type})</span>}
                  </td>
                  {months.map(m => {
                    const needed = getSlots(pos.id, m);
                    const hired = getHired(pos.id, m);
                    return (
                      <td key={m} className="px-1 py-1 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <input type="number" min="0" value={needed}
                            onChange={e => updateSlots(pos.id, m, e.target.value)}
                            className="w-14 text-center border rounded px-1 py-1 text-sm focus:ring-1 focus:ring-solidata-green focus:border-solidata-green" />
                          {needed > 0 && (
                            <span className={`text-[10px] font-medium ${hired >= needed ? 'text-green-600' : 'text-orange-500'}`}>
                              {hired}/{needed}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-center font-bold">
                    <span className={totalPosHired >= totalPos && totalPos > 0 ? 'text-green-600' : 'text-gray-800'}>{totalPosHired}/{totalPos}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t-2 font-bold">
              <td className="px-4 py-3 sticky left-0 bg-gray-50 text-gray-700">Total</td>
              {months.map(m => (
                <td key={m} className="px-3 py-3 text-center">
                  <span className={totalHired(m) >= totalNeeded(m) && totalNeeded(m) > 0 ? 'text-green-600' : 'text-gray-800'}>
                    {totalHired(m)}/{totalNeeded(m)}
                  </span>
                </td>
              ))}
              <td className="px-4 py-3 text-center text-solidata-green">
                {months.reduce((s, m) => s + totalHired(m), 0)}/{months.reduce((s, m) => s + totalNeeded(m), 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {positions.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p>Aucun poste configuré.</p>
          <p className="text-xs mt-1">Créez des postes depuis l'onglet Kanban pour commencer.</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// Shared micro-components
// ══════════════════════════════════════════
function Section({ title, children }) {
  return <div className="border-t pt-3"><h4 className="font-semibold text-sm mb-2 text-gray-700">{title}</h4><div className="space-y-2">{children}</div></div>;
}

function CB({ label, checked, onChange, multi }) {
  return (
    <button onClick={onChange}
      className={`text-xs px-2.5 py-1.5 rounded-lg border transition ${checked ? 'bg-solidata-green text-white border-solidata-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
      {multi && checked && '+ '}{label}
    </button>
  );
}

function TA({ l, v, o }) {
  return (
    <div>
      <span className="text-gray-500 text-xs">{l}</span>
      <textarea value={v} onChange={e => o(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" rows={2} />
    </div>
  );
}
