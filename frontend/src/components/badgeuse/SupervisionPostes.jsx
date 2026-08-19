import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import io from 'socket.io-client';
import { Radio, Plus, KeyRound, ShieldCheck, RefreshCw, Copy, Check, Thermometer, Clock3, Database, ListOrdered, AlertTriangle, Hash, Trash2, Timer, PowerOff } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, EmptyState, Modal, ConfirmDialog } from '../../components';
import { apiErr, fmtDepuis, CIBLE_DEVICE_LABELS, EnLigneBadge, isDeviceOnline } from './badgeuseShared';

// Cadence de rafraîchissement de la supervision (BO-09). Le temps réel passe
// par Socket.IO ; ce sondage est le filet de sécurité qui garantit que l'écran
// ne reste jamais figé sur un instantané, même socket coupée.
const REFRESH_MS = 60 * 1000;

// Bouton « copier » utilitaire, réutilisé dans le panneau de clés à usage unique.
function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* presse-papiers indisponible : la valeur reste sélectionnable */ }
  };
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 border border-teal-200 rounded-lg px-2 py-1 bg-teal-50">
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copié' : (label || 'Copier')}
    </button>
  );
}

// ── Modale « + Appairer un poste » ───────────────────────────────────────────
function AppairerModal({ open, onClose, onSaved, sitesKnown }) {
  const [form, setForm] = useState({ code: '', libelle: '', site_id: sitesKnown[0]?.id ? String(sitesKnown[0].id) : '', cible: 'pi5' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { deviceKey, siteKey }

  useEffect(() => {
    if (!open) return;
    setForm({ code: '', libelle: '', site_id: sitesKnown[0]?.id ? String(sitesKnown[0].id) : '', cible: 'pi5' });
    setError(null); setResult(null);
  }, [open, sitesKnown]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.code.trim()) { setError('Le code du poste est requis (ex. LH-P1).'); return; }
    if (!form.site_id) { setError('Le site est requis.'); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.post('/badgeuse/devices', {
        code: form.code.trim(), libelle: form.libelle.trim() || form.code.trim(),
        site_id: parseInt(form.site_id, 10), cible: form.cible,
      });
      const d = res.data || {};
      setResult({
        deviceKey: d.device_key || d.api_key || d.key || d.device?.api_key || null,
        siteKey: d.hmac_key || d.hmac_key_site || d.site_hmac_key || d.site_key || null,
      });
    } catch (err) { setError(apiErr(err, "Appairage du poste impossible.")); }
    finally { setSaving(false); }
  };

  const finish = () => { onSaved(); };

  return (
    <Modal isOpen={open} onClose={result ? finish : onClose} title="Appairer un nouveau poste" size="md"
      footer={result ? (
        <button type="button" onClick={finish} className="btn-primary text-sm">J'ai noté les clés — Fermer</button>
      ) : (
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Annuler</button>
          <button type="submit" form="appairer-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Appairage…' : 'Appairer'}</button>
        </>
      )}>
      {result ? (
        <div className="space-y-3">
          <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 font-medium">
            Notez ces clés maintenant : elles ne seront plus jamais affichées.
          </div>
          {result.deviceKey && (
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-xs font-medium text-slate-500 mb-1">Clé du poste (X-Device-Key)</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-slate-50 rounded px-2 py-1.5 break-all">{result.deviceKey}</code>
                <CopyButton value={result.deviceKey} />
              </div>
            </div>
          )}
          {result.siteKey && (
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-xs font-medium text-slate-500 mb-1">Clé HMAC du site</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-slate-50 rounded px-2 py-1.5 break-all">{result.siteKey}</code>
                <CopyButton value={result.siteKey} />
              </div>
            </div>
          )}
          {!result.deviceKey && !result.siteKey && (
            <p className="text-sm text-slate-500">Le poste a été créé. Aucune clé n'a été retournée par le serveur — vérifiez la configuration du poste manuellement.</p>
          )}
        </div>
      ) : (
        <form id="appairer-form" onSubmit={submit} className="space-y-3">
          {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Code du poste</label>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="input-modern py-2 text-sm w-full font-mono" placeholder="LH-P1" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cible matérielle</label>
              <select value={form.cible} onChange={(e) => setForm({ ...form, cible: e.target.value })} className="input-modern py-2 text-sm w-full">
                {Object.entries(CIBLE_DEVICE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Libellé</label>
            <input value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })} className="input-modern py-2 text-sm w-full" placeholder="Entrée atelier — Le Houlme" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Site</label>
            {sitesKnown.length > 0 ? (
              <select value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })} className="input-modern py-2 text-sm w-full" required>
                <option value="">— Choisir —</option>
                {sitesKnown.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            ) : (
              <>
                <input type="number" min={1} value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })} className="input-modern py-2 text-sm w-full" placeholder="1" required />
                <p className="text-xs text-slate-400 mt-1">Identifiant du site (le site seedé par défaut « Le Houlme — atelier » est généralement le n°1).</p>
              </>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── Modale « Régénérer la clé » ──────────────────────────────────────────────
function RegenererModal({ device, onClose, onDone }) {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const doRegen = async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.post(`/badgeuse/devices/${device.id}/regenerate-key`);
      const d = res.data || {};
      setResult(d.device_key || d.api_key || d.key || null);
    } catch (err) { setError(apiErr(err, 'Régénération impossible.')); }
    finally { setLoading(false); }
  };

  if (!confirmed && !result) {
    return (
      <ConfirmDialog isOpen onCancel={onClose} onConfirm={() => { setConfirmed(true); doRegen(); }}
        title="Régénérer la clé du poste"
        message={`Régénérer la clé de « ${device.libelle || device.code} » ? Le poste actuellement appairé sera déconnecté immédiatement et devra être reconfiguré avec la nouvelle clé.`}
        confirmLabel="Régénérer" confirmVariant="danger" loading={loading} />
    );
  }

  return (
    <Modal isOpen onClose={onDone} title="Nouvelle clé du poste" size="sm"
      footer={<button type="button" onClick={onDone} className="btn-primary text-sm">J'ai noté la clé — Fermer</button>}>
      {error ? (
        <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>
      ) : result ? (
        <div className="space-y-2">
          <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 font-medium">
            Notez cette clé maintenant : elle ne sera plus jamais affichée.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-slate-50 rounded px-2 py-1.5 break-all">{result}</code>
            <CopyButton value={result} />
          </div>
        </div>
      ) : <LoadingSpinner size="sm" />}
    </Modal>
  );
}

// ── Modale « Code d'appairage » (ADR-0005) ───────────────────────────────────
// Le chemin nominal de mise en service : au lieu de recopier deux clés de 64
// caractères hex au clavier d'un Raspberry, l'installateur saisit 8 caractères.
// Le code est affiché UNE SEULE FOIS, en grand, avec le temps qui lui reste.

/** Secondes restantes avant l'échéance, rafraîchies chaque seconde. */
function useCompteARebours(expireLe) {
  const restantDe = (e) => (e ? Math.max(0, Math.round((new Date(e).getTime() - Date.now()) / 1000)) : 0);
  const [restant, setRestant] = useState(() => restantDe(expireLe));
  useEffect(() => {
    if (!expireLe) return undefined;
    setRestant(restantDe(expireLe));
    const timer = setInterval(() => setRestant(restantDe(expireLe)), 1000);
    return () => clearInterval(timer);
  }, [expireLe]);
  return restant;
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function CodeAppairageModal({ device, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null); // { code, expire_le, ttl_minutes }

  const emettre = useCallback(() => {
    setLoading(true); setError(null); setData(null);
    return api.post(`/badgeuse/devices/${device.id}/code-appairage`)
      .then((r) => setData(r.data || null))
      .catch((err) => setError(apiErr(err, "Émission du code impossible.")))
      .finally(() => setLoading(false));
  }, [device.id]);

  useEffect(() => { emettre(); }, [emettre]);

  const restant = useCompteARebours(data && data.expire_le);
  const expire = !!data && restant === 0;

  return (
    <Modal isOpen onClose={onClose} title={`Code d'appairage — ${device.libelle || device.code}`} size="md"
      footer={<button type="button" onClick={onClose} className="btn-primary text-sm">Fermer</button>}>
      {loading && <LoadingSpinner size="md" message="Émission du code…" />}
      {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}

      {data && (
        <div className="space-y-4">
          {/* Le code, en très grand : il est lu sur cet écran et retapé sur le
              poste, souvent à deux personnes et à distance de bras. */}
          <div className={`rounded-xl border-2 py-6 px-4 text-center ${expire ? 'border-slate-200 bg-slate-50' : 'border-teal-300 bg-teal-50'}`}>
            <div
              className={`font-mono font-bold tabular-nums ${expire ? 'text-slate-400 line-through' : 'text-teal-800'}`}
              style={{ fontSize: '3rem', letterSpacing: '0.15em', lineHeight: 1.15 }}
            >
              {data.code}
            </div>
            <div className="mt-3 flex items-center justify-center gap-3">
              {expire ? (
                <span className="text-sm font-medium text-slate-500">Code expiré</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700">
                  <Timer className="w-4 h-4" aria-hidden="true" />
                  Valable encore <span className="tabular-nums font-semibold">{mmss(restant)}</span>
                </span>
              )}
              {!expire && <CopyButton value={data.code} label="Copier le code" />}
            </div>
          </div>

          {expire ? (
            <button type="button" onClick={emettre} className="btn-primary text-sm w-full">
              Émettre un nouveau code
            </button>
          ) : (
            <p className="text-sm text-slate-600">
              Saisissez ce code sur le poste. Il est valable {data.ttl_minutes} minutes et ne sert qu'une fois.
            </p>
          )}

          <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
            <li>Le poste récupère lui-même sa clé et celle du site : plus rien à recopier à la main.</li>
            <li>La clé précédente du poste est révoquée dès que le code est utilisé.</li>
            <li>Ce code n'est affiché qu'une fois. S'il est perdu, émettez-en simplement un nouveau.</li>
          </ul>
        </div>
      )}
    </Modal>
  );
}

// ── Modale « Supprimer le poste » ────────────────────────────────────────────
// Un poste qui a enregistré des pointages appartient à la piste d'audit : le
// serveur refuse alors la suppression (409). L'écran ne se contente pas de
// relayer le refus, il propose la manœuvre correcte — la désactivation.
function SupprimerModal({ device, onClose, onDone }) {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refus, setRefus] = useState(null);      // message du serveur (409)
  const [error, setError] = useState(null);      // autre échec
  const [desactive, setDesactive] = useState(false);

  const supprimer = async () => {
    setLoading(true); setRefus(null); setError(null);
    try {
      await api.delete(`/badgeuse/devices/${device.id}`);
      onDone();
    } catch (err) {
      if (err && err.response && err.response.status === 409) {
        setRefus(apiErr(err, 'Ce poste ne peut pas être supprimé.'));
      } else {
        setError(apiErr(err, 'Suppression impossible.'));
      }
    } finally { setLoading(false); }
  };

  const desactiver = async () => {
    setLoading(true); setError(null);
    try {
      await api.patch(`/badgeuse/devices/${device.id}`, { actif: false });
      setDesactive(true);
    } catch (err) { setError(apiErr(err, 'Désactivation impossible.')); }
    finally { setLoading(false); }
  };

  if (!confirmed) {
    return (
      <ConfirmDialog isOpen onCancel={onClose} onConfirm={() => { setConfirmed(true); supprimer(); }}
        title="Supprimer le poste"
        message={`Supprimer définitivement « ${device.libelle || device.code} » ? La suppression est refusée si le poste a déjà enregistré des pointages.`}
        confirmLabel="Supprimer" confirmVariant="danger" loading={loading} />
    );
  }

  return (
    <Modal isOpen onClose={desactive ? onDone : onClose} title={`Supprimer — ${device.libelle || device.code}`} size="md"
      footer={<button type="button" onClick={desactive ? onDone : onClose} className="btn-primary text-sm">Fermer</button>}>
      {loading && <LoadingSpinner size="sm" />}
      {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}

      {desactive && (
        <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">
          Poste désactivé. Il n'accepte plus aucun dépôt, et ses heures restent consultables.
        </div>
      )}

      {refus && !desactive && (
        <div className="space-y-3">
          <div role="alert" className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
            {refus}
          </div>
          <button type="button" onClick={desactiver} disabled={loading}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <PowerOff className="w-4 h-4" aria-hidden="true" /> Désactiver le poste à la place
          </button>
        </div>
      )}
    </Modal>
  );
}

function VerifyChainResult({ device, onClose }) {
  const [state, setState] = useState('loading'); // loading | ok | ko | error
  const [ruptures, setRuptures] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/badgeuse/devices/${device.id}/verify-chain`)
      .then((r) => {
        if (!alive) return;
        const d = r.data || {};
        const ok = d.ok === true || d.valide === true;
        setRuptures(Array.isArray(d.ruptures) ? d.ruptures : (Array.isArray(d.problemes) ? d.problemes : []));
        setState(ok ? 'ok' : 'ko');
      })
      .catch((err) => { if (alive) { setError(apiErr(err, 'Vérification impossible.')); setState('error'); } });
    return () => { alive = false; };
  }, [device.id]);

  return (
    <Modal isOpen onClose={onClose} title={`Chaîne d'intégrité — ${device.libelle || device.code}`} size="md"
      footer={<button type="button" onClick={onClose} className="btn-primary text-sm">Fermer</button>}>
      {state === 'loading' && <LoadingSpinner size="md" message="Vérification de la chaîne…" />}
      {state === 'error' && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
      {state === 'ok' && (
        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm font-medium">
          <ShieldCheck className="w-5 h-5" /> Chaîne d'intégrité valide — aucune rupture détectée.
        </div>
      )}
      {state === 'ko' && (
        <div className="space-y-2">
          <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 text-sm font-medium">
            Rupture(s) détectée(s) dans la chaîne d'intégrité de ce poste.
          </div>
          {ruptures.length > 0 && (
            <ul className="text-xs text-red-600 list-disc pl-5 space-y-1">
              {ruptures.map((r, i) => <li key={i}>{typeof r === 'string' ? r : JSON.stringify(r)}</li>)}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Carte poste ──────────────────────────────────────────────────────────────
function DeviceCard({ device, isAdmin, onRegenerate, onVerify, onCodeAppairage, onSupprimer }) {
  // Noms de champs du CONTRAT_API_DEVICE §2.5 (`derive_estimee_sec`,
  // `temperature_cpu`, `disque_libre_mo`) — ils étaient lus sous des noms qui
  // n'existent nulle part côté serveur, si bien que toute la télémétrie
  // s'affichait « — ». Les alias historiques restent en repli.
  const hb = device.heartbeat_info || {};
  const derive = hb.derive_estimee_sec ?? hb.derive_horloge_sec ?? hb.derive_sec;
  const temperature = hb.temperature_cpu ?? hb.temperature_c ?? hb.temperature;
  const tailleFile = hb.taille_file ?? hb.file_attente ?? hb.queue_size;
  const disqueMo = hb.disque_libre_mo ?? hb.espace_libre_mo;
  const throttled = hb.throttled === true;
  // Alerte remontée par le poste (QA-02) : à plat dans la réponse, sinon dans
  // le heartbeat brut.
  const alerte = device.alerte ?? hb.alerte ?? null;
  const enLigne = isDeviceOnline(device);

  return (
    <div className="bg-white rounded-xl border p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">{device.libelle || device.code}</div>
          <div className="text-xs text-slate-400 font-mono">{device.code}{device.site_libelle ? ` · ${device.site_libelle}` : (device.site_code ? ` · ${device.site_code}` : '')}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {device.actif === false && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              <PowerOff className="w-3 h-3" aria-hidden="true" /> désactivé
            </span>
          )}
          <EnLigneBadge enLigne={enLigne} />
        </div>
      </div>

      {/* Alerte émise par le poste lui-même (PST-07 / QA-02) : file non
          purgeable, éléments refusés, lecteur débranché… Jamais silencieuse. */}
      {alerte && (
        <div role="alert" className="flex items-start gap-1.5 text-xs font-medium bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-2 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />
          <span className="break-words">{alerte}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600">
        <div className="flex items-center gap-1"><Clock3 className="w-3.5 h-3.5 text-slate-400" /> Dernière remontée</div>
        <div className="text-right text-slate-500">{device.dernier_heartbeat ? fmtDepuis(device.dernier_heartbeat) : 'jamais'}</div>
        <div>Version</div>
        <div className="text-right text-slate-500">{device.version_logicielle || '—'}</div>
        <div>Cible</div>
        <div className="text-right text-slate-500">{CIBLE_DEVICE_LABELS[device.cible] || device.cible || '—'}</div>
        <div className="flex items-center gap-1"><Clock3 className="w-3.5 h-3.5 text-slate-400" /> Dérive horloge</div>
        <div className={`text-right ${derive != null && Math.abs(Number(derive)) > 2 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{derive != null ? `${derive} s` : '—'}</div>
        <div className="flex items-center gap-1"><Thermometer className="w-3.5 h-3.5 text-slate-400" /> Température</div>
        <div className={`text-right ${throttled ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
          {temperature != null ? `${temperature} °C` : '—'}{throttled ? ' (throttling)' : ''}
        </div>
        <div className="flex items-center gap-1"><ListOrdered className="w-3.5 h-3.5 text-slate-400" /> File d'attente</div>
        <div className={`text-right ${Number(tailleFile) > 0 ? 'text-amber-700 font-medium' : 'text-slate-500'}`}>{tailleFile != null ? tailleFile : '—'}</div>
        <div className="flex items-center gap-1"><Database className="w-3.5 h-3.5 text-slate-400" /> Disque libre</div>
        <div className="text-right text-slate-500">{disqueMo != null ? `${Math.round(Number(disqueMo) / 1024)} Go` : '—'}</div>
      </div>

      <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 pt-2 border-t border-slate-100">
        <button onClick={() => onVerify(device)} className="text-xs font-medium text-teal-700 hover:text-teal-900 inline-flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" /> Vérifier la chaîne
        </button>
        {isAdmin && (
          <>
            {/* Chemin nominal de mise en service (ADR-0005) : 8 caractères à
                saisir sur le poste, au lieu de deux clés de 64 caractères. */}
            <button onClick={() => onCodeAppairage(device)} className="text-xs font-medium text-teal-700 hover:text-teal-900 inline-flex items-center gap-1">
              <Hash className="w-3.5 h-3.5" /> Code d'appairage
            </button>
            <button onClick={() => onRegenerate(device)} className="text-xs font-medium text-amber-700 hover:text-amber-900 inline-flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5" /> Régénérer la clé
            </button>
            <button onClick={() => onSupprimer(device)} className="text-xs font-medium text-red-600 hover:text-red-800 inline-flex items-center gap-1 ml-auto">
              <Trash2 className="w-3.5 h-3.5" /> Supprimer
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Onglet Supervision (BO-09) ────────────────────────────────────────────────
export default function SupervisionPostes({ isAdmin }) {
  const [devices, setDevices] = useState([]);
  const [silenceMinutes, setSilenceMinutes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [majLe, setMajLe] = useState(null);
  const [tempsReel, setTempsReel] = useState(false);
  const [appairerOpen, setAppairerOpen] = useState(false);
  const [regenDevice, setRegenDevice] = useState(null);
  const [verifyDevice, setVerifyDevice] = useState(null);
  const [codeDevice, setCodeDevice] = useState(null);
  const [supprDevice, setSupprDevice] = useState(null);

  // `silencieux` sert au rendu ; `load` doit rester stable pour le timer et la
  // socket — d'où la référence plutôt qu'une dépendance.
  const loadRef = useRef(null);

  const load = useCallback(({ silencieux = false } = {}) => {
    if (!silencieux) setLoading(true);
    return api.get('/badgeuse/devices')
      .then((r) => {
        const d = r.data;
        setDevices(Array.isArray(d) ? d : (d.devices || d.rows || d.items || []));
        if (d && d.silence_minutes != null) setSilenceMinutes(Number(d.silence_minutes));
        setMajLe(new Date());
        setError(null);
      })
      .catch((err) => {
        // Un rafraîchissement de fond en échec ne doit pas effacer l'écran :
        // l'erreur ne remonte que pour le premier chargement.
        if (!silencieux) setError(apiErr(err, 'Chargement des postes impossible.'));
      })
      .finally(() => { if (!silencieux) setLoading(false); });
  }, []);
  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // ── Rafraîchissement automatique (BO-09) ──
  // La page ne peut plus rester figée sur l'instantané du montage : sondage
  // toutes les 60 s, nettoyé au démontage.
  useEffect(() => {
    const timer = setInterval(() => loadRef.current({ silencieux: true }), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // ── Temps réel (Socket.IO) ──
  // Le serveur émettait déjà « badgeuse:pointage » et « badgeuse:device-offline »
  // vers la salle `badgeuse:supervision` — sans aucun abonné (QA-04). On la
  // rejoint ici, en reprenant le pattern de VakLive. En cas d'indisponibilité
  // de la socket, le sondage ci-dessus suffit : la supervision n'en dépend pas.
  useEffect(() => {
    // Clé réelle du dépôt : « accessToken » (cf. VakLive) — « token » n'existe
    // pas et laisserait la socket non authentifiée.
    const token = localStorage.getItem('accessToken');
    if (!token) return undefined;
    let socket;
    try {
      socket = io(window.location.origin, { auth: { token } });
    } catch {
      return undefined;
    }
    const rafraichir = () => loadRef.current({ silencieux: true });
    socket.on('connect', () => { setTempsReel(true); socket.emit('badgeuse:join-supervision'); });
    socket.on('disconnect', () => setTempsReel(false));
    socket.on('connect_error', () => setTempsReel(false));
    socket.on('badgeuse:pointage', rafraichir);
    socket.on('badgeuse:device-offline', rafraichir);
    return () => {
      try { socket.emit('badgeuse:leave-supervision'); } catch { /* socket déjà fermée */ }
      socket.disconnect();
    };
  }, []);

  const [sites, setSites] = useState([]);
  useEffect(() => {
    api.get('/badgeuse/sites')
      .then((r) => setSites(Array.isArray(r.data) ? r.data : (r.data.sites || [])))
      .catch(() => setSites([]));
  }, []);

  const sitesKnown = useMemo(() => {
    const map = new Map();
    sites.forEach((s) => { if (s.id != null) map.set(s.id, s.libelle || s.code || `Site #${s.id}`); });
    devices.forEach((d) => { if (d.site_id != null && !map.has(d.site_id)) map.set(d.site_id, d.site_libelle || d.site_code || `Site #${d.site_id}`); });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [devices, sites]);

  if (loading) return <LoadingSpinner size="lg" message="Chargement des postes…" />;
  if (error) return <ErrorState variant="card" title="Supervision indisponible" message={error} onRetry={() => load()} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Radio className="w-4 h-4 text-teal-600" /> Postes de pointage
            {tempsReel && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> temps réel
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Actualisation automatique toutes les minutes
            {majLe ? ` — dernière à ${majLe.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}` : ''}
            {silenceMinutes != null ? ` · un poste est déclaré hors ligne après ${silenceMinutes} min de silence` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} className="text-xs text-slate-400 hover:text-teal-700 inline-flex items-center gap-1" title="Actualiser">
            <RefreshCw className="w-3.5 h-3.5" /> Actualiser
          </button>
          {isAdmin && (
            <button onClick={() => setAppairerOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Appairer un poste
            </button>
          )}
        </div>
      </div>

      {devices.length === 0 ? (
        <EmptyState icon={Radio} title="Aucun poste appairé"
          description={isAdmin ? 'Appairez le premier poste de pointage (Raspberry Pi).' : 'Aucun poste n\'a encore été appairé par un administrateur.'} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((d) => (
            <DeviceCard key={d.id} device={d} isAdmin={isAdmin} onRegenerate={setRegenDevice} onVerify={setVerifyDevice}
              onCodeAppairage={setCodeDevice} onSupprimer={setSupprDevice} />
          ))}
        </div>
      )}

      <AppairerModal open={appairerOpen} sitesKnown={sitesKnown} onClose={() => setAppairerOpen(false)}
        onSaved={() => { setAppairerOpen(false); load(); }} />

      {regenDevice && <RegenererModal device={regenDevice} onClose={() => setRegenDevice(null)} onDone={() => { setRegenDevice(null); load(); }} />}
      {verifyDevice && <VerifyChainResult device={verifyDevice} onClose={() => setVerifyDevice(null)} />}
      {codeDevice && <CodeAppairageModal device={codeDevice} onClose={() => { setCodeDevice(null); load({ silencieux: true }); }} />}
      {supprDevice && <SupprimerModal device={supprDevice} onClose={() => setSupprDevice(null)} onDone={() => { setSupprDevice(null); load(); }} />}
    </div>
  );
}
