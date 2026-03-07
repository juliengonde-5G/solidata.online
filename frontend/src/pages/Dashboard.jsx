import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-solidata-dark">
            Bonjour, {user?.first_name || user?.username} !
          </h1>
          <p className="text-gray-500 mt-1">Tableau de bord SOLIDATA ERP</p>
        </div>

        {/* KPI Cards - placeholder */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <KpiCard title="Tonnage collecté" value="—" unit="tonnes" color="green" icon="🚛" />
          <KpiCard title="Tonnage trié" value="—" unit="tonnes" color="blue" icon="⚙️" />
          <KpiCard title="CO₂ évité" value="—" unit="kg" color="teal" icon="🌱" />
          <KpiCard title="Candidats actifs" value="—" unit="" color="yellow" icon="👥" />
        </div>

        {/* Modules actifs */}
        <div className="bg-solidata-green/5 border border-solidata-green/20 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-solidata-dark mb-3">Modules actifs</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {['Recrutement & PCM', 'Équipes & Planning', 'Collecte & Tournées IA', 'Production & Tri',
              'Stock & Expéditions', 'Facturation', 'Reporting', 'Refashion'].map(mod => (
              <div key={mod} className="bg-white rounded-lg p-3 text-sm text-gray-600 border">
                {mod}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function KpiCard({ title, value, unit, color, icon }) {
  const colors = {
    green: 'bg-solidata-green/10 text-solidata-green',
    blue: 'bg-blue-50 text-blue-600',
    teal: 'bg-teal-50 text-teal-600',
    yellow: 'bg-solidata-yellow/10 text-solidata-yellow',
  };
  return (
    <div className="bg-white rounded-xl shadow-sm border p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-500">{title}</span>
        <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${colors[color]}`}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-solidata-dark">{value}</span>
        <span className="text-sm text-gray-400">{unit}</span>
      </div>
    </div>
  );
}

