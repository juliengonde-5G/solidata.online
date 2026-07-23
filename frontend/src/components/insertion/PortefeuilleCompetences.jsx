/**
 * Portefeuille de compétences & co-construction (Lot 8 — EXG-28 / EXG-32).
 * Étape du DiagnosticForm : composant contrôlé par `draft` / `setField`.
 * Aucune donnée sensible (art. 9/10) — visible de l'encadrant technique.
 *
 * Contenu :
 *  - centres d'intérêt (cases) → `portefeuille_interets` (JSONB : tableau de clés) ;
 *  - compétences par domaine (cases) → `portefeuille_competences` (JSONB : { domaine: [clés] }) ;
 *  - savoir-faire / savoir-être (textes) → `savoir_faire` / `savoir_etre` ;
 *  - SWOT → `swot_atouts` / `swot_faiblesses` / `swot_opportunites` / `swot_menaces` ;
 *  - besoins exprimés → `besoins_exprimes` ; COA → `coa_texte`.
 */

// Centres d'intérêt (liste à cocher — vocabulaire simple).
const INTERETS = [
  ['manuel', 'Travail manuel'], ['exterieur', 'Travailler dehors'], ['contact', 'Contact avec le public'],
  ['equipe', 'Travailler en équipe'], ['seul', 'Travailler seul·e'], ['bricolage', 'Bricolage / réparation'],
  ['mecanique', 'Mécanique / machines'], ['conduite', 'Conduite / déplacements'], ['tri_rangement', 'Tri / rangement'],
  ['vente', 'Vente / commerce'], ['couture', 'Couture / textile'], ['informatique', 'Informatique'],
  ['nature', 'Nature / environnement'], ['cuisine', 'Cuisine'], ['soin', 'Aide / soin aux personnes'],
  ['creation', 'Création / artisanat'],
];

// Compétences par domaine (co-construction du portefeuille).
const COMPETENCE_DOMAINES = [
  { key: 'communication', label: 'Communication', items: [
    ['ecouter', 'Écouter'], ['expliquer', 'Expliquer clairement'], ['ecrit', 'S\'exprimer par écrit'], ['langues', 'Parler une autre langue'],
  ] },
  { key: 'interpersonnel', label: 'Relations (interpersonnel)', items: [
    ['equipe', 'Coopérer en équipe'], ['aider', 'Aider les autres'], ['conflit', 'Gérer les tensions'], ['accueil', 'Accueillir / renseigner'],
  ] },
  { key: 'leadership', label: 'Prise d\'initiative (leadership)', items: [
    ['decider', 'Prendre des décisions'], ['organiser', 'Organiser le travail'], ['entrainer', 'Entraîner un groupe'], ['proposer', 'Proposer des idées'],
  ] },
  { key: 'apprentissage', label: 'Apprentissage', items: [
    ['apprendre_vite', 'Apprendre vite'], ['former', 'Montrer à quelqu\'un'], ['sinformer', 'Chercher l\'information'], ['sadapter', 'S\'adapter au changement'],
  ] },
  { key: 'intrapersonnel', label: 'Autonomie (intrapersonnel)', items: [
    ['ponctualite', 'Ponctualité / assiduité'], ['autonomie', 'Travailler en autonomie'], ['perseverance', 'Persévérer'], ['gerer_stress', 'Gérer le stress'],
  ] },
  { key: 'reflexion', label: 'Réflexion', items: [
    ['analyser', 'Analyser une situation'], ['resoudre', 'Résoudre un problème'], ['rigueur', 'Être rigoureux·se'], ['anticiper', 'Anticiper'],
  ] },
];

function CheckList({ options, selected = [], onToggle }) {
  const arr = Array.isArray(selected) ? selected : [];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onToggle(v)}
          className={`px-3 py-1.5 rounded-lg border text-sm transition ${
            arr.includes(v) ? 'bg-teal-50 border-teal-400 text-teal-800' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'
          }`}>
          {arr.includes(v) ? '☑ ' : '☐ '}{l}
        </button>
      ))}
    </div>
  );
}

export default function PortefeuilleCompetences({ draft = {}, setField }) {
  const interets = Array.isArray(draft.portefeuille_interets) ? draft.portefeuille_interets : [];
  const comps = draft.portefeuille_competences && typeof draft.portefeuille_competences === 'object' && !Array.isArray(draft.portefeuille_competences)
    ? draft.portefeuille_competences : {};

  const toggleInteret = (v) => {
    const next = interets.includes(v) ? interets.filter((x) => x !== v) : [...interets, v];
    setField('portefeuille_interets', next);
  };
  const toggleComp = (domaine, v) => {
    const cur = Array.isArray(comps[domaine]) ? comps[domaine] : [];
    const nextArr = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    const next = { ...comps };
    if (nextArr.length === 0) delete next[domaine]; else next[domaine] = nextArr;
    setField('portefeuille_competences', next);
  };

  const textArea = (field, rows = 2) => (
    <textarea value={draft[field] || ''} onChange={(e) => setField(field, e.target.value)} rows={rows} className="input-modern py-1 w-full" />
  );

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-sky-700 bg-sky-50 border border-sky-200 rounded-lg p-2">
        À construire AVEC le salarié : ce qui l'intéresse, ce qu'il sait faire, ses forces. Ces éléments sont repris
        dans les bilans et par l'encadrant technique. Cochez ce qui correspond, complétez avec ses mots.
      </p>

      {/* Centres d'intérêt */}
      <section className="space-y-2">
        <h5 className="font-medium text-gray-700">Centres d'intérêt</h5>
        <CheckList options={INTERETS} selected={interets} onToggle={toggleInteret} />
      </section>

      {/* Compétences par domaine */}
      <section className="space-y-3">
        <h5 className="font-medium text-gray-700">Compétences par domaine</h5>
        {COMPETENCE_DOMAINES.map((d) => (
          <div key={d.key} className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-xs font-semibold text-gray-500 mb-1.5">{d.label}</p>
            <CheckList options={d.items} selected={comps[d.key]} onToggle={(v) => toggleComp(d.key, v)} />
          </div>
        ))}
      </section>

      {/* Savoir-faire / savoir-être */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Savoir-faire (ce qu'il sait faire)</label>
          {textArea('savoir_faire')}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Savoir-être (qualités, comportement)</label>
          {textArea('savoir_etre')}
        </div>
      </section>

      {/* SWOT */}
      <section className="space-y-2">
        <h5 className="font-medium text-gray-700">Analyse AFOM / SWOT</h5>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-green-700 mb-1">Atouts (forces internes)</label>
            {textArea('swot_atouts')}
          </div>
          <div>
            <label className="block text-xs font-medium text-red-700 mb-1">Faiblesses (à travailler)</label>
            {textArea('swot_faiblesses')}
          </div>
          <div>
            <label className="block text-xs font-medium text-blue-700 mb-1">Opportunités (extérieures)</label>
            {textArea('swot_opportunites')}
          </div>
          <div>
            <label className="block text-xs font-medium text-amber-700 mb-1">Menaces (extérieures)</label>
            {textArea('swot_menaces')}
          </div>
        </div>
      </section>

      {/* Besoins & COA */}
      <section className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Besoins exprimés</label>
          {textArea('besoins_exprimes')}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Choix d'orientation / d'action (COA)</label>
          {textArea('coa_texte', 3)}
          <p className="text-[11px] text-gray-400 mt-0.5">La ou les pistes retenues avec le salarié à l'issue de ce diagnostic.</p>
        </div>
      </section>
    </div>
  );
}
