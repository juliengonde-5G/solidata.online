import { useState, useEffect, useRef } from 'react';
import { Tv, Calendar, Cloud, CloudRain, Sun, CloudSnow, Zap } from 'lucide-react';
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line, CartesianGrid } from 'recharts';
import io from 'socket.io-client';
import api from '../services/api';

/**
 * Page Live — destinée à être affichée plein écran sur un grand écran TV
 * pendant la VAK. Pas de Layout / sidebar. Socket.IO temps réel.
 */
function formatEuro(v, decimals = 0) {
  return `${Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} €`;
}
function formatNumber(v, decimals = 0) {
  return Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function weatherIcon(code) {
  if (code == null) return Cloud;
  if (code <= 1) return Sun;
  if (code <= 3) return Cloud;
  if (code >= 61 && code <= 67) return CloudRain;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 80 && code <= 82) return CloudRain;
  if (code >= 95) return Zap;
  return Cloud;
}

// Compteur animé sur valeur cible (interpolation 800ms)
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(target || 0);
  const fromRef = useRef(target || 0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    fromRef.current = value;
    startRef.current = Date.now();
    const from = value;
    const to = Number(target) || 0;
    let raf;
    const step = () => {
      const t = Math.min(1, (Date.now() - startRef.current) / duration);
      setValue(from + (to - from) * (1 - Math.pow(1 - t, 3))); // easeOutCubic
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return value;
}

export default function VakLive() {
  const [data, setData] = useState(null);
  const [counters, setCounters] = useState({ ca_jour: 0, poids_jour: 0, tickets_jour: 0, ca_vak: 0, poids_vak: 0, tickets_vak: 0 });
  const [ticker, setTicker] = useState([]);
  const [hourlyChart, setHourlyChart] = useState([]);
  const [now, setNow] = useState(new Date());
  const socketRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadCurrent();
    const refresh = setInterval(loadCurrent, 60_000); // refresh état toutes les minutes
    return () => clearInterval(refresh);
  }, []);

  async function loadCurrent() {
    try {
      const r = await api.get('/vak/live/current');
      setData(r.data);
      if (r.data?.counters) setCounters(r.data.counters);
      if (r.data?.recent) setTicker(r.data.recent);
      if (r.data?.current) {
        loadHourly(r.data.current.id);
        connectSocket(r.data.current.id);
      }
    } catch (err) {
      console.error('VAK live current', err);
    }
  }

  async function loadHourly(vakId) {
    try {
      const r = await api.get(`/vak/${vakId}/analytics/hourly`);
      setHourlyChart((r.data?.by_hour || []).map((h) => ({ ...h, heure: `${h.heure}h` })));
    } catch (_) { /* silent */ }
  }

  function connectSocket(vakId) {
    if (socketRef.current) return;
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    const socket = io(window.location.origin, { auth: { token } });
    socketRef.current = socket;
    socket.on('connect', () => {
      socket.emit('vak:join', vakId);
    });
    socket.on('vak:live:counters', (c) => {
      setCounters((prev) => ({ ...prev, ...c }));
    });
    socket.on('vak:live:transaction', (tx) => {
      setTicker((prev) => [tx, ...prev].slice(0, 10));
      // recharge silencieusement le bar chart horaire au prochain refresh
      loadHourly(vakId);
    });
  }

  useEffect(() => () => {
    if (socketRef.current) {
      try { socketRef.current.disconnect(); } catch (_) { /* ok */ }
      socketRef.current = null;
    }
  }, []);

  const ca = useCountUp(counters.ca_jour);
  const poids = useCountUp(counters.poids_jour);
  const tickets = useCountUp(counters.tickets_jour);

  if (!data) {
    return <KioskScreen title="Chargement…" />;
  }

  if (!data.current) {
    const next = data.next;
    return (
      <KioskScreen title="Aucune VAK en cours">
        {next ? (
          <div className="text-center">
            <Calendar className="w-24 h-24 mx-auto text-orange-300 mb-6" />
            <p className="text-3xl font-light text-slate-200">Prochaine VAK</p>
            <p className="text-5xl font-bold text-white mt-3">{next.libelle}</p>
            <p className="text-2xl text-orange-300 mt-2">
              {new Date(next.date_debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' → '}
              {new Date(next.date_fin).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        ) : (
          <p className="text-2xl text-slate-300">Aucune VAK planifiée prochainement</p>
        )}
      </KioskScreen>
    );
  }

  const vak = data.current;
  const objCa = Number(vak.ca_objectif_ttc || 0);
  const pctCa = objCa > 0 ? (counters.ca_vak / objCa) * 100 : null;
  const objPoids = Number(vak.poids_objectif_kg || 0);
  const pctPoids = objPoids > 0 ? (counters.poids_vak / objPoids) * 100 : null;
  const WeatherIcon = weatherIcon(data.meteo?.weather_code);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-orange-950 to-slate-900 text-white p-6 flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <Tv className="w-10 h-10 text-orange-400" />
          <div>
            <h1 className="text-4xl font-bold">{vak.libelle}</h1>
            <p className="text-orange-300 text-sm">
              {new Date(vak.date_debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              {vak.date_debut !== vak.date_fin && (
                <> → {new Date(vak.date_fin).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</>
              )}
              <span className="ml-3 opacity-70">• {vak.lieu}</span>
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-5xl font-mono font-bold tabular-nums">{now.toLocaleTimeString('fr-FR')}</div>
          {data.meteo && (
            <div className="flex items-center justify-end gap-2 mt-2 text-slate-300">
              <WeatherIcon className="w-6 h-6" />
              <span>{data.meteo.weather_label}</span>
              {data.meteo.temp_max != null && <span>{Number(data.meteo.temp_max).toFixed(0)}°C</span>}
            </div>
          )}
        </div>
      </div>

      {/* 3 gros compteurs animés */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <BigCounter
          label="CA jour"
          value={formatEuro(ca)}
          subtitle={`Cumul VAK : ${formatEuro(counters.ca_vak)}`}
          color="from-orange-500 to-amber-500"
        />
        <BigCounter
          label="Poids vendu"
          value={`${formatNumber(poids, 1)} kg`}
          subtitle={`Cumul VAK : ${formatNumber(counters.poids_vak, 1)} kg`}
          color="from-violet-500 to-fuchsia-500"
        />
        <BigCounter
          label="Tickets"
          value={formatNumber(Math.round(tickets))}
          subtitle={`Cumul VAK : ${counters.tickets_vak || 0}`}
          color="from-cyan-500 to-sky-500"
        />
      </div>

      {/* Jauges objectif */}
      {(pctCa !== null || pctPoids !== null) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {pctCa !== null && (
            <ProgressBar label="Objectif CA" current={counters.ca_vak} target={objCa} pct={pctCa}
              format={(v) => formatEuro(v)} color="bg-orange-500" />
          )}
          {pctPoids !== null && (
            <ProgressBar label="Objectif poids" current={counters.poids_vak} target={objPoids} pct={pctPoids}
              format={(v) => `${formatNumber(v, 1)} kg`} color="bg-violet-500" />
          )}
        </div>
      )}

      {/* Charts + Ticker */}
      <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="col-span-2 bg-white/5 backdrop-blur rounded-2xl p-4 border border-white/10">
          <h3 className="text-lg font-semibold text-slate-200 mb-2">CA & tickets par heure</h3>
          {hourlyChart.length === 0 ? (
            <p className="text-slate-400 text-center py-8">En attente des premières ventes…</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={hourlyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="heure" fontSize={12} stroke="#94a3b8" />
                <YAxis yAxisId="left" fontSize={12} stroke="#94a3b8" tickFormatter={(v) => `${v}€`} />
                <YAxis yAxisId="right" orientation="right" fontSize={12} stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', color: 'white' }}
                  formatter={(v, n) => n === 'Tickets' ? Math.round(v) : formatEuro(v, 2)} />
                <Bar yAxisId="left" dataKey="ca_ttc" fill="#F97316" name="CA (€)" radius={[6, 6, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="nb_tickets" stroke="#22D3EE" name="Tickets" strokeWidth={3} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white/5 backdrop-blur rounded-2xl p-4 border border-white/10 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-200 mb-3">Dernières ventes</h3>
          {ticker.length === 0 ? (
            <p className="text-slate-400 text-sm">En attente…</p>
          ) : (
            <ul className="space-y-2 flex-1 overflow-y-auto">
              {ticker.map((t, i) => (
                <li key={t.id || i} className={`bg-white/5 rounded-lg px-3 py-2 flex items-center justify-between ${i === 0 ? 'ring-2 ring-orange-400 animate-pulse-once' : ''}`}>
                  <div>
                    <div className="text-xs text-slate-400">
                      {new Date(t.date_ticket || Date.now()).toLocaleTimeString('fr-FR')}
                    </div>
                    <div className="text-sm text-slate-200">
                      {t.moyen_paiement || '—'}{' • '}
                      {Number(t.poids_kg || 0) > 0 ? `${Number(t.poids_kg).toFixed(2)} kg` : `${t.nb_articles || 0} article(s)`}
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-orange-300">{formatEuro(t.total_ttc, 2)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function KioskScreen({ title, children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-orange-950 to-slate-900 text-white flex flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-bold mb-8 text-orange-300">{title}</h1>
      {children}
    </div>
  );
}

function BigCounter({ label, value, subtitle, color }) {
  return (
    <div className={`bg-gradient-to-br ${color} rounded-3xl p-6 shadow-2xl`}>
      <div className="text-sm uppercase tracking-wider text-white/80">{label}</div>
      <div className="text-6xl xl:text-7xl font-bold text-white mt-2 tabular-nums">{value}</div>
      {subtitle && <div className="text-sm text-white/70 mt-3">{subtitle}</div>}
    </div>
  );
}

function ProgressBar({ label, current, target, pct, format, color }) {
  const capped = Math.min(100, Math.max(0, pct));
  return (
    <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
      <div className="flex justify-between text-sm mb-2">
        <span className="text-slate-300">{label}</span>
        <span className={`font-bold ${pct >= 100 ? 'text-green-400' : pct >= 80 ? 'text-amber-300' : 'text-orange-300'}`}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-3 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all duration-700`} style={{ width: `${capped}%` }} />
      </div>
      <div className="flex justify-between text-xs text-slate-400 mt-2">
        <span>{format(current)}</span>
        <span>/ {format(target)}</span>
      </div>
    </div>
  );
}
