import { useState, useEffect, useCallback } from 'react';
import { Users } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, PageHeader } from '../components';
import useConfirm from '../hooks/useConfirm';
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

const EMPTY_FORM = {
  name: '', address: '', complement_adresse: '', code_postal: '', ville: '',
  latitude: '', longitude: '', contact_phone: '', contact_info: '',
};

const STATUS_LABELS = {
  active: 'Actif',
  inactive: 'Inactif',
  temporairement_indisponible: 'Indisponible temp.',
};

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-600',
  temporairement_indisponible: 'bg-amber-100 text-amber-700',
};

export default function AdminAssociations() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [mapPos, setMapPos] = useState(null);
  const [geocoding, setGeocoding] = useState(false);
  const [detailItem, setDetailItem] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const res = await api.get('/association-points', {
        params: { status: filterStatus || undefined, search: search || undefined },
      });
      setList(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [filterStatus, search]);

  useEffect(() => { loadData(); }, [loadData]);

  const showAlertMsg = (msg, type = 'success') => {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  };

  const openCreate = () => {
    setEditItem(null);
    setForm(EMPTY_FORM);
    setMapPos(null);
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({
      name: item.name || '',
      address: item.address || '',
      complement_adresse: item.complement_adresse || '',
      code_postal: item.code_postal || '',
      ville: item.ville || '',
      latitude: item.latitude || '',
      longitude: item.longitude || '',
      contact_phone: item.contact_phone || '',
      contact_info: item.contact_info || '',
    });
    setMapPos(item.latitude && item.longitude ? [item.latitude, item.longitude] : null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name) { showAlertMsg('Le nom est requis', 'error'); return; }
    setSaving(true);
    try {
      if (editItem) {
        await api.put(`/association-points/${editItem.id}`, form);
        showAlertMsg('Point association mis à jour');
      } else {
        await api.post('/association-points', form);
        showAlertMsg('Point association créé');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      showAlertMsg(err.response?.data?.error || 'Erreur lors de la sauvegarde', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Supprimer ce point association ?',
      message: 'Cette action est définitive.',
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/association-points/${id}`);
      showAlertMsg('Point supprimé');
      loadData();
      if (detailItem?.id === id) setDetailItem(null);
    } catch (err) {
      showAlertMsg('Erreur lors de la suppression', 'error');
    }
  };

  const handleGeocode = async () => {
    if (!form.address || !form.ville) {
      showAlertMsg('Adresse et ville requises pour le géocodage', 'error');
      return;
    }
    setGeocoding(true);
    try {
      const res = await api.post('/association-points/geocode', {
        address: form.address,
        city: form.ville,
        postcode: form.code_postal,
      });
      setForm({ ...form, latitude: res.data.latitude, longitude: res.data.longitude });
      setMapPos([res.data.latitude, res.data.longitude]);
      showAlertMsg(`Géocodé : ${res.data.label || 'OK'}`);
    } catch {
      showAlertMsg('Adresse non trouvée', 'error');
    }
    setGeocoding(false);
  };

  const handleRegeocode = async (id) => {
    try {
      const res = await api.post(`/association-points/${id}/geocode`);
      showAlertMsg(`Géocodé : ${res.data.label}`);
      loadData();
    } catch {
      showAlertMsg('Adresse non trouvée', 'error');
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await api.put(`/association-points/${id}`, { status: newStatus });
      showAlertMsg(`Statut mis à jour : ${STATUS_LABELS[newStatus]}`);
      loadData();
    } catch (err) {
      showAlertMsg('Erreur', 'error');
    }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des associations..." /></Layout>;

  return (
    <Layout>
      {ConfirmDialogElement}
      <div className="p-4 sm:p-6 space-y-4">
        {/* Alert */}
        {alert && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium ${alert.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {alert.msg}
          </div>
        )}

        {/* Header */}
        <PageHeader
          title="Points de collecte associatifs"
          subtitle={`${list.length} associations`}
          icon={Users}
          actions={
            <button onClick={openCreate} className="btn-primary text-sm font-medium">
              + Nouveau point
            </button>
          }
        />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-modern flex-1"
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="select-modern w-auto">
            <option value="">Tous les statuts</option>
            <option value="active">Actif</option>
            <option value="inactive">Inactif</option>
            <option value="temporairement_indisponible">Indisponible temp.</option>
          </select>
        </div>

        {/* List */}
        <div className="space-y-2">
          {list.length === 0 ? (
            <div className="card-modern p-8 text-center text-slate-400">Aucun point association</div>
          ) : list.map(item => (
            <div key={item.id} className="card-modern p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDetailItem(item)}>
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-3 h-3 rounded-full bg-orange-400 flex-shrink-0" />
                    <h3 className="font-semibold text-slate-800 truncate">{item.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[item.status]}`}>
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{[item.address, item.ville].filter(Boolean).join(', ') || 'Adresse non renseignée'}</p>
                  {item.contact_phone && <p className="text-xs text-blue-600 mt-0.5">{item.contact_phone}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0 ml-2">
                  {!item.latitude && (
                    <button onClick={(e) => { e.stopPropagation(); handleRegeocode(item.id); }} className="text-blue-500 text-xs hover:underline">Géocoder</button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); openEdit(item); }} className="text-primary text-xs hover:underline">Modifier</button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="text-red-500 text-xs hover:underline">Supprimer</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {detailItem && (
          <Modal isOpen={true} onClose={() => setDetailItem(null)} title={detailItem.name} size="md">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-slate-400 text-xs">Adresse</p>
                  <p>{detailItem.address || '—'}</p>
                  {detailItem.complement_adresse && <p className="text-slate-500 text-xs">{detailItem.complement_adresse}</p>}
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Ville</p>
                  <p>{detailItem.code_postal} {detailItem.ville || '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Téléphone</p>
                  <p>{detailItem.contact_phone ? <a href={`tel:${detailItem.contact_phone.replace(/\s/g, '')}`} className="text-blue-600 underline">{detailItem.contact_phone}</a> : '—'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Statut</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[detailItem.status]}`}>
                    {STATUS_LABELS[detailItem.status]}
                  </span>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Coordonnées GPS</p>
                  <p>{detailItem.latitude ? `${detailItem.latitude.toFixed(4)}, ${detailItem.longitude.toFixed(4)}` : 'Non géocodé'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs">Dernière collecte</p>
                  <p>{detailItem.last_collection ? new Date(detailItem.last_collection).toLocaleDateString('fr-FR') : '—'}</p>
                </div>
              </div>
              {detailItem.latitude && detailItem.longitude && (
                <div className="h-48 rounded-lg overflow-hidden border">
                  <MapContainer center={[detailItem.latitude, detailItem.longitude]} zoom={15} style={{ height: '100%' }} zoomControl={false}>
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                    <Marker position={[detailItem.latitude, detailItem.longitude]} />
                  </MapContainer>
                </div>
              )}
              <div className="flex gap-2">
                <select
                  value={detailItem.status}
                  onChange={e => { handleStatusChange(detailItem.id, e.target.value); setDetailItem({ ...detailItem, status: e.target.value }); }}
                  className="select-modern flex-1"
                >
                  <option value="active">Actif</option>
                  <option value="inactive">Inactif</option>
                  <option value="temporairement_indisponible">Indisponible temporairement</option>
                </select>
                <button onClick={() => { setDetailItem(null); openEdit(detailItem); }} className="btn-primary text-sm">Modifier</button>
              </div>
            </div>
          </Modal>
        )}

        {/* Create/Edit Modal */}
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Modifier le point' : 'Nouveau point association'} size="lg">
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-500">Nom de l'association *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-modern" placeholder="Ex: Secours Populaire Rouen" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Adresse</label>
                <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="input-modern" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Complément</label>
                <input type="text" value={form.complement_adresse} onChange={e => setForm({ ...form, complement_adresse: e.target.value })} className="input-modern" placeholder="Bâtiment, étage..." />
              </div>
              <div>
                <label className="text-xs text-slate-500">Code postal</label>
                <input type="text" value={form.code_postal} onChange={e => setForm({ ...form, code_postal: e.target.value })} className="input-modern" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Ville</label>
                <input type="text" value={form.ville} onChange={e => setForm({ ...form, ville: e.target.value })} className="input-modern" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Téléphone contact</label>
                <input type="tel" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} className="input-modern" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Info contact</label>
                <input type="text" value={form.contact_info} onChange={e => setForm({ ...form, contact_info: e.target.value })} className="input-modern" placeholder="Nom du référent..." />
              </div>
            </div>

            {/* Géocodage */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-slate-500">Latitude</label>
                <input type="number" step="any" value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })} className="input-modern" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-500">Longitude</label>
                <input type="number" step="any" value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })} className="input-modern" />
              </div>
              <button onClick={handleGeocode} disabled={geocoding} className="btn-ghost text-sm whitespace-nowrap">
                {geocoding ? 'Recherche...' : 'Géocoder'}
              </button>
            </div>

            {/* Mini carte */}
            <div className="h-48 rounded-lg overflow-hidden border">
              <MapContainer
                center={mapPos || [49.4231, 1.0993]}
                zoom={mapPos ? 15 : 11}
                style={{ height: '100%' }}
                zoomControl={false}
              >
                <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
                <LocationPicker
                  position={mapPos}
                  onPick={(pos) => {
                    setMapPos(pos);
                    setForm({ ...form, latitude: pos[0], longitude: pos[1] });
                  }}
                />
              </MapContainer>
            </div>
            <p className="text-xs text-slate-400">Cliquez sur la carte pour positionner le point, ou utilisez le géocodage automatique</p>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 btn-ghost">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 btn-primary text-sm">
                {saving ? 'Enregistrement...' : editItem ? 'Mettre à jour' : 'Créer'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </Layout>
  );
}
