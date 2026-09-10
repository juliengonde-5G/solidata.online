import { useState } from 'react';
import { Copy, Check, MapPin } from 'lucide-react';
import { lienCarteGps } from '../utils/tours';

/**
 * LES COORDONNÉES DÉCIMALES, écrites en toutes lettres sous l'adresse.
 * ═══════════════════════════════════════════════════════════════════════════
 * Demande client du 10/09/2026 : « rajouter en indication sur chaque adresse
 * GPS les coordonnées décimales ». Une adresse postale suffit à un livreur ;
 * elle ne suffit pas pour un conteneur posé sur un parking sans numéro, pour
 * régler un GPS de camion, ni pour vérifier qu'un point n'a pas été géocodé
 * à côté. Le couple décimal, lui, est sans ambiguïté — et c'est le format
 * qu'attendent les outils de navigation.
 *
 * DEUX RÈGLES :
 *  1. Six décimales, toujours. C'est ~11 cm : la précision à laquelle un point
 *     de collecte se distingue de son voisin. Arrondir à 4 (~11 m) confondait
 *     deux bornes d'un même parking.
 *  2. Une absence est NOMMÉE, jamais remplacée. Pas de coordonnées → « non
 *     géocodé », et le cas 0,0 (le point nul, au large du golfe de Guinée) est
 *     traité comme une absence : c'est une valeur par défaut, pas une position.
 */

/** Formatage décimal, ou `null` si la valeur n'est pas une coordonnée. PURE. */
export function formaterCoordonnees(latitude, longitude, decimales = 6) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (latitude === null || latitude === undefined || latitude === '') return null;
  if (longitude === null || longitude === undefined || longitude === '') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // 0,0 est le point nul : aucune adresse française ne s'y trouve.
  if (lat === 0 && lng === 0) return null;
  return `${lat.toFixed(decimales)}, ${lng.toFixed(decimales)}`;
}

export default function CoordonneesGps({
  latitude, longitude,
  decimales = 6,
  libelle = 'GPS',
  absent = 'Non géocodé',
  carte = true,
  className = '',
}) {
  const [copie, setCopie] = useState(false);
  const texte = formaterCoordonnees(latitude, longitude, decimales);
  const lien = carte ? lienCarteGps(latitude, longitude) : null;

  if (!texte) {
    return <span className={`text-xs text-slate-400 ${className}`}>{absent}</span>;
  }

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      setTimeout(() => setCopie(false), 1600);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : le texte
      // reste sélectionnable à la main. On ne prétend pas avoir copié.
      setCopie(false);
    }
  };

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${className}`}>
      {libelle && <span className="text-slate-400">{libelle}</span>}
      <code className="font-mono text-slate-600 select-all">{texte}</code>
      <button
        type="button"
        onClick={copier}
        title="Copier les coordonnées décimales"
        aria-label="Copier les coordonnées décimales"
        className="text-slate-400 hover:text-teal-600 transition-colors"
      >
        {copie ? <Check className="w-3.5 h-3.5 text-teal-600" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      {lien && (
        <a
          href={lien}
          target="_blank"
          rel="noopener noreferrer"
          title="Ouvrir dans Google Maps"
          aria-label="Ouvrir dans Google Maps"
          className="text-slate-400 hover:text-teal-600 transition-colors"
        >
          <MapPin className="w-3.5 h-3.5" />
        </a>
      )}
    </span>
  );
}
