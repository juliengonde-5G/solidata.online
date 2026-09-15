import { useState, useEffect } from 'react';

/**
 * Formulaire d'avis de l'encadrant technique sur un renouvellement de CDDI.
 *
 * ═══ POURQUOI UN COMPOSANT PARTAGÉ ════════════════════════════════════════
 * Ce formulaire est servi par DEUX écrans : `/eti/renouvellement/:token`
 * (public, sans compte — le cas courant) et `/insertion/renouvellement/:id`
 * (pour un encadrant qui a un compte). Le recopier, c'est accepter qu'un jour
 * l'une des deux versions gagne une question que l'autre n'a pas — et que deux
 * encadrants répondent à deux formulaires différents sur la même trame.
 *
 * ═══ RÈGLES D'ÉCRAN (FALC) ════════════════════════════════════════════════
 * Cibles ≥ 44 px, une question par bloc, aucun jargon, aucun champ obligatoire
 * hors l'avis et la durée. Le destinataire n'est pas un utilisateur du logiciel :
 * il remplit une trame papier, sur un téléphone, souvent debout dans l'atelier.
 */

const NIVEAUX = [['bonne', 'Bonne'], ['moyenne', 'Moyenne'], ['insuffisante', 'Insuffisante']];
const PARTICIPATIONS = [
  ['entretiens_cip', 'Vient aux entretiens avec la CIP'],
  ['formations', 'Participe aux formations proposées'],
  ['pmsmp', 'A fait ou prépare une immersion (PMSMP)'],
  ['demarches', 'Fait ses démarches (emploi, administratif)'],
];
const MOTIFS = [
  ['progression', 'La personne progresse, il faut continuer'],
  ['consolidation', 'Consolider les acquis au poste'],
  ['projet_en_cours', 'Un projet professionnel est en cours'],
  ['levee_freins', 'Des difficultés sont en cours de résolution'],
  ['autre', 'Autre raison (à préciser en commentaire)'],
];
const AVIS = [
  ['favorable', 'Favorable', 'bg-green-600 border-green-600', 'hover:border-green-400'],
  ['favorable_reserves', 'Favorable avec réserves', 'bg-amber-500 border-amber-500', 'hover:border-amber-400'],
  ['defavorable', 'Défavorable', 'bg-red-600 border-red-600', 'hover:border-red-400'],
];

const VIDE = {
  assiduite: null, motivation: null, autonomie: null,
  participation_actions: [], competences_acquises: '', projet_professionnel: '',
  motifs: [], commentaires: '',
};

/**
 * Les SEULES clés que ce formulaire écrit — miroir de la liste blanche du
 * serveur (`routes/insertion/eti-public.js › CLES_FORMULAIRE_ETI`).
 *
 * Le même blob `renouvellement_form` porte aussi la trame INTERNE que la CIP
 * remplit dans la fiche : la projeter ici évite qu'un champ libre de la
 * conseillère soit affiché à l'encadrant, puis renvoyé comme s'il était le sien
 * (correctif B-02).
 */
export const CLES_FORMULAIRE_ETI = ['assiduite', 'motivation', 'autonomie', 'participation_actions',
  'competences_acquises', 'projet_professionnel', 'motifs', 'commentaires', 'rempli_par'];

export function projeterFormulaireEti(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return {};
  return Object.fromEntries(Object.entries(f).filter(([k]) => CLES_FORMULAIRE_ETI.includes(k)));
}

/** Bouton radio LARGE (≥ 44 px — utilisateur peu à l'aise au clavier/à l'écran). */
export function BigChoice({ selected, onClick, disabled, children, activeClass = 'bg-teal-600 border-teal-600', hoverClass = 'hover:border-teal-400' }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected}
      className={`min-h-[48px] px-5 rounded-xl border-2 text-base font-medium transition ${
        selected ? `${activeClass} text-white` : `bg-white border-gray-300 text-gray-700 ${disabled ? '' : hoverClass}`
      } ${disabled ? 'opacity-60 cursor-default' : ''}`}>
      {children}
    </button>
  );
}

export function BigCheck({ checked, onChange, disabled, children }) {
  return (
    <label className={`flex items-center gap-3 min-h-[48px] px-4 rounded-xl border-2 text-base cursor-pointer transition ${
      checked ? 'bg-teal-50 border-teal-400 text-teal-900' : 'bg-white border-gray-300 text-gray-700 hover:border-teal-300'
    } ${disabled ? 'opacity-60 cursor-default' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 rounded border-gray-300" />
      {children}
    </label>
  );
}

/**
 * @param {object} p
 * @param {object} p.initial  `{ formulaire, avis, duree_mois }` pré-remplis
 * @param {boolean} p.readOnly lecture seule (entretien clôturé, avis transmis)
 * @param {boolean} p.saving   transmission en cours
 * @param {(payload: {renouvellement_form, renouvellement_avis, renouvellement_duree_mois}) => void} p.onTransmit
 * @param {(message: string|null) => void} p.onErreurLocale  erreurs de saisie
 */
export default function FormulaireETI({ initial, readOnly = false, saving = false, onTransmit, onErreurLocale }) {
  const [form, setForm] = useState(VIDE);
  const [avis, setAvis] = useState(null);
  const [duree, setDuree] = useState(null);
  const [dureeAutre, setDureeAutre] = useState('');

  // Pré-remplissage : un formulaire déjà commencé se retrouve tel qu'il a été
  // laissé. Une durée hors des trois propositions bascule sur « Autre » plutôt
  // que d'être perdue — c'est une valeur que quelqu'un a saisie.
  useEffect(() => {
    const f = (initial && initial.formulaire && typeof initial.formulaire === 'object') ? initial.formulaire : {};
    setForm({
      assiduite: f.assiduite ?? null,
      motivation: f.motivation ?? null,
      autonomie: f.autonomie ?? null,
      participation_actions: Array.isArray(f.participation_actions) ? f.participation_actions : [],
      competences_acquises: f.competences_acquises || '',
      projet_professionnel: f.projet_professionnel || '',
      motifs: Array.isArray(f.motifs) ? f.motifs : [],
      commentaires: f.commentaires || '',
    });
    setAvis(initial?.avis ?? null);
    const d = initial?.duree_mois ?? null;
    if (d != null) {
      if ([2, 4, 6].includes(Number(d))) { setDuree(Number(d)); setDureeAutre(''); }
      else { setDuree('autre'); setDureeAutre(String(d)); }
    } else { setDuree(null); setDureeAutre(''); }
  }, [initial]);

  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const transmettre = () => {
    onErreurLocale?.(null);
    if (!avis) {
      onErreurLocale?.('Choisissez votre avis (favorable, avec réserves ou défavorable) avant de transmettre.');
      return;
    }
    const dureeMois = duree === 'autre' ? parseInt(dureeAutre, 10) : duree;
    // Un avis défavorable n'a pas de durée à proposer : l'exiger obligerait
    // l'encadrant à inventer un chiffre pour un renouvellement qu'il déconseille.
    if (avis !== 'defavorable' && (!dureeMois || dureeMois < 1)) {
      onErreurLocale?.('Indiquez la durée de renouvellement proposée (2, 4, 6 mois ou autre).');
      return;
    }
    onTransmit({
      renouvellement_form: {
        ...form,
        competences_acquises: form.competences_acquises.trim() || null,
        projet_professionnel: form.projet_professionnel.trim() || null,
        commentaires: form.commentaires.trim() || null,
        rempli_par: 'eti',
      },
      renouvellement_avis: avis,
      renouvellement_duree_mois: dureeMois || null,
    });
  };

  return (
    <>
      {/* 3 échelles : assiduité / motivation / autonomie */}
      {[
        ['assiduite', 'Assiduité et ponctualité', "La personne vient-elle au travail, à l'heure ?"],
        ['motivation', 'Motivation au travail', 'A-t-elle envie de bien faire, de s\'impliquer ?'],
        ['autonomie', 'Autonomie au poste', 'Sait-elle faire son travail sans aide permanente ?'],
      ].map(([key, titre, aide]) => (
        <section key={key} className="bg-white rounded-2xl border p-5 space-y-3">
          <div>
            <h2 className="text-lg font-bold text-gray-800">{titre}</h2>
            <p className="text-sm text-gray-500">{aide}</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            {NIVEAUX.map(([v, l]) => (
              <BigChoice key={v} selected={form[key] === v} disabled={readOnly}
                onClick={() => setForm({ ...form, [key]: form[key] === v ? null : v })}
                activeClass={v === 'insuffisante' ? 'bg-red-600 border-red-600' : v === 'moyenne' ? 'bg-amber-500 border-amber-500' : 'bg-green-600 border-green-600'}>
                {l}
              </BigChoice>
            ))}
          </div>
        </section>
      ))}

      <section className="bg-white rounded-2xl border p-5 space-y-3">
        <h2 className="text-lg font-bold text-gray-800">Participation à l'accompagnement</h2>
        <p className="text-sm text-gray-500">Cochez ce qui est vrai (plusieurs cases possibles).</p>
        <div className="grid grid-cols-1 gap-2">
          {PARTICIPATIONS.map(([v, l]) => (
            <BigCheck key={v} checked={form.participation_actions.includes(v)} disabled={readOnly}
              onChange={() => setForm({ ...form, participation_actions: toggleIn(form.participation_actions, v) })}>
              {l}
            </BigCheck>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Compétences acquises</h2>
          <p className="text-sm text-gray-500 mb-2">En quelques mots : ce que la personne sait faire maintenant.</p>
          <input value={form.competences_acquises} disabled={readOnly} maxLength={300}
            onChange={(e) => setForm({ ...form, competences_acquises: e.target.value })}
            placeholder="Ex. : tri qualité, conduite du transpalette, accueil…"
            className="input-modern w-full text-base py-3" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-800">Projet professionnel</h2>
          <p className="text-sm text-gray-500 mb-2">Ce que la personne veut faire ensuite (si vous le savez).</p>
          <textarea value={form.projet_professionnel} disabled={readOnly} rows={2}
            onChange={(e) => setForm({ ...form, projet_professionnel: e.target.value })}
            className="input-modern w-full text-base py-3" />
        </div>
      </section>

      <section className="bg-white rounded-2xl border p-5 space-y-3">
        <h2 className="text-lg font-bold text-gray-800">Pourquoi renouveler ?</h2>
        <div className="grid grid-cols-1 gap-2">
          {MOTIFS.map(([v, l]) => (
            <BigCheck key={v} checked={form.motifs.includes(v)} disabled={readOnly}
              onChange={() => setForm({ ...form, motifs: toggleIn(form.motifs, v) })}>
              {l}
            </BigCheck>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border-2 border-teal-200 p-5 space-y-3">
        <h2 className="text-lg font-bold text-gray-800">Votre avis sur le renouvellement</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {AVIS.map(([v, l, active, hover]) => (
            <BigChoice key={v} selected={avis === v} disabled={readOnly}
              onClick={() => setAvis(avis === v ? null : v)} activeClass={active} hoverClass={hover}>
              {l}
            </BigChoice>
          ))}
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-700 mt-2 mb-2">Pour quelle durée ?</h3>
          <div className="flex gap-3 flex-wrap items-center">
            {[2, 4, 6].map((m) => (
              <BigChoice key={m} selected={duree === m} disabled={readOnly}
                onClick={() => { setDuree(duree === m ? null : m); setDureeAutre(''); }}>
                {m} mois
              </BigChoice>
            ))}
            <BigChoice selected={duree === 'autre'} disabled={readOnly} onClick={() => setDuree(duree === 'autre' ? null : 'autre')}>
              Autre
            </BigChoice>
            {duree === 'autre' && (
              <input type="number" min="1" max="24" value={dureeAutre} disabled={readOnly}
                onChange={(e) => setDureeAutre(e.target.value)}
                placeholder="mois" className="input-modern w-24 text-base py-3" />
            )}
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-2">Commentaires (facultatif)</h2>
        <textarea value={form.commentaires} disabled={readOnly} rows={3}
          onChange={(e) => setForm({ ...form, commentaires: e.target.value })}
          placeholder="Tout ce qui peut aider la CIP…" className="input-modern w-full text-base py-3" />
      </section>

      {!readOnly && (
        <button type="button" onClick={transmettre} disabled={saving}
          className="w-full min-h-[56px] rounded-2xl bg-teal-600 text-white text-xl font-bold hover:bg-teal-700 disabled:opacity-50 shadow-lg">
          {saving ? 'Transmission…' : 'Transmettre à la CIP ✓'}
        </button>
      )}
    </>
  );
}
