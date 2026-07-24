import { useState } from 'react';
import Layout from '../components/Layout';
import { PageHeader } from '../components';
import { ShoppingCart, LayoutDashboard, Building2, ListChecks, FileWarning } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import DashboardAchats from '../components/achats/DashboardAchats';
import Fournisseurs from '../components/achats/Fournisseurs';
import CriteresAchat from '../components/achats/CriteresAchat';
import RegistreFDS from '../components/achats/RegistreFDS';

// Module « Achats responsables » (RSEI-17) — outille le critère RSEi 1.7.
// Page à onglets : tableau de bord (part responsable en nombre & en montant),
// référentiel fournisseurs, critères d'achat, registre des FDS. Interface 100 %
// française. Lecture ADMIN/MANAGER/RH/QHSE ; écriture ADMIN/RH/MANAGER (base_role).
export default function AchatsResponsables() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const canWrite = ['ADMIN', 'RH', 'MANAGER'].includes(base);

  const [tab, setTab] = useState('dashboard');

  const TABS = [
    { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
    { id: 'fournisseurs', label: 'Fournisseurs', icon: Building2 },
    { id: 'criteres', label: "Critères d'achat", icon: ListChecks },
    { id: 'fds', label: 'Registre FDS', icon: FileWarning },
  ];

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <PageHeader
          title="Achats responsables"
          subtitle="Référentiel fournisseurs, critères d'achat, fiches de données de sécurité et part d'achats responsables (critère RSEi 1.7)"
          icon={ShoppingCart}
        />

        {/* Onglets */}
        <div className="border-b border-slate-200 mb-5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  aria-current={active ? 'page' : undefined}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'dashboard' && <DashboardAchats />}
        {tab === 'fournisseurs' && <Fournisseurs canWrite={canWrite} />}
        {tab === 'criteres' && <CriteresAchat canWrite={canWrite} />}
        {tab === 'fds' && <RegistreFDS canWrite={canWrite} />}
      </div>
    </Layout>
  );
}
