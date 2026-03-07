import { useState, useEffect } from 'react';
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

export default function Candidates() {
  const [kanban, setKanban] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', gender: '' });

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

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Recrutement</h1>
            <p className="text-gray-500">Gestion des candidatures — Vue Kanban</p>
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

        {/* Kanban Board */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div key={status} className={`flex-shrink-0 w-72 rounded-xl border-2 ${STATUS_COLORS[status]} p-3`}>
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
                    onClick={() => setSelected(c)}
                    className="bg-white rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition border"
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
                    {/* Move buttons */}
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {Object.entries(STATUS_LABELS).filter(([s]) => s !== status).map(([s, l]) => (
                        <button
                          key={s}
                          onClick={(e) => { e.stopPropagation(); moveCandidate(c.id, s); }}
                          className="text-[9px] bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded transition"
                        >
                          → {l}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={() => setSelected(null)}>
            <div className="bg-white w-96 h-full overflow-y-auto shadow-xl p-6" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold">Fiche candidat</h2>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
              </div>
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
                {selected.practical_test_result && <Field label="Test pratique" value={selected.practical_test_result} />}
              </div>
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
