import React, { useState } from 'react';
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
    const headers = headerLine.split(',').map(h => h.trim().toLowerCase());

    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const obj = {};

      headers.forEach((header, i) => {
        if (header === 'malibou_id') obj.malibou_id = values[i];
        else if (header === 'prénom' || header === 'first_name') obj.first_name = values[i];
        else if (header === 'nom' || header === 'last_name') obj.last_name = values[i];
        else if (header === 'poste' || header === 'position') obj.position = values[i];
        else if (header === 'type de contrat' || header === 'contract_type') obj.contract_type = values[i];
        else if (header === 'sexe' || header === 'gender') obj.gender = values[i];
      });

      return obj;
    }).filter(obj => obj.first_name && obj.last_name);
  };

  const handleImport = async () => {
    try {
      setError('');
      setLoading(true);

      const collaborators = parseCSV(csvText);
      if (collaborators.length === 0) {
        setError('Aucun collaborateur valide trouvé dans le CSV');
        return;
      }

      // Supprimer les employés existants
      const confirmDelete = await confirm({
        title: 'Remplacer tous les collaborateurs ?',
        message: `Vous allez supprimer tous les employés existants et importer ${collaborators.length} nouveaux collaborateurs. Cette action est irréversible.`,
        confirmLabel: 'Remplacer',
        confirmVariant: 'danger',
      });

      if (!confirmDelete) return;

      // Supprimer les employés
      await api.delete('/api/employees/clear');

      // Importer les nouveaux collaborateurs
      const response = await api.post('/api/employees/import/csv', { collaborators });

      setResult(response.data);
      setCsvText('');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {ConfirmDialogElement}
      <h1 className="text-3xl font-bold mb-6">Import de Collaborateurs</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Format du CSV</h2>
        <p className="text-gray-600 mb-4">
          Le CSV doit avoir les colonnes suivantes (avec ces en-têtes ou leurs variantes anglaises) :
        </p>
        <ul className="list-disc list-inside text-gray-600 space-y-2">
          <li><code>malibou_id</code> ou <code>ID</code></li>
          <li><code>prénom</code> ou <code>first_name</code></li>
          <li><code>nom</code> ou <code>last_name</code></li>
          <li><code>poste</code> ou <code>position</code></li>
          <li><code>type de contrat</code> ou <code>contract_type</code> (CDI, CDD, Apprentissage)</li>
        </ul>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Coller le CSV</h2>

        <textarea
          className="w-full h-48 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="Collez votre CSV ici..."
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          disabled={loading}
        />

        <button
          onClick={handleImport}
          disabled={loading || !csvText.trim()}
          className="mt-4 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition"
        >
          {loading ? 'Import en cours...' : 'Importer'}
        </button>

        {error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-6 space-y-4">
            <div className="p-4 bg-green-100 border border-green-400 text-green-700 rounded">
              {result.message}
            </div>

            {result.created && result.created.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-lg mb-2">Collaborateurs importés ({result.created.length})</h3>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100 border-b">
                        <th className="p-2 text-left">Prénom</th>
                        <th className="p-2 text-left">Nom</th>
                        <th className="p-2 text-left">Poste</th>
                        <th className="p-2 text-left">Type Contrat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.created.map((emp, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
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
              <div className="mt-4">
                <h3 className="font-semibold text-lg text-red-600 mb-2">Erreurs ({result.errors.length})</h3>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-red-50 border-b">
                        <th className="p-2 text-left">Collaborateur</th>
                        <th className="p-2 text-left">Erreur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((err, i) => (
                        <tr key={i} className="border-b hover:bg-red-50">
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
        )}
      </div>
    </div>
  );
}
