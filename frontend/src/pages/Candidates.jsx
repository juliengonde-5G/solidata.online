import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const STATUS_LABELS = {
  received: 'Reçus',
  to_contact: 'À contacter',
  not_retained: 'Non retenus',
  summoned: 'Convoqués',
  recruited: 'Recrutés',
};

const STATUS_COLORS = {
  received: 'bg-blue-100 border-blue-300',
  to_contact: 'bg-yellow-100 border-yellow-300',
  not_retained: 'bg-red-100 border-red-300',
  summoned: 'bg-purple-100 border-purple-300',
  recruited: 'bg-green-100 border-green-300',
};

const STATUS_DROP_COLORS = {
  received: 'bg-blue-200 border-blue-400',
  to_contact: 'bg-yellow-200 border-yellow-400',
  not_retained: 'bg-red-200 border-red-400',
  summoned: 'bg-purple-200 border-purple-400',
  recruited: 'bg-green-200 border-green-400',
};

export default function Candidates() {
  const [kanban, setKanban] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', gender: '' });
  const [draggedId, setDraggedId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  useEffect(() => { loadKanban(); }, []);

  const loadKanban = async () => {
    try {
      const res = await api.get('/candidates/kanban');
      setKanban(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const moveCandidate = async (id, newStatus) => {
    try {
      await api.put(`/candidates/${id}/status`, { status: newStatus });
      loadKanban();
      if (selected?.id === id) setSelected({ ...selected, status: newStatus });
    } catch (err) { console.error(err); }
  };

  const createCandidate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/candidates', form);
      setShowForm(false);
      setForm({ first_name: '', last_name: '', email: '', phone: '', gender: '' });
      loadKanban();
    } catch (err) { console.error(err); }
  };

  const handleCVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('cv', file);
    try {
      const res = await api.post('/candidates/upload-cv-new', formData);
      loadKanban();
      alert(`Candidat créé : ${res.data.candidate.first_name || 'N/A'} ${res.data.candidate.last_name || 'N/A'}`);
    } catch (err) { console.error(err); }
  };

  const openEdit = (candidate) => {
    setEditForm({
      first_name: candidate.first_name || '',
      last_name: candidate.last_name || '',
      email: candidate.email || '',
      phone: candidate.phone || '',
      gender: candidate.gender || '',
      has_permis_b: candidate.has_permis_b || false,
      has_caces: candidate.has_caces || false,
      interviewer_name: candidate.interviewer_name || '',
      interview_comment: candidate.interview_comment || '',
      appointment_date: candidate.appointment_date ? candidate.appointment_date.split('T')[0] : '',
      appointment_location: candidate.appointment_location || '',
      practical_test_done: candidate.practical_test_done || false,
      practical_test_result: candidate.practical_test_result || '',
      practical_test_comment: candidate.practical_test_comment || '',
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    try {
      await api.put(`/candidates/${selected.id}`, editForm);
      setEditing(false);
      const updated = { ...selected, ...editForm };
      setSelected(updated);
      loadKanban();
    } catch (err) { console.error(err); }
  };

  // Drag & drop handlers
  const onDragStart = (e, candidateId) => {
    setDraggedId(candidateId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', candidateId);
  };

  const onDragEnd = () => {
    setDraggedId(null);
    setDragOver(null);
  };

  const onDragOverColumn = (e, status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(status);
  };

  const onDragLeaveColumn = (e, status) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (dragOver === status) setDragOver(null);
  };

  const onDropColumn = (e, status) => {
    e.preventDefault();
    setDragOver(null);
    const id = parseInt(e.dataTransfer.getData('text/plain'));
    if (id && !isNaN(id)) {
      moveCandidate(id, status);
    }
    setDraggedId(null);
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Recrutement</h1>
            <p className="text-gray-500">Gestion des candidatures — Vue Kanban (glissez les cartes entre colonnes)</p>
          </div>
          <div className="flex gap-2">
            <label className="bg-white border border-solidata-green text-solidata-green px-4 py-2 rounded-lg cursor-pointer hover:bg-solidata-green/5 text-sm font-medium">
              Importer CV
              <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleCVUpload} />
            </label>
            <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
              + Nouveau candidat
            </button>
          </div>
        </div>

        {/* Kanban Board with drag & drop */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div
              key={status}
              className={`flex-shrink-0 w-72 rounded-xl border-2 p-3 transition-colors ${
                dragOver === status ? STATUS_DROP_COLORS[status] : STATUS_COLORS[status]
              }`}
              onDragOver={(e) => onDragOverColumn(e, status)}
              onDragLeave={(e) => onDragLeaveColumn(e, status)}
              onDrop={(e) => onDropColumn(e, status)}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">{label}</h3>
                <span className="bg-white rounded-full px-2 py-0.5 text-xs font-bold">
                  {kanban?.[status]?.length || 0}
                </span>
              </div>
              <div className="space-y-2 max-h-[65vh] overflow-y-auto">
                {kanban?.[status]?.map(c => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, c.id)}
                    onDragEnd={onDragEnd}
                    onClick={() => setSelected(c)}
                    className={`bg-white rounded-lg p-3 shadow-sm cursor-grab hover:shadow-md transition border active:cursor-grabbing ${
                      draggedId === c.id ? 'opacity-40' : ''
                    }`}
                  >
                    <p className="font-medium text-sm text-solidata-dark">
                      {c.first_name || '?'} {c.last_name || '?'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{c.email || 'Pas d\'email'}</p>
                    {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                    <div className="flex gap-1 mt-2">
                      {c.has_permis_b && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Permis B</span>}
                      {c.has_caces && <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">CACES</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Detail Panel with edit */}
        {selected && (
          <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => { setSelected(null); setEditing(false); }}>
            <div className="bg-white w-[420px] h-full overflow-y-auto shadow-xl p-6" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold">Fiche candidat</h2>
                <div className="flex gap-2">
                  {!editing && (
                    <button onClick={() => openEdit(selected)} className="text-sm bg-solidata-green text-white px-3 py-1 rounded-lg hover:bg-solidata-green-dark">
                      Modifier
                    </button>
                  )}
                  <button onClick={() => { setSelected(null); setEditing(false); }} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>
              </div>

              {editing ? (
                <div className="space-y-3 text-sm">
                  <EditField label="Prénom" value={editForm.first_name} onChange={v => setEditForm({...editForm, first_name: v})} />
                  <EditField label="Nom" value={editForm.last_name} onChange={v => setEditForm({...editForm, last_name: v})} />
                  <EditField label="Email" value={editForm.email} onChange={v => setEditForm({...editForm, email: v})} type="email" />
                  <EditField label="Téléphone" value={editForm.phone} onChange={v => setEditForm({...editForm, phone: v})} />
                  <div>
                    <span className="text-gray-500 text-xs">Genre</span>
                    <select value={editForm.gender} onChange={e => setEditForm({...editForm, gender: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                      <option value="">—</option>
                      <option value="homme">Homme</option>
                      <option value="femme">Femme</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editForm.has_permis_b} onChange={e => setEditForm({...editForm, has_permis_b: e.target.checked})} />
                      Permis B
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editForm.has_caces} onChange={e => setEditForm({...editForm, has_caces: e.target.checked})} />
                      CACES
                    </label>
                  </div>

                  <hr className="my-2" />
                  <p className="text-xs font-semibold text-gray-600 uppercase">Entretien</p>
                  <EditField label="Intervieweur" value={editForm.interviewer_name} onChange={v => setEditForm({...editForm, interviewer_name: v})} />
                  <div>
                    <span className="text-gray-500 text-xs">Commentaire entretien</span>
                    <textarea value={editForm.interview_comment} onChange={e => setEditForm({...editForm, interview_comment: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" rows={3} />
                  </div>
                  <EditField label="Date RDV" value={editForm.appointment_date} onChange={v => setEditForm({...editForm, appointment_date: v})} type="date" />
                  <EditField label="Lieu RDV" value={editForm.appointment_location} onChange={v => setEditForm({...editForm, appointment_location: v})} />

                  <hr className="my-2" />
                  <p className="text-xs font-semibold text-gray-600 uppercase">Test pratique</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editForm.practical_test_done} onChange={e => setEditForm({...editForm, practical_test_done: e.target.checked})} />
                    Test effectué
                  </label>
                  <EditField label="Résultat" value={editForm.practical_test_result} onChange={v => setEditForm({...editForm, practical_test_result: v})} />
                  <div>
                    <span className="text-gray-500 text-xs">Commentaire test</span>
                    <textarea value={editForm.practical_test_comment} onChange={e => setEditForm({...editForm, practical_test_comment: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" rows={2} />
                  </div>

                  <div className="flex gap-2 mt-4">
                    <button onClick={() => setEditing(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                    <button onClick={saveEdit} className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm hover:bg-solidata-green-dark">Enregistrer</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <Field label="Prénom" value={selected.first_name} />
                  <Field label="Nom" value={selected.last_name} />
                  <Field label="Email" value={selected.email} />
                  <Field label="Téléphone" value={selected.phone} />
                  <Field label="Genre" value={selected.gender} />
                  <Field label="Statut" value={STATUS_LABELS[selected.status]} />
                  <Field label="Permis B" value={selected.has_permis_b ? 'Oui' : 'Non'} />
                  <Field label="CACES" value={selected.has_caces ? 'Oui' : 'Non'} />
                  {selected.interviewer_name && <Field label="Intervieweur" value={selected.interviewer_name} />}
                  {selected.interview_comment && <Field label="Commentaire" value={selected.interview_comment} />}
                  {selected.appointment_date && <Field label="Date RDV" value={new Date(selected.appointment_date).toLocaleDateString('fr-FR')} />}
                  {selected.appointment_location && <Field label="Lieu RDV" value={selected.appointment_location} />}
                  {selected.practical_test_done && <Field label="Test effectué" value="Oui" />}
                  {selected.practical_test_result && <Field label="Résultat test" value={selected.practical_test_result} />}
                  {selected.practical_test_comment && <Field label="Commentaire test" value={selected.practical_test_comment} />}
                </div>
              )}
            </div>
          </div>
        )}

        {/* New Candidate Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createCandidate} className="bg-white rounded-xl p-6 w-96 shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouveau candidat</h2>
              <div className="space-y-3">
                <input placeholder="Prénom" value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Nom" value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input placeholder="Téléphone" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <select value={form.gender} onChange={e => setForm({...form, gender: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">Genre</option>
                  <option value="homme">Homme</option>
                  <option value="femme">Femme</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Créer</button>
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

function EditField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <span className="text-gray-500 text-xs">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
    </div>
  );
}
