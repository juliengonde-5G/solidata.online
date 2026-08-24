import { useState, useRef, useCallback, useEffect } from 'react';
import { MapPin, Search, Crosshair, Loader2 } from 'lucide-react';
import api from '../services/api';

/**
 * Saisie d'un lieu : adresse ↔ coordonnées.
 *
 * Deux gestes, dans les deux sens :
 *   • taper une adresse → propositions cliquables qui remplissent les
 *     coordonnées (plus besoin d'aller chercher une latitude ailleurs) ;
 *   • saisir des coordonnées → retrouver l'adresse correspondante.
 *
 * DOCTRINE : rien n'est deviné. Si le service ne répond pas, le message le
 * dit et la saisie manuelle reste possible — les champs ne sont jamais
 * verrouillés par la recherche.
 *
 * @param {string} adresse
 * @param {number|string|null} latitude
 * @param {number|string|null} longitude
 * @param {(champs: {adresse?, latitude?, longitude?, code_postal?, commune?}) => void} onChange
 */
export default function AdresseGeocodee({
  adresse = '', latitude = '', longitude = '', onChange,
  labelAdresse = 'Adresse', requis = false,
}) {
  const [resultats, setResultats] = useState(null); // null = pas de recherche en cours
  const [message, setMessage] = useState(null);
  const [chargement, setChargement] = useState(false);
  const debounceRef = useRef(null);
  const dernierRef = useRef('');

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const chercher = useCallback(async (q) => {
    if (!q || q.trim().length < 3) { setResultats(null); setMessage(null); return; }
    setChargement(true);
    try {
      const res = await api.get('/geocodage/adresse', { params: { q } });
      const d = res.data || {};
      setResultats(d.disponible ? (d.resultats || []) : null);
      setMessage(d.disponible
        ? (d.resultats?.length ? null : 'Aucune adresse trouvée.')
        : (d.message || "Recherche d'adresse indisponible."));
    } catch (_) {
      setResultats(null);
      setMessage("Recherche d'adresse indisponible — saisie manuelle possible.");
    }
    setChargement(false);
  }, []);

  const surSaisieAdresse = (valeur) => {
    onChange({ adresse: valeur });
    dernierRef.current = valeur;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // 500 ms : on ne lance pas une requête à chaque frappe.
    debounceRef.current = setTimeout(() => {
      if (dernierRef.current === valeur) chercher(valeur);
    }, 500);
  };

  const choisir = (r) => {
    onChange({
      adresse: r.libelle || r.adresse || '',
      latitude: r.latitude,
      longitude: r.longitude,
      code_postal: r.code_postal || undefined,
      commune: r.commune || undefined,
      code_insee: r.code_insee || undefined,
    });
    setResultats(null);
    setMessage(null);
  };

  const retrouverAdresse = async () => {
    if (!latitude || !longitude) return;
    setChargement(true);
    setMessage(null);
    try {
      const res = await api.get('/geocodage/inverse', { params: { lat: latitude, lng: longitude } });
      const d = res.data || {};
      if (d.disponible && d.resultat) {
        onChange({
          adresse: d.resultat.libelle || '',
          code_postal: d.resultat.code_postal || undefined,
          commune: d.resultat.commune || undefined,
          code_insee: d.resultat.code_insee || undefined,
        });
      } else {
        setMessage(d.message || 'Aucune adresse à cet endroit.');
      }
    } catch (_) {
      setMessage("Service d'adresse indisponible.");
    }
    setChargement(false);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="block text-xs text-slate-500 mb-1">
          {labelAdresse}{requis && ' *'}
          <span className="text-slate-400 font-normal"> — tapez, puis choisissez une proposition</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={adresse || ''}
            onChange={(e) => surSaisieAdresse(e.target.value)}
            placeholder="Ex. 12 rue de la République, Rouen"
            className="input-modern pr-9"
            autoComplete="off"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            {chargement ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </span>
        </div>

        {resultats && resultats.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {resultats.map((r, i) => (
              <li key={`${r.latitude}-${r.longitude}-${i}`}>
                <button
                  type="button"
                  onClick={() => choisir(r)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-start gap-2"
                >
                  <MapPin className="w-3.5 h-3.5 text-teal-600 mt-0.5 flex-shrink-0" />
                  <span>
                    <span className="text-slate-700">{r.libelle}</span>
                    <span className="block text-[10px] text-slate-400">
                      {r.latitude}, {r.longitude}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {message && <p className="text-[11px] text-amber-700 mt-1">{message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Latitude</label>
          <input
            type="number" step="any" value={latitude ?? ''}
            onChange={(e) => onChange({ latitude: e.target.value })}
            className="input-modern"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Longitude</label>
          <input
            type="number" step="any" value={longitude ?? ''}
            onChange={(e) => onChange({ longitude: e.target.value })}
            className="input-modern"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={retrouverAdresse}
        disabled={!latitude || !longitude || chargement}
        className="text-xs text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Crosshair className="w-3.5 h-3.5" />
        Retrouver l'adresse depuis ces coordonnées
      </button>
    </div>
  );
}
