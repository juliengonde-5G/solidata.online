import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import { sensorsApi } from '../services/api';
import useCavSensorSocket from '../hooks/useCavSensorSocket';

/**
 * Vue flotte capteurs LoRaWAN — statut batterie, offline, alertes ouvertes.
 */
export default function AdminSensors() {
  const [sensors, setSensors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [loInfo, setLoInfo] = useState(null); // { total, assigned, orphans, devices }
  const [showOrphans, setShowOrphans] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await sensorsApi.list();
      setSensors(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
    // En parallèle : tenter de lister les devices Live Objects (silencieux si l'API n'est pas joignable)
    try {
      const lo = await sensorsApi.liveObjectsDevices();
      setLoInfo(lo);
    } catch (err) {
      setLoInfo({ total: 0, assigned: 0, orphans: 0, devices: [], error: err.response?.data?.error || err.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Update optimiste en temps réel sur event capteur
  const handleReading = useCallback((reading) => {
    setSensors((prev) => prev.map((s) => (s.id === reading.cav_id ? {
      ...s,
      sensor_last_reading: reading.fill_level,
      sensor_last_reading_at: reading.timestamp,
      sensor_battery_level: reading.battery,
      sensor_last_rssi: reading.rssi,
      computed_status: reading.battery != null && reading.battery <= 20 ? 'low_battery' : 'active',
    } : s)));
  }, []);
  useCavSensorSocket(handleReading);

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement de la flotte…" /></Layout>;

  const counts = sensors.reduce((acc, s) => {
    acc.total += 1;
    if (s.computed_status === 'active') acc.active += 1;
    else if (s.computed_status === 'offline') acc.offline += 1;
    else if (s.computed_status === 'low_battery') acc.low_battery += 1;
    else if (s.computed_status === 'never') acc.never += 1;
    if (s.open_alerts > 0) acc.alerts += 1;
    return acc;
  }, { total: 0, active: 0, offline: 0, low_battery: 0, never: 0, alerts: 0 });

  const filtered = filter === 'all' ? sensors : sensors.filter((s) => (
    filter === 'alerts' ? s.open_alerts > 0 : s.computed_status === filter
  ));

  return (
    <Layout>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              📡 Capteurs CAV LoRaWAN
            </h1>
            <p className="text-gray-500 text-sm">
              Flotte de sondes de remplissage Milesight EM400-MUD via Orange Live Objects — {counts.total} équipements
            </p>
          </div>
          {loInfo && loInfo.orphans > 0 && (
            <button onClick={() => setShowOrphans((v) => !v)}
              className="bg-orange-50 border border-orange-300 rounded-lg px-4 py-2 text-left hover:bg-orange-100 transition">
              <p className="text-xs text-orange-700 uppercase font-semibold">
                Orange Live Objects
              </p>
              <p className="text-sm text-orange-900">
                <strong>{loInfo.orphans}</strong> device{loInfo.orphans > 1 ? 's' : ''} déclaré{loInfo.orphans > 1 ? 's' : ''} mais non assigné{loInfo.orphans > 1 ? 's' : ''} à un CAV
              </p>
              <p className="text-[10px] text-orange-600 mt-0.5">
                {showOrphans ? 'Masquer la liste ▲' : 'Afficher la liste ▼'}
              </p>
            </button>
          )}
        </div>

        {showOrphans && loInfo?.devices && (
          <div className="card-modern p-4 border-orange-300">
            <h2 className="font-semibold text-sm mb-3 text-orange-800">
              Devices Live Objects non assignés
            </h2>
            <p className="text-xs text-gray-500 mb-3">
              Pour assigner un device, ouvrez la fiche d'un CAV dans <em>Administration → Gestion CAV</em>,
              section « Capteur LoRaWAN », bouton « Provisionner un capteur ».
            </p>
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase border-b">
                <tr>
                  <th className="px-2 py-1 text-left">DevEUI</th>
                  <th className="px-2 py-1 text-left">Nom</th>
                  <th className="px-2 py-1 text-left">Profil</th>
                  <th className="px-2 py-1 text-left">Dernier uplink</th>
                  <th className="px-2 py-1 text-left">Tags</th>
                </tr>
              </thead>
              <tbody>
                {loInfo.devices.filter((d) => !d.assigned_cav).map((d) => (
                  <tr key={d.devEui} className="border-b hover:bg-gray-50">
                    <td className="px-2 py-1 font-mono text-xs">{d.devEui}</td>
                    <td className="px-2 py-1 text-gray-600">{d.name || '—'}</td>
                    <td className="px-2 py-1 text-gray-500">{d.profile || '—'}</td>
                    <td className="px-2 py-1 text-xs text-gray-500">
                      {d.lastUplinkAt ? new Date(d.lastUplinkAt).toLocaleString('fr-FR') : 'Jamais'}
                    </td>
                    <td className="px-2 py-1 text-xs text-gray-500">
                      {(d.tags || []).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <FilterCard label="Total" value={counts.total} active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterCard label="Actifs" value={counts.active} color="green" active={filter === 'active'} onClick={() => setFilter('active')} />
          <FilterCard label="Offline" value={counts.offline} color="gray" active={filter === 'offline'} onClick={() => setFilter('offline')} />
          <FilterCard label="Batt. faible" value={counts.low_battery} color="amber" active={filter === 'low_battery'} onClick={() => setFilter('low_battery')} />
          <FilterCard label="Alertes" value={counts.alerts} color="red" active={filter === 'alerts'} onClick={() => setFilter('alerts')} />
        </div>

        <div className="card-modern overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">CAV</th>
                <th className="px-3 py-2 text-left">Commune</th>
                <th className="px-3 py-2 text-left">DevEUI</th>
                <th className="px-3 py-2 text-right">Remplissage</th>
                <th className="px-3 py-2 text-right">Batterie</th>
                <th className="px-3 py-2 text-right">RSSI</th>
                <th className="px-3 py-2 text-left">Dernière lecture</th>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-right">Alertes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link to="/admin-cav" className="text-primary hover:underline">{s.name}</Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{s.commune}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{s.lora_deveui || s.sensor_reference || '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {s.sensor_last_reading != null ? `${Math.round(s.sensor_last_reading)}%` : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right ${s.sensor_battery_level != null && s.sensor_battery_level <= 20 ? 'text-red-600 font-semibold' : ''}`}>
                    {s.sensor_battery_level != null ? `${s.sensor_battery_level}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">
                    {s.sensor_last_rssi != null ? `${s.sensor_last_rssi} dBm` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {s.sensor_last_reading_at ? new Date(s.sensor_last_reading_at).toLocaleString('fr-FR') : 'Jamais'}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={s.computed_status} /></td>
                  <td className="px-3 py-2 text-right">
                    {s.open_alerts > 0 ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                        {s.open_alerts}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">Aucun capteur dans cette vue</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

function FilterCard({ label, value, color = 'slate', active, onClick }) {
  const bg = {
    slate: 'bg-white',
    green: 'bg-green-50 border-green-200',
    gray: 'bg-gray-100 border-gray-300',
    amber: 'bg-amber-50 border-amber-200',
    red: 'bg-red-50 border-red-200',
  }[color];
  const ring = {
    slate: 'ring-primary',
    green: 'ring-green-500',
    gray: 'ring-gray-500',
    amber: 'ring-amber-500',
    red: 'ring-red-500',
  }[color];
  return (
    <button onClick={onClick} className={`rounded-xl border p-4 text-left transition ${bg} ${active ? `ring-2 ${ring}` : ''}`}>
      <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </button>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: ['bg-green-100 text-green-700', 'Actif'],
    offline: ['bg-gray-200 text-gray-700', 'Offline'],
    low_battery: ['bg-amber-100 text-amber-700', 'Batt. faible'],
    never: ['bg-gray-100 text-gray-500', 'Jamais vu'],
  };
  const [cls, label] = map[status] || ['bg-gray-100 text-gray-500', status || '—'];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
}
