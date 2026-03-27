import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Candidates from './pages/Candidates';
import PersonalityMatrix from './pages/PersonalityMatrix';
import Employees from './pages/Employees';
import WorkHours from './pages/WorkHours';
import Skills from './pages/Skills';
import Tours from './pages/Tours';
import CAVMap from './pages/CAVMap';
import Vehicles from './pages/Vehicles';
import LiveVehicles from './pages/LiveVehicles';
import Production from './pages/Production';
import ChaineTri from './pages/ChaineTri';
import Stock from './pages/Stock';
import ProduitsFinis from './pages/ProduitsFinis';
import Expeditions from './pages/Expeditions';
import ReportingCollecte from './pages/ReportingCollecte';
import ReportingRH from './pages/ReportingRH';
import ReportingProduction from './pages/ReportingProduction';
import Refashion from './pages/Refashion';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Referentiels from './pages/Referentiels';
import AdminPredictive from './pages/AdminPredictive';
import CollectionProposals from './pages/CollectionProposals';
import InsertionParcours from './pages/InsertionParcours';
import PlanningHebdo from './pages/PlanningHebdo';
import PCMTest from './pages/PCMTest';
import RGPD from './pages/RGPD';
import AdminDB from './pages/AdminDB';
import AdminCAV from './pages/AdminCAV';
import ReportingMetropole from './pages/ReportingMetropole';
import FillRateMap from './pages/FillRateMap';
import NewsFeed from './pages/NewsFeed';
import Pointage from './pages/Pointage';
import ExutoiresCommandes from './pages/ExutoiresCommandes';
import ExutoiresPreparation from './pages/ExutoiresPreparation';
import ExutoiresGantt from './pages/ExutoiresGantt';
import ExutoiresFacturation from './pages/ExutoiresFacturation';
import ExutoiresCalendrier from './pages/ExutoiresCalendrier';
import ExutoiresClients from './pages/ExutoiresClients';
import ExutoiresTarifs from './pages/ExutoiresTarifs';
import Billing from './pages/Billing';
import Pennylane from './pages/Pennylane';
import ActivityLog from './pages/ActivityLog';

// Finance module
import Finance from './pages/Finance';
import FinanceImport from './pages/FinanceImport';
import FinanceOperations from './pages/FinanceOperations';
import FinanceTresorerie from './pages/FinanceTresorerie';
import FinancePL from './pages/FinancePL';
import FinanceBilan from './pages/FinanceBilan';
import FinanceControles from './pages/FinanceControles';

// Hub pages
import HubRecrutement from './pages/HubRecrutement';
import HubEquipe from './pages/HubEquipe';
import HubCollecte from './pages/HubCollecte';
import HubTriProduction from './pages/HubTriProduction';
import HubExutoires from './pages/HubExutoires';
import HubReporting from './pages/HubReporting';
import HubAdmin from './pages/HubAdmin';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen bg-[var(--color-bg)]"><div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent"></div></div>;
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/pcm-test/:token" element={<PCMTest />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

            {/* Hub pages — pages d'accueil par section */}
            <Route path="/hub-recrutement" element={<ProtectedRoute roles={['ADMIN', 'RH']}><HubRecrutement /></ProtectedRoute>} />
            <Route path="/hub-equipe" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><HubEquipe /></ProtectedRoute>} />
            <Route path="/hub-collecte" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><HubCollecte /></ProtectedRoute>} />
            <Route path="/hub-tri-production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><HubTriProduction /></ProtectedRoute>} />
            <Route path="/hub-exutoires" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><HubExutoires /></ProtectedRoute>} />
            <Route path="/hub-reporting" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RH']}><HubReporting /></ProtectedRoute>} />
            <Route path="/hub-admin" element={<ProtectedRoute roles={['ADMIN']}><HubAdmin /></ProtectedRoute>} />

            {/* Recrutement */}
            <Route path="/candidates" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Candidates /></ProtectedRoute>} />
            <Route path="/pcm" element={<ProtectedRoute roles={['ADMIN', 'RH']}><PersonalityMatrix /></ProtectedRoute>} />

            {/* Équipe */}
            <Route path="/employees" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Employees /></ProtectedRoute>} />
            <Route path="/work-hours" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><WorkHours /></ProtectedRoute>} />
            <Route path="/skills" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Skills /></ProtectedRoute>} />
            <Route path="/insertion" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><InsertionParcours /></ProtectedRoute>} />
            <Route path="/planning-hebdo" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><PlanningHebdo /></ProtectedRoute>} />
            <Route path="/pointage" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Pointage /></ProtectedRoute>} />

            {/* Collecte */}
            <Route path="/tours" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Tours /></ProtectedRoute>} />
            <Route path="/collection-proposals" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><CollectionProposals /></ProtectedRoute>} />
            <Route path="/cav-map" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><CAVMap /></ProtectedRoute>} />
            <Route path="/fill-rate" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FillRateMap /></ProtectedRoute>} />
            <Route path="/vehicles" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Vehicles /></ProtectedRoute>} />
            <Route path="/live-vehicles" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><LiveVehicles /></ProtectedRoute>} />

            {/* Tri / Production */}
            <Route path="/production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Production /></ProtectedRoute>} />
            <Route path="/chaine-tri" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ChaineTri /></ProtectedRoute>} />
            <Route path="/stock" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Stock /></ProtectedRoute>} />
            <Route path="/produits-finis" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ProduitsFinis /></ProtectedRoute>} />
            <Route path="/expeditions" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Expeditions /></ProtectedRoute>} />

            {/* Logistique */}
            <Route path="/exutoires-commandes" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresCommandes /></ProtectedRoute>} />
            <Route path="/exutoires-preparation" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresPreparation /></ProtectedRoute>} />
            <Route path="/exutoires-gantt" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresGantt /></ProtectedRoute>} />
            <Route path="/exutoires-facturation" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresFacturation /></ProtectedRoute>} />
            <Route path="/exutoires-calendrier" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresCalendrier /></ProtectedRoute>} />
            <Route path="/exutoires-clients" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresClients /></ProtectedRoute>} />
            <Route path="/exutoires-tarifs" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresTarifs /></ProtectedRoute>} />

            {/* Reporting */}
            <Route path="/reporting-collecte" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ReportingCollecte /></ProtectedRoute>} />
            <Route path="/reporting-rh" element={<ProtectedRoute roles={['ADMIN', 'RH']}><ReportingRH /></ProtectedRoute>} />
            <Route path="/reporting-production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ReportingProduction /></ProtectedRoute>} />
            <Route path="/reporting" element={<Navigate to="/reporting-collecte" />} />
            <Route path="/refashion" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Refashion /></ProtectedRoute>} />
            <Route path="/reporting-metropole" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ReportingMetropole /></ProtectedRoute>} />

            {/* Facturation */}
            <Route path="/billing" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Billing /></ProtectedRoute>} />
            <Route path="/pennylane" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Pennylane /></ProtectedRoute>} />

            {/* Finance */}
            <Route path="/finance" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Finance /></ProtectedRoute>} />
            <Route path="/finance/import" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FinanceImport /></ProtectedRoute>} />
            <Route path="/finance/operations" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FinanceOperations /></ProtectedRoute>} />
            <Route path="/finance/tresorerie" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FinanceTresorerie /></ProtectedRoute>} />
            <Route path="/finance/pl" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FinancePL /></ProtectedRoute>} />
            <Route path="/finance/bilan" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FinanceBilan /></ProtectedRoute>} />
            <Route path="/finance/controles" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FinanceControles /></ProtectedRoute>} />

            {/* Administration */}
            <Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><Users /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute roles={['ADMIN']}><Settings /></ProtectedRoute>} />
            <Route path="/referentiels" element={<ProtectedRoute roles={['ADMIN']}><Referentiels /></ProtectedRoute>} />
            <Route path="/admin-predictive" element={<ProtectedRoute roles={['ADMIN']}><AdminPredictive /></ProtectedRoute>} />
            <Route path="/rgpd" element={<ProtectedRoute roles={['ADMIN']}><RGPD /></ProtectedRoute>} />
            <Route path="/admin-db" element={<ProtectedRoute roles={['ADMIN']}><AdminDB /></ProtectedRoute>} />
            <Route path="/activity-log" element={<ProtectedRoute roles={['ADMIN']}><ActivityLog /></ProtectedRoute>} />
            <Route path="/admin-cav" element={<ProtectedRoute roles={['ADMIN']}><AdminCAV /></ProtectedRoute>} />
            <Route path="/news" element={<ProtectedRoute><NewsFeed /></ProtectedRoute>} />

            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
