import { useState, useEffect } from 'react';
import api from '../../services/api';
import Modal from '../Modal';
import { useToast } from '../Toast';

/**
 * Saisie de la sortie FSE+ SANS bilan, et relevé de situation à +6 mois.
 *
 * POURQUOI CET ÉCRAN EXISTE. La sortie ne vivait que dans le formulaire de
 * bilan de sortie : la personne qui part sans entretien — celle dont la
 * situation est justement la plus incertaine — n'avait aucun endroit où être
 * saisie, et le dossier FSE+ restait incomplet pour toujours. Ici, trois champs
 * et c'est enregistré (09 § 1.4 F7 : « la saisie possible sans bilan est le
 * point décisif »).
 *
 * Props : { employeeId, mode: 'sortie' | 'six_mois', onClose, onSaved, valeurs }
 */

const SITUATIONS = [
  ['emploi_durable', 'Emploi durable'],
  ['emploi_transition', 'Emploi de transition'],
  ['formation', 'Formation'],
  ['autre_sortie_positive', 'Autre sortie positive'],
  ['inactivite', 'Inactivité'],
  ['chomage', "Chômage (demandeur d'emploi)"],
  ['inconnue', 'Non renseignée'],
];

const TYPES_CONTRAT = [
  ['cdi', 'CDI'],
  ['cdd_6m_plus', 'CDD de 6 mois ou plus'],
  ['cdd_moins_6m', 'CDD de moins de 6 mois'],
  ['interim', 'Intérim'],
  ['creation', "Création d'activité"],
  ['formation_qualifiante', 'Formation qualifiante'],
  ['autre', 'Autre'],
  ['sans_objet', 'Sans objet (pas de contrat)'],
];

/** Rangée de boutons — le geste tient en un clic, jamais une liste déroulante. */
export function ChipsRow({ value, onChange, options, autoriserAnnulation = true }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} type="button"
          onClick={() => onChange(autoriserAnnulation && value === v ? null : v)}
          className={`px-3 py-1.5 rounded-lg border text-sm transition ${
            value === v
              ? 'bg-teal-600 border-teal-600 text-white'
              : 'bg-white border-slate-300 text-slate-600 hover:border-teal-400'
          }`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function FseSortieForm({ employeeId, mode = 'sortie', valeurs = null, onClose, onSaved }) {
  const toast = useToast();
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const [dateSortie, setDateSortie] = useState(valeurs?.date_sortie ? String(valeurs.date_sortie).slice(0, 10) : aujourdhui);
  const [situation, setSituation] = useState(valeurs?.situation_sortie || null);
  const [typeContrat, setTypeContrat] = useState(valeurs?.fse_sortie?.type_contrat || null);
  const [commentaire, setCommentaire] = useState(valeurs?.fse_sortie?.commentaire || '');
  const [situation6, setSituation6] = useState(valeurs?.situation_6mois || null);
  const [dateReleve, setDateReleve] = useState(valeurs?.date_releve_6mois ? String(valeurs.date_releve_6mois).slice(0, 10) : aujourdhui);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => { setErreur(null); }, [mode]);

  const enregistrer = async () => {
    setEnvoi(true); setErreur(null);
    try {
      if (mode === 'six_mois') {
        await api.post(`/insertion/fse/${employeeId}/six-mois`, {
          situation_6mois: situation6,
          date_releve_6mois: dateReleve,
        });
        toast.success('Situation à +6 mois enregistrée.');
      } else {
        await api.post(`/insertion/fse/${employeeId}/sortie`, {
          date_sortie: dateSortie,
          situation_sortie: situation,
          fse_sortie: {
            situation_sortie: situation,
            ...(typeContrat ? { type_contrat: typeContrat } : {}),
            ...(commentaire.trim() ? { commentaire: commentaire.trim() } : {}),
          },
        });
        toast.success('Sortie FSE+ enregistrée.');
      }
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      const d = err.response?.data;
      // Les erreurs de schéma reviennent item par item : on les affiche telles
      // quelles, la conseillère doit savoir QUELLE réponse est refusée.
      const details = Array.isArray(d?.erreurs) ? ' — ' + d.erreurs.map((e) => e.motif).join(' ') : '';
      setErreur((d?.error || err.message) + details);
    }
    setEnvoi(false);
  };

  const pretSortie = !!situation && !!dateSortie;
  const pret6 = !!situation6 && !!dateReleve;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={mode === 'six_mois' ? 'Situation à +6 mois' : 'Sortie FSE+ (sans bilan de sortie)'}
      size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
          <button type="button" onClick={enregistrer}
            disabled={envoi || (mode === 'six_mois' ? !pret6 : !pretSortie)}
            className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
            {envoi ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {erreur && (
          <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{erreur}</div>
        )}

        {mode === 'six_mois' ? (
          <>
            <p className="text-[12px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2">
              Relevé de la situation de la personne six mois après sa sortie — c'est l'indicateur de résultat
              du cofinancement. Si la personne est injoignable, choisissez « Non renseignée » : le relevé aura
              été fait, et c'est cela que le bilan mesure.
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Situation à +6 mois</label>
              <ChipsRow value={situation6} onChange={setSituation6} options={SITUATIONS} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1" htmlFor="fse-date-releve">Date du relevé</label>
              <input id="fse-date-releve" type="date" value={dateReleve} onChange={(e) => setDateReleve(e.target.value)}
                className="input-modern py-1" />
            </div>
          </>
        ) : (
          <>
            <p className="text-[12px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2">
              À utiliser quand la personne est partie sans entretien de sortie. Trois réponses suffisent :
              la sortie entre au dossier FSE+ tout de suite, et elle pourra être précisée plus tard.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1" htmlFor="fse-date-sortie">Date de sortie</label>
                <input id="fse-date-sortie" type="date" value={dateSortie} onChange={(e) => setDateSortie(e.target.value)}
                  className="input-modern py-1 w-full" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Situation à la sortie</label>
              <ChipsRow value={situation} onChange={setSituation} options={SITUATIONS} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Type de contrat</label>
              <ChipsRow value={typeContrat} onChange={setTypeContrat} options={TYPES_CONTRAT} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1" htmlFor="fse-commentaire">Commentaire (facultatif)</label>
              <textarea id="fse-commentaire" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} rows={2}
                className="input-modern py-1 w-full" placeholder="Précision utile au dossier FSE+…" />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export { SITUATIONS as FSE_SITUATIONS, TYPES_CONTRAT as FSE_TYPES_CONTRAT };
