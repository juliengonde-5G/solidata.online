/**
 * Ce que le chauffeur doit savoir en arrivant chez une ASSOCIATION.
 *
 * Une borne de rue est en libre accès : son nom et son adresse suffisent. Une
 * association, non — c'est un local tenu par des personnes, avec un référent à
 * demander, parfois un portail, parfois une entrée à l'arrière. Le chauffeur
 * qui l'ignore attend devant une porte close, puis repart sans avoir collecté.
 *
 * DOCTRINE D'AFFICHAGE : rien n'est montré quand rien n'est renseigné. Un
 * encart vide, ou un « — », ferait croire à une information manquante alors
 * qu'elle n'existe simplement pas — et sur l'écran d'un chauffeur en tournée,
 * une fausse piste coûte plus cher qu'un silence.
 */

/** Numéro composable : les espaces de saisie cassent le lien `tel:`. */
const numeroComposable = (tel) => String(tel || '').replace(/[\s.]/g, '');

function Ligne({ icone, libelle, children }) {
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden="true" className="text-base leading-6 flex-shrink-0">{icone}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{libelle}</p>
        <div className="text-[15px] leading-snug text-gray-900 break-words">{children}</div>
      </div>
    </div>
  );
}

export default function InfosPointAssociation({ point, className = '' }) {
  if (!point) return null;

  const complement = String(point.complement_adresse || '').trim();
  const referent = String(point.contact_info || '').trim();
  const telephone = String(point.contact_phone || '').trim();
  const consignes = String(point.horaires_notes || '').trim();

  // Aucune des quatre informations : on ne rend RIEN, pas un cadre vide.
  if (!complement && !referent && !telephone && !consignes) return null;

  return (
    <section
      className={`rounded-xl border border-indigo-200 bg-indigo-50/60 px-3.5 py-3 space-y-2.5 ${className}`}
      aria-label="Informations sur le point de collecte"
    >
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700">
        Infos du point
      </p>

      {consignes && (
        // Les consignes d'accès viennent EN PREMIER : c'est l'information qui
        // fait la différence entre entrer et rester dehors.
        <Ligne icone="🔑" libelle="Pour entrer">{consignes}</Ligne>
      )}

      {complement && <Ligne icone="📍" libelle="Précision d'adresse">{complement}</Ligne>}

      {referent && <Ligne icone="👤" libelle="Demander">{referent}</Ligne>}

      {telephone && (
        <Ligne icone="📞" libelle="Téléphone">
          <a
            href={`tel:${numeroComposable(telephone)}`}
            className="font-bold text-blue-700 underline decoration-2 underline-offset-2"
          >
            {telephone}
          </a>
        </Ligne>
      )}
    </section>
  );
}
