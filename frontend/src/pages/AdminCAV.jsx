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
  const [qrPreview, setQrPreview] = useState(null);
  const [sheetDownloading, setSheetDownloading] = useState(null);

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
      a.download = `QR_CAV_${cav.id}_${(cav.commune || '').replace(/\s+/g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showAlert('QR code non disponible', 'error');
    }
  };

  const openQRPreview = async (cav) => {
    try {
      const res = await api.get(`/cav/${cav.id}/qr-code`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      setQrPreview({ cav, imageUrl: url });
    } catch (err) {
      showAlert('QR code non disponible', 'error');
    }
  };

  const closeQRPreview = () => {
    if (qrPreview?.imageUrl) URL.revokeObjectURL(qrPreview.imageUrl);
    setQrPreview(null);
  };

  const downloadSheet = async (format) => {
    setSheetDownloading(format);
    try {
      const res = await api.get(`/cav/qr-sheets/${format}`, { responseType: 'blob', timeout: 120000 });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SOLIDATA_QR_CAV_${format}_${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showAlert(`Planche ${format} téléchargée`);
    } catch (err) {
      showAlert(`Erreur téléchargement planche ${format}`, 'error');
    }
    setSheetDownloading(null);
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
          <div className="flex gap-2 flex-wrap">
            {cavWithoutQR > 0 && (
              <button onClick={generateMissingQR} disabled={qrGenerating}
                className="border border-amber-300 bg-amber-50 text-amber-700 rounded-lg px-4 py-2 text-sm hover:bg-amber-100 disabled:opacity-50">
                {qrGenerating ? 'Génération...' : `Générer ${cavWithoutQR} QR manquant(s)`}
              </button>
            )}
            <button onClick={() => downloadSheet('A7')} disabled={!!sheetDownloading}
              className="border border-solidata-green text-solidata-green rounded-lg px-4 py-2 text-sm hover:bg-green-50 disabled:opacity-50">
              {sheetDownloading === 'A7' ? 'Génération...' : 'Planche QR (A7)'}
            </button>
            <button onClick={() => downloadSheet('A8')} disabled={!!sheetDownloading}
              className="border border-solidata-green text-solidata-green rounded-lg px-4 py-2 text-sm hover:bg-green-50 disabled:opacity-50">
              {sheetDownloading === 'A8' ? 'Génération...' : 'Planche QR (A8)'}
            </button>
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
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => openQRPreview(cav)}
                            className="inline-flex items-center gap-1 bg-green-50 text-solidata-green border border-green-200 rounded px-2 py-1 text-xs hover:bg-green-100"
                            title="Voir le QR code">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            Voir
                          </button>
                          <button onClick={() => downloadQR(cav)}
                            className="text-gray-400 hover:text-solidata-green text-xs" title="Télécharger PNG">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                        </div>
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

        {/* Modal QR Preview */}
        {qrPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeQRPreview}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="p-6 text-center">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-solidata-dark">QR Code — CAV #{qrPreview.cav.id}</h2>
                  <button onClick={closeQRPreview} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <img src={qrPreview.imageUrl} alt={`QR CAV ${qrPreview.cav.id}`} className="mx-auto w-48 h-48 object-contain" />
                </div>

                <div className="text-left space-y-1 mb-4 text-sm">
                  <p><span className="text-gray-500">Commune :</span> <span className="font-medium">{qrPreview.cav.commune || '—'}</span></p>
                  <p><span className="text-gray-500">Adresse :</span> <span className="font-medium">{qrPreview.cav.address || '—'}</span></p>
                  <p><span className="text-gray-500">Conteneurs :</span> <span className="font-medium">{qrPreview.cav.nb_containers || 1}</span></p>
                  <p className="text-xs text-gray-400 font-mono mt-2 break-all">{qrPreview.cav.qr_code_data}</p>
                </div>

                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2 mb-4">
                  Ce QR code est définitif et ne peut pas être modifié.
                </p>

                <div className="flex gap-2">
                  <button onClick={() => { downloadQR(qrPreview.cav); }}
                    className="flex-1 bg-solidata-green text-white rounded-lg px-4 py-2 text-sm hover:bg-green-700">
                    Télécharger PNG
                  </button>
                  <button onClick={closeQRPreview}
                    className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                    Fermer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
