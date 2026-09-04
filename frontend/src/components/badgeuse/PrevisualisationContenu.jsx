/**
 * Prévisualisation 16:9 d'un élément de playlist (BO-08), pour tous les types
 * v2 (CDC_AFFICHAGE_V2.md §2/§4).
 *
 * DEUX MODES, un seul composant :
 *
 *  - APERÇU (onglet Affichage) : l'élément vient de `GET /badgeuse/contenus`,
 *    donc SANS le contenu calculé. Les générateurs sont illustrés par des
 *    données d'exemple, clairement annotées — jamais une vraie donnée
 *    personnelle (aucun nom complet, jamais de nom de chauffeur, ADR-0004 §5).
 *
 *  - DIRECT (onglet Écran en direct) : l'élément vient de
 *    `GET /badgeuse/ecran-direct`, c'est-à-dire de la playlist RÉELLE du poste,
 *    qui porte déjà ses données (`annonces`, `actus`, `tournees`, `posts`,
 *    `vak`, `meteo`, `article`, `carte`). Elles sont alors affichées telles
 *    quelles : c'est ce que voit l'atelier.
 *
 * Le mode n'est pas un drapeau à passer : chaque bloc regarde s'il a reçu sa
 * donnée. Un générateur sans donnée reste un aperçu — on ne fabrique jamais
 * un chiffre pour remplir un écran.
 *
 * LES MÉDIAS SONT VRAIMENT AFFICHÉS. Les fichiers ne sont servis que sous
 * authentification (`GET /badgeuse/apercu-media/:ref`) : une balise <img src>
 * ne porterait pas le jeton, ils sont donc récupérés en blob puis rendus
 * depuis une URL d'objet, libérée au démontage.
 */
import { useEffect, useState } from 'react';
import {
  Cake, PartyPopper, Newspaper, Truck, Share2, Scale, Image as ImageIcon, Video, Link2,
  CloudSun, Map as MapIcon, AlertTriangle,
} from 'lucide-react';
import api from '../../services/api';
import { TYPE_CONTENU_LABELS, fmtKg, RESEAUX_LABELS } from './badgeuseShared';

// ── Média servi par le back-office (blob → URL d'objet) ─────────────────────
function useApercuMedia(ref) {
  const [etat, setEtat] = useState({ url: null, erreur: null, chargement: !!ref });

  useEffect(() => {
    if (!ref) { setEtat({ url: null, erreur: null, chargement: false }); return undefined; }
    let vivant = true;
    let objectUrl = null;
    setEtat({ url: null, erreur: null, chargement: true });
    api.get(`/badgeuse/apercu-media/${ref}`, { responseType: 'blob' })
      .then((r) => {
        if (!vivant) return;
        objectUrl = URL.createObjectURL(r.data);
        setEtat({ url: objectUrl, erreur: null, chargement: false });
      })
      .catch(() => {
        // Fichier absent du disque, ou non diffusable : on le DIT, on
        // n'affiche pas un cadre vide qui passerait pour un défaut d'écran.
        if (vivant) setEtat({ url: null, erreur: 'Fichier introuvable sur le serveur', chargement: false });
      });
    return () => {
      vivant = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ref]);

  return etat;
}

function Cadre({ children, badge }) {
  return (
    <div className="aspect-video w-full rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center text-center px-8 py-6 overflow-hidden relative">
      <span className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold mb-3">{badge}</span>
      {children}
    </div>
  );
}

function ApercuTag() {
  return (
    <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded-full px-2 py-0.5">
      Aperçu — donnée d'exemple
    </span>
  );
}

// ── Annonces (anniversaires — prénom + initiale, opt-in uniquement) ─────────
function ApercuAnnonces({ donnees }) {
  const reelles = Array.isArray(donnees) && donnees.length > 0;
  const items = reelles ? donnees : [
    { prenom: 'Karim', initiale: 'B', type: 'anniversaire' },
    { prenom: 'Julie', initiale: 'M', type: 'anniversaire_entreprise', annees: 2 },
  ];
  return (
    <Cadre badge="Annonces du jour">
      {!reelles && <ApercuTag />}
      <div className="flex flex-col gap-2 text-white">
        {items.map((a, i) => (
          <div key={`${a.prenom}-${a.type}-${i}`} className="flex items-center gap-2 justify-center">
            {a.type === 'anniversaire_entreprise'
              ? <PartyPopper className="w-5 h-5 text-amber-300" />
              : <Cake className="w-5 h-5 text-pink-300" />}
            <span>
              {a.prenom} {a.initiale}.
              {a.type === 'anniversaire_entreprise' ? ` — ${a.annees} an(s) avec nous !` : ' — bon anniversaire !'}
            </span>
          </div>
        ))}
      </div>
      <p className="text-slate-400 text-xs mt-3">Prénom + initiale, salariés ayant donné leur accord uniquement</p>
    </Cadre>
  );
}

function ApercuActus({ config, donnees }) {
  const reelles = Array.isArray(donnees) && donnees.length > 0;
  const n = Number(config?.nb_actus) || 3;
  const items = reelles ? donnees : [{
    titre: 'Titre de la brève (exemple)',
    resume: "Résumé généré depuis le fil d'actualités SOLIDATA — 2 à 3 phrases, source citée.",
    source: null,
  }];
  return (
    <Cadre badge="Fil d'actualités">
      {!reelles && <ApercuTag />}
      <Newspaper className="w-8 h-8 text-teal-300 mb-2" />
      <h2 className="text-white font-bold" style={{ fontSize: 'clamp(1.1rem, 3vw, 1.6rem)' }}>{items[0].titre}</h2>
      {items[0].resume && <p className="text-slate-300 mt-2 max-w-xl text-sm line-clamp-3">{items[0].resume}</p>}
      <p className="text-slate-500 text-xs mt-3">
        {items[0].source ? `${items[0].source} — ` : ''}
        {reelles ? `${items.length} brève(s) en rotation` : `${n} dernière(s) brève(s) affichée(s) en rotation`}
      </p>
    </Cadre>
  );
}

function ApercuPresse({ article, mediaRef }) {
  const media = useApercuMedia(mediaRef);
  return (
    <Cadre badge="Actualité nationale">
      {!article && <ApercuTag />}
      {media.url && <img src={media.url} alt="" className="max-h-[45%] max-w-[70%] object-contain rounded-lg mb-2" />}
      <h2 className="text-white font-bold" style={{ fontSize: 'clamp(1rem, 2.6vw, 1.5rem)' }}>
        {article?.titre || "Titre de l'article (exemple)"}
      </h2>
      {(article?.chapo || !article) && (
        <p className="text-slate-300 mt-2 max-w-xl text-sm line-clamp-3">
          {article?.chapo || 'Chapô de l’article, repris du flux de presse avec attribution de la source.'}
        </p>
      )}
      <p className="text-slate-500 text-xs mt-3">{article?.source || 'Source citée à l’écran'}</p>
    </Cadre>
  );
}

function ApercuTournees({ donnees }) {
  const reelles = Array.isArray(donnees) && donnees.length > 0;
  const rows = reelles ? donnees : [
    { libelle: 'Tournée Nord', vehicule: 'CAV-12', points_faits: 5, points_total: 9 },
    { libelle: 'Tournée Sud', vehicule: 'CAV-04', points_faits: 2, points_total: 6 },
  ];
  return (
    <Cadre badge="Tournées en cours">
      {!reelles && <ApercuTag />}
      <Truck className="w-8 h-8 text-teal-300 mb-2" />
      <div className="w-full max-w-sm space-y-3">
        {rows.map((r, i) => {
          const total = Number(r.points_total) || 0;
          const faits = Number(r.points_faits) || 0;
          return (
            <div key={`${r.libelle}-${i}`} className="text-left">
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>{r.libelle}{r.vehicule ? ` — ${r.vehicule}` : ''}</span>
                <span>{faits}/{total} points</span>
              </div>
              <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full bg-teal-400" style={{ width: total > 0 ? `${Math.round((faits / total) * 100)}%` : '0%' }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-slate-500 text-xs mt-3">Sans nom de chauffeur (ADR-0004 §5)</p>
    </Cadre>
  );
}

// La carte du kiosque est dessinée en SVG à partir des secteurs du territoire.
// La redessiner ici dupliquerait 150 lignes du poste pour un cadre de 16 cm :
// on restitue ce qu'elle DIT (combien de véhicules, sur quelles communes), et
// on le dit tel quel plutôt que d'afficher une carte qui ne serait pas la même.
function ApercuTourneesCarte({ carte }) {
  const vehicules = Array.isArray(carte?.vehicules) ? carte.vehicules : [];
  return (
    <Cadre badge="Position des tournées">
      {!carte && <ApercuTag />}
      <MapIcon className="w-8 h-8 text-teal-300 mb-2" />
      {carte ? (
        <>
          <div className="text-white font-bold" style={{ fontSize: 'clamp(1.2rem, 3vw, 1.8rem)' }}>
            {vehicules.length} véhicule(s) sur le territoire
          </div>
          <p className="text-slate-300 text-sm mt-2 max-w-md">
            {vehicules.map((v) => v.secteur || v.commune).filter(Boolean).join(' · ') || 'Secteurs non déterminés'}
          </p>
        </>
      ) : (
        <p className="text-slate-300 text-sm max-w-md">Véhicules situés à la commune sur un fond dessiné localement.</p>
      )}
      <p className="text-slate-500 text-xs mt-3">
        Le poste dessine la carte ; cet encadré en restitue le contenu, jamais le tracé.
      </p>
    </Cadre>
  );
}

function ApercuSocial({ config, donnees }) {
  const reelles = Array.isArray(donnees) && donnees.length > 0;
  const post = reelles ? donnees[0] : null;
  const media = useApercuMedia(post?.media_id || null);
  const n = Number(config?.nb_posts) || 5;
  return (
    <Cadre badge="Réseaux sociaux">
      {!reelles && <ApercuTag />}
      <div className="bg-white/5 border border-white/10 rounded-lg p-4 max-w-sm text-left w-full">
        <div className="flex items-center gap-2 mb-2">
          <Share2 className="w-4 h-4 text-teal-300" />
          <span className="text-white text-sm font-semibold">@{post?.compte || 'fripandcorouen'}</span>
          <span className="text-[10px] text-slate-400 ml-auto">{RESEAUX_LABELS[post?.reseau || 'instagram']}</span>
        </div>
        {media.url
          ? <img src={media.url} alt="" className="h-24 w-full object-cover rounded mb-2" />
          : <div className="h-24 rounded bg-slate-700/60 mb-2" />}
        <p className="text-slate-300 text-xs line-clamp-2">
          {post?.legende || 'Légende du post publié par la structure (exemple).'}
        </p>
      </div>
      <p className="text-slate-500 text-xs mt-3">
        {reelles ? `${donnees.length} post(s) en rotation` : `${n} dernier(s) post(s) affiché(s) en rotation`}
      </p>
    </Cadre>
  );
}

function jauge(valeur, objectif) {
  const v = Number(valeur);
  const o = Number(objectif);
  if (!Number.isFinite(v) || !Number.isFinite(o) || o <= 0) return null;
  return Math.min(100, Math.round((v / o) * 100));
}

function ApercuVakLive({ donnees }) {
  const reel = donnees && typeof donnees === 'object';
  const poids = reel ? donnees.poids_kg : 1245;
  const pct = reel ? jauge(donnees.poids_kg, donnees.objectif_poids_kg) : 62;
  return (
    <Cadre badge="Vente au Kilo">
      {!reel && <ApercuTag />}
      <Scale className="w-8 h-8 text-orange-300 mb-2" />
      <div className="text-white font-extrabold" style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)' }}>{fmtKg(poids)}</div>
      <p className="text-slate-300 text-sm mt-1">vendus depuis l'ouverture</p>
      {pct == null ? (
        // Pas d'objectif saisi : pas de jauge. Une barre à 0 % se lirait comme
        // « rien de vendu », ce qui serait faux.
        reel && <p className="text-slate-500 text-xs mt-3">Aucun objectif de poids saisi pour cette vente</p>
      ) : (
        <>
          <div className="w-full max-w-xs h-2 rounded-full bg-slate-700 overflow-hidden mt-3">
            <div className="h-full bg-orange-400" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-slate-500 text-xs mt-2">
            {reel ? `${donnees.libelle || 'Vente au Kilo'} — ${pct} % de l’objectif` : 'Vente au Kilo — édition en cours (jauge d’objectif)'}
          </p>
        </>
      )}
    </Cadre>
  );
}

function ApercuMeteo({ donnees, corps }) {
  const jour = donnees?.aujourdhui || donnees?.jour || null;
  return (
    <Cadre badge="Météo">
      {!donnees && <ApercuTag />}
      <CloudSun className="w-8 h-8 text-sky-300 mb-2" />
      {jour ? (
        <>
          <div className="text-white font-extrabold" style={{ fontSize: 'clamp(1.8rem, 5vw, 3rem)' }}>
            {jour.temperature_max == null ? '—' : `${Math.round(jour.temperature_max)} °C`}
          </div>
          <p className="text-slate-300 text-sm mt-1">{donnees.lieu || 'Lieu du poste'}</p>
        </>
      ) : (
        <p className="text-slate-300 text-sm max-w-md">
          {corps || 'Prévision du lieu du poste, relevée par le serveur (Open-Meteo).'}
        </p>
      )}
      <p className="text-slate-500 text-xs mt-3">
        {donnees?.releve_le ? 'Relevé daté affiché à l’écran' : 'Sans prévision disponible, le poste affiche le texte de repli'}
      </p>
    </Cadre>
  );
}

// ── Média / lien : le VRAI fichier, plus une vignette générique ─────────────
function ApercuMedia({ contenu }) {
  // En direct la référence arrive déjà préfixée (`media_id`) ; en aperçu on la
  // compose depuis l'identifiant du contenu.
  const ref = contenu.media_id || (contenu.id ? `c${contenu.id}` : null);
  const estVideo = contenu.media_type === 'video' || /\.(mp4|webm|mov)$/i.test(String(contenu.fichier || ''));
  const media = useApercuMedia(ref);
  const nomFichier = contenu.fichier || contenu.titre || 'fichier';

  return (
    <Cadre badge={contenu.type === 'lien' ? 'Lien partagé' : 'Média'}>
      {media.url && !estVideo && (
        <img src={media.url} alt={contenu.titre || 'Média'} className="max-h-[70%] max-w-[90%] object-contain rounded-lg" />
      )}
      {media.url && estVideo && (
        // Muette et en boucle : c'est une vignette de contrôle, pas une
        // séance de visionnage — et le son n'a aucun sens dans un back-office.
        <video src={media.url} className="max-h-[70%] max-w-[90%] rounded-lg" autoPlay muted loop playsInline controls />
      )}
      {!media.url && (
        <div className="flex flex-col items-center gap-2 text-slate-300">
          {estVideo ? <Video className="w-10 h-10" /> : <ImageIcon className="w-10 h-10" />}
          <span className="text-xs text-slate-400 max-w-[80%] truncate" title={nomFichier}>
            {media.chargement ? 'Chargement du média…' : nomFichier}
          </span>
          {media.erreur && (
            <span className="text-[11px] text-amber-300 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {media.erreur}
            </span>
          )}
          {contenu.type === 'lien' && contenu.source_url && (
            <span className="text-[11px] text-slate-500 flex items-center gap-1 max-w-[85%] truncate">
              <Link2 className="w-3 h-3 flex-shrink-0" /> {contenu.source_url}
            </span>
          )}
        </div>
      )}
      {contenu.titre && <p className="text-white font-semibold mt-3">{contenu.titre}</p>}
    </Cadre>
  );
}

// ── Types V1 : message, image, planning, compte_a_rebours ──────────────────
function ApercuGenerique({ contenu }) {
  return (
    <div className="aspect-video w-full rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center text-center px-10 py-8 overflow-hidden">
      <span className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold mb-3">{TYPE_CONTENU_LABELS[contenu.type] || contenu.type}</span>
      <h2 className="text-white font-bold leading-tight" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.75rem)' }}>{contenu.titre || 'Sans titre'}</h2>
      {contenu.type === 'image' && contenu.media_url && (
        <img src={contenu.media_url} alt={contenu.titre || 'Contenu image'} className="mt-4 max-h-[45%] max-w-[80%] object-contain rounded-lg" />
      )}
      {contenu.corps && (
        <p className="text-slate-300 mt-4 max-w-2xl" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.25rem)' }}>{contenu.corps}</p>
      )}
    </div>
  );
}

export default function PrevisualisationContenu({ contenu, sansPied = false }) {
  if (!contenu) {
    return (
      <div className="aspect-video w-full rounded-xl bg-slate-900 flex items-center justify-center text-slate-500 text-sm">
        Sélectionnez un contenu pour le prévisualiser
      </div>
    );
  }
  let body;
  switch (contenu.type) {
    case 'annonces': body = <ApercuAnnonces donnees={contenu.annonces} />; break;
    case 'actus': body = <ApercuActus config={contenu.config} donnees={contenu.actus} />; break;
    case 'presse': body = <ApercuPresse article={contenu.article} mediaRef={contenu.media_id} />; break;
    case 'tournees': body = <ApercuTournees donnees={contenu.tournees} />; break;
    case 'tournees_carte': body = <ApercuTourneesCarte carte={contenu.carte} />; break;
    case 'social': body = <ApercuSocial config={contenu.config} donnees={contenu.posts} />; break;
    case 'vak_live': body = <ApercuVakLive donnees={contenu.vak} />; break;
    case 'meteo': body = <ApercuMeteo donnees={contenu.meteo} corps={contenu.corps} />; break;
    case 'media':
    case 'lien': body = <ApercuMedia contenu={contenu} />; break;
    default: body = <ApercuGenerique contenu={contenu} />;
  }
  return (
    <div>
      {body}
      {!sansPied && <span className="text-slate-400 text-xs block mt-2">{contenu.duree_sec || 10} s à l'écran</span>}
    </div>
  );
}
