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
const Prescripteurs = lazy(() => import('./pages/Prescripteurs'));
const Tours = lazy(() => import('./pages/Tours'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const VehicleMaintenance = lazy(() => import('./pages/VehicleMaintenance'));
const LiveVehicles = lazy(() => import('./pages/LiveVehicles'));
const Incidents = lazy(() => import('./pages/Incidents'));
const Production = lazy(() => import('./pages/Production'));
const ChaineTri = lazy(() => import('./pages/ChaineTri'));
const Stock = lazy(() => import('./pages/Stock'));
const ProduitsFinis = lazy(() => import('./pages/ProduitsFinis'));
const EtiquetteGenerer = lazy(() => import('./pages/EtiquetteGenerer'));
const SortieCartons = lazy(() => import('./pages/SortieCartons'));
const AdminCatalogue = lazy(() => import('./pages/AdminCatalogue'));
const AdminRefashionConfig = lazy(() => import('./pages/AdminRefashionConfig'));
const AdminRefashionExports = lazy(() => import('./pages/AdminRefashionExports'));
const AdminCommunes = lazy(() => import('./pages/AdminCommunes'));
const ReportingCollecte = lazy(() => import('./pages/ReportingCollecte'));
const ReportingRH = lazy(() => import('./pages/ReportingRH'));
const ReportingProduction = lazy(() => import('./pages/ReportingProduction'));
const Refashion = lazy(() => import('./pages/Refashion'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const AdminPredictive = lazy(() => import('./pages/AdminPredictive'));
const CollectionProposals = lazy(() => import('./pages/CollectionProposals'));
const InsertionParcours = lazy(() => import('./pages/InsertionParcours'));
const AuditInsertion = lazy(() => import('./pages/AuditInsertion'));
const PlanningHebdo = lazy(() => import('./pages/PlanningHebdo'));
const PlanningTournees = lazy(() => import('./pages/PlanningTournees'));
const DashboardCollecte = lazy(() => import('./pages/DashboardCollecte'));
const PCMTest = lazy(() => import('./pages/PCMTest'));
const RGPD = lazy(() => import('./pages/RGPD'));
const AdminDB = lazy(() => import('./pages/AdminDB'));
const AdminPermissions = lazy(() => import('./pages/AdminPermissions'));
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
const ExutoiresControleFacturation = lazy(() => import('./pages/ExutoiresControleFacturation'));
const ExutoiresCalendrier = lazy(() => import('./pages/ExutoiresCalendrier'));
const ExutoiresClients = lazy(() => import('./pages/ExutoiresClients'));
const ExutoiresTarifs = lazy(() => import('./pages/ExutoiresTarifs'));
const Billing = lazy(() => import('./pages/Billing'));
const Pennylane = lazy(() => import('./pages/Pennylane'));
const PennylaneConfig = lazy(() => import('./pages/PennylaneConfig'));
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
const DashboardExecutif = lazy(() => import('./pages/DashboardExecutif'));
const AdminAlertThresholds = lazy(() => import('./pages/AdminAlertThresholds'));

const BoutiquesDashboard = lazy(() => import('./pages/BoutiquesDashboard'));
const BoutiquesVentes = lazy(() => import('./pages/BoutiquesVentes'));
const BoutiquesCommandes = lazy(() => import('./pages/BoutiquesCommandes'));
const BoutiquesObjectifs = lazy(() => import('./pages/BoutiquesObjectifs'));
const BoutiquesImport = lazy(() => import('./pages/BoutiquesImport'));

const VakPerformance = lazy(() => import('./pages/VakPerformance'));
const VakJournee = lazy(() => import('./pages/VakJournee'));
const VakAnnuel = lazy(() => import('./pages/VakAnnuel'));
const VakSessions = lazy(() => import('./pages/VakSessions'));
const VakLive = lazy(() => import('./pages/VakLive'));
const VakSumupConfig = lazy(() => import('./pages/VakSumupConfig'));

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
  // Un rôle personnalisé est autorisé si son rôle de base (base_role) l'est.
  if (roles && !roles.includes(user.role) && !roles.includes(user.base_role)) return <Navigate to="/" />;
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
              <Route path="/balance/:token" element={<BalancePage />} />
              <Route path="/pcm-test/:token" element={<PCMTest />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />


              {/* Boutiques */}
              <Route path="/boutiques" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RESP_BTQ']}><BoutiquesDashboard /></ProtectedRoute>} />
              <Route path="/boutiques/ventes" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RESP_BTQ']}><BoutiquesVentes /></ProtectedRoute>} />
              <Route path="/boutiques/commandes" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'RESP_BTQ']}><BoutiquesCommandes /></ProtectedRoute>} />
              <Route path="/boutiques/objectifs" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><BoutiquesObjectifs /></ProtectedRoute>} />
              <Route path="/boutiques/import" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><BoutiquesImport /></ProtectedRoute>} />

              {/* Vente au Kilo (VAK) — caisse SumUp, dashboards perf, live TV */}
              <Route path="/vak" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><VakPerformance /></ProtectedRoute>} />
              <Route path="/vak/jours" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><VakJournee /></ProtectedRoute>} />
              <Route path="/vak/annuel" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><VakAnnuel /></ProtectedRoute>} />
              <Route path="/vak/sessions" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><VakSessions /></ProtectedRoute>} />
              <Route path="/vak/live" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><VakLive /></ProtectedRoute>} />
              <Route path="/admin/vak/sumup-config" element={<ProtectedRoute roles={['ADMIN']}><VakSumupConfig /></ProtectedRoute>} />

              {/* Recrutement */}
              <Route path="/candidates" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Candidates /></ProtectedRoute>} />
              <Route path="/recruitment-plan" element={<ProtectedRoute roles={['ADMIN', 'RH']}><RecruitmentPlan /></ProtectedRoute>} />
              <Route path="/pcm" element={<ProtectedRoute roles={['ADMIN', 'RH']}><PersonalityMatrix /></ProtectedRoute>} />

              {/* Équipe */}
              <Route path="/employees" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Employees /></ProtectedRoute>} />
              <Route path="/work-hours" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><WorkHours /></ProtectedRoute>} />
              <Route path="/skills" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Skills /></ProtectedRoute>} />
              <Route path="/prescripteurs" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Prescripteurs /></ProtectedRoute>} />
              <Route path="/insertion" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><InsertionParcours /></ProtectedRoute>} />
              <Route path="/insertion/audit" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><AuditInsertion /></ProtectedRoute>} />
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
              <Route path="/incidents" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Incidents /></ProtectedRoute>} />
              <Route path="/planning-tournees" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><PlanningTournees /></ProtectedRoute>} />
              <Route path="/dashboard-collecte" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><DashboardCollecte /></ProtectedRoute>} />
              <Route path="/live-vehicles" element={<Navigate to="/collections-live" replace />} />

              {/* Tri / Production */}
              <Route path="/production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Production /></ProtectedRoute>} />
              <Route path="/chaine-tri" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ChaineTri /></ProtectedRoute>} />
              <Route path="/stock" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Stock /></ProtectedRoute>} />
              <Route path="/produits-finis" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ProduitsFinis /></ProtectedRoute>} />
              <Route path="/tri/etiquettes" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'COLLABORATEUR']}><EtiquetteGenerer /></ProtectedRoute>} />
              <Route path="/inventaire/sortie-cartons" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'COLLABORATEUR']}><SortieCartons /></ProtectedRoute>} />
              <Route path="/admin/catalogue" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminCatalogue /></ProtectedRoute>} />
              <Route path="/admin/refashion-config" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminRefashionConfig /></ProtectedRoute>} />
              <Route path="/admin/refashion-exports" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminRefashionExports /></ProtectedRoute>} />
              <Route path="/admin/communes" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminCommunes /></ProtectedRoute>} />

              {/* Logistique */}
              <Route path="/exutoires-commandes" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresCommandes /></ProtectedRoute>} />
              <Route path="/exutoires-preparation" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresPreparation /></ProtectedRoute>} />
              <Route path="/exutoires-gantt" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresGantt /></ProtectedRoute>} />
              <Route path="/exutoires-controle-facturation" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresControleFacturation /></ProtectedRoute>} />
              <Route path="/exutoires-calendrier" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresCalendrier /></ProtectedRoute>} />
              <Route path="/exutoires-clients" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresClients /></ProtectedRoute>} />
              <Route path="/exutoires-tarifs" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ExutoiresTarifs /></ProtectedRoute>} />
              <Route path="/inventaire-original" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><InventaireOriginal /></ProtectedRoute>} />

              {/* Reporting */}
              <Route path="/performance" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><PerformanceDashboard /></ProtectedRoute>} />
              <Route path="/dashboard-executif" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><DashboardExecutif /></ProtectedRoute>} />
              <Route path="/reporting-collecte" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'AUTORITE']}><ReportingCollecte /></ProtectedRoute>} />
              <Route path="/reporting-rh" element={<ProtectedRoute roles={['ADMIN', 'RH']}><ReportingRH /></ProtectedRoute>} />
              <Route path="/reporting-production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ReportingProduction /></ProtectedRoute>} />
              <Route path="/reporting" element={<Navigate to="/reporting-collecte" />} />
              <Route path="/refashion" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Refashion /></ProtectedRoute>} />
              <Route path="/reporting-metropole" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'AUTORITE']}><ReportingMetropole /></ProtectedRoute>} />

              {/* Facturation */}
              <Route path="/billing" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Billing /></ProtectedRoute>} />
              <Route path="/pennylane" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Pennylane /></ProtectedRoute>} />
              <Route path="/admin/pennylane-config" element={<ProtectedRoute roles={['ADMIN']}><PennylaneConfig /></ProtectedRoute>} />

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
              <Route path="/admin/permissions" element={<ProtectedRoute roles={['ADMIN']}><AdminPermissions /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute roles={['ADMIN']}><Settings /></ProtectedRoute>} />
              <Route path="/referentiels" element={<Navigate to="/admin/catalogue" replace />} />
              <Route path="/admin-predictive" element={<ProtectedRoute roles={['ADMIN']}><AdminPredictive /></ProtectedRoute>} />
              <Route path="/admin-alert-thresholds" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminAlertThresholds /></ProtectedRoute>} />
              <Route path="/rgpd" element={<ProtectedRoute roles={['ADMIN']}><RGPD /></ProtectedRoute>} />
              <Route path="/admin-db" element={<ProtectedRoute roles={['ADMIN']}><AdminDB /></ProtectedRoute>} />
              <Route path="/activity-log" element={<ProtectedRoute roles={['ADMIN']}><ActivityLog /></ProtectedRoute>} />
              <Route path="/admin-cav" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminCAV /></ProtectedRoute>} />
              <Route path="/admin-sensors" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminSensors /></ProtectedRoute>} />
              <Route path="/admin-stock-original" element={<ProtectedRoute roles={['ADMIN']}><AdminStockOriginal /></ProtectedRoute>} />
              <Route path="/admin-associations" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><AdminAssociations /></ProtectedRoute>} />
              <Route path="/admin-collaborators-import" element={<ProtectedRoute roles={['ADMIN', 'RH']}><AdminCollaboratorsImport /></ProtectedRoute>} />
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
