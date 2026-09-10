import { useState, useEffect, useCallback, Fragment } from 'react';
import { IdCard, Plus, ChevronDown, AlertTriangle, Undo2, Ban, History, Cake } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, EmptyState, Modal, ConfirmDialog, useToast } from '../../components';
import { compareByName, formatEmployeeName } from '../../utils/names';
import {
  apiErr, fmtDateTimeParis, employeeName,
  STATUT_BADGE_LABELS, EVENEMENT_HISTORIQUE_LABELS, StatutBadgeChip,
} from './badgeuseShared';

// Affichage festif (ADR-0004 §4 + addendum du 10/09/2026) — champs confirmés
// côté GET /badgeuse/badges (routes/badgeuse.js) : `badgeuse_optin_festif` +
// `badgeuse_refus_festif` (et leurs dates), plus `festif_autorise` = l'état
// EFFECTIF calculé par la règle du poste.
//
// TROIS ÉTATS et non une case à cocher : depuis que l'affichage est le défaut,
// « n'a jamais été interrogé » et « a refusé » n'ont plus du tout le même
// effet, et les confondre reviendrait à afficher quelqu'un qui a dit non.
const etatFestif = (b) => {
  if (b?.badgeuse_refus_festif === true) return 'opposition';
  if (b?.badgeuse_optin_festif === true) return 'accord';
  return 'sans_reponse';
};

const DECISIONS_FESTIVES = [
  { value: 'sans_reponse', label: 'Sans réponse' },
  { value: 'accord', label: 'Accord explicite' },
  { value: 'opposition', label: 'Opposition' },
];

function OptinFestifBadge({ badge }) {
  const etat = etatFestif(badge);
  // `festif_autorise` vient du SERVEUR : l'écran de gestion ne recalcule pas la
  // règle, il l'affiche — sinon il finirait par promettre autre chose que ce
  // que la dalle de l'atelier montre réellement.
  const affiche = badge?.festif_autorise === true;
  const quand = etat === 'opposition' ? badge?.badgeuse_refus_festif_le : badge?.badgeuse_optin_festif_le;
  const titre = etat === 'opposition'
    ? `Opposition enregistrée${quand ? ` le ${fmtDateTimeParis(quand)}` : ''} — l'anniversaire n'est jamais affiché.`
    : etat === 'accord'
      ? `Accord recueilli${quand ? ` le ${fmtDateTimeParis(quand)}` : ''}.`
      : "Aucune réponse enregistrée — l'affichage suit le réglage général du poste.";
  return affiche ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-pink-100 text-pink-700" title={titre}>
      <Cake className="w-3.5 h-3.5" aria-hidden="true" /> Affiché
    </span>
  ) : (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${etat === 'opposition' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`} title={titre}>
      {etat === 'opposition' ? 'Opposition' : 'Non affiché'}
    </span>
  );
}

const uidTronque = (uid) => (uid ? `${String(uid).slice(0, 12)}…` : '—');

// ── Modale « + Attribuer un badge » ──────────────────────────────────────────
function AttribuerModal({ open, onClose, employees, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ employee_id: '', uid_hmac: '', commentaire: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setForm({ employee_id: '', uid_hmac: '', commentaire: '' }); setError(null); } }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.employee_id) { setError('Le salarié est requis.'); return; }
    if (!form.uid_hmac.trim()) { setError("L'empreinte du badge (uid_hmac) est requise."); return; }
    setSaving(true); setError(null);
    try {
      await api.post('/badgeuse/badges', { employee_id: parseInt(form.employee_id, 10), uid_hmac: form.uid_hmac.trim(), commentaire: form.commentaire.trim() || null });
      toast.success('Badge attribué.');
      onDone();
    } catch (err) { setError(apiErr(err, "Attribution du badge impossible.")); setSaving(false); }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Attribuer un badge" size="md"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Annuler</button>
        <button type="submit" form="attribuer-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Attribution…' : 'Attribuer'}</button>
      </>}>
      <form id="attribuer-form" onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Salarié</label>
          <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className="input-modern py-2 text-sm w-full" required>
            <option value="">— Choisir —</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{formatEmployeeName(emp.last_name, emp.first_name)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Empreinte du badge (uid_hmac)</label>
          <input value={form.uid_hmac} onChange={(e) => setForm({ ...form, uid_hmac: e.target.value })} className="input-modern py-2 text-sm w-full font-mono" placeholder="ex. 4f3a9c2b1e..." required />
          <p className="text-xs text-slate-400 mt-1">
            Enrôlement : présentez le badge NEUF sur un poste appairé — il apparaît en « pointage orphelin »
            dans l'onglet Journal, avec son empreinte et un bouton copier. Collez cette empreinte ici.
            Le pointage orphelin d'essai, lui, reste simplement non rattaché (aucune heure n'est comptée).
            L'identifiant du badge n'est jamais stocké en clair.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Commentaire</label>
          <input value={form.commentaire} onChange={(e) => setForm({ ...form, commentaire: e.target.value })} className="input-modern py-2 text-sm w-full" placeholder="optionnel" maxLength={300} />
        </div>
      </form>
    </Modal>
  );
}

function HistoriqueBadge({ badgeId }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/badgeuse/badges/${badgeId}/historique`)
      .then((r) => { if (alive) setItems(Array.isArray(r.data) ? r.data : (r.data.historique || r.data.items || [])); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [badgeId]);

  if (loading) return <LoadingSpinner size="sm" />;
  if (!items || items.length === 0) return <p className="text-xs text-slate-400 py-2">Aucun événement enregistré.</p>;
  return (
    <ul className="text-sm divide-y divide-slate-100">
      {items.map((ev, i) => (
        <li key={ev.id || i} className="py-1.5 flex items-center justify-between gap-3">
          <span className="text-slate-700">{EVENEMENT_HISTORIQUE_LABELS[ev.evenement] || ev.evenement}</span>
          <span className="text-slate-400 text-xs">{ev.auteur_nom || (ev.auteur_id != null ? `Utilisateur #${ev.auteur_id}` : '')}</span>
          <span className="text-slate-500 text-xs whitespace-nowrap">{fmtDateTimeParis(ev.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Onglet Badges (BO-01) ─────────────────────────────────────────────────────
export default function GestionBadges({ canWrite }) {
  const toast = useToast();
  const [badges, setBadges] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openHist, setOpenHist] = useState(null); // badge id
  const [attribuerOpen, setAttribuerOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // { badge, statut, label }
  const [acting, setActing] = useState(false);
  const [confirmOptin, setConfirmOptin] = useState(null); // { badge, decision }
  const [actingOptin, setActingOptin] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/badgeuse/badges')
      .then((r) => {
        const d = r.data;
        setBadges(Array.isArray(d) ? d : (d.badges || d.rows || d.items || []));
        setError(null);
      })
      .catch((err) => setError(apiErr(err, 'Chargement des badges impossible.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/employees?is_active=true')
      .then((r) => setEmployees((Array.isArray(r.data) ? r.data : []).sort(compareByName)))
      .catch(() => setEmployees([]));
  }, []);

  const doChangeStatut = async () => {
    if (!confirm) return;
    setActing(true);
    try {
      await api.patch(`/badgeuse/badges/${confirm.badge.id}`, { statut: confirm.statut });
      toast.success(`Badge ${STATUT_BADGE_LABELS[confirm.statut]?.toLowerCase() || 'mis à jour'}.`);
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(apiErr(err, 'Action impossible.'));
    } finally { setActing(false); }
  };

  // Affichage festif : accord, opposition ou sans réponse. Le choix est LIBRE
  // et révocable dans les deux sens, et chacun des trois est tracé au journal
  // RGPD côté serveur — une opposition qui ne se prouve pas ne vaut rien.
  const doToggleOptin = async () => {
    if (!confirmOptin) return;
    setActingOptin(true);
    try {
      await api.post(`/badgeuse/salaries/${confirmOptin.badge.employee_id}/optin-festif`,
        { decision: confirmOptin.decision });
      toast.success(confirmOptin.decision === 'opposition'
        ? "Opposition enregistrée — l'anniversaire ne sera plus affiché."
        : confirmOptin.decision === 'accord' ? 'Accord festif recueilli.' : 'Réponse effacée.');
      setConfirmOptin(null);
      load();
    } catch (err) {
      toast.error(apiErr(err, 'Action impossible.'));
    } finally { setActingOptin(false); }
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement des badges…" />;
  if (error) return <ErrorState variant="card" title="Badges indisponibles" message={error} onRetry={load} />;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><IdCard className="w-4 h-4 text-teal-600" /> Badges attribués</h3>
          {canWrite && (
            <button onClick={() => setAttribuerOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Attribuer un badge
            </button>
          )}
        </div>

        {badges.length === 0 ? (
          <EmptyState icon={IdCard} title="Aucun badge" description="Attribuez un premier badge à un salarié." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-2">Salarié</th>
                  <th className="text-left py-2 px-2">Empreinte (uid_hmac)</th>
                  <th className="text-center py-2 px-2">Statut</th>
                  <th className="text-left py-2 px-2">Attribué le</th>
                  <th className="text-center py-2 px-2">Anniversaires à l'écran</th>
                  {canWrite && <th className="text-right py-2 px-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {badges.map((b) => (
                  <Fragment key={b.id}>
                    <tr className="border-b border-slate-50">
                      <td className="py-2 px-2 font-medium text-slate-700">{employeeName(b)}</td>
                      <td className="py-2 px-2 font-mono text-xs text-slate-500" title={b.uid_hmac}>{uidTronque(b.uid_hmac)}</td>
                      <td className="py-2 px-2 text-center"><StatutBadgeChip statut={b.statut} /></td>
                      <td className="py-2 px-2 whitespace-nowrap text-slate-500">{fmtDateTimeParis(b.attribue_le)}</td>
                      <td className="py-2 px-2 text-center">
                        <div className="inline-flex items-center gap-2">
                          <OptinFestifBadge badge={b} />
                          {canWrite && (
                            <select
                              value={etatFestif(b)}
                              onChange={(e) => setConfirmOptin({ badge: b, decision: e.target.value })}
                              className="input-modern py-1 text-xs"
                              aria-label={`Affichage de l'anniversaire de ${employeeName(b)}`}
                            >
                              {DECISIONS_FESTIVES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                      {canWrite && (
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          {b.statut === 'actif' && (
                            <>
                              <button onClick={() => setConfirm({ badge: b, statut: 'perdu', message: `Déclarer le badge de ${employeeName(b)} perdu ? Il sera invalidé immédiatement.` })}
                                className="text-slate-400 hover:text-red-600 p-1" title="Déclarer perdu" aria-label="Déclarer perdu"><AlertTriangle className="w-4 h-4" /></button>
                              <button onClick={() => setConfirm({ badge: b, statut: 'vole', message: `Déclarer le badge de ${employeeName(b)} volé ? Il sera invalidé immédiatement.` })}
                                className="text-slate-400 hover:text-red-600 p-1" title="Déclarer volé" aria-label="Déclarer volé"><Ban className="w-4 h-4" /></button>
                              <button onClick={() => setConfirm({ badge: b, statut: 'restitue', message: `Enregistrer la restitution du badge de ${employeeName(b)} ?` })}
                                className="text-slate-400 hover:text-teal-700 p-1" title="Restituer" aria-label="Restituer"><Undo2 className="w-4 h-4" /></button>
                              <button onClick={() => setConfirm({ badge: b, statut: 'desactive', message: `Désactiver le badge de ${employeeName(b)} ?` })}
                                className="text-slate-400 hover:text-slate-700 p-1" title="Désactiver" aria-label="Désactiver"><Ban className="w-4 h-4" /></button>
                            </>
                          )}
                          <button onClick={() => setOpenHist(openHist === b.id ? null : b.id)}
                            className="text-slate-400 hover:text-teal-700 p-1" title="Historique" aria-label="Historique du badge">
                            {openHist === b.id ? <ChevronDown className="w-4 h-4" /> : <History className="w-4 h-4" />}
                          </button>
                        </td>
                      )}
                    </tr>
                    {openHist === b.id && (
                      <tr className="border-b border-slate-50 bg-slate-50/60">
                        <td colSpan={canWrite ? 6 : 5} className="px-4 py-2">
                          <HistoriqueBadge badgeId={b.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AttribuerModal open={attribuerOpen} employees={employees} onClose={() => setAttribuerOpen(false)}
        onDone={() => { setAttribuerOpen(false); load(); }} />

      <ConfirmDialog isOpen={!!confirm} onCancel={() => setConfirm(null)} onConfirm={doChangeStatut}
        title="Confirmer l'action" message={confirm?.message || ''} confirmLabel="Confirmer" confirmVariant="danger" loading={acting} />

      <ConfirmDialog isOpen={!!confirmOptin} onCancel={() => setConfirmOptin(null)} onConfirm={doToggleOptin}
        title={confirmOptin?.decision === 'opposition' ? "Enregistrer une opposition"
          : confirmOptin?.decision === 'accord' ? "Recueillir l'accord festif" : 'Effacer la réponse'}
        message={confirmOptin ? `${{
          opposition: `${employeeName(confirmOptin.badge)} demande à ce que son anniversaire ne soit PAS affiché sur l'écran du poste. L'opposition est définitive tant qu'elle n'est pas levée ici.`,
          accord: `${employeeName(confirmOptin.badge)} accepte l'affichage de son anniversaire (prénom + initiale) sur l'écran de badgeage.`,
          sans_reponse: `Effacer la réponse de ${employeeName(confirmOptin.badge)} : l'affichage suivra de nouveau le réglage général du poste.`,
        }[confirmOptin.decision]} Choix LIBRE du salarié — s'opposer n'a aucune conséquence ; tracé au journal RGPD.` : ''}
        confirmLabel="Enregistrer"
        confirmVariant={confirmOptin?.decision === 'opposition' ? 'danger' : 'primary'} loading={actingOptin} />
    </div>
  );
}
