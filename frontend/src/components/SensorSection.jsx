import { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import useConfirm from '../hooks/useConfirm';
import { sensorsApi } from '../services/api';

/**
 * Section "Capteur LoRaWAN" intégrée dans la fiche détail CAV.
 * Gère l'affichage du statut, les alertes ouvertes, le provisioning
 * et le déprovisionnement d'un capteur Milesight EM400-MUD.
 */
export default function SensorSection({ cavId, onUpdated }) {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!cavId) return;
    try {
      setLoading(true);
      const data = await sensorsApi.status(cavId);
      setStatus(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [cavId]);

  useEffect(() => { load(); }, [load]);

  const deprovision = async () => {
    const ok = await confirm({
      title: 'Déprovisionner le capteur ?',
      message: 'Les données historiques sont conservées, mais le CAV repassera sur le remplissage estimé jusqu\'au prochain provisioning.',
      confirmLabel: 'Déprovisionner',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await sensorsApi.deprovision(cavId);
      await load();
      if (onUpdated) onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const ackAlert = async (alertId) => {
    try {
      await sensorsApi.ackAlert(alertId);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  if (loading) {
    return (
      <div className="card-modern overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 border-b">
          <h3 className="text-xs font-medium text-gray-500 uppercase">Capteur LoRaWAN</h3>
        </div>
        <div className="p-4 text-xs text-gray-400">Chargement…</div>
      </div>
    );
  }

  const provisioned = !!status?.lora_deveui || !!status?.sensor_reference;

  return (
    <div className="card-modern overflow-hidden">
      {ConfirmDialogElement}
      <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
        <h3 className="text-xs font-medium text-gray-500 uppercase flex items-center gap-2">
          📡 Capteur LoRaWAN
        </h3>
        {provisioned && (
          <div className="flex items-center gap-2">
            <button onClick={() => setCalibrationOpen(true)} className="text-teal-600 hover:text-teal-800 text-xs">
              Modifier calibration
            </button>
            <button onClick={deprovision} className="text-red-400 hover:text-red-600 text-xs">
              Déprovisionner
            </button>
          </div>
        )}
      </div>
      <div className="p-4">
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        {!provisioned ? (
          <div className="text-center py-4">
            <p className="text-xs text-gray-400 mb-3">Aucun capteur associé</p>
            <button onClick={() => setProvisionOpen(true)} className="btn-primary text-xs">
              Provisionner un capteur
            </button>
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <Row label="DevEUI" value={<span className="font-mono">{status.lora_deveui || '—'}</span>} />
            <Row label="Référence" value={status.sensor_reference || '—'} />
            <Row label="Type" value={status.sensor_type || 'ultrasonic'} />
            <Row label="Hauteur calibration" value={status.sensor_height_cm ? `${status.sensor_height_cm} cm` : '—'} />
            <Row label="Intervalle reporting" value={status.sensor_reporting_interval_min ? `${status.sensor_reporting_interval_min} min` : '—'} />
            <Row label="Installation" value={status.sensor_install_date ? new Date(status.sensor_install_date).toLocaleDateString('fr-FR') : '—'} />
            <hr className="my-2" />
            <Row label="Dernière lecture"
              value={status.sensor_last_reading_at ? new Date(status.sensor_last_reading_at).toLocaleString('fr-FR') : 'Jamais'} />
            <Row label="Remplissage réel"
              value={status.sensor_last_reading != null ? `${Math.round(status.sensor_last_reading)} %` : '—'} />
            <Row label="Batterie" value={status.sensor_battery_level != null ? `${status.sensor_battery_level} %` : '—'}
              highlight={status.sensor_battery_level != null && status.sensor_battery_level <= 20} />
            <Row label="RSSI" value={status.sensor_last_rssi != null ? `${status.sensor_last_rssi} dBm` : '—'} />
            <Row label="Statut" value={<StatusBadge status={status.sensor_status} />} />

            {status.open_alerts?.length > 0 && (
              <>
                <hr className="my-2" />
                <p className="font-semibold text-red-700">Alertes ouvertes ({status.open_alerts.length})</p>
                <div className="space-y-1">
                  {status.open_alerts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between bg-red-50 border border-red-200 rounded p-2">
                      <div>
                        <p className="font-medium text-red-700">{a.alert_type}</p>
                        <p className="text-[10px] text-red-600">{a.message}</p>
                        <p className="text-[10px] text-gray-500">{new Date(a.triggered_at).toLocaleString('fr-FR')}</p>
                      </div>
                      {!a.acknowledged_at && (
                        <button onClick={() => ackAlert(a.id)} className="text-[10px] bg-white border border-red-300 text-red-700 px-2 py-1 rounded hover:bg-red-100">
                          Acquitter
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {status.recent_readings?.length > 0 && (
              <>
                <hr className="my-2" />
                <details>
                  <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                    Dernières lectures ({status.recent_readings.length})
                  </summary>
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {status.recent_readings.map((r, i) => (
                      <div key={i} className="flex justify-between text-[10px] text-gray-600 border-b pb-1">
                        <span>{new Date(r.reading_at).toLocaleString('fr-FR')}</span>
                        <span className="font-semibold">{Math.round(r.fill_level_percent)} %</span>
                        <span>{r.battery_level ? `${r.battery_level}%` : '—'}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </div>
        )}
      </div>

      <ProvisionModal
        isOpen={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        cavId={cavId}
        onDone={async () => { setProvisionOpen(false); await load(); if (onUpdated) onUpdated(); }}
      />
      <CalibrationModal
        isOpen={calibrationOpen}
        onClose={() => setCalibrationOpen(false)}
        cavId={cavId}
        current={status}
        onDone={async () => { setCalibrationOpen(false); await load(); if (onUpdated) onUpdated(); }}
      />
    </div>
  );
}

function CalibrationModal({ isOpen, onClose, cavId, current, onDone }) {
  const [form, setForm] = useState({
    sensor_height_cm: 260,
    sensor_reporting_interval_min: 360,
    sensor_install_date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && current) {
      setForm({
        sensor_height_cm: current.sensor_height_cm || 260,
        sensor_reporting_interval_min: current.sensor_reporting_interval_min || 360,
        sensor_install_date: current.sensor_install_date
          ? new Date(current.sensor_install_date).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
      });
      setError(null);
    }
  }, [isOpen, current]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await sensorsApi.updateCalibration(cavId, form);
      if (onDone) onDone();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Modifier la calibration du capteur" size="md">
      <form onSubmit={submit} className="space-y-4 text-sm">
        <p className="text-xs text-slate-500">
          Calibration physique du capteur — ne touche pas au DevEUI / clés LoRa.
          La <strong>hauteur vide</strong> est la distance entre la sonde et le fond du conteneur quand il est vide.
          C'est la valeur de référence pour calculer le pourcentage de remplissage.
        </p>
        <Field label="Hauteur vide (cm)" required>
          <input type="number" min={30} max={500} value={form.sensor_height_cm}
            onChange={(e) => setForm({ ...form, sensor_height_cm: parseInt(e.target.value, 10) })}
            className="input-modern" required />
        </Field>
        <Field label="Intervalle de reporting (min)">
          <input type="number" min={5} max={1440} value={form.sensor_reporting_interval_min}
            onChange={(e) => setForm({ ...form, sensor_reporting_interval_min: parseInt(e.target.value, 10) })}
            className="input-modern" />
        </Field>
        <Field label="Date d'installation">
          <input type="date" value={form.sensor_install_date}
            onChange={(e) => setForm({ ...form, sensor_install_date: e.target.value })}
            className="input-modern" />
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Annuler</button>
          <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? 'font-semibold text-red-600' : 'text-gray-700'}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: ['bg-green-100 text-green-700', 'Actif'],
    offline: ['bg-gray-200 text-gray-700', 'Offline'],
    low_battery: ['bg-amber-100 text-amber-700', 'Batt. faible'],
    inactive: ['bg-gray-100 text-gray-500', 'Inactif'],
  };
  const [cls, label] = map[status] || ['bg-gray-100 text-gray-500', status || '—'];
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>{label}</span>;
}

function ProvisionModal({ isOpen, onClose, cavId, onDone }) {
  const [form, setForm] = useState({
    dev_eui: '',
    app_eui: '',
    app_key: '',
    sensor_height_cm: 260,
    sensor_reporting_interval_min: 360,
    sensor_install_date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [devices, setDevices] = useState(null);  // null = non chargé, [] = chargé vide
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState(null);

  const loadLiveObjectsDevices = async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const data = await sensorsApi.liveObjectsDevices();
      setDevices(data.devices || []);
    } catch (err) {
      setDevicesError(err.response?.data?.error || err.message);
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  };

  // Auto-charger la liste à l'ouverture du modal
  useEffect(() => {
    if (isOpen && devices === null) loadLiveObjectsDevices();
    if (!isOpen) {
      setDevices(null);
      setError(null);
    }
  }, [isOpen]);

  const selectDevice = (d) => {
    setForm((f) => ({
      ...f,
      dev_eui: d.devEui || '',
      app_eui: d.appEui || '',
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await sensorsApi.provision(cavId, form);
      if (onDone) onDone();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const freeDevices = (devices || []).filter((d) => !d.assigned_cav);
  const assignedDevices = (devices || []).filter((d) => d.assigned_cav);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Provisionner un capteur LoRaWAN" size="lg">
      <form onSubmit={submit} className="space-y-4 text-sm">
        {/* Sélecteur depuis Live Objects */}
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-orange-800">
              📡 Devices déclarés sur Orange Live Objects
            </p>
            <button type="button" onClick={loadLiveObjectsDevices} disabled={devicesLoading}
              className="text-xs text-orange-700 hover:text-orange-900 underline disabled:opacity-50">
              {devicesLoading ? 'Chargement…' : '↻ Rafraîchir'}
            </button>
          </div>
          {devicesError && (
            <p className="text-xs text-red-600 mb-2">
              {devicesError} — saisie manuelle toujours possible ci-dessous.
            </p>
          )}
          {devicesLoading && <p className="text-xs text-gray-500">Chargement des devices…</p>}
          {devices !== null && !devicesLoading && devices.length === 0 && !devicesError && (
            <p className="text-xs text-gray-500">
              Aucun device LoRa déclaré sur Live Objects. Ajoutez-en depuis la console Orange d'abord.
            </p>
          )}
          {freeDevices.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              <p className="text-[10px] uppercase text-gray-500 font-semibold">
                Non assignés ({freeDevices.length})
              </p>
              {freeDevices.map((d) => {
                const selected = form.dev_eui === d.devEui;
                return (
                  <button key={d.devEui} type="button" onClick={() => selectDevice(d)}
                    className={`w-full text-left p-2 rounded border transition ${
                      selected
                        ? 'bg-green-100 border-green-400 ring-2 ring-green-300'
                        : 'bg-white border-gray-200 hover:border-orange-400'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-semibold truncate">{d.devEui}</p>
                        <p className="text-[10px] text-gray-600 truncate">
                          {d.name || '(sans nom)'}
                          {d.profile && ` · ${d.profile}`}
                        </p>
                      </div>
                      {d.lastUplinkAt && (
                        <span className="text-[10px] text-gray-400 ml-2 shrink-0">
                          vu {new Date(d.lastUplinkAt).toLocaleDateString('fr-FR')}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {assignedDevices.length > 0 && (
            <details className="mt-2">
              <summary className="text-[10px] uppercase text-gray-500 font-semibold cursor-pointer">
                Déjà assignés ({assignedDevices.length})
              </summary>
              <div className="mt-1 space-y-1">
                {assignedDevices.map((d) => (
                  <div key={d.devEui} className="p-2 rounded border border-gray-200 bg-gray-50 opacity-75">
                    <p className="font-mono text-xs truncate">{d.devEui}</p>
                    <p className="text-[10px] text-gray-600">
                      → {d.assigned_cav.name} ({d.assigned_cav.commune})
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <hr />

        <p className="text-xs text-gray-500">
          Sélectionnez un device ci-dessus ou saisissez manuellement. La clé
          applicative (AppKey) est <strong>facultative</strong> — Orange ne la restitue
          jamais via l'API ; elle sert uniquement de backup côté SOLIDATA si vous
          l'avez conservée (app ToolBox / étiquette capteur).
        </p>
        <Field label="DevEUI" required>
          <input value={form.dev_eui} onChange={(e) => setForm({ ...form, dev_eui: e.target.value.toUpperCase() })}
            className="input-modern font-mono" placeholder="24E124..." required />
        </Field>
        <Field label="AppEUI (JoinEUI)">
          <input value={form.app_eui} onChange={(e) => setForm({ ...form, app_eui: e.target.value.toUpperCase() })}
            className="input-modern font-mono" placeholder="24E124C0..." />
        </Field>
        <Field label="AppKey (facultative)">
          <input type="password" value={form.app_key} onChange={(e) => setForm({ ...form, app_key: e.target.value })}
            className="input-modern font-mono" placeholder="32 caractères hex — optionnel" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hauteur vide (cm)" required>
            <input type="number" min={30} max={500} value={form.sensor_height_cm}
              onChange={(e) => setForm({ ...form, sensor_height_cm: parseInt(e.target.value, 10) })}
              className="input-modern" required />
          </Field>
          <Field label="Reporting (min)">
            <input type="number" min={10} max={1440} value={form.sensor_reporting_interval_min}
              onChange={(e) => setForm({ ...form, sensor_reporting_interval_min: parseInt(e.target.value, 10) })}
              className="input-modern" />
          </Field>
        </div>
        <Field label="Date d'installation">
          <input type="date" value={form.sensor_install_date}
            onChange={(e) => setForm({ ...form, sensor_install_date: e.target.value })}
            className="input-modern" />
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Annuler</button>
          <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Provisionner'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 block mb-1">{label}{required && ' *'}</span>
      {children}
    </label>
  );
}
