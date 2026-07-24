import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader } from '../components';
import { ClipboardList, Sparkles, Printer, Users, Target, LogOut, ListChecks, Download, Pencil } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { getInsertionParametres, PARAMETRES_DEFAUTS } from '../components/insertion/parametres';

const IA_TIMEOUT = 180000; // rapport riche (max_tokens élevé) — nginx autorise 300 s sur /api
const EXPORT_TIMEOUT = 120000;

// 9 axes — aligné sur le registre unique backend (freins-registry, PR1) :
// les moyennes consolidées sont des agrégats NON nominatifs (l'axe judiciaire
// individuel reste masqué aux managers dans les fiches, pas ici).
const FREIN_LABELS = {
  frein_mobilite: 'Mobilité', frein_sante: 'Santé', frein_finances: 'Finances',
  frein_famille: 'Famille', frein_linguistique: 'Langue',
  frein_administratif: 'Administratif', frein_numerique: 'Numérique',
  frein_logement: 'Logement', frein_judiciaire: 'Judiciaire',
};
const CATEGORY_LABELS = { competence: 'Compétence', insertion: 'Insertion pro', socialisation: 'Socialisation', frein: 'Levée de frein' };
const PRIORITY_LABELS = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' };
const STATUS_LABELS = { a_faire: 'À faire', en_cours: 'En cours' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Radar SVG des 9 freins consolidés (moyennes 0-5) ──
function FreinsRadar({ moyennes }) {
  const keys = Object.keys(FREIN_LABELS);
  const size = 340, cx = size / 2, cy = size / 2, r = 105;
  const n = keys.length;
  const step = (2 * Math.PI) / n;
  const pt = (i, val) => {
    const a = step * i - Math.PI / 2;
    const d = (Math.max(0, Math.min(5, val)) / 5) * r;
    return { x: cx + d * Math.cos(a), y: cy + d * Math.sin(a) };
  };
  const vals = keys.map((k) => Number(moyennes?.[k]) || 0);
  const hasData = vals.some((v) => v > 0);
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} className="max-w-md mx-auto" role="img" aria-label="Cartographie des freins">
      {[1, 2, 3, 4, 5].map((lvl) => (
        <polygon key={lvl} points={keys.map((_, i) => { const p = pt(i, lvl); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="#e5e7eb" strokeWidth={lvl === 5 ? 1.5 : 0.5} />
      ))}
      {keys.map((k, i) => { const p = pt(i, 5); return <line key={k} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth="0.5" />; })}
      {keys.map((k, i) => { const p = pt(i, 5.7); return <text key={k} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#6b7280">{FREIN_LABELS[k]}</text>; })}
      {hasData && (
        <polygon points={vals.map((v, i) => { const p = pt(i, v); return `${p.x},${p.y}`; }).join(' ')}
          fill="#0D9488" fillOpacity="0.18" stroke="#0D9488" strokeWidth="2" />
      )}
      {hasData && vals.map((v, i) => { const p = pt(i, v); return <circle key={i} cx={p.x} cy={p.y} r="3" fill="#0D9488" />; })}
    </svg>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone = 'teal' }) {
  const tones = {
    teal: 'bg-teal-50 text-teal-700 border-teal-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    green: 'bg-green-50 text-green-700 border-green-100',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-medium opacity-80">{Icon && <Icon className="w-4 h-4" />}{label}</div>
      <div className="mt-1 text-2xl font-bold">{value ?? '—'}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function Bar({ pct, tone = 'teal' }) {
  const color = { teal: 'bg-teal-500', amber: 'bg-amber-500', red: 'bg-red-500', green: 'bg-green-500' }[tone];
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%` }} />
    </div>
  );
}

// ── Blocs « Indicateurs conventionnels » (EXG-47/D12, PR 2) ──────────────────

// Carte réalisé vs cible : écart quand la cible existe, sinon badge honnête
// « objectif non paramétré » (doctrine KPI — jamais de valeur inventée).
function CibleCard({ label, realise, cible, ecart, unit = '%', sub }) {
  const aCible = cible != null;
  const ecartBadge = aCible && ecart != null ? (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ecart >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {ecart >= 0 ? '+' : ''}{ecart} {unit === '%' ? 'pt' : unit}
    </span>
  ) : null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-bold text-gray-800">{realise != null ? `${realise} ${unit}` : '—'}</span>
        {ecartBadge}
      </div>
      <div className="text-[11px] mt-0.5">
        {aCible
          ? <span className="text-gray-500">Cible conventionnée : <strong>{cible} {unit}</strong></span>
          : <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">objectif non paramétré</span>}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

// Petites barres horizontales pour les typologies (répartitions non nominatives).
function MiniBars({ title, data, emptyLabel = 'Aucune donnée' }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? Math.max(...entries.map(([, n]) => n)) : 0;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">{title}</p>
      {entries.length === 0 ? <p className="text-xs text-gray-400">{emptyLabel}</p> : (
        <div className="space-y-1">
          {entries.map(([k, n]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-28 text-[11px] text-gray-600 truncate" title={k}>{k}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div className="bg-teal-500 h-2 rounded-full" style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
              </div>
              <span className="w-7 text-right text-[11px] text-gray-600 font-medium">{n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Formulaire des cibles conventionnelles (ADMIN/RH) — GET/PUT /insertion/cibles.
// Champ vide = « objectif non paramétré » (efface la cible côté serveur).
const CIBLE_FIELDS = [
  { name: 'cible_taux_dynamiques', label: 'Taux de sorties dynamiques (%)' },
  { name: 'cible_taux_durable', label: 'Taux emploi durable (%)' },
  { name: 'cible_taux_transition', label: 'Taux emploi de transition (%)' },
  { name: 'cible_taux_positive', label: 'Taux autres sorties positives (%)' },
  { name: 'cible_etp_conventionnes', label: 'ETP conventionnés (annexe financière)' },
  { name: 'effectif_reference', label: 'Effectif de référence (personnes)' },
];

function CiblesForm({ onSaved, onClose }) {
  const [form, setForm] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/insertion/cibles')
      .then((r) => {
        if (!alive) return;
        const f = {};
        for (const c of CIBLE_FIELDS) f[c.name] = r.data?.[c.name] != null ? String(r.data[c.name]) : '';
        setForm(f);
        setNote(r.data?.note || '');
      })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const body = {};
      for (const c of CIBLE_FIELDS) {
        const raw = String(form[c.name] ?? '').trim().replace(',', '.');
        body[c.name] = raw === '' ? null : parseFloat(raw);
        if (raw !== '' && Number.isNaN(body[c.name])) {
          setError(`${c.label} : nombre attendu (ou champ vide pour « non paramétré »).`);
          setSaving(false);
          return;
        }
      }
      await api.put('/insertion/cibles', body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-800">Cibles conventionnelles</h3>
        <p className="text-[11px] text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-2">
          À reporter depuis l'<strong>annexe financière confirmée par la direction</strong> — jamais de valeur estimée.
          Un champ vide = « objectif non paramétré » (la carte l'affiche honnêtement).
        </p>
        {note && <p className="text-[10px] text-gray-400">{note}</p>}
        {error && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        {!form ? <LoadingSpinner size="md" message="Chargement des cibles…" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CIBLE_FIELDS.map((c) => (
              <div key={c.name}>
                <label className="block text-xs text-gray-500 mb-0.5">{c.label}</label>
                <input type="number" min="0" step="0.01" value={form[c.name]}
                  onChange={(e) => setForm({ ...form, [c.name]: e.target.value })}
                  placeholder="non paramétré" className="input-modern py-1.5 w-full" />
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
          <button type="button" onClick={save} disabled={saving || !form}
            className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer les cibles'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modale d'export du tableau des freins (REC-UX-14) ────────────────────────
// Complétude par colonne AVANT génération + filtres année / statut / CIP +
// variante sensible (ADMIN/RH, génération journalisée au registre RGPD).
const STATUT_EXPORT_OPTIONS = [
  ['all', "Tous (en parcours + sortis de l'année)"],
  ['en_parcours', 'En parcours'],
  ['sortis', "Sortis (dans l'année)"],
];

function ExportFreinsModal({ year, onClose }) {
  const [filters, setFilters] = useState({ annee: String(year || ''), statut: 'all', cip: '', sensibles: false, format: 'xlsx' });
  const [cips, setCips] = useState([]);
  const [comp, setComp] = useState(null);
  const [compLoading, setCompLoading] = useState(true);
  const [compError, setCompError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  useEffect(() => {
    api.get('/insertion/cip-referents')
      .then((r) => setCips(Array.isArray(r.data) ? r.data : []))
      .catch(() => setCips([]));
  }, []);

  const qs = useCallback((f) => {
    const p = new URLSearchParams();
    if (f.annee) p.set('annee', f.annee);
    if (f.statut) p.set('statut', f.statut);
    if (f.cip) p.set('cip', f.cip);
    p.set('sensibles', f.sensibles ? '1' : '0');
    return p.toString();
  }, []);

  // Complétude recalculée à chaque changement de filtre (REC-UX-14 : voir les
  // colonnes faibles AVANT de générer).
  useEffect(() => {
    let alive = true;
    setCompLoading(true);
    api.get(`/exports/insertion-freins/completude?${qs(filters)}`)
      .then((r) => { if (alive) { setComp(r.data); setCompError(null); } })
      .catch((err) => { if (alive) { setComp(null); setCompError(err.response?.data?.error || err.message); } })
      .finally(() => { if (alive) setCompLoading(false); });
    return () => { alive = false; };
  }, [filters, qs]);

  const download = async () => {
    setDownloading(true); setDownloadError(null);
    try {
      const res = await api.get(`/exports/insertion-freins?format=${filters.format}&${qs(filters)}`,
        { responseType: 'blob', timeout: EXPORT_TIMEOUT });
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `insertion_freins_${stamp}.${filters.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      let msg = "Erreur lors de la génération de l'export.";
      try { const txt = await err.response?.data?.text?.(); if (txt) msg = JSON.parse(txt).error || msg; } catch { /* message générique */ }
      setDownloadError(msg);
    }
    setDownloading(false);
  };

  const faibles = (comp?.colonnes || []).filter((c) => c.pct != null && c.pct < 80).length;
  const yearNow = new Date().getFullYear();

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-4 space-y-3 my-auto max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-gray-800">Export « Tableau des freins » (23 colonnes)</h3>
            <p className="text-[11px] text-gray-400">Vérifiez la complétude avant de générer — chaque génération est <strong>journalisée</strong> au registre RGPD.</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none" aria-label="Fermer">×</button>
        </div>

        {/* Filtres */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Année</label>
            <select value={filters.annee} onChange={(e) => setFilters({ ...filters, annee: e.target.value })} className="input-modern py-1.5 w-full text-sm">
              <option value="">Toutes</option>
              {Array.from({ length: 6 }, (_, i) => yearNow - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Population</label>
            <select value={filters.statut} onChange={(e) => setFilters({ ...filters, statut: e.target.value })} className="input-modern py-1.5 w-full text-sm">
              {STATUT_EXPORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">CIP référent</label>
            <select value={filters.cip} onChange={(e) => setFilters({ ...filters, cip: e.target.value })} className="input-modern py-1.5 w-full text-sm">
              <option value="">Tous</option>
              {cips.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Format</label>
            <select value={filters.format} onChange={(e) => setFilters({ ...filters, format: e.target.value })} className="input-modern py-1.5 w-full text-sm">
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV</option>
            </select>
          </div>
        </div>

        {/* Variante sensible */}
        <label className={`flex items-start gap-2 text-sm rounded-lg border p-2.5 cursor-pointer ${filters.sensibles ? 'bg-red-50 border-red-300 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
          <input type="checkbox" checked={filters.sensibles}
            onChange={(e) => setFilters({ ...filters, sensibles: e.target.checked })}
            className="rounded border-gray-300 mt-0.5" />
          <span>
            Inclure la colonne sensible <strong>« Frein judiciaire »</strong> (art. 10 RGPD).
            {filters.sensibles && <span className="block text-xs mt-0.5">⚠ Variante sensible : génération journalisée sous une action distincte — diffusion strictement limitée ADMIN/RH, jamais transmise à l'extérieur.</span>}
          </span>
        </label>

        {/* Rappel visuel de la variante choisie */}
        <p className={`text-[11px] px-2 py-1 rounded inline-block ${filters.sensibles ? 'bg-red-100 text-red-700' : 'bg-teal-50 text-teal-700'}`}>
          Variante : {filters.sensibles ? 'AVEC colonne judiciaire (sensible)' : 'sans colonne judiciaire (défaut)'}
        </p>

        {/* Complétude par colonne */}
        <div className="border rounded-lg p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <p className="text-sm font-semibold text-gray-700">
              Complétude — {comp ? `${comp.total} fiche(s) dans le périmètre` : '…'}
            </p>
            {comp && faibles > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800">{faibles} colonne(s) &lt; 80 % — complétez les diagnostics avant l'envoi</span>
            )}
          </div>
          {compError && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">Complétude indisponible : {compError}</div>}
          {compLoading && <p className="text-xs text-gray-400">Calcul de la complétude…</p>}
          {!compLoading && comp && comp.total === 0 && (
            <p className="text-xs text-gray-400">Aucune fiche dans ce périmètre — ajustez les filtres.</p>
          )}
          {!compLoading && comp && comp.total > 0 && (
            <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
              {comp.colonnes.map((c) => (
                <div key={c.cle} className="flex items-center gap-2">
                  <span className="w-44 text-[11px] text-gray-600 truncate" title={c.colonne}>{c.colonne}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className={`h-2 rounded-full ${c.pct >= 80 ? 'bg-green-500' : c.pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${c.pct || 0}%` }} />
                  </div>
                  <span className="w-16 text-right text-[11px] text-gray-500">{c.pct != null ? `${c.pct} %` : '—'} ({c.renseigne})</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {downloadError && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{downloadError}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
          <button type="button" onClick={download} disabled={downloading || (comp && comp.total === 0)}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Download className="w-4 h-4" /> {downloading ? 'Génération…' : "Générer l'export"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AuditInsertion() {
  const { user } = useAuth();
  const canIa = ['ADMIN', 'RH'].includes(user?.base_role || user?.role); // ADMIN/RH : IA, cibles, export freins
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [ia, setIa] = useState(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState(null);

  const [ciblesOpen, setCiblesOpen] = useState(false);
  const [exportFreinsOpen, setExportFreinsOpen] = useState(false);
  const [syntheseLoading, setSyntheseLoading] = useState(false);
  const [syntheseError, setSyntheseError] = useState(null);
  const [delaiCible, setDelaiCible] = useState(PARAMETRES_DEFAUTS.delai_diagnostic_jours);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/insertion/audit?year=${year}`)
      .then((r) => { setData(r.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { load(); }, [load]);
  // Cible du délai de diagnostic (réglage insertion.delai_diagnostic_jours, défaut 30 j).
  useEffect(() => {
    getInsertionParametres().then((p) => {
      const n = Number(p?.delai_diagnostic_jours);
      if (Number.isFinite(n) && n > 0) setDelaiCible(n);
    });
  }, []);

  // Synthèse comité de pilotage — CSV agrégé non nominatif (EXG-14).
  const downloadSynthese = async () => {
    setSyntheseLoading(true); setSyntheseError(null);
    try {
      const res = await api.get(`/exports/insertion-synthese?year=${year}&format=csv`,
        { responseType: 'blob', timeout: EXPORT_TIMEOUT });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `insertion_synthese_${year}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      let msg = "Erreur lors de l'export de la synthèse comité.";
      try { const txt = await err.response?.data?.text?.(); if (txt) msg = JSON.parse(txt).error || msg; } catch { /* message générique */ }
      setSyntheseError(msg);
    }
    setSyntheseLoading(false);
  };

  const generateIa = async () => {
    setIaLoading(true); setIaError(null);
    try {
      const r = await api.get(`/insertion/audit/ia?year=${year}`, { timeout: IA_TIMEOUT });
      setIa(r.data);
    } catch (err) {
      const d = err.response?.data;
      if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
        setIaError("Le rapport IA a dépassé le délai d'attente (le modèle met parfois 1 à 2 min). Réessayez.");
      } else if (err.response?.status === 503) {
        setIaError(d?.error || 'Service IA non configuré (clé Anthropic absente).');
      } else {
        setIaError((d?.error || 'Erreur lors de la génération du rapport IA') + (d?.hint ? ' — ' + d.hint : ''));
      }
    } finally {
      setIaLoading(false);
    }
  };

  const printReport = () => {
    if (!data) return;
    const ms = data.milestones?.par_type || [];
    const freins = data.freins_moyennes || {};
    const s = data.sorties || {};
    const act = data.actions || {};
    const date = new Date().toLocaleDateString('fr-FR');
    const barColor = (pct) => (pct == null ? '#94a3b8' : pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626');
    const li = (arr) => (arr && arr.length ? '<ul>' + arr.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p style="color:#9ca3af">—</p>');
    const kpi = (l, v, sub) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;
    const miniTable = (title, obj, labels) => `<div style="flex:1"><div class="mini-h">${title}</div>${Object.keys(obj || {}).length ? Object.entries(obj).map(([k, n]) => `<div class="mini-row"><span>${esc(labels?.[k] || k)}</span><span>${n}</span></div>`).join('') : '<div class="mini-row" style="color:#9ca3af">—</div>'}</div>`;

    // Radar SVG des 9 freins (toile d'araignée), même géométrie que l'écran.
    const radarSvg = (m) => {
      const keys = Object.keys(FREIN_LABELS);
      const size = 300, cx = 150, cy = 150, r = 90;
      const n = keys.length, step = (2 * Math.PI) / n;
      const pt = (i, v) => { const a = step * i - Math.PI / 2; const d = (Math.max(0, Math.min(5, v)) / 5) * r; return [cx + d * Math.cos(a), cy + d * Math.sin(a)]; };
      const poly = (v) => keys.map((_, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
      const vals = keys.map((k) => Number(m?.[k]) || 0);
      let g = '';
      [1, 2, 3, 4, 5].forEach((lvl) => { g += `<polygon points="${poly(lvl)}" fill="none" stroke="#e5e7eb" stroke-width="${lvl === 5 ? 1.2 : 0.5}"/>`; });
      keys.forEach((k, i) => { const [x, y] = pt(i, 5); g += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="0.5"/>`; });
      keys.forEach((k, i) => { const [x, y] = pt(i, 5.75); g += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9.5" fill="#475569">${FREIN_LABELS[k]}</text>`; });
      if (vals.some((v) => v > 0)) {
        g += `<polygon points="${keys.map((_, i) => pt(i, vals[i]).map((x) => x.toFixed(1)).join(',')).join(' ')}" fill="#0D9488" fill-opacity="0.18" stroke="#0D9488" stroke-width="2"/>`;
        vals.forEach((v, i) => { const [x, y] = pt(i, v); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#0D9488"/>`; });
      }
      return `<svg width="240" height="240" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
    };

    let body = `<div class="header"><div><h1>SOLIDATA — Audit Insertion</h1>`
      + `<div class="sub">Situation d'insertion de la structure • Année ${data.annee}</div></div>`
      + `<div style="text-align:right"><div class="sub">Solidarité Textiles</div><div class="sub">Édité le ${date}</div></div></div>`;

    // 0. Indicateurs conventionnels — réalisé vs cibles (EXG-47)
    const conv = data.conventionnel || {};
    const convRow = (label, realise, cible, ecart, unit = '%') =>
      `<tr><td>${label}</td><td style="text-align:right">${realise != null ? realise + ' ' + unit : '—'}</td>`
      + `<td style="text-align:right">${cible != null ? cible + ' ' + unit : '<em style="color:#94a3b8">non paramétré</em>'}</td>`
      + `<td style="text-align:right;color:${ecart == null ? '#94a3b8' : ecart >= 0 ? '#16a34a' : '#dc2626'}">${ecart != null ? (ecart >= 0 ? '+' : '') + ecart : '—'}</td></tr>`;
    body += `<div class="section"><div class="section-title">Indicateurs conventionnels (${data.annee})</div>`
      + `<table><tr><th>Indicateur</th><th style="text-align:right">Réalisé</th><th style="text-align:right">Cible</th><th style="text-align:right">Écart</th></tr>`
      + convRow('Sorties dynamiques', conv.taux_realises?.dynamiques, conv.cibles?.cible_taux_dynamiques, conv.ecarts?.dynamiques)
      + convRow('Emploi durable', conv.taux_realises?.emploi_durable, conv.cibles?.cible_taux_durable, conv.ecarts?.emploi_durable)
      + convRow('Emploi de transition', conv.taux_realises?.emploi_transition, conv.cibles?.cible_taux_transition, conv.ecarts?.emploi_transition)
      + convRow('Autres sorties positives', conv.taux_realises?.sortie_positive, conv.cibles?.cible_taux_positive, conv.ecarts?.sortie_positive)
      + convRow('ETP réalisés (approché)', data.etp_realises_approx?.valeur, conv.cibles?.cible_etp_conventionnes, conv.ecarts?.etp, 'ETP')
      + `</table>`
      + `<div class="note">${esc(data.etp_realises_approx?.note || '')}</div>`
      + `<div class="note">Délai moyen du diagnostic d'accueil : ${data.delai_moyen_diagnostic_jours != null ? data.delai_moyen_diagnostic_jours + ' j' : '—'} • PMSMP : ${data.pmsmp?.nb ?? 0} convention(s), ${data.pmsmp?.jours ?? 0} j • Satisfaction de sortie : ${data.satisfaction?.nb_reponses ? (data.satisfaction.moyenne_globale ?? '—') + '/4 (' + data.satisfaction.nb_reponses + ' rép.)' : 'aucune réponse'} • CVG : trame de reporting en attente (direction).</div>`
      + `<div class="note">${esc(conv.methode || '')}</div></div>`;

    // 1. Indicateurs clés — cartes KPI
    body += `<div class="section"><div class="section-title">Indicateurs clés</div><div class="kpis">`
      + kpi('Personnes en parcours', data.nb_en_parcours, null)
      + kpi('Réalisation jalons (échus)', (data.milestones?.global?.taux ?? '—') + ' %', `${data.milestones?.global?.realises_echus || 0}/${data.milestones?.global?.echus || 0} échus`)
      + kpi("Plans d'action en cours", act.total_en_cours || 0, null)
      + kpi(`Sorties dynamiques ${data.annee}`, (s.taux_dynamiques ?? '—') + (s.taux_dynamiques != null ? ' %' : ''), `${s.dynamiques || 0}/${s.total || 0} sorties`)
      + `</div></div>`;

    // 2. Réalisation par échéance — barres
    body += `<div class="section"><div class="section-title">Réalisation des entretiens / bilans par échéance</div>`
      + ms.map((m) => {
        const pct = m.taux_echeance;
        const w = pct == null ? 0 : Math.max(pct, 2);
        return `<div class="bar-row"><div class="bar-label">${esc(m.label || m.type)}</div><div class="bar-bg"><div class="bar-fill" style="width:${w}%;background:${barColor(pct)}"></div></div><div class="bar-val">${pct == null ? 'n/a' : pct + '%'} (${m.realises_echus}/${m.echus})</div></div>`;
      }).join('')
      + `<div class="note">Taux = jalons réalisés parmi ceux dont l'échéance est passée.</div></div>`;

    // 3. Radar des 9 freins + barres
    body += `<div class="section"><div class="section-title">Cartographie consolidée des 9 freins (moyenne /5)</div><div class="two">`
      + `<div style="flex:0 0 250px;text-align:center">${radarSvg(freins)}</div>`
      + `<div style="flex:1">`
      + Object.keys(FREIN_LABELS).map((k) => {
        const v = freins[k]; const pct = v ? (v / 5) * 100 : 0;
        return `<div class="bar-row"><div class="bar-label" style="width:88px">${FREIN_LABELS[k]}</div><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:#0D9488"></div></div><div class="bar-val" style="width:30px">${v != null ? v : '—'}</div></div>`;
      }).join('')
      + `<div class="note">Sur ${data.freins_nb_evalues || 0} salarié(s) évalué(s)${data.frein_dominant ? ` — frein dominant : ${FREIN_LABELS[data.frein_dominant]}` : ''}.</div>`
      + `</div></div></div>`;

    // 4. Sorties & statistiques
    const sortieBox = (v, l, color) => `<div class="statbox"><div class="statv" style="color:${color}">${v}</div><div class="statl">${l}</div></div>`;
    body += `<div class="section"><div class="section-title">Sorties &amp; statistiques (${data.annee})</div><div class="statrow">`
      + sortieBox(s.total || 0, 'Total', '#0f172a') + sortieBox(s.dynamiques || 0, 'Dynamiques', '#16a34a') + sortieBox(s.autres || 0, 'Autres', '#64748b')
      + `</div>`
      + (s.total > 0 ? `<div class="bar-row" style="margin-top:6px"><div class="bar-label">Taux dynamiques</div><div class="bar-bg"><div class="bar-fill" style="width:${s.taux_dynamiques ?? 0}%;background:#16a34a"></div></div><div class="bar-val">${s.taux_dynamiques ?? '—'} %</div></div>` : '')
      + (Object.keys(s.par_type || {}).length ? `<table><tr><th>Type de sortie</th><th style="text-align:right">Nombre</th></tr>${Object.entries(s.par_type).map(([t, n]) => `<tr><td>${esc(t)}</td><td style="text-align:right">${n}</td></tr>`).join('')}</table>` : `<div class="note">Aucune sortie enregistrée sur la période.</div>`)
      + `</div>`;

    // 5. Plans d'action en cours
    body += `<div class="section"><div class="section-title">Plans d'action en cours</div>`
      + `<div style="font-size:20px;font-weight:800;color:#0f172a;margin-bottom:6px">${act.total_en_cours || 0} <span style="font-size:11px;font-weight:400;color:#94a3b8">action(s) active(s)</span></div>`
      + `<div class="two">${miniTable('Par statut', act.par_statut, STATUS_LABELS)}${miniTable('Par catégorie', act.par_categorie, CATEGORY_LABELS)}${miniTable('Par priorité', act.par_priorite, PRIORITY_LABELS)}</div></div>`;

    // 6. Rapport IA
    if (ia) {
      body += `<div class="section brk"><div class="section-title">Rapport IA — Situation globale &amp; public</div>`;
      if (ia.synthese_direction) body += `<div class="card hl"><div class="lbl">Synthèse direction</div>${esc(ia.synthese_direction)}</div>`;
      if (ia.situation_globale) body += `<div class="card"><div class="lbl">Situation globale</div>${esc(ia.situation_globale)}</div>`;
      if (ia.profil_public) body += `<div class="card"><div class="lbl">Profil du public accompagné</div>${esc(ia.profil_public)}</div>`;
      if ((ia.points_forts && ia.points_forts.length) || (ia.points_vigilance && ia.points_vigilance.length)) {
        body += `<div class="two">`
          + `<div style="flex:1"><div class="lbl" style="color:#16a34a">Points forts</div>${li(ia.points_forts)}</div>`
          + `<div style="flex:1"><div class="lbl" style="color:#d97706">Points de vigilance</div>${li(ia.points_vigilance)}</div></div>`;
      }
      if (ia.recommandations_structure && ia.recommandations_structure.length) {
        body += `<div class="lbl" style="margin-top:6px">Recommandations pour la structure</div><table><tr><th>Action</th><th>Objectif</th><th>Échéance</th></tr>`
          + ia.recommandations_structure.map((r) => `<tr><td>${esc(r.action)}</td><td>${esc(r.objectif)}</td><td>${esc(r.echeance_suggeree)}</td></tr>`).join('')
          + `</table>`;
      }
      if (ia.conclusion) body += `<div style="margin-top:6px;font-style:italic;color:#475569">${esc(ia.conclusion)}</div>`;
      if (ia._raw) body += `<div class="card">${esc(ia._raw)}</div>`;
      body += `</div>`;
    }

    body += `<div class="footer">Document confidentiel — données personnelles sensibles (RGPD). Diffusion restreinte direction / CIP.</div>`;

    const w = window.open('', '_blank', 'width=820,height=1100');
    if (!w) { alert('Popup bloquée — autorisez les popups pour exporter le PDF.'); return; }
    w.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>Audit_Insertion_' + data.annee + '</title><style>'
      + '@page { size: A4; margin: 14mm 12mm; } * { box-sizing: border-box; margin: 0; padding: 0; }'
      + "body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.45; }"
      + '.header { background: #0D9488; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }'
      + '.header h1 { font-size: 18px; font-weight: 700; } .header .sub { font-size: 11px; opacity: .9; }'
      + '.section { margin: 12px 0; padding: 0 4px; page-break-inside: avoid; } .brk { page-break-before: auto; }'
      + '.section-title { font-size: 13px; font-weight: 700; color: #0D9488; border-bottom: 2px solid #0D9488; padding-bottom: 3px; margin-bottom: 8px; }'
      + '.kpis { display: flex; gap: 8px; } .kpi { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; background: #fafafa; }'
      + '.kpi .l { font-size: 8px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: .02em; } .kpi .v { font-size: 19px; font-weight: 800; color: #0f172a; line-height: 1.2; } .kpi .s { font-size: 8px; color: #94a3b8; }'
      + '.bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; } .bar-label { width: 130px; font-size: 10px; color: #475569; flex-shrink: 0; }'
      + '.bar-bg { flex: 1; background: #f1f5f9; border-radius: 4px; height: 15px; overflow: hidden; } .bar-fill { height: 15px; border-radius: 4px; } .bar-val { width: 92px; text-align: right; font-size: 9px; color: #64748b; flex-shrink: 0; }'
      + '.two { display: flex; gap: 14px; align-items: flex-start; }'
      + '.statrow { display: flex; gap: 8px; } .statbox { flex: 1; text-align: center; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; } .statv { font-size: 22px; font-weight: 800; } .statl { font-size: 9px; color: #64748b; }'
      + '.mini-h { font-size: 8px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; } .mini-row { display: flex; justify-content: space-between; font-size: 10px; padding: 1px 0; border-bottom: 1px solid #f3f4f6; }'
      + '.card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; white-space: pre-wrap; margin-top: 6px; } .card.hl { background: #F0FDFA; border-color: #99f6e4; }'
      + '.lbl { font-size: 9px; font-weight: 700; color: #0D9488; text-transform: uppercase; margin-bottom: 3px; }'
      + '.note { font-size: 8.5px; color: #9ca3af; margin-top: 4px; }'
      + 'ul { margin: 3px 0 3px 16px; } li { margin: 2px 0; font-size: 10px; }'
      + 'table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }'
      + 'th { background: #f9fafb; text-align: left; padding: 4px 6px; font-weight: 600; color: #6b7280; border-bottom: 1px solid #e5e7eb; }'
      + 'td { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }'
      + '.footer { text-align: center; color: #9ca3af; font-size: 9px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; }'
      + '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'
      + '</style></head><body>' + body + '</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de l'audit insertion..." /></Layout>;

  const ms = data?.milestones?.par_type || [];
  const freins = data?.freins_moyennes || {};
  const s = data?.sorties || {};
  const act = data?.actions || {};
  const yearOptions = [];
  for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 5; y--) yearOptions.push(y);

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader
          title="Audit Insertion"
          subtitle="Synthèse de la situation d'insertion de la structure — direction & CIP"
          icon={ClipboardList}
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button onClick={downloadSynthese} disabled={syntheseLoading}
                title="Synthèse agrégée non nominative pour le comité de pilotage (CSV)"
                className="btn-ghost text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                <Download className="w-4 h-4" /> {syntheseLoading ? 'Export…' : 'Synthèse comité (CSV)'}
              </button>
              {canIa && (
                <button onClick={() => setExportFreinsOpen(true)}
                  title="Export nominatif 23 colonnes — complétude et filtres avant génération (journalisé RGPD)"
                  className="btn-ghost text-sm inline-flex items-center gap-1.5">
                  <Download className="w-4 h-4" /> Tableau des freins…
                </button>
              )}
              <button onClick={printReport} disabled={!data}
                className="btn-ghost text-sm inline-flex items-center gap-1.5">
                <Printer className="w-4 h-4" /> Exporter PDF
              </button>
            </div>
          }
        />

        {error && <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">Impossible de charger l'audit : {error}</div>}
        {syntheseError && <div className="mb-4 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{syntheseError}</div>}

        {data && (
          <div className="space-y-6">
            {/* 0. Indicateurs conventionnels (EXG-47/D12) — EN TÊTE : réalisé vs
                cibles de l'annexe financière, ETP « contrôle ERP », typologies,
                délai diagnostic, PMSMP, satisfaction, encart CVG. */}
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Target className="w-4 h-4 text-teal-600" /> Indicateurs conventionnels ({data.annee})</h3>
                {canIa && (
                  <button onClick={() => setCiblesOpen(true)}
                    className="text-xs text-teal-700 hover:underline inline-flex items-center gap-1">
                    <Pencil className="w-3.5 h-3.5" /> Paramétrer les cibles
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mb-3">{data.conventionnel?.methode || 'Taux calculés sur les sorties constatées de l\'année civile.'}</p>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <CibleCard label="Sorties dynamiques" realise={data.conventionnel?.taux_realises?.dynamiques}
                  cible={data.conventionnel?.cibles?.cible_taux_dynamiques} ecart={data.conventionnel?.ecarts?.dynamiques}
                  sub={`${s.dynamiques || 0}/${s.total || 0} sorties constatées`} />
                <CibleCard label="Emploi durable" realise={data.conventionnel?.taux_realises?.emploi_durable}
                  cible={data.conventionnel?.cibles?.cible_taux_durable} ecart={data.conventionnel?.ecarts?.emploi_durable} />
                <CibleCard label="Emploi de transition" realise={data.conventionnel?.taux_realises?.emploi_transition}
                  cible={data.conventionnel?.cibles?.cible_taux_transition} ecart={data.conventionnel?.ecarts?.emploi_transition} />
                <CibleCard label="Autres sorties positives" realise={data.conventionnel?.taux_realises?.sortie_positive}
                  cible={data.conventionnel?.cibles?.cible_taux_positive} ecart={data.conventionnel?.ecarts?.sortie_positive} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* ETP réalisés — approximation ERP, source officielle ASP TOUJOURS visible */}
                <div className="rounded-xl border border-gray-200 p-3 sm:col-span-1">
                  <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">ETP réalisés (approché)</div>
                  <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                    <span className="text-2xl font-bold text-gray-800">{data.etp_realises_approx?.valeur ?? '—'}</span>
                    {data.conventionnel?.cibles?.cible_etp_conventionnes != null && data.conventionnel?.ecarts?.etp != null && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${data.conventionnel.ecarts.etp >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {data.conventionnel.ecarts.etp >= 0 ? '+' : ''}{data.conventionnel.ecarts.etp} ETP
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-0.5">
                    {data.conventionnel?.cibles?.cible_etp_conventionnes != null
                      ? <span className="text-gray-500">Cible conventionnée : <strong>{data.conventionnel.cibles.cible_etp_conventionnes} ETP</strong></span>
                      : <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">objectif non paramétré</span>}
                    <span className="text-gray-400"> · {data.etp_realises_approx?.nb_cddi_actifs ?? 0} CDDI actifs</span>
                  </div>
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-1 mt-1.5">
                    {data.etp_realises_approx?.note || 'Contrôle ERP — la saisie officielle des ETP reste celle des états mensuels de présence ASP.'}
                  </p>
                </div>

                {/* Délai moyen du diagnostic */}
                <div className="rounded-xl border border-gray-200 p-3">
                  <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Délai moyen du diagnostic d'accueil</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-2xl font-bold ${data.delai_moyen_diagnostic_jours == null ? 'text-gray-800' : data.delai_moyen_diagnostic_jours <= delaiCible ? 'text-green-700' : 'text-red-600'}`}>
                      {data.delai_moyen_diagnostic_jours != null ? `${data.delai_moyen_diagnostic_jours} j` : '—'}
                    </span>
                    <span className="text-[11px] text-gray-400">cible ≤ {delaiCible} j</span>
                  </div>
                  {data.delai_moyen_diagnostic_jours != null && (
                    <div className="mt-1.5"><Bar pct={Math.min(100, (delaiCible / Math.max(data.delai_moyen_diagnostic_jours, 1)) * 100)} tone={data.delai_moyen_diagnostic_jours <= delaiCible ? 'green' : 'red'} /></div>
                  )}
                  <p className="text-[10px] text-gray-400 mt-1">Jours entre l'entrée en parcours et le diagnostic réalisé (diagnostics de l'année).</p>
                </div>

                {/* PMSMP + satisfaction de l'année */}
                <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                  <div>
                    <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">PMSMP {data.annee}</div>
                    <p className="text-sm text-gray-700 mt-0.5">
                      <span className="text-xl font-bold text-gray-800">{data.pmsmp?.nb ?? 0}</span> convention(s)
                      <span className="text-gray-400"> · {data.pmsmp?.jours ?? 0} j · {data.pmsmp?.nb_salaries ?? 0} salarié(s)</span>
                    </p>
                  </div>
                  <div className="border-t pt-1.5">
                    <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Satisfaction de sortie</div>
                    <p className="text-sm text-gray-700 mt-0.5">
                      {data.satisfaction?.nb_reponses ? (
                        <><span className="text-xl font-bold text-gray-800">{data.satisfaction.moyenne_globale ?? '—'}</span><span className="text-gray-400"> /4 · {data.satisfaction.nb_reponses} réponse(s)</span></>
                      ) : <span className="text-gray-400">Aucune réponse enregistrée</span>}
                    </p>
                  </div>
                </div>
              </div>

              {/* Typologies des publics (non nominatif) */}
              <div className="grid sm:grid-cols-3 gap-4 mt-4 border-t pt-3">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Public accompagné</p>
                  <p className="text-sm text-gray-700"><span className="text-xl font-bold text-gray-800">{data.typologies?.effectif ?? 0}</span> en parcours</p>
                  <p className="text-sm text-gray-700 mt-1"><span className="text-xl font-bold text-gray-800">{data.typologies?.rqth ?? 0}</span> RQTH</p>
                  <div className="mt-2">
                    <MiniBars title="Tranches d'âge" data={data.typologies?.tranches_age} emptyLabel="Dates de naissance non renseignées" />
                  </div>
                </div>
                <MiniBars title="Ressources à l'entrée" data={data.typologies?.ressources} emptyLabel="Rubrique budget des diagnostics vide" />
                <MiniBars title="Niveaux de formation" data={data.typologies?.niveaux_formation} emptyLabel="Niveaux non renseignés au diagnostic" />
              </div>

              {/* Encart CVG — réservé, en attente de la trame direction */}
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
                <strong>Programme Convergence (CVG)</strong> — en attente de la trame de reporting (direction).
                {data.cvg?.note ? ` ${data.cvg.note}` : ''}
              </div>
            </div>

            {/* 1. Indicateurs clés */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={Users} label="Personnes en parcours" value={data.nb_en_parcours} tone="blue" />
              <StatCard icon={ListChecks} label="Réalisation jalons (échus)" value={data.milestones?.global?.taux != null ? `${data.milestones.global.taux} %` : '—'} sub={`${data.milestones?.global?.realises_echus || 0}/${data.milestones?.global?.echus || 0} échus réalisés`} tone="teal" />
              <StatCard icon={Target} label="Plans d'action en cours" value={act.total_en_cours || 0} tone="amber" />
              <StatCard icon={LogOut} label={`Sorties dynamiques ${data.annee}`} value={s.taux_dynamiques != null ? `${s.taux_dynamiques} %` : '—'} sub={`${s.dynamiques || 0}/${s.total || 0} sorties`} tone="green" />
            </div>

            {/* 2. Réalisation par échéance */}
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Réalisation des entretiens / bilans par échéance</h3>
              <div className="space-y-3">
                {ms.map((m) => (
                  <div key={m.type} className="flex items-center gap-3">
                    <div className="w-40 text-sm text-gray-600 shrink-0">{m.label || m.type}</div>
                    <div className="flex-1"><Bar pct={m.taux_echeance ?? 0} tone={m.taux_echeance == null ? 'teal' : m.taux_echeance >= 80 ? 'green' : m.taux_echeance >= 50 ? 'amber' : 'red'} /></div>
                    <div className="w-28 text-right text-xs text-gray-500 shrink-0">
                      {m.taux_echeance != null ? <span className="font-semibold text-gray-700">{m.taux_echeance}%</span> : <span className="text-gray-400">n/a</span>}
                      {' '}({m.realises_echus}/{m.echus})
                    </div>
                  </div>
                ))}
                {ms.every((m) => m.echus === 0) && <p className="text-sm text-gray-400">Aucun jalon échu sur le périmètre.</p>}
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Taux = jalons réalisés parmi ceux dont l'échéance est passée.</p>
            </div>

            {/* 3. Radar freins + 5. Sorties */}
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold text-gray-800 mb-2">Cartographie consolidée des 9 freins</h3>
                <p className="text-[11px] text-gray-400 mb-2">Moyenne cohorte (/5) sur {data.freins_nb_evalues || 0} salarié(s) évalué(s){data.frein_dominant ? ` — frein dominant : ${FREIN_LABELS[data.frein_dominant]}` : ''}.</p>
                <FreinsRadar moyennes={freins} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
                  {Object.keys(FREIN_LABELS).map((k) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-gray-500">{FREIN_LABELS[k]}</span>
                      <span className="font-semibold text-gray-700">{freins[k] != null ? freins[k] : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold text-gray-800 mb-3">Sorties &amp; statistiques ({data.annee})</h3>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center"><div className="text-2xl font-bold text-gray-800">{s.total || 0}</div><div className="text-xs text-gray-500">Total</div></div>
                  <div className="text-center"><div className="text-2xl font-bold text-green-600">{s.dynamiques || 0}</div><div className="text-xs text-gray-500">Dynamiques</div></div>
                  <div className="text-center"><div className="text-2xl font-bold text-gray-400">{s.autres || 0}</div><div className="text-xs text-gray-500">Autres</div></div>
                </div>
                {s.total > 0 && (
                  <>
                    <Bar pct={s.taux_dynamiques ?? 0} tone="green" />
                    <p className="text-xs text-gray-500 mt-1 mb-3">Taux de sorties dynamiques : <span className="font-semibold text-gray-700">{s.taux_dynamiques ?? '—'} %</span></p>
                  </>
                )}
                <div className="space-y-1">
                  {Object.keys(s.par_type || {}).length ? Object.entries(s.par_type).map(([t, n]) => (
                    <div key={t} className="flex justify-between text-sm border-b border-gray-50 py-1"><span className="text-gray-600">{t}</span><span className="font-medium text-gray-700">{n}</span></div>
                  )) : <p className="text-sm text-gray-400">Aucune sortie enregistrée sur la période.</p>}
                </div>
              </div>
            </div>

            {/* 4. Plans d'action en cours */}
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-gray-800 mb-1">Plans d'action en cours</h3>
              <p className="text-3xl font-bold text-gray-800 mb-4">{act.total_en_cours || 0}<span className="text-sm font-normal text-gray-400 ml-2">action(s) active(s)</span></p>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Par statut</p>
                  {Object.entries(act.par_statut || {}).map(([k, n]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{STATUS_LABELS[k] || k}</span><span className="font-medium">{n}</span></div>)}
                  {!Object.keys(act.par_statut || {}).length && <span className="text-sm text-gray-400">—</span>}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Par catégorie</p>
                  {Object.entries(act.par_categorie || {}).map(([k, n]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{CATEGORY_LABELS[k] || k}</span><span className="font-medium">{n}</span></div>)}
                  {!Object.keys(act.par_categorie || {}).length && <span className="text-sm text-gray-400">—</span>}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Par priorité</p>
                  {Object.entries(act.par_priorite || {}).map(([k, n]) => <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{PRIORITY_LABELS[k] || k}</span><span className="font-medium">{n}</span></div>)}
                  {!Object.keys(act.par_priorite || {}).length && <span className="text-sm text-gray-400">—</span>}
                </div>
              </div>
            </div>

            {/* 6. Rapport IA */}
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" /> Rapport IA — situation globale &amp; public</h3>
                {canIa && (
                  <button onClick={generateIa} disabled={iaLoading}
                    className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
                    {iaLoading ? 'Génération… (jusqu\'à 1 min)' : ia ? 'Régénérer' : 'Générer le rapport IA'}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Rédige une synthèse de la situation globale de la structure à partir des indicateurs chiffrés ci-dessus <strong>et</strong> des verbatims anonymisés des CIP/agents (observations, bilans, notes d'actions). Destinée à la direction et aux CIP.
              </p>
              {!canIa && <p className="text-xs text-gray-400">Génération réservée aux profils ADMIN / RH.</p>}
              {iaError && <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{iaError}</div>}

              {ia && (
                <div className="space-y-3">
                  {ia._tronque && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-2">Rapport tronqué (limite de longueur du modèle atteinte) — le contenu peut être incomplet.</div>}
                  {ia.synthese_direction && (
                    <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-violet-700 mb-1">Synthèse direction</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{ia.synthese_direction}</p>
                    </div>
                  )}
                  {ia.situation_globale && (
                    <div><p className="text-xs font-semibold text-gray-500 uppercase mb-1">Situation globale</p><p className="text-sm text-slate-700 whitespace-pre-wrap">{ia.situation_globale}</p></div>
                  )}
                  {ia.profil_public && (
                    <div><p className="text-xs font-semibold text-gray-500 uppercase mb-1">Profil du public accompagné</p><p className="text-sm text-slate-700 whitespace-pre-wrap">{ia.profil_public}</p></div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {Array.isArray(ia.points_forts) && ia.points_forts.length > 0 && (
                      <div><p className="text-xs font-semibold text-green-600 uppercase mb-1">Points forts</p><ul className="list-disc list-inside text-sm text-slate-700 space-y-1">{ia.points_forts.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                    )}
                    {Array.isArray(ia.points_vigilance) && ia.points_vigilance.length > 0 && (
                      <div><p className="text-xs font-semibold text-amber-600 uppercase mb-1">Points de vigilance</p><ul className="list-disc list-inside text-sm text-slate-700 space-y-1">{ia.points_vigilance.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                    )}
                  </div>
                  {Array.isArray(ia.recommandations_structure) && ia.recommandations_structure.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Recommandations pour la structure</p>
                      <div className="space-y-2">
                        {ia.recommandations_structure.map((r, i) => (
                          <div key={i} className="border border-gray-200 rounded-lg p-3">
                            <p className="text-sm font-medium text-gray-800">{r.action}</p>
                            {r.objectif && <p className="text-xs text-gray-500 mt-0.5">Objectif : {r.objectif}</p>}
                            {r.echeance_suggeree && <p className="text-xs text-gray-400 mt-0.5">Échéance suggérée : {r.echeance_suggeree}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {ia.conclusion && (
                    <div className="border-t pt-2"><p className="text-sm italic text-slate-600 whitespace-pre-wrap">{ia.conclusion}</p></div>
                  )}
                  {/* Filet de sécurité : jamais silencieux si le format est inattendu */}
                  {!ia.synthese_direction && !ia.situation_globale && !ia.profil_public
                    && !(ia.points_forts?.length) && !(ia.points_vigilance?.length)
                    && !(ia.recommandations_structure?.length) && !ia.conclusion && (
                    <pre className="text-xs whitespace-pre-wrap text-slate-600 bg-gray-50 border rounded p-3">{ia._raw || (typeof ia === 'string' ? ia : JSON.stringify(ia, null, 2))}</pre>
                  )}
                </div>
              )}
              {!ia && !iaError && canIa && <p className="text-sm text-gray-400">Cliquez sur « Générer le rapport IA » pour produire la synthèse. Le rapport peut ensuite être exporté en PDF pour la direction.</p>}
            </div>
          </div>
        )}

        {/* Modales : cibles conventionnelles + export freins */}
        {ciblesOpen && (
          <CiblesForm onClose={() => setCiblesOpen(false)} onSaved={() => { setCiblesOpen(false); load(); }} />
        )}
        {exportFreinsOpen && (
          <ExportFreinsModal year={year} onClose={() => setExportFreinsOpen(false)} />
        )}
      </div>
    </Layout>
  );
}
