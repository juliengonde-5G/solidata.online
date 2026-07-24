import { useMemo } from 'react';

/**
 * Questionnaire « style d'apprentissage » (modèle Kolb — livret parcours, EXG-32).
 * 24 items A/B. Étape du DiagnosticForm : contrôlé par `draft` / `setField`.
 *
 * Stockage :
 *  - `style_apprentissage_reponses` (JSONB) : { 1:'A', 2:'B', … 24:'A' } ;
 *  - `style_apprentissage` (enum) : profil calculé (envoyé null tant qu'incomplet
 *    → le backend ne recalcule pas un profil partiel).
 *
 * Calcul (identique à engine.computeLearningStyle) :
 *  - items 1-12 → axe PERCEPTION : A = expérience concrète (CE), B = conceptualisation (AC) ;
 *  - items 13-24 → axe TRAITEMENT : A = expérimentation active (AE), B = observation réfléchie (RO) ;
 *  - majorité simple par axe (égalité → CE / AE), puis quadrant Kolb.
 * Complément — non substitut — du PCM.
 */

// 24 items — option A (1er pôle) / option B (2e pôle). L'ordre importe : les 12
// premiers portent la PERCEPTION, les 12 suivants le TRAITEMENT.
export const STYLE_ITEMS = [
  // Perception : A = concret / vécu (CE), B = abstrait / théorie (AC)
  { q: 'Pour apprendre une tâche, je préfère…', a: "l'essayer directement, avec mes mains", b: "qu'on m'explique d'abord le principe" },
  { q: 'Je retiens mieux…', a: 'ce que je vis concrètement', b: 'ce que je comprends en théorie' },
  { q: 'Face à une nouveauté, je me fie plutôt à…', a: 'mon ressenti et mon expérience', b: 'la logique et l\'analyse' },
  { q: "Ce qui m'attire le plus…", a: 'les situations réelles, le terrain', b: 'les idées et les concepts' },
  { q: 'Quand on me forme, je préfère…', a: 'des exemples concrets', b: 'des explications structurées' },
  { q: 'Je me sens le plus à l\'aise dans…', a: 'l\'action immédiate', b: 'la réflexion posée' },
  { q: 'Pour comprendre un métier…', a: 'je regarde quelqu\'un le faire', b: 'j\'en étudie le fonctionnement' },
  { q: 'Je fais surtout confiance à…', a: 'mon intuition', b: 'mon raisonnement' },
  { q: 'Ce qui compte le plus pour moi…', a: 'l\'expérience vécue', b: 'la compréhension des règles' },
  { q: 'J\'apprends surtout…', a: 'en ressentant les choses', b: 'en y réfléchissant' },
  { q: 'Je préfère un formateur qui…', a: 'montre', b: 'explique' },
  { q: 'Une consigne me parle mieux si…', a: 'elle est illustrée par un exemple', b: 'elle décrit la logique générale' },
  // Traitement : A = agir / expérimenter (AE), B = observer / réfléchir (RO)
  { q: 'Après avoir appris quelque chose…', a: 'je veux tout de suite le mettre en pratique', b: 'je préfère l\'observer encore un peu' },
  { q: 'En groupe, je suis plutôt…', a: 'celui / celle qui agit', b: 'celui / celle qui observe' },
  { q: 'Pour progresser…', a: 'j\'essaie et je corrige', b: 'je regarde comment font les autres' },
  { q: 'Devant un problème…', a: 'je teste des solutions', b: 'je prends du recul pour réfléchir' },
  { q: 'Je me lance…', a: 'rapidement', b: 'après avoir bien observé' },
  { q: 'Je préfère…', a: 'expérimenter par moi-même', b: 'analyser avant d\'agir' },
  { q: 'On me décrirait comme quelqu\'un qui…', a: 'fonce', b: 'réfléchit avant' },
  { q: 'Une formation utile me fait surtout…', a: 'pratiquer', b: 'observer et comprendre' },
  { q: 'Face à une machine nouvelle…', a: 'je l\'utilise pour comprendre', b: 'je regarde d\'abord quelqu\'un l\'utiliser' },
  { q: 'Mes meilleures idées viennent…', a: 'en faisant', b: 'en prenant du recul' },
  { q: 'Je préfère…', a: 'apprendre sur le tas', b: 'préparer avant de me lancer' },
  { q: 'Quand j\'ai un doute…', a: 'j\'essaie pour voir', b: 'j\'observe et j\'attends' },
];

// Description + implications pédagogiques des 4 profils (accompagnement ETI/CIP).
export const LEARNING_STYLE_INFO = {
  adaptateur: {
    label: 'Adaptateur',
    axes: 'Expérience concrète + Expérimentation active',
    desc: "Apprend en faisant et en s'adaptant. Aime l'action, le terrain, relever des défis concrets.",
    pedago: "Confier des tâches réelles rapidement, apprentissage « sur le tas », varier les situations, éviter les longs exposés théoriques.",
    color: 'bg-orange-50 border-orange-300 text-orange-800',
  },
  divergeur: {
    label: 'Divergeur',
    axes: 'Expérience concrète + Observation réfléchie',
    desc: 'Apprend en observant et en donnant du sens. Sensible, imaginatif, à l\'écoute des autres.',
    pedago: "Laisser observer avant d'agir, valoriser le travail en groupe et l'échange, donner du temps pour comprendre le « pourquoi ».",
    color: 'bg-pink-50 border-pink-300 text-pink-800',
  },
  assimilateur: {
    label: 'Assimilateur',
    axes: 'Conceptualisation abstraite + Observation réfléchie',
    desc: 'Apprend en comprenant la logique. Aime les idées claires, les modèles, les explications structurées.',
    pedago: 'Expliquer le cadre et les règles, fournir des supports écrits et des schémas, procéder par étapes ordonnées.',
    color: 'bg-violet-50 border-violet-300 text-violet-800',
  },
  convergeur: {
    label: 'Convergeur',
    axes: 'Conceptualisation abstraite + Expérimentation active',
    desc: 'Apprend en appliquant des principes à des problèmes concrets. Aime résoudre, décider, être efficace.',
    pedago: 'Donner un objectif clair puis laisser expérimenter, proposer des problèmes à résoudre, relier théorie et application.',
    color: 'bg-teal-50 border-teal-300 text-teal-800',
  },
};

// Miroir EXACT de engine.computeLearningStyle (déterministe). Calcule seulement
// quand les 24 items sont renseignés (affichage honnête « répondez à tout »).
export function computeStyleFromAnswers(rep) {
  if (!rep) return null;
  const arr = [];
  for (let i = 1; i <= STYLE_ITEMS.length; i++) {
    const v = rep[i];
    if (v !== 'A' && v !== 'B') return null; // incomplet
    arr.push(v);
  }
  const half = Math.floor(arr.length / 2);
  const perc = arr.slice(0, half);
  const proc = arr.slice(half);
  const countA = (xs) => xs.filter((x) => x === 'A').length;
  const percA = countA(perc);
  const procA = countA(proc);
  const perception = percA >= perc.length - percA ? 'CE' : 'AC';
  const processing = procA >= proc.length - procA ? 'AE' : 'RO';
  if (perception === 'CE' && processing === 'AE') return 'adaptateur';
  if (perception === 'CE' && processing === 'RO') return 'divergeur';
  if (perception === 'AC' && processing === 'RO') return 'assimilateur';
  return 'convergeur';
}

export default function StyleApprentissage({ draft = {}, setField, relecture = false }) {
  const rep = draft.style_apprentissage_reponses || {};
  const answered = useMemo(() => STYLE_ITEMS.filter((_, i) => rep[i + 1] === 'A' || rep[i + 1] === 'B').length, [rep]);
  const complete = answered === STYLE_ITEMS.length;
  // Profil : celui stocké par le serveur si présent, sinon calcul local.
  const style = draft.style_apprentissage || (complete ? computeStyleFromAnswers(rep) : null);
  const info = style ? LEARNING_STYLE_INFO[style] : null;

  const setAnswer = (n, val) => {
    if (!setField) return;
    const cur = rep[n] === val ? undefined : val;
    const next = { ...rep };
    if (cur == null) delete next[n]; else next[n] = cur;
    setField('style_apprentissage_reponses', next);
    // Profil recalculé côté client : envoyé au serveur (null tant qu'incomplet
    // → le backend ne fabrique pas un profil partiel).
    const computed = computeStyleFromAnswers(next);
    setField('style_apprentissage', computed);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2">
        Questionnaire du livret de parcours (24 questions) — pour chaque phrase, choisissez la réponse qui vous
        ressemble le plus. Il n'y a pas de bonne réponse. Résultat : un profil d'apprentissage qui complète le PCM
        (aide l'encadrant à adapter sa façon de former).
      </p>

      <div className="flex items-center gap-3">
        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
          <div className="bg-teal-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.round((answered / STYLE_ITEMS.length) * 100)}%` }} />
        </div>
        <span className="text-[11px] text-gray-400 whitespace-nowrap">{answered}/{STYLE_ITEMS.length} répondu(s)</span>
      </div>

      {info && (
        <div className={`rounded-lg border p-3 ${info.color}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">Profil : {info.label}</span>
            <span className="text-[11px] opacity-70">({info.axes})</span>
            {!complete && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/60">estimation partielle</span>}
          </div>
          <p className="text-xs mt-1">{info.desc}</p>
          <p className="text-xs mt-1"><span className="font-medium">Comment l'accompagner :</span> {info.pedago}</p>
        </div>
      )}
      {!info && (
        <p className="text-xs text-gray-400 border border-dashed rounded-lg p-2 text-center">
          Le profil s'affichera une fois les 24 questions renseignées.
        </p>
      )}

      <div className="space-y-2">
        {STYLE_ITEMS.map((it, i) => {
          const n = i + 1;
          const val = rep[n];
          return (
            <div key={n} className={`rounded-lg border p-2.5 ${val ? 'border-teal-200 bg-teal-50/30' : 'border-gray-200'}`}>
              <p className={`font-medium text-gray-700 mb-1.5 ${relecture ? 'text-base' : 'text-sm'}`}>{n}. {it.q}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {[['A', it.a], ['B', it.b]].map(([opt, txt]) => (
                  <button key={opt} type="button" onClick={() => setAnswer(n, opt)}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition ${
                      val === opt ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-teal-400'
                    }`}>
                    <span className="font-semibold mr-1.5">{opt}.</span>{txt}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
