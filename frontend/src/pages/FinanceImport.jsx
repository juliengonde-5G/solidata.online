import { useNavigate } from 'react-router-dom';
import { CircleDollarSign, Upload } from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader } from '../components';

// ══════════════════════════════════════════
// FINANCE IMPORT — Redirige vers Pennylane
// L'import se fait exclusivement via la connexion Pennylane
// ══════════════════════════════════════════

export default function FinanceImport() {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Import Comptable"
          subtitle="Synchronisation via Pennylane"
          icon={Upload}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Import' },
          ]}
        />

        <div className="max-w-xl mx-auto">
          <div className="card-modern p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
              <CircleDollarSign className="w-8 h-8 text-indigo-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Import via Pennylane</h2>
            <p className="text-sm text-slate-500 mb-6">
              Les donnees comptables sont importees directement depuis Pennylane.
              Utilisez la page Pennylane pour synchroniser le Grand Livre analytique,
              les transactions bancaires et consulter les balances.
            </p>
            <button
              onClick={() => navigate('/pennylane')}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition"
            >
              Ouvrir Pennylane
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}

