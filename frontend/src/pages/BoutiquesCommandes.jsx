import { useState, useEffect } from 'react';
import { ClipboardList, Plus, Send } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, useToast, PageHeader } from '../components';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import CommandeCatalogue, { ResumeSelection } from '../components/boutiques/CommandeCatalogue';

/**
 * PASSER COMMANDE — module Boutiques (2.59.0).
 *
 * La boutique passe sa commande ; elle part DIRECTEMENT à l'équipe logistique
 * de Solidarité Textiles, qui la valide, la prépare et l'expédie depuis le
 * suivi des commandes de la logistique (même tableau que les commandes des
 * exutoires). Ici ne restent que le formulaire et la liste des commandes de la
 * boutique avec leur statut, en lecture seule : aucune gestion ni suivi
 * d'atelier côté boutique.
 */

const STATUT_LABELS = {
  brouillon: 'Brouillon — non envoyée',
  envoyee: 'Reçue par la logistique',
  ajustee: 'Validée par la logistique',
  en_preparation: 'En préparation',
  expediee: 'Expédiée',
  annulee: 'Annulée',
};
const STATUT_COLORS = {
  brouillon: 'bg-slate-100 text-slate-700',
  envoyee: 'bg-blue-100 text-blue-700',
  ajustee: 'bg-sky-100 text-sky-700',
  en_preparation: 'bg-indigo-100 text-indigo-700',
  expediee: 'bg-green-100 text-green-700',
  annulee: 'bg-red-100 text-red-700',
};

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
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

export default function BoutiquesCommandes() {
  const { user } = useAuth();
  const toast = useToast();
  const [boutiques, setBoutiques] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // Brouillon hérité (commandes créées avant l'envoi direct) : on le complète
  // puis on l'envoie. Les lignes viennent de la fiche de la commande.
  async function ouvrirModification(id) {
    let cmd;
    try {
      cmd = (await api.get(`/boutique-commandes/${id}`)).data;
    } catch (e) {
      toast.error('Commande introuvable');
      return;
    }
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
        const res = await api.post('/boutique-commandes', {
          boutique_id: parseInt(editeur.boutique_id, 10),
          date_commande: editeur.date_commande,
          date_livraison_souhaitee: editeur.date_livraison_souhaitee || null,
          notes: editeur.notes,
          lignes,
          envoyer: true,
        });
        toast.success(`Commande ${res.data?.reference || ''} envoyée à la logistique`);
      } else {
        await api.put(`/boutique-commandes/${editeur.commandeId}`, {
          date_livraison_souhaitee: editeur.date_livraison_souhaitee || null,
          notes: editeur.notes,
          lignes,
        });
        await api.patch(`/boutique-commandes/${editeur.commandeId}/envoyer`, {});
        toast.success(`Commande ${editeur.reference} envoyée à la logistique`);
      }
      setEditeur(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'La commande n\'a pas pu être envoyée');
    } finally {
      setEnregistrement(false);
    }
  }

  const canSend = ['ADMIN', 'RESP_BTQ'].includes(user?.base_role || user?.role);

  if (loading) return <Layout><LoadingSpinner size="lg" /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Commandes à la logistique"
          subtitle="Votre commande part directement à l'équipe logistique, qui la prépare et l'expédie"
          icon={ClipboardList}
          actions={
            canSend && (
              <button onClick={ouvrirCreation} className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium">
                <Plus className="w-4 h-4" /> Passer une commande
              </button>
            )
          }
        />

        <div className="card-modern overflow-x-auto">
          {commandes.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">Aucune commande pour l'instant.</p>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Référence</th>
                  <th className="text-left px-3 py-2">Boutique</th>
                  <th className="text-left px-3 py-2">Commandée le</th>
                  <th className="text-left px-3 py-2">Livraison souhaitée</th>
                  <th className="text-right px-3 py-2">Cartons</th>
                  <th className="text-left px-3 py-2">Statut</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {commandes.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700">{c.reference}</td>
                    <td className="px-3 py-2 text-slate-700">{c.boutique_nom || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{dateFr(c.date_commande)}</td>
                    <td className="px-3 py-2 text-slate-600">{dateFr(c.date_livraison_souhaitee)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.nb_cartons_demande
                        ? <>{c.nb_cartons_voulu}{c.nb_cartons_voulu !== c.nb_cartons_demande && <span className="text-xs text-slate-400"> (demandé {c.nb_cartons_demande})</span>}</>
                        : <span className="text-slate-500">{Number(c.poids_total_demande_kg || 0).toFixed(0)} kg</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUT_COLORS[c.statut] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUT_LABELS[c.statut] || c.statut}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {c.statut === 'brouillon' && canSend && (
                        <button onClick={() => ouvrirModification(c.id)} className="text-xs font-medium text-pink-700 hover:underline whitespace-nowrap">
                          Compléter et envoyer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Éditeur de commande */}
      {editeur && (
        <Modal
          isOpen={!!editeur}
          onClose={() => setEditeur(null)}
          title={editeur.mode === 'create' ? 'Passer une commande à la logistique' : `Compléter et envoyer la commande ${editeur.reference}`}
          size="full"
          footer={(
            <div className="flex items-center justify-between gap-3 w-full flex-wrap">
              <ResumeSelection catalogue={catalogue} quantites={editeur.quantites} />
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setEditeur(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Annuler</button>
                <button
                  onClick={enregistrer}
                  disabled={enregistrement || catalogueEtat !== 'pret'}
                  className="bg-pink-600 hover:bg-pink-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" /> {enregistrement ? 'Envoi…' : 'Envoyer à la logistique'}
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
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes pour la logistique</label>
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

    </Layout>
  );
}
