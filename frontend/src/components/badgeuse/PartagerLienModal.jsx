/**
 * Partage d'un lien pour l'écran de veille (CDC_AFFICHAGE_V2 §2, type `lien`,
 * servi comme `media`). Le SERVEUR télécharge le contenu (image/vidéo, https,
 * liste blanche de types, taille max, garde anti-SSRF) — le poste ne fetch
 * JAMAIS un domaine externe. Contrat assumé : `POST /badgeuse/contenus/lien`
 * { url, titre, duree_sec, ordre, visible_du, visible_au, actif }, 422 explicite
 * si le contenu à cette URL n'est pas un média téléchargeable.
 */
import { useState, useEffect } from 'react';
import { Link2, ShieldAlert } from 'lucide-react';
import api from '../../services/api';
import { Modal, useToast } from '../../components';
import { apiErr } from './badgeuseShared';

function emptyForm() {
  return { url: '', titre: '', duree_sec: 12, ordre: 0, visible_du: '', visible_au: '', actif: true };
}

export default function PartagerLienModal({ open, onClose, onShared }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setForm(emptyForm()); setError(null); } }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    const url = form.url.trim();
    if (!/^https:\/\/.+/i.test(url)) { setError('Le lien doit être une URL https valide.'); return; }
    const duree = parseInt(form.duree_sec, 10);
    if (!Number.isFinite(duree) || duree < 5 || duree > 60) { setError('La durée doit être comprise entre 5 et 60 secondes.'); return; }
    setSaving(true); setError(null);
    try {
      await api.post('/badgeuse/contenus/lien', {
        url,
        titre: form.titre.trim() || null,
        duree_sec: duree,
        ordre: parseInt(form.ordre, 10) || 0,
        visible_du: form.visible_du || null,
        visible_au: form.visible_au || null,
        actif: form.actif,
      });
      toast.success('Lien partagé — le serveur a récupéré le contenu.');
      onShared();
    } catch (err) {
      // 422 explicite (CDC §2) : le contenu de l'URL n'est pas un média
      // téléchargeable (type non supporté, taille excessive, hôte refusé…).
      if (err?.response?.status === 422) {
        setError(apiErr(err, "Ce lien ne pointe pas vers un contenu téléchargeable (image ou vidéo attendue)."));
      } else {
        setError(apiErr(err, 'Partage du lien impossible.'));
      }
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title="Partager un lien" size="md"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Annuler</button>
        <button type="submit" form="partager-lien-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Envoi…' : 'Partager'}</button>
      </>}>
      <form id="partager-lien-form" onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">URL (https)</label>
          <div className="relative">
            <Link2 className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="input-modern py-2 pl-8 text-sm w-full" placeholder="https://…" maxLength={500} required />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Titre</label>
          <input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} className="input-modern py-2 text-sm w-full" maxLength={200} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Durée (s)</label>
            <input type="number" min={5} max={60} value={form.duree_sec} onChange={(e) => setForm({ ...form, duree_sec: e.target.value })} className="input-modern py-2 text-sm w-full" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ordre d'affichage</label>
            <input type="number" value={form.ordre} onChange={(e) => setForm({ ...form, ordre: e.target.value })} className="input-modern py-2 text-sm w-full" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Visible du</label>
            <input type="date" value={form.visible_du} onChange={(e) => setForm({ ...form, visible_du: e.target.value })} className="input-modern py-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Visible au</label>
            <input type="date" value={form.visible_au} onChange={(e) => setForm({ ...form, visible_au: e.target.value })} className="input-modern py-2 text-sm w-full" min={form.visible_du || undefined} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded border-slate-300" /> Contenu actif
        </label>

        <div role="note" className="rounded-lg border border-teal-200 bg-teal-50 text-teal-800 text-xs px-3 py-2 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Le serveur télécharge le contenu de ce lien — le poste n'accède jamais à Internet. Seuls les liens pointant vers une image ou une vidéo sont acceptés.</span>
        </div>
      </form>
    </Modal>
  );
}
