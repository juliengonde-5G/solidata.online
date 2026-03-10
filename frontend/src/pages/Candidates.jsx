import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../services/api';

const STATUSES = ['received', 'preselected', 'interview', 'test', 'hired', 'rejected'];

const STATUS_LABELS = {
  received: 'Recus',
  preselected: 'Preselectionnes',
  interview: 'Entretien',
  test: 'Test',
  hired: 'Recrutes',
  rejected: 'Refuses',
};

const STATUS_COLORS = {
  received:    { bg: 'bg-blue-50',   border: 'border-blue-200',   drop: 'bg-blue-100 border-blue-400',     badge: 'bg-blue-500' },
  preselected: { bg: 'bg-yellow-50', border: 'border-yellow-200', drop: 'bg-yellow-100 border-yellow-400', badge: 'bg-yellow-500' },
  interview:   { bg: 'bg-purple-50', border: 'border-purple-200', drop: 'bg-purple-100 border-purple-400', badge: 'bg-purple-500' },
  test:        { bg: 'bg-orange-50', border: 'border-orange-200', drop: 'bg-orange-100 border-orange-400', badge: 'bg-orange-500' },
  hired:       { bg: 'bg-green-50',  border: 'border-green-200',  drop: 'bg-green-100 border-green-400',   badge: 'bg-green-500' },
  rejected:    { bg: 'bg-red-50',    border: 'border-red-200',    drop: 'bg-red-100 border-red-400',       badge: 'bg-red-500' },
};

export default function Candidates() {
  const navigate = useNavigate();
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
            <p className="text-gray-500 text-sm">Kanban candidatures — glissez les cartes ou les CV</p>
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
              <div className="flex border-b px-5">
                {['info', 'history', 'pcm'].map(t => (
                  <button key={t} onClick={() => setDetailTab(t)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${detailTab === t ? 'border-solidata-green text-solidata-green' : 'border-transparent text-gray-500'}`}>
                    {{ info: 'Fiche', history: 'Historique', pcm: 'PCM' }[t]}
                  </button>
                ))}
              </div>
              <div className="p-5">
                {detailTab === 'info' && (editing
                  ? <EditForm ef={editForm} set={setEditForm} save={saveEdit} cancel={() => setEditing(false)} positions={positions} />
                  : <InfoView s={selected} skills={skills} positions={positions} onMove={(st) => moveCandidate(selected.id, st)} onConvert={handleConvertToEmployee} />
                )}
                {detailTab === 'history' && <HistoryView history={history} />}
                {detailTab === 'pcm' && <PCMView profile={pcmProfile} onStart={() => startPCMTest(selected.id)} onOpenInApp={() => openPCMTestInApp(selected.id)} />}
              </div>
            </div>
          </div>
        )}

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
