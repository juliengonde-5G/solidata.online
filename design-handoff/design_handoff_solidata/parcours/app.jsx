// Parcours chauffeur — 6-step navigation
const { IOSDevice } = window;

const STEPS = [
  { id: 1, name: 'Connexion', short: 'Login' },
  { id: 2, name: 'Tournée',   short: 'Tournée' },
  { id: 3, name: 'Check-list', short: 'Check' },
  { id: 4, name: 'Navigation', short: 'GPS' },
  { id: 5, name: 'Scan CAV',  short: 'Scan' },
  { id: 6, name: 'Remplissage', short: 'CAV' },
  { id: 7, name: 'Pesée',     short: 'Pesée' },
  { id: 8, name: 'Incident',  short: 'Incident' },
];

function App() {
  const [step, setStep] = React.useState(() => {
    const s = parseInt(localStorage.getItem('parcours-step') || '1', 10);
    return isNaN(s) ? 1 : Math.min(8, Math.max(1, s));
  });
  const [rerouted, setRerouted] = React.useState(false);
  const [toTri, setToTri] = React.useState(false);

  React.useEffect(() => {
    localStorage.setItem('parcours-step', String(step));
    // show reroute notif 1.2s after landing on nav step
    if (step === 4) {
      setRerouted(false);
      const t = setTimeout(() => setRerouted(true), 1200);
      return () => clearTimeout(t);
    }
  }, [step]);

  const go = (n) => setStep(Math.min(8, Math.max(1, n)));
  const next = () => go(step + 1);
  const back = () => go(step - 1);

  const screen = (() => {
    switch (step) {
      case 1: return <window.StepLogin onNext={next} />;
      case 2: return <window.StepJournee onNext={next} onBack={back} />;
      case 3: return <window.StepChecklist onNext={next} onBack={back} />;
      case 4: return <window.StepNavigation
                onNext={()=> toTri ? go(7) : go(5)}
                onBack={back}
                onIncident={()=>go(8)}
                rerouted={rerouted}
                toTri={toTri}
              />;
      case 5: return <window.StepScan onNext={next} onBack={back} />;
      case 6: return <window.StepRemplissage
                onNext={()=>go(5)}
                onBack={back}
                onIncident={()=>go(8)}
                onTruckFull={()=>{ setToTri(true); go(4); }}
              />;
      case 7: return <window.StepPesee onNext={()=>{ setToTri(false); go(4); }} onBack={back} />;
      case 8: return <window.StepIncident onBack={()=>go(4)} />;
      default: return null;
    }
  })();

  return (
    <>
      <div className="step-nav">
        {STEPS.map(s => (
          <button
            key={s.id}
            onClick={()=>go(s.id)}
            className={`${step === s.id ? 'active' : ''} ${step > s.id ? 'done' : ''}`}
            title={s.name}
          >
            <span className="num">{step > s.id ? '✓' : s.id}</span>
            <span>{s.short}</span>
          </button>
        ))}
      </div>

      <div className="phone-stage">
        <IOSDevice width={390} height={810}>
          {screen}
        </IOSDevice>
      </div>

      <button className="arrow-hint" onClick={next} disabled={step >= 8}>
        Étape suivante →
      </button>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
