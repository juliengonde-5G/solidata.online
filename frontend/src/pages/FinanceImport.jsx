import { useNavigate } from 'react-router-dom';
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
          icon={IconUpload}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Import' },
          ]}
        />

        <div className="max-w-xl mx-auto">
          <div className="card-modern p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
              <IconPennylane className="w-8 h-8 text-indigo-600" />
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

function IconUpload({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
}
function IconPennylane({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
