/**
 * Prévisualisation 16:9 d'un élément de playlist (BO-08), pour tous les types
 * v2 (CDC_AFFICHAGE_V2.md §2/§4). Pour les GÉNÉRATEURS (annonces, actus,
 * tournees, social, vak_live), le contenu réel est calculé côté serveur à
 * chaque construction de playlist : cet écran affiche donc des DONNÉES
 * D'EXEMPLE clairement annotées « aperçu », jamais une vraie donnée
 * personnelle (aucun nom complet, aucun statut, jamais de nom de chauffeur —
 * ADR-0004 §5).
 */
import { Cake, PartyPopper, Newspaper, Truck, Share2, Scale, Image as ImageIcon, Video, Link2 } from 'lucide-react';
import { TYPE_CONTENU_LABELS, fmtKg, RESEAUX_LABELS } from './badgeuseShared';

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

// ── Aperçus des générateurs (données fictives, format seulement) ────────────
function ApercuAnnonces() {
  return (
    <Cadre badge="Annonces du jour">
      <ApercuTag />
      <div className="flex flex-col gap-2 text-white">
        <div className="flex items-center gap-2 justify-center"><Cake className="w-5 h-5 text-pink-300" /><span>Karim B. — bon anniversaire !</span></div>
        <div className="flex items-center gap-2 justify-center"><PartyPopper className="w-5 h-5 text-amber-300" /><span>Julie M. — 2 ans avec nous !</span></div>
      </div>
      <p className="text-slate-400 text-xs mt-3">Affiché uniquement s'il y a au moins une annonce, prénom + initiale, opt-in uniquement</p>
    </Cadre>
  );
}
function ApercuActus({ config }) {
  const n = Number(config?.nb_actus) || 3;
  return (
    <Cadre badge="Fil d'actualités">
      <ApercuTag />
      <Newspaper className="w-8 h-8 text-teal-300 mb-2" />
      <h2 className="text-white font-bold" style={{ fontSize: 'clamp(1.1rem, 3vw, 1.6rem)' }}>Titre de la brève (exemple)</h2>
      <p className="text-slate-300 mt-2 max-w-xl text-sm">Résumé généré depuis le fil d'actualités SOLIDATA — 2 à 3 phrases, source citée.</p>
      <p className="text-slate-500 text-xs mt-3">{n} dernière(s) brève(s) affichée(s) en rotation</p>
    </Cadre>
  );
}
function ApercuTournees() {
  const rows = [
    { label: 'Tournée Nord', vehicule: 'CAV-12', fait: 5, total: 9 },
    { label: 'Tournée Sud', vehicule: 'CAV-04', fait: 2, total: 6 },
  ];
  return (
    <Cadre badge="Tournées en cours">
      <ApercuTag />
      <Truck className="w-8 h-8 text-teal-300 mb-2" />
      <div className="w-full max-w-sm space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="text-left">
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>{r.label} — {r.vehicule}</span>
              <span>{r.fait}/{r.total} CAV</span>
            </div>
            <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
              <div className="h-full bg-teal-400" style={{ width: `${Math.round((r.fait / r.total) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-slate-500 text-xs mt-3">Sans nom de chauffeur (ADR-0004 §5)</p>
    </Cadre>
  );
}
function ApercuSocial({ config }) {
  const n = Number(config?.nb_posts) || 4;
  return (
    <Cadre badge="Réseaux sociaux">
      <ApercuTag />
      <div className="bg-white/5 border border-white/10 rounded-lg p-4 max-w-sm text-left">
        <div className="flex items-center gap-2 mb-2">
          <Share2 className="w-4 h-4 text-teal-300" />
          <span className="text-white text-sm font-semibold">@fripandcorouen</span>
          <span className="text-[10px] text-slate-400 ml-auto">{RESEAUX_LABELS.instagram}</span>
        </div>
        <div className="h-24 rounded bg-slate-700/60 mb-2" />
        <p className="text-slate-300 text-xs">Légende du post publié par la structure (exemple).</p>
      </div>
      <p className="text-slate-500 text-xs mt-3">{n} dernier(s) post(s) affiché(s) en rotation — stories vidéo : V2</p>
    </Cadre>
  );
}
function ApercuVakLive() {
  return (
    <Cadre badge="Vente au Kilo">
      <ApercuTag />
      <Scale className="w-8 h-8 text-orange-300 mb-2" />
      <div className="text-white font-extrabold" style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)' }}>{fmtKg(1245)}</div>
      <p className="text-slate-300 text-sm mt-1">vendus depuis l'ouverture</p>
      <div className="w-full max-w-xs h-2 rounded-full bg-slate-700 overflow-hidden mt-3">
        <div className="h-full bg-orange-400" style={{ width: '62%' }} />
      </div>
      <p className="text-slate-500 text-xs mt-2">Vente au Kilo — édition en cours (jauge d'objectif)</p>
    </Cadre>
  );
}

// ── Aperçu média/lien (image servie par le poste, ou vignette générique) ────
// Le fichier est stocké côté serveur sous `contenu.fichier` (chemin relatif
// uploads/badgeuse) — il n'existe PAS encore de route back-office pour le
// prévisualiser depuis le navigateur admin (seule l'API device authentifiée
// par clé le sert) : le repli « vignette générique + nom de fichier » est
// donc la voie normale ici, `media_preview_url`/`preview_url` restant un
// crochet défensif pour une future route de prévisualisation.
function ApercuMedia({ contenu }) {
  const previewUrl = contenu.media_preview_url || contenu.preview_url || null;
  const nomFichier = contenu.fichier || contenu.titre || 'fichier';
  const estVideo = contenu.media_type === 'video' || /\.(mp4|webm|mov)$/i.test(String(contenu.fichier || ''));
  return (
    <Cadre badge={contenu.type === 'lien' ? 'Lien partagé' : 'Média'}>
      {previewUrl && !estVideo ? (
        <img src={previewUrl} alt={contenu.titre || 'Média'} className="max-h-[65%] max-w-[85%] object-contain rounded-lg" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-slate-300">
          {estVideo ? <Video className="w-10 h-10" /> : <ImageIcon className="w-10 h-10" />}
          <span className="text-xs text-slate-400 max-w-[80%] truncate" title={nomFichier}>{nomFichier}</span>
          {contenu.type === 'lien' && contenu.source_url && (
            <span className="text-[11px] text-slate-500 flex items-center gap-1 max-w-[85%] truncate"><Link2 className="w-3 h-3 flex-shrink-0" /> {contenu.source_url}</span>
          )}
        </div>
      )}
      {contenu.titre && <p className="text-white font-semibold mt-3">{contenu.titre}</p>}
    </Cadre>
  );
}

// ── Aperçu générique (types V1 : message, image, planning, compte_a_rebours, meteo) ─
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

export default function PrevisualisationContenu({ contenu }) {
  if (!contenu) {
    return (
      <div className="aspect-video w-full rounded-xl bg-slate-900 flex items-center justify-center text-slate-500 text-sm">
        Sélectionnez un contenu pour le prévisualiser
      </div>
    );
  }
  let body;
  switch (contenu.type) {
    case 'annonces': body = <ApercuAnnonces />; break;
    case 'actus': body = <ApercuActus config={contenu.config} />; break;
    case 'tournees': body = <ApercuTournees />; break;
    case 'social': body = <ApercuSocial config={contenu.config} />; break;
    case 'vak_live': body = <ApercuVakLive />; break;
    case 'media':
    case 'lien': body = <ApercuMedia contenu={contenu} />; break;
    default: body = <ApercuGenerique contenu={contenu} />;
  }
  return (
    <div>
      {body}
      <span className="text-slate-400 text-xs block mt-2">{contenu.duree_sec || 10} s à l'écran</span>
    </div>
  );
}
