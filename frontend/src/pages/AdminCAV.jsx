import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function LocationPicker({ position, onPick }) {
  useMapEvents({
    click(e) {
      onPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return position ? <Marker position={position} /> : null;
}

const EMPTY_FORM = { name: '', address: '', commune: '', latitude: '', longitude: '', nb_containers: 1 };

export default function AdminCAV() {
  const [cavList, setCavList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editCav, setEditCav] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [mapPos, setMapPos] = useState(null);
  const [qrGenerating, setQrGenerating] = useState(false);

  const loadCAVs = useCallback(async () => {
    try {
      const res = await api.get('/cav', { params: { status: filterStatus || undefined, search: search || undefined } });
      setCavList(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [filterStatus, search]);

  useEffect(() => { loadCAVs(); }, [loadCAVs]);

  const showAlert = (msg, type = 'success') => {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  };

  const openCreate = () => {
    setEditCav(null);
    setForm(EMPTY_FORM);
    setMapPos(null);
    setShowModal(true);
  };

  const openEdit = (cav) => {
    setEditCav(cav);
    setForm({
      name: cav.name || '',
      address: cav.address || '',
      commune: cav.commune || '',
      latitude: cav.latitude || '',
      longitude: cav.longitude || '',
      nb_containers: cav.nb_containers || 1,
    });
    setMapPos(cav.latitude && cav.longitude ? [cav.latitude, cav.longitude] : null);
    setShowModal(true);
  };

  const handleMapPick = ([lat, lng]) => {
    setMapPos([lat, lng]);
    setForm(f => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return showAlert('Le nom est obligatoire', 'error');
    if (!form.latitude || !form.longitude) return showAlert('La position GPS est obligatoire', 'error');

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim(),
        commune: form.commune.trim(),
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        nb_containers: parseInt(form.nb_containers) || 1,
      };

      if (editCav) {
        await api.put(`/cav/${editCav.id}`, payload);
        showAlert('CAV modifié');
      } else {
        await api.post('/cav', payload);
        showAlert('CAV créé avec QR code');
      }
      setShowModal(false);
      loadCAVs();
    } catch (err) {
      showAlert(err.response?.data?.error || 'Erreur', 'error');
    }
    setSaving(false);
  };

  const toggleStatus = async (cav) => {
    const newStatus = cav.status === 'active' ? 'unavailable' : 'active';
    const reason = newStatus === 'unavailable' ? prompt('Raison de l\'indisponibilité (optionnel) :') : undefined;
    try {
      await api.put(`/cav/${cav.id}`, { status: newStatus, unavailable_reason: reason || undefined });
      showAlert(`CAV ${newStatus === 'active' ? 'activé' : 'désactivé'}`);
      loadCAVs();
    } catch (err) {
      showAlert('Erreur lors du changement de statut', 'error');
    }
  };

  const deleteCav = async (cav) => {
    if (!window.confirm(`Supprimer définitivement "${cav.name}" ? Cette action est irréversible.`)) return;
    try {
      await api.delete(`/cav/${cav.id}`);
      showAlert('CAV supprimé');
      loadCAVs();
    } catch (err) {
      showAlert('Erreur lors de la suppression', 'error');
    }
  };

  const generateMissingQR = async () => {
    setQrGenerating(true);
    try {
      const res = await api.post('/cav/batch-generate-qr');
      showAlert(`${res.data.generated} QR code(s) généré(s)`);
      loadCAVs();
    } catch (err) {
      showAlert('Erreur génération QR', 'error');
    }
    setQrGenerating(false);
  };

  const downloadQR = async (cav) => {
    try {
      const res = await api.get(`/cav/${cav.id}/qr-code`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `QR_CAV_${cav.name.replace(/\s+/g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showAlert('QR code non disponible', 'error');
    }
  };

  const cavWithoutQR = cavList.filter(c => !c.qr_code_data).length;

  return (
    <Layout>
      <div className="p-6">
        {/* Alert */}
        {alert && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
            alert.type === 'error' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-green-100 text-green-700 border border-green-200'
          }`}>
            {alert.msg}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Gestion des CAV</h1>
            <p className="text-gray-500">Conteneurs d'Apport Volontaire — {cavList.length} enregistré(s)</p>
          </div>
          <div className="flex gap-2">
            {cavWithoutQR > 0 && (
              <button onClick={generateMissingQR} disabled={qrGenerating}
                className="border border-amber-300 bg-amber-50 text-amber-700 rounded-lg px-4 py-2 text-sm hover:bg-amber-100 disabled:opacity-50">
                {qrGenerating ? 'Génération...' : `Générer ${cavWithoutQR} QR manquant(s)`}
              </button>
            )}
            <button onClick={openCreate} className="bg-solidata-green text-white rounded-lg px-4 py-2 text-sm hover:bg-green-700">
              + Nouveau CAV
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            placeholder="Rechercher un CAV..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm flex-1 max-w-xs"
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="unavailable">Indisponibles</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-solidata-green" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Commune</th>
                  <th className="px-4 py-3">Adresse</th>
                  <th className="px-4 py-3 text-center">Conteneurs</th>
                  <th className="px-4 py-3 text-center">GPS</th>
                  <th className="px-4 py-3 text-center">QR Code</th>
                  <th className="px-4 py-3 text-center">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cavList.map(cav => (
                  <tr key={cav.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{cav.name}</td>
                    <td className="px-4 py-3 text-gray-500">{cav.commune || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{cav.address || '—'}</td>
                    <td className="px-4 py-3 text-center">{cav.nb_containers || 1}</td>
                    <td className="px-4 py-3 text-center">
                      {cav.latitude && cav.longitude ? (
                        <span className="text-green-600 text-xs font-mono">{Number(cav.latitude).toFixed(4)}, {Number(cav.longitude).toFixed(4)}</span>
                      ) : (
                        <span className="text-red-400 text-xs">Manquant</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {cav.qr_code_data ? (
                        <button onClick={() => downloadQR(cav)} className="text-solidata-green hover:underline text-xs" title="Télécharger">
                          Télécharger
                        </button>
                      ) : (
                        <span className="text-amber-500 text-xs">Non généré</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleStatus(cav)}
                        className={`px-2 py-1 rounded-full text-xs font-medium cursor-pointer ${
                          cav.status === 'active' ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'
                        }`}>
                        {cav.status === 'active' ? 'Actif' : 'Indisponible'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(cav)} className="text-blue-600 hover:text-blue-800 text-xs">Modifier</button>
                        <button onClick={() => deleteCav(cav)} className="text-red-500 hover:text-red-700 text-xs">Supprimer</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {cavList.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Aucun CAV trouvé</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Modal Création / Édition */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">{editCav ? 'Modifier le CAV' : 'Nouveau CAV'}</h2>
                  <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nom *</label>
                      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="border rounded-lg px-3 py-2 text-sm w-full" placeholder="Ex: CAV Rouen Centre" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Commune</label>
                      <input value={form.commune} onChange={e => setForm(f => ({ ...f, commune: e.target.value }))}
                        className="border rounded-lg px-3 py-2 text-sm w-full" placeholder="Ex: Rouen" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Adresse</label>
                    <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                      className="border rounded-lg px-3 py-2 text-sm w-full" placeholder="Adresse complète" />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Latitude *</label>
                      <input type="number" step="any" value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                        className="border rounded-lg px-3 py-2 text-sm w-full" placeholder="49.4231" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Longitude *</label>
                      <input type="number" step="any" value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                        className="border rounded-lg px-3 py-2 text-sm w-full" placeholder="1.0993" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nb conteneurs</label>
                      <input type="number" min={1} value={form.nb_containers} onChange={e => setForm(f => ({ ...f, nb_containers: e.target.value }))}
                        className="border rounded-lg px-3 py-2 text-sm w-full" />
                    </div>
                  </div>

                  {/* Map picker */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cliquez sur la carte pour positionner le CAV</label>
                    <div className="rounded-lg overflow-hidden border" style={{ height: '280px' }}>
                      <MapContainer
                        center={mapPos || [49.4231, 1.0993]}
                        zoom={mapPos ? 15 : 11}
                        style={{ height: '100%', width: '100%' }}
                      >
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        <LocationPicker position={mapPos} onPick={handleMapPick} />
                      </MapContainer>
                    </div>
                  </div>

                  {!editCav && (
                    <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
                      Un QR code unique sera automatiquement généré et associé à ce CAV. Ce QR code est définitif et ne pourra pas être modifié.
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                  <button onClick={() => setShowModal(false)} className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                    Annuler
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="bg-solidata-green text-white rounded-lg px-4 py-2 text-sm hover:bg-green-700 disabled:opacity-50">
                    {saving ? 'Enregistrement...' : editCav ? 'Enregistrer' : 'Créer le CAV'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
