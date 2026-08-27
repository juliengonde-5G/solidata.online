import React from 'react';
import { REPONSES_RAPIDES } from '../../services/messagerie';

/**
 * Trois réponses rapides FIGÉES (contrat §4) — mode conduite FALC : cibles
 * ≥ 48 px (utilisables en gants), texte court, une seule ligne par bouton.
 * Chaque appui envoie IMMÉDIATEMENT le texte fixe via `onSelect` — aucune
 * confirmation intermédiaire, aucune saisie requise.
 *
 * `disabled` : conversation en lecture seule (ex. « SOLIDATA ») ou envoi en
 * cours — les boutons restent visibles mais inertes plutôt que de
 * disparaître (le chauffeur comprend pourquoi rien ne se passe).
 */
export default function ReponsesRapides({ onSelect, disabled = false }) {
  return (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-label="Réponses rapides"
    >
      {REPONSES_RAPIDES.map((texte) => (
        <button
          key={texte}
          type="button"
          onClick={() => onSelect && onSelect(texte)}
          disabled={disabled}
          className="touch-target w-full rounded-2xl border-2 border-[var(--color-primary)] bg-white text-[var(--color-primary-dark)] font-bold text-base px-4 active:scale-[0.98] active:bg-teal-50 transition-all disabled:opacity-40 disabled:active:scale-100"
          style={{ minHeight: 56 }}
        >
          {texte}
        </button>
      ))}
    </div>
  );
}
