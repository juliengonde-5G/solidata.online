import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { UsageModeProvider } from './contexts/UsageModeContext';
import { startAutoSync, cacheReferenceData } from './services/sync';
import Login from './pages/Login';
import BatteryAlert from './components/BatteryAlert';
import SolidataBot from './components/SolidataBot';
import SyncStatusBanner from './components/SyncStatusBanner';
import VehicleSelect from './pages/VehicleSelect';
import Checklist from './pages/Checklist';
import TourMap from './pages/TourMap';
import IdentifyCav from './pages/IdentifyCav';
import FillLevel from './pages/FillLevel';
import Incident from './pages/Incident';
import ReturnCentre from './pages/ReturnCentre';
import WeighIn from './pages/WeighIn';
import TourSummary from './pages/TourSummary';
import TourHistory from './pages/TourHistory';

function App() {
  useEffect(() => {
    startAutoSync();
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <UsageModeProvider>
          <SyncStatusBanner />
          <Routes>
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
            <Route path="/incident" element={<Incident />} />
            <Route path="/return-centre" element={<ReturnCentre />} />
            <Route path="/weigh-in" element={<WeighIn />} />
            <Route path="/tour-summary" element={<TourSummary />} />
            <Route path="/tour-history" element={<TourHistory />} />
            <Route path="*" element={<Navigate to="/start" />} />
          </Routes>
          <BatteryAlert />
          <SolidataBot />
        </UsageModeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
