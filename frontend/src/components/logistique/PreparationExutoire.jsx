import { useEffect, useRef, useState } from 'react';
import { Truck, Pencil, Trash2, Users, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import { STATUTS_PREPARATION } from '../../utils/logistique-commandes';

/**
 * PRÉPARATION D'EXPÉDITION — intégrée à la fiche de la commande exutoire
 * (2.59.0 : la page « Préparation » est retirée, tout se gère ici).
 *
 * Sans préparation : formulaire de planification (transporteur, remorque, lieu,
 * équipe). La créer fait passer la commande « en préparation ».
 * Avec préparation : les étapes du chargement, une par une — remorque livrée,
 * début, fin (avec la pesée interne : la commande passe « chargée »), puis
 * l'expédition, SEUL geste qui sort la marchandise du stock.
 */

const LIEUX = {
  quai_chargement: 'Quai de chargement',
  garage_remorque: 'Garage remorque',
  cours: 'Cours',
};

const FORM_VIDE = {
  transporteur: '',
  date_livraison_remorque: '',
  date_expedition: '',
  lieu_chargement: 'quai_chargement',
  collaborateurs: [],
  notes_preparation: '',
};

const NIVEAU_STYLE = {
  conforme: 'bg-green-100 text-green-700',
  acceptable: 'bg-amber-100 text-amber-700',
  litige: 'bg-red-100 text-red-700',
};
const NIVEAU_LABEL = { conforme: 'Conforme', acceptable: 'Écart acceptable', litige: 'Litige' };

const dt = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
// Valeur d'un <input type="datetime-local"> en heure LOCALE (toISOString la
// décalerait en UTC et l'heure affichée ne serait plus celle saisie).
function versChampLocal(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}
const nomEmploye = (e) => [e.first_name ?? e.prenom, e.last_name ?? e.nom].filter(Boolean).join(' ') || `#${e.id}`;

export default function PreparationExutoire({ commande, onChange, message, confirm }) {
  const prep = commande.preparation;
  const ref = useRef(null);
  const [edition, setEdition] = useState(false);
  const [form, setForm] = useState(FORM_VIDE);
  const [employes, setEmployes] = useState(null);
  const [conflit, setConflit] = useState('');
  const [erreur, setErreur] = useState('');
  const [busy, setBusy] = useState(false);
  const [pesee, setPesee] = useState(null); // null | chaîne saisie
  const [controle, setControle] = useState(null);

  const annulee = commande.statut === 'annulee';
  const planifiable = !prep && ['en_attente', 'confirmee'].includes(commande.statut);

  useEffect(() => {
    if (message && ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [message]);

  // Réconciliation des pesées : seulement si un contrôle client existe.
  useEffect(() => {
    if (!commande.controle_pesee) { setControle(null); return; }
    api.get('/controles-pesee')
      .then(({ data }) => setControle((data || []).find((c) => c.commande_id === commande.id) || null))
      .catch(() => setControle(null));
  }, [commande.id, commande.controle_pesee]);

  const chargerEmployes = () => {
    if (employes) return;
    api.get('/employees')
      .then(({ data }) => setEmployes((data || []).filter((e) => e.is_active !== false)))
      .catch(() => setEmployes([]));
  };

  const ouvrirFormulaire = () => {
    setErreur('');
    setConflit('');
    setForm(prep ? {
      transporteur: prep.transporteur || '',
      date_livraison_remorque: versChampLocal(prep.date_livraison_remorque),
      date_expedition: versChampLocal(prep.date_expedition),
      lieu_chargement: prep.lieu_chargement || 'quai_chargement',
      collaborateurs: (prep.collaborateurs || []).map((c) => c.employee_id),
      notes_preparation: prep.notes_preparation || '',
    } : { ...FORM_VIDE });
    setEdition(true);
    chargerEmployes();
  };

  // Ouvre d'office le formulaire quand on arrive ici par un glisser-déposer.
  useEffect(() => {
    if (message && planifiable && !edition) ouvrirFormulaire();
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps

  const verifierConflit = async (f) => {
    if (!f.lieu_chargement || !f.date_livraison_remorque || !f.date_expedition) { setConflit(''); return; }
    try {
      const { data } = await api.get('/preparations/conflits', {
        params: {
          lieu_chargement: f.lieu_chargement,
          date_debut: f.date_livraison_remorque,
          date_fin: f.date_expedition,
          exclude_id: prep?.id,
        },
      });
      const n = data?.preparations_en_conflit?.length || 0;
      setConflit(data?.conflit
        ? `Ce lieu est déjà occupé sur ce créneau par ${n} autre(s) préparation(s)${n ? ` (${data.preparations_en_conflit.map((p) => p.reference).join(', ')})` : ''}.`
        : '');
    } catch { setConflit(''); }
  };

  const changer = (champ, valeur) => {
    const f = { ...form, [champ]: valeur };
    setForm(f);
    if (['lieu_chargement', 'date_livraison_remorque', 'date_expedition'].includes(champ)) verifierConflit(f);
  };

  const enregistrer = async (e) => {
    e.preventDefault();
    setErreur('');
    setBusy(true);
    try {
      if (prep) await api.put(`/preparations/${prep.id}`, form);
      else await api.post('/preparations', { ...form, commande_id: commande.id });
      setEdition(false);
      await onChange();
    } catch (err) {
      setErreur(err.response?.status === 409
        ? 'Le lieu de chargement est déjà occupé sur ce créneau : changez le lieu ou les horaires.'
        : (err.response?.data?.error || "La préparation n'a pas pu être enregistrée."));
    }
    setBusy(false);
  };

  const etape = async (statut, peseeInterne) => {
    setErreur('');
    setBusy(true);
    try {
      const body = { statut_preparation: statut };
      if (peseeInterne !== undefined) body.pesee_interne = peseeInterne;
      await api.patch(`/preparations/${prep.id}/statut`, body);
      setPesee(null);
      await onChange();
    } catch (err) {
      setErreur(err.response?.data?.error || "L'étape n'a pas pu être enregistrée.");
    }
    setBusy(false);
  };

  const expedier = async () => {
    const ok = confirm ? await confirm({
      title: 'Expédier la commande ?',
      message: `La marchandise (${prep.pesee_interne != null ? `${prep.pesee_interne} t` : 'pesée interne non saisie'}) sort du stock. Ce geste ne s'annule pas d'un clic.`,
      confirmLabel: 'Expédier',
    }) : true;
    if (ok) etape('expediee');
  };

  const supprimer = async () => {
    const ok = confirm ? await confirm({
      title: 'Supprimer la préparation ?',
      message: 'Le créneau de chargement est libéré et l\'équipe désaffectée.',
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',
    }) : true;
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/preparations/${prep.id}`);
      await onChange();
    } catch (err) {
      setErreur(err.response?.data?.error || 'Suppression impossible.');
    }
    setBusy(false);
  };

  const r = controle?.reconciliation;
  const t = (v) => (v == null ? '—' : `${Number(v).toFixed(3)} t`);

  return (
    <div ref={ref} className="mb-4 scroll-mt-4">
      <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
        <Truck className="w-4 h-4 text-amber-600" /> Préparation & chargement
      </h3>

      {message && (
        <div className="mb-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-800">{message}</div>
      )}
      {erreur && (
        <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{erreur}</div>
      )}

      {!prep && !edition && (
        <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600 flex flex-wrap items-center justify-between gap-2">
          <span>
            {annulee ? 'Commande annulée.'
              : planifiable ? 'Aucune préparation planifiée pour cette commande.'
                : 'Aucune préparation rattachée.'}
          </span>
          {planifiable && (
            <button type="button" onClick={ouvrirFormulaire} className="btn-primary text-xs">Planifier la préparation</button>
          )}
        </div>
      )}

      {edition && (
        <form onSubmit={enregistrer} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Transporteur *</label>
              <input className="input-modern" required value={form.transporteur} onChange={(e) => changer('transporteur', e.target.value)} placeholder="Nom du transporteur" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Livraison de la remorque *</label>
              <input type="datetime-local" className="input-modern" required value={form.date_livraison_remorque} onChange={(e) => changer('date_livraison_remorque', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Expédition *</label>
              <input type="datetime-local" className="input-modern" required value={form.date_expedition} onChange={(e) => changer('date_expedition', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Lieu de chargement *</label>
              <select className="select-modern" value={form.lieu_chargement} onChange={(e) => changer('lieu_chargement', e.target.value)}>
                {Object.entries(LIEUX).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          {conflit && (
            <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {conflit}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Équipe de chargement</label>
            <div className="border rounded-lg p-2 max-h-36 overflow-y-auto bg-white space-y-0.5">
              {employes === null && <p className="text-xs text-gray-400 px-2">Chargement…</p>}
              {employes && employes.length === 0 && <p className="text-xs text-gray-400 px-2">Aucun collaborateur disponible</p>}
              {(employes || []).map((emp) => (
                <label key={emp.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={form.collaborateurs.includes(emp.id)}
                    onChange={() => setForm((f) => ({
                      ...f,
                      collaborateurs: f.collaborateurs.includes(emp.id)
                        ? f.collaborateurs.filter((x) => x !== emp.id)
                        : [...f.collaborateurs, emp.id],
                    }))}
                  />
                  {nomEmploye(emp)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea className="textarea-modern" rows={2} value={form.notes_preparation} onChange={(e) => changer('notes_preparation', e.target.value)} />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost text-sm" onClick={() => setEdition(false)} disabled={busy}>Annuler</button>
            <button type="submit" className="btn-primary text-sm" disabled={busy}>
              {prep ? 'Enregistrer' : 'Planifier — la commande passe en préparation'}
            </button>
          </div>
        </form>
      )}

      {prep && !edition && (
        <div className="rounded-lg bg-yellow-50 p-3 text-sm space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-gray-500">Étape :</span> <span className="font-semibold">{STATUTS_PREPARATION[prep.statut_preparation] || prep.statut_preparation}</span></div>
            <div><span className="text-gray-500">Transporteur :</span> <span className="font-medium">{prep.transporteur || '—'}</span></div>
            <div><span className="text-gray-500">Remorque :</span> <span className="font-medium">{dt(prep.date_livraison_remorque)}</span></div>
            <div><span className="text-gray-500">Expédition :</span> <span className="font-medium">{dt(prep.date_expedition)}</span></div>
            <div><span className="text-gray-500">Lieu :</span> <span className="font-medium">{LIEUX[prep.lieu_chargement] || prep.lieu_chargement || '—'}</span></div>
            <div><span className="text-gray-500">Pesée interne :</span> <span className="font-medium">{prep.pesee_interne != null ? `${prep.pesee_interne} t` : '—'}</span></div>
            {(prep.collaborateurs || []).length > 0 && (
              <div className="col-span-2 flex items-center gap-1.5 flex-wrap">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                {prep.collaborateurs.map((c) => (
                  <span key={c.employee_id} className="text-xs bg-white border border-yellow-200 rounded-full px-2 py-0.5">{nomEmploye(c)}</span>
                ))}
              </div>
            )}
            {prep.notes_preparation && <div className="col-span-2"><span className="text-gray-500">Notes :</span> {prep.notes_preparation}</div>}
          </div>

          {/* Horodatages des étapes, dans l'ordre où elles se sont produites. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              ['Remorque reçue', prep.heure_reception_remorque],
              ['Début chargement', prep.heure_debut_chargement],
              ['Fin chargement', prep.heure_fin_chargement],
              ['Départ', prep.heure_depart],
            ].map(([l, v]) => (
              <div key={l} className={`rounded px-2 py-1 ${v ? 'bg-white' : 'bg-yellow-100/50 text-gray-400'}`}>
                <div className="text-[10px] uppercase text-gray-400">{l}</div>
                <div className="font-medium">{v ? dt(v) : '—'}</div>
              </div>
            ))}
          </div>

          {pesee !== null && (
            <div className="rounded-lg bg-white border border-green-200 p-3 space-y-2">
              <label className="block text-xs font-medium text-gray-600">Pesée interne (tonnes) — fin du chargement</label>
              <input
                type="number" step="0.001" min="0" autoFocus className="input-modern"
                placeholder="Ex. 24,500" value={pesee} onChange={(e) => setPesee(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn-ghost text-xs" onClick={() => setPesee(null)}>Annuler</button>
                <button type="button" className="btn-primary text-xs" disabled={!pesee || busy} onClick={() => etape('prete', parseFloat(pesee))}>
                  Valider — la commande passe « chargée »
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {prep.statut_preparation === 'planifiee' && (
              <button type="button" disabled={busy} onClick={() => etape('remorque_livree')} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200">Remorque livrée</button>
            )}
            {prep.statut_preparation === 'remorque_livree' && (
              <button type="button" disabled={busy} onClick={() => etape('en_chargement')} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-yellow-100 text-yellow-800 hover:bg-yellow-200">Début du chargement</button>
            )}
            {prep.statut_preparation === 'en_chargement' && pesee === null && (
              <button type="button" disabled={busy} onClick={() => setPesee('')} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200">Fin du chargement (pesée)</button>
            )}
            {prep.statut_preparation === 'prete' && (
              <button type="button" disabled={busy} onClick={expedier} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700">Expédier (sortie de stock)</button>
            )}
            {prep.statut_preparation !== 'expediee' && (
              <button type="button" disabled={busy} onClick={ouvrirFormulaire} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Modifier
              </button>
            )}
            {prep.statut_preparation === 'planifiee' && (
              <button type="button" disabled={busy} onClick={supprimer} className="text-xs px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Supprimer
              </button>
            )}
          </div>
        </div>
      )}

      {r && (
        <div className="mt-3 border rounded-lg p-3 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Réconciliation des pesées</span>
            {r.niveau_global && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${NIVEAU_STYLE[r.niveau_global] || 'bg-slate-100 text-slate-600'}`}>
                {NIVEAU_LABEL[r.niveau_global] || r.niveau_global}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="text-[10px] text-slate-400">Cartons</p><p className="text-sm font-bold">{t(r.pesee_cartons_t)}</p></div>
            <div><p className="text-[10px] text-slate-400">Interne</p><p className="text-sm font-bold">{t(r.pesee_interne_t)}</p></div>
            <div><p className="text-[10px] text-slate-400">Client</p><p className="text-sm font-bold">{t(r.pesee_client_t)}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
