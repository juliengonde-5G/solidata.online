import { useState } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader, Section } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

export default function AdminCollaboratorsImport() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [csvText, setCsvText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Convertit DD/MM/YYYY ou D/M/YY → YYYY-MM-DD ; renvoie null si invalide
  const parseFRDate = (s) => {
    if (!s) return null;
    const t = s.trim();
    if (!t) return null;
    const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!m) return null;
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  };

  const normalizeHeader = (h) =>
    (h || '')
      .trim()
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
      .replace(/\s+/g, ' ');

  const parseCSV = (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    // Détection auto du séparateur sur la 1re ligne (priorité : ; > , > tab)
    const firstLine = trimmed.split(/\r?\n/, 1)[0] || '';
    const sep = firstLine.includes(';') ? ';'
      : firstLine.includes('\t') ? '\t'
      : ',';

    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(sep).map(normalizeHeader);

    return lines.slice(1).map((line) => {
      const values = line.split(sep).map((v) => v.trim());
      const obj = {};
      headers.forEach((header, i) => {
        const v = values[i] || '';
        // Identifiants
        if (header === 'identifiant malibou' || header === 'malibou_id' || header === 'id') obj.malibou_id = v;
        // Identité
        else if (header === 'prenom' || header === 'first_name') obj.first_name = v;
        else if (header === 'nom' || header === 'last_name') obj.last_name = v;
        else if (header === 'nom de naissance' || header === 'birth_name') obj.birth_name = v;
        else if (header === 'sexe' || header === 'gender') {
          // Normalisation : F / M / Autre
          const u = v.toUpperCase();
          obj.gender = u === 'F' || u === 'FEMME' || u === 'FEMININ' ? 'F'
            : u === 'M' || u === 'H' || u === 'HOMME' || u === 'MASCULIN' ? 'M'
            : v;
        }
        else if (header === 'date de naissance' || header === 'birth_date') obj.birth_date = parseFRDate(v);
        else if (header === 'nationalite' || header === 'nationality') obj.nationality = v;
        // Contrat
        else if (header === 'poste' || header === 'position') obj.position = v;
        else if (header === 'type de contrat' || header === 'contract_type') obj.contract_type = v;
        else if (header === 'qualification') obj.qualification = v;
        // Suivi
        else if (
          header === 'date de derniere visite medicale' ||
          header === 'derniere visite medicale' ||
          header === 'last_medical_visit'
        ) obj.last_medical_visit = parseFRDate(v);
        else if (
          header === 'adresse mail personnelle' ||
          header === 'mail personnel' ||
          header === 'email personnel' ||
          header === 'personal_email'
        ) obj.personal_email = v;
        // Champ legacy (rétro-compat ancien CSV à 6 colonnes)
        else if (header === 'sexe') obj.gender = v;
      });
      return obj;
    }).filter((obj) => obj.first_name && obj.last_name);
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result?.toString() || '');
    reader.readAsText(file);
  };

  const handleImport = async () => {
    try {
      setError('');
      setLoading(true);

      const collaborators = parseCSV(csvText);
      if (collaborators.length === 0) {
        setError('Aucun collaborateur valide trouvé dans le CSV');
        setLoading(false);
        return;
      }

      const confirmDelete = await confirm({
        title: 'Remplacer tous les collaborateurs ?',
        message: `Vous allez supprimer tous les employés existants et importer ${collaborators.length} nouveaux collaborateurs. Cette action est irréversible.`,
        confirmLabel: 'Remplacer',
        confirmVariant: 'danger',
      });

      if (!confirmDelete) {
        setLoading(false);
        return;
      }

      await api.delete('/employees/clear');
      const response = await api.post('/employees/import/csv', { collaborators });

      setResult(response.data);
      setCsvText('');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {ConfirmDialogElement}
        <PageHeader
          title="Import de collaborateurs"
          subtitle="Remplacement complet de la base employés depuis un fichier CSV"
          icon={Upload}
        />

        <Section title="Format attendu (export Malibou)" icon={FileText}>
          <p className="text-sm text-slate-600 mb-3">
            Séparateur <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">;</code> (point-virgule).
            Les en-têtes <strong>FR</strong> (export Malibou) et <strong>EN</strong> sont reconnus, accents tolérés.
          </p>
          <div className="bg-slate-50 rounded-lg p-3 mb-3 overflow-x-auto">
            <code className="text-[11px] text-slate-700 whitespace-pre">Identifiant malibou;Prénom;Nom;Nom de naissance;Sexe;Date de naissance;Nationalité;Poste;Type de contrat;Qualification;Date de dernière Visite médicale;Adresse mail personnelle</code>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 text-xs text-slate-600">
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Identifiant malibou</code> — id Malibou</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Prénom / Nom / Nom de naissance</code></li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Sexe</code> — F / M</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Date de naissance</code> — JJ/MM/AAAA</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Nationalité</code></li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Poste</code> — libellé fonction</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Type de contrat</code> — CDI / CDD / Apprentissage</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Qualification</code> — texte libre (ex: <em>Niveau: C, Coefficient: 345</em>)</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Date de dernière Visite médicale</code> — JJ/MM/AAAA, optionnel</li>
            <li><code className="bg-slate-100 px-1.5 py-0.5 rounded">Adresse mail personnelle</code> — optionnel</li>
          </ul>
          <p className="text-xs text-slate-400 mt-3 italic">
            Les colonnes manquantes ou vides sont ignorées. L'ancien format CSV (6 colonnes, séparateur <code>,</code>) reste compatible.
          </p>
        </Section>

        <Section title="Importer un fichier" icon={Upload}>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium cursor-pointer">
                <Upload className="w-4 h-4" />
                Sélectionner un fichier CSV
                <input type="file" accept=".csv,text/csv" onChange={onFileChange} className="sr-only" />
              </label>
              <span className="text-xs text-slate-400">ou collez le contenu CSV ci-dessous</span>
            </div>

            <textarea
              className="w-full h-48 p-4 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="malibou_id,prénom,nom,poste,type de contrat..."
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              disabled={loading}
            />

            <button
              onClick={handleImport}
              disabled={loading || !csvText.trim()}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? 'Import en cours…' : 'Importer'}
            </button>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </Section>

        {result && (
          <Section title="Résultat de l'import" icon={CheckCircle2}>
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{result.message}</span>
              </div>

              {result.created && result.created.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-2 text-slate-700">Collaborateurs importés ({result.created.length})</h3>
                  <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="p-2 text-left">Prénom</th>
                          <th className="p-2 text-left">Nom</th>
                          <th className="p-2 text-left">Poste</th>
                          <th className="p-2 text-left">Type contrat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.created.map((emp, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="p-2">{emp.first_name}</td>
                            <td className="p-2">{emp.last_name}</td>
                            <td className="p-2">{emp.position}</td>
                            <td className="p-2">{emp.contract_type}</td>
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
                  <div className="max-h-64 overflow-y-auto border border-red-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-red-700 bg-red-50 border-b border-red-200">
                        <tr>
                          <th className="p-2 text-left">Collaborateur</th>
                          <th className="p-2 text-left">Erreur</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.errors.map((err, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="p-2">{err.collaborator}</td>
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
      </div>
    </Layout>
  );
}
