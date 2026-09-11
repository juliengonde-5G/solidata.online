import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ErreurApplication from './components/ErreurApplication';
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
const Qhse = lazy(() => import('./pages/Qhse'));
const Production = lazy(() => import('./pages/Production'));
const ChaineTri = lazy(() => import('./pages/ChaineTri'));
const TriExecution = lazy(() => import('./pages/TriExecution'));
const AdminTri = lazy(() => import('./pages/AdminTri'));
const ChaineConfigurateur = lazy(() => import('./pages/ChaineConfigurateur'));
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
const PlanFormation = lazy(() => import('./pages/PlanFormation'));
const EffectifsETP = lazy(() => import('./pages/EffectifsETP'));
const ReportingProduction = lazy(() => import('./pages/ReportingProduction'));
const Refashion = lazy(() => import('./pages/Refashion'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const AdminPredictive = lazy(() => import('./pages/AdminPredictive'));
const CollectionProposals = lazy(() => import('./pages/CollectionProposals'));
const RouteTemplates = lazy(() => import('./pages/RouteTemplates'));
const AdminLieuxTechniques = lazy(() => import('./pages/AdminLieuxTechniques'));
const InsertionParcours = lazy(() => import('./pages/InsertionParcours'));
const ActionsCIP = lazy(() => import('./pages/ActionsCIP'));
const AuditInsertion = lazy(() => import('./pages/AuditInsertion'));
const RenouvellementETI = lazy(() => import('./pages/RenouvellementETI'));
const AdminInsertion = lazy(() => import('./pages/AdminInsertion'));
const PilotageRSE = lazy(() => import('./pages/PilotageRSE'));
const EnergieGES = lazy(() => import('./pages/EnergieGES'));
const AchatsResponsables = lazy(() => import('./pages/AchatsResponsables'));
const Enquetes = lazy(() => import('./pages/Enquetes'));
const EnqueteReponse = lazy(() => import('./pages/EnqueteReponse'));
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
const Messagerie = lazy(() => import('./pages/Messagerie'));
const ExutoiresCommandes = lazy(() => import('./pages/ExutoiresCommandes'));
const ExutoiresPreparation = lazy(() => import('./pages/ExutoiresPreparation'));
const ExutoiresGantt = lazy(() => import('./pages/ExutoiresGantt'));
const ExutoiresControleFacturation = lazy(() => import('./pages/ExutoiresControleFacturation'));
const ExutoiresCalendrier = lazy(() => import('./pages/ExutoiresCalendrier'));
const ExutoiresClients = lazy(() => import('./pages/ExutoiresClients'));
const ExutoiresTarifs = lazy(() => import('./pages/ExutoiresTarifs'));
// Facturation interne (Billing) retirée de l'UI — arbitrage A2 audit 2026-07
// (le flux réel passe par Pennylane + contrôle facturation ; tables invoices conservées).
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
const BoutiquesPlanning = lazy(() => import('./pages/BoutiquesPlanning'));
const BoutiquesImport = lazy(() => import('./pages/BoutiquesImport'));

const VakPerformance = lazy(() => import('./pages/VakPerformance'));
const VakJournee = lazy(() => import('./pages/VakJournee'));
const VakAnnuel = lazy(() => import('./pages/VakAnnuel'));
const VakSessions = lazy(() => import('./pages/VakSessions'));
const VakLive = lazy(() => import('./pages/VakLive'));
const VakSumupConfig = lazy(() => import('./pages/VakSumupConfig'));

const TempsPresence = lazy(() => import('./pages/TempsPresence'));

function PageFallback() {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center h-screen bg-[var(--color-bg)]">
      <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent" />
      <span className="sr-only">Chargement de la page…</span>
    </div>
  );
}

// `module` : clé d'habilitation de la matrice /admin/permissions. Sans elle, un
// module décoché ne disparaissait que de la barre latérale — l'URL tapée à la
// main rouvrait l'écran. Le refus qui FAIT FOI reste côté serveur (les routes
// d'API du module sont gardées) ; ceci évite d'afficher une page qui se
// remplirait de 403.
function ProtectedRoute({ children, roles, module }) {
  const { user, loading, canAccessModule } = useAuth();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login" />;
  // Un rôle personnalisé est autorisé si son rôle de base (base_role) l'est.
  if (roles && !roles.includes(user.role) && !roles.includes(user.base_role)) return <Navigate to="/" />;
  if (module && !canAccessModule(module)) return <Navigate to="/" />;
  return children;
}

// Page d'accueil adaptée au rôle (vague 2). Les parties prenantes (auditeur
// externe AUTORITE, DPO) n'ont pas de tableau de bord opérationnel pertinent :
// on les dépose sur leur espace principal plutôt que sur un dashboard
// générique. base_role : un rôle personnalisé suit son modèle.
function HomeRedirect() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const landing = {
    AUTORITE: '/reporting-metropole',
    DPO: '/rgpd',
    // FINANCE et QHSE retirés le 10/09/2026 : ces profils d'habilitation
    // n'existent plus (les MODULES Finance et QHSE, eux, restent — ils sont
    // simplement réservés aux rôles qui subsistent).
    PCM: '/pcm',             // praticien PCM : son unique écran est son accueil
  }[base];
  if (landing) return <Navigate to={landing} replace />;
  return <Dashboard />;
}

function App() {
  return (
    // Rempart le plus haut possible : au-dessus même du routeur et des
    // fournisseurs de contexte, pour qu'un plantage des écrans bloquants
    // (changement de mot de passe, enrôlement 2FA) ne laisse pas non plus une
    // page blanche. Il ne dépend d'aucun d'eux.
    <ErreurApplication>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/balance" element={<BalancePage />} />
              <Route path="/balance/:token" element={<BalancePage />} />
              <Route path="/pcm-test/:token" element={<PCMTest />} />
              {/* Réponse publique à une enquête (RSEI-13) — SANS authentification, mode kiosque FALC */}
              <Route path="/enquete/:token" element={<EnqueteReponse />} />
              <Route path="/" element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />


              {/* Boutiques */}
              <Route path="/boutiques" element={<ProtectedRoute roles={['ADMIN', 'RESP_BTQ']}><BoutiquesDashboard /></ProtectedRoute>} />
              <Route path="/boutiques/ventes" element={<ProtectedRoute roles={['ADMIN', 'RESP_BTQ']}><BoutiquesVentes /></ProtectedRoute>} />
              <Route path="/boutiques/commandes" element={<ProtectedRoute roles={['ADMIN', 'RESP_BTQ']}><BoutiquesCommandes /></ProtectedRoute>} />
              <Route path="/boutiques/planning" element={<ProtectedRoute roles={['ADMIN', 'RESP_BTQ']}><BoutiquesPlanning /></ProtectedRoute>} />
              <Route path="/boutiques/objectifs" element={<ProtectedRoute roles={['ADMIN']}><BoutiquesObjectifs /></ProtectedRoute>} />
              <Route path="/boutiques/import" element={<ProtectedRoute roles={['ADMIN']}><BoutiquesImport /></ProtectedRoute>} />

              {/* Vente au Kilo (VAK) — caisse SumUp, dashboards perf, live TV */}
              <Route path="/vak" element={<ProtectedRoute roles={['ADMIN']}><VakPerformance /></ProtectedRoute>} />
              <Route path="/vak/jours" element={<ProtectedRoute roles={['ADMIN']}><VakJournee /></ProtectedRoute>} />
              <Route path="/vak/annuel" element={<ProtectedRoute roles={['ADMIN']}><VakAnnuel /></ProtectedRoute>} />
              <Route path="/vak/sessions" element={<ProtectedRoute roles={['ADMIN']}><VakSessions /></ProtectedRoute>} />
              <Route path="/vak/live" element={<ProtectedRoute roles={['ADMIN']}><VakLive /></ProtectedRoute>} />
              <Route path="/admin/vak/sumup-config" element={<ProtectedRoute roles={['ADMIN']}><VakSumupConfig /></ProtectedRoute>} />

              {/* Recrutement */}
              <Route path="/candidates" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Candidates /></ProtectedRoute>} />
              <Route path="/recruitment-plan" element={<ProtectedRoute roles={['ADMIN', 'RH']}><RecruitmentPlan /></ProtectedRoute>} />
              <Route path="/pcm" element={<ProtectedRoute roles={['ADMIN', 'RH', 'PCM']}><PersonalityMatrix /></ProtectedRoute>} />

              {/* Équipe */}
              <Route path="/employees" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Employees /></ProtectedRoute>} />
              <Route path="/work-hours" element={<ProtectedRoute roles={['ADMIN', 'RH']}><WorkHours /></ProtectedRoute>} />
              <Route path="/rh/formation" element={<ProtectedRoute roles={['ADMIN', 'RH']}><PlanFormation /></ProtectedRoute>} />
              <Route path="/rh/effectifs" element={<ProtectedRoute roles={['ADMIN', 'RH']}><EffectifsETP /></ProtectedRoute>} />
              <Route path="/skills" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Skills /></ProtectedRoute>} />
              <Route path="/prescripteurs" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Prescripteurs /></ProtectedRoute>} />
              <Route path="/insertion" element={<ProtectedRoute roles={['ADMIN', 'RH']}><InsertionParcours /></ProtectedRoute>} />
              <Route path="/insertion/actions" element={<ProtectedRoute roles={['ADMIN', 'RH']}><ActionsCIP /></ProtectedRoute>} />
              <Route path="/insertion/audit" element={<ProtectedRoute roles={['ADMIN', 'RH']}><AuditInsertion /></ProtectedRoute>} />
              {/* Écran ETI (REC-UX-06) : un écran, un salarié, accessible par lien direct */}
              <Route path="/insertion/renouvellement/:milestoneId" element={<ProtectedRoute roles={['ADMIN', 'RH']}><RenouvellementETI /></ProtectedRoute>} />
              <Route path="/admin/insertion" element={<ProtectedRoute roles={['ADMIN']}><AdminInsertion /></ProtectedRoute>} />
              <Route path="/planning-hebdo" element={<ProtectedRoute roles={['ADMIN', 'RH']}><PlanningHebdo /></ProtectedRoute>} />
              {/* Module « Pointage » retiré le 10/09/2026 (remplacé par la badgeuse).
                  Redirection plutôt que 404 : l'écran était en favori chez les RH,
                  et « page introuvable » se lit comme une panne. */}
              <Route path="/pointage" element={<Navigate to="/badgeuse" replace />} />

              {/* Collecte */}
              <Route path="/tours" element={<ProtectedRoute roles={['ADMIN']}><Tours /></ProtectedRoute>} />
              <Route path="/collection-proposals" element={<ProtectedRoute roles={['ADMIN']}><CollectionProposals /></ProtectedRoute>} />
              <Route path="/route-templates" element={<ProtectedRoute roles={['ADMIN']}><RouteTemplates /></ProtectedRoute>} />
              <Route path="/admin-lieux-techniques" element={<ProtectedRoute roles={['ADMIN']}><AdminLieuxTechniques /></ProtectedRoute>} />
              <Route path="/cav-map" element={<Navigate to="/fill-rate" replace />} />
              <Route path="/fill-rate" element={<ProtectedRoute roles={['ADMIN', 'AUTORITE']}><FillRateMap /></ProtectedRoute>} />
              <Route path="/vehicles" element={<ProtectedRoute roles={['ADMIN']}><Vehicles /></ProtectedRoute>} />
              <Route path="/vehicle-maintenance" element={<ProtectedRoute roles={['ADMIN']}><VehicleMaintenance /></ProtectedRoute>} />
              <Route path="/collections-live" element={<ProtectedRoute roles={['ADMIN']}><LiveVehicles /></ProtectedRoute>} />
              <Route path="/incidents" element={<ProtectedRoute roles={['ADMIN']}><Incidents /></ProtectedRoute>} />
              <Route path="/planning-tournees" element={<ProtectedRoute roles={['ADMIN']}><PlanningTournees /></ProtectedRoute>} />
              <Route path="/dashboard-collecte" element={<ProtectedRoute roles={['ADMIN']}><DashboardCollecte /></ProtectedRoute>} />
              <Route path="/live-vehicles" element={<Navigate to="/collections-live" replace />} />

              {/* Tri / Production */}
              <Route path="/production" element={<ProtectedRoute roles={['ADMIN']}><Production /></ProtectedRoute>} />
              <Route path="/chaine-tri" element={<ProtectedRoute roles={['ADMIN']}><ChaineTri /></ProtectedRoute>} />
              <Route path="/tri/execution" element={<ProtectedRoute roles={['ADMIN']}><TriExecution /></ProtectedRoute>} />
              <Route path="/admin/tri" element={<ProtectedRoute roles={['ADMIN']}><AdminTri /></ProtectedRoute>} />
              <Route path="/tri/configurateur" element={<ProtectedRoute roles={['ADMIN']}><ChaineConfigurateur /></ProtectedRoute>} />
              <Route path="/stock" element={<ProtectedRoute roles={['ADMIN']}><Stock /></ProtectedRoute>} />
              <Route path="/produits-finis" element={<ProtectedRoute roles={['ADMIN']}><ProduitsFinis /></ProtectedRoute>} />
              <Route path="/tri/etiquettes" element={<ProtectedRoute roles={['ADMIN', 'COLLABORATEUR']} module="etiquettes"><EtiquetteGenerer /></ProtectedRoute>} />
              <Route path="/inventaire/sortie-cartons" element={<ProtectedRoute roles={['ADMIN', 'COLLABORATEUR']}><SortieCartons /></ProtectedRoute>} />
              <Route path="/admin/catalogue" element={<ProtectedRoute roles={['ADMIN']}><AdminCatalogue /></ProtectedRoute>} />
              <Route path="/admin/refashion-config" element={<ProtectedRoute roles={['ADMIN']}><AdminRefashionConfig /></ProtectedRoute>} />
              <Route path="/admin/refashion-exports" element={<ProtectedRoute roles={['ADMIN', 'AUTORITE']}><AdminRefashionExports /></ProtectedRoute>} />
              <Route path="/admin/communes" element={<ProtectedRoute roles={['ADMIN']}><AdminCommunes /></ProtectedRoute>} />

              {/* Logistique */}
              <Route path="/exutoires-commandes" element={<ProtectedRoute roles={['ADMIN']}><ExutoiresCommandes /></ProtectedRoute>} />
              <Route path="/exutoires-preparation" element={<ProtectedRoute roles={['ADMIN']}><ExutoiresPreparation /></ProtectedRoute>} />
              <Route path="/exutoires-gantt" element={<ProtectedRoute roles={['ADMIN']}><ExutoiresGantt /></ProtectedRoute>} />
              <Route path="/exutoires-controle-facturation" element={<ProtectedRoute roles={['ADMIN']}><ExutoiresControleFacturation /></ProtectedRoute>} />
              <Route path="/exutoires-calendrier" element={<ProtectedRoute roles={['ADMIN']}><ExutoiresCalendrier /></ProtectedRoute>} />
              <Route path="/exutoires-clients" element={<ProtectedRoute roles={['ADMIN']}><ExutoiresClients /></ProtectedRoute>} />
              <Route path="/exutoires-tarifs" element={<ProtectedRoute roles={['ADMIN']}><ExutoiresTarifs /></ProtectedRoute>} />
              <Route path="/inventaire-original" element={<ProtectedRoute roles={['ADMIN']}><InventaireOriginal /></ProtectedRoute>} />

              {/* Reporting */}
              <Route path="/performance" element={<ProtectedRoute roles={['ADMIN']}><PerformanceDashboard /></ProtectedRoute>} />
              <Route path="/dashboard-executif" element={<ProtectedRoute roles={['ADMIN']}><DashboardExecutif /></ProtectedRoute>} />
              <Route path="/reporting-collecte" element={<ProtectedRoute roles={['ADMIN', 'AUTORITE']}><ReportingCollecte /></ProtectedRoute>} />
              <Route path="/reporting-rh" element={<ProtectedRoute roles={['ADMIN', 'RH']}><ReportingRH /></ProtectedRoute>} />
              <Route path="/reporting-production" element={<ProtectedRoute roles={['ADMIN']}><ReportingProduction /></ProtectedRoute>} />
              <Route path="/reporting" element={<Navigate to="/reporting-collecte" />} />
              <Route path="/refashion" element={<ProtectedRoute roles={['ADMIN', 'AUTORITE']}><Refashion /></ProtectedRoute>} />
              <Route path="/reporting-metropole" element={<ProtectedRoute roles={['ADMIN', 'AUTORITE']}><ReportingMetropole /></ProtectedRoute>} />

              {/* Facturation — la facturation interne /billing est retirée (arbitrage A2 audit 2026-07) */}
              <Route path="/pennylane" element={<ProtectedRoute roles={['ADMIN']}><Pennylane /></ProtectedRoute>} />
              <Route path="/admin/pennylane-config" element={<ProtectedRoute roles={['ADMIN']}><PennylaneConfig /></ProtectedRoute>} />

              {/* Finance */}
              {/* FINANCE (consultation) : accès en lecture aux vues finance. La page
                  d'import (écriture) reste ADMIN/MANAGER. Les boutons d'écriture des
                  autres pages 403 côté API pour FINANCE (masquage bouton = hors périmètre). */}
              <Route path="/finance" element={<ProtectedRoute roles={['ADMIN']}><Finance /></ProtectedRoute>} />
              <Route path="/finance/import" element={<ProtectedRoute roles={['ADMIN']}><FinanceImport /></ProtectedRoute>} />
              <Route path="/finance/operations" element={<ProtectedRoute roles={['ADMIN']}><FinanceOperations /></ProtectedRoute>} />
              <Route path="/finance/rentabilite" element={<ProtectedRoute roles={['ADMIN']}><FinanceRentabilite /></ProtectedRoute>} />
              <Route path="/finance/tresorerie" element={<ProtectedRoute roles={['ADMIN']}><FinanceTresorerie /></ProtectedRoute>} />
              <Route path="/finance/pl" element={<ProtectedRoute roles={['ADMIN']}><FinancePL /></ProtectedRoute>} />
              <Route path="/finance/bilan" element={<ProtectedRoute roles={['ADMIN']}><FinanceBilan /></ProtectedRoute>} />
              <Route path="/finance/controles" element={<ProtectedRoute roles={['ADMIN']}><FinanceControles /></ProtectedRoute>} />

              {/* Pilotage RSE (RSEI-10 — 28e module, labellisation RSEi) */}
              <Route path="/rse" element={<ProtectedRoute roles={['ADMIN', 'RH']}><PilotageRSE /></ProtectedRoute>} />

              {/* Énergie & GES (RSEI-11 — 29e module, critère RSEi 4.2) */}
              <Route path="/energie" element={<ProtectedRoute roles={['ADMIN', 'RH']}><EnergieGES /></ProtectedRoute>} />

              {/* Achats responsables (RSEI-17 — 31e module, critère RSEi 1.7) */}
              <Route path="/achats" element={<ProtectedRoute roles={['ADMIN', 'RH']}><AchatsResponsables /></ProtectedRoute>} />

              {/* Enquêtes (RSEI-13 — 30e module) — administration ; la réponse publique /enquete/:token est hors auth */}
              <Route path="/enquetes" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Enquetes /></ProtectedRoute>} />

              {/* Temps & Présence (badgeuse) — 33e module, pointage par badge RFID (Le Houlme) */}
              <Route path="/badgeuse" element={<ProtectedRoute roles={['ADMIN', 'RH', 'COMMUNICATION']}><TempsPresence /></ProtectedRoute>} />

              {/* QHSE (item 58 — accidents, habilitations, EPI) */}
              <Route path="/qhse" element={<Navigate to="/qhse/accidents" replace />} />
              <Route path="/qhse/accidents" element={<ProtectedRoute roles={['ADMIN']}><Qhse tab="accidents" /></ProtectedRoute>} />
              <Route path="/qhse/habilitations" element={<ProtectedRoute roles={['ADMIN']}><Qhse tab="habilitations" /></ProtectedRoute>} />
              <Route path="/qhse/epi" element={<ProtectedRoute roles={['ADMIN']}><Qhse tab="epi" /></ProtectedRoute>} />
              <Route path="/qhse/documents" element={<ProtectedRoute roles={['ADMIN']}><Qhse tab="documents" /></ProtectedRoute>} />
              <Route path="/qhse/rex" element={<ProtectedRoute roles={['ADMIN']}><Qhse tab="rex" /></ProtectedRoute>} />

              {/* Administration */}
              <Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><Users /></ProtectedRoute>} />
              <Route path="/admin/permissions" element={<ProtectedRoute roles={['ADMIN']}><AdminPermissions /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute roles={['ADMIN']}><Settings /></ProtectedRoute>} />
              <Route path="/referentiels" element={<Navigate to="/admin/catalogue" replace />} />
              <Route path="/admin-predictive" element={<ProtectedRoute roles={['ADMIN']}><AdminPredictive /></ProtectedRoute>} />
              <Route path="/admin-alert-thresholds" element={<ProtectedRoute roles={['ADMIN']}><AdminAlertThresholds /></ProtectedRoute>} />
              <Route path="/rgpd" element={<ProtectedRoute roles={['ADMIN', 'DPO']}><RGPD /></ProtectedRoute>} />
              <Route path="/admin-db" element={<ProtectedRoute roles={['ADMIN']}><AdminDB /></ProtectedRoute>} />
              <Route path="/activity-log" element={<ProtectedRoute roles={['ADMIN']}><ActivityLog /></ProtectedRoute>} />
              <Route path="/admin-cav" element={<ProtectedRoute roles={['ADMIN']}><AdminCAV /></ProtectedRoute>} />
              <Route path="/admin-sensors" element={<ProtectedRoute roles={['ADMIN']}><AdminSensors /></ProtectedRoute>} />
              <Route path="/admin-stock-original" element={<ProtectedRoute roles={['ADMIN']}><AdminStockOriginal /></ProtectedRoute>} />
              <Route path="/admin-associations" element={<ProtectedRoute roles={['ADMIN']}><AdminAssociations /></ProtectedRoute>} />
              <Route path="/admin-collaborators-import" element={<ProtectedRoute roles={['ADMIN', 'RH']}><AdminCollaboratorsImport /></ProtectedRoute>} />
              <Route path="/news" element={<ProtectedRoute><NewsFeed /></ProtectedRoute>} />
              <Route path="/messagerie" element={<ProtectedRoute><Messagerie /></ProtectedRoute>} />

              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErreurApplication>
  );
}

export default App;
