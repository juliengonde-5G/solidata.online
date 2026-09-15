import { useState, useMemo } from 'react';
import { frDate } from './freins';
import { formatEmployeeName } from '../../utils/names';

/**
 * File active — colonne de gauche de l'espace CIP (PR C lot 5, contrat § 5.2).
 *
 * ═══ CE QU'ELLE CONTIENT, ET CE QU'ELLE NE CONTIENT PLUS ══════════════════
 * Plus les permanents (la comptable et les chauffeurs encombraient une liste
 * qui sert à suivre des parcours), et TOUJOURS les sortis récents : une
 * personne sortie est inactive, et c'est précisément à ce moment-là que la
 * sortie FSE+ et le relevé à +6 mois sont dus. La faire disparaître le jour où
 * le travail commence était la meilleure façon de ne jamais le faire.
 *
 * ═══ FILTRES ══════════════════════════════════════════════════════════════
 * Tous CÔTÉ CLIENT : la file tient en quelques dizaines de lignes, et un
 * filtre qui rappelle le serveur fait clignoter la liste sous le doigt. Le
 * filtre BRSA n'existe que pour ADMIN/RH — le serveur ne rend même pas la
 * colonne aux autres rôles, une case à cocher qui ne filtrerait rien serait un
 * mensonge d'écran.
 */

const RISQUE_PASTILLE = {
  rouge: { classe: 'bg-red-500', titre: 'Au moins une obligation en rouge' },
  orange: { classe: 'bg-amber-500', titre: 'Au moins une obligation en orange' },
};

const FILTRES = [
  ['en_parcours', 'En parcours'],
  ['termines', 'Terminés'],
  ['mine', 'Mes salariés'],
  ['asi', 'Projet ASI'],
  ['ocs', 'Projet OCS'],
  ['brsa', 'BRSA'],
  ['sans_diagnostic', 'Sans diagnostic'],
  ['sans_rdv', 'Sans RDV planifié'],
  ['fin_60j', 'Fin de contrat < 60 j'],
  ['risque', 'À risque'],
];

const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function FileActive({
  employees, selectedId, onSelect, adminRh, userId,
  enTete = null, chargement = false, erreur = null,
}) {
  const [recherche, setRecherche] = useState('');
  const [actifs, setActifs] = useState(() => new Set());
  const [replieMobile, setReplieMobile] = useState(true);

  const basculer = (cle) => setActifs((s) => {
    const n = new Set(s);
    if (n.has(cle)) n.delete(cle); else n.add(cle);
    // « En parcours » et « Terminés » s'excluent : les cocher tous les deux
    // reviendrait à ne rien filtrer, et l'écran dirait le contraire.
    if (cle === 'en_parcours') n.delete('termines');
    if (cle === 'termines') n.delete('en_parcours');
    return n;
  });

  const filtresVisibles = useMemo(
    () => FILTRES.filter(([cle]) => cle !== 'brsa' || adminRh),
    [adminRh]
  );

  const liste = useMemo(() => {
    const q = sansAccent(recherche).trim();
    const dans60j = (e) => {
      if (!e.contract_end_date) return false;
      const j = Math.round((new Date(e.contract_end_date) - Date.now()) / 86400000);
      return j <= 60;
    };
    return (employees || []).filter((e) => {
      if (q && !sansAccent(`${e.last_name} ${e.first_name}`).includes(q)) return false;
      if (actifs.has('en_parcours') && e.insertion_status !== 'en_parcours') return false;
      if (actifs.has('termines') && e.insertion_status !== 'termine') return false;
      if (actifs.has('mine') && e.cip_referent_user_id !== userId) return false;
      if (actifs.has('asi') && !(e.projets || []).includes('ASI')) return false;
      if (actifs.has('ocs') && !(e.projets || []).includes('OCS')) return false;
      if (actifs.has('brsa') && e.brsa !== true) return false;
      if (actifs.has('sans_diagnostic') && e.has_diagnostic) return false;
      if (actifs.has('sans_rdv') && e.prochain_rdv) return false;
      if (actifs.has('fin_60j') && !dans60j(e)) return false;
      if (actifs.has('risque') && !e.risque) return false;
      return true;
    });
  }, [employees, recherche, actifs, userId]);

  const Ligne = ({ e }) => {
    const pastille = RISQUE_PASTILLE[e.risque];
    return (
      <button onClick={() => onSelect(e)}
        className={`w-full text-left p-2 rounded mb-1 text-sm transition ${
          selectedId === e.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
        }`}>
        <div className="flex items-center gap-1.5">
          {pastille && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pastille.classe}`} title={pastille.titre} />}
          <span className="font-medium truncate">{formatEmployeeName(e.last_name, e.first_name)}</span>
          {e.insertion_status === 'termine' && (
            <span className="text-[10px] px-1 rounded bg-slate-200 text-slate-600 flex-shrink-0" title="Parcours terminé — la sortie FSE+ et le relevé à +6 mois peuvent encore être dus">sorti</span>
          )}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {e.prochain_rdv
            ? `RDV ${frDate(e.prochain_rdv.date)}${e.prochain_rdv.heure ? ` à ${e.prochain_rdv.heure}` : ''}`
            : e.dernier_entretien ? `dernier entretien ${frDate(e.dernier_entretien)}` : 'aucun rendez-vous planifié'}
        </div>
        <div className="flex gap-1 mt-1 flex-wrap">
          {e.brsa === true && <span className="text-[10px] px-1 rounded bg-indigo-100 text-indigo-700">BRSA</span>}
          {(e.projets || []).map((p) => (
            <span key={p} className="text-[10px] px-1 rounded bg-teal-100 text-teal-800">{p}</span>
          ))}
          {!e.has_diagnostic && <span className="text-[10px] px-1 rounded bg-amber-100 text-amber-800">sans diagnostic</span>}
          {e.has_diagnostic && !e.diagnostic_socle_complet && (
            <span className="text-[10px] px-1 rounded bg-amber-50 text-amber-700 border border-amber-200" title="Le socle du diagnostic n'est pas complet">socle partiel</span>
          )}
        </div>
      </button>
    );
  };

  const contenu = (
    <>
      <input value={recherche} onChange={(ev) => setRecherche(ev.target.value)}
        placeholder="Rechercher un nom…" aria-label="Rechercher un salarié"
        className="input-modern py-1.5 w-full text-sm mb-2" />

      <div className="flex flex-wrap gap-1 mb-2">
        {filtresVisibles.map(([cle, libelle]) => (
          <button key={cle} type="button" onClick={() => basculer(cle)}
            className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
              actifs.has(cle) ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'
            }`}>
            {libelle}
          </button>
        ))}
        {actifs.size > 0 && (
          <button type="button" onClick={() => setActifs(new Set())}
            className="text-[11px] px-2 py-0.5 text-gray-400 hover:text-gray-600 underline">effacer</button>
        )}
      </div>

      {erreur && <div className="text-red-600 text-xs mb-2 p-2 bg-red-50 rounded border border-red-200">{erreur}</div>}
      {chargement && <p className="text-xs text-gray-400 py-1">Chargement…</p>}
      {!chargement && !erreur && liste.length === 0 && (
        <p className="text-gray-400 text-sm p-2">
          {employees?.length ? 'Aucun salarié ne correspond à ces filtres.' : 'Aucun parcours d’insertion dans la file.'}
        </p>
      )}
      {liste.map((e) => <Ligne key={e.id} e={e} />)}
    </>
  );

  return (
    <div className="bg-white rounded-lg border p-3">
      {enTete}
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-semibold text-gray-700 text-sm">
          File active ({liste.length}{liste.length !== (employees || []).length ? ` / ${(employees || []).length}` : ''})
        </h2>
        {/* Sous `md` la liste devient un sélecteur repliable : sur un écran
            étroit, la fiche doit passer devant, pas derrière trente lignes. */}
        <button type="button" onClick={() => setReplieMobile((r) => !r)}
          className="md:hidden text-xs text-teal-700 underline">
          {replieMobile ? 'Ouvrir la liste' : 'Replier'}
        </button>
      </div>
      <div className={`${replieMobile ? 'hidden md:block' : 'block'} max-h-[70vh] overflow-y-auto`}>
        {contenu}
      </div>
    </div>
  );
}
