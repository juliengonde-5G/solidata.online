import { useState, useEffect, useMemo } from 'react';
import { Package, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge, Modal, PageHeader } from '../components';
import api from '../services/api';
import {
  appliquerAutomatiques, optionsEtape, nomProduit, corpsGeneration, revenirA } from '../utils/etiquettes-parcours';

const REFERENTIEL_VIDE = { gammes: [], categories: [], genres: [], saisons: [], produits: [], combinaisons: [] };

export default function ProduitsFinis() {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [showForm, setShowForm] = useState(false);
  // Voie manuelle harmonisée avec la voie étiquette : mêmes listes en
  // CASCADE (gamme → catégorie → produit → genre → saison), pilotées par la
  // même logique pure `etiquettes-parcours.js` — deux formulaires qui
  // recalculeraient chacun leur cascade finiraient tôt ou tard par diverger.
  const [postes, setPostes] = useState([]);
  const [referentiel, setReferentiel] = useState(REFERENTIEL_VIDE);
  const [choixManuel, setChoixManuel] = useState({});
  const [posteId, setPosteId] = useState('');
  const [poidsKg, setPoidsKg] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [prodRes, sumRes, postesRes, refRes] = await Promise.all([
        api.get('/produits-finis'),
        api.get('/produits-finis/summary'),
        api.get('/etiquettes/postes'),
        api.get('/etiquettes/referentiel'),
      ]);
      setProducts(prodRes.data);
      setSummary(sumRes.data);
      setPostes(postesRes.data || []);
      setReferentiel(refRes.data || REFERENTIEL_VIDE);
      setPosteId((cur) => cur || (postesRes.data?.[0]?.id ?? ''));
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Erreur lors du chargement des produits finis.');
    }
    setLoading(false);
  };

  const combinaisons = referentiel.combinaisons || [];

  // Même mécanique que l'écran d'étiquetage (`EtiquetteGenerer.jsx`) : un
  // choix qui n'a qu'une seule valeur possible est posé automatiquement — un
  // formulaire manuel ne doit pas réclamer un genre qu'une seule valeur
  // pourrait prendre.
  const { choix, automatique, etape, options, termine } = useMemo(
    () => appliquerAutomatiques(combinaisons, choixManuel),
    [combinaisons, choixManuel]
  );

  const openForm = () => {
    setSubmitError(null);
    setSubmitSuccess(null);
    setChoixManuel({});
    setPoidsKg('');
    setPosteId((cur) => cur || postes[0]?.id || '');
    setShowForm(true);
  };

  // Changer une étape efface toutes les étapes SUIVANTES (comme le fil
  // d'Ariane de l'écran d'étiquetage) : sinon d'anciens choix incompatibles
  // resteraient « décidés » et le formulaire enverrait une combinaison refusée.
  const choisir = (champ, valeur) => setChoixManuel((prev) => ({ ...revenirA(prev, {}, champ).choix, [champ]: valeur }));

  const createProduct = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
    if (!posteId || !termine || !poidsKg) {
      setSubmitError('Poste, gamme, catégorie, produit, genre, saison et poids sont requis.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/produits-finis', corpsGeneration(choix, {
        poidsKg: parseFloat(String(poidsKg).replace(',', '.')),
        posteId,
      }));
      setSubmitSuccess(`Produit fini créé — code-barres généré : ${data.code_barre}`);
      setChoixManuel({});
      setPoidsKg('');
      loadData();
    } catch (err) {
      setSubmitError(err?.response?.data?.error || 'Erreur lors de la création du produit fini');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des produits finis..." /></Layout>;

  const columns = [
    { key: 'code_barre', label: 'Code-barres', sortable: true, render: (p) => <span className="font-mono text-sm">{p.code_barre || '—'}</span> },
    {
      key: 'code_lisible',
      label: 'Codification',
      render: (p) => p.code_lisible
        ? <span className="font-mono text-xs text-slate-500">{p.code_lisible}</span>
        : <span className="text-xs text-slate-300">—</span>,
    },
    { key: 'produit_nom', label: 'Produit', sortable: true, render: (p) => p.produit_nom || p.produit || '—' },
    { key: 'poids_kg', label: 'Poids (kg)', sortable: true, render: (p) => <span className="font-medium">{p.poids_kg}</span> },
    {
      key: 'gamme',
      label: 'Gamme',
      sortable: true,
      render: (p) => <StatusBadge status={p.gamme} size="sm" />,
    },
    { key: 'source', label: 'Origine', render: (p) => <span className="text-xs text-slate-500">{{ etiquette: 'Étiquette', manuel: 'Manuel', balance: 'Balance', import_excel: 'Import' }[p.source] || '—'}</span> },
    { key: 'date_fabrication', label: 'Fabriqué le', sortable: true, render: (p) => <span className="text-xs text-slate-500">{p.date_fabrication ? new Date(p.date_fabrication).toLocaleDateString('fr-FR') : '—'}</span> },
    {
      key: 'is_shipped',
      label: 'Statut',
      sortable: true,
      render: (p) => <StatusBadge status={p.is_shipped || p.status === 'expedie' ? 'shipped' : 'pending'} size="sm" label={p.is_shipped || p.status === 'expedie' ? 'Expediee' : 'En stock'} />,
    },
  ];

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Produits finis"
          subtitle="Articles triés et conditionnés"
          icon={Package}
          actions={
            <div className="flex gap-2">
              <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'list' ? 'bg-primary text-white' : 'bg-slate-100'}`}>Liste</button>
              <button onClick={() => setView('summary')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'summary' ? 'bg-primary text-white' : 'bg-slate-100'}`}>Synthèse</button>
              <button onClick={openForm} className="btn-primary text-sm">
                <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
                Ajouter
              </button>
            </div>
          }
        />

        {view === 'summary' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {summary.map(s => (
              <div key={s.gamme || s.categorie} className="card-modern p-4">
                <h3 className="font-semibold">{s.gamme || s.categorie || 'Non classé'}</h3>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Articles</span>
                    <span className="font-medium">{s.nb_produits ?? s.count ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Poids total</span>
                    <span className="font-medium">{parseFloat(s.poids_total_kg ?? s.total_kg ?? 0).toFixed(0)} kg</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {view === 'list' && (
          <DataTable
            columns={columns}
            data={products}
            loading={loading}
            emptyIcon={Package}
            emptyMessage="Aucun produit fini"
          />
        )}

        {/* Form manuel — mêmes champs que la voie étiquette, en cascade,
            code-barres généré côté serveur */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouveau produit fini" size="sm"
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Fermer</button>
            <button type="submit" form="produits-finis-form" disabled={submitting || !termine || !poidsKg} className="flex-1 btn-primary text-sm">{submitting ? '…' : 'Créer'}</button>
          </>}
        >
          <form id="produits-finis-form" onSubmit={createProduct} className="space-y-3">
            {submitError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {submitError}
              </div>
            )}
            {submitSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {submitSuccess}
              </div>
            )}
            <p className="text-xs text-slate-400">Le code-barres est généré automatiquement, comme à l'étiquetage.</p>

            <select value={posteId} onChange={e => setPosteId(e.target.value)} className="input-modern" required aria-label="Poste">
              <option value="">Poste *</option>
              {postes.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>

            {/* Cascade : chaque select n'affiche que les valeurs compatibles
                avec les précédentes ; une dimension à une seule valeur
                possible est posée toute seule et son select disparaît (comme
                à l'écran d'étiquetage — même logique, même comportement). */}
            <SelectCascade label="Gamme" champ="gamme" valeur={choix.gamme} automatique={automatique.gamme}
              options={optionsEtape(combinaisons, {}, 'gamme')} onChange={(v) => choisir('gamme', v)} />
            <SelectCascade label="Catégorie" champ="categorie_eco_org" valeur={choix.categorie_eco_org} automatique={automatique.categorie_eco_org}
              options={choix.gamme ? optionsEtape(combinaisons, { gamme: choix.gamme }, 'categorie_eco_org') : []}
              disabled={!choix.gamme} onChange={(v) => choisir('categorie_eco_org', v)} />
            <SelectCascadeProduit valeur={choix.produit_id} automatique={automatique.produit_id}
              options={(choix.gamme && choix.categorie_eco_org) ? optionsEtape(combinaisons, { gamme: choix.gamme, categorie_eco_org: choix.categorie_eco_org }, 'produit_id') : []}
              disabled={!(choix.gamme && choix.categorie_eco_org)} onChange={(v) => choisir('produit_id', v)} />
            <div className="grid grid-cols-2 gap-2">
              <SelectCascade label="Genre" champ="genre" valeur={choix.genre} automatique={automatique.genre}
                options={choix.produit_id != null ? optionsEtape(combinaisons, { gamme: choix.gamme, categorie_eco_org: choix.categorie_eco_org, produit_id: choix.produit_id }, 'genre') : []}
                disabled={choix.produit_id == null} onChange={(v) => choisir('genre', v)} />
              <SelectCascade label="Saison" champ="saison" valeur={choix.saison} automatique={automatique.saison}
                options={choix.genre ? optionsEtape(combinaisons, { gamme: choix.gamme, categorie_eco_org: choix.categorie_eco_org, produit_id: choix.produit_id, genre: choix.genre }, 'saison') : []}
                disabled={!choix.genre} onChange={(v) => choisir('saison', v)} />
            </div>

            {choix.produit_id != null && (
              <p className="text-xs text-slate-500">Produit retenu : <span className="font-medium">{nomProduit(combinaisons, choix.produit_id)}</span></p>
            )}

            <input type="number" step="0.1" min="0" max="1000" placeholder="Poids (kg) *" value={poidsKg} onChange={e => setPoidsKg(e.target.value)} className="input-modern" required disabled={!termine} aria-label="Poids en kg" />
          </form>
        </Modal>
      </div>
    </Layout>
  );
}

/**
 * Un select de la cascade : n'affiche RIEN (juste une mention) quand il est
 * posé automatiquement — une seule valeur possible ne mérite pas un menu
 * déroulant à un seul choix, exactement comme l'étape correspondante est
 * sautée à l'écran d'étiquetage.
 */
function SelectCascade({ label, valeur, automatique, options, disabled, onChange }) {
  if (automatique) {
    return (
      <div className="text-xs text-slate-500 px-1">
        {label} : <span className="font-semibold text-slate-700">{valeur}</span> <span className="italic">(automatique — seule valeur possible)</span>
      </div>
    );
  }
  return (
    <select value={valeur || ''} onChange={(e) => onChange(e.target.value)} className="input-modern" required disabled={disabled} aria-label={label}>
      <option value="">{label} *</option>
      {(options || []).map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
}

/** Variante produit : les options sont `{id, nom}`, pas de simples chaînes. */
function SelectCascadeProduit({ valeur, automatique, options, disabled, onChange }) {
  if (automatique) {
    const nom = (options || []).find((o) => o.id === valeur)?.nom || valeur;
    return (
      <div className="text-xs text-slate-500 px-1">
        Produit : <span className="font-semibold text-slate-700">{nom}</span> <span className="italic">(automatique — seul produit possible)</span>
      </div>
    );
  }
  return (
    <select value={valeur ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="input-modern" required disabled={disabled} aria-label="Produit">
      <option value="">Produit *</option>
      {(options || []).map((o) => <option key={o.id} value={o.id}>{o.nom}</option>)}
    </select>
  );
}
