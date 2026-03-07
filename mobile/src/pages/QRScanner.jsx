import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';

export default function QRScanner() {
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    startScanner();
    return () => stopScanner();
  }, []);

  const startScanner = async () => {
    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          setResult(decodedText);
          setScanning(false);
          stopScanner();
          // Store scanned QR and go to fill level
          localStorage.setItem('scanned_qr', decodedText);
          navigate('/fill-level');
        },
        () => {} // ignore errors during scan
      );
    } catch (err) {
      setError('Impossible d\'accéder à la caméra. Vérifiez les permissions.');
      setScanning(false);
    }
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
  };

  const skipQR = () => {
    stopScanner();
    navigate('/qr-unavailable');
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="bg-solidata-green text-white p-3 flex items-center justify-between flex-shrink-0">
        <button onClick={() => { stopScanner(); navigate('/tour-map'); }} className="text-white/70 text-sm">← Carte</button>
        <h1 className="font-bold">Scanner QR Code</h1>
        <button onClick={skipQR} className="bg-white/20 rounded-lg px-3 py-1.5 text-xs">QR absent</button>
      </header>

      {/* Scanner area */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {error ? (
          <div className="text-center">
            <p className="text-red-400 mb-4">{error}</p>
            <button onClick={skipQR} className="bg-solidata-green text-white px-6 py-3 rounded-xl font-bold">
              Saisie manuelle
            </button>
          </div>
        ) : (
          <>
            <div className="relative w-full max-w-sm aspect-square rounded-2xl overflow-hidden">
              <div id="qr-reader" className="w-full h-full"></div>
              {/* Overlay frame */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-solidata-green rounded-tl-xl"></div>
                <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-solidata-green rounded-tr-xl"></div>
                <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-solidata-green rounded-bl-xl"></div>
                <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-solidata-green rounded-br-xl"></div>
              </div>
            </div>
            <p className="text-white/50 text-sm mt-4">Visez le QR code du conteneur</p>
          </>
        )}
      </div>
    </div>
  );
}
