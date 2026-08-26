import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Package } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, Modal, PageHeader } from '../components';
import SensorSection from '../components/SensorSection';
import useConfirm from '../hooks/useConfirm';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { INCIDENT_TYPE_LABELS as INCIDENT_TYPE_LABELS_PARTAGES, INCIDENT_STATUS_LABELS } from '../utils/incidents';

// Leaflet ne calcule la taille du conteneur que lors du `mount` initial.
// Quand la carte apparaît dans un panneau (fiche détail) qui était démonté
// ou dans un parent qui change de largeur, les tuiles ne se chargent pas.
// On force `invalidateSize` après mount + observe les redimensionnements.
function MapSizeFix() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const t1 = setTimeout(fix, 50);
    const t2 = setTimeout(fix, 250);
    const t3 = setTimeout(fix, 600);
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(fix)
      : null;
    if (ro) ro.observe(map.getContainer());
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      if (ro) ro.disconnect();
    };
  }, [map]);
  return null;
}

// ── Fraîcheur de la photo du CAV (exigence 08/2026) ────────────────────────
// Le seuil (en mois) est PARAMÉTRABLE côté serveur (`collecte.photo_fraicheur_mois`)
// et arrive avec la fiche (`photo_fraicheur_mois`) : jamais recopié en dur ici.
// Une photo SANS date connue est « à renouveler » — on ne la suppose pas récente.
const DEFAULT_PHOTO_FRAICHEUR_MOIS = 6;

function photoFreshnessState(cav) {
  const mois = Number(cav?.photo_fraicheur_mois) > 0
    ? Math.floor(Number(cav.photo_fraicheur_mois))
    : DEFAULT_PHOTO_FRAICHEUR_MOIS;
  if (!cav?.photo_path) return { mois, level: 'absente', label: 'Aucune photo' };
  if (!cav.photo_taken_at) return { mois, level: 'perimee', label: `Photo à renouveler (date inconnue)` };
  const taken = new Date(cav.photo_taken_at);
  if (Number.isNaN(taken.getTime())) return { mois, level: 'perimee', label: 'Photo à renouveler (date illisible)' };
  // Échéance = date de prise de vue + N mois calendaires (quantième borné au
  // dernier jour du mois cible, comme le calcul serveur utils/cav-photo.js).
  const expiry = new Date(taken.getTime());
  const day = expiry.getDate();
  expiry.setDate(1);
  expiry.setMonth(expiry.getMonth() + mois);
  expiry.setDate(Math.min(day, new Date(expiry.getFullYear(), expiry.getMonth() + 1, 0).getDate()));
  if (Date.now() >= expiry.getTime()) return { mois, level: 'perimee', label: `Photo à renouveler (> ${mois} mois)` };
  return { mois, level: 'fraiche', label: null };
}

const PHOTO_SOURCE_LABELS = {
  admin: 'back-office',
  chauffeur: 'chauffeur',
  import: 'date approchée (reprise de l\'existant)',
};

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

const EMPTY_FORM = { name: '', address: '', commune: '', latitude: '', longitude: '', nb_containers: 1,
  communaute_communes: '', surface: '', ref_refashion: '', entite_detentrice: '', code_postal: '' };

// ─── Historique & incidents par CAV ────────────────────────────────────────
// Libellés partagés (utils/incidents.js) : c'était la TROISIÈME copie de cette
// table dans le frontend, et les trois divergeaient déjà (« Problème CAV » ici,
// « CAV dégradée » ailleurs pour le même code).
const INCIDENT_TYPE_LABELS = INCIDENT_TYPE_LABELS_PARTAGES;
const INCIDENT_STATUS_META = {
  open: { label: INCIDENT_STATUS_LABELS.open, cls: 'bg-red-100 text-red-700' },
  in_progress: { label: INCIDENT_STATUS_LABELS.in_progress, cls: 'bg-amber-100 text-amber-700' },
  resolved: { label: INCIDENT_STATUS_LABELS.resolved, cls: 'bg-green-100 text-green-700' },
  closed: { label: INCIDENT_STATUS_LABELS.closed, cls: 'bg-gray-100 text-gray-600' },
};
const SKIP_REASON_LABELS = {
  cav_fermee: 'CAV fermé',
  bouchee: 'Bouché',
  acces_impossible: 'Accès impossible',
  proprietaire_absent: 'Propriétaire absent',
  vide: 'Vide',
  autre: 'Autre',
};

// Volet « Historique & incidents » de la fiche détail : consomme le endpoint
// consolidé GET /cav/:id/historique (passages en tournée, tonnages, incidents).
function HistoriqueSection({ cavId }) {
  const [mois, setMois] = useState(12);
  const [data, setData] = useState(null);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setHistLoading(true); setHistError(null); setData(null);
    api.get(`/cav/${cavId}/historique`, { params: { mois } })
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(err => {
        if (!cancelled) setHistError(err.response?.data?.error || "Impossible de charger l'historique");
      })
      .finally(() => { if (!cancelled) setHistLoading(false); });
    return () => { cancelled = true; };
  }, [cavId, mois]);

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
  const passageBadge = (p) => {
    if (p.status === 'collected') return <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-700">Collecté</span>;
    if (p.status === 'skipped') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700">
          Sauté{p.skip_reason ? ` — ${SKIP_REASON_LABELS[p.skip_reason] || p.skip_reason}` : ''}
        </span>
      );
    }
    const aVenir = ['planned', 'in_progress'].includes(p.tour_status);
    return <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">{aVenir ? 'Prévu' : 'Non traité'}</span>;
  };

  return (
    <div className="card-modern overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
        <h3 className="text-xs font-medium text-gray-500 uppercase">Historique &amp; incidents</h3>
        <select
          value={mois}
          onChange={e => setMois(parseInt(e.target.value, 10))}
          className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-600"
          aria-label="Période de l'historique"
        >
          <option value={3}>3 mois</option>
          <option value={6}>6 mois</option>
          <option value={12}>12 mois</option>
          <option value={24}>24 mois</option>
        </select>
      </div>
      <div className="p-4 space-y-4">
        {histLoading && <p className="text-xs text-gray-400">Chargement de l'historique…</p>}
        {histError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{histError}</p>
        )}
        {data && !histLoading && (
          <>
            {/* Synthèse de la période */}
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2 py-1 rounded-lg text-[11px] bg-gray-100 text-gray-700">
                {data.synthese.nb_passages} passage{data.synthese.nb_passages > 1 ? 's' : ''}
              </span>
              <span className="px-2 py-1 rounded-lg text-[11px] bg-green-50 text-green-700">
                {data.synthese.nb_collectes} collecté{data.synthese.nb_collectes > 1 ? 's' : ''}
              </span>
              {data.synthese.nb_sautes > 0 && (
                <span className="px-2 py-1 rounded-lg text-[11px] bg-amber-50 text-amber-700">
                  {data.synthese.nb_sautes} sauté{data.synthese.nb_sautes > 1 ? 's' : ''}
                </span>
              )}
              <span className="px-2 py-1 rounded-lg text-[11px] bg-blue-50 text-blue-700">
                {data.synthese.poids_total_kg} kg collectés
              </span>
              <span className={`px-2 py-1 rounded-lg text-[11px] ${data.synthese.incidents_ouverts > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                {data.synthese.nb_incidents} incident{data.synthese.nb_incidents > 1 ? 's' : ''}
                {data.synthese.incidents_ouverts > 0 ? ` (${data.synthese.incidents_ouverts} ouvert${data.synthese.incidents_ouverts > 1 ? 's' : ''})` : ''}
              </span>
            </div>

            {/* Passages en tournée */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase mb-1">Passages en tournée</p>
              {data.passages.length === 0 ? (
                <p className="text-xs text-gray-400">Aucun passage sur la période.</p>
              ) : (
                <div className="overflow-x-auto max-h-56 overflow-y-auto border border-gray-100 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-left text-gray-400">
                        <th className="px-2 py-1.5 font-medium">Date</th>
                        <th className="px-2 py-1.5 font-medium">Tournée</th>
                        <th className="px-2 py-1.5 font-medium">Véhicule</th>
                        <th className="px-2 py-1.5 font-medium">Statut</th>
                        <th className="px-2 py-1.5 font-medium">Niveau</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.passages.map((p, i) => (
                        <tr key={`${p.tour_id}-${i}`} className="border-t border-gray-50">
                          <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{fmtDate(p.date)}</td>
                          <td className="px-2 py-1.5 text-gray-500">#{p.tour_id}</td>
                          <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{p.registration || '—'}</td>
                          <td className="px-2 py-1.5">{passageBadge(p)}</td>
                          <td className="px-2 py-1.5 text-gray-700">{p.fill_level != null ? `${p.fill_level}/5` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Incidents */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase mb-1">Incidents</p>
              {data.incidents.length === 0 ? (
                <p className="text-xs text-gray-400">Aucun incident sur la période.</p>
              ) : (
                <div className="overflow-x-auto max-h-56 overflow-y-auto border border-gray-100 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-left text-gray-400">
                        <th className="px-2 py-1.5 font-medium">Date</th>
                        <th className="px-2 py-1.5 font-medium">Type</th>
                        <th className="px-2 py-1.5 font-medium">Description</th>
                        <th className="px-2 py-1.5 font-medium">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.incidents.map((inc) => {
                        const meta = INCIDENT_STATUS_META[inc.status] || { label: inc.status, cls: 'bg-gray-100 text-gray-600' };
                        return (
                          <tr key={inc.id} className="border-t border-gray-50 align-top">
                            <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{fmtDate(inc.created_at)}</td>
                            <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{INCIDENT_TYPE_LABELS[inc.type] || inc.type}</td>
                            <td className="px-2 py-1.5 text-gray-600 max-w-[220px] truncate" title={inc.description || ''}>
                              {inc.description || '—'}
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
                              {inc.resolved_at && (
                                <span className="block text-[10px] text-gray-400 mt-0.5">le {fmtDate(inc.resolved_at)}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminCAV() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const { user } = useAuth();
  // DELETE /cav/:id reste réservé à l'ADMIN côté backend : on masque le bouton
  // aux MANAGER (qui ont désormais accès à la page) pour éviter un clic → 403.
  const isAdmin = (user?.base_role || user?.role) === 'ADMIN';
  const [cavList, setCavList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRattach, setFilterRattach] = useState(''); // '', 'linked', 'unlinked'
  const [communesRef, setCommunesRef] = useState([]);
  const [communesError, setCommunesError] = useState(null);
  const [savingRattach, setSavingRattach] = useState(false);
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
  // 'absent' | 'chargement' | 'pret' | 'erreur'. Sans cet état, un échec de
  // chargement était indiscernable d'une attente : le panneau restait sur
  // « Chargement... » indéfiniment, sans jamais dire ce qui s'était passé.
  const [detailQrEtat, setDetailQrEtat] = useState('absent');
  const [detailQrErreur, setDetailQrErreur] = useState('');
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

  // Référentiel communes (pour le rattachement CAV↔commune INSEE)
  useEffect(() => {
    api.get('/communes')
      .then((r) => setCommunesRef(r.data || []))
      .catch((e) => setCommunesError(e.response?.data?.error || 'Référentiel communes indisponible'));
  }, []);

  const communeByInsee = useMemo(() => {
    const m = {};
    for (const c of communesRef) m[c.code_insee] = c;
    return m;
  }, [communesRef]);

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
      communaute_communes: cav.communaute_communes || '',
      surface: cav.surface || '',
      ref_refashion: cav.ref_refashion || '',
      entite_detentrice: cav.entite_detentrice || '',
      code_postal: cav.code_postal || '',
    });
    setMapPos(cav.latitude && cav.longitude ? [cav.latitude, cav.longitude] : null);
    setShowModal(true);
  };

  const openDetail = async (cav) => {
    setDetailCav(cav);
    setDetailQrUrl(null);
    setDetailQrErreur('');
    if (!cav.qr_code_data) { setDetailQrEtat('absent'); return; }
    setDetailQrEtat('chargement');
    try {
      const res = await api.get(`/cav/${cav.id}/qr-code`, { responseType: 'blob' });
      setDetailQrUrl(URL.createObjectURL(res.data));
      setDetailQrEtat('pret');
    } catch (err) {
      // La réponse est demandée en blob : son corps n'est pas lisible comme du
      // JSON ici. On rapporte donc ce qu'on sait de façon sûre — le code de
      // statut — plutôt que d'inventer un message.
      const statut = err?.response?.status;
      setDetailQrEtat('erreur');
      setDetailQrErreur(statut ? `Le serveur a répondu ${statut}.` : (err?.message || 'Serveur injoignable.'));
    }
  };

  const closeDetail = () => {
    if (detailQrUrl) URL.revokeObjectURL(detailQrUrl);
    setDetailCav(null);
    setDetailQrUrl(null);
    setDetailQrEtat('absent');
    setDetailQrErreur('');
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
        communaute_communes: form.communaute_communes?.trim() || null,
        surface: form.surface?.trim() || null,
        ref_refashion: form.ref_refashion?.trim() || null,
        entite_detentrice: form.entite_detentrice?.trim() || null,
        code_postal: form.code_postal?.trim() || null,
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

  // Rattachement d'un CAV à une commune du référentiel INSEE
  // (alimente la captation par commune du Reporting Métropole).
  // Écrit via PATCH /communes/cav/:id ; code_insee vide = retire le rattachement.
  const saveRattachement = async (code_insee) => {
    if (!detailCav) return;
    setSavingRattach(true);
    try {
      const res = await api.patch(`/communes/cav/${detailCav.id}`, { code_insee: code_insee || null });
      setDetailCav({ ...detailCav, code_insee_commune: res.data.code_insee_commune });
      showAlert(code_insee ? 'CAV rattaché à la commune' : 'Rattachement retiré');
      loadCAVs();
    } catch (err) {
      showAlert(err.response?.data?.error || 'Erreur lors du rattachement', 'error');
    }
    setSavingRattach(false);
  };

  const deleteCav = async (cav) => {
    const ok = await confirm({
      title: 'Supprimer ce CAV ?',
      message: `Supprimer définitivement "${cav.name}" ? Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',
    });
    if (!ok) return;
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
      // Fusion (et non remplacement) : la réponse RETURNING * ne porte pas le
      // seuil de fraîcheur joint à la liste — on le conserve pour que le badge
      // reste calculé sur le VRAI seuil paramétré.
      setDetailCav(prev => ({ ...(prev || {}), ...res.data }));
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
      setDetailCav({ ...detailCav, photo_path: null, photo_taken_at: null, photo_source: null });
      showAlert('Photo supprimée');
      loadCAVs();
    } catch (err) {
      showAlert('Erreur suppression photo', 'error');
    }
  };

  const cavWithoutQR = cavList.filter(c => !c.qr_code_data).length;
  const rattachCount = cavList.filter(c => c.code_insee_commune).length;
  const rattachRate = cavList.length ? Math.round((rattachCount / cavList.length) * 100) : 0;
  const displayedCav = cavList.filter(c => {
    if (filterRattach === 'linked') return !!c.code_insee_commune;
    if (filterRattach === 'unlinked') return !c.code_insee_commune;
    return true;
  });

  return (
    <Layout>
      {ConfirmDialogElement}
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
        <PageHeader
          title="Gestion des CAV"
          subtitle={`Conteneurs d'Apport Volontaire — ${cavList.length} enregistré(s)`}
          icon={Package}
          actions={
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
              <button onClick={() => downloadSheet('AVERY')} disabled={!!sheetDownloading}
                className="border border-primary text-primary rounded-lg px-4 py-2 text-sm hover:bg-green-50 disabled:opacity-50"
                title="Planche pré-découpée Avery 105×74 RCT — 8 étiquettes par page A4">
                  {sheetDownloading === 'AVERY' ? 'Génération...' : 'Planche QR (Avery 105×74)'}
                </button>
              <button onClick={() => downloadSheet('A8')} disabled={!!sheetDownloading}
                className="border border-primary text-primary rounded-lg px-4 py-2 text-sm hover:bg-green-50 disabled:opacity-50">
                {sheetDownloading === 'A8' ? 'Génération...' : 'Planche QR (A8)'}
              </button>
              <button onClick={openCreate} className="btn-primary text-sm">
                + Nouveau CAV
              </button>
            </div>
          }
        />

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap items-center">
          <input
            type="text"
            placeholder="Rechercher un CAV..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-modern flex-1 max-w-xs"
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="select-modern w-auto">
            <option value="">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="unavailable">Indisponibles</option>
          </select>
          <select value={filterRattach} onChange={e => setFilterRattach(e.target.value)} className="select-modern w-auto"
            title="Filtrer selon le rattachement à une commune du référentiel">
            <option value="">Rattachement : tous</option>
            <option value="linked">Rattachés commune</option>
            <option value="unlinked">Non rattachés</option>
          </select>
          <span className={`text-xs px-2.5 py-1 rounded-full border ${
            rattachRate >= 100 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'
          }`} title="Part de CAV rattachés à une commune du référentiel INSEE">
            {rattachCount}/{cavList.length} CAV rattachés ({rattachRate}%)
          </span>
        </div>

        {/* Layout : Table + Fiche détail */}
        <div className={`grid gap-6 ${detailCav ? 'grid-cols-1 lg:grid-cols-5' : 'grid-cols-1'}`}>

          {/* Table */}
          <div className={`card-modern overflow-hidden ${detailCav ? 'lg:col-span-3' : ''}`}>
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
                      <th className="px-4 py-3">Modèle</th>
                      <th className="px-4 py-3 text-center">QR</th>
                      <th className="px-4 py-3 text-center">Statut</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {displayedCav.map(cav => (
                      <tr key={cav.id}
                        className={`hover:bg-gray-50 cursor-pointer ${detailCav?.id === cav.id ? 'bg-green-50 border-l-4 border-l-primary' : ''}`}
                        onClick={() => openDetail(cav)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">{cav.commune || '—'}</div>
                          <div className="text-xs text-gray-400 truncate max-w-[200px]">{cav.address || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {cav.code_insee_commune ? (
                            <span className="inline-flex items-center gap-1.5 text-gray-600" title={`Rattaché — INSEE ${cav.code_insee_commune}`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                              {communeByInsee[cav.code_insee_commune]?.nom || cav.commune || '—'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-amber-600" title="CAV non rattaché à une commune du référentiel">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                              {cav.commune ? `${cav.commune} · non rattaché` : 'Non rattaché'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">{cav.nb_containers || 1}</td>
                        <td className="px-4 py-3 text-xs">
                          {(cav.modeles_tournees || []).length > 0 ? (
                            <span
                              className="inline-flex items-center gap-1"
                              title={cav.modeles_tournees.map((m) => m.name).join(', ')}
                            >
                              <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 whitespace-nowrap max-w-[140px] truncate inline-block align-middle">
                                {cav.modeles_tournees[0].name}
                              </span>
                              {cav.modeles_tournees.length > 1 && (
                                <span className="text-teal-600 font-medium">+{cav.modeles_tournees.length - 1}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-gray-300" title="Ce CAV n'appartient à aucune tournée modèle active">—</span>
                          )}
                        </td>
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
                    {displayedCav.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun CAV trouvé</td></tr>
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
              <div className="card-modern p-5">
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
                    <span className="text-gray-400 w-24 shrink-0">Modèles</span>
                    {(detailCav.modeles_tournees || []).length > 0 ? (
                      <span className="inline-flex flex-wrap gap-1">
                        {detailCav.modeles_tournees.map((m) => (
                          <span key={m.id} className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 text-xs">
                            {m.name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-gray-400">Aucune tournée modèle</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-24 shrink-0">GPS</span>
                    <span className="text-gray-700 font-mono text-xs">
                      {detailCav.latitude && detailCav.longitude
                        ? `${Number(detailCav.latitude).toFixed(6)}, ${Number(detailCav.longitude).toFixed(6)}`
                        : 'Non renseigné'}
                    </span>
                  </div>
                  {detailCav.code_postal && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-24 shrink-0">Code postal</span>
                      <span className="text-gray-700">{detailCav.code_postal}</span>
                    </div>
                  )}
                  {detailCav.communaute_communes && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-24 shrink-0">Communauté</span>
                      <span className="text-gray-700">{detailCav.communaute_communes}</span>
                    </div>
                  )}
                  {detailCav.surface && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-24 shrink-0">Surface</span>
                      <span className="text-gray-700">{detailCav.surface}</span>
                    </div>
                  )}
                  {detailCav.ref_refashion && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-24 shrink-0">Réf. Refashion</span>
                      <span className="text-gray-700">{detailCav.ref_refashion}</span>
                    </div>
                  )}
                  {detailCav.entite_detentrice && (
                    <div className="flex gap-2">
                      <span className="text-gray-400 w-24 shrink-0">Entité</span>
                      <span className="text-gray-700">{detailCav.entite_detentrice}</span>
                    </div>
                  )}
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
                  {isAdmin && (
                    <button onClick={() => deleteCav(detailCav)}
                      className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-1.5 text-xs hover:bg-red-100">
                      Supprimer
                    </button>
                  )}
                </div>
              </div>

              {/* Rattachement commune (Métropole / captation kg/hab) */}
              <div className="card-modern overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b">
                  <h3 className="text-xs font-medium text-gray-500 uppercase">Rattachement commune (Métropole)</h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex gap-2 text-sm">
                    <span className="text-gray-400 w-24 shrink-0">Commune INSEE</span>
                    {detailCav.code_insee_commune ? (
                      <span className="text-gray-700">
                        {communeByInsee[detailCav.code_insee_commune]?.nom || detailCav.commune || '—'}
                        <span className="text-gray-400 font-mono ml-1">({detailCav.code_insee_commune})</span>
                      </span>
                    ) : (
                      <span className="text-amber-600 font-medium">Non rattaché</span>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Rattacher à une commune du référentiel
                    </label>
                    <select
                      value={detailCav.code_insee_commune || ''}
                      onChange={(e) => saveRattachement(e.target.value)}
                      disabled={savingRattach || communesRef.length === 0}
                      className="select-modern w-full disabled:opacity-50"
                    >
                      <option value="">— Non rattaché —</option>
                      {communesRef.map((c) => (
                        <option key={c.code_insee} value={c.code_insee}>
                          {c.nom} ({c.code_insee}){c.population_insee ? ` — ${c.population_insee.toLocaleString('fr-FR')} hab` : ''}
                        </option>
                      ))}
                    </select>
                    {communesRef.length === 0 ? (
                      <p className="text-xs text-amber-600 mt-1">
                        {communesError || 'Référentiel communes vide.'} Chargez-le depuis « Référentiel communes » (Admin).
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">
                        Alimente la captation par commune (kg/habitant) du Reporting Métropole.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Carte GPS */}
              {(() => {
                // Les coords arrivent en number depuis pg (DOUBLE PRECISION) mais on
                // sécurise au cas où un autre code path renvoie des strings.
                const lat = parseFloat(detailCav.latitude);
                const lng = parseFloat(detailCav.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                return (
                  <div className="card-modern overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b">
                      <h3 className="text-xs font-medium text-gray-500 uppercase">Localisation</h3>
                    </div>
                    <div style={{ height: '200px' }}>
                      <MapContainer
                        key={`detail-${detailCav.id}`}
                        center={[lat, lng]}
                        zoom={15}
                        style={{ height: '100%', width: '100%' }}
                        scrollWheelZoom={false}
                      >
                        <MapSizeFix />
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        />
                        <Marker position={[lat, lng]} />
                      </MapContainer>
                    </div>
                  </div>
                );
              })()}

              {/* Photo CAV */}
              <div className="card-modern overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
                  <h3 className="text-xs font-medium text-gray-500 uppercase">Photo du CAV</h3>
                  {detailCav.photo_path && (
                    <button onClick={deletePhoto} className="text-red-400 hover:text-red-600 text-xs">Supprimer</button>
                  )}
                </div>
                <div className="p-4">
                  {detailCav.photo_path ? (
                    // photo_path vaut déjà « /uploads/... ». Le préfixer par « /api »
                    // désignait une route inexistante : le backend sert les fichiers
                    // sur /uploads, jamais sur /api/uploads.
                    <img
                      src={detailCav.photo_path}
                      alt={`Photo CAV ${detailCav.id}`}
                      className="w-full h-48 object-cover rounded-lg"
                      key={detailCav.photo_taken_at || detailCav.photo_path}
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
                  {/* Fraîcheur : c'est elle qui déclenche (ou non) la demande de
                      photo au chauffeur lors de son prochain passage. */}
                  {(() => {
                    const st = photoFreshnessState(detailCav);
                    return (
                      <div className="mt-3 space-y-1.5">
                        {detailCav.photo_taken_at && (
                          <p className="text-xs text-gray-500">
                            Prise le {new Date(detailCav.photo_taken_at).toLocaleDateString('fr-FR')}
                            {detailCav.photo_source
                              ? ` (${PHOTO_SOURCE_LABELS[detailCav.photo_source] || detailCav.photo_source})`
                              : ''}
                          </p>
                        )}
                        {st.level === 'absente' && (
                          <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">
                            Aucune photo — sera demandée au chauffeur
                          </span>
                        )}
                        {st.level === 'perimee' && (
                          <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-700">
                            {st.label} — sera redemandée au chauffeur
                          </span>
                        )}
                        {st.level === 'fraiche' && (
                          <span className="inline-block px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
                            Photo à jour (seuil {st.mois} mois)
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  <input type="file" ref={photoInputRef} accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                  <button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}
                    className="mt-3 w-full border border-gray-300 text-gray-600 rounded-lg px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50">
                    {uploadingPhoto ? 'Envoi en cours...' : detailCav.photo_path ? 'Changer la photo' : 'Ajouter une photo'}
                  </button>
                </div>
              </div>

              {/* Capteur LoRaWAN */}
              <SensorSection cavId={detailCav.id} onUpdated={loadCAVs} />

              {/* QR Code */}
              <div className="card-modern overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b">
                  <h3 className="text-xs font-medium text-gray-500 uppercase">QR Code</h3>
                </div>
                <div className="p-4 text-center">
                  {detailQrEtat === 'pret' && detailQrUrl ? (
                    <>
                      <img src={detailQrUrl} alt={`QR CAV ${detailCav.id}`} className="mx-auto w-36 h-36 object-contain mb-2" />
                      <p className="text-xs text-gray-400 font-mono break-all mb-3">{detailCav.qr_code_data}</p>
                      <button onClick={() => downloadQR(detailCav)}
                        className="btn-primary text-xs w-full">
                        Télécharger PNG
                      </button>
                      <p className="text-xs text-amber-600 mt-2">QR code définitif — ne peut pas être modifié</p>
                    </>
                  ) : detailQrEtat === 'chargement' ? (
                    <p className="text-xs text-gray-400">Chargement...</p>
                  ) : detailQrEtat === 'erreur' ? (
                    <div className="text-center py-4">
                      <p className="text-red-500 text-sm mb-1">QR code indisponible</p>
                      <p className="text-xs text-gray-400 mb-2">{detailQrErreur}</p>
                      <p className="text-xs text-gray-400 font-mono break-all">{detailCav.qr_code_data}</p>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-amber-500 text-sm mb-2">QR code non généré</p>
                      <p className="text-xs text-gray-400">Utilisez le bouton "Générer QR manquants" en haut de page</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Historique de collecte & incidents */}
              <HistoriqueSection key={`histo-${detailCav.id}`} cavId={detailCav.id} />
            </div>
          )}
        </div>

        {/* Modal Création / Édition */}
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editCav ? 'Modifier le CAV' : 'Nouveau CAV'} size="lg">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nom *</label>
                      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="input-modern" placeholder="Ex: ROUEN - 10 rue..." />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Commune</label>
                      <input value={form.commune} onChange={e => setForm(f => ({ ...f, commune: e.target.value }))}
                        className="input-modern" placeholder="Ex: ROUEN" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Adresse</label>
                    <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                      className="input-modern" placeholder="Adresse complète" />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Latitude *</label>
                      <input type="number" step="any" value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                        className="input-modern" placeholder="49.4231" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Longitude *</label>
                      <input type="number" step="any" value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                        className="input-modern" placeholder="1.0993" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nb conteneurs</label>
                      <input type="number" min={1} value={form.nb_containers} onChange={e => setForm(f => ({ ...f, nb_containers: e.target.value }))}
                        className="input-modern" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Code postal</label>
                      <input value={form.code_postal} onChange={e => setForm(f => ({ ...f, code_postal: e.target.value }))}
                        className="input-modern" placeholder="76000" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Communauté de communes</label>
                      <input value={form.communaute_communes} onChange={e => setForm(f => ({ ...f, communaute_communes: e.target.value }))}
                        className="input-modern" placeholder="Métropole Rouen Normandie" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Surface</label>
                      <input value={form.surface} onChange={e => setForm(f => ({ ...f, surface: e.target.value }))}
                        className="input-modern" placeholder="Publique" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Réf. Refashion</label>
                      <input value={form.ref_refashion} onChange={e => setForm(f => ({ ...f, ref_refashion: e.target.value }))}
                        className="input-modern" placeholder="152" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Entité détentrice</label>
                      <input value={form.entite_detentrice} onChange={e => setForm(f => ({ ...f, entite_detentrice: e.target.value }))}
                        className="input-modern" placeholder="Solidarité Textiles" />
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
                        <MapSizeFix />
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
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
                  <button onClick={() => setShowModal(false)} className="btn-ghost text-sm">
                    Annuler
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="btn-primary text-sm">
                    {saving ? 'Enregistrement...' : editCav ? 'Enregistrer' : 'Créer le CAV'}
                  </button>
                </div>
        </Modal>
      </div>
    </Layout>
  );
}
