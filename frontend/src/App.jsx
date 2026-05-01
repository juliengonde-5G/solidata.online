import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import Login from './pages/Login';

// Pages lazy-loaded — chargées à la demande pour réduire le bundle initial
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Candidates = lazy(() => import('./pages/Candidates'));
const RecruitmentPlan = lazy(() => import('./pages/RecruitmentPlan'));
const PersonalityMatrix = lazy(() => import('./pages/PersonalityMatrix'));
const Employees = lazy(() => import('./pages/Employees'));
const WorkHours = lazy(() => import('./pages/WorkHours'));
const Skills = lazy(() => import('./pages/Skills'));
const Tours = lazy(() => import('./pages/Tours'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const VehicleMaintenance = lazy(() => import('./pages/VehicleMaintenance'));
const LiveVehicles = lazy(() => import('./pages/LiveVehicles'));
const Production = lazy(() => import('./pages/Production'));
const ChaineTri = lazy(() => import('./pages/ChaineTri'));
const Stock = lazy(() => import('./pages/Stock'));
const ProduitsFinis = lazy(() => import('./pages/ProduitsFinis'));
const Expeditions = lazy(() => import('./pages/Expeditions'));
const ReportingCollecte = lazy(() => import('./pages/ReportingCollecte'));
const ReportingRH = lazy(() => import('./pages/ReportingRH'));
const ReportingProduction = lazy(() => import('./pages/ReportingProduction'));
const Refashion = lazy(() => import('./pages/Refashion'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const Referentiels = lazy(() => import('./pages/Referentiels'));
const AdminPredictive = lazy(() => import('./pages/AdminPredictive'));
const CollectionProposals = lazy(() => import('./pages/CollectionProposals'));
const InsertionParcours = lazy(() => import('./pages/InsertionParcours'));
const PlanningHebdo = lazy(() => import('./pages/PlanningHebdo'));
const PlanningTournees = lazy(() => import('./pages/PlanningTournees'));
const DashboardCollecte = lazy(() => import('./pages/DashboardCollecte'));
const PCMTest = lazy(() => import('./pages/PCMTest'));
const RGPD = lazy(() => import('./pages/RGPD'));
const AdminDB = lazy(() => import('./pages/AdminDB'));
const AdminCAV = lazy(() => import('./pages/AdminCAV'));
const AdminSensors = lazy(() => import('./pages/AdminSensors'));
const AdminAssociations = lazy(() => import('./pages/AdminAssociations'));
const AdminCollaboratorsImport = lazy(() => import('./pages/AdminCollaboratorsImport'));
const ReportingMetropole = lazy(() => import('./pages/ReportingMetropole'));
const FillRateMap = lazy(() => import('./pages/FillRateMap'));
const NewsFeed = lazy(() => import('./pages/NewsFeed'));
const Pointage = lazy(() => import('./pages/Pointage'));
const ExutoiresCommandes = lazy(() => import('./pages/ExutoiresCommandes'));
const ExutoiresPreparation = lazy(() => import('./pages/ExutoiresPreparation'));
const ExutoiresGantt = lazy(() => import('./pages/ExutoiresGantt'));
const ExutoiresFacturation = lazy(() => import('./pages/ExutoiresFacturation'));
const ExutoiresCalendrier = lazy(() => import('./pages/ExutoiresCalendrier'));
const ExutoiresClients = lazy(() => import('./pages/ExutoiresClients'));
const ExutoiresTarifs = lazy(() => import('./pages/ExutoiresTarifs'));
const Billing = lazy(() => import('./pages/Billing'));
const Pennylane = lazy(() => import('./pages/Pennylane'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const InventaireOriginal = lazy(() => import('./pages/InventaireOriginal'));
const AdminStockOriginal = lazy(() => import('./pages/AdminStockOriginal'));
const BalancePage = lazy(() => import('./pages/BalancePage'));

const Finance = lazy(() => import('./pages/Finance'));
const FinanceImport = lazy(() => import('./pages/FinanceImport'));
const FinanceOperations = lazy(() => import('./pages/FinanceOperations'));
const FinanceRentabilite = lazy(() => import('./pages/FinanceRentabilite'));
const FinanceTresorerie = lazy(() => import('./pages/FinanceTresorerie'));
const FinancePL = lazy(() => import('./pages/FinancePL'));
const FinanceBilan = lazy(() => import('./pages/FinanceBilan'));
const FinanceControles = lazy(() => import('./pages/FinanceControles'));

const PerformanceDashboard = lazy(() => import('./pages/PerformanceDashboard'));

const HubRecrutement = lazy(() => import('./pages/HubRecrutement'));
const HubEquipe = lazy(() => import('./pages/HubEquipe'));
const HubCollecte = lazy(() => import('./pages/HubCollecte'));
const HubTriProduction = lazy(() => import('./pages/HubTriProduction'));
const HubExutoires = lazy(() => import('./pages/HubExutoires'));
const HubReporting = lazy(() => import('./pages/HubReporting'));
const HubAdmin = lazy(() => import('./pages/HubAdmin'));
const HubBoutiques = lazy(() => import('./pages/HubBoutiques'));
const BoutiquesDashboard = lazy(() => import('./pages/BoutiquesDashboard'));
const BoutiquesVentes = lazy(() => import('./pages/BoutiquesVentes'));
const BoutiquesCommandes = lazy(() => import('./pages/BoutiquesCommandes'));
const BoutiquesObjectifs = lazy(() => import('./pages/BoutiquesObjectifs'));
const BoutiquesImport = lazy(() => import('./pages/BoutiquesImport'));

function PageFallback() {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center h-screen bg-[var(--color-bg)]">
      <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" />
      <span className="sr-only">Chargement de la page…</span>
    </div>
  );
}

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/balance" element={<BalancePage />} />
              <Route path="/pcm-test/:token" element={<PCMTest />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

              {/* Hub pages — pages d'accueil par section */}
              <Route path="/hub-recrutement" element={<ProtectedRoute roles={['ADMIN', 'RH']}><HubRecrutement /></ProtectedRoute>} />
              <Route path="/hub-equipe" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><HubEquipe /></ProtectedRoute>} />
              <Route path="/hub-collecte" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><HubCollecte /></ProtectedRoute>} />
              <Route path="/hub-tri-production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><HubTriProduction /></ProtectedRoute>} />
              <Route path="/hub-exutoires" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><HubExutoires /></ProtectedRoute>} />
              <Route path="/hub-boutiques" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RESP_BTQ']}><HubBoutiques /></ProtectedRoute>} />
              <Route path="/hub-reporting" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RH']}><HubReporting /></ProtectedRoute>} />
              <Route path="/hub-admin" element={<ProtectedRoute roles={['ADMIN']}><HubAdmin /></ProtectedRoute>} />

              {/* Boutiques */}
              <Route path="/boutiques" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RESP_BTQ']}><BoutiquesDashboard /></ProtectedRoute>} />
              <Route path="/boutiques/ventes" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RESP_BTQ']}><BoutiquesVentes /></ProtectedRoute>} />
              <Route path="/boutiques/commandes" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RESP_BTQ']}><BoutiquesCommandes /></ProtectedRoute>} />
              <Route path="/boutiques/objectifs" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><BoutiquesObjectifs /></ProtectedRoute>} />
              <Route path="/boutiques/import" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><BoutiquesImport /></ProtectedRoute>} />

              {/* Recrutement */}
              <Route path="/candidates" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Candidates /></ProtectedRoute>} />
              <Route path="/recruitment-plan" element={<ProtectedRoute roles={['ADMIN', 'RH']}><RecruitmentPlan /></ProtectedRoute>} />
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
              <Route path="/cav-map" element={<Navigate to="/fill-rate" replace />} />
              <Route path="/fill-rate" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FillRateMap /></ProtectedRoute>} />
              <Route path="/vehicles" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Vehicles /></ProtectedRoute>} />
              <Route path="/vehicle-maintenance" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><VehicleMaintenance /></ProtectedRoute>} />
              <Route path="/collections-live" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><LiveVehicles /></ProtectedRoute>} />
              <Route path="/planning-tournees" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><PlanningTournees /></ProtectedRoute>} />
              <Route path="/dashboard-collecte" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><DashboardCollecte /></ProtectedRoute>} />
              <Route path="/live-vehicles" element={<Navigate to="/collections-live" replace />} />

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
              <Route path="/inventaire-original" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><InventaireOriginal /></ProtectedRoute>} />

              {/* Reporting */}
              <Route path="/performance" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><PerformanceDashboard /></ProtectedRoute>} />
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
              <Route path="/finance/rentabilite" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FinanceRentabilite /></ProtectedRoute>} />
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
              <Route path="/admin-sensors" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminSensors /></ProtectedRoute>} />
              <Route path="/admin-stock-original" element={<ProtectedRoute roles={['ADMIN']}><AdminStockOriginal /></ProtectedRoute>} />
              <Route path="/admin-associations" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminAssociations /></ProtectedRoute>} />
              <Route path="/admin-collaborators-import" element={<ProtectedRoute roles={['ADMIN']}><AdminCollaboratorsImport /></ProtectedRoute>} />
              <Route path="/news" element={<ProtectedRoute><NewsFeed /></ProtectedRoute>} />

              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
