import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
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
  const [sheetDownloading, setSheetDownloading] = useState(null);
  const [detailCav, setDetailCav] = useState(null);
  const [detailQrUrl, setDetailQrUrl] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef(null);

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

  const openDetail = async (cav) => {
    setDetailCav(cav);
    setDetailQrUrl(null);
    if (cav.qr_code_data) {
      try {
        const res = await api.get(`/cav/${cav.id}/qr-code`, { responseType: 'blob' });
        setDetailQrUrl(URL.createObjectURL(res.data));
      } catch (err) { /* pas de QR */ }
    }
  };

  const closeDetail = () => {
    if (detailQrUrl) URL.revokeObjectURL(detailQrUrl);
    setDetailCav(null);
    setDetailQrUrl(null);
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
      if (detailCav?.id === cav.id) setDetailCav({ ...detailCav, status: newStatus });
    } catch (err) {
      showAlert('Erreur lors du changement de statut', 'error');
    }
  };

  const deleteCav = async (cav) => {
    if (!window.confirm(`Supprimer définitivement "${cav.name}" ? Cette action est irréversible.`)) return;
    try {
      await api.delete(`/cav/${cav.id}`);
      showAlert('CAV supprimé');
      if (detailCav?.id === cav.id) closeDetail();
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

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !detailCav) return;
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await api.post(`/cav/${detailCav.id}/photo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDetailCav(res.data);
      showAlert('Photo enregistrée');
      loadCAVs();
    } catch (err) {
      showAlert('Erreur upload photo', 'error');
    }
    setUploadingPhoto(false);
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const deletePhoto = async () => {
    if (!detailCav) return;
    try {
      await api.delete(`/cav/${detailCav.id}/photo`);
      setDetailCav({ ...detailCav, photo_path: null });
      showAlert('Photo supprimée');
      loadCAVs();
    } catch (err) {
      showAlert('Erreur suppression photo', 'error');
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
            <h1 className="text-2xl font-bold text-slate-800">Gestion des CAV</h1>
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
              className="border border-primary text-primary rounded-lg px-4 py-2 text-sm hover:bg-green-50 disabled:opacity-50">
              {sheetDownloading === 'A7' ? 'Génération...' : 'Planche QR (A7)'}
            </button>
            <button onClick={() => downloadSheet('A8')} disabled={!!sheetDownloading}
              className="border border-primary text-primary rounded-lg px-4 py-2 text-sm hover:bg-green-50 disabled:opacity-50">
              {sheetDownloading === 'A8' ? 'Génération...' : 'Planche QR (A8)'}
            </button>
            <button onClick={openCreate} className="btn-primary text-sm">
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

        {/* Layout : Table + Fiche détail */}
        <div className={`grid gap-6 ${detailCav ? 'grid-cols-1 lg:grid-cols-5' : 'grid-cols-1'}`}>

          {/* Table */}
          <div className={`bg-white rounded-xl shadow-sm border overflow-hidden ${detailCav ? 'lg:col-span-3' : ''}`}>
            {loading ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-3">Nom</th>
                      <th className="px-4 py-3">Commune</th>
                      <th className="px-4 py-3 text-center">Cont.</th>
                      <th className="px-4 py-3 text-center">QR</th>
                      <th className="px-4 py-3 text-center">Statut</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {cavList.map(cav => (
                      <tr key={cav.id}
                        className={`hover:bg-gray-50 cursor-pointer ${detailCav?.id === cav.id ? 'bg-green-50 border-l-4 border-l-primary' : ''}`}
                        onClick={() => openDetail(cav)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{cav.commune || '—'}</div>
                          <div className="text-xs text-gray-400 truncate max-w-[200px]">{cav.address || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{cav.commune || '—'}</td>
                        <td className="px-4 py-3 text-center">{cav.nb_containers || 1}</td>
                        <td className="px-4 py-3 text-center">
                          {cav.qr_code_data ? (
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" title="QR généré" />
                          ) : (
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" title="QR manquant" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            cav.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {cav.status === 'active' ? 'Actif' : 'Inactif'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => openEdit(cav)} className="text-blue-600 hover:text-blue-800 text-xs">Modifier</button>
                            <button onClick={() => toggleStatus(cav)} className="text-amber-600 hover:text-amber-800 text-xs">
                              {cav.status === 'active' ? 'Désactiver' : 'Activer'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {cavList.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucun CAV trouvé</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Fiche détail CAV */}
          {detailCav && (
            <div className="lg:col-span-2 space-y-4">
              {/* Card principale */}
              <div className="bg-white rounded-xl shadow-sm border p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">CAV #{detailCav.id}</h2>
                    <p className="text-sm text-primary font-medium">{detailCav.commune}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      detailCav.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {detailCav.status === 'active' ? 'Actif' : 'Inactif'}
                    </span>
                    <button onClick={closeDetail} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
                  </div>
                </div>

                <div className="space-y-2 text-sm mb-4">
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-24 shrink-0">Adresse</span>
                    <span className="text-gray-700">{detailCav.address || '—'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-24 shrink-0">Conteneurs</span>
                    <span className="text-gray-700">{detailCav.nb_containers || 1}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-24 shrink-0">GPS</span>
                    <span className="text-gray-700 font-mono text-xs">
                      {detailCav.latitude && detailCav.longitude
                        ? `${Number(detailCav.latitude).toFixed(6)}, ${Number(detailCav.longitude).toFixed(6)}`
                        : 'Non renseigné'}
                    </span>
                  </div>
                  {detailCav.unavailable_reason && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-24 shrink-0">Raison</span>
                      <span className="text-red-600">{detailCav.unavailable_reason}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => openEdit(detailCav)}
                    className="bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 text-xs hover:bg-blue-100">
                    Modifier
                  </button>
                  <button onClick={() => toggleStatus(detailCav)}
                    className={`rounded-lg px-3 py-1.5 text-xs border ${
                      detailCav.status === 'active'
                        ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                        : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                    }`}>
                    {detailCav.status === 'active' ? 'Désactiver' : 'Réactiver'}
                  </button>
                  <button onClick={() => deleteCav(detailCav)}
                    className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-1.5 text-xs hover:bg-red-100">
                    Supprimer
                  </button>
                </div>
              </div>

              {/* Carte GPS */}
              {detailCav.latitude && detailCav.longitude && (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b">
                    <h3 className="text-xs font-medium text-gray-500 uppercase">Localisation</h3>
                  </div>
                  <div style={{ height: '200px' }}>
                    <MapContainer
                      key={`detail-${detailCav.id}`}
                      center={[detailCav.latitude, detailCav.longitude]}
                      zoom={15}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={false}
                    >
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <Marker position={[detailCav.latitude, detailCav.longitude]} />
                    </MapContainer>
                  </div>
                </div>
              )}

              {/* Photo CAV */}
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
                  <h3 className="text-xs font-medium text-gray-500 uppercase">Photo du CAV</h3>
                  {detailCav.photo_path && (
                    <button onClick={deletePhoto} className="text-red-400 hover:text-red-600 text-xs">Supprimer</button>
                  )}
                </div>
                <div className="p-4">
                  {detailCav.photo_path ? (
                    <img
                      src={`/api${detailCav.photo_path}`}
                      alt={`Photo CAV ${detailCav.id}`}
                      className="w-full h-48 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-full h-32 bg-gray-100 rounded-lg flex flex-col items-center justify-center text-gray-400">
                      <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-xs">Aucune photo</span>
                    </div>
                  )}
                  <input type="file" ref={photoInputRef} accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                  <button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}
                    className="mt-3 w-full border border-gray-300 text-gray-600 rounded-lg px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50">
                    {uploadingPhoto ? 'Envoi en cours...' : detailCav.photo_path ? 'Changer la photo' : 'Ajouter une photo'}
                  </button>
                </div>
              </div>

              {/* QR Code */}
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b">
                  <h3 className="text-xs font-medium text-gray-500 uppercase">QR Code</h3>
                </div>
                <div className="p-4 text-center">
                  {detailQrUrl ? (
                    <>
                      <img src={detailQrUrl} alt={`QR CAV ${detailCav.id}`} className="mx-auto w-36 h-36 object-contain mb-2" />
                      <p className="text-xs text-gray-400 font-mono break-all mb-3">{detailCav.qr_code_data}</p>
                      <button onClick={() => downloadQR(detailCav)}
                        className="bg-primary text-white rounded-lg px-4 py-2 text-xs hover:bg-green-700 w-full">
                        Télécharger PNG
                      </button>
                      <p className="text-xs text-amber-600 mt-2">QR code définitif — ne peut pas être modifié</p>
                    </>
                  ) : detailCav.qr_code_data ? (
                    <p className="text-xs text-gray-400">Chargement...</p>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-amber-500 text-sm mb-2">QR code non généré</p>
                      <p className="text-xs text-gray-400">Utilisez le bouton "Générer QR manquants" en haut de page</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
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
                        className="border rounded-lg px-3 py-2 text-sm w-full" placeholder="Ex: ROUEN - 10 rue..." />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Commune</label>
                      <input value={form.commune} onChange={e => setForm(f => ({ ...f, commune: e.target.value }))}
                        className="border rounded-lg px-3 py-2 text-sm w-full" placeholder="Ex: ROUEN" />
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
                    className="btn-primary text-sm">
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
