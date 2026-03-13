import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const LIEUX = {
  quai_chargement: 'Quai de chargement',
  garage_remorque: 'Garage remorque',
  cours: 'Cours'
};

const STATUTS_PREP = {
  planifiee: { label: 'Planifiée', color: 'bg-gray-100 text-gray-700' },
  remorque_livree: { label: 'Remorque livrée', color: 'bg-blue-100 text-blue-700' },
  en_chargement: { label: 'En chargement', color: 'bg-yellow-100 text-yellow-700' },
  prete: { label: 'Prête', color: 'bg-green-100 text-green-700' },
  expediee: { label: 'Expédiée', color: 'bg-purple-100 text-purple-700' },
};

const TYPES_PRODUIT = {
  original: 'Original', csr: 'CSR', effilo_blanc: 'Effilo Blanc',
  effilo_couleur: 'Effilo Couleur', jean: 'Jean', coton_blanc: 'Coton Blanc', coton_couleur: 'Coton Couleur'
};

const EMPTY_FORM = {
  commande_id: '',
  transporteur: '',
  date_livraison_remorque: '',
  date_expedition: '',
  lieu_chargement: 'quai_chargement',
  collaborateurs: [],
  notes_preparation: '',
};

export default function ExutoiresPreparation() {
  const [preparations, setPreparations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [commandes, setCommandes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [conflitWarning, setConflitWarning] = useState('');

  // Filters
  const [filterLieu, setFilterLieu] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Pesée modal
  const [showPesee, setShowPesee] = useState(null);
  const [peseeValue, setPeseeValue] = useState('');

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!loading) loadPreparations();
  }, [filterLieu, filterStatut, filterDateFrom, filterDateTo]);

  const loadData = async () => {
    try {
      const [prepRes, cmdRes, empRes] = await Promise.all([
        api.get('/preparations'),
        api.get('/commandes-exutoires', { params: { statut: 'confirmee' } }),
        api.get('/employees'),
      ]);
      setPreparations(prepRes.data);
      setCommandes(cmdRes.data);
      setEmployees(empRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const loadPreparations = async () => {
    try {
      const params = {};
      if (filterLieu) params.lieu_chargement = filterLieu;
      if (filterStatut) params.statut_preparation = filterStatut;
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;
      const res = await api.get('/preparations', { params });
      setPreparations(res.data);
    } catch (err) { console.error(err); }
  };

  const checkConflits = async (lieu, dateRemorque, dateExp) => {
    if (!lieu || !dateRemorque) { setConflitWarning(''); return; }
    try {
      const res = await api.get('/preparations/conflits', {
        params: {
          lieu_chargement: lieu,
          date_livraison_remorque: dateRemorque,
          date_expedition: dateExp,
          exclude_id: editing?.id,
        },
      });
      if (res.data && res.data.length > 0) {
        setConflitWarning(`Conflit détecté : ${res.data.length} préparation(s) sur ce lieu aux mêmes dates.`);
      } else {
        setConflitWarning('');
      }
    } catch { setConflitWarning(''); }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setConflitWarning('');
    setShowForm(true);
  };

  const openEdit = (prep) => {
    setEditing(prep);
    setForm({
      commande_id: prep.commande_id || '',
      transporteur: prep.transporteur || '',
      date_livraison_remorque: prep.date_livraison_remorque ? prep.date_livraison_remorque.slice(0, 16) : '',
      date_expedition: prep.date_expedition ? prep.date_expedition.slice(0, 16) : '',
      lieu_chargement: prep.lieu_chargement || 'quai_chargement',
      collaborateurs: prep.collaborateurs || [],
      notes_preparation: prep.notes_preparation || '',
    });
    setConflitWarning('');
    setShowForm(true);
  };

  const handleFormChange = (field, value) => {
    const updated = { ...form, [field]: value };
    setForm(updated);
    if (field === 'lieu_chargement' || field === 'date_livraison_remorque' || field === 'date_expedition') {
      checkConflits(updated.lieu_chargement, updated.date_livraison_remorque, updated.date_expedition);
    }
  };

  const toggleCollaborateur = (id) => {
    setForm(prev => ({
      ...prev,
      collaborateurs: prev.collaborateurs.includes(id)
        ? prev.collaborateurs.filter(c => c !== id)
        : [...prev.collaborateurs, id],
    }));
  };

  const submitForm = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/preparations/${editing.id}`, form);
      } else {
        await api.post('/preparations', form);
      }
      setShowForm(false);
      loadPreparations();
    } catch (err) { console.error(err); }
  };

  const deletePrep = async (id) => {
    if (!window.confirm('Supprimer cette préparation ?')) return;
    try {
      await api.delete(`/preparations/${id}`);
      loadPreparations();
    } catch (err) { console.error(err); }
  };

  const changeStatut = async (id, newStatut, pesee) => {
    try {
      const body = { statut_preparation: newStatut };
      if (pesee !== undefined) body.pesee_interne = pesee;
      await api.patch(`/preparations/${id}/statut`, body);
      loadPreparations();
    } catch (err) { console.error(err); }
  };

  const handleFinChargement = (prep) => {
    setShowPesee(prep);
    setPeseeValue('');
  };

  const submitPesee = () => {
    if (showPesee && peseeValue) {
      changeStatut(showPesee.id, 'prete', parseFloat(peseeValue));
      setShowPesee(null);
    }
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  const fmtDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const fmtShort = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Préparation & Chargement</h1>
            <p className="text-gray-500 text-sm">Gestion des préparations et chargements</p>
          </div>
          <button onClick={openCreate} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Nouvelle préparation
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              value={filterLieu}
              onChange={e => setFilterLieu(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Tous les lieux</option>
              {Object.entries(LIEUX).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={filterStatut}
              onChange={e => setFilterStatut(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Tous les statuts</option>
              {Object.entries(STATUTS_PREP).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Date début"
            />
            <input
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Date fin"
            />
          </div>
        </div>

        {/* Preparation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {preparations.map(prep => {
            const statut = STATUTS_PREP[prep.statut_preparation] || STATUTS_PREP.planifiee;
            return (
              <div key={prep.id} className="bg-white rounded-xl shadow-sm border p-5 relative flex flex-col gap-3">
                {/* Status badge */}
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-solidata-dark truncate">
                      {prep.commande_reference || `CMD-${prep.commande_id}`}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {TYPES_PRODUIT[prep.type_produit] || prep.type_produit || '—'}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${statut.color}`}>
                    {statut.label}
                  </span>
                </div>

                {/* Client & Transporteur */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <span className="text-gray-700 truncate">{prep.client_nom || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <span className="text-gray-600 truncate">{prep.transporteur || '—'}</span>
                  </div>
                </div>

                {/* Lieu de chargement */}
                <div className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                  <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-gray-700 font-medium">{LIEUX[prep.lieu_chargement] || prep.lieu_chargement || '—'}</span>
                </div>

                {/* Dates */}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{fmtDate(prep.date_livraison_remorque)}</span>
                  <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <span>{fmtDate(prep.date_expedition)}</span>
                </div>

                {/* Collaborateurs */}
                {prep.collaborateurs_noms && prep.collaborateurs_noms.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {prep.collaborateurs_noms.map((nom, i) => (
                      <span
                        key={i}
                        title={nom}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-solidata-green/10 text-solidata-green text-xs font-bold"
                      >
                        {getInitials(nom)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Pesée */}
                {prep.pesee_interne != null && (
                  <div className="text-sm">
                    <span className="text-gray-500">Pesée interne :</span>{' '}
                    <span className="font-semibold text-solidata-dark">{prep.pesee_interne} t</span>
                  </div>
                )}

                {/* Timeline */}
                <div className="border-t pt-3 mt-1">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {prep.ts_reception && (
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                        <span className="text-gray-500">Réception</span>
                        <span className="text-gray-700 ml-auto">{fmtShort(prep.ts_reception)}</span>
                      </div>
                    )}
                    {prep.ts_debut_chargement && (
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                        <span className="text-gray-500">Début</span>
                        <span className="text-gray-700 ml-auto">{fmtShort(prep.ts_debut_chargement)}</span>
                      </div>
                    )}
                    {prep.ts_fin_chargement && (
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                        <span className="text-gray-500">Fin</span>
                        <span className="text-gray-700 ml-auto">{fmtShort(prep.ts_fin_chargement)}</span>
                      </div>
                    )}
                    {prep.ts_depart && (
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                        <span className="text-gray-500">Départ</span>
                        <span className="text-gray-700 ml-auto">{fmtShort(prep.ts_depart)}</span>
                      </div>
                    )}
                    {!prep.ts_reception && !prep.ts_debut_chargement && !prep.ts_fin_chargement && !prep.ts_depart && (
                      <div className="col-span-2 text-gray-400 italic">Aucun horodatage</div>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 mt-1">
                  {prep.statut_preparation === 'planifiee' && (
                    <button
                      onClick={() => changeStatut(prep.id, 'remorque_livree')}
                      className="flex-1 bg-blue-50 text-blue-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-100"
                    >
                      Remorque livrée
                    </button>
                  )}
                  {prep.statut_preparation === 'remorque_livree' && (
                    <button
                      onClick={() => changeStatut(prep.id, 'en_chargement')}
                      className="flex-1 bg-yellow-50 text-yellow-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-yellow-100"
                    >
                      Début chargement
                    </button>
                  )}
                  {prep.statut_preparation === 'en_chargement' && (
                    <button
                      onClick={() => handleFinChargement(prep)}
                      className="flex-1 bg-green-50 text-green-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-green-100"
                    >
                      Fin chargement
                    </button>
                  )}
                  {prep.statut_preparation === 'prete' && (
                    <button
                      onClick={() => changeStatut(prep.id, 'expediee')}
                      className="flex-1 bg-purple-50 text-purple-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-purple-100"
                    >
                      Expédier
                    </button>
                  )}
                  {prep.statut_preparation !== 'expediee' && (
                    <>
                      <button
                        onClick={() => openEdit(prep)}
                        className="text-gray-400 hover:text-solidata-green p-1"
                        title="Modifier"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deletePrep(prep.id)}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="Supprimer"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {preparations.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-400">
              Aucune préparation trouvée
            </div>
          )}
        </div>

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={submitForm} className="bg-white rounded-xl p-6 w-[520px] shadow-xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold mb-4">
                {editing ? 'Modifier la préparation' : 'Nouvelle préparation'}
              </h2>
              <div className="space-y-3">
                {/* Commande */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Commande *</label>
                  <select
                    value={form.commande_id}
                    onChange={e => handleFormChange('commande_id', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    required
                  >
                    <option value="">Sélectionner une commande</option>
                    {commandes.map(cmd => (
                      <option key={cmd.id} value={cmd.id}>
                        {cmd.reference} — {cmd.client_nom || 'Client'} — {TYPES_PRODUIT[cmd.type_produit] || cmd.type_produit}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Transporteur */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Transporteur *</label>
                  <input
                    type="text"
                    placeholder="Nom du transporteur"
                    value={form.transporteur}
                    onChange={e => handleFormChange('transporteur', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Livraison remorque *</label>
                    <input
                      type="datetime-local"
                      value={form.date_livraison_remorque}
                      onChange={e => handleFormChange('date_livraison_remorque', e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Expédition *</label>
                    <input
                      type="datetime-local"
                      value={form.date_expedition}
                      onChange={e => handleFormChange('date_expedition', e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      required
                    />
                  </div>
                </div>

                {/* Lieu */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Lieu de chargement *</label>
                  <select
                    value={form.lieu_chargement}
                    onChange={e => handleFormChange('lieu_chargement', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    required
                  >
                    {Object.entries(LIEUX).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                {/* Conflict warning */}
                {conflitWarning && (
                  <div className="bg-orange-50 border border-orange-200 text-orange-700 text-xs rounded-lg px-3 py-2 flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    {conflitWarning}
                  </div>
                )}

                {/* Collaborateurs */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Collaborateurs</label>
                  <div className="border rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                    {employees.map(emp => (
                      <label key={emp.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={form.collaborateurs.includes(emp.id)}
                          onChange={() => toggleCollaborateur(emp.id)}
                          className="rounded border-gray-300 text-solidata-green focus:ring-solidata-green"
                        />
                        <span>{emp.prenom} {emp.nom}</span>
                      </label>
                    ))}
                    {employees.length === 0 && (
                      <p className="text-xs text-gray-400 px-2 py-1">Aucun collaborateur disponible</p>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <textarea
                    placeholder="Notes de préparation..."
                    value={form.notes_preparation}
                    onChange={e => handleFormChange('notes_preparation', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    rows="3"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium">
                  {editing ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Pesée Modal */}
        {showPesee && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-[360px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Pesée interne</h2>
              <p className="text-sm text-gray-500 mb-3">
                Saisir le poids pour terminer le chargement de{' '}
                <span className="font-medium text-gray-700">{showPesee.commande_reference || `CMD-${showPesee.commande_id}`}</span>
              </p>
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-1">Pesée interne (tonnes)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="Ex: 24.500"
                  value={peseeValue}
                  onChange={e => setPeseeValue(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowPesee(null)}
                  className="flex-1 border rounded-lg py-2 text-sm"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={submitPesee}
                  disabled={!peseeValue}
                  className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                >
                  Valider
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
