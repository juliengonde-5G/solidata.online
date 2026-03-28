import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { startAutoSync, cacheReferenceData } from './services/sync';
import Login from './pages/Login';
import BatteryAlert from './components/BatteryAlert';
import SolidataBot from './components/SolidataBot';
import VehicleSelect from './pages/VehicleSelect';
import Checklist from './pages/Checklist';
import TourMap from './pages/TourMap';
import QRScanner from './pages/QRScanner';
import FillLevel from './pages/FillLevel';
import QRUnavailable from './pages/QRUnavailable';
import Incident from './pages/Incident';
import ReturnCentre from './pages/ReturnCentre';
import WeighIn from './pages/WeighIn';
import TourSummary from './pages/TourSummary';

function App() {
  useEffect(() => {
    startAutoSync();
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Navigate to="/start" />} />
          <Route path="/start" element={<Login />} />
          <Route path="/vehicle-select" element={<VehicleSelect />} />
          <Route path="/checklist" element={<Checklist />} />
          <Route path="/tour-map" element={<TourMap />} />
          <Route path="/qr-scanner" element={<QRScanner />} />
          <Route path="/fill-level" element={<FillLevel />} />
          <Route path="/qr-unavailable" element={<QRUnavailable />} />
          <Route path="/incident" element={<Incident />} />
          <Route path="/return-centre" element={<ReturnCentre />} />
          <Route path="/weigh-in" element={<WeighIn />} />
          <Route path="/tour-summary" element={<TourSummary />} />
          <Route path="*" element={<Navigate to="/start" />} />
        </Routes>
        <BatteryAlert />
        <SolidataBot />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
