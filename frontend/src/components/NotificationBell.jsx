import { useState, useRef, useEffect } from 'react';
import { Bell, AlertTriangle, Info, X } from 'lucide-react';

export default function NotificationBell({ alerts = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const count = alerts.length;

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-white rounded-card border border-slate-200 shadow-elevated z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {count === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Aucune notification</p>
            ) : (
              alerts.map((alert, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-slate-50 last:border-b-0 ${
                    alert.type === 'error' ? 'bg-red-50/50' : alert.type === 'warning' ? 'bg-amber-50/50' : ''
                  }`}
                >
                  <span className="flex-shrink-0 mt-0.5">
                    {alert.type === 'warning' || alert.type === 'error' ? (
                      <AlertTriangle className={`w-4 h-4 ${alert.type === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
                    ) : (
                      <Info className="w-4 h-4 text-blue-500" />
                    )}
                  </span>
                  <p className="text-sm text-slate-700 leading-snug">{alert.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
