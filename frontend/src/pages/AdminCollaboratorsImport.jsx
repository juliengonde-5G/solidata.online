import { useState } from 'react';
import { Upload, FileText, FileSpreadsheet, AlertCircle, CheckCircle2, RefreshCw, Users, Trash2 } from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader, Section } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

export default function AdminCollaboratorsImport() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [mode, setMode] = useState('xlsx'); // 'xlsx' | 'csv'
  const [file, setFile] = useState(null);
  const [csvText, setCsvText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dedupeMsg, setDedupeMsg] = useState('');

  // ── Parseur CSV (copier-coller d'une feuille Malibou) ─────────────────────
  const parseFRDate = (s) => {
    if (!s) return null;
    const t = s.trim();
    if (!t) return null;
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!m) return null;
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  };

  const normalizeHeader = (h) =>
    (h || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

  const ouiNon = (v) => {
    const u = (v || '').trim().toLowerCase();
    if (['oui', 'o', 'true', '1', 'vrai'].includes(u)) return true;
    if (['non', 'n', 'false', '0', 'faux'].includes(u)) return false;
    return undefined;
  };

  const parseCSV = (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    const firstLine = trimmed.split(/\r?\n/, 1)[0] || '';
    const sep = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(sep).map(normalizeHeader);

    return lines.slice(1).map((line) => {
      const values = line.split(sep).map((v) => v.trim());
      const obj = {};
      headers.forEach((header, i) => {
        const v = values[i] || '';
        const set = (k, val) => { if (val !== '' && val != null) obj[k] = val; };
        switch (header) {
          case 'matricule': case 'identifiant malibou': case 'malibou_id': case 'id': set('malibou_id', v); break;
          case 'prenom': case 'first_name': set('first_name', v); break;
          case 'nom': case 'last_name': set('last_name', v); break;
          case 'nom de naissance': case 'birth_name': set('birth_name', v); break;
          case 'civilite': set('civility', v); break;
          case 'sexe': case 'genre': case 'gender': {
            const u = v.toUpperCase();
            set('gender', u === 'F' || u === 'FEMME' ? 'F' : u === 'M' || u === 'H' || u === 'HOMME' ? 'M' : v);
            break;
          }
          case 'date de naissance': case 'birth_date': set('birth_date', parseFRDate(v)); break;
          case 'ville de naissance': set('birth_city', v); break;
          case 'pays de naissance': set('birth_country', v); break;
          case 'dep. de naissance': case 'departement de naissance': set('birth_department', v); break;
          case 'nationalite': case 'nationality': set('nationality', v); break;
          case 'email': set('email', v); break;
          case 'email secondaire': case 'adresse mail personnelle': case 'mail personnel': case 'personal_email': set('personal_email', v); break;
          case 'telephone': case 'phone': set('phone', v); break;
          case 'adresse': set('address', v); break;
          case 'ville': set('city', v); break;
          case 'code postal': set('postal_code', v); break;
          case 'pays': set('country', v); break;
          case 'statut handicap': set('disability_status', v); break;
          case 'titre de sejour': set('residence_permit_type', v); break;
          case 'n° de titre de sejour': case 'no de titre de sejour': set('residence_permit_number', v); break;
          case 'renouvellement titre de sejour': set('residence_permit_renewal', v); break;
          case 'poste': case 'intitule de poste': case 'position': set('position', v); break;
          case 'type de contrat': case 'contract_type': set('contract_type', v); break;
          case 'qualification': set('qualification', v); break;
          case 'derniere visite medicale': case 'date de derniere visite medicale': case 'last_medical_visit': set('last_medical_visit', parseFRDate(v)); break;
          case 'frequence visite medicale': set('medical_visit_frequency', v); break;
          case 'anciennete': set('seniority_date', parseFRDate(v)); break;
          case 'matricule du responsable': set('manager_malibou_id', v); break;
          case 'equipe': set('equipe_label', v); break;
          case 'contrat actif': { const b = ouiNon(v); if (b !== undefined) obj.is_active = b; break; }
          default: break;
        }
      });
      return obj;
    }).filter((obj) => obj.first_name && obj.last_name);
  };

  const onFilePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null); setError('');
    if (mode === 'csv') {
      const reader = new FileReader();
      reader.onload = (ev) => setCsvText(ev.target?.result?.toString() || '');
      reader.readAsText(f);
    } else {
      setFile(f);
    }
  };

  // ── Import XLSX (export complet Malibou) ──────────────────────────────────
  const handleXlsxImport = async () => {
    if (!file) return;
    try {
      setError(''); setResult(null); setLoading(true);
      const fd = new FormData();
      fd.append('file', file);
      const response = await api.post('/employees/import/xlsx', fd);
      setResult(response.data);
      setFile(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Import CSV (copier-coller) ────────────────────────────────────────────
  const handleCsvImport = async () => {
    try {
      setError(''); setResult(null); setLoading(true);
      const collaborators = parseCSV(csvText);
      if (collaborators.length === 0) {
        setError('Aucun collaborateur valide trouvé dans le CSV');
        setLoading(false);
        return;
      }
      const response = await api.post('/employees/import/csv', { collaborators });
      setResult(response.data);
      setCsvText('');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Nettoyage des doublons inactifs hérités ───────────────────────────────
  const handleDedupe = async () => {
    const ok = await confirm({
      title: 'Nettoyer les doublons inactifs ?',
      message: "Supprime les fiches inactives sans matricule qui font doublon d'un collaborateur actif homonyme (héritées des anciens imports). Les fiches rattachées à un historique métier sont conservées.",
      confirmLabel: 'Nettoyer',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      setDedupeMsg(''); setError('');
      const r = await api.post('/employees/import/dedupe-ghosts');
      setDedupeMsg(r.data.message);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const nbCreated = result?.created?.length || 0;
  const nbUpdated = result?.updated?.length || 0;

  return (
    <Layout>
      <div className="space-y-6">
        {ConfirmDialogElement}
        <PageHeader
          title="Import de collaborateurs"
          subtitle="Synchronisation de la base employés depuis l'export du logiciel de gestion (Malibou)"
          icon={Upload}
        />

        {/* Bandeau anti-doublon */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 text-sm">
          <RefreshCw className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Import intelligent, sans doublon.</p>
            <p className="text-teal-700 mt-0.5">
              Les collaborateurs déjà présents sont <strong>mis à jour</strong> (appariement par matricule puis nom/prénom) ;
              seuls les <strong>nouveaux</strong> sont créés. Réimporter le même fichier ne duplique plus rien.
            </p>
          </div>
        </div>

        {/* Sélecteur de mode */}
        <div className="flex gap-2">
          <button
            onClick={() => { setMode('xlsx'); setResult(null); setError(''); }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${mode === 'xlsx' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            <FileSpreadsheet className="w-4 h-4" /> Fichier Excel Malibou (recommandé)
          </button>
          <button
            onClick={() => { setMode('csv'); setResult(null); setError(''); }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${mode === 'csv' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            <FileText className="w-4 h-4" /> Copier-coller CSV
          </button>
        </div>

        {mode === 'xlsx' ? (
          <Section title="Importer l'export complet (.xlsx)" icon={FileSpreadsheet}>
            <p className="text-sm text-slate-600 mb-3">
              Déposez le classeur exporté depuis Malibou tel quel. Les feuilles <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">Informations salariés</code>
              {' '}et <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">Contrats</code> sont lues automatiquement (identité, coordonnées, naissance, poste, contrat, horaires, conformité IAE).
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium cursor-pointer">
                <Upload className="w-4 h-4" />
                {file ? 'Changer de fichier' : 'Sélectionner le fichier .xlsx'}
                <input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFilePick} className="sr-only" />
              </label>
              {file && <span className="text-sm text-slate-600 inline-flex items-center gap-1"><FileSpreadsheet className="w-4 h-4 text-teal-600" /> {file.name}</span>}
              <button
                onClick={handleXlsxImport}
                disabled={loading || !file}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loading ? 'Import en cours…' : 'Importer / Synchroniser'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-3 italic">
              Confidentialité : le n° de sécurité sociale, l'IBAN et le BIC présents dans l'export ne sont pas importés (données de paie, hors périmètre ERP).
            </p>
          </Section>
        ) : (
          <Section title="Coller le contenu CSV" icon={FileText}>
            <p className="text-sm text-slate-600 mb-3">
              Copiez-collez une feuille (séparateur <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">;</code> ou <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">,</code>).
              En-têtes FR (Malibou) et EN reconnus, accents tolérés. Le vrai matricule (<code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">Matricule</code>) sert de clé anti-doublon.
            </p>
            <div className="flex items-center gap-3 mb-3">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium cursor-pointer">
                <Upload className="w-4 h-4" /> Charger un .csv
                <input type="file" accept=".csv,text/csv" onChange={onFilePick} className="sr-only" />
              </label>
              <span className="text-xs text-slate-400">ou collez ci-dessous</span>
            </div>
            <textarea
              className="w-full h-40 p-4 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Matricule;Prénom;Nom;Email;Téléphone;Adresse;..."
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              disabled={loading}
            />
            <button
              onClick={handleCsvImport}
              disabled={loading || !csvText.trim()}
              className="mt-3 inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? 'Import en cours…' : 'Importer / Synchroniser'}
            </button>
          </Section>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <Section title="Résultat de la synchronisation" icon={CheckCircle2}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Créés" value={nbCreated} tone="green" />
                <StatCard label="Mis à jour" value={nbUpdated} tone="blue" />
                <StatCard label="Erreurs" value={result.errors?.length || 0} tone={result.errors?.length ? 'red' : 'slate'} />
                <StatCard label="Total traité" value={result.total || 0} tone="slate" />
              </div>

              {(nbCreated > 0 || nbUpdated > 0) && (
                <div>
                  <h3 className="font-semibold text-sm mb-2 text-slate-700">Détail</h3>
                  <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-slate-500 bg-slate-50 border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="p-2 text-left">État</th>
                          <th className="p-2 text-left">Matricule</th>
                          <th className="p-2 text-left">Prénom</th>
                          <th className="p-2 text-left">Nom</th>
                          <th className="p-2 text-left">Poste</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...(result.created || []).map((e) => ({ ...e, _s: 'Créé' })),
                          ...(result.updated || []).map((e) => ({ ...e, _s: 'Mis à jour' }))].map((emp, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="p-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${emp._s === 'Créé' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{emp._s}</span>
                            </td>
                            <td className="p-2 text-slate-500">{emp.malibou_id || '—'}</td>
                            <td className="p-2">{emp.first_name}</td>
                            <td className="p-2">{emp.last_name}</td>
                            <td className="p-2 text-slate-600">{emp.position || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.errors && result.errors.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-2 text-red-600">Erreurs ({result.errors.length})</h3>
                  <div className="max-h-52 overflow-y-auto border border-red-200 rounded-lg">
                    <table className="w-full text-sm">
                      <tbody>
                        {result.errors.map((err, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="p-2 font-medium">{err.collaborator}</td>
                            <td className="p-2 text-red-600">{err.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Maintenance : nettoyage des doublons hérités */}
        <Section title="Maintenance — doublons hérités" icon={Users}>
          <p className="text-sm text-slate-600 mb-3">
            Les imports précédents (méthode « tout remplacer ») ont pu laisser des fiches <strong>inactives en double</strong>.
            Ce nettoyage supprime uniquement ces fantômes sans matricule qui font doublon d'un collaborateur actif ;
            toute fiche liée à un historique (tournées, pointages…) est conservée.
          </p>
          {dedupeMsg && (
            <div className="flex items-start gap-2 p-3 mb-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{dedupeMsg}</span>
            </div>
          )}
          <button
            onClick={handleDedupe}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm font-semibold hover:bg-amber-200 transition"
          >
            <Trash2 className="w-4 h-4" /> Nettoyer les doublons inactifs
          </button>
        </Section>
      </div>
    </Layout>
  );
}

function StatCard({ label, value, tone }) {
  const tones = {
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-600',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone] || tones.slate}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wide">{label}</div>
    </div>
  );
}
