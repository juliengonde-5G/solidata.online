import { useState, useEffect } from 'react';
import { Building2, Plus, Download, Link2 } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge, Modal, PageHeader, ErrorState } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

const TYPE_LABELS = { recycleur: 'Recycleur', negociant: 'Négociant', industriel: 'Industriel', autre: 'Autre' };

// Ce que l'import Pennylane fera de chaque client, en clair.
const OPERATION_LABELS = {
  creer: { label: 'À créer', color: 'bg-emerald-100 text-emerald-700' },
  relier: { label: 'À rapprocher', color: 'bg-blue-100 text-blue-700' },
  inchange: { label: 'Déjà lié', color: 'bg-slate-100 text-slate-600' },
  ambigu: { label: 'Ambigu — non traité', color: 'bg-amber-100 text-amber-800' },
  ignore: { label: 'Ignoré', color: 'bg-slate-100 text-slate-500' },
};

const EMPTY_FORM = {
  raison_sociale: '', siret: '', adresse: '', code_postal: '', ville: '',
  contact_nom: '', contact_email: '', contact_telephone: '', type_client: 'recycleur',
};

export default function ExutoiresClients() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Import Pennylane (lot L7) — PULL seul, prévisualisation obligatoire.
  const [showImport, setShowImport] = useState(false);
  const [apercu, setApercu] = useState(null);
  const [bilan, setBilan] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importErr, setImportErr] = useState('');

  useEffect(() => { loadClients(); }, []);

  const ouvrirImport = async () => {
    setShowImport(true);
    setApercu(null); setBilan(null); setImportErr(''); setImportBusy(true);
    try {
      const res = await api.get('/pennylane/customers', { params: { limit: 200 } });
      setApercu(res.data);
    } catch (err) {
      console.error(err);
      setImportErr(err.response?.data?.error || "Impossible de lire les clients depuis Pennylane. Vérifiez que la connexion Pennylane est active.");
    }
    setImportBusy(false);
  };

  const appliquerImport = async () => {
    setImportErr(''); setImportBusy(true);
    try {
      const res = await api.post('/pennylane/customers/import', { limit: 500 });
      setBilan(res.data);
      loadClients();
    } catch (err) {
      console.error(err);
      setImportErr(err.response?.data?.error || "L'import des clients Pennylane a échoué.");
    }
    setImportBusy(false);
  };

  const loadClients = async () => {
    try {
      const res = await api.get('/clients-exutoires');
      setClients(res.data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Impossible de charger les clients exutoires. Vérifiez votre connexion puis réessayez.');
    }
    setLoading(false);
  };

  const filtered = clients.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.raison_sociale || '').toLowerCase().includes(q) || (c.ville || '').toLowerCase().includes(q) || (c.contact_nom || '').toLowerCase().includes(q);
  });

  const stats = {
    total: clients.filter(c => c.is_active !== false).length,
    recycleur: clients.filter(c => c.type_client === 'recycleur' && c.is_active !== false).length,
    negociant: clients.filter(c => c.type_client === 'negociant' && c.is_active !== false).length,
    industriel: clients.filter(c => c.type_client === 'industriel' && c.is_active !== false).length,
  };

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM }); setShowForm(true); };
  const openEdit = (client) => {
    setEditing(client);
    setForm({
      raison_sociale: client.raison_sociale || '', siret: client.siret || '', adresse: client.adresse || '',
      code_postal: client.code_postal || '', ville: client.ville || '', contact_nom: client.contact_nom || '',
      contact_email: client.contact_email || '', contact_telephone: client.contact_telephone || '', type_client: client.type_client || 'recycleur',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) { await api.put(`/clients-exutoires/${editing.id}`, form); }
      else { await api.post('/clients-exutoires', form); }
      setShowForm(false); setEditing(null); setForm({ ...EMPTY_FORM }); loadClients();
    } catch (err) { console.error(err); }
  };

  const handleDisable = async (client) => {
    const ok = await confirm({
      title: 'Désactiver ce client ?',
      message: `Désactiver "${client.raison_sociale}" ? Le client sera masqué des nouvelles commandes mais l'historique reste intact.`,
      confirmLabel: 'Désactiver',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try { await api.delete(`/clients-exutoires/${client.id}`); loadClients(); } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des clients..." /></Layout>;

  const columns = [
    {
      key: 'raison_sociale', label: 'Raison sociale', sortable: true,
      render: (c) => (
        <span className="font-medium inline-flex items-center gap-1.5">
          {c.raison_sociale}
          {/* Badge « lié Pennylane » : dit d'où vient la fiche, et rappelle que
              son nom comptable peut différer de la raison sociale saisie ici. */}
          {c.pennylane_customer_id && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700"
              title={c.pennylane_customer_name ? `Pennylane : ${c.pennylane_customer_name}` : 'Client lié à Pennylane'}
            >
              <Link2 className="w-2.5 h-2.5" />
              Pennylane
            </span>
          )}
        </span>
      ),
    },
    { key: 'ville', label: 'Ville', sortable: true, render: (c) => c.ville || '—' },
    {
      key: 'type_client', label: 'Type', sortable: true,
      render: (c) => <StatusBadge status={c.type_client || 'autre'} size="sm" label={TYPE_LABELS[c.type_client] || c.type_client || '—'} />,
    },
    { key: 'contact_nom', label: 'Contact', render: (c) => c.contact_nom || '—' },
    { key: 'contact_email', label: 'Email', render: (c) => c.contact_email || '—' },
    { key: 'contact_telephone', label: 'Téléphone', render: (c) => c.contact_telephone || '—' },
    {
      key: 'actions', label: '',
      render: (c) => (
        <div className="flex gap-2">
          <button onClick={() => openEdit(c)} className="text-primary hover:underline text-xs font-medium">Modifier</button>
          <button onClick={() => handleDisable(c)} className="text-red-500 hover:underline text-xs font-medium">Désactiver</button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      {ConfirmDialogElement}
      <div className="p-6">
        <PageHeader
          title="Clients Logistiques"
          subtitle="Gestion des clients et débouchés"
          icon={Building2}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={ouvrirImport} className="btn-ghost text-sm flex items-center">
                <Download className="w-4 h-4 mr-2" strokeWidth={1.8} />
                Importer depuis Pennylane
              </button>
              <button onClick={openCreate} className="btn-primary text-sm">
                <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
                Nouveau client
              </button>
            </div>
          }
        />

        {error && (
          <div className="mb-6">
            <ErrorState variant="card" title="Clients indisponibles" message={error} onRetry={loadClients} />
          </div>
        )}

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="card-modern p-4"><p className="text-xs text-slate-500 font-medium">Total clients actifs</p><p className="text-2xl font-bold text-slate-800">{stats.total}</p></div>
          <div className="card-modern p-4"><p className="text-xs text-slate-500 font-medium">Recycleurs</p><p className="text-2xl font-bold text-green-600">{stats.recycleur}</p></div>
          <div className="card-modern p-4"><p className="text-xs text-slate-500 font-medium">Négociants</p><p className="text-2xl font-bold text-blue-600">{stats.negociant}</p></div>
          <div className="card-modern p-4"><p className="text-xs text-slate-500 font-medium">Industriels</p><p className="text-2xl font-bold text-orange-600">{stats.industriel}</p></div>
        </div>

        <div className="mb-4">
          <input placeholder="Rechercher par raison sociale, ville ou contact..." value={search} onChange={e => setSearch(e.target.value)} className="input-modern w-80" />
        </div>

        <DataTable columns={columns} data={filtered} loading={false} emptyIcon={Building2} emptyMessage="Aucun client logistique" />

        {/* Import Pennylane — prévisualisation PUIS application */}
        <Modal
          isOpen={showImport}
          onClose={() => { setShowImport(false); setApercu(null); setBilan(null); setImportErr(''); }}
          title="Importer les clients depuis Pennylane"
          size="lg"
        >
          <p className="text-sm text-slate-600 mb-3">
            Lecture seule : SOLIDATA récupère les clients du dossier comptable et les rapproche du
            référentiel logistique. <strong>Aucun client n'est supprimé ni désactivé</strong>, et une
            information déjà saisie ici n'est jamais écrasée — seuls les champs vides sont complétés.
          </p>

          {importErr && (
            <div className="mb-4">
              <ErrorState variant="card" title="Import Pennylane indisponible" message={importErr} onRetry={ouvrirImport} />
            </div>
          )}

          {importBusy && !apercu && !bilan && <LoadingSpinner message="Lecture des clients Pennylane..." />}

          {bilan ? (
            <>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm mb-3">
                <p className="font-semibold text-emerald-800">Import terminé</p>
                <p className="text-emerald-900 mt-1">{bilan.message}</p>
              </div>
              {bilan.ambigus?.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-semibold text-amber-900">Laissés de côté — à trancher à la main</p>
                  <p className="text-amber-800 text-xs mt-1">
                    Plusieurs clients de l'ERP portent le même nom : les rapprocher au hasard
                    mélangerait leurs commandes et leurs factures.
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-amber-900">
                    {bilan.ambigus.map((a) => (
                      <li key={a.pennylane_customer_id}>
                        <span className="font-medium">{a.nom}</span> —{' '}
                        {(a.candidats || []).map((c) => `${c.raison_sociale}${c.ville ? ` (${c.ville})` : ''}`).join(' / ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => { setShowImport(false); setApercu(null); setBilan(null); }}
                  className="flex-1 btn-primary text-sm"
                >
                  Fermer
                </button>
              </div>
            </>
          ) : apercu ? (
            <>
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-center">
                  <p className="text-[11px] text-emerald-700">À créer</p>
                  <p className="text-xl font-bold text-emerald-800">{apercu.resume.a_creer}</p>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-2 text-center">
                  <p className="text-[11px] text-blue-700">À rapprocher</p>
                  <p className="text-xl font-bold text-blue-800">{apercu.resume.a_relier}</p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-center">
                  <p className="text-[11px] text-slate-600">Déjà liés</p>
                  <p className="text-xl font-bold text-slate-700">{apercu.resume.deja_lies}</p>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-center">
                  <p className="text-[11px] text-amber-700">Ambigus</p>
                  <p className="text-xl font-bold text-amber-800">{apercu.resume.ambigus}</p>
                </div>
              </div>

              {apercu.recuperes === 0 ? (
                <p className="text-sm text-slate-600">
                  Aucun client renvoyé par Pennylane. Vérifiez que la clé API a bien l'habilitation
                  de lecture des clients (« customers »).
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr className="text-left text-slate-500">
                        <th className="py-1.5 px-2 font-medium">Client Pennylane</th>
                        <th className="py-1.5 px-2 font-medium">Ville</th>
                        <th className="py-1.5 px-2 font-medium">Ce qui sera fait</th>
                        <th className="py-1.5 px-2 font-medium">Client ERP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apercu.clients.map((c) => {
                        const op = OPERATION_LABELS[c.operation] || { label: c.operation, color: 'bg-slate-100 text-slate-600' };
                        return (
                          <tr key={c.pennylane_customer_id} className="border-t border-slate-100">
                            <td className="py-1.5 px-2 font-medium">{c.nom}</td>
                            <td className="py-1.5 px-2 text-slate-500">{c.ville || '—'}</td>
                            <td className="py-1.5 px-2">
                              <span className={`px-2 py-0.5 rounded-full font-medium ${op.color}`}>{op.label}</span>
                            </td>
                            <td className="py-1.5 px-2 text-slate-500">
                              {c.client_exutoire_nom
                                || (c.candidats ? c.candidats.map((x) => x.raison_sociale).join(' / ') : '—')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {apercu.has_more && (
                <p className="text-xs text-slate-500 mt-2">
                  Pennylane a d'autres clients au-delà de cet aperçu ({apercu.limite_appliquee} premiers) —
                  l'import en traitera jusqu'à 500.
                </p>
              )}

              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowImport(false)} className="flex-1 btn-ghost">Annuler</button>
                <button
                  type="button"
                  onClick={appliquerImport}
                  disabled={importBusy || apercu.recuperes === 0}
                  className="flex-1 btn-primary text-sm disabled:opacity-50"
                >
                  {importBusy ? 'Import en cours…' : 'Importer'}
                </button>
              </div>
            </>
          ) : null}
        </Modal>

        <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Modifier le client' : 'Nouveau client logistique'} size="md">
          <form onSubmit={handleSubmit}>
            <div className="space-y-3">
              <div><label className="text-xs text-slate-500">Raison sociale *</label><input value={form.raison_sociale} onChange={e => setForm({ ...form, raison_sociale: e.target.value })} className="input-modern mt-1" required /></div>
              <div><label className="text-xs text-slate-500">SIRET</label><input value={form.siret} onChange={e => setForm({ ...form, siret: e.target.value })} className="input-modern mt-1" /></div>
              <div><label className="text-xs text-slate-500">Adresse *</label><textarea value={form.adresse} onChange={e => setForm({ ...form, adresse: e.target.value })} className="input-modern mt-1" rows={2} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-500">Code postal *</label><input value={form.code_postal} onChange={e => setForm({ ...form, code_postal: e.target.value })} className="input-modern mt-1" required /></div>
                <div><label className="text-xs text-slate-500">Ville *</label><input value={form.ville} onChange={e => setForm({ ...form, ville: e.target.value })} className="input-modern mt-1" required /></div>
              </div>
              <div><label className="text-xs text-slate-500">Nom du contact *</label><input value={form.contact_nom} onChange={e => setForm({ ...form, contact_nom: e.target.value })} className="input-modern mt-1" required /></div>
              <div><label className="text-xs text-slate-500">Email du contact *</label><input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} className="input-modern mt-1" required /></div>
              <div><label className="text-xs text-slate-500">Téléphone du contact</label><input value={form.contact_telephone} onChange={e => setForm({ ...form, contact_telephone: e.target.value })} className="input-modern mt-1" /></div>
              <div><label className="text-xs text-slate-500">Type de client</label>
                <select value={form.type_client} onChange={e => setForm({ ...form, type_client: e.target.value })} className="input-modern mt-1">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="flex-1 btn-ghost">Annuler</button>
              <button type="submit" className="flex-1 btn-primary text-sm">{editing ? 'Enregistrer' : 'Créer'}</button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
