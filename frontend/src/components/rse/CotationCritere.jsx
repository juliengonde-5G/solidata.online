import { useState } from 'react';
import { Modal } from '../../components';
import api from '../../services/api';
import { LevelPicker, UserSelect, NIVEAU_LABELS, CHAPITRE_LABELS, apiErr } from './rseShared';

/**
 * Modale de cotation d'un critère : niveau visé + niveau auto-évalué (via les
 * 4 gros boutons 1-4 Initial/Engagé/Confirmé/Exemplaire), pilote métier,
 * commentaire. PUT /rse/criteres/:code. Lecture seule si !canWrite.
 */
export default function CotationCritere({ critere, users, restricted, canWrite, onClose, onSaved }) {
  const [viseN, setViseN] = useState(critere.niveau_vise ?? null);
  const [autoN, setAutoN] = useState(critere.niveau_auto_evalue ?? null);
  const [pilote, setPilote] = useState(critere.pilote_user_id ?? null);
  const [commentaire, setCommentaire] = useState(critere.commentaire || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await api.put(`/rse/criteres/${critere.code}`, {
        niveau_vise: viseN,
        niveau_auto_evalue: autoN,
        pilote_user_id: pilote,
        commentaire: commentaire.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(apiErr(err, "Impossible d'enregistrer la cotation."));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Critère ${critere.code} — ${critere.intitule}`}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">
            {canWrite ? 'Annuler' : 'Fermer'}
          </button>
          {canWrite && (
            <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer la cotation'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          Chapitre {critere.chapitre} — {CHAPITRE_LABELS[critere.chapitre]}
        </p>

        {error && (
          <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Niveau visé</label>
          <LevelPicker value={viseN} onChange={setViseN} disabled={!canWrite} />
          <p className="text-[11px] text-slate-400 mt-1">Cible de maturité fixée pour ce critère (facultatif).</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Niveau auto-évalué</label>
          <LevelPicker value={autoN} onChange={setAutoN} disabled={!canWrite} />
          <p className="text-[11px] text-slate-400 mt-1">
            Ne coter que si l'attendu est <strong>démontrable par une preuve recevable</strong>. En cas de doute, coter bas ou laisser « non coté ».
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="cot-pilote">Pilote métier</label>
          <UserSelect id="cot-pilote" value={pilote} onChange={setPilote} users={users}
            currentName={critere.pilote_nom} disabled={!canWrite} placeholder="Non attribué" />
          {restricted && (
            <p className="text-[11px] text-amber-600 mt-1">
              Liste d'utilisateurs restreinte (le référencement complet des utilisateurs est réservé à l'administrateur).
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="cot-comment">Commentaire / justification</label>
          <textarea
            id="cot-comment"
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            disabled={!canWrite}
            rows={4}
            className="input-modern w-full text-sm"
            placeholder="Écart au niveau supérieur, preuves à l'appui, décisions… (repris dans le dossier AFNOR)"
          />
        </div>

        <div className="text-[11px] text-slate-400 bg-slate-50 border border-slate-100 rounded-lg p-2.5">
          Rappel des niveaux : <strong>1</strong> {NIVEAU_LABELS[1]} · <strong>2</strong> {NIVEAU_LABELS[2]} · <strong>3</strong> {NIVEAU_LABELS[3]} · <strong>4</strong> {NIVEAU_LABELS[4]}. La communication externe sur le label n'est autorisée qu'à partir du niveau 2.
        </div>
      </div>
    </Modal>
  );
}
