/**
 * Téléversement d'un média (image/vidéo) pour l'écran de veille (CDC_AFFICHAGE_V2
 * §2, type `media`). Le fichier est stocké côté SOLIDATA et servi au poste par
 * l'API device (`GET /devices/:code/media/:id`) — jamais d'URL externe.
 * `POST /badgeuse/contenus/upload` (multipart, champ `fichier` — multer
 * `.single('fichier')` côté serveur), même jeu de métadonnées que les autres
 * contenus (titre/duree_sec/ordre/fenêtre/actif).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { UploadCloud, Image as ImageIcon, Video } from 'lucide-react';
import api from '../../services/api';
import { Modal, useToast } from '../../components';
import { uploadErr, ChampVakUniquement } from './badgeuseShared';

// Plafond de REPLI, utilisé seulement tant que le serveur n'a pas répondu.
// Le chiffre qui fait foi vient de `GET /badgeuse/contenus/upload-limites` :
// une constante figée ici avait fini par annoncer 100 Mo alors que la chaîne
// n'en laissait passer que 50, et l'envoi mourait sans message lisible.
const MAX_MO_REPLI = 50;
// Liste blanche exacte du serveur (utils/upload-filters.js `mediaFilter`) —
// ni SVG ni HTML (formats exécutables côté navigateur, cf. T1.1).
const ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm';

function emptyForm() {
  return { titre: '', duree_sec: 12, ordre: 0, visible_du: '', visible_au: '', actif: true, vak_uniquement: false };
}

export default function UploadMediaModal({ open, onClose, onUploaded }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [maxMo, setMaxMo] = useState(MAX_MO_REPLI);

  // Le plafond est demandé à l'ouverture : il est paramétrable côté serveur
  // (`badgeuse.media_upload_max_mo`) et l'écran doit annoncer la valeur réelle,
  // pas une valeur de compilation.
  const chargerLimites = useCallback(() => {
    api.get('/badgeuse/contenus/upload-limites')
      .then((r) => {
        const n = Number(r?.data?.max_mo);
        if (Number.isFinite(n) && n >= 1) setMaxMo(n);
      })
      .catch(() => { /* repli conservateur : on garde MAX_MO_REPLI */ });
  }, []);
  useEffect(() => { if (open) chargerLimites(); }, [open, chargerLimites]);

  const reset = () => { setFile(null); setForm(emptyForm()); setProgress(0); setError(null); };
  const close = () => { if (uploading) return; reset(); onClose(); };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > maxMo * 1024 * 1024) {
      // Refus IMMÉDIAT et explicite : inutile de faire monter une barre de
      // progression pendant plusieurs minutes pour un envoi condamné d'avance.
      setError(`Fichier trop volumineux : ${(f.size / (1024 * 1024)).toFixed(1)} Mo pour un maximum de ${maxMo} Mo. Compressez la vidéo ou raccourcissez-la.`);
      e.target.value = '';
      return;
    }
    setError(null);
    setFile(f);
    if (!form.titre) setForm((s) => ({ ...s, titre: f.name.replace(/\.[^.]+$/, '') }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setError('Choisissez un fichier image ou vidéo.'); return; }
    const duree = parseInt(form.duree_sec, 10);
    if (!Number.isFinite(duree) || duree < 5 || duree > 60) { setError('La durée doit être comprise entre 5 et 60 secondes.'); return; }
    setUploading(true); setError(null); setProgress(0);
    try {
      const fd = new FormData();
      fd.append('fichier', file);
      fd.append('titre', form.titre.trim() || file.name);
      fd.append('duree_sec', String(duree));
      fd.append('ordre', String(parseInt(form.ordre, 10) || 0));
      if (form.visible_du) fd.append('visible_du', form.visible_du);
      if (form.visible_au) fd.append('visible_au', form.visible_au);
      fd.append('actif', String(!!form.actif));
      // Multipart : tout part en chaîne. Le serveur ne retient que `'true'`
      // (une chaîne `'false'` serait vraie pour un test de vérité naïf).
      fd.append('vak_uniquement', String(!!form.vak_uniquement));
      await api.post('/badgeuse/contenus/upload', fd, {
        timeout: 300000, // upload volumineux — nginx autorise 300 s sur /api
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });
      toast.success('Média téléversé.');
      reset();
      onUploaded();
    } catch (err) {
      setError(uploadErr(err, maxMo, file.size / (1024 * 1024)));
      setUploading(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={close} title="Téléverser un média" size="md"
      footer={<>
        <button type="button" onClick={close} className="btn-secondary text-sm" disabled={uploading}>Annuler</button>
        <button type="submit" form="upload-media-form" disabled={uploading || !file} className="btn-primary text-sm disabled:opacity-50">
          {uploading ? `Envoi… ${progress}%` : 'Téléverser'}
        </button>
      </>}>
      <form id="upload-media-form" onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Fichier (image ou vidéo, max {maxMo} Mo)</label>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            className="w-full border-2 border-dashed border-slate-300 rounded-lg py-6 flex flex-col items-center gap-2 text-slate-500 hover:border-teal-400 hover:text-teal-600 disabled:opacity-50">
            {file ? (file.type.startsWith('video') ? <Video className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />) : <UploadCloud className="w-6 h-6" />}
            <span className="text-sm">{file ? file.name : 'Choisir un fichier…'}</span>
            {file && <span className="text-xs text-slate-400">{(file.size / (1024 * 1024)).toFixed(1)} Mo</span>}
          </button>
          <input ref={inputRef} type="file" accept={ACCEPT} onChange={pickFile} className="hidden" disabled={uploading} />
        </div>

        {uploading && (
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-teal-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Titre</label>
          <input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} className="input-modern py-2 text-sm w-full" maxLength={200} disabled={uploading} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Durée (s)</label>
            <input type="number" min={5} max={60} value={form.duree_sec} onChange={(e) => setForm({ ...form, duree_sec: e.target.value })} className="input-modern py-2 text-sm w-full" disabled={uploading} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ordre d'affichage</label>
            <input type="number" value={form.ordre} onChange={(e) => setForm({ ...form, ordre: e.target.value })} className="input-modern py-2 text-sm w-full" disabled={uploading} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Visible du</label>
            <input type="date" value={form.visible_du} onChange={(e) => setForm({ ...form, visible_du: e.target.value })} className="input-modern py-2 text-sm w-full" disabled={uploading} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Visible au</label>
            <input type="date" value={form.visible_au} onChange={(e) => setForm({ ...form, visible_au: e.target.value })} className="input-modern py-2 text-sm w-full" min={form.visible_du || undefined} disabled={uploading} />
          </div>
        </div>

        <ChampVakUniquement value={form.vak_uniquement} disabled={uploading}
          onChange={(v) => setForm({ ...form, vak_uniquement: v })} />

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded border-slate-300" disabled={uploading} /> Contenu actif
        </label>

        <p className="text-[11px] text-slate-400">
          Aucune donnée personnelle, aucune photo de personne (exigence de conformité). Le fichier est stocké sur SOLIDATA et servi
          en local par le poste — le kiosque n'accède jamais à Internet.
        </p>
      </form>
    </Modal>
  );
}
