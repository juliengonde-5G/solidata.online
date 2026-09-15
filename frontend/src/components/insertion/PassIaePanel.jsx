import { useState } from 'react';
import { Shield, Plus, FileText, Trash2 } from 'lucide-react';
import { Modal, ConfirmDialog, FormField, Section } from '../index';
import { frDate } from './freins';

/**
 * Pass IAE — numéro, dates, STATUT CALCULÉ et historique des événements.
 *
 * Le champ « Statut » est en LECTURE SEULE, et c'est le point de ce panneau :
 * le statut se déduit des dates et des événements (utils/pass-iae.js côté
 * serveur), il ne se saisit pas. Le laisser modifiable produirait des dossiers
 * où le statut affiché contredit les dates qui sont juste à côté — et c'est
 * précisément sur ce statut que reposent les alertes d'échéance.
 *
 * Sans numéro de Pass, aucune alerte ne peut être calculée : on le DIT sous le
 * formulaire plutôt que de laisser croire que le suivi tourne.
 */

export const PASS_STATUT_LABELS = {
  actif: 'Actif', suspendu: 'Suspendu', prolonge: 'Prolongé', expire: 'Expiré', inconnu: 'Inconnu',
};
export const PASS_STATUT_CLASSES = {
  actif: 'bg-teal-100 text-teal-800',
  prolonge: 'bg-teal-100 text-teal-800',
  suspendu: 'bg-amber-100 text-amber-800',
  expire: 'bg-red-100 text-red-700',
  inconnu: 'bg-slate-100 text-slate-600',
};

const EVENEMENT_LABELS = { suspension: 'Suspension', prolongation: 'Prolongation', autre: 'Autre' };

const vide = { type: 'prolongation', date_debut: '', date_fin: '', motif: '', reference_externe: '' };

export default function PassIaePanel({
  pass, canEdit, saving, onSave, onAddEvenement, onDeleteEvenement, onBilanPdf, bilanLoading,
}) {
  const [form, setForm] = useState({
    numero: pass?.numero || '',
    debut: (pass?.debut || '').slice(0, 10),
    fin: (pass?.fin || '').slice(0, 10),
  });
  const [evOpen, setEvOpen] = useState(false);
  const [ev, setEv] = useState(vide);
  const [evErreur, setEvErreur] = useState(null);
  const [aSupprimer, setASupprimer] = useState(null);

  const statut = pass?.statut || 'inconnu';
  const evenements = pass?.evenements || [];

  const enregistrer = () => onSave({
    numero: form.numero.trim() || null,
    debut: form.debut || null,
    fin: form.fin || null,
  });

  const ajouterEvenement = async () => {
    setEvErreur(null);
    if (!ev.date_debut) { setEvErreur('La date de début est obligatoire.'); return; }
    try {
      await onAddEvenement({
        type: ev.type,
        date_debut: ev.date_debut,
        date_fin: ev.date_fin || null,
        motif: ev.motif.trim() || null,
        reference_externe: ev.reference_externe.trim() || null,
      });
      setEvOpen(false);
      setEv(vide);
    } catch (err) {
      setEvErreur(err?.response?.data?.error || err?.message || 'Enregistrement impossible.');
    }
  };

  return (
    <Section title="Pass IAE" icon={Shield}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <FormField label="Numéro" name="pass_numero" value={form.numero} disabled={!canEdit}
          placeholder="ex. 2025-07-0918"
          onChange={(e) => setForm({ ...form, numero: e.target.value })} />
        <FormField label="Début" name="pass_debut" type="date" value={form.debut} disabled={!canEdit}
          onChange={(e) => setForm({ ...form, debut: e.target.value })} />
        <FormField label="Fin" name="pass_fin" type="date" value={form.fin} disabled={!canEdit}
          onChange={(e) => setForm({ ...form, fin: e.target.value })} />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Statut</span>
          <span className={`inline-flex items-center self-start px-2.5 py-1.5 rounded-[10px] text-sm font-medium ${PASS_STATUT_CLASSES[statut] || PASS_STATUT_CLASSES.inconnu}`}>
            {PASS_STATUT_LABELS[statut] || statut}
          </span>
          <p className="text-xs text-slate-500">Calculé d&apos;après les dates et les événements — non modifiable.</p>
        </div>
      </div>

      {!pass?.numero && (
        <p className="text-xs text-slate-500 mt-2">
          Sans numéro de Pass, aucune alerte d&apos;échéance ne peut être calculée.
        </p>
      )}

      {canEdit && (
        <div className="flex justify-end mt-3">
          <button type="button" onClick={enregistrer} disabled={saving}
            className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}

      {/* ── Historique des événements ── */}
      <div className="mt-5">
        {evenements.length === 0 ? (
          <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-[10px] p-3 text-center">
            Aucun événement enregistré (suspension, prolongation).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3">Événement</th>
                  <th className="py-2 pr-3">Du</th>
                  <th className="py-2 pr-3">Au</th>
                  <th className="py-2 pr-3">Motif</th>
                  <th className="py-2 pr-3">Réf. Emplois de l&apos;inclusion</th>
                  {canEdit && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {evenements.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3 font-medium text-slate-700">{EVENEMENT_LABELS[e.type] || e.type}</td>
                    <td className="py-2 pr-3 text-slate-600">{frDate(e.date_debut)}</td>
                    {/* Une fin absente n'est pas « — » par défaut : c'est
                        « en cours », information différente et utile. */}
                    <td className="py-2 pr-3 text-slate-600">{e.date_fin ? frDate(e.date_fin) : <span className="text-slate-400">en cours</span>}</td>
                    <td className="py-2 pr-3 text-slate-600">{e.motif || <span className="text-slate-300">—</span>}</td>
                    <td className="py-2 pr-3 text-slate-500">{e.reference_externe || <span className="text-slate-300">—</span>}</td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <button type="button" onClick={() => setASupprimer(e)}
                          className="text-slate-400 hover:text-red-600" aria-label="Supprimer cet événement">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {canEdit && (
          <button type="button" onClick={() => { setEv(vide); setEvErreur(null); setEvOpen(true); }}
            className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Événement
          </button>
        )}
        {onBilanPdf && (
          <button type="button" onClick={onBilanPdf} disabled={bilanLoading || !pass?.numero}
            title={pass?.numero
              ? 'Bilan du parcours en appui de la demande de prolongation (sans données de santé ni judiciaires)'
              : 'Renseignez le numéro de Pass pour éditer le bilan'}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <FileText className="w-4 h-4" /> {bilanLoading ? 'Génération…' : 'Bilan de prolongation (PDF)'}
          </button>
        )}
      </div>

      {/* ── Modale : nouvel événement ── */}
      <Modal isOpen={evOpen} onClose={() => setEvOpen(false)} title="Nouvel événement du Pass IAE" size="md"
        footer={(
          <>
            <button type="button" onClick={() => setEvOpen(false)} className="btn-ghost text-sm">Annuler</button>
            <button type="button" onClick={ajouterEvenement} className="btn-primary text-sm">Enregistrer</button>
          </>
        )}
      >
        {evErreur && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{evErreur}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Type" name="ev_type" type="select" value={ev.type}
            onChange={(e) => setEv({ ...ev, type: e.target.value })}
            options={[
              { value: 'prolongation', label: 'Prolongation' },
              { value: 'suspension', label: 'Suspension' },
              { value: 'autre', label: 'Autre' },
            ]} />
          <FormField label="Référence Emplois de l'inclusion" name="ev_ref" value={ev.reference_externe}
            placeholder="ex. PROL-2026-118"
            onChange={(e) => setEv({ ...ev, reference_externe: e.target.value })} />
          <FormField label="Du" name="ev_debut" type="date" required value={ev.date_debut}
            onChange={(e) => setEv({ ...ev, date_debut: e.target.value })} />
          <FormField label="Au" name="ev_fin" type="date" value={ev.date_fin}
            hint="Laisser vide si l'événement est toujours en cours."
            onChange={(e) => setEv({ ...ev, date_fin: e.target.value })} />
          <div className="sm:col-span-2">
            <FormField label="Motif" name="ev_motif" type="textarea" rows={2} value={ev.motif}
              placeholder="ex. Arrêt maladie > 15 j"
              onChange={(e) => setEv({ ...ev, motif: e.target.value })} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!aSupprimer}
        title="Supprimer cet événement ?"
        message={aSupprimer
          ? `« ${EVENEMENT_LABELS[aSupprimer.type] || aSupprimer.type} » du ${frDate(aSupprimer.date_debut)} — le statut du Pass sera recalculé.`
          : ''}
        confirmLabel="Supprimer"
        onCancel={() => setASupprimer(null)}
        onConfirm={async () => { const e = aSupprimer; setASupprimer(null); await onDeleteEvenement(e.id); }}
      />
    </Section>
  );
}
