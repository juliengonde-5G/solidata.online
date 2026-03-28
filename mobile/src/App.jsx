import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-solidata-green flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
    </div>
  );
  if (!user) return <Navigate to="/login" />;
  return children;
}

function SolidataBotWrapper() {
  const { user } = useAuth();
  if (!user) return null;
  return <SolidataBot />;
}

function App() {
  useEffect(() => {
    // Démarrer la synchronisation automatique offline/online
    startAutoSync();
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/vehicle-select" element={<ProtectedRoute><VehicleSelect /></ProtectedRoute>} />
          <Route path="/checklist" element={<ProtectedRoute><Checklist /></ProtectedRoute>} />
          <Route path="/tour-map" element={<ProtectedRoute><TourMap /></ProtectedRoute>} />
          <Route path="/qr-scanner" element={<ProtectedRoute><QRScanner /></ProtectedRoute>} />
          <Route path="/fill-level" element={<ProtectedRoute><FillLevel /></ProtectedRoute>} />
          <Route path="/qr-unavailable" element={<ProtectedRoute><QRUnavailable /></ProtectedRoute>} />
          <Route path="/incident" element={<ProtectedRoute><Incident /></ProtectedRoute>} />
          <Route path="/return-centre" element={<ProtectedRoute><ReturnCentre /></ProtectedRoute>} />
          <Route path="/weigh-in" element={<ProtectedRoute><WeighIn /></ProtectedRoute>} />
          <Route path="/tour-summary" element={<ProtectedRoute><TourSummary /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
        <BatteryAlert />
        <SolidataBotWrapper />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
