import { useState } from 'react';
import Layout from '../components/Layout';
import { PageHeader } from '../components';
import { Zap, Gauge, Fuel, Sliders } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import DashboardGES from '../components/energie/DashboardGES';
import SaisieReleves from '../components/energie/SaisieReleves';
import SaisiePleins from '../components/energie/SaisiePleins';
import AdminCompteurs from '../components/energie/AdminCompteurs';

// Module « Énergie & GES » (RSEI-11) — comble le critère RSEi 4.2 « Énergies et
// GES ». Page à onglets : tableau de bord GES, relevés énergie, carburant,
// réglages (sites/compteurs/facteurs). Interface 100 % française.
export default function EnergieGES() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const canWrite = ['ADMIN', 'RH', 'MANAGER'].includes(base);           // sites/compteurs/relevés/pleins
  const canWriteFacteurs = ['ADMIN', 'RH'].includes(base);              // facteurs d'émission

  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [tab, setTab] = useState('dashboard');

  const TABS = [
    { id: 'dashboard', label: 'Tableau de bord GES', icon: Gauge, show: true },
    { id: 'releves', label: 'Relevés énergie', icon: Zap, show: true },
    { id: 'carburant', label: 'Carburant', icon: Fuel, show: true },
    { id: 'reglages', label: 'Réglages', icon: Sliders, show: canWrite },
  ].filter((t) => t.show);

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <PageHeader
          title="Énergie & GES"
          subtitle="Consommations d'énergie, carburant de la flotte et émissions de gaz à effet de serre (méthode ADEME)"
          icon={Zap}
        />

        {/* Onglets */}
        <div className="border-b border-slate-200 mb-5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  aria-current={active ? 'page' : undefined}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'dashboard' && <DashboardGES annee={annee} setAnnee={setAnnee} />}
        {tab === 'releves' && <SaisieReleves annee={annee} setAnnee={setAnnee} canWrite={canWrite} />}
        {tab === 'carburant' && <SaisiePleins annee={annee} setAnnee={setAnnee} canWrite={canWrite} />}
        {tab === 'reglages' && canWrite && <AdminCompteurs canWrite={canWrite} canWriteFacteurs={canWriteFacteurs} />}
      </div>
    </Layout>
  );
}
