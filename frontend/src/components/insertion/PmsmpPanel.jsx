import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { frDate } from './freins';

/**
 * PMSMP du salarié (EXG-05, PR 2) — Périodes de Mise en Situation en Milieu
 * Professionnel. Contrat backend :
 *   GET  /insertion/pmsmp/:employeeId → { employee_id, total, cumul_12mois_jours,
 *        regles:{max_jours_convention, max_cumul_12mois}, pmsmp:[{…, jours}] }
 *   POST /insertion/pmsmp, PUT /insertion/pmsmp/:id (ADMIN/RH) → ligne + jours
 *        (+ rappel si saisie_outil_officiel = false) ;
 *        409 { error, code:'pmsmp_duree'|'pmsmp_cumul', detail, cumul } —
 *        seul le CUMUL est forçable (force + motif_depassement) ;
 *   DELETE /insertion/pmsmp/:id (ADMIN/RH).
 */

const OBJET_LABELS = {
  decouvrir_metier: 'Découvrir un métier',
  confirmer_projet: 'Confirmer un projet professionnel',
  initier_recrutement: 'Initier un recrutement',
};

const EMPTY_FORM = {
  entreprise: '', siret: '', objet: 'decouvrir_metier', date_debut: '', date_fin: '',
  tuteur: '', convention_ref: '', bilan: '', saisie_outil_officiel: false, autres_jours_connus: '',
};

function Jauge({ value, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-teal-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 rounded-full h-2.5">
        <div className={`h-2.5 rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600 whitespace-nowrap font-medium">{value}/{max} j (12 mois glissants)</span>
    </div>
  );
}

export default function PmsmpPanel({ employeeId, canEdit = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { form, id?, conflit? }
  const [rappel, setRappel] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api.get(`/insertion/pmsmp/${employeeId}`)
      .then((r) => { if (alive) { setData(r.data); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [employeeId]);

  useEffect(() => load(), [load]);

  const openCreate = () => setModal({ form: { ...EMPTY_FORM }, id: null, conflit: null });
  const openEdit = (p) => setModal({
    id: p.id,
    conflit: null,
    form: {
      entreprise: p.entreprise || '', siret: p.siret || '', objet: p.objet || 'decouvrir_metier',
      date_debut: p.date_debut ? String(p.date_debut).slice(0, 10) : '',
      date_fin: p.date_fin ? String(p.date_fin).slice(0, 10) : '',
      tuteur: p.tuteur || '', convention_ref: p.convention_ref || '', bilan: p.bilan || '',
      saisie_outil_officiel: p.saisie_outil_officiel === true, autres_jours_connus: '',
    },
  });

  const remove = async (p) => {
    if (!window.confirm(`Supprimer la PMSMP « ${p.entreprise} » (${frDate(p.date_debut)} → ${frDate(p.date_fin)}) ?`)) return;
    setError(null);
    try {
      await api.delete(`/insertion/pmsmp/${p.id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  if (loading) return <p className="text-sm text-gray-400">Chargement des PMSMP…</p>;
  if (error && !data) return <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">PMSMP indisponibles : {error}</div>;
  if (!data) return null;

  const regles = data.regles || { max_jours_convention: 31, max_cumul_12mois: 60 };
  const rows = data.pmsmp || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-gray-800">
          PMSMP — immersions professionnelles
          <span className="text-xs font-normal text-gray-400 ml-2">({data.total || 0})</span>
        </h3>
        {canEdit && (
          <button type="button" onClick={openCreate}
            className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-medium hover:bg-orange-700">
            + PMSMP
          </button>
        )}
      </div>

      <Jauge value={data.cumul_12mois_jours || 0} max={regles.max_cumul_12mois} />
      <p className="text-[11px] text-gray-400">
        Bornes réglementaires : {regles.max_jours_convention} jours max par convention · {regles.max_cumul_12mois} jours cumulés max sur 12 mois glissants.
        La saisie officielle se fait sur Immersion Facilitée — l'ERP assure le suivi interne.
      </p>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
      {rappel && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{rappel}</span>
          <button type="button" onClick={() => setRappel(null)} className="ml-auto text-amber-600" aria-label="Fermer">×</button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 border border-dashed rounded-lg p-3 text-center">
          Aucune PMSMP enregistrée pour ce salarié.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <div key={p.id} className="border rounded-lg p-2.5 flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800 text-sm">{p.entreprise}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">{OBJET_LABELS[p.objet] || p.objet}</span>
                  {p.saisie_outil_officiel === false && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                      title="La convention doit être saisie sur l'outil officiel Immersion Facilitée (la saisie ERP ne vaut pas convention)">
                      à saisir dans Immersion Facilitée
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {frDate(p.date_debut)} → {frDate(p.date_fin)}{p.jours != null ? ` · ${p.jours} jour${p.jours > 1 ? 's' : ''}` : ''}
                  {p.tuteur ? ` · tuteur : ${p.tuteur}` : ''}
                  {p.convention_ref ? ` · convention ${p.convention_ref}` : ''}
                </div>
                {p.bilan && <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{p.bilan}</p>}
              </div>
              {canEdit && (
                <div className="flex gap-1.5 flex-shrink-0">
                  <button type="button" onClick={() => openEdit(p)} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">Modifier</button>
                  <button type="button" onClick={() => remove(p)} className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50">Supprimer</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <PmsmpModal
          employeeId={employeeId}
          modal={modal}
          setModal={setModal}
          regles={regles}
          onSaved={(row) => {
            setModal(null);
            if (row?.rappel) setRappel(row.rappel);
            load();
          }}
        />
      )}
    </div>
  );
}

function PmsmpModal({ employeeId, modal, setModal, regles, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [force, setForce] = useState(false);
  const [motif, setMotif] = useState('');
  const f = modal.form;
  const setF = (patch) => setModal({ ...modal, form: { ...f, ...patch } });
  const conflit = modal.conflit;

  const submit = async () => {
    if (!f.entreprise.trim()) { setErr("L'entreprise d'accueil est obligatoire."); return; }
    if (!f.date_debut || !f.date_fin) { setErr('Les dates de début et de fin sont obligatoires.'); return; }
    if (force && !motif.trim()) { setErr('Le motif du dépassement est obligatoire pour forcer.'); return; }
    setSaving(true); setErr(null);
    const body = {
      entreprise: f.entreprise.trim(),
      siret: f.siret.trim() || null,
      objet: f.objet,
      date_debut: f.date_debut,
      date_fin: f.date_fin,
      tuteur: f.tuteur.trim() || null,
      convention_ref: f.convention_ref.trim() || null,
      bilan: f.bilan.trim() || null,
      saisie_outil_officiel: f.saisie_outil_officiel,
    };
    if (f.autres_jours_connus !== '' && f.autres_jours_connus != null) {
      body.autres_jours_connus = parseInt(f.autres_jours_connus, 10);
    }
    if (force) { body.force = true; body.motif_depassement = motif.trim(); }
    try {
      const res = modal.id
        ? await api.put(`/insertion/pmsmp/${modal.id}`, body)
        : await api.post('/insertion/pmsmp', { ...body, employee_id: employeeId });
      onSaved(res.data);
    } catch (e2) {
      const d = e2.response?.data;
      if (e2.response?.status === 409 && d?.code) {
        setModal({ ...modal, conflit: d });
        if (d.code !== 'pmsmp_cumul') setErr(null);
      } else {
        setErr((d?.error || e2.message) + (d?.detail ? ` — ${d.detail}` : ''));
      }
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4 overflow-y-auto py-6" onClick={() => setModal(null)}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-4 space-y-3 my-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-800">{modal.id ? 'Modifier la PMSMP' : 'Nouvelle PMSMP'}</h3>
        <p className="text-[11px] text-gray-400">
          Bornes : {regles.max_jours_convention} j max par convention · {regles.max_cumul_12mois} j cumulés sur 12 mois glissants (toutes entreprises + jours connus hors ERP).
        </p>

        {err && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{err}</div>}

        {conflit && (
          <div className={`text-xs rounded-lg p-2.5 border space-y-1.5 ${conflit.code === 'pmsmp_cumul' ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-red-50 border-red-300 text-red-700'}`}>
            <p className="font-semibold">{conflit.error}</p>
            {conflit.detail && <p>{conflit.detail}</p>}
            {conflit.cumul && (
              <p>
                Cumul contrôlé : {conflit.cumul.total} j (dont {conflit.cumul.jours_nouvelle} j pour cette période
                {conflit.cumul.autres_jours_connus ? ` + ${conflit.cumul.autres_jours_connus} j déclarés hors ERP` : ''}) — plafond {conflit.cumul.plafond} j.
              </p>
            )}
            {conflit.code === 'pmsmp_cumul' ? (
              <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-amber-200">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="rounded border-gray-300 mt-0.5" />
                <span>Assumer le dépassement (immersions chez des organismes différents, par exemple) — motif obligatoire, tracé dans le bilan.</span>
              </label>
            ) : (
              <p className="italic">La durée d'une convention ne peut pas dépasser {regles.max_jours_convention} jours — cette limite n'est pas forçable : découpez en plusieurs conventions.</p>
            )}
            {force && conflit.code === 'pmsmp_cumul' && (
              <textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={2}
                placeholder="Motif du dépassement (obligatoire)…" className="input-modern py-1 w-full text-xs" />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-0.5">Entreprise / organisme d'accueil <span className="text-red-500">*</span></label>
            <input value={f.entreprise} onChange={(e) => setF({ entreprise: e.target.value })} className="input-modern py-1.5 w-full" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">SIRET (optionnel)</label>
            <input value={f.siret} onChange={(e) => setF({ siret: e.target.value })} maxLength={14} placeholder="14 chiffres" className="input-modern py-1.5 w-full" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Objet de l'immersion</label>
            <select value={f.objet} onChange={(e) => setF({ objet: e.target.value })} className="input-modern py-1.5 w-full">
              {Object.entries(OBJET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Début <span className="text-red-500">*</span></label>
            <input type="date" value={f.date_debut} onChange={(e) => setF({ date_debut: e.target.value })} className="input-modern py-1.5 w-full" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Fin <span className="text-red-500">*</span></label>
            <input type="date" value={f.date_fin} onChange={(e) => setF({ date_fin: e.target.value })} className="input-modern py-1.5 w-full" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Tuteur dans l'entreprise</label>
            <input value={f.tuteur} onChange={(e) => setF({ tuteur: e.target.value })} className="input-modern py-1.5 w-full" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Référence de convention</label>
            <input value={f.convention_ref} onChange={(e) => setF({ convention_ref: e.target.value })} className="input-modern py-1.5 w-full" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-0.5">Jours PMSMP connus hors ERP (autres employeurs, avant l'embauche)</label>
            <input type="number" min="0" max="366" value={f.autres_jours_connus}
              onChange={(e) => setF({ autres_jours_connus: e.target.value })}
              placeholder="0" className="input-modern py-1.5 w-28" />
            <span className="text-[11px] text-gray-400 ml-2">Comptés dans le contrôle du cumul de {regles.max_cumul_12mois} j.</span>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-0.5">Bilan de l'immersion</label>
            <textarea value={f.bilan} onChange={(e) => setF({ bilan: e.target.value })} rows={2} className="input-modern py-1 w-full" />
          </div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={f.saisie_outil_officiel} onChange={(e) => setF({ saisie_outil_officiel: e.target.checked })} className="rounded border-gray-300" />
            Convention saisie sur Immersion Facilitée (outil officiel)
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
          <button type="button" onClick={submit} disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-50">
            {saving ? 'Enregistrement…' : (modal.id ? 'Enregistrer' : 'Ajouter')}
          </button>
        </div>
      </div>
    </div>
  );
}
