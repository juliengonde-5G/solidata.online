import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Copy, Check, ExternalLink, Play, Square, Users } from 'lucide-react';
import { Modal, LoadingSpinner, ConfirmDialog } from '../../components';
import api from '../../services/api';
import {
  STATUT_LABELS, STATUT_STYLES, nextStatut, STATUT_ACTION_LABELS,
  CATEGORIE_LABELS, apiErr, frDate,
} from './enquetesShared';

/**
 * Liste des campagnes : création depuis un modèle, ouverture/clôture (forward-
 * only), lien public de réponse copiable (pas de librairie QR — lien seul),
 * compteur de réponses, suppression.
 */
export default function CampagnesList({ canWrite }) {
  const [campagnes, setCampagnes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api.get('/enquetes/campagnes')
      .then((r) => { if (alive) { setCampagnes(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  const changeStatut = async (c, statut) => {
    setBusyId(c.id); setError(null);
    try {
      await api.put(`/enquetes/campagnes/${c.id}`, { statut });
      load();
    } catch (err) { setError(apiErr(err, 'Changement de statut impossible.')); }
    setBusyId(null);
  };

  const remove = async (c) => {
    try {
      await api.delete(`/enquetes/campagnes/${c.id}`);
      setConfirmDel(null);
      load();
    } catch (err) { setError(apiErr(err)); setConfirmDel(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Campagnes d'enquête</h2>
        {canWrite && (
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouvelle campagne
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement des campagnes…" />
      ) : campagnes.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
          <p className="text-sm">Aucune campagne pour le moment.</p>
          {canWrite && <p className="text-xs mt-1">Créez une campagne à partir d'un modèle de questionnaire pour la diffuser.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {campagnes.map((c) => (
            <CampagneCard
              key={c.id}
              campagne={c}
              canWrite={canWrite}
              busy={busyId === c.id}
              onChangeStatut={changeStatut}
              onDelete={() => setConfirmDel(c)}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateCampagne
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); load(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmDel}
        title="Supprimer la campagne ?"
        message={confirmDel ? `« ${confirmDel.titre} » et ses réponses seront définitivement supprimées.` : ''}
        confirmLabel="Supprimer"
        confirmVariant="danger"
        onConfirm={() => remove(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

// ── Carte d'une campagne ─────────────────────────────────────────────────────
function CampagneCard({ campagne: c, canWrite, busy, onChangeStatut, onDelete }) {
  const suivant = nextStatut(c.statut);
  const relLink = `/enquete/${c.token}`;
  const fullLink = c.lien_public || (typeof window !== 'undefined' ? `${window.location.origin}${relLink}` : relLink);

  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-slate-800">{c.titre}</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUT_STYLES[c.statut] || ''}`}>{STATUT_LABELS[c.statut] || c.statut}</span>
            {c.modele_anonyme && <span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-medium">anonyme</span>}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {c.modele_titre}{c.modele_categorie ? ` · ${CATEGORIE_LABELS[c.modele_categorie] || c.modele_categorie}` : ''}
            {c.public_cible ? ` · cible : ${c.public_cible}` : ''}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {c.date_ouverture ? `Ouverture ${frDate(c.date_ouverture)}` : 'Ouverture non planifiée'}
            {c.date_cloture ? ` → clôture ${frDate(c.date_cloture)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600 flex-shrink-0">
          <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <span><strong className="text-slate-800">{c.nb_reponses ?? 0}</strong> réponse{(c.nb_reponses ?? 0) > 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Lien public de réponse — copiable (aucune génération de QR) */}
      {c.statut === 'ouverte' ? (
        <LinkCopyRow link={fullLink} />
      ) : (
        <p className="mt-3 text-xs text-slate-400">
          {c.statut === 'brouillon'
            ? 'Ouvrez la campagne pour activer le lien de réponse.'
            : 'Campagne clôturée — le lien de réponse est désactivé.'}
        </p>
      )}

      {canWrite && (suivant || c.statut !== 'ouverte') && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {suivant && (
            <button type="button" onClick={() => onChangeStatut(c, suivant)} disabled={busy}
              className="btn-primary text-sm inline-flex items-center gap-1.5 px-3 py-1.5 disabled:opacity-50">
              {suivant === 'ouverte' ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {busy ? '…' : STATUT_ACTION_LABELS[suivant]}
            </button>
          )}
          <button type="button" onClick={onDelete} className="text-sm text-slate-400 hover:text-red-600 inline-flex items-center gap-1.5 px-2 py-1.5">
            <Trash2 className="w-4 h-4" /> Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

function LinkCopyRow({ link }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
      else {
        const ta = document.createElement('textarea');
        ta.value = link; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard indisponible : le lien reste sélectionnable */ }
  };
  return (
    <div className="mt-3 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <input readOnly value={link} className="flex-1 bg-transparent text-xs text-slate-600 outline-none min-w-0" aria-label="Lien public de réponse" onFocus={(e) => e.target.select()} />
      <button type="button" onClick={copy} className="text-xs text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 flex-shrink-0">
        {copied ? <><Check className="w-3.5 h-3.5" /> Copié</> : <><Copy className="w-3.5 h-3.5" /> Copier</>}
      </button>
      <a href={link} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-teal-700 inline-flex items-center gap-1 flex-shrink-0" title="Ouvrir dans un nouvel onglet">
        <ExternalLink className="w-3.5 h-3.5" /> Ouvrir
      </a>
    </div>
  );
}

// ── Création d'une campagne ──────────────────────────────────────────────────
function CreateCampagne({ onClose, onCreated }) {
  const [modeles, setModeles] = useState([]);
  const [loadingModeles, setLoadingModeles] = useState(true);
  const [form, setForm] = useState({ modele_id: '', titre: '', public_cible: '', date_ouverture: '', date_cloture: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    api.get('/enquetes/modeles?actif=1')
      .then((r) => { if (alive) setModeles(Array.isArray(r.data) ? r.data : []); })
      .catch((err) => { if (alive) setError(apiErr(err, 'Impossible de charger les modèles.')); })
      .finally(() => { if (alive) setLoadingModeles(false); });
    return () => { alive = false; };
  }, []);

  const selected = modeles.find((m) => String(m.id) === String(form.modele_id));

  const save = async () => {
    if (!form.modele_id) { setError('Choisissez un modèle de questionnaire.'); return; }
    if (!form.titre.trim()) { setError('Le titre de la campagne est obligatoire.'); return; }
    setSaving(true); setError(null);
    const payload = {
      modele_id: parseInt(form.modele_id, 10),
      titre: form.titre.trim(),
      public_cible: form.public_cible.trim() || null,
      date_ouverture: form.date_ouverture || null,
      date_cloture: form.date_cloture || null,
    };
    try {
      await api.post('/enquetes/campagnes', payload);
      onCreated();
    } catch (err) {
      setError(apiErr(err, 'Création de la campagne impossible.'));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Nouvelle campagne"
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50">
            {saving ? 'Création…' : 'Créer (brouillon)'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="cc-modele">Modèle de questionnaire <span className="text-red-500">*</span></label>
          {loadingModeles ? (
            <p className="text-sm text-slate-400">Chargement des modèles…</p>
          ) : modeles.length === 0 ? (
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2.5">Aucun modèle actif. Créez d'abord un modèle dans l'onglet « Modèles ».</p>
          ) : (
            <select id="cc-modele" value={form.modele_id} onChange={(e) => set('modele_id', e.target.value)} className="input-modern w-full text-sm">
              <option value="">— Choisir un modèle —</option>
              {modeles.map((m) => (
                <option key={m.id} value={m.id}>{m.titre} ({m.nb_questions ?? 0} question{(m.nb_questions ?? 0) > 1 ? 's' : ''})</option>
              ))}
            </select>
          )}
          {selected && (
            <p className="text-[11px] text-slate-400 mt-1">
              {CATEGORIE_LABELS[selected.categorie] || selected.categorie}{selected.anonyme ? ' · anonyme' : ' · nominatif'}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="cc-titre">Titre de la campagne <span className="text-red-500">*</span></label>
          <input id="cc-titre" value={form.titre} onChange={(e) => set('titre', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. Baromètre QVCT — 2e semestre 2026" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="cc-cible">Public cible</label>
          <input id="cc-cible" value={form.public_cible} onChange={(e) => set('public_cible', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. Salariés en parcours, encadrants, partenaires…" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="cc-ouv">Ouverture (prévue)</label>
            <input id="cc-ouv" type="date" value={form.date_ouverture} onChange={(e) => set('date_ouverture', e.target.value)} className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="cc-clo">Clôture (prévue)</label>
            <input id="cc-clo" type="date" value={form.date_cloture} onChange={(e) => set('date_cloture', e.target.value)} className="input-modern w-full text-sm" />
          </div>
        </div>
        <p className="text-[11px] text-slate-400">
          La campagne est créée en <strong>brouillon</strong>. Elle ne devient répondable qu'une fois <strong>ouverte</strong> depuis la liste. Le lien de réponse est alors activé.
        </p>
      </div>
    </Modal>
  );
}
