import { useState, useMemo, useEffect, useRef } from 'react';
import { Printer, ChevronLeft, Check, Tag, Delete, RotateCcw, Search, AlertTriangle } from 'lucide-react';
import Layout from '../components/Layout';
import EtiquetteA4 from '../components/EtiquetteA4';
import api from '../services/api';
import {
  visuelCategorie, visuelSaison, visuelGamme, grouperGenres, VISUEL_NEUTRE,
} from '../utils/etiquettes-visuels';
import {
  ETAPES, ETAPE_POIDS, appliquerAutomatiques, revenirA, nomProduit, corpsGeneration,
} from '../utils/etiquettes-parcours';
import '../styles/etiquette-print.css';

const REFERENTIEL_VIDE = { gammes: [], categories: [], genres: [], saisons: [], produits: [], combinaisons: [] };
const TOUTES_ETAPES = [...ETAPES, ETAPE_POIDS];

export default function EtiquetteGenerer() {
  // `choixManuel` ne porte QUE les décisions prises par l'opérateur — jamais
  // les valeurs posées automatiquement (voir `etiquettes-parcours.js`). Ça
  // évite tout risque de désynchronisation : à chaque rendu, on recalcule
  // `appliquerAutomatiques(combinaisons, choixManuel)` et on obtient un choix
  // complet cohérent, sans jamais stocker deux fois la même information.
  const [choixManuel, setChoixManuel] = useState({});
  const [poidsStr, setPoidsStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [poste, setPoste] = useState(null);
  const [referentiel, setReferentiel] = useState(REFERENTIEL_VIDE);
  const [loading, setLoading] = useState(true);
  // Traçabilité carton → lot (optionnel) : lot de tri en cours à rattacher aux
  // cartons étiquetés. Persiste sur la session d'étiquetage (réglé une fois).
  const [lots, setLots] = useState([]);
  const [selectedLot, setSelectedLot] = useState('');
  // Ce qui doit s'imprimer : soit une création (grand écran vert de
  // confirmation), soit une réimpression (le panneau reste ouvert, pas
  // d'écran de confirmation plein écran — l'opérateur n'a pas quitté son
  // geste en cours).
  const [impression, setImpression] = useState(null); // { data, source: 'creation'|'reimpression' }

  // ── Réimpression (panneau dédié) ──────────────────────────────────────────
  const [reimprCode, setReimprCode] = useState('');
  const [reimprCarton, setReimprCarton] = useState(null); // aperçu renvoyé par GET /carton/:code
  const [reimprIntrouvable, setReimprIntrouvable] = useState(null); // { format_libelle, code_normalise } si 404
  const [reimprMotif, setReimprMotif] = useState('');
  const [reimprLoading, setReimprLoading] = useState(false);
  const [reimprError, setReimprError] = useState(null);
  const reimprInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [p, r, l] = await Promise.all([
          api.get('/etiquettes/postes'),
          api.get('/etiquettes/referentiel'),
          api.get('/etiquettes/lots-actifs').catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        setPoste(p.data[0] || null);
        setReferentiel(r.data || REFERENTIEL_VIDE);
        setLots(l.data || []);
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message || 'Erreur réseau');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Nettoyage du DOM d'impression après une réimpression : le panneau reste
  // ouvert (pas de grand écran vert), inutile de garder l'ancien contenu
  // imprimable pendant qu'on cherche le carton suivant.
  useEffect(() => {
    const onAfterPrint = () => {
      setImpression((cur) => (cur?.source === 'reimpression' ? null : cur));
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, []);

  const combinaisons = referentiel.combinaisons || [];

  // Cœur du parcours : `choix` porte les 5 dimensions (manuelles + posées
  // automatiquement), `automatique` dit lesquelles l'ont été, `etape` est ce
  // qu'il reste réellement à demander (peut être directement 'poids').
  const { choix, automatique, etape, options, termine } = useMemo(
    () => appliquerAutomatiques(combinaisons, choixManuel),
    [combinaisons, choixManuel]
  );

  // Genres rangés par famille (Adulte / Enfant / tranches d'âge / Sans genre),
  // seulement calculé quand l'étape courante est bien 'genre' (les options
  // dépendent alors des choix précédents).
  const famillesGenre = useMemo(
    () => (etape === 'genre' ? grouperGenres(options) : []),
    [etape, options]
  );

  const choisir = (champ, valeur) => {
    setChoixManuel((prev) => ({ ...prev, [champ]: valeur }));
    setError(null);
  };

  const revenir = (etapeId) => {
    const { choix: nv } = revenirA(choixManuel, automatique, etapeId);
    setChoixManuel(nv);
    setPoidsStr('');
    setError(null);
  };

  const reset = () => {
    setChoixManuel({});
    setPoidsStr('');
    setError(null);
    setImpression(null);
  };

  const onPrint = async () => {
    if (!poste) { setError('Aucun poste actif'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/etiquettes/generer', corpsGeneration(choix, {
        poidsKg: parseFloat(poidsStr.replace(',', '.')),
        posteId: poste.id,
        lotId: selectedLot,
      }));
      setImpression({ data, source: 'creation' });
      setTimeout(() => window.print(), 250);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onPoidsKey = (k) => {
    setPoidsStr((p) => {
      if (k === 'del') return p.slice(0, -1);
      if (k === ',') return !p.includes(',') && p.length > 0 ? p + ',' : p;
      if (p.length >= 5) return p;
      if (p === '0' && k !== ',') return k;
      return p + k;
    });
  };

  const poidsSaisi = poidsStr && parseFloat(poidsStr.replace(',', '.')) > 0;
  const canPrint = Boolean(termine && poidsSaisi && !submitting);

  // ── Réimpression ───────────────────────────────────────────────────────
  const chercherCarton = async (e) => {
    e?.preventDefault();
    const code = reimprCode.trim();
    if (!code) return;
    setReimprLoading(true);
    setReimprError(null);
    setReimprCarton(null);
    setReimprIntrouvable(null);
    try {
      const { data } = await api.get(`/etiquettes/carton/${encodeURIComponent(code)}`);
      setReimprCarton(data.carton ? { ...data.carton, format: data.format, format_libelle: data.format_libelle } : data);
    } catch (e2) {
      if (e2.response?.status === 404) {
        setReimprIntrouvable(e2.response.data || { format_libelle: 'Format inconnu', code_normalise: code });
      } else {
        setReimprError(e2.response?.data?.error || e2.message);
      }
    } finally {
      setReimprLoading(false);
    }
  };

  const dejaSorti = reimprCarton && (reimprCarton.status === 'expedie' || reimprCarton.date_sortie);

  const confirmerReimpression = async () => {
    if (!reimprCarton) return;
    setReimprLoading(true);
    setReimprError(null);
    try {
      const { data } = await api.post('/etiquettes/reimprimer', {
        code_barre: reimprCarton.code_barre,
        motif: reimprMotif.trim() || undefined,
      });
      setImpression({ data, source: 'reimpression' });
      setTimeout(() => window.print(), 250);
      setReimprCarton(data);
      setReimprMotif('');
    } catch (e2) {
      if (e2.response?.status === 409) {
        setReimprError(e2.response?.data?.error || 'Ce carton a déjà été sorti — réimpression refusée.');
        // Le carton peut avoir été sorti entre l'aperçu et la confirmation :
        // on rafraîchit son statut pour que le bouton se désactive vraiment.
        if (e2.response?.data?.carton) setReimprCarton(e2.response.data.carton);
      } else {
        setReimprError(e2.response?.data?.error || e2.message);
      }
    } finally {
      setReimprLoading(false);
    }
  };

  return (
    <Layout>
      <div className="no-print min-h-[calc(100vh-60px)] bg-slate-50 flex flex-col">
        <header className="bg-white border-b px-6 py-4 flex items-center gap-4 shadow-sm">
          <Tag className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-800 flex-1">Génération d'étiquette</h1>
          {lots.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Lot&nbsp;:</span>
              <select
                value={selectedLot}
                onChange={(e) => setSelectedLot(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-700 max-w-[200px]"
                title="Rattacher les cartons étiquetés à un lot de tri (traçabilité)"
              >
                <option value="">Aucun lot</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}{l.chaine_nom ? ` — ${l.chaine_nom}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="text-sm text-slate-500">{poste ? poste.nom : '—'}</div>
        </header>

        {error && (
          <div className="bg-rose-50 border-b border-rose-200 px-6 py-3 text-rose-800 text-sm">{error}</div>
        )}

        <FilArianne
          etapes={TOUTES_ETAPES}
          choix={choix}
          automatique={automatique}
          etapeCourante={etape}
          combinaisons={combinaisons}
          onRevenir={revenir}
        />

        <div className="flex-1 p-8">
          {loading && (
            <div className="bg-white rounded-2xl shadow p-8 text-center text-slate-500">Chargement du catalogue…</div>
          )}

          {!loading && etape === 'gamme' && (
            <PickGrid title="Choisir la gamme" items={options} value={choix.gamme}
              visuel={(v) => enrichirDefinition(visuelGamme(v), referentiel.gammes, v)}
              cols={4}
              onPick={(v) => choisir('gamme', v)} />
          )}

          {!loading && etape === 'categorie_eco_org' && (
            <PickGrid title="Catégorie" items={options} value={choix.categorie_eco_org}
              visuel={visuelCategorie} cols={4}
              onPick={(v) => choisir('categorie_eco_org', v)} />
          )}

          {!loading && etape === 'produit_id' && (
            <div>
              <h2 className="text-xl font-bold text-slate-700 mb-6">Produit</h2>
              {options.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <span>Aucun produit pour cette combinaison gamme/catégorie. Vérifiez le référentiel dans Admin → Catalogue (onglet Combinaisons).</span>
                </div>
              )}
              <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {options.map((p) => (
                  <button key={p.id}
                    onClick={() => choisir('produit_id', p.id)}
                    className={`px-6 py-8 rounded-2xl text-xl font-bold shadow-md transition transform hover:scale-105 ${
                      choix.produit_id === p.id ? 'bg-emerald-600 text-white ring-4 ring-emerald-300' : 'bg-white text-slate-800 hover:bg-emerald-50'
                    }`}
                  >{p.nom}</button>
                ))}
              </div>
            </div>
          )}

          {!loading && etape === 'genre' && (
            <PickGroupes title="Genre" groupes={famillesGenre} value={choix.genre}
              onPick={(v) => choisir('genre', v)} />
          )}

          {!loading && etape === 'saison' && (
            <PickGrid title="Saison" items={options} value={choix.saison}
              visuel={visuelSaison} cols={3}
              onPick={(v) => choisir('saison', v)} />
          )}

          {!loading && etape === 'poids' && (
            <div>
              <h2 className="text-xl font-bold text-slate-700 mb-6">Poids du carton (kg)</h2>
              <div className="bg-white rounded-3xl shadow-lg p-8 max-w-md mx-auto">
                <div className="text-7xl font-extrabold text-center text-slate-800 mb-6 min-h-[7rem] flex items-center justify-center">
                  {poidsStr || '0'}
                  <span className="text-3xl text-slate-400 ml-3">kg</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'del'].map((k) => (
                    <button key={k} onClick={() => onPoidsKey(k)}
                      className="aspect-square rounded-2xl text-3xl font-bold bg-slate-100 hover:bg-slate-200 active:bg-slate-300 transition flex items-center justify-center"
                    >
                      {k === 'del' ? <Delete className="w-8 h-8" /> : k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-w-md mx-auto mt-8">
                <button onClick={onPrint} disabled={!canPrint}
                  className="w-full h-32 rounded-3xl text-3xl font-extrabold bg-emerald-600 text-white shadow-xl hover:bg-emerald-700 active:scale-95 transition disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-4"
                >
                  <Printer className="w-12 h-12" />
                  IMPRIMER
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="bg-white border-t px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <button onClick={() => {
            // « Retour » revient à l'étape juste avant l'étape courante — la
            // première étape antérieure qui a réellement une valeur à effacer.
            const idxCourante = TOUTES_ETAPES.findIndex((e) => e.id === etape);
            for (let i = idxCourante - 1; i >= 0; i--) {
              if (!automatique[TOUTES_ETAPES[i].champ]) { revenir(TOUTES_ETAPES[i].id); return; }
            }
          }} disabled={TOUTES_ETAPES.findIndex((e) => e.id === etape) === 0}
            className="px-5 py-3 rounded-xl bg-slate-200 hover:bg-slate-300 disabled:opacity-40 flex items-center gap-2 font-semibold">
            <ChevronLeft className="w-5 h-5" /> Retour
          </button>
          <button onClick={reset} className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 font-semibold text-slate-600">Annuler</button>
        </footer>

        {/* Panneau « Réimprimer une étiquette » — saisie manuelle OU scan
            direct (une douchette HID tape dans un champ texte comme un
            clavier ; Entrée valide le formulaire). */}
        <PanneauReimpression
          code={reimprCode} setCode={setReimprCode}
          onChercher={chercherCarton}
          loading={reimprLoading}
          carton={reimprCarton}
          intronvable={reimprIntrouvable}
          error={reimprError}
          motif={reimprMotif} setMotif={setReimprMotif}
          dejaSorti={dejaSorti}
          onReimprimer={confirmerReimpression}
          inputRef={reimprInputRef}
        />

        {impression?.source === 'creation' && (
          <div className="fixed inset-0 z-50 bg-emerald-600/95 flex flex-col items-center justify-center text-white">
            <Check className="w-40 h-40 mb-6" strokeWidth={3} />
            <div className="text-3xl font-bold mb-2">Étiquette imprimée</div>
            <div className="text-6xl font-extrabold tracking-wider mb-8">{impression.data.code_barre}</div>
            <button onClick={reset}
              className="px-8 py-4 rounded-2xl bg-white text-emerald-700 text-xl font-bold shadow-xl hover:bg-emerald-50">
              Nouvelle étiquette
            </button>
          </div>
        )}
      </div>

      {impression && <EtiquetteA4 data={impression.data} />}
    </Layout>
  );
}

/** Complète le visuel d'une gamme avec la définition SERVEUR quand elle en
 * fournit une (`referentiel.gammes[].definition`) — sinon on garde celle,
 * déjà correcte, de `visuelGamme`. Le serveur reste la source qui peut faire
 * évoluer un libellé sans nécessiter un redéploiement du front. */
function enrichirDefinition(visuel, gammesRef, valeur) {
  const depuisServeur = (gammesRef || []).find((g) => g.valeur === valeur)?.definition;
  return depuisServeur ? { ...visuel, definition: depuisServeur } : visuel;
}

/**
 * Fil d'Ariane du parcours : une puce par étape (dimension ou poids), dans
 * l'ordre. Trois états : DÉCIDÉE MANUELLEMENT (cliquable → revient à cette
 * étape, choix suivants effacés), DÉCIDÉE AUTOMATIQUEMENT (affichée avec le
 * mot « automatique », jamais cliquable — ce n'est pas une décision de
 * l'opérateur, il n'y a rien « à changer » puisqu'aucune autre valeur n'était
 * possible), COURANTE (mise en avant) ou À VENIR (grisée).
 */
function FilArianne({ etapes, choix, automatique, etapeCourante, combinaisons, onRevenir }) {
  const idxCourante = etapes.findIndex((e) => e.id === etapeCourante);
  return (
    <nav className="bg-white border-b px-6 py-3 flex gap-2 overflow-x-auto flex-wrap">
      {etapes.map((e, i) => {
        const valeur = e.champ === 'poids' ? null : choix[e.champ];
        const estAuto = e.champ !== 'poids' && automatique[e.champ];
        const decidee = e.champ !== 'poids' ? (valeur !== undefined) : false;
        const estCourante = i === idxCourante;
        const clickable = decidee && !estAuto;
        const libelle = e.champ === 'produit_id' ? nomProduit(combinaisons, valeur) : valeur;
        return (
          <button
            key={e.id}
            onClick={() => clickable && onRevenir(e.id)}
            disabled={!clickable}
            title={estAuto ? 'Posé automatiquement (une seule valeur possible) — non modifiable' : undefined}
            className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition text-left ${
              estCourante
                ? 'bg-emerald-600 text-white shadow'
                : decidee
                ? (estAuto ? 'bg-slate-100 text-slate-500 cursor-default' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200')
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            <div>{i + 1}. {e.label}</div>
            {decidee && (
              <div className="text-xs font-normal opacity-80 truncate max-w-[140px]">
                {libelle}{estAuto ? ' (automatique)' : ''}
              </div>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Tuile d'un choix : image d'abord, nom ensuite, définition métier en dessous
 * quand la valeur en porte une (les gammes : « Extra » ne dit rien, « Premium »
 * si). Sans table de visuel (`visuel` non fourni), on retombe sur le bouton
 * texte historique — aucune icône n'est inventée pour une valeur inconnue.
 */
function TuileChoix({ valeur, visuel, actif, onPick }) {
  const v = visuel ? visuel(valeur) : null;
  const Icon = v?.icon;
  const neutre = !v || v === VISUEL_NEUTRE || (v.icon === VISUEL_NEUTRE.icon && v.color === VISUEL_NEUTRE.color);
  if (!Icon) {
    return (
      <button onClick={() => onPick(valeur)}
        className={`px-6 py-8 rounded-2xl text-xl font-bold shadow-md transition transform hover:scale-105 ${
          actif ? 'bg-emerald-600 text-white ring-4 ring-emerald-300' : 'bg-white text-slate-800 hover:bg-emerald-50'
        }`}
      >{valeur}</button>
    );
  }
  return (
    <button
      onClick={() => onPick(valeur)}
      className={`relative rounded-2xl shadow-md flex flex-col items-center justify-center gap-3 py-8 px-4 transition transform hover:scale-105 ${
        actif ? 'ring-4 ring-emerald-500' : ''
      }`}
      style={{ background: v.bg, color: v.color }}
    >
      <Icon className="w-16 h-16" strokeWidth={1.5} />
      <span className="text-xl font-bold text-center leading-tight">{valeur}</span>
      {v.definition && (
        <span className="text-sm font-semibold opacity-80 text-center">{v.definition}</span>
      )}
      {neutre && (
        <span className="text-[11px] font-medium opacity-60 text-center">Image à définir</span>
      )}
    </button>
  );
}

function PickGrid({ title, items, value, onPick, cols, visuel }) {
  const colsClass = cols === 2
    ? 'grid-cols-2 md:grid-cols-4'
    : cols === 3 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-700 mb-6">{title}</h2>
      <div className={`grid gap-4 ${colsClass}`}>
        {(items || []).map((it) => (
          <TuileChoix key={it} valeur={it} visuel={visuel} actif={value === it} onPick={onPick} />
        ))}
        {(!items || items.length === 0) && (
          <div className="col-span-full text-slate-400 italic">Aucune valeur — vérifie le référentiel dans Admin → Catalogue.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Choix rangé par FAMILLES, une ligne chacune (genres : Adulte / Enfant /
 * tranches d'âge / Sans genre). Une famille vide n'est pas affichée — un
 * intitulé sans tuile en dessous se lit comme une donnée manquante.
 */
function PickGroupes({ title, groupes, value, onPick }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-700 mb-6">{title}</h2>
      {(groupes || []).length === 0 && (
        <div className="text-slate-400 italic">Aucune valeur — vérifie le référentiel dans Admin → Catalogue.</div>
      )}
      <div className="space-y-7">
        {(groupes || []).map((g) => {
          const Icon = g.icon;
          return (
            <div key={g.id}>
              <div className="flex items-center gap-2 mb-3 text-slate-600">
                {Icon && <Icon className="w-6 h-6" strokeWidth={1.8} />}
                <span className="text-sm font-bold uppercase tracking-wide">{g.label}</span>
              </div>
              <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {g.valeurs.map((it) => (
                  <button key={it} onClick={() => onPick(it)}
                    className={`px-5 py-7 rounded-2xl text-lg font-bold shadow-md transition transform hover:scale-105 ${
                      value === it ? 'bg-emerald-600 text-white ring-4 ring-emerald-300' : 'bg-white text-slate-800 hover:bg-emerald-50'
                    }`}
                  >{it}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Panneau « Réimprimer une étiquette » — l'entrée fonctionne à la fois au
 * clavier et au scan (une douchette HID se comporte comme un clavier : elle
 * tape le code puis Entrée, ce que le `<form onSubmit>` capture nativement,
 * sans hook dédié). D2 : réimpression autorisée même code, tracée côté
 * serveur ; refusée si le carton est déjà sorti.
 */
function PanneauReimpression({
  code, setCode, onChercher, loading, carton, intronvable, error,
  motif, setMotif, dejaSorti, onReimprimer, inputRef,
}) {
  return (
    <div className="no-print bg-white border-t px-6 py-5">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
        <RotateCcw className="w-4 h-4" /> Réimprimer une étiquette
      </h3>
      <form onSubmit={onChercher} className="flex flex-wrap gap-3 items-end mb-3">
        <div className="flex-1 min-w-[220px]">
          <label className="text-xs text-slate-500 font-semibold block mb-1">Code (saisie ou scan)</label>
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ex : 312A02200001F"
            className="w-full px-3 py-2 border rounded-lg font-mono"
            autoComplete="off"
          />
        </div>
        <button type="submit" disabled={loading || !code.trim()}
          className="px-5 py-2 rounded-lg bg-slate-700 text-white font-bold flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50">
          <Search className="w-4 h-4" /> Chercher
        </button>
      </form>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}

      {intronvable && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-3 py-2 mb-3">
          Aucun carton trouvé pour ce code — format reconnu : <strong>{intronvable.format_libelle}</strong>
          {intronvable.code_normalise && <> (normalisé : <span className="font-mono">{intronvable.code_normalise}</span>)</>}.
          {intronvable.format === 'inconnu' ? ' Le format n\'est reconnu par aucune codification (v2, anciennes ou balance).' : ' Ce code n\'a pas été retrouvé dans le stock importé.'}
        </div>
      )}

      {carton && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap gap-6 items-center justify-between">
          <div className="text-sm text-slate-700 space-y-0.5">
            <div className="font-mono text-lg font-bold text-slate-900">{carton.code_lisible || carton.code_barre}</div>
            <div>
              {[carton.gamme, carton.categorie_eco_org, carton.produit, carton.genre, carton.saison].filter(Boolean).join(' · ')}
              {carton.poids_kg != null && ` — ${carton.poids_kg} kg`}
            </div>
            {dejaSorti ? (
              <div className="text-rose-700 font-semibold">Déjà sorti{carton.date_sortie ? ` le ${new Date(carton.date_sortie).toLocaleDateString('fr-FR')}` : ''} — réimpression refusée.</div>
            ) : (
              <div className="text-emerald-700">En stock — réimpression possible.</div>
            )}
            {carton.nb_impressions > 0 && <div className="text-xs text-slate-400">Déjà imprimé {carton.nb_impressions} fois</div>}
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-slate-500 font-semibold block mb-1">Motif (facultatif)</label>
              <input value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={200}
                placeholder="ex : étiquette abîmée"
                className="px-3 py-2 border rounded-lg min-w-[220px]" />
            </div>
            <button onClick={onReimprimer} disabled={loading || dejaSorti}
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed">
              <Printer className="w-4 h-4" /> Réimprimer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
