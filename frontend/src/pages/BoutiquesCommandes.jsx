import { useState, useEffect } from 'react';
import { ClipboardList, Plus, Send, Edit, Truck, Package, XCircle, CheckCircle } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, useToast } from '../components';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const STATUT_LABELS = {
  brouillon: 'Brouillon',
  envoyee: 'Envoyée',
  ajustee: 'Ajustée',
  en_preparation: 'En préparation',
  expediee: 'Expédiée',
  annulee: 'Annulée',
};
const STATUT_COLORS = {
  brouillon: 'bg-slate-100 text-slate-700',
  envoyee: 'bg-blue-100 text-blue-700',
  ajustee: 'bg-amber-100 text-amber-700',
  en_preparation: 'bg-indigo-100 text-indigo-700',
  expediee: 'bg-green-100 text-green-700',
  annulee: 'bg-red-100 text-red-700',
};

const COLUMNS = [
  { key: 'nouvelles', label: 'Nouvelles', statuts: ['brouillon', 'envoyee'] },
  { key: 'preparation', label: 'En préparation', statuts: ['ajustee', 'en_preparation'] },
  { key: 'expediees', label: 'Expédiées / Annulées', statuts: ['expediee', 'annulee'] },
];

const CATEGORIES = ['FEMME', 'ENFANTS', 'LAYETTES', 'KINTSU', 'ACCESSOIRES', 'CHAUSSURES', 'AUTRE'];

export default function BoutiquesCommandes() {
  const { user } = useAuth();
  const toast = useToast();
  const [boutiques, setBoutiques] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [detailData, setDetailData] = useState(null);

  const [form, setForm] = useState({
    boutique_id: '',
    date_commande: new Date().toISOString().slice(0, 10),
    date_livraison_souhaitee: '',
    notes: '',
    lignes: [{ categorie: 'FEMME', poids_demande_kg: '' }],
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([
        api.get('/boutiques?active=true'),
        api.get('/boutique-commandes'),
      ]);
      setBoutiques(b.data || []);
      setCommandes(c.data || []);
      if (b.data?.length > 0 && !form.boutique_id) setForm(f => ({ ...f, boutique_id: String(b.data[0].id) }));
    } catch (e) { toast.error('Erreur chargement'); }
    setLoading(false);
  }

  async function openDetail(id) {
    setShowDetail(id);
    try {
      const res = await api.get(`/boutique-commandes/${id}`);
      setDetailData(res.data);
    } catch (e) { toast.error('Erreur'); }
  }

  async function createCommande() {
    if (!form.boutique_id || form.lignes.some(l => !l.poids_demande_kg)) {
      toast.error('Boutique et poids requis');
      return;
    }
    try {
      await api.post('/boutique-commandes', {
        boutique_id: parseInt(form.boutique_id),
        date_commande: form.date_commande,
        date_livraison_souhaitee: form.date_livraison_souhaitee || null,
        notes: form.notes,
        lignes: form.lignes.map(l => ({
          categorie: l.categorie,
          poids_demande_kg: parseFloat(l.poids_demande_kg),
          notes: l.notes,
        })),
      });
      toast.success('Commande créée');
      setShowCreate(false);
      setForm({
        boutique_id: form.boutique_id,
        date_commande: new Date().toISOString().slice(0, 10),
        date_livraison_souhaitee: '',
        notes: '',
        lignes: [{ categorie: 'FEMME', poids_demande_kg: '' }],
      });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur création');
    }
  }

  async function action(id, verbe, extra = {}) {
    try {
      await api.patch(`/boutique-commandes/${id}/${verbe}`, extra);
      toast.success(`Action "${verbe}" effectuée`);
      await load();
      if (showDetail === id) openDetail(id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action refusée');
    }
  }

  const canAdjust = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const canSend = ['ADMIN', 'MANAGER', 'RESP_BTQ'].includes(user?.role);

  const columnCommandes = (col) => commandes.filter(c => col.statuts.includes(c.statut));

  if (loading) return <Layout><LoadingSpinner size="lg" /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <ClipboardList className="w-6 h-6 text-pink-600" />
              Commandes boutiques
            </h1>
            <p className="text-slate-500 mt-1 text-sm">Commandes boutique → atelier produits finis (par lot/poids)</p>
          </div>
          {canSend && (
            <button onClick={() => setShowCreate(true)} className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium">
              <Plus className="w-4 h-4" /> Nouvelle commande
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COLUMNS.map(col => (
            <div key={col.key} className="bg-slate-50 rounded-card p-3">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="font-semibold text-slate-700 text-sm">{col.label}</h3>
                <span className="text-xs text-slate-500">{columnCommandes(col).length}</span>
              </div>
              <div className="space-y-2">
                {columnCommandes(col).map(c => (
                  <div key={c.id} onClick={() => openDetail(c.id)} className="bg-white border border-slate-200 rounded-lg p-3 cursor-pointer hover:shadow-sm transition">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm text-slate-800">{c.reference}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUT_COLORS[c.statut]}`}>{STATUT_LABELS[c.statut]}</span>
                    </div>
                    <div className="text-xs text-slate-500">{c.boutique_nom}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Livraison : {c.date_livraison_souhaitee ? new Date(c.date_livraison_souhaitee).toLocaleDateString('fr-FR') : '—'}
                    </div>
                    <div className="text-xs mt-1 font-medium text-slate-700">
                      {c.nb_lignes} ligne{c.nb_lignes > 1 ? 's' : ''} • {Number(c.poids_total_demande_kg || 0).toFixed(1)} kg
                      {c.poids_total_ajuste_kg && <span className="text-amber-600"> (ajusté : {Number(c.poids_total_ajuste_kg).toFixed(1)})</span>}
                    </div>
                  </div>
                ))}
                {columnCommandes(col).length === 0 && (
                  <p className="text-slate-400 text-xs text-center py-4">Aucune</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modale création */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="Nouvelle commande">
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Boutique</label>
                <select value={form.boutique_id} onChange={(e) => setForm(f => ({ ...f, boutique_id: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">—</option>
                  {boutiques.map(b => <option key={b.id} value={b.id}>{b.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date commande</label>
                <input type="date" value={form.date_commande} onChange={(e) => setForm(f => ({ ...f, date_commande: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Livraison souhaitée (mardi/jeudi)</label>
                <input type="date" value={form.date_livraison_souhaitee} onChange={(e) => setForm(f => ({ ...f, date_livraison_souhaitee: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">Lignes (catégorie + poids en kg)</label>
              {form.lignes.map((l, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <select value={l.categorie} onChange={(e) => {
                    const n = [...form.lignes]; n[i].categorie = e.target.value; setForm(f => ({ ...f, lignes: n }));
                  }} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input type="number" step="0.1" placeholder="Poids kg" value={l.poids_demande_kg} onChange={(e) => {
                    const n = [...form.lignes]; n[i].poids_demande_kg = e.target.value; setForm(f => ({ ...f, lignes: n }));
                  }} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-28" />
                  {form.lignes.length > 1 && (
                    <button onClick={() => {
                      const n = form.lignes.filter((_, j) => j !== i); setForm(f => ({ ...f, lignes: n }));
                    }} className="text-red-500 px-2"><XCircle className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              <button onClick={() => setForm(f => ({ ...f, lignes: [...f.lignes, { categorie: 'FEMME', poids_demande_kg: '' }] }))}
                className="text-xs text-pink-600 hover:text-pink-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Ajouter une ligne
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Annuler</button>
              <button onClick={createCommande} className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Créer</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modale détail */}
      {showDetail && detailData && (
        <Modal onClose={() => { setShowDetail(null); setDetailData(null); }} title={`Commande ${detailData.reference}`}>
          <CommandeDetail
            commande={detailData}
            canAdjust={canAdjust}
            canSend={canSend}
            onAction={action}
            onUpdate={() => openDetail(showDetail)}
          />
        </Modal>
      )}
    </Layout>
  );
}

function CommandeDetail({ commande, canAdjust, canSend, onAction }) {
  const [ajustements, setAjustements] = useState(() =>
    commande.lignes.map(l => ({
      ligne_id: l.id,
      poids_ajuste_kg: l.poids_ajuste_kg ?? l.poids_demande_kg,
    }))
  );

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-slate-500">Boutique :</span> <span className="font-medium">{commande.boutique_nom}</span></div>
        <div><span className="text-slate-500">Statut :</span> <span className={`px-2 py-0.5 rounded text-xs ${STATUT_COLORS[commande.statut]}`}>{STATUT_LABELS[commande.statut]}</span></div>
        <div><span className="text-slate-500">Commande :</span> {new Date(commande.date_commande).toLocaleDateString('fr-FR')}</div>
        <div><span className="text-slate-500">Livraison :</span> {commande.date_livraison_souhaitee ? new Date(commande.date_livraison_souhaitee).toLocaleDateString('fr-FR') : '—'}</div>
        <div><span className="text-slate-500">Créé par :</span> {commande.created_by_name || '—'}</div>
        {commande.ajuste_par_name && <div><span className="text-slate-500">Ajusté par :</span> {commande.ajuste_par_name}</div>}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Lignes</h4>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
            <tr>
              <th className="text-left py-2">Catégorie</th>
              <th className="text-right py-2">Demandé (kg)</th>
              <th className="text-right py-2">Ajusté (kg)</th>
              <th className="text-right py-2">Expédié (kg)</th>
            </tr>
          </thead>
          <tbody>
            {commande.lignes.map((l, i) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-2">{l.categorie}</td>
                <td className="py-2 text-right">{Number(l.poids_demande_kg).toFixed(1)}</td>
                <td className="py-2 text-right">
                  {canAdjust && commande.statut === 'envoyee' ? (
                    <input
                      type="number" step="0.1"
                      value={ajustements[i]?.poids_ajuste_kg ?? ''}
                      onChange={(e) => {
                        const n = [...ajustements];
                        n[i] = { ligne_id: l.id, poids_ajuste_kg: parseFloat(e.target.value) || 0 };
                        setAjustements(n);
                      }}
                      className="w-20 text-right border border-slate-300 rounded px-2 py-1"
                    />
                  ) : (
                    l.poids_ajuste_kg != null ? Number(l.poids_ajuste_kg).toFixed(1) : '—'
                  )}
                </td>
                <td className="py-2 text-right">{l.poids_expedie_kg != null ? Number(l.poids_expedie_kg).toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {commande.historique?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Historique</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {commande.historique.map(h => (
              <div key={h.id} className="text-xs text-slate-600 flex gap-2">
                <span className="text-slate-400">{new Date(h.created_at).toLocaleString('fr-FR')}</span>
                <span>{h.ancien_statut || '—'} → <span className="font-medium">{h.nouveau_statut}</span></span>
                <span className="text-slate-400">par {h.user_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 flex-wrap">
        {commande.statut === 'brouillon' && canSend && (
          <button onClick={() => onAction(commande.id, 'envoyer')} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1">
            <Send className="w-3 h-3" /> Envoyer
          </button>
        )}
        {commande.statut === 'envoyee' && canAdjust && (
          <button onClick={() => onAction(commande.id, 'ajuster', { ajustements })} className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1">
            <Edit className="w-3 h-3" /> Valider ajustement
          </button>
        )}
        {commande.statut === 'ajustee' && canAdjust && (
          <button onClick={() => onAction(commande.id, 'preparer')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1">
            <Package className="w-3 h-3" /> Préparer
          </button>
        )}
        {commande.statut === 'en_preparation' && canAdjust && (
          <button onClick={() => onAction(commande.id, 'expedier')} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1">
            <Truck className="w-3 h-3" /> Expédier (→ sortie stock)
          </button>
        )}
        {!['expediee', 'annulee'].includes(commande.statut) && canSend && (
          <button onClick={() => onAction(commande.id, 'annuler')} className="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm flex items-center gap-1">
            <XCircle className="w-3 h-3" /> Annuler
          </button>
        )}
      </div>
    </div>
  );
}
