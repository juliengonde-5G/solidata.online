import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MobileShell from '../components/MobileShell';
import OfflineActionBadge from '../components/OfflineActionBadge';
import { getAllItems, STORES } from '../services/db';
import { syncAll, syncEvents } from '../services/sync';

/**
 * Historique des actions de la tournée courante.
 *
 * Fusionne :
 *   - collectes connues du serveur  (GET /tours/:id/public, champ cavs[])
 *   - collectes locales encore en file (pendingCollects)
 *   - incidents locaux encore en file (pendingIncidents)
 *   - pesées locales encore en file (pendingWeights)
 *
 * Limites assumées :
 *   - le backend n'expose pas de GET public pour lister les incidents ni
 *     les pesées de la tournée, donc l'historique serveur pour ces types
 *     reste partiel. Cf. DOCUMENTATION_MOBILE.md (contrat backend
 *     recommandé) — endpoints /incidents-public et /weights-public.
 */
export default function TourHistory() {
  const [serverCavs, setServerCavs] = useState([]);
  const [pendingCollects, setPendingCollects] = useState([]);
  const [pendingIncidents, setPendingIncidents] = useState([]);
  const [pendingWeights, setPendingWeights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (tourId) {
        try {
          const res = await fetch(`/api/tours/${tourId}/public`);
          if (res.ok) {
            const data = await res.json();
            setServerCavs((data.cavs || []).map(c => ({ ...c, _tourId: tourId })));
          } else {
            setError('Historique serveur indisponible');
          }
        } catch {
          setError('Hors ligne — historique local uniquement');
        }
      }
      const [collects, incidents, weights] = await Promise.all([
        getAllItems(STORES.pendingCollects).catch(() => []),
        getAllItems(STORES.pendingIncidents).catch(() => []),
        getAllItems(STORES.pendingWeights).catch(() => []),
      ]);
      // Filtre par tournée courante pour ne pas polluer avec d'autres tournées.
      setPendingCollects(collects.filter(c => String(c.tourId) === String(tourId)));
      setPendingIncidents(incidents.filter(i => String(i.tourId) === String(tourId)));
      setPendingWeights(weights.filter(w => String(w.tourId) === String(tourId)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onPending = () => load();
    syncEvents.addEventListener('pending', onPending);
    return () => syncEvents.removeEventListener('pending', onPending);
  }, [tourId]);

  // Construit la liste ordonnée d'items à afficher.
  // Item: { key, kind, label, sub, when, status }
  const items = buildItems({ serverCavs, pendingCollects, pendingIncidents, pendingWeights });

  return (
    <MobileShell
      title="Historique de tournée"
      subtitle={`Tournée #${tourId || '—'}`}
      onBack={() => navigate(-1)}
    >
      <div className="space-y-3">
        {error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {items.length === 0
              ? 'Aucune action pour le moment.'
              : `${items.length} action${items.length > 1 ? 's' : ''}`}
          </p>
          <button
            type="button"
            onClick={() => syncAll()}
            className="text-xs font-semibold text-[var(--color-primary)] underline"
          >
            Synchroniser
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Chargement…</div>
        ) : (
          <ul className="space-y-2">
            {items.map(it => (
              <li
                key={it.key}
                className="flex items-start gap-3 bg-white"
                style={{
                  borderRadius: 20,
                  padding: 14,
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
                }}
              >
                <span
                  className="flex-shrink-0 flex items-center justify-center text-lg"
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: bgFor(it.kind),
                  }}
                >
                  {iconFor(it.kind)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-gray-900 truncate">{it.label}</p>
                    <OfflineActionBadge status={it.status} />
                  </div>
                  {it.sub && <p className="text-xs text-gray-500 truncate mt-0.5">{it.sub}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-gray-400 pt-4">
          L'historique serveur complet (incidents, pesées) nécessite des
          endpoints de lecture publics — cf. contrat backend recommandé.
        </p>
      </div>
    </MobileShell>
  );
}

function buildItems({ serverCavs, pendingCollects, pendingIncidents, pendingWeights }) {
  const items = [];

  // Collectes serveur. On affiche tous les CAV, mais on marque « collecté »
  // en vert seulement pour les points passés. Pending locaux au-dessus.
  for (const cav of serverCavs) {
    if (cav.status === 'collected') {
      items.push({
        key: `scav-${cav.cav_id || cav.id}`,
        kind: 'collect',
        label: cav.nom || cav.cav_name || `CAV ${cav.cav_id || cav.id}`,
        sub: [cav.commune, cav.fill_level != null ? `${cav.fill_level}/4` : null].filter(Boolean).join(' · '),
        when: cav.collected_at || cav.updated_at || null,
        status: 'sent',
      });
    }
  }

  for (const c of pendingCollects) {
    items.push({
      key: `pc-${c.id}`,
      kind: 'collect',
      label: `CAV ${c.cavId}`,
      sub: [
        c.fillLevel != null ? `${c.fillLevel}/4` : null,
        c.anomaly || null,
      ].filter(Boolean).join(' · '),
      when: c.createdAt,
      status: 'pending',
    });
  }

  for (const i of pendingIncidents) {
    items.push({
      key: `pi-${i.id}`,
      kind: 'incident',
      label: incidentLabel(i.type),
      sub: i.description || null,
      when: i.createdAt,
      status: 'pending',
    });
  }

  for (const w of pendingWeights) {
    items.push({
      key: `pw-${w.id}`,
      kind: 'weight',
      label: w.isIntermediate ? 'Pesée intermédiaire' : 'Pesée finale',
      sub: `${(w.weightKg || 0).toFixed(0)} kg`,
      when: w.createdAt,
      status: 'pending',
    });
  }

  // Tri chronologique décroissant (le plus récent en haut). Les items
  // sans `when` restent à leur position naturelle (envoyés serveur).
  items.sort((a, b) => {
    const ta = a.when ? new Date(a.when).getTime() : 0;
    const tb = b.when ? new Date(b.when).getTime() : 0;
    return tb - ta;
  });
  return items;
}

function iconFor(kind) {
  switch (kind) {
    case 'collect': return '📍';
    case 'incident': return '⚠️';
    case 'weight': return '⚖️';
    default: return '•';
  }
}

function incidentLabel(type) {
  switch (type) {
    case 'vehicle_breakdown': return 'Panne véhicule';
    case 'accident': return 'Accident';
    case 'cav_problem': return 'Conteneur / CAV';
    case 'environment': return 'Environnement';
    case 'other': return 'Autre';
    default: return type || 'Incident';
  }
}
