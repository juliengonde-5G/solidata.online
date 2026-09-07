import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { UsageModeProvider } from './contexts/UsageModeContext';
import { startAutoSync, cacheReferenceData } from './services/sync';
import Login from './pages/Login';
import VehicleLogin from './pages/VehicleLogin';
import BatteryAlert from './components/BatteryAlert';
import SyncStatusBanner from './components/SyncStatusBanner';
import DriverMessageBanner from './components/DriverMessageBanner';
import DemoModeBanner from './components/DemoModeBanner';
import BoutonAssistance from './components/BoutonAssistance';
import NouveauMessageBanner from './components/messagerie/NouveauMessageBanner';
import ErreurApplication from './components/ErreurApplication';
import VehicleSelect from './pages/VehicleSelect';
import Checklist from './pages/Checklist';
import TourMap from './pages/TourMap';
import IdentifyCav from './pages/IdentifyCav';
import FillLevel from './pages/FillLevel';
import AssociationStop from './pages/AssociationStop';
import DecheterieBordereau from './pages/DecheterieBordereau';
import Incident from './pages/Incident';
import ReturnCentre from './pages/ReturnCentre';
import WeighIn from './pages/WeighIn';
import TourSummary from './pages/TourSummary';
import TourHistory from './pages/TourHistory';
import EndOfDayChecklist from './pages/EndOfDayChecklist';
import Messages from './pages/Messages';

function App() {
  useEffect(() => {
    startAutoSync();
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <UsageModeProvider>
          <SyncStatusBanner />
          <DriverMessageBanner />
          <DemoModeBanner />
          <NouveauMessageBanner />
          {/* Dernier rempart : un écran qui plante au rendu ne doit JAMAIS
              laisser un chauffeur devant une page blanche (cf. tournées
              association, 27/08/2026). Les bandeaux restent hors du rempart :
              « Hors ligne — rien n'est perdu » doit survivre au plantage. */}
          <ErreurApplication>
          <Routes>
            {/* Auth chauffeur — point d'entrée principal (raccourci écran d'accueil).
                « 1 URL = 1 véhicule » : voir mobile/src/pages/VehicleLogin.jsx. */}
            <Route path="/v/:token" element={<VehicleLogin />} />
            {/* Landing « pas d'accès » pour tout arrivée hors flux URL véhicule. */}
            <Route path="/login" element={<Navigate to="/start" />} />
            <Route path="/start" element={<Login />} />
            <Route path="/vehicle-select" element={<VehicleSelect />} />
            <Route path="/checklist" element={<Checklist />} />
            <Route path="/tour-map" element={<TourMap />} />
            <Route path="/identify-cav" element={<IdentifyCav />} />
            {/* Alias rétro-compat — redirigent vers le flux unifié */}
            <Route path="/qr-scanner" element={<Navigate to="/identify-cav" replace />} />
            <Route path="/qr-unavailable" element={<Navigate to="/identify-cav" replace />} />
            <Route path="/fill-level" element={<FillLevel />} />
            <Route path="/association-stop" element={<AssociationStop />} />
            {/* Bordereau Métropole après la collecte d'une déchèterie (2.50.0) */}
            <Route path="/decheterie-bordereau" element={<DecheterieBordereau />} />
            <Route path="/incident" element={<Incident />} />
            <Route path="/return-centre" element={<ReturnCentre />} />
            <Route path="/weigh-in" element={<WeighIn />} />
            <Route path="/tour-summary" element={<TourSummary />} />
            <Route path="/tour-history" element={<TourHistory />} />
            <Route path="/end-of-day" element={<EndOfDayChecklist />} />
            {/* Messagerie interne — mode conduite (lot L3, 26/08/2026) */}
            <Route path="/messages" element={<Messages />} />
            <Route path="*" element={<Navigate to="/start" />} />
          </Routes>
          </ErreurApplication>
          <BatteryAlert />
          {/* UN SEUL bouton flottant (28/08/2026) : il réunit l'assistant, la
              messagerie et l'historique des notifications. Avant, deux bulles
              rondes à la même icône flottaient en bas d'écran — le client les
              lisait comme « le bouton messagerie deux fois ». */}
          <BoutonAssistance />
        </UsageModeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
