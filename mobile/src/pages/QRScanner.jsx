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
    <div className="min-h-screen flex flex-col bg-gray-900">
      <header className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-gray-900 text-white">
        <button
          type="button"
          onClick={() => { stopScanner(); navigate('/tour-map'); }}
          className="touch-target flex items-center justify-center rounded-xl text-white/80 hover:bg-white/10 text-sm font-medium"
        >
          ← Carte
        </button>
        <h1 className="font-bold text-base">Scanner QR Code</h1>
        <button
          type="button"
          onClick={skipQR}
          className="touch-target flex items-center justify-center rounded-xl bg-white/20 hover:bg-white/30 text-sm font-medium px-4"
        >
          QR absent
        </button>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {error ? (
          <div className="text-center max-w-sm">
            <p className="text-red-400 mb-6">{error}</p>
            <button type="button" onClick={skipQR} className="btn-primary-mobile py-3.5">
              Saisie manuelle
            </button>
          </div>
        ) : (
          <>
            <div className="relative w-full max-w-sm aspect-square rounded-3xl overflow-hidden ring-4 ring-white/20">
              <div id="qr-reader" className="w-full h-full" />
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-56 h-56 border-4 border-[var(--color-primary)] rounded-2xl" />
              </div>
            </div>
            <p className="text-white/60 text-sm mt-6">Visez le QR code du conteneur</p>
          </>
        )}
      </div>
    </div>
  );
}
