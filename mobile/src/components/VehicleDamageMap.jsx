import { useMemo, useState } from 'react';
import { vibrateTap, vibrateSuccess } from '../services/haptic';
import {
  DAMAGE_VUES, DAMAGE_TYPES, vueLabel, typeLabel,
  addDamage, removeDamage, updateDamage, countByVue, clamp01,
} from '../services/vehicleDamage';

// Couleurs par type — reprises pour les marqueurs sur le schéma ET les
// boutons de choix, pour que le chauffeur relie visuellement les deux.
const TYPE_COLORS = {
  rayure: '#F59E0B',
  choc: '#EA580C',
  bris: '#DC2626',
  autre: '#64748B',
};

/**
 * VehicleDamageMap — schéma générique du véhicule (4 vues : avant, arrière,
 * côté gauche, côté droit) pour pointer les dégâts avant le départ, comme
 * sur un constat amiable. Un seul schéma pour tout le parc (arbitrage
 * retenu — pas de silhouette par modèle de véhicule).
 *
 * Contrôlé : `value` = tableau de dégâts (voir services/vehicleDamage.js),
 * `onChange(nextValue)` appelé à chaque ajout / modification / suppression.
 * Aucune logique métier ici — tout le calcul (clamp, normalisation, id) vit
 * dans services/vehicleDamage.js, testable sans DOM.
 *
 * Ergonomie FALC / gants :
 *  - gros onglets de vue et gros boutons de type (≥ 44 px) ;
 *  - poser un point = taper le schéma ; le retirer = taper le point OU,
 *    plus simple avec des gants, utiliser le bouton « Suppr. » de la liste
 *    récapitulative en dessous (aucune précision de visée requise) ;
 *  - aucune image, aucune dépendance : silhouettes en SVG inline.
 */
export default function VehicleDamageMap({ value, onChange }) {
  const damages = Array.isArray(value) ? value : [];
  const [activeVue, setActiveVue] = useState(DAMAGE_VUES[0]);
  // Brouillon en cours : soit un nouveau point (pas encore dans `damages`),
  // soit l'édition d'un point existant (`editingId` renseigné).
  const [draft, setDraft] = useState(null);

  const counts = useMemo(() => countByVue(damages), [damages]);
  const visibleDamages = damages.filter((d) => d.vue === activeVue);

  const emit = (next) => { if (typeof onChange === 'function') onChange(next); };

  const chooseVue = (v) => {
    vibrateTap();
    setActiveVue(v);
    setDraft(null); // change de vue = on annule une saisie en cours, sans la perdre côté liste
  };

  const openNewDraft = (e) => {
    if (draft) return; // un seul brouillon à la fois — évite les poses accidentelles
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    vibrateTap();
    setDraft({ vue: activeVue, x, y, type: 'rayure', commentaire: '' });
  };

  const openEditDraft = (d, e) => {
    e.stopPropagation();
    vibrateTap();
    setDraft({ editingId: d.id, vue: d.vue, x: d.x, y: d.y, type: d.type, commentaire: d.commentaire || '' });
  };

  const cancelDraft = () => setDraft(null);

  const confirmDraft = () => {
    if (!draft) return;
    if (draft.editingId) {
      emit(updateDamage(damages, draft.editingId, { type: draft.type, commentaire: draft.commentaire }));
    } else {
      emit(addDamage(damages, draft));
    }
    vibrateSuccess();
    setDraft(null);
  };

  const deleteDraft = () => {
    if (draft?.editingId) emit(removeDamage(damages, draft.editingId));
    setDraft(null);
  };

  const deleteFromList = (id) => {
    vibrateTap();
    if (draft?.editingId === id) setDraft(null);
    emit(removeDamage(damages, id));
  };

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500 font-bold mb-2">
        État du véhicule
      </p>
      <p className="text-xs text-gray-500 mb-3">
        Touche le schéma pour marquer un dégât (rayure, choc…). Facultatif.
      </p>

      {/* Onglets de vue */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {DAMAGE_VUES.map((v) => {
          const active = v === activeVue;
          const n = counts[v] || 0;
          return (
            <button
              key={v}
              type="button"
              onClick={() => chooseVue(v)}
              aria-pressed={active}
              className="relative flex items-center justify-center font-bold transition-all active:scale-[0.97]"
              style={{
                minHeight: 48,
                borderRadius: 12,
                border: active ? '2px solid var(--color-primary)' : '2px solid #E2E8F0',
                background: active ? 'var(--color-primary-surface, #F0FDFA)' : 'white',
                color: active ? 'var(--color-primary-dark)' : '#334155',
              }}
            >
              <span className="text-[12px] leading-tight px-0.5">{vueLabel(v)}</span>
              {n > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 -right-1.5 flex items-center justify-center text-[10px] font-extrabold text-white rounded-full"
                  style={{ width: 18, height: 18, background: '#DC2626' }}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Schéma tactile */}
      <div
        onClick={openNewDraft}
        aria-label={`Schéma ${vueLabel(activeVue)}. Touche pour marquer un dégât.`}
        className="relative w-full bg-white overflow-hidden"
        style={{ borderRadius: 14, border: '2px solid #E2E8F0', aspectRatio: '3 / 2', touchAction: 'manipulation' }}
      >
        <VehicleSilhouette vue={activeVue} />
        {visibleDamages.map((d, i) => (
          <button
            key={d.id}
            type="button"
            onClick={(e) => openEditDraft(d, e)}
            aria-label={`Dégât ${i + 1} : ${typeLabel(d.type)}${d.commentaire ? ', ' + d.commentaire : ''}. Toucher pour modifier.`}
            className="absolute flex items-center justify-center font-extrabold text-white active:scale-110 transition-transform"
            style={{
              left: `${d.x * 100}%`,
              top: `${d.y * 100}%`,
              width: 28,
              height: 28,
              marginLeft: -14,
              marginTop: -14,
              borderRadius: '50%',
              background: TYPE_COLORS[d.type] || TYPE_COLORS.autre,
              border: '2px solid white',
              boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            {i + 1}
          </button>
        ))}
        {/* Brouillon en cours (pas encore confirmé) */}
        {draft && !draft.editingId && draft.vue === activeVue && (
          <span
            aria-hidden="true"
            className="absolute rounded-full"
            style={{
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
              width: 30,
              height: 30,
              marginLeft: -15,
              marginTop: -15,
              border: '3px dashed #0D9488',
              background: 'rgba(13,148,136,0.15)',
            }}
          />
        )}
      </div>

      {/* Fiche de saisie / édition du dégât en cours */}
      {draft && (
        <div className="mt-3 card-mobile p-4 space-y-3" style={{ border: '2px solid var(--color-primary)' }}>
          <p className="font-bold text-sm text-gray-800">
            {draft.editingId ? `Modifier le dégât — ${vueLabel(draft.vue)}` : `Nouveau dégât — ${vueLabel(draft.vue)}`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DAMAGE_TYPES.map((t) => {
              const active = draft.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { vibrateTap(); setDraft((d) => ({ ...d, type: t })); }}
                  aria-pressed={active}
                  className="flex items-center gap-2 justify-center font-bold transition-all active:scale-[0.97]"
                  style={{
                    minHeight: 48,
                    borderRadius: 12,
                    border: active ? `2px solid ${TYPE_COLORS[t]}` : '2px solid #E2E8F0',
                    background: active ? `${TYPE_COLORS[t]}1A` : 'white',
                    color: active ? TYPE_COLORS[t] : '#334155',
                  }}
                >
                  <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: TYPE_COLORS[t], flexShrink: 0 }} />
                  {typeLabel(t)}
                </button>
              );
            })}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Précision (facultatif)</label>
            <input
              type="text"
              value={draft.commentaire}
              onChange={(e) => setDraft((d) => ({ ...d, commentaire: e.target.value }))}
              placeholder="Ex. portière arrière gauche"
              className="input-mobile"
              style={{ minHeight: 48 }}
            />
          </div>
          <div className="flex gap-2">
            {draft.editingId && (
              <button
                type="button"
                onClick={deleteDraft}
                className="flex-shrink-0 font-bold text-red-600 border-2 border-red-200 active:scale-[0.97] transition-all"
                style={{ minHeight: 48, borderRadius: 12, padding: '0 16px' }}
              >
                Supprimer
              </button>
            )}
            <button
              type="button"
              onClick={cancelDraft}
              className="flex-1 font-bold text-gray-600 border-2 border-gray-200 active:scale-[0.97] transition-all"
              style={{ minHeight: 48, borderRadius: 12 }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={confirmDraft}
              className="flex-1 font-bold text-white active:scale-[0.97] transition-all"
              style={{ minHeight: 48, borderRadius: 12, background: 'var(--color-primary)' }}
            >
              {draft.editingId ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      )}

      {/* Liste de secours — suppression facile, sans viser un petit point */}
      {damages.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500">
            {damages.length} dégât{damages.length > 1 ? 's' : ''} signalé{damages.length > 1 ? 's' : ''}
          </p>
          {damages.map((d, i) => (
            <div
              key={d.id}
              className="flex items-center gap-3 bg-white"
              style={{ minHeight: 56, padding: '10px 12px', borderRadius: 12, border: '1px solid #E2E8F0' }}
            >
              <span
                aria-hidden="true"
                className="flex-shrink-0 flex items-center justify-center font-extrabold text-white"
                style={{ width: 26, height: 26, borderRadius: '50%', background: TYPE_COLORS[d.type] || TYPE_COLORS.autre, fontSize: 11 }}
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800">{vueLabel(d.vue)} · {typeLabel(d.type)}</div>
                {d.commentaire && <div className="text-xs text-gray-500 truncate">{d.commentaire}</div>}
              </div>
              <button
                type="button"
                onClick={() => deleteFromList(d.id)}
                aria-label={`Supprimer le dégât ${i + 1}`}
                className="flex-shrink-0 font-bold text-red-600"
                style={{ minHeight: 44, minWidth: 44, borderRadius: 10 }}
              >
                Suppr.
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Silhouettes génériques (camion/fourgon utilitaire) — SVG inline, aucune
 * image, aucune dépendance. Une seule silhouette pour tout le parc.
 * viewBox 0 0 300 200 (ratio 3:2, identique au conteneur tactile) pour que
 * les coordonnées relatives des marqueurs correspondent exactement au dessin.
 */
function VehicleSilhouette({ vue }) {
  const stroke = '#475569';
  const body = '#F1F5F9';
  const glass = '#BFDBFE';
  const dark = '#334155';

  if (vue === 'avant' || vue === 'arriere') {
    const isFront = vue === 'avant';
    return (
      <svg viewBox="0 0 300 200" width="100%" height="100%" aria-hidden="true" style={{ display: 'block' }}>
        {/* Roues (aperçu bas de caisse) */}
        <rect x="60" y="168" width="26" height="16" rx="4" fill={dark} />
        <rect x="214" y="168" width="26" height="16" rx="4" fill={dark} />
        {/* Carrosserie */}
        <rect x="65" y="34" width="170" height="140" rx="16" fill={body} stroke={stroke} strokeWidth="3" />
        {/* Rétroviseurs */}
        <rect x="44" y="78" width="20" height="12" rx="4" fill={body} stroke={stroke} strokeWidth="2" />
        <rect x="236" y="78" width="20" height="12" rx="4" fill={body} stroke={stroke} strokeWidth="2" />
        {isFront ? (
          <>
            <rect x="92" y="46" width="116" height="34" rx="8" fill={glass} stroke={stroke} strokeWidth="2" />
            <rect x="118" y="108" width="64" height="22" rx="4" fill="#CBD5E1" stroke={stroke} strokeWidth="2" />
            <circle cx="96" cy="144" r="15" fill="#FDE68A" stroke={stroke} strokeWidth="2" />
            <circle cx="204" cy="144" r="15" fill="#FDE68A" stroke={stroke} strokeWidth="2" />
            <rect x="65" y="158" width="170" height="14" rx="6" fill="#E2E8F0" stroke={stroke} strokeWidth="2" />
          </>
        ) : (
          <>
            <rect x="92" y="46" width="116" height="98" rx="6" fill="#E2E8F0" stroke={stroke} strokeWidth="2" />
            <line x1="150" y1="46" x2="150" y2="144" stroke={stroke} strokeWidth="2" />
            <circle cx="140" cy="95" r="3" fill={stroke} />
            <circle cx="160" cy="95" r="3" fill={stroke} />
            <rect x="82" y="150" width="18" height="26" rx="5" fill="#FCA5A5" stroke={stroke} strokeWidth="2" />
            <rect x="200" y="150" width="18" height="26" rx="5" fill="#FCA5A5" stroke={stroke} strokeWidth="2" />
            <rect x="65" y="158" width="170" height="14" rx="6" fill="#E2E8F0" stroke={stroke} strokeWidth="2" />
          </>
        )}
      </svg>
    );
  }

  // Vues latérales (gauche / droit) — même silhouette, miroir horizontal.
  const flip = vue === 'droit';
  return (
    <svg viewBox="0 0 300 200" width="100%" height="100%" aria-hidden="true" style={{ display: 'block' }}>
      <g transform={flip ? 'translate(300,0) scale(-1,1)' : undefined}>
        {/* Caisse / benne */}
        <rect x="30" y="60" width="180" height="90" rx="10" fill={body} stroke={stroke} strokeWidth="3" />
        {/* Cabine */}
        <path
          d="M 210 150 L 210 90 Q 210 66 234 66 L 262 66 Q 276 66 280 84 L 284 108 L 284 150 Z"
          fill={body}
          stroke={stroke}
          strokeWidth="3"
        />
        {/* Vitre cabine */}
        <path d="M 238 76 L 260 76 Q 268 76 271 90 L 273 100 L 236 100 Z" fill={glass} stroke={stroke} strokeWidth="2" />
        {/* Lignes de caisse */}
        <line x1="70" y1="60" x2="70" y2="150" stroke={stroke} strokeWidth="2" opacity="0.5" />
        <line x1="140" y1="60" x2="140" y2="150" stroke={stroke} strokeWidth="2" opacity="0.5" />
        {/* Rétroviseur */}
        <rect x="288" y="92" width="10" height="18" rx="3" fill={body} stroke={stroke} strokeWidth="2" />
        {/* Roues */}
        <circle cx="80" cy="156" r="20" fill={dark} />
        <circle cx="80" cy="156" r="8" fill="#94A3B8" />
        <circle cx="250" cy="156" r="20" fill={dark} />
        <circle cx="250" cy="156" r="8" fill="#94A3B8" />
        {/* Bas de caisse */}
        <rect x="30" y="150" width="254" height="8" fill={stroke} opacity="0.3" />
      </g>
    </svg>
  );
}
