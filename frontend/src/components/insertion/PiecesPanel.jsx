import { useState, useRef, useCallback } from 'react';
import { Paperclip, Upload, Trash2, Eye } from 'lucide-react';
import { Modal, ConfirmDialog, FormField, Section } from '../index';
import api from '../../services/api';
import { frDate } from './freins';

/**
 * Pièces dont la structure est SEULE dépositaire.
 *
 * ⚠ Ce panneau ne reçoit AUCUN justificatif d'éligibilité, et il le DIT : ces
 * pièces vivent sur « Les Emplois de l'inclusion » et l'outil n'en garde que la
 * référence (section Éligibilité). L'écrire à l'écran n'est pas décoratif —
 * c'est la seule chose qui empêche une CIP pressée de déposer ici une
 * notification de droits, qui porte le montant, la composition du foyer et
 * parfois la santé.
 *
 * Le document est servi AUTHENTIFIÉ : on le récupère en blob (le jeton ne
 * voyage jamais dans un `src=`), et l'URL objet est révoquée après ouverture.
 */

const TYPES = [
  { value: 'entretien_signe', label: 'Exemplaire signé d\'un entretien' },
  { value: 'convention_pmsmp', label: 'Convention PMSMP' },
  { value: 'accuse_remise', label: 'Accusé de remise de document' },
  { value: 'autre', label: 'Autre pièce' },
];
const TYPE_LABELS = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

const TAILLE_MAX = 5 * 1024 * 1024;
const poids = (o) => (o >= 1024 * 1024 ? `${(o / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

export default function PiecesPanel({ employeeId, pieces, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('entretien_signe');
  const [fichier, setFichier] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [aSupprimer, setASupprimer] = useState(null);
  const inputRef = useRef(null);
  const liste = Array.isArray(pieces) ? pieces : [];

  const deposer = async () => {
    setErreur(null);
    if (!fichier) { setErreur('Choisissez un fichier.'); return; }
    if (fichier.size > TAILLE_MAX) { setErreur('Fichier trop volumineux : 5 Mo maximum.'); return; }
    const fd = new FormData();
    fd.append('fichier', fichier);
    fd.append('type', type);
    setEnvoi(true);
    try {
      await api.post(`/insertion/pieces/${employeeId}`, fd);
      setOpen(false); setFichier(null); setType('entretien_signe');
      if (inputRef.current) inputRef.current.value = '';
      onChanged?.();
    } catch (err) {
      setErreur(err?.response?.data?.error || err?.message || 'Dépôt impossible.');
    }
    setEnvoi(false);
  };

  // Consultation : blob + URL objet éphémère. `revokeObjectURL` est DIFFÉRÉ —
  // révoquer immédiatement ferme l'onglet avant qu'il ait chargé (défaut déjà
  // rencontré sur l'aperçu des bordereaux, revue de sécurité 09/2026 C-10).
  const consulter = useCallback(async (p) => {
    try {
      const r = await api.get(`/insertion/pieces/fichier/${p.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: p.mime }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setErreur(err?.response?.data?.error || err?.message || 'Consultation impossible.');
    }
  }, []);

  const supprimer = async (p) => {
    setErreur(null);
    try {
      await api.delete(`/insertion/pieces/${p.id}`);
      onChanged?.();
    } catch (err) {
      setErreur(err?.response?.data?.error || err?.message || 'Suppression impossible.');
    }
  };

  return (
    <Section
      title="Pièces du dossier" icon={Paperclip}
      subtitle="Uniquement les pièces dont la structure est seule dépositaire"
      actions={canEdit ? (
        <button type="button" onClick={() => { setErreur(null); setOpen(true); }}
          className="btn-secondary text-sm inline-flex items-center gap-1.5">
          <Upload className="w-4 h-4" /> Déposer
        </button>
      ) : null}
    >
      {erreur && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{erreur}</div>}

      {liste.length === 0 ? (
        <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-[10px] p-3 text-center">
          Aucune pièce déposée.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {liste.map((p) => (
            <li key={p.id} className="py-2 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-700 truncate">{p.nom_fichier}</p>
                <p className="text-xs text-slate-500">
                  {TYPE_LABELS[p.type] || p.type} · {poids(p.taille)} · déposée le {frDate(p.created_at)}
                  {p.depose_par_nom ? ` par ${p.depose_par_nom}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => consulter(p)}
                className="btn-ghost text-sm inline-flex items-center gap-1.5">
                <Eye className="w-4 h-4" /> Ouvrir
              </button>
              {canEdit && (
                <button type="button" onClick={() => setASupprimer(p)}
                  className="text-slate-400 hover:text-red-600" aria-label={`Supprimer ${p.nom_fichier}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500 mt-3">
        Les justificatifs d&apos;éligibilité ne se déposent pas ici : ils restent sur les Emplois de
        l&apos;inclusion, dont l&apos;outil garde seulement la référence (section « Éligibilité IAE »).
        Chaque consultation d&apos;une pièce est inscrite au journal RGPD.
      </p>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Déposer une pièce" size="md"
        footer={(
          <>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost text-sm">Annuler</button>
            <button type="button" onClick={deposer} disabled={envoi} className="btn-primary text-sm disabled:opacity-50">
              {envoi ? 'Dépôt…' : 'Déposer'}
            </button>
          </>
        )}
      >
        {erreur && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{erreur}</div>}
        <FormField label="Type de pièce" name="piece_type" type="select" value={type}
          onChange={(e) => setType(e.target.value)} options={TYPES} />
        <div className="mt-3">
          <label htmlFor="piece-fichier" className="text-sm font-medium text-slate-700">Fichier</label>
          <input id="piece-fichier" ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setFichier(e.target.files?.[0] || null)}
            className="input-modern w-full mt-1" />
          <p className="text-xs text-slate-500 mt-1">
            PDF, JPEG ou PNG, 5 Mo maximum. Le contenu réel du fichier est vérifié : une extension
            qui ne correspond pas au format est refusée.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!aSupprimer}
        title="Supprimer cette pièce ?"
        message={aSupprimer ? `« ${aSupprimer.nom_fichier} » sera définitivement supprimée. La suppression est inscrite au journal RGPD.` : ''}
        confirmLabel="Supprimer"
        onCancel={() => setASupprimer(null)}
        onConfirm={async () => { const p = aSupprimer; setASupprimer(null); await supprimer(p); }}
      />
    </Section>
  );
}
