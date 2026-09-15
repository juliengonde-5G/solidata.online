import { useState } from 'react';
import EntretienForm from './EntretienForm';
import ObjectifsPanel from './ObjectifsPanel';
import ActionsPanel from './ActionsPanel';
import NotesSuiviPanel from './NotesSuiviPanel';
import CompetencesETI from './CompetencesETI';
import { ENTRETIEN_STATUS_LABELS, ENTRETIEN_STATUS_COLORS, entretienLabel, frDate } from './freins';
import { formatEmployeeName } from '../../utils/names';

/**
 * Onglet « Suivi » de la fiche (PR C lot 5, contrat § 5.4).
 *
 * Réunit ce qui se faisait dans TROIS onglets (Entretiens & bilans, Objectifs
 * & actions, Compétences) : ce sont trois vues du même geste — accompagner
 * quelqu'un entre deux rendez-vous. Les séparer obligeait à sortir de
 * l'entretien pour poser l'action qu'il venait de décider.
 *
 * Les compétences restent un ENCART REPLIABLE : elles se saisissent par
 * l'encadrant technique, pas à chaque bilan de la CIP.
 */

export default function OngletSuivi({
  employeeId, employee, milestones, activeEntretien, adminRh, baseRole,
  onOuvrirEntretien, onNouvelEntretien, onDirtyChange, onSaved, onClosed, onDemarrerParcours,
}) {
  const [competencesOuvertes, setCompetencesOuvertes] = useState(false);

  const tries = [...(milestones || [])].sort(
    (a, b) => new Date(b.due_date || 0) - new Date(a.due_date || 0)
  );

  if (activeEntretien) {
    return (
      <EntretienForm
        milestone={activeEntretien}
        employeeId={employeeId}
        employee={employee}
        allMilestones={milestones}
        onDirtyChange={onDirtyChange}
        onSaved={onSaved}
        onClosed={onClosed}
        onCloseForm={onClosed}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h3 className="font-semibold text-gray-800">Entretiens & bilans du parcours</h3>
          <button onClick={onNouvelEntretien}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">
            + Entretien / bilan
          </button>
        </div>
        {tries.length === 0 ? (
          <div className="text-center text-gray-400 py-6">
            <p>Aucun entretien pour l'instant.</p>
            <p className="text-xs mt-1">« Démarrer le parcours » crée les échéances (diagnostic, bilans, sortie).</p>
            <button onClick={onDemarrerParcours}
              className="mt-3 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700">
              Démarrer le parcours
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {tries.map((ms) => (
              <button key={ms.id} onClick={() => onOuvrirEntretien(ms)}
                className="w-full text-left p-3 rounded border hover:bg-gray-50 transition flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <span className="font-medium text-gray-800">{entretienLabel(ms)}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    Échéance : {frDate(ms.due_date)}
                    {ms.completed_date ? ` · réalisé le ${frDate(ms.completed_date)}` : ''}
                    {ms.duree_minutes ? ` · ${ms.duree_minutes} min` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {ms.ia_preparation && ms.status !== 'realise' && (
                    <span className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700" title="Une préparation IA est disponible">préparation prête ✨</span>
                  )}
                  {ms.avis_global && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      ms.avis_global === 'tres_positif' || ms.avis_global === 'positif' ? 'bg-green-100 text-green-700'
                        : ms.avis_global === 'mitige' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                    }`}>{ms.avis_global.replace('_', ' ')}</span>
                  )}
                  {ms.locked_at && <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-white" title="Clôturé et verrouillé">🔒</span>}
                  <span className={`text-xs px-2 py-0.5 rounded ${ENTRETIEN_STATUS_COLORS[ms.status]}`}>
                    {ENTRETIEN_STATUS_LABELS[ms.status]}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3">
          La préparation d'un entretien par l'IA se lance depuis l'entretien lui-même, une fois ouvert.
        </p>
      </section>

      <div className="bg-white rounded-lg border p-4">
        <ObjectifsPanel employeeId={employeeId} canEdit={adminRh} />
      </div>

      <div className="bg-white rounded-lg border p-4">
        <ActionsPanel employeeId={employeeId}
          employeeName={formatEmployeeName(employee?.last_name, employee?.first_name)} />
      </div>

      {/* Journal d'accompagnement : ce qui se passe ENTRE les entretiens.
          ADMIN/RH strict — le masquage par champ ne peut rien contre du texte
          libre, la seule protection honnête est de ne pas ouvrir la surface. */}
      {adminRh && (
        <div className="bg-white rounded-lg border p-4">
          <NotesSuiviPanel employeeId={employeeId} />
        </div>
      )}

      <section className="bg-white rounded-lg border p-4">
        <button type="button" onClick={() => setCompetencesOuvertes((o) => !o)}
          className="flex items-center justify-between w-full text-left">
          <h3 className="font-semibold text-gray-800">Compétences métier (encadrant technique)</h3>
          <span className="text-xs text-teal-700 underline">{competencesOuvertes ? 'Masquer' : 'Ouvrir'}</span>
        </button>
        {competencesOuvertes && (
          <div className="mt-3">
            <CompetencesETI employeeId={employeeId} employee={employee}
              canEdit={['ADMIN', 'RH', 'MANAGER'].includes(baseRole)} />
          </div>
        )}
      </section>
    </div>
  );
}
