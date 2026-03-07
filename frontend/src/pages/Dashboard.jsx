import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import api from '../services/api';

export default function Dashboard() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.get('/health').then(res => setHealth(res.data)).catch(() => {});
  }, []);

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

        {/* Status système */}
        {health && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-solidata-dark mb-4">État du système</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatusItem label="API" active={health.status === 'ok'} />
              <StatusItem label="Base de données" active={health.database?.connected} />
              <StatusItem label="PostGIS" active={!!health.database?.postgis} />
              <StatusItem label="Auth" active={health.modules?.auth} />
            </div>
            <p className="text-xs text-gray-400 mt-4">
              PostgreSQL {health.database?.version?.split(' ').slice(0, 2).join(' ')} • PostGIS {health.database?.postgis}
            </p>
          </div>
        )}

        {/* Modules à venir */}
        <div className="mt-8 bg-solidata-green/5 border border-solidata-green/20 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-solidata-dark mb-3">Modules en cours de déploiement</h2>
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

function StatusItem({ label, active }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-solidata-green' : 'bg-red-400'}`} />
      <span className="text-sm text-gray-600">{label}</span>
    </div>
  );
}
