import { useState, useEffect, useCallback } from 'react';
import { Check, X, AlertTriangle, Minus, ClipboardList, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import ErrorState from '../ErrorState';

/**
 * Dossier de conformité FSE+ — colonne des 9 pièces (maquette 4a/4b).
 * Source : GET /insertion/conformite/:employeeId (ADMIN/RH).
 *
 * CE QUE CET ENCART DIT, ET CE QU'IL NE FAIT PAS. Il liste ce qui manque, il
 * ne bloque RIEN : une CIP ne doit jamais être empêchée de travailler par un
 * champ administratif. D'où quatre états distincts — et surtout « sans objet »,
 * qui n'est pas « manquant » : une pièce de sortie n'est pas en retard pour
 * quelqu'un dont le parcours est en cours. Peindre ces lignes en rouge
 * noierait les vraies alertes dans du faux positif.
 *
 * Props :
 *  - employeeId  : salarié concerné
 *  - refreshKey  : change de valeur pour forcer un rechargement après une saisie
 *  - onNaviguer  : (lien) => void — « Compléter » ouvre le champ manquant
 *                  (conventions de `lien` : « dossier#ancre », « diagnostic#fse », « suivi »)
 *  - compact     : rend l'encart sans son propre cadre (intégration dans une carte)
 */

const ETATS = {
  complet: { libelle: 'complet', icone: Check, fond: 'bg-emerald-50', texte: 'text-emerald-800', puce: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-800' },
  partiel: { libelle: 'en cours', icone: AlertTriangle, fond: 'bg-amber-50', texte: 'text-amber-900', puce: 'text-amber-600', badge: 'bg-amber-100 text-amber-800' },
  a_faire: { libelle: 'à faire', icone: X, fond: 'bg-red-50', texte: 'text-red-800', puce: 'text-red-600', badge: 'bg-red-100 text-red-800' },
  sans_objet: { libelle: 'sans objet', icone: Minus, fond: 'bg-slate-50', texte: 'text-slate-500', puce: 'text-slate-400', badge: 'bg-slate-100 text-slate-500' },
};

export default function DossierConformite({ employeeId, refreshKey = 0, onNaviguer = null, compact = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(() => {
    let vivant = true;
    setChargement(true);
    api.get(`/insertion/conformite/${employeeId}`)
      .then((r) => { if (vivant) { setData(r.data); setError(null); } })
      // Un échec est AFFICHÉ : un dossier de conformité muet se lirait comme un
      // dossier complet, ce qui est exactement l'erreur à ne pas commettre ici.
      .catch((err) => { if (vivant) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [employeeId]);

  useEffect(() => charger(), [charger, refreshKey]);

  const corps = (() => {
    if (error) {
      return <ErrorState variant="card" title="Dossier de conformité indisponible" message={error} onRetry={charger} />;
    }
    if (chargement && !data) {
      return <p className="text-sm text-slate-400 px-1 py-2">Chargement du dossier…</p>;
    }
    if (!data) return null;
    return (
      <div className="flex flex-col gap-1.5">
        {data.pieces.map((p) => {
          const e = ETATS[p.etat] || ETATS.sans_objet;
          const Icone = e.icone;
          const cliquable = p.etat !== 'complet' && p.etat !== 'sans_objet' && p.lien && onNaviguer;
          return (
            <div key={p.cle} className={`flex items-start justify-between gap-2 rounded-lg px-2.5 py-2 ${e.fond}`}>
              <div className="flex items-start gap-2 min-w-0">
                <Icone className={`w-4 h-4 mt-0.5 flex-shrink-0 ${e.puce}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold leading-tight ${e.texte}`}>{p.libelle}</p>
                  <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{p.detail}</p>
                  {cliquable && (
                    <button type="button" onClick={() => onNaviguer(p.lien)}
                      className="text-[11px] text-teal-700 underline mt-0.5 hover:text-teal-900">
                      Compléter
                    </button>
                  )}
                </div>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${e.badge}`}>
                {e.libelle}
              </span>
            </div>
          );
        })}
      </div>
    );
  })();

  const sousTitre = data
    ? (data.nb_a_faire === 0
      ? `Dossier complet · ${data.pieces.filter((p) => p.etat === 'complet').length} pièce(s) sur ${data.pieces.length}`
      : `${data.nb_a_faire} pièce(s) à compléter · rien n'est bloquant`)
    : '';

  if (compact) return corps;

  return (
    <section className="bg-white rounded-xl border border-slate-200">
      <header className="flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-4 h-4 text-teal-600 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800 text-sm">Dossier de conformité</h3>
            {sousTitre && <p className="text-[11px] text-slate-500">{sousTitre}</p>}
          </div>
        </div>
        <button type="button" onClick={charger} title="Recharger le dossier"
          className="p-1 rounded-lg text-slate-400 hover:text-teal-700 hover:bg-slate-50">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </header>
      <div className="p-3">{corps}</div>
    </section>
  );
}
