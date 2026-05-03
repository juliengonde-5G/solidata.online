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

  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headerLine = lines[0];
    const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

    return lines
      .slice(1)
      .map((line) => {
        const values = line.split(',').map((v) => v.trim());
        const obj = {};
        headers.forEach((header, i) => {
          if (header === 'malibou_id' || header === 'id') obj.malibou_id = values[i];
          else if (header === 'prénom' || header === 'first_name') obj.first_name = values[i];
          else if (header === 'nom' || header === 'last_name') obj.last_name = values[i];
          else if (header === 'poste' || header === 'position') obj.position = values[i];
          else if (header === 'type de contrat' || header === 'contract_type') obj.contract_type = values[i];
          else if (header === 'sexe' || header === 'gender') obj.gender = values[i];
        });
        return obj;
      })
      .filter((obj) => obj.first_name && obj.last_name);
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

        <Section title="Format attendu" icon={FileText}>
          <p className="text-sm text-slate-600 mb-3">
            Le CSV doit avoir les colonnes suivantes (avec ces en-têtes ou leurs variantes anglaises) :
          </p>
          <ul className="list-disc list-inside text-sm text-slate-600 space-y-1.5">
            <li><code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">malibou_id</code> ou <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">ID</code></li>
            <li><code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">prénom</code> ou <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">first_name</code></li>
            <li><code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">nom</code> ou <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">last_name</code></li>
            <li><code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">poste</code> ou <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">position</code></li>
            <li><code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">type de contrat</code> ou <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">contract_type</code> (CDI, CDD, Apprentissage)</li>
          </ul>
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
