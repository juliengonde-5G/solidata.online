import { useState, useEffect } from 'react';

export default function BatteryAlert() {
  const [batteryLevel, setBatteryLevel] = useState(null);
  const [isCharging, setIsCharging] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(battery => {
      setBatteryLevel(Math.round(battery.level * 100));
      setIsCharging(battery.charging);
      battery.addEventListener('levelchange', () => {
        setBatteryLevel(Math.round(battery.level * 100));
        if (battery.level <= 0.15) setDismissed(false);
      });
      battery.addEventListener('chargingchange', () => setIsCharging(battery.charging));
    }).catch(() => {});
  }, []);

  if (dismissed || batteryLevel === null || batteryLevel > 20 || isCharging) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] px-4 pt-2">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
        batteryLevel <= 10 ? 'bg-red-500 text-white' : 'bg-amber-400 text-amber-900'
      }`}>
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="2" y="7" width="18" height="10" rx="2" strokeWidth={2} />
          <path d="M22 11v2" strokeLinecap="round" strokeWidth={2} />
          <rect x="4" y="9" width={Math.max(1, batteryLevel / 100 * 14)} height="6" rx="1" fill="currentColor" />
        </svg>
        <span>Batterie faible : {batteryLevel}% — Pense a recharger !</span>
        <button onClick={() => setDismissed(true)} className="ml-auto p-1 rounded hover:opacity-70">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
