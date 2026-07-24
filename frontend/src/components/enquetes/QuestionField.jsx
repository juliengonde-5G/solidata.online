import {
  normalizeOptions, ECHELLE_MIN, ECHELLE_MAX, NOTE_MIN, NOTE_MAX,
} from './enquetesShared';

/**
 * Rendu d'UNE question selon son type — réutilisé côté réponse publique (kiosque
 * FALC) ET en aperçu dans le constructeur de questionnaire.
 *
 * Contrôles volontairement gros et lisibles (FALC) : cibles tactiles ≥ 56 px,
 * texte large, fort contraste. La valeur portée dépend du type :
 *   echelle       → nombre 1..5
 *   note_10       → nombre 0..10
 *   choix_unique  → string (valeur de l'option)
 *   choix_multiple→ string[] (valeurs cochées)
 *   oui_non       → 'oui' | 'non'
 *   texte         → string
 *
 * Props : { question, value, onChange, disabled, invalid, idPrefix }
 */
export default function QuestionField({ question, value, onChange, disabled = false, invalid = false, idPrefix = 'q' }) {
  const type = question.type;
  const opts = normalizeOptions(question.options);
  const baseId = `${idPrefix}-${question.id ?? question.ordre ?? 'q'}`;

  // Échelles numériques (gros boutons chiffrés).
  if (type === 'echelle' || type === 'note_10') {
    const from = type === 'echelle' ? ECHELLE_MIN : NOTE_MIN;
    const to = type === 'echelle' ? ECHELLE_MAX : NOTE_MAX;
    const minLabel = opts[0]?.label;
    const maxLabel = opts.length >= 2 ? opts[opts.length - 1]?.label : undefined;
    return (
      <ScaleButtons
        from={from} to={to} value={value} onChange={onChange}
        disabled={disabled} invalid={invalid} minLabel={minLabel} maxLabel={maxLabel}
      />
    );
  }

  // Oui / Non (deux gros boutons).
  if (type === 'oui_non') {
    return (
      <div className={`flex flex-wrap gap-3 ${invalid ? 'rounded-xl ring-2 ring-red-300 p-1' : ''}`} role="group" aria-label={question.libelle}>
        {[{ v: 'oui', l: 'Oui' }, { v: 'non', l: 'Non' }].map((o) => {
          const active = value === o.v;
          return (
            <button
              key={o.v} type="button" disabled={disabled} aria-pressed={active}
              onClick={() => onChange(active ? '' : o.v)}
              className={choiceClasses(active, disabled) + ' min-w-[7rem] justify-center'}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    );
  }

  // Choix unique (boutons de type radio).
  if (type === 'choix_unique') {
    if (opts.length === 0) return <NoOptions />;
    return (
      <div className={`space-y-2.5 ${invalid ? 'rounded-xl ring-2 ring-red-300 p-1.5' : ''}`} role="radiogroup" aria-label={question.libelle}>
        {opts.map((o, i) => {
          const active = String(value) === o.value;
          return (
            <button
              key={`${baseId}-${i}`} type="button" role="radio" aria-checked={active} disabled={disabled}
              onClick={() => onChange(active ? '' : o.value)}
              className={choiceClasses(active, disabled) + ' w-full text-left'}
            >
              <Marker active={active} round />
              <span className="flex-1">{o.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // Choix multiple (boutons de type case à cocher).
  if (type === 'choix_multiple') {
    if (opts.length === 0) return <NoOptions />;
    const arr = Array.isArray(value) ? value.map(String) : [];
    const toggle = (v) => onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    return (
      <div className={`space-y-2.5 ${invalid ? 'rounded-xl ring-2 ring-red-300 p-1.5' : ''}`} role="group" aria-label={question.libelle}>
        {opts.map((o, i) => {
          const active = arr.includes(o.value);
          return (
            <button
              key={`${baseId}-${i}`} type="button" aria-pressed={active} disabled={disabled}
              onClick={() => toggle(o.value)}
              className={choiceClasses(active, disabled) + ' w-full text-left'}
            >
              <Marker active={active} />
              <span className="flex-1">{o.label}</span>
            </button>
          );
        })}
        <p className="text-sm text-slate-400">Plusieurs réponses possibles.</p>
      </div>
    );
  }

  // Texte libre (grande zone de saisie).
  return (
    <textarea
      id={baseId}
      value={value || ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      className={`w-full rounded-xl border-2 px-4 py-3 text-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50 ${invalid ? 'border-red-300' : 'border-slate-200'}`}
      placeholder="Votre réponse…"
    />
  );
}

// ── Sous-composants ──────────────────────────────────────────────────────────
function ScaleButtons({ from, to, value, onChange, disabled, invalid, minLabel, maxLabel }) {
  const nums = [];
  for (let i = from; i <= to; i++) nums.push(i);
  return (
    <div className={invalid ? 'rounded-xl ring-2 ring-red-300 p-1.5' : ''}>
      <div className="flex flex-wrap gap-2">
        {nums.map((n) => {
          const active = value != null && value !== '' && Number(value) === n;
          return (
            <button
              key={n} type="button" disabled={disabled} aria-pressed={active} aria-label={`Note ${n}`}
              onClick={() => onChange(active ? '' : n)}
              className={`w-14 h-14 rounded-2xl border-2 text-xl font-bold transition active:scale-95 ${
                active ? 'border-teal-600 bg-teal-600 text-white shadow' : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between text-sm text-slate-500 mt-1.5 max-w-md">
          <span>{minLabel || ''}</span>
          <span>{maxLabel || ''}</span>
        </div>
      )}
    </div>
  );
}

function choiceClasses(active, disabled) {
  return `inline-flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-lg font-medium transition active:scale-[0.99] ${
    active ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50/40'
  } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;
}

function Marker({ active, round }) {
  return (
    <span
      className={`w-7 h-7 flex-shrink-0 border-2 flex items-center justify-center ${round ? 'rounded-full' : 'rounded-md'} ${
        active ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300'
      }`}
      aria-hidden="true"
    >
      {active && (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  );
}

function NoOptions() {
  return <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">Aucune option définie pour cette question.</p>;
}
