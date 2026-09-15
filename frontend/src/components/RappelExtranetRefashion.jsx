import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Check } from 'lucide-react';
import api from '../services/api';

/**
 * « CE QUE VOUS VENEZ D'ENREGISTRER N'EST PAS ENCORE CHEZ REFASHION. »
 * ═══════════════════════════════════════════════════════════════════════════
 * Demande client du 10/09/2026. Refashion n'expose aucune interface de
 * synchronisation : la déclaration reste manuelle, sur leur extranet. SOLIDATA
 * ne peut donc pas reporter la modification — il peut empêcher qu'on l'oublie.
 *
 * POURQUOI UN BANDEAU QUI RESTE, ET PAS UN MESSAGE QUI S'EFFACE : les
 * confirmations de cette application disparaissent au bout de quatre secondes.
 * C'est le bon comportement pour « enregistré », qui ne demande rien à
 * personne. Ici, il reste un GESTE À FAIRE, ailleurs, dans une autre
 * application : un message qui s'efface tout seul ne peut pas s'en assurer.
 * Le bandeau ne part donc que sur un clic — celui qui dit « c'est reporté ».
 *
 * Le clic n'est PAS une preuve : personne ne vérifie l'extranet à la place de
 * l'utilisateur, et l'écran ne prétend pas le contraire (« Je l'ai reporté »,
 * pas « Reporté ✓ »). La trace durable, elle, est déposée en messagerie par le
 * serveur, et elle, ne s'efface pas d'un clic.
 *
 * Le lien n'apparaît que si l'adresse de l'extranet a été PARAMÉTRÉE
 * (`refashion.extranet_url`) : une URL inventée mènerait à une page morte.
 */
export default function RappelExtranetRefashion({ objet, onAcquitter }) {
  // Le bandeau lit lui-même le réglage : ses deux appelants (DPAV,
  // associations) n'ont pas à connaître l'existence de cette clé, et un
  // troisième écran qui l'afficherait demain en hériterait sans rien câbler.
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let annule = false;
    api.get('/refashion/extranet-url')
      .then((r) => { if (!annule) setUrl(r.data?.url || null); })
      .catch(() => { /* pas de lien : le rappel vaut sans lui */ });
    return () => { annule = true; };
  }, []);

  return (
    <div
      role="status"
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900">
          À reporter sur l’extranet Refashion
        </p>
        <p className="text-sm text-amber-800 mt-0.5">
          {objet ? <><span className="font-medium">{objet}</span> vient d’être enregistré dans SOLIDATA. </> : null}
          Cette modification <strong>n’est pas remontée automatiquement</strong> à Refashion :
          tant qu’elle n’est pas saisie sur leur extranet, la déclaration et l’activité réelle divergent.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 underline"
            >
              Ouvrir l’extranet Refashion <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={onAcquitter}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 hover:text-amber-950"
          >
            <Check className="w-4 h-4" /> Je l’ai reporté
          </button>
        </div>
        <p className="text-[11px] text-amber-700 mt-2">
          Un rappel a également été déposé dans la messagerie des administrateurs.
        </p>
      </div>
    </div>
  );
}
