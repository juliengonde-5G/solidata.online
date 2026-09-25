import { useState, useEffect } from 'react';
import { ClipboardList, Plus, Send, Edit, Truck, Package, XCircle, AlertTriangle, Pencil } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, useToast, PageHeader } from '../components';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import CommandeCatalogue, { ResumeSelection } from '../components/boutiques/CommandeCatalogue';

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

function commandeVide(boutiqueId = '') {
  return {
    mode: 'create',
    commandeId: null,
    boutique_id: boutiqueId,
    date_commande: new Date().toISOString().slice(0, 10),
    date_livraison_souhaitee: '',
    notes: '',
    quantites: {},
    anciennesLignesAuPoids: false,
  };
}

const cleLigne = (l) => [l.gamme, l.produit, l.genre, l.saison].map((v) => String(v ?? '')).join('|');

export default function BoutiquesCommandes() {
  const { user } = useAuth();
  const toast = useToast();
  const [boutiques, setBoutiques] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(null);
  const [detailData, setDetailData] = useState(null);

  // Éditeur de commande (création ou modification d'un brouillon).
  const [editeur, setEditeur] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [catalogueEtat, setCatalogueEtat] = useState('idle'); // idle | chargement | pret | erreur
  const [enregistrement, setEnregistrement] = useState(false);

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
    } catch (e) { toast.error('Erreur chargement'); }
    setLoading(false);
  }

  async function chargerCatalogue(excludeId = null) {
    setCatalogueEtat('chargement');
    try {
      const res = await api.get('/boutique-commandes/catalogue', {
        params: excludeId ? { exclude_commande_id: excludeId } : {},
      });
      setCatalogue(res.data?.items || []);
      setCatalogueEtat('pret');
    } catch (e) {
      setCatalogueEtat('erreur');
    }
  }

  function ouvrirCreation() {
    setEditeur(commandeVide(boutiques[0] ? String(boutiques[0].id) : ''));
    chargerCatalogue();
  }

  function ouvrirModification(cmd) {
    const quantites = {};
    let auPoids = false;
    for (const l of cmd.lignes || []) {
      if (l.nb_cartons_demande !== null && l.nb_cartons_demande !== undefined) quantites[cleLigne(l)] = Number(l.nb_cartons_demande);
      else auPoids = true;
    }
    setEditeur({
      mode: 'edit',
      commandeId: cmd.id,
      reference: cmd.reference,
      boutique_id: String(cmd.boutique_id),
      date_commande: String(cmd.date_commande).slice(0, 10),
      date_livraison_souhaitee: cmd.date_livraison_souhaitee ? String(cmd.date_livraison_souhaitee).slice(0, 10) : '',
      notes: cmd.notes || '',
      quantites,
      anciennesLignesAuPoids: auPoids,
    });
    setShowDetail(null);
    setDetailData(null);
    chargerCatalogue(cmd.id);
  }

  function changerQuantite(cle, n) {
    setEditeur((e) => {
      const q = { ...e.quantites };
      if (n > 0) q[cle] = n; else delete q[cle];
      return { ...e, quantites: q };
    });
  }

  async function enregistrer() {
    const index = new Map(catalogue.map((c) => [c.cle, c]));
    const lignes = Object.entries(editeur.quantites)
      .filter(([, n]) => n > 0)
      .map(([cle, n]) => {
        const c = index.get(cle);
        return c ? { gamme: c.gamme, produit: c.produit, genre: c.genre, saison: c.saison, nb_cartons: n } : null;
      })
      .filter(Boolean);
    if (!editeur.boutique_id) { toast.error('Choisissez la boutique'); return; }
    if (lignes.length === 0) { toast.error('Choisissez au moins une catégorie'); return; }
    setEnregistrement(true);
    try {
      if (editeur.mode === 'create') {
        await api.post('/boutique-commandes', {
          boutique_id: parseInt(editeur.boutique_id, 10),
          date_commande: editeur.date_commande,
          date_livraison_souhaitee: editeur.date_livraison_souhaitee || null,
          notes: editeur.notes,
          lignes,
        });
        toast.success('Commande créée (brouillon) — pensez à l\'envoyer');
      } else {
        await api.put(`/boutique-commandes/${editeur.commandeId}`, {
          date_livraison_souhaitee: editeur.date_livraison_souhaitee || null,
          notes: editeur.notes,
          lignes,
        });
        toast.success('Commande modifiée');
      }
      setEditeur(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur enregistrement');
    } finally {
      setEnregistrement(false);
    }
  }

  async function openDetail(id) {
    setShowDetail(id);
    try {
      const res = await api.get(`/boutique-commandes/${id}`);
      setDetailData(res.data);
    } catch (e) { toast.error('Erreur'); }
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

  const canAdjust = user?.role === 'ADMIN';
  const canSend = ['ADMIN', 'RESP_BTQ'].includes(user?.role);

  const columnCommandes = (col) => commandes.filter(c => col.statuts.includes(c.statut));

  if (loading) return <Layout><LoadingSpinner size="lg" /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Commandes boutiques"
          subtitle="Les boutiques commandent des cartons par catégorie du stock de produits finis"
          icon={ClipboardList}
          actions={
            canSend && (
              <button onClick={ouvrirCreation} className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium">
                <Plus className="w-4 h-4" /> Nouvelle commande
              </button>
            )
          }
        />

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
                    {c.nb_cartons_demande ? (
                      <div className="text-xs mt-1 font-medium text-slate-700">
                        {c.nb_cartons_voulu} carton{c.nb_cartons_voulu > 1 ? 's' : ''} • {c.nb_lignes} catégorie{c.nb_lignes > 1 ? 's' : ''}
                        {c.nb_cartons_voulu !== c.nb_cartons_demande && <span className="text-amber-600"> (demandé : {c.nb_cartons_demande})</span>}
                        {['ajustee', 'en_preparation', 'expediee'].includes(c.statut) && (
                          <span className="text-indigo-600"> • préparés {c.nb_cartons_scannes}/{c.nb_cartons_voulu}</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs mt-1 font-medium text-slate-700">
                        {c.nb_lignes} ligne{c.nb_lignes > 1 ? 's' : ''} • {Number(c.poids_total_demande_kg || 0).toFixed(1)} kg
                        {c.poids_total_ajuste_kg && <span className="text-amber-600"> (ajusté : {Number(c.poids_total_ajuste_kg).toFixed(1)})</span>}
                      </div>
                    )}
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

      {/* Éditeur de commande */}
      {editeur && (
        <Modal
          isOpen={!!editeur}
          onClose={() => setEditeur(null)}
          title={editeur.mode === 'create' ? 'Nouvelle commande boutique' : `Modifier la commande ${editeur.reference}`}
          size="full"
          footer={(
            <div className="flex items-center justify-between gap-3 w-full flex-wrap">
              <ResumeSelection catalogue={catalogue} quantites={editeur.quantites} />
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setEditeur(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Annuler</button>
                <button
                  onClick={enregistrer}
                  disabled={enregistrement || catalogueEtat !== 'pret'}
                  className="bg-pink-600 hover:bg-pink-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  {editeur.mode === 'create' ? 'Créer la commande' : 'Enregistrer'}
                </button>
              </div>
            </div>
          )}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Boutique</label>
                <select
                  value={editeur.boutique_id}
                  disabled={editeur.mode === 'edit'}
                  onChange={(e) => setEditeur((f) => ({ ...f, boutique_id: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
                >
                  <option value="">—</option>
                  {boutiques.map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date de commande</label>
                <input
                  type="date"
                  value={editeur.date_commande}
                  disabled={editeur.mode === 'edit'}
                  onChange={(e) => setEditeur((f) => ({ ...f, date_commande: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Livraison souhaitée (mardi/jeudi)</label>
                <input
                  type="date"
                  value={editeur.date_livraison_souhaitee}
                  onChange={(e) => setEditeur((f) => ({ ...f, date_livraison_souhaitee: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            {editeur.anciennesLignesAuPoids && (
              <div className="bg-amber-50 text-amber-800 text-sm p-3 rounded-lg">
                Cette commande contient des lignes saisies au poids (ancien format). En l'enregistrant,
                elles seront remplacées par les catégories choisies ci-dessous, en cartons.
              </div>
            )}

            {catalogueEtat === 'chargement' && <div className="text-slate-400 text-sm py-8 text-center">Chargement du stock…</div>}
            {catalogueEtat === 'erreur' && (
              <div className="bg-rose-50 text-rose-700 text-sm p-3 rounded-lg flex items-center justify-between gap-3">
                Impossible de charger le stock par catégorie.
                <button onClick={() => chargerCatalogue(editeur.commandeId)} className="px-3 py-1 rounded bg-white border text-rose-700 font-semibold">Réessayer</button>
              </div>
            )}
            {catalogueEtat === 'pret' && (
              <CommandeCatalogue catalogue={catalogue} quantites={editeur.quantites} onChange={changerQuantite} />
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes pour l'atelier</label>
              <textarea
                value={editeur.notes}
                onChange={(e) => setEditeur((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Modale détail */}
      {showDetail && detailData && (
        <Modal isOpen={!!showDetail} onClose={() => { setShowDetail(null); setDetailData(null); }} title={`Commande ${detailData.reference}`} size="lg">
          <CommandeDetail
            commande={detailData}
            canAdjust={canAdjust}
            canSend={canSend}
            onAction={action}
            onModifier={() => ouvrirModification(detailData)}
          />
        </Modal>
      )}
    </Layout>
  );
}

function CommandeDetail({ commande, canAdjust, canSend, onAction, onModifier }) {
  const enCartons = commande.lignes.some((l) => l.nb_cartons_demande !== null && l.nb_cartons_demande !== undefined);
  const prep = commande.preparation || { lignes: [], hors_commande: [] };
  const scannesParLigne = new Map(prep.lignes.map((l) => [l.ligne_id, l]));
  const [ajustements, setAjustements] = useState(() =>
    commande.lignes.map((l) => (enCartons
      ? { ligne_id: l.id, nb_cartons_ajuste: l.nb_cartons_ajuste ?? l.nb_cartons_demande }
      : { ligne_id: l.id, poids_ajuste_kg: l.poids_ajuste_kg ?? l.poids_demande_kg }))
  );
  const peutAjuster = canAdjust && commande.statut === 'envoyee';
  const avecPreparation = ['ajustee', 'en_preparation', 'expediee'].includes(commande.statut);

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
      {commande.notes && <div className="text-sm bg-slate-50 rounded-lg p-3 text-slate-700">{commande.notes}</div>}

      <div className="overflow-x-auto">
        <h4 className="text-sm font-semibold text-slate-700 mb-2">
          {enCartons ? 'Catégories commandées (en cartons)' : 'Lignes (au poids — ancien format)'}
        </h4>
        {enCartons ? (
          <table className="w-full text-sm min-w-[520px]">
            <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2">Catégorie</th>
                <th className="text-right py-2">Demandé</th>
                <th className="text-right py-2">Ajusté</th>
                <th className="text-right py-2">Préparés</th>
                <th className="text-right py-2">Expédiés</th>
              </tr>
            </thead>
            <tbody>
              {commande.lignes.map((l, i) => {
                const p = scannesParLigne.get(l.id);
                const voulu = l.nb_cartons_ajuste ?? l.nb_cartons_demande;
                return (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <div className="font-medium text-slate-800">{l.produit}</div>
                      <div className="text-xs text-slate-500">{l.gamme} · {l.genre} · {l.saison}{l.categorie_eco_org ? ` · ${l.categorie_eco_org}` : ''}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.nb_cartons_demande}</td>
                    <td className="py-2 text-right">
                      {peutAjuster ? (
                        <input
                          type="number" min={0} step={1}
                          value={ajustements[i]?.nb_cartons_ajuste ?? ''}
                          onChange={(e) => {
                            const n = [...ajustements];
                            const v = parseInt(e.target.value, 10);
                            n[i] = { ligne_id: l.id, nb_cartons_ajuste: Number.isFinite(v) && v >= 0 ? v : 0 };
                            setAjustements(n);
                          }}
                          className="w-16 text-right border border-slate-300 rounded px-2 py-1"
                        />
                      ) : (l.nb_cartons_ajuste ?? '—')}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {avecPreparation && p ? (
                        <span className={p.depasse ? 'text-amber-700 font-semibold' : p.scannes >= voulu ? 'text-emerald-700 font-semibold' : ''}>
                          {p.scannes}/{voulu}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.nb_cartons_expedies ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
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
                  <td className="py-2 text-right">{l.poids_demande_kg != null ? Number(l.poids_demande_kg).toFixed(1) : '—'}</td>
                  <td className="py-2 text-right">
                    {peutAjuster ? (
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
                    ) : (l.poids_ajuste_kg != null ? Number(l.poids_ajuste_kg).toFixed(1) : '—')}
                  </td>
                  <td className="py-2 text-right">{l.poids_expedie_kg != null ? Number(l.poids_expedie_kg).toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {enCartons && avecPreparation && (
          <div className="text-xs text-slate-500 mt-2">
            {prep.total_scannes} carton{prep.total_scannes > 1 ? 's' : ''} scanné{prep.total_scannes > 1 ? 's' : ''} pour cette commande — {prep.total_kg} kg.
          </div>
        )}
        {prep.hors_commande?.length > 0 && enCartons && (
          <div className="mt-2 bg-amber-50 text-amber-800 text-xs p-2 rounded flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {prep.hors_commande.length} carton{prep.hors_commande.length > 1 ? 's' : ''} scanné{prep.hors_commande.length > 1 ? 's' : ''} hors
              {' '}des catégories commandées : {prep.hors_commande.map((c) => `${c.produit} (${c.code_barre})`).join(', ')}.
            </span>
          </div>
        )}
        {enCartons && commande.statut === 'en_preparation' && (
          <div className="text-xs text-slate-500 mt-2">
            Préparation : scannez les cartons dans « Sortie cartons » → « Sur commande boutique ». L'expédition sort du stock le poids des cartons scannés.
          </div>
        )}
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
          <button onClick={onModifier} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-sm flex items-center gap-1">
            <Pencil className="w-3 h-3" /> Modifier
          </button>
        )}
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
