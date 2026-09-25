import { useEffect, useId, useRef, useState } from 'react';
import { Camera, CameraOff, Flashlight, SwitchCamera } from 'lucide-react';

// Lecture des codes-barres par la caméra d'un smartphone ou d'une tablette,
// directement dans le navigateur (2.57.1, demande client).
//
// La bibliothèque (html5-qrcode, déjà utilisée par l'application chauffeur)
// n'est chargée QU'À l'ouverture de la caméra : un poste fixe équipé d'une
// douchette ne la télécharge jamais. Elle s'appuie sur le décodeur natif du
// navigateur quand il existe (BarcodeDetector : Chrome Android) et retombe sur
// son propre décodeur sinon (Safari iPhone / iPad).
//
// Le composant ne décide RIEN : il remet le texte lu à `onScan`, le même point
// d'entrée que la douchette et la saisie manuelle — même file, même bip, même
// flash, même ligne au journal.
//
// Une douchette lit un code une fois par appui ; une caméra, elle, relit le
// même carton plusieurs fois par seconde tant qu'il reste dans le cadre. Un
// délai fixe ne suffit pas : un carton tenu 5 s devant l'objectif serait remis
// deux fois, et le second passage afficherait « Déjà sorti » sur un carton qui
// vient de sortir. Un code n'est donc remis que s'il a QUITTÉ le cadre depuis
// au moins ABSENCE_MS — pour le relire, on l'écarte puis on le représente.
const ABSENCE_MS = 1500;

function messageErreur(err) {
  const nom = err?.name || '';
  const texte = String(err?.message || err || '');
  if (!window.isSecureContext) {
    return 'La caméra n\'est accessible que sur une adresse sécurisée (https).';
  }
  if (nom === 'NotAllowedError' || /permission|denied|not allowed/i.test(texte)) {
    return 'Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur, puis réessayez.';
  }
  if (nom === 'NotFoundError' || /not found|no camera|requested device not found/i.test(texte)) {
    return 'Aucune caméra détectée sur cet appareil.';
  }
  if (nom === 'NotReadableError' || /in use|could not start|notreadable/i.test(texte)) {
    return 'La caméra est déjà utilisée par une autre application. Fermez-la puis réessayez.';
  }
  return `Impossible de démarrer la caméra${texte ? ` : ${texte}` : ''}.`;
}

export default function ScanCamera({ onScan, onClose }) {
  const idBrut = useId();
  const zoneId = `scan-camera-${idBrut.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const scannerRef = useRef(null);
  const derniersRef = useRef(new Map());
  const onScanRef = useRef(onScan);
  const [etat, setEtat] = useState('demarrage'); // demarrage | actif | erreur
  const [erreur, setErreur] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [cameraIndex, setCameraIndex] = useState(-1); // -1 = caméra arrière par défaut
  const [torcheDispo, setTorcheDispo] = useState(false);
  const [torche, setTorche] = useState(false);
  const [essai, setEssai] = useState(0);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    let annule = false;
    let scanner = null;
    setEtat('demarrage');
    setErreur(null);
    setTorche(false);
    setTorcheDispo(false);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error('API caméra indisponible dans ce navigateur'), { name: 'NotSupportedError' });
        }
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (annule) return;
        scanner = new Html5Qrcode(zoneId, {
          verbose: false,
          // Les étiquettes portent un CODE128 ; le QR est accepté pour les
          // planches et les anciens supports.
          formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.QR_CODE],
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        scannerRef.current = scanner;

        const source = cameraIndex >= 0 && cameras[cameraIndex]
          ? cameras[cameraIndex].id
          : { facingMode: 'environment' };

        await scanner.start(
          source,
          {
            fps: 10,
            // Cadre large et bas : un code-barres linéaire est horizontal.
            qrbox: (largeur, hauteur) => ({
              width: Math.max(160, Math.floor(largeur * 0.85)),
              height: Math.max(80, Math.floor(Math.min(hauteur * 0.45, largeur * 0.45))),
            }),
            aspectRatio: 1.333,
          },
          (texte) => {
            const code = String(texte || '').trim();
            if (!code) return;
            const maintenant = Date.now();
            const vuLe = derniersRef.current.get(code);
            derniersRef.current.set(code, maintenant); // dernière fois VU, remis ou non
            if (vuLe && maintenant - vuLe < ABSENCE_MS) return;
            try { navigator.vibrate?.(60); } catch { /* ignore */ }
            onScanRef.current?.(code);
          },
          () => { /* aucun code dans l'image : normal, ignoré */ },
        );
        if (annule) { scanner.stop().catch(() => {}); return; }
        setEtat('actif');

        try {
          const capacites = scanner.getRunningTrackCapabilities?.();
          setTorcheDispo(!!capacites?.torch);
        } catch { /* ignore */ }

        if (cameras.length === 0) {
          Html5Qrcode.getCameras()
            .then((liste) => { if (!annule) setCameras(liste || []); })
            .catch(() => {});
        }
      } catch (e) {
        if (annule) return;
        setErreur(messageErreur(e));
        setEtat('erreur');
      }
    })();

    return () => {
      annule = true;
      const s = scanner;
      scannerRef.current = null;
      if (s) {
        s.stop().catch(() => {}).finally(() => { try { s.clear(); } catch { /* ignore */ } });
      }
    };
    // `cameras` n'est lu qu'au démarrage : le changer ne doit pas relancer le flux.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, cameraIndex, essai]);

  const basculerTorche = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      await s.applyVideoConstraints({ advanced: [{ torch: !torche }] });
      setTorche(!torche);
    } catch {
      setTorcheDispo(false);
    }
  };

  const cameraSuivante = () => {
    if (cameras.length < 2) return;
    setCameraIndex((i) => (i + 1) % cameras.length);
  };

  return (
    <div className="w-full flex flex-col items-center gap-3 p-3">
      <div className="relative w-full max-w-xl rounded-2xl overflow-hidden bg-black min-h-[220px]">
        <div id={zoneId} className="w-full" />
        {etat === 'demarrage' && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
            Démarrage de la caméra…
          </div>
        )}
        {etat === 'erreur' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-slate-800 text-white gap-3">
            <CameraOff className="w-10 h-10 opacity-80" />
            <div className="text-sm max-w-sm">{erreur}</div>
            <button
              type="button"
              onClick={() => setEssai((n) => n + 1)}
              className="px-4 py-2 rounded-lg bg-white text-slate-800 text-sm font-semibold"
            >
              Réessayer
            </button>
          </div>
        )}
      </div>

      <div className="text-sm text-slate-500 text-center">
        Placez le code-barres de l'étiquette dans le cadre, bien à plat et éclairé.
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {torcheDispo && (
          <button
            type="button"
            onClick={basculerTorche}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold ${torche ? 'bg-amber-400 text-slate-900' : 'bg-slate-100 text-slate-700'}`}
          >
            <Flashlight className="w-4 h-4" /> {torche ? 'Éteindre la lampe' : 'Lampe'}
          </button>
        )}
        {cameras.length > 1 && (
          <button
            type="button"
            onClick={cameraSuivante}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold"
          >
            <SwitchCamera className="w-4 h-4" /> Changer de caméra
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-semibold"
        >
          <Camera className="w-4 h-4" /> Fermer la caméra
        </button>
      </div>
    </div>
  );
}
