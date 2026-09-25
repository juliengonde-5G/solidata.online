import { useMemo, useState } from 'react';
import { Search, Minus, Plus, AlertTriangle, PackageCheck } from 'lucide-react';
import { visuelGamme } from '../../utils/etiquettes-visuels';

// Choix des catégories d'une commande boutique (2.58.0).
//
// Une catégorie = gamme + produit + genre + saison, telle que servie par
// GET /boutique-commandes/catalogue : tout le référentiel d'étiquetage ET tout
// ce qui existe réellement en stock. Pour chacune, la boutique voit le stock
// (cartons et kg), ce que les commandes en cours ont déjà réservé et ce qui
// reste disponible — puis saisit un nombre de cartons. Ni minimum ni maximum :
// commander au-delà du disponible est permis et SIGNALÉ (c'est un besoin à
// produire), jamais bloqué.

const LIMITE_AFFICHAGE = 250;

export function totauxSelection(catalogue, quantites) {
  let lignes = 0;
  let cartons = 0;
  let kg = 0;
  let sansPoids = 0;
  let auDela = 0;
  for (const c of catalogue) {
    const n = quantites[c.cle] || 0;
    if (n <= 0) continue;
    lignes += 1;
    cartons += n;
    if (c.poids_moyen_kg === null || c.poids_moyen_kg === undefined) sansPoids += 1;
    else kg += n * c.poids_moyen_kg;
    if (n > Math.max(c.disponible_cartons, 0)) auDela += 1;
  }
  return { lignes, cartons, kg: Math.round(kg), sansPoids, auDela };
}

function GammeBadge({ gamme }) {
  const v = visuelGamme(gamme);
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold" style={{ color: v.color, background: v.bg }}>
      {gamme}
    </span>
  );
}

function Disponibilite({ c }) {
  const dispo = c.disponible_cartons;
  const cls = dispo > 0 ? 'text-emerald-700' : c.stock_cartons > 0 ? 'text-amber-700' : 'text-slate-400';
  return <span className={`font-bold tabular-nums ${cls}`}>{dispo}</span>;
}

function Quantite({ valeur, onChange, label }) {
  const n = valeur || 0;
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(Math.max(n - 1, 0))}
        disabled={n === 0}
        className="px-2.5 py-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
        aria-label={`Retirer un carton — ${label}`}
      >
        <Minus className="w-4 h-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={n === 0 ? '' : n}
        placeholder="0"
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(Number.isFinite(v) && v > 0 ? v : 0);
        }}
        className="w-14 text-center text-sm font-bold py-2 border-x border-slate-200 focus:outline-none"
        aria-label={`Nombre de cartons — ${label}`}
      />
      <button
        type="button"
        onClick={() => onChange(n + 1)}
        className="px-2.5 py-2 text-pink-700 hover:bg-pink-50"
        aria-label={`Ajouter un carton — ${label}`}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function CommandeCatalogue({ catalogue, quantites, onChange }) {
  const [gamme, setGamme] = useState('');
  const [categorie, setCategorie] = useState('');
  const [genre, setGenre] = useState('');
  const [saison, setSaison] = useState('');
  const [recherche, setRecherche] = useState('');
  const [enStock, setEnStock] = useState(false);
  const [maSelection, setMaSelection] = useState(false);
  const [toutAfficher, setToutAfficher] = useState(false);

  const gammes = useMemo(() => {
    const m = new Map();
    for (const c of catalogue) {
      const g = m.get(c.gamme) || { gamme: c.gamme, stock: 0 };
      g.stock += c.stock_cartons;
      m.set(c.gamme, g);
    }
    return [...m.values()];
  }, [catalogue]);

  // Les listes de filtres suivent la gamme choisie : on ne propose pas un
  // genre qui n'existe pas dans la gamme affichée.
  const dansGamme = useMemo(() => (gamme ? catalogue.filter((c) => c.gamme === gamme) : catalogue), [catalogue, gamme]);
  const valeurs = (champ) => [...new Set(dansGamme.map((c) => c[champ]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const categories = useMemo(() => valeurs('categorie_eco_org'), [dansGamme]); // eslint-disable-line react-hooks/exhaustive-deps
  const genres = useMemo(() => valeurs('genre'), [dansGamme]); // eslint-disable-line react-hooks/exhaustive-deps
  const saisons = useMemo(() => valeurs('saison'), [dansGamme]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return dansGamme.filter((c) => {
      if (maSelection && !(quantites[c.cle] > 0)) return false;
      if (categorie && c.categorie_eco_org !== categorie) return false;
      if (genre && c.genre !== genre) return false;
      if (saison && c.saison !== saison) return false;
      if (enStock && c.stock_cartons <= 0 && !(quantites[c.cle] > 0)) return false;
      if (q) {
        const texte = `${c.produit} ${c.genre} ${c.saison} ${c.categorie_eco_org || ''} ${c.gamme}`
          .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (!q.split(/\s+/).every((mot) => texte.includes(mot))) return false;
      }
      return true;
    });
  }, [dansGamme, categorie, genre, saison, enStock, maSelection, recherche, quantites]);

  const nbSelection = Object.values(quantites).filter((n) => n > 0).length;
  const visibles = toutAfficher ? filtres : filtres.slice(0, LIMITE_AFFICHAGE);

  const choisirGamme = (g) => {
    setGamme(g);
    setCategorie('');
    setGenre('');
    setSaison('');
  };

  return (
    <div className="space-y-3">
      {/* Gammes */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => choisirGamme('')}
          className={`px-3 py-2 rounded-lg text-sm font-semibold border ${gamme === '' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300'}`}
        >
          Toutes les gammes
        </button>
        {gammes.map((g) => {
          const v = visuelGamme(g.gamme);
          const actif = gamme === g.gamme;
          return (
            <button
              key={g.gamme}
              type="button"
              onClick={() => choisirGamme(g.gamme)}
              className="px-3 py-2 rounded-lg text-sm font-semibold border-2 transition"
              style={actif
                ? { background: v.color, color: '#fff', borderColor: v.color }
                : { background: v.bg, color: v.color, borderColor: 'transparent' }}
              title={v.definition || g.gamme}
            >
              {g.gamme}
              <span className="ml-2 text-xs font-normal opacity-80">{g.stock} en stock</span>
            </button>
          );
        })}
      </div>

      {/* Filtres */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <label className="col-span-2 md:col-span-4 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un produit (ex. « robe femme été »)"
            className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </label>
        <select value={categorie} onChange={(e) => setCategorie(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 text-sm">
          <option value="">Toutes catégories</option>
          {categories.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={genre} onChange={(e) => setGenre(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 text-sm">
          <option value="">Tous genres</option>
          {genres.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={saison} onChange={(e) => setSaison(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-2 text-sm">
          <option value="">Toutes saisons</option>
          {saisons.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <div className="flex flex-col justify-center gap-1 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enStock} onChange={(e) => setEnStock(e.target.checked)} />
            En stock uniquement
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={maSelection} onChange={(e) => setMaSelection(e.target.checked)} />
            Ma sélection ({nbSelection})
          </label>
        </div>
      </div>

      <div className="text-xs text-slate-500">
        {filtres.length} catégorie{filtres.length > 1 ? 's' : ''} — <b>Stock</b> : cartons en stock ;
        {' '}<b>Réservé</b> : déjà demandé par les commandes en cours ; <b>Dispo.</b> : stock − réservé.
      </div>

      {/* Liste — cartes sur téléphone */}
      <div className="md:hidden space-y-2">
        {visibles.map((c) => {
          const n = quantites[c.cle] || 0;
          const auDela = n > 0 && n > Math.max(c.disponible_cartons, 0);
          return (
            <div key={c.cle} className={`border rounded-xl p-3 ${n > 0 ? 'border-pink-300 bg-pink-50/60' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start gap-2">
                <GammeBadge gamme={c.gamme} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 leading-tight">{c.produit}</div>
                  <div className="text-xs text-slate-500">
                    {c.genre} · {c.saison}{c.categorie_eco_org ? ` · ${c.categorie_eco_org}` : ''}
                    {!c.au_referentiel && <span className="italic"> · ancien libellé</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 mt-2">
                <div className="text-xs text-slate-600 leading-5">
                  Stock <b>{c.stock_cartons}</b>{c.reserve_cartons ? <> · réservé {c.reserve_cartons}</> : null}
                  <br />Dispo. <Disponibilite c={c} />
                </div>
                <Quantite valeur={n} label={`${c.gamme} ${c.produit} ${c.genre} ${c.saison}`} onChange={(v) => onChange(c.cle, v)} />
              </div>
              {auDela && (
                <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Au-delà du disponible : sera à produire
                </div>
              )}
            </div>
          );
        })}
        {filtres.length === 0 && <div className="text-center text-slate-400 py-8 text-sm">Aucune catégorie ne correspond à ces filtres.</div>}
      </div>

      {/* Liste — tableau à partir de la tablette */}
      <div className="hidden md:block border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2">Produit</th>
              <th className="text-left px-3 py-2">Genre</th>
              <th className="text-left px-3 py-2">Saison</th>
              <th className="text-right px-3 py-2">Stock</th>
              <th className="text-right px-3 py-2">Réservé</th>
              <th className="text-right px-3 py-2">Dispo.</th>
              <th className="text-center px-3 py-2">Cartons</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => {
              const n = quantites[c.cle] || 0;
              const auDela = n > 0 && n > Math.max(c.disponible_cartons, 0);
              const label = `${c.gamme} ${c.produit} ${c.genre} ${c.saison}`;
              return (
                <tr key={c.cle} className={`border-t border-slate-100 ${n > 0 ? 'bg-pink-50/60' : ''}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <GammeBadge gamme={c.gamme} />
                      <span className="font-medium text-slate-800">{c.produit}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {c.categorie_eco_org || '—'}
                      {!c.au_referentiel && <span className="ml-2 italic" title="Présent en stock, absent du référentiel d'étiquetage actuel">ancien libellé</span>}
                    </div>
                    {auDela && (
                      <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Au-delà du disponible : sera à produire
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{c.genre}</td>
                  <td className="px-3 py-2 text-slate-700">{c.saison}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <div className="font-semibold">{c.stock_cartons}</div>
                    {c.stock_cartons > 0 && <div className="text-xs text-slate-400">{Math.round(c.stock_kg)} kg</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{c.reserve_cartons || '—'}</td>
                  <td className="px-3 py-2 text-right"><Disponibilite c={c} /></td>
                  <td className="px-3 py-2 text-center">
                    <Quantite valeur={n} label={label} onChange={(v) => onChange(c.cle, v)} />
                  </td>
                </tr>
              );
            })}
            {filtres.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-8">Aucune catégorie ne correspond à ces filtres.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {!toutAfficher && filtres.length > LIMITE_AFFICHAGE && (
        <button type="button" onClick={() => setToutAfficher(true)} className="w-full py-2 text-sm text-pink-700 font-semibold hover:bg-pink-50 rounded-lg">
          Afficher les {filtres.length - LIMITE_AFFICHAGE} catégories suivantes
        </button>
      )}
    </div>
  );
}

export function ResumeSelection({ catalogue, quantites }) {
  const t = totauxSelection(catalogue, quantites);
  return (
    <div className="flex items-center gap-3 text-sm text-slate-700 flex-wrap">
      <PackageCheck className="w-5 h-5 text-pink-600" />
      <span><b>{t.cartons}</b> carton{t.cartons > 1 ? 's' : ''} · {t.lignes} catégorie{t.lignes > 1 ? 's' : ''}</span>
      {t.cartons > 0 && (
        <span className="text-slate-500">
          ≈ {t.kg} kg estimés{t.sansPoids > 0 ? ` (hors ${t.sansPoids} catégorie${t.sansPoids > 1 ? 's' : ''} sans poids connu)` : ''}
        </span>
      )}
      {t.auDela > 0 && (
        <span className="text-amber-700 flex items-center gap-1">
          <AlertTriangle className="w-4 h-4" /> {t.auDela} au-delà du disponible
        </span>
      )}
    </div>
  );
}
