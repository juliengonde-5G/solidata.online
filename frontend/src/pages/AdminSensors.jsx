import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal } from '../components';
import { sensorsApi } from '../services/api';
import api from '../services/api';
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
  const [reassignFrom, setReassignFrom] = useState(null); // sensor row pour réaffectation
  const [rawHistoryFor, setRawHistoryFor] = useState(null); // sensor row pour historique brut
  const [diagnoseFor, setDiagnoseFor] = useState(null); // sensor row pour diagnostic

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
                <th className="px-3 py-2 text-right">Actions</th>
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
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => setDiagnoseFor(s)}
                      className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 mr-1"
                      title="Diagnostiquer la chaîne sonde → BDD"
                    >
                      Diagnostic
                    </button>
                    <button
                      onClick={() => setRawHistoryFor(s)}
                      className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 mr-1"
                      title="Historique brut des transactions"
                    >
                      Logs
                    </button>
                    <button
                      onClick={() => setReassignFrom(s)}
                      className="text-xs px-2 py-1 rounded border border-teal-300 text-teal-700 hover:bg-teal-50"
                      title="Réaffecter le capteur à un autre CAV"
                    >
                      Réaffecter
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">Aucun capteur dans cette vue</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {reassignFrom && (
        <ReassignModal
          sensor={reassignFrom}
          onClose={() => setReassignFrom(null)}
          onSuccess={() => { setReassignFrom(null); load(); }}
        />
      )}
      {rawHistoryFor && (
        <RawHistoryModal
          sensor={rawHistoryFor}
          onClose={() => setRawHistoryFor(null)}
        />
      )}
      {diagnoseFor && (
        <DiagnosticModal
          sensor={diagnoseFor}
          onClose={() => setDiagnoseFor(null)}
        />
      )}
    </Layout>
  );
}

// ─── Modal de réaffectation ─────────────────────────────────
function ReassignModal({ sensor, onClose, onSuccess }) {
  const [cavs, setCavs] = useState([]);
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/cav', { params: { status: 'active' } })
      .then((r) => setCavs((r.data || []).filter((c) => c.id !== sensor.id && !c.lora_deveui && !c.sensor_reference)))
      .catch(() => setCavs([]));
  }, [sensor.id]);

  const filteredCavs = cavs.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (c.name || '').toLowerCase().includes(q) || (c.commune || '').toLowerCase().includes(q);
  }).slice(0, 50);

  const handleSubmit = async () => {
    if (!targetId) return;
    setSubmitting(true);
    setError(null);
    try {
      await sensorsApi.reassign(sensor.id, parseInt(targetId, 10));
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setSubmitting(false);
  };

  return (
    <Modal isOpen onClose={onClose} title={`Réaffecter le capteur de "${sensor.name}"`}>
      <div className="space-y-3">
        <div className="text-sm text-slate-600 bg-slate-50 rounded p-3 space-y-1">
          <div><span className="text-slate-500">DevEUI :</span> <span className="font-mono">{sensor.lora_deveui || '—'}</span></div>
          <div><span className="text-slate-500">Référence :</span> {sensor.sensor_reference || '—'}</div>
          <div className="text-xs text-amber-700 mt-2">
            ⚠ Le capteur sera détaché du CAV actuel et rattaché au CAV cible. Les lectures historiques restent associées au CAV d'origine.
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Rechercher un CAV cible</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom ou commune..."
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Seuls les CAV actifs sans capteur sont listés ({filteredCavs.length} affiché{filteredCavs.length > 1 ? 's' : ''} sur {cavs.length}).
          </p>
        </div>

        <div className="border border-slate-200 rounded max-h-64 overflow-y-auto">
          {filteredCavs.map((c) => (
            <label key={c.id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 border-b border-slate-100 last:border-0 ${String(targetId) === String(c.id) ? 'bg-teal-50' : ''}`}>
              <input
                type="radio"
                name="target_cav"
                value={c.id}
                checked={String(targetId) === String(c.id)}
                onChange={() => setTargetId(c.id)}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.name}</p>
                <p className="text-xs text-slate-500 truncate">{c.commune || '—'}</p>
              </div>
            </label>
          ))}
          {filteredCavs.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">Aucun CAV correspondant</p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-50">Annuler</button>
          <button
            onClick={handleSubmit}
            disabled={!targetId || submitting}
            className="px-4 py-2 text-sm rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {submitting ? 'Réaffectation…' : 'Réaffecter'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal historique brut ──────────────────────────────────
function RawHistoryModal({ sensor, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState({});

  useEffect(() => {
    sensorsApi.rawReadings(sensor.id, 200)
      .then(setData)
      .catch((err) => setData({ count: 0, readings: [], error: err.response?.data?.error || err.message }))
      .finally(() => setLoading(false));
  }, [sensor.id]);

  return (
    <Modal isOpen onClose={onClose} title={`Historique brut — ${sensor.name}`} size="xl">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          {data?.count || 0} dernière{(data?.count || 0) > 1 ? 's' : ''} transaction{(data?.count || 0) > 1 ? 's' : ''} reçue{(data?.count || 0) > 1 ? 's' : ''} (max 200).
          DevEUI : <span className="font-mono">{sensor.lora_deveui || '—'}</span>
        </p>
        {loading ? (
          <LoadingSpinner size="md" message="Chargement…" />
        ) : data?.error ? (
          <p className="text-sm text-red-600">{data.error}</p>
        ) : (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="border-b text-[11px] uppercase text-slate-500">
                  <th className="px-2 py-1.5 text-left">Reçu</th>
                  <th className="px-2 py-1.5 text-right">Remplissage</th>
                  <th className="px-2 py-1.5 text-right">Distance</th>
                  <th className="px-2 py-1.5 text-right">Batt.</th>
                  <th className="px-2 py-1.5 text-right">Temp.</th>
                  <th className="px-2 py-1.5 text-right">RSSI</th>
                  <th className="px-2 py-1.5 text-right">SNR</th>
                  <th className="px-2 py-1.5 text-right">SF</th>
                  <th className="px-2 py-1.5 text-right">FCnt</th>
                  <th className="px-2 py-1.5 text-left">Alarme</th>
                  <th className="px-2 py-1.5 text-left">Payload</th>
                </tr>
              </thead>
              <tbody>
                {(data?.readings || []).map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="px-2 py-1 whitespace-nowrap">{new Date(r.reading_at).toLocaleString('fr-FR')}</td>
                    <td className="px-2 py-1 text-right font-semibold">{r.fill_level_percent != null ? `${Math.round(r.fill_level_percent)}%` : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.distance_cm != null ? `${r.distance_cm} cm` : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.battery_level != null ? `${r.battery_level}%` : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.temperature != null ? `${r.temperature}°C` : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.rssi != null ? `${r.rssi}` : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.snr != null ? r.snr.toFixed(1) : '—'}</td>
                    <td className="px-2 py-1 text-right">{r.sf ?? '—'}</td>
                    <td className="px-2 py-1 text-right font-mono text-[10px]">{r.fcnt ?? '—'}</td>
                    <td className="px-2 py-1">
                      {r.alarm_type ? <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px]">{r.alarm_type}</span> : '—'}
                      {r.tilt_detected && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">tilt</span>}
                    </td>
                    <td className="px-2 py-1">
                      {r.raw_data ? (
                        <button
                          onClick={() => setShowRaw((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                          className="text-[10px] text-teal-700 hover:underline"
                        >
                          {showRaw[r.id] ? 'Masquer' : 'Voir JSON'}
                        </button>
                      ) : '—'}
                      {showRaw[r.id] && (
                        <pre className="mt-1 p-2 bg-slate-900 text-slate-100 rounded text-[10px] overflow-x-auto max-w-md whitespace-pre-wrap">
                          {JSON.stringify(r.raw_data, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))}
                {(!data?.readings || data.readings.length === 0) && (
                  <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">Aucune transaction enregistrée</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-50">Fermer</button>
        </div>
      </div>
    </Modal>
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

// ─── Modal diagnostic 4 couches ─────────────────────────────
function DiagnosticModal({ sensor, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    sensorsApi.diagnostic(sensor.id)
      .then(setData)
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [sensor.id]);

  useEffect(() => { run(); }, [run]);

  return (
    <Modal isOpen onClose={onClose} title={`Diagnostic chaîne de bout en bout — ${sensor.name}`} size="xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            DevEUI : <span className="font-mono">{sensor.lora_deveui || '—'}</span>
          </p>
          <button
            onClick={run}
            disabled={loading}
            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? 'Diagnostic en cours…' : 'Relancer le diagnostic'}
          </button>
        </div>

        {loading && <LoadingSpinner size="md" message="Interrogation Live Objects + BDD…" />}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>
        )}

        {data && (
          <>
            {/* Schéma de chaîne */}
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="grid grid-cols-4 gap-2 items-stretch">
                {data.layers.map((layer, idx) => (
                  <LayerCard key={layer.name} layer={layer} arrow={idx < 3} />
                ))}
              </div>
            </div>

            {/* Détail par couche */}
            {data.layers.map((layer) => (
              <LayerDetail key={layer.name} layer={layer} />
            ))}

            {/* Recommandations */}
            {data.recommendations.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-1">
                <p className="text-xs font-semibold text-blue-900 uppercase">Recommandations</p>
                <ul className="text-sm text-blue-800 list-disc pl-5 space-y-1">
                  {data.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-50">Fermer</button>
        </div>
      </div>
    </Modal>
  );
}

function statusColor(status) {
  return {
    ok: 'bg-emerald-500 text-white',
    warning: 'bg-amber-500 text-white',
    error: 'bg-red-500 text-white',
    unknown: 'bg-slate-400 text-white',
  }[status] || 'bg-slate-400 text-white';
}

function statusIcon(status) {
  return { ok: '✓', warning: '!', error: '✕', unknown: '?' }[status] || '?';
}

function LayerCard({ layer, arrow }) {
  return (
    <div className="relative">
      <div className="bg-white border border-slate-200 rounded-lg p-3 h-full flex flex-col items-center text-center">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold mb-2 ${statusColor(layer.status)}`}>
          {statusIcon(layer.status)}
        </div>
        <p className="text-xs font-semibold text-slate-700">{layer.label}</p>
        <p className="text-[11px] text-slate-500 mt-1">
          {layer.status === 'ok' ? 'OK' : layer.status === 'warning' ? 'Attention' : layer.status === 'error' ? 'Bloqué' : 'Inconnu'}
        </p>
      </div>
      {arrow && (
        <div className="hidden md:block absolute -right-1 top-1/2 -translate-y-1/2 text-slate-400 text-xl z-10">→</div>
      )}
    </div>
  );
}

function LayerDetail({ layer }) {
  return (
    <details className="border border-slate-200 rounded-lg overflow-hidden" open={layer.status !== 'ok'}>
      <summary className="cursor-pointer px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
        <span className="text-sm font-semibold flex items-center gap-2">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${statusColor(layer.status)}`}>
            {statusIcon(layer.status)}
          </span>
          {layer.label}
        </span>
        <span className="text-[11px] text-slate-500">{layer.issues?.length || 0} alerte{(layer.issues?.length || 0) > 1 ? 's' : ''}</span>
      </summary>
      <div className="p-3 space-y-2 text-sm">
        {layer.issues && layer.issues.length > 0 && (
          <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 space-y-1 list-disc pl-5">
            {layer.issues.map((i, idx) => <li key={idx}>{i}</li>)}
          </ul>
        )}
        <pre className="text-[11px] bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto max-h-64 whitespace-pre-wrap">
          {JSON.stringify(layer.details, null, 2)}
        </pre>
      </div>
    </details>
  );
}
