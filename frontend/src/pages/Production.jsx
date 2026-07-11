import { useState, useEffect, useCallback } from 'react';
import { Factory, Plus, Save, ChevronLeft, ChevronRight, MessageSquare, Trash2, Clock, Users, ClipboardList, BarChart3, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { DataTable, Modal } from '../components';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// Libellés des contenants pour l'affichage lecture seule dans Production
const CONTENANT_LABELS = {
  bac_metal: 'Bac métal',
  bac_metal_jaune: 'Bac métal jaune',
  geobox_rouge: 'Geobox rouge ajouré',
  geobox_noir: 'Geobox noir',
  chariot_grillagee: 'Chariot aire grillagée',
  chariot_curon_petit: 'Chariot curon petit',
  chariot_curon_grand: 'Chariot curon grand',
  palette_eur: 'Palette EUR',
  demi_palette: 'Demi palette légère',
  poubelle_4roues: 'Poubelle 4 roues',
  chariot_pal: 'Chariot grillagée + PAL EUR',
  petite_poubelle: 'Petite poubelle grise',
  sans_contenant: 'Sans contenant',
  tare_manuelle: 'Tare manuelle',
};

export default function Production() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState('feuille');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [feuille, setFeuille] = useState(null);
  const [data, setData] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentType, setCommentType] = useState('general');
  // Refonte V1.7+ : objectifs périodiques, consignes & managers tri
  const [managers, setManagers] = useState({ employees: [], users: [] });
  const [objectives, setObjectives] = useState([]);
  const [consignes, setConsignes] = useState([]);
  const [showObjectiveModal, setShowObjectiveModal] = useState(false);
  const [showConsigneModal, setShowConsigneModal] = useState(false);
  const [objForm, setObjForm] = useState({
    period_type: 'trimestriel', period_start: '', period_end: '',
    type: 'entree_ligne', value_kg: '', value_pct: '', alert_threshold_pct: '', commentaire: '',
  });
  const [consigneForm, setConsigneForm] = useState({
    date_start: new Date().toISOString().slice(0, 10),
    date_end: new Date().toISOString().slice(0, 10),
    message: '',
    priority: 'normal',
  });

  // État de la feuille de production (hors postes — viennent du planning)
  const [form, setForm] = useState({
    encadrant_atelier: '', controleur_tri: '', consigne: '',
    effectif_tri: '', effectif_recuperation: '', effectif_cp: '',
    effectif_formation: '', effectif_abs_injustifiee: '', effectif_am: '',
    entree_recyclage_r3_kg: '', entree_recyclage_r4_kg: '',
    objectif_entree_ligne_kg: 900, objectif_entree_r3_kg: 900, objectif_entree_r4_kg: 900,
    objectif_recyclage_pct: 70, objectif_reutilisation_pct: 30, objectif_csr_pct: '<10%',
    encadrant: '',
  });

  // Charger managers tri (une seule fois)
  useEffect(() => {
    api.get('/production/managers-tri').then((r) => setManagers(r.data || { employees: [], users: [] })).catch(() => {});
  }, []);

  // Charger objectifs en vigueur + consignes pour la date sélectionnée
  useEffect(() => {
    Promise.all([
      api.get(`/production/objectives?date=${selectedDate}`).catch(() => ({ data: [] })),
      api.get(`/production/consignes?date=${selectedDate}`).catch(() => ({ data: [] })),
    ]).then(([objRes, consRes]) => {
      setObjectives(objRes.data || []);
      setConsignes(consRes.data || []);
    });
  }, [selectedDate]);

  // Charger feuille de production
  const loadFeuille = useCallback(async () => {
    try {
      const res = await api.get(`/production/feuille/${selectedDate}`);
      setFeuille(res.data);

      if (res.data.daily) {
        const d = res.data.daily;
        setForm({
          encadrant_atelier: d.encadrant_atelier || '',
          controleur_tri: d.controleur_tri || '',
          consigne: d.consigne || '',
          effectif_tri: d.effectif_tri || '',
          effectif_recuperation: d.effectif_recuperation || '',
          effectif_cp: d.effectif_cp || '',
          effectif_formation: d.effectif_formation || '',
          effectif_abs_injustifiee: d.effectif_abs_injustifiee || '',
          effectif_am: d.effectif_am || '',
          entree_recyclage_r3_kg: d.entree_recyclage_r3_kg || '',
          entree_recyclage_r4_kg: d.entree_recyclage_r4_kg || '',
          objectif_entree_ligne_kg: d.objectif_entree_ligne_kg || 900,
          objectif_entree_r3_kg: d.objectif_entree_r3_kg || 900,
          objectif_entree_r4_kg: d.objectif_entree_r4_kg || 900,
          objectif_recyclage_pct: d.objectif_recyclage_pct || 70,
          objectif_reutilisation_pct: d.objectif_reutilisation_pct || 30,
          objectif_csr_pct: d.objectif_csr_pct || '<10%',
          encadrant: d.encadrant || '',
        });
      } else {
        setForm({
          encadrant_atelier: '', controleur_tri: '', consigne: '',
          effectif_tri: '', effectif_recuperation: '', effectif_cp: '',
          effectif_formation: '', effectif_abs_injustifiee: '', effectif_am: '',
          entree_recyclage_r3_kg: '', entree_recyclage_r4_kg: '',
          objectif_entree_ligne_kg: 900, objectif_entree_r3_kg: 900, objectif_entree_r4_kg: 900,
          objectif_recyclage_pct: 70, objectif_reutilisation_pct: 30, objectif_csr_pct: '<10%',
          encadrant: '',
        });
      }

    } catch (err) {
      console.error(err);
    }
  }, [selectedDate]);

  // Charger données mensuelles
  const loadMonthly = useCallback(async () => {
    try {
      const [listRes, dashRes] = await Promise.all([
        api.get(`/production?month=${month}`),
        api.get(`/production/dashboard?month=${month}`),
      ]);
      setData(listRes.data);
      setDashboard(dashRes.data);
    } catch (err) { console.error(err); }
  }, [month]);

  useEffect(() => {
    if (view === 'feuille') loadFeuille();
    else loadMonthly();
  }, [view, loadFeuille, loadMonthly]);

  const changeDate = (delta) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const effectifTotal = (parseInt(form.effectif_tri) || 0) + (parseInt(form.effectif_recuperation) || 0);

  // Nombre d'opérateurs affectés depuis le planning
  const planningList = feuille?.planning_list || [];
  const nbAffectes = planningList.length;

  // Entrées balance "Vers Atelier de tri" — source vérité pour la pesée
  const balanceEntrees = feuille?.balance_entrees || [];
  const totalAtelier = balanceEntrees.reduce((sum, e) => sum + (parseFloat(e.poids_kg) || 0), 0);
  const objectifTotal = (parseFloat(form.objectif_entree_ligne_kg) || 0) + (parseFloat(form.objectif_entree_r3_kg) || 0) + (parseFloat(form.objectif_entree_r4_kg) || 0);

  // Sauvegarder la feuille (sans postes — ceux-ci sont gérés dans le planning)
  const saveFeuille = async () => {
    setSaving(true);
    try {
      // Totaux alimentés depuis la page balance (sorties "Vers Atelier de tri")
      const totalAtelierLocal = (feuille?.balance_entrees || []).reduce((s, e) => s + (parseFloat(e.poids_kg) || 0), 0);
      // Entrées recyclage R3/R4 : saisie manuelle (pas de source balance dédiée)
      const r3Kg = parseFloat(form.entree_recyclage_r3_kg) || 0;
      const r4Kg = parseFloat(form.entree_recyclage_r4_kg) || 0;
      const objLigne = parseFloat(form.objectif_entree_ligne_kg) || 0;
      const objR3 = parseFloat(form.objectif_entree_r3_kg) || 0;
      const objR4 = parseFloat(form.objectif_entree_r4_kg) || 0;
      const entreeTotaleReelle = totalAtelierLocal + r3Kg + r4Kg;
      await api.post('/production', {
        date: selectedDate,
        effectif_reel: effectifTotal || nbAffectes,
        entree_ligne_kg: totalAtelierLocal,
        objectif_entree_ligne_kg: form.objectif_entree_ligne_kg,
        entree_recyclage_r3_kg: r3Kg,
        objectif_entree_r3_kg: form.objectif_entree_r3_kg,
        entree_recyclage_r4_kg: r4Kg,
        objectif_entree_r4_kg: form.objectif_entree_r4_kg,
        encadrant: form.encadrant,
        encadrant_atelier: form.encadrant_atelier,
        controleur_tri: form.controleur_tri,
        consigne: form.consigne,
        effectif_tri: form.effectif_tri || null,
        effectif_recuperation: form.effectif_recuperation || null,
        effectif_cp: form.effectif_cp || null,
        effectif_formation: form.effectif_formation || null,
        effectif_abs_injustifiee: form.effectif_abs_injustifiee || null,
        effectif_am: form.effectif_am || null,
        objectif_recyclage_pct: form.objectif_recyclage_pct,
        objectif_reutilisation_pct: form.objectif_reutilisation_pct,
        objectif_csr_pct: form.objectif_csr_pct,
        resultat_ligne_ok: totalAtelierLocal >= objLigne,
        resultat_r3_ok: r3Kg >= objR3,
        resultat_r4_ok: r4Kg >= objR4,
        resultat_general_ok: entreeTotaleReelle >= (objLigne + objR3 + objR4),
      });

      await loadFeuille();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const validateFeuille = async () => {
    if (!feuille?.daily) return;
    if (!window.confirm('Clôturer la journée ? Plus aucune modification ne sera possible (sauf réouverture par un administrateur).')) return;
    setValidating(true);
    try {
      await api.post(`/production/feuille/${selectedDate}/validate`, {});
      await loadFeuille();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Erreur lors de la clôture');
    }
    setValidating(false);
  };

  const reopenFeuille = async () => {
    if (!window.confirm('Réouvrir la journée pour modifications ?')) return;
    try {
      await api.post(`/production/feuille/${selectedDate}/reopen`, {});
      await loadFeuille();
    } catch (err) { console.error(err); }
  };

  const saveObjective = async () => {
    if (!objForm.period_start || !objForm.period_end || !objForm.type) {
      alert('Période et type requis');
      return;
    }
    try {
      await api.post('/production/objectives', {
        ...objForm,
        value_kg: objForm.value_kg ? parseFloat(objForm.value_kg) : null,
        value_pct: objForm.value_pct ? parseFloat(objForm.value_pct) : null,
        alert_threshold_pct: objForm.alert_threshold_pct ? parseFloat(objForm.alert_threshold_pct) : null,
      });
      setShowObjectiveModal(false);
      setObjForm({ period_type: 'trimestriel', period_start: '', period_end: '', type: 'entree_ligne', value_kg: '', value_pct: '', alert_threshold_pct: '', commentaire: '' });
      const r = await api.get(`/production/objectives?date=${selectedDate}`);
      setObjectives(r.data || []);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const saveConsigne = async () => {
    if (!consigneForm.message.trim()) { alert('Message requis'); return; }
    try {
      await api.post('/production/consignes', consigneForm);
      setShowConsigneModal(false);
      setConsigneForm({ date_start: selectedDate, date_end: selectedDate, message: '', priority: 'normal' });
      const r = await api.get(`/production/consignes?date=${selectedDate}`);
      setConsignes(r.data || []);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const deleteConsigne = async (id) => {
    if (!window.confirm('Supprimer cette consigne ?')) return;
    try {
      await api.delete(`/production/consignes/${id}`);
      const r = await api.get(`/production/consignes?date=${selectedDate}`);
      setConsignes(r.data || []);
    } catch (err) { console.error(err); }
  };

  const addComment = async () => {
    if (!newComment.trim()) return;
    try {
      await api.post('/production/commentaires', {
        date: selectedDate,
        commentaire: newComment.trim(),
        type: commentType,
      });
      setNewComment('');
      setShowCommentModal(false);
      loadFeuille();
    } catch (err) { console.error(err); }
  };

  const deleteComment = async (id) => {
    try {
      await api.delete(`/production/commentaires/${id}`);
      loadFeuille();
    } catch (err) { console.error(err); }
  };

  const formatDate = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Calculer le lundi de la semaine de la date sélectionnée (pour le lien planning)
  const getWeekStart = (dateStr) => {
    const d = new Date(dateStr);
    const day = d.getDay();
    d.setDate(d.getDate() - ((day + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  // Regrouper les affectations par opération pour l'affichage
  const planningByOperation = {};
  planningList.forEach(s => {
    const opKey = s.operation_code || s.poste_code || 'autre';
    if (!planningByOperation[opKey]) {
      planningByOperation[opKey] = {
        operation_nom: s.operation_nom || s.poste_code || 'Autre',
        chaine_nom: s.chaine_nom || '',
        employes: [],
      };
    }
    planningByOperation[opKey].employes.push(s);
  });

  // ═══════════════════════════════════
  // VUE MENSUELLE (tableau récap)
  // ═══════════════════════════════════
  const chartData = data.map(d => ({
    date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    ligne: d.entree_ligne_kg || 0,
    r3: d.entree_recyclage_r3_kg || 0,
    total: d.total_jour_t || 0,
  }));

  const columns = [
    { key: 'date', label: 'Date', sortable: true, render: (d) => (
      <button onClick={() => { setSelectedDate(new Date(d.date).toISOString().slice(0, 10)); setView('feuille'); }}
        className="font-medium text-primary hover:underline">
        {new Date(d.date).toLocaleDateString('fr-FR')}
      </button>
    )},
    { key: 'effectif_reel', label: 'Effectif', sortable: true },
    { key: 'entree_ligne_kg', label: 'Ligne R1&R2 (kg)', sortable: true,
      render: (d) => <span className={d.entree_ligne_kg >= d.objectif_entree_ligne_kg ? 'text-green-600 font-medium' : 'text-red-500'}>{d.entree_ligne_kg}</span>
    },
    { key: 'entree_recyclage_r3_kg', label: 'R3 (kg)', sortable: true },
    { key: 'total_jour_t', label: 'Total (t)', sortable: true, render: (d) => <span className="font-medium">{d.total_jour_t?.toFixed(2)}</span> },
    { key: 'productivite', label: 'Productivité', sortable: true, render: (d) => `${d.productivite_kg_per?.toFixed(0)} kg/p` },
    { key: 'encadrant', label: 'Encadrant', render: (d) => <span className="text-slate-500">{d.encadrant || '—'}</span> },
  ];

  return (
    <Layout>
      <div className="p-6">
        {/* En-tête avec toggle vue */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Production</h1>
            <p className="text-slate-500">
              {view === 'feuille' ? 'Feuille de production quotidienne' : 'Suivi mensuel — KPI de production'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setView('feuille')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${view === 'feuille' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              <ClipboardList className="w-4 h-4 inline mr-1" />Feuille du jour
            </button>
            <button
              onClick={() => setView('mensuel')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${view === 'mensuel' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              <BarChart3 className="w-4 h-4 inline mr-1" />Vue mensuelle
            </button>
          </div>
        </div>

        {view === 'feuille' ? (
          <div>
            {/* Navigation date */}
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => changeDate(-1)} className="p-2 rounded-lg hover:bg-slate-100">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="input-modern w-auto text-center font-semibold" />
              <button onClick={() => changeDate(1)} className="p-2 rounded-lg hover:bg-slate-100">
                <ChevronRight className="w-5 h-5" />
              </button>
              <span className="text-slate-500 capitalize">{formatDate(selectedDate)}</span>
              <div className="ml-auto flex gap-2 items-center">
                {feuille?.daily?.validated_at && (
                  <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                    ✓ Clôturée le {new Date(feuille.daily.validated_at).toLocaleString('fr-FR')}
                  </span>
                )}
                <button onClick={saveFeuille} disabled={saving || !!feuille?.daily?.validated_at}
                  className="btn-primary text-sm disabled:opacity-50">
                  <Save className="w-4 h-4 mr-2" strokeWidth={1.8} />
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
                {!feuille?.daily?.validated_at ? (
                  <button
                    onClick={validateFeuille}
                    disabled={validating || !feuille?.daily}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!feuille?.daily ? 'Saisir et enregistrer la feuille avant de la clôturer' : ''}
                  >
                    {validating ? 'Clôture…' : 'Valider et clôturer la journée'}
                  </button>
                ) : user?.role === 'ADMIN' && (
                  <button onClick={reopenFeuille} className="text-xs text-slate-500 hover:text-slate-700 underline">
                    Rouvrir
                  </button>
                )}
              </div>
            </div>

            {/* ══ SECTION HAUTE : Objectifs & Effectifs ══ */}
            <div className="card-modern p-4 mb-4">
              <h2 className="text-lg font-bold text-slate-700 mb-3 border-b pb-2">
                <Factory className="w-5 h-5 inline mr-2 text-primary" />
                Production — {formatDate(selectedDate)}
              </h2>

              {/* Objectifs de la ligne */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <p className="text-xs font-semibold text-amber-700 mb-2">Objectifs entrée (kg)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500">Ligne R1&R2</label>
                      <input type="number" value={form.objectif_entree_ligne_kg}
                        onChange={e => setForm({ ...form, objectif_entree_ligne_kg: e.target.value })}
                        className="input-modern text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">R3</label>
                      <input type="number" value={form.objectif_entree_r3_kg}
                        onChange={e => setForm({ ...form, objectif_entree_r3_kg: e.target.value })}
                        className="input-modern text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">R4</label>
                      <input type="number" value={form.objectif_entree_r4_kg}
                        onChange={e => setForm({ ...form, objectif_entree_r4_kg: e.target.value })}
                        className="input-modern text-sm" />
                    </div>
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <p className="text-xs font-semibold text-blue-700 mb-2">Objectifs tri (%)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500">Recyclage</label>
                      <input type="number" value={form.objectif_recyclage_pct}
                        onChange={e => setForm({ ...form, objectif_recyclage_pct: e.target.value })}
                        className="input-modern text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">Réutilisation</label>
                      <input type="number" value={form.objectif_reutilisation_pct}
                        onChange={e => setForm({ ...form, objectif_reutilisation_pct: e.target.value })}
                        className="input-modern text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">CSR</label>
                      <input value={form.objectif_csr_pct}
                        onChange={e => setForm({ ...form, objectif_csr_pct: e.target.value })}
                        className="input-modern text-sm" />
                    </div>
                  </div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                  <p className="text-xs font-semibold text-green-700 mb-2">Encadrement</p>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] text-slate-500">Encadrant atelier</label>
                      <ManagerSelect
                        value={form.encadrant_atelier}
                        onChange={(v) => setForm({ ...form, encadrant_atelier: v, encadrant: v })}
                        managers={managers}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">Contrôle tri</label>
                      <ManagerSelect
                        value={form.controleur_tri}
                        onChange={(v) => setForm({ ...form, controleur_tri: v })}
                        managers={managers}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Effectif détaillé — LECTURE SEULE depuis le planning */}
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 mb-3">
                <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center justify-between">
                  <span>
                    <Users className="w-4 h-4 inline mr-1" />
                    Effectif du jour — Total : <span className="text-primary text-sm">{nbAffectes || effectifTotal || '—'}</span>
                    <span className="text-slate-400 ml-2">(lecture depuis le planning hebdo)</span>
                  </span>
                  <button
                    onClick={() => navigate(`/planning-hebdo?week_start=${getWeekStart(selectedDate)}`)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Modifier le planning
                  </button>
                </p>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {[
                    { key: 'effectif_tri', label: 'Tri' },
                    { key: 'effectif_recuperation', label: 'Récupération' },
                    { key: 'effectif_cp', label: 'CP' },
                    { key: 'effectif_formation', label: 'Formation' },
                    { key: 'effectif_abs_injustifiee', label: 'Abs. injust.' },
                    { key: 'effectif_am', label: 'Arrêt maladie' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-[10px] text-slate-500">{label}</label>
                      <input type="number" value={form[key] || ''}
                        readOnly disabled
                        className="input-modern text-sm bg-slate-100 cursor-not-allowed" placeholder="0" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Consignes datées — bandeau lecture + bouton ajout */}
              <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-amber-800">
                    📋 Consignes du directeur ({consignes.length})
                  </p>
                  {(user?.role === 'ADMIN' || user?.role === 'MANAGER') && (
                    <button
                      onClick={() => setShowConsigneModal(true)}
                      className="text-xs text-amber-700 hover:text-amber-900 underline"
                    >
                      + Ajouter une consigne
                    </button>
                  )}
                </div>
                {consignes.length === 0 ? (
                  <p className="text-xs text-amber-600 italic">Aucune consigne pour cette journée</p>
                ) : (
                  <div className="space-y-2">
                    {consignes.map((c) => (
                      <div key={c.id} className="bg-white rounded p-2 border border-amber-100">
                        <div className="flex items-start gap-2">
                          <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                            c.priority === 'urgent' ? 'bg-red-100 text-red-700'
                              : c.priority === 'important' ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}>{c.priority}</span>
                          <p className="text-sm text-slate-700 flex-1">{c.message}</p>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Du {new Date(c.date_start).toLocaleDateString('fr-FR')} au {new Date(c.date_end).toLocaleDateString('fr-FR')}
                          {(c.author_first || c.author_last) && ` — ${c.author_first || ''} ${c.author_last || ''}`.trim()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ══ OBJECTIFS PÉRIODIQUES (trim entrée + mois tri) ══ */}
            <ObjectivesPanel
              objectives={objectives}
              onAdd={() => setShowObjectiveModal(true)}
              canEdit={user?.role === 'ADMIN' || user?.role === 'MANAGER'}
            />

            {/* ══ SECTION CENTRALE : Affectations planning + Chariots ══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              {/* Affectations opérateurs (lecture depuis le planning) */}
              <div className="card-modern p-4">
                <div className="flex items-center justify-between mb-3 border-b pb-2">
                  <h3 className="text-sm font-bold text-slate-700">
                    <Users className="w-4 h-4 inline mr-1 text-amber-600" />
                    Opérateurs sur table
                    {nbAffectes > 0 && <span className="ml-2 text-xs font-normal text-slate-400">({nbAffectes} personnes)</span>}
                  </h3>
                  <button
                    onClick={() => navigate(`/planning-hebdo?week_start=${getWeekStart(selectedDate)}`)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Modifier dans le planning
                  </button>
                </div>

                {Object.keys(planningByOperation).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(planningByOperation).map(([opCode, op]) => (
                      <div key={opCode} className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-slate-700">{op.operation_nom}</span>
                          {op.chaine_nom && <span className="text-[10px] text-slate-400">({op.chaine_nom})</span>}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {op.employes.map((e, i) => (
                            <span key={i} className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${
                              e.is_provisional
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'bg-green-100 text-green-700 border border-green-200'
                            }`}>
                              {e.first_name} {e.last_name}
                              {e.is_provisional && <span className="ml-1 text-[9px]">(prov.)</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">Aucune affectation dans le planning pour cette date</p>
                    <button
                      onClick={() => navigate(`/planning-hebdo?week_start=${getWeekStart(selectedDate)}`)}
                      className="text-xs text-primary hover:underline mt-2"
                    >
                      Affecter des opérateurs dans le planning
                    </button>
                  </div>
                )}
              </div>

              {/* Pesées — lecture seule, alimentées par la page balance */}
              <div className="card-modern p-4">
                <div className="flex items-center justify-between mb-3 border-b pb-2">
                  <h3 className="text-sm font-bold text-slate-700">
                    <Factory className="w-4 h-4 inline mr-1 text-green-600" />
                    Entrées atelier de tri
                  </h3>
                  <a href="/balance" target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" />
                    Page balance
                  </a>
                </div>

                {balanceEntrees.length === 0 ? (
                  <div className="text-center py-8">
                    <Factory className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">Aucune entrée saisie sur la balance pour cette date.</p>
                    <a href="/balance" target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline mt-1 block">
                      Ouvrir la page balance →
                    </a>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {balanceEntrees.map((e) => (
                      <div key={e.id} className="flex items-center justify-between py-1.5 px-2 bg-slate-50 rounded border border-slate-100 text-xs">
                        <span className="text-slate-400 w-12 shrink-0">
                          {new Date(e.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-slate-600 flex-1 mx-2">
                          {CONTENANT_LABELS[e.contenant] || e.contenant || '—'}
                          {e.poids_brut_kg && e.tare_kg != null && (
                            <span className="text-slate-400 ml-1">({parseFloat(e.poids_brut_kg).toFixed(1)} - {parseFloat(e.tare_kg).toFixed(1)})</span>
                          )}
                        </span>
                        <span className="font-semibold text-slate-800 shrink-0">{parseFloat(e.poids_kg).toFixed(1)} kg</span>
                      </div>
                    ))}
                    <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between items-center">
                      <span className="text-xs font-semibold text-slate-600">Total atelier</span>
                      <span className={`text-sm font-bold ${totalAtelier >= objectifTotal ? 'text-green-600' : 'text-red-500'}`}>
                        {totalAtelier.toFixed(1)} kg
                        <span className="text-xs font-normal text-slate-400 ml-1">/ obj. {objectifTotal} kg</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Entrées recyclage R3 / R4 — saisie manuelle (pas de source balance) */}
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <p className="text-[10px] font-semibold text-slate-500 mb-2">Entrées recyclage — saisie manuelle (kg)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500">R3 (kg)</label>
                      <input type="number" min="0" value={form.entree_recyclage_r3_kg}
                        onChange={e => setForm({ ...form, entree_recyclage_r3_kg: e.target.value })}
                        disabled={!!feuille?.daily?.validated_at}
                        className="input-modern text-sm disabled:bg-slate-100 disabled:cursor-not-allowed" placeholder="0" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500">R4 (kg)</label>
                      <input type="number" min="0" value={form.entree_recyclage_r4_kg}
                        onChange={e => setForm({ ...form, entree_recyclage_r4_kg: e.target.value })}
                        disabled={!!feuille?.daily?.validated_at}
                        className="input-modern text-sm disabled:bg-slate-100 disabled:cursor-not-allowed" placeholder="0" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ══ SECTION BASSE : Résultats + Commentaires ══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              {/* Résultats du jour */}
              <div className="card-modern p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-3 border-b pb-2">Résultats du jour</h3>
                <div className="space-y-2">
                  {(() => {
                    const ok = totalAtelier >= objectifTotal;
                    return (
                      <div className={`flex items-center justify-between p-2 rounded-lg ${ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                        <span className="text-xs font-medium text-slate-700">Total entrées atelier</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold">{totalAtelier.toFixed(1)} kg</span>
                          <span className="text-xs text-slate-400">Obj: {objectifTotal} kg</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${ok ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                            {ok ? 'OK' : 'NOK'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p className="text-[10px] text-slate-500 mb-1 font-medium">Objectifs de référence</p>
                    <div className="grid grid-cols-3 gap-1 text-xs text-slate-600">
                      <span>Ligne R1&R2 : {form.objectif_entree_ligne_kg} kg</span>
                      <span>R3 : {form.objectif_entree_r3_kg} kg</span>
                      <span>R4 : {form.objectif_entree_r4_kg} kg</span>
                    </div>
                  </div>
                  {(effectifTotal > 0 || nbAffectes > 0) && totalAtelier > 0 && (
                    <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 border border-blue-200">
                      <span className="text-xs font-medium text-slate-700">Productivité</span>
                      <span className="text-sm font-bold text-blue-700">
                        {Math.round(totalAtelier / (effectifTotal || nbAffectes))} kg/personne
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Commentaires */}
              <div className="card-modern p-4">
                <div className="flex items-center justify-between mb-3 border-b pb-2">
                  <h3 className="text-sm font-bold text-slate-700">
                    <MessageSquare className="w-4 h-4 inline mr-1 text-blue-600" />
                    Commentaires
                  </h3>
                  <button onClick={() => setShowCommentModal(true)} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Ajouter
                  </button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {feuille?.commentaires?.length > 0 ? feuille.commentaires.map(c => (
                    <div key={c.id} className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium mr-1 ${
                            c.type === 'consigne' ? 'bg-amber-100 text-amber-700' :
                            c.type === 'resultat' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-200 text-slate-600'
                          }`}>
                            {c.type === 'consigne' ? 'Consigne' : c.type === 'resultat' ? 'Résultat' : 'Général'}
                          </span>
                          <p className="text-xs text-slate-700 mt-1">{c.commentaire}</p>
                          <p className="text-[10px] text-slate-400 mt-1">
                            <Clock className="w-3 h-3 inline mr-0.5" />
                            {new Date(c.created_at).toLocaleString('fr-FR')}
                            {c.auteur_prenom && ` — ${c.auteur_prenom} ${c.auteur_nom}`}
                          </p>
                        </div>
                        <button onClick={() => deleteComment(c.id)} className="text-slate-300 hover:text-red-500 ml-2">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )) : (
                    <p className="text-xs text-slate-400 text-center py-4">Aucun commentaire pour cette journée</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ═══════════════════════════════════════════════ */
          /* VUE MENSUELLE                                 */
          /* ═══════════════════════════════════════════════ */
          <div>
            <div className="flex justify-end mb-4">
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input-modern w-auto" />
            </div>

            {dashboard && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <KPICard label="Total mois (t)" value={dashboard.summary?.total_mois_t ? parseFloat(dashboard.summary.total_mois_t).toFixed(1) : '0'} target={dashboard.objectif_mensuel_t} color="text-primary" />
                <KPICard label="Moy. productivité" value={`${dashboard.summary?.productivite_moyenne || '0'} kg/pers`} color="text-blue-600" />
                <KPICard label="Jours saisis" value={dashboard.summary?.jours_travailles || 0} color="text-purple-600" />
                <KPICard label="Effectif moyen" value={dashboard.summary?.effectif_moyen || '0'} color="text-orange-600" />
              </div>
            )}

            <div className="card-modern p-4 mb-6">
              <h3 className="font-semibold mb-3">Entrées quotidiennes (kg)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <ReferenceLine y={900} stroke="#EF4444" strokeDasharray="5 5" label={{ value: 'Obj. 900kg', fill: '#EF4444', fontSize: 10 }} />
                  <Bar dataKey="ligne" name="Ligne R1&R2" fill="#0D9488" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="r3" name="Recyclage R3" fill="#6366F1" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <DataTable
              columns={columns}
              data={data}
              loading={false}
              emptyIcon={Factory}
              emptyMessage="Aucune donnée pour ce mois"
              dense
            />
          </div>
        )}

        {/* Modal ajout commentaire */}
        <Modal isOpen={showCommentModal} onClose={() => setShowCommentModal(false)} title="Ajouter un commentaire" size="sm"
          footer={<>
            <button type="button" onClick={() => setShowCommentModal(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="button" onClick={addComment} className="flex-1 btn-primary text-sm">Enregistrer</button>
          </>}
        >
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Type</label>
              <select value={commentType} onChange={e => setCommentType(e.target.value)} className="input-modern text-sm">
                <option value="general">Général</option>
                <option value="consigne">Consigne</option>
                <option value="resultat">Résultat</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Commentaire</label>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)}
                className="input-modern text-sm" rows={4} placeholder="Saisissez votre commentaire..."
                autoFocus />
            </div>
          </div>
        </Modal>

        {/* Modal nouvel objectif (trim/mois) */}
        <Modal isOpen={showObjectiveModal} onClose={() => setShowObjectiveModal(false)} title="Nouvel objectif de production" size="md"
          footer={<>
            <button type="button" onClick={() => setShowObjectiveModal(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="button" onClick={saveObjective} className="flex-1 btn-primary text-sm">Enregistrer</button>
          </>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Période</label>
                <select value={objForm.period_type} onChange={(e) => setObjForm({ ...objForm, period_type: e.target.value })} className="input-modern text-sm">
                  <option value="trimestriel">Trimestriel (entrée matière)</option>
                  <option value="mensuel">Mensuel (% tri)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Type</label>
                <select value={objForm.type} onChange={(e) => setObjForm({ ...objForm, type: e.target.value })} className="input-modern text-sm">
                  {objForm.period_type === 'trimestriel' ? (
                    <option value="entree_ligne">Entrée chaîne tri (kg)</option>
                  ) : (
                    <>
                      <option value="recyclage">% Recyclage</option>
                      <option value="reemploi">% Réemploi</option>
                      <option value="csr">% CSR (avec seuil alerte)</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Début</label>
                <input type="date" value={objForm.period_start} onChange={(e) => setObjForm({ ...objForm, period_start: e.target.value })} className="input-modern text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Fin</label>
                <input type="date" value={objForm.period_end} onChange={(e) => setObjForm({ ...objForm, period_end: e.target.value })} className="input-modern text-sm" />
              </div>
              {objForm.period_type === 'trimestriel' ? (
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Tonnage cible (kg)</label>
                  <input type="number" value={objForm.value_kg} onChange={(e) => setObjForm({ ...objForm, value_kg: e.target.value })} className="input-modern text-sm" />
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Pourcentage cible</label>
                    <input type="number" value={objForm.value_pct} onChange={(e) => setObjForm({ ...objForm, value_pct: e.target.value })} className="input-modern text-sm" placeholder="ex: 70" />
                  </div>
                  {objForm.type === 'csr' && (
                    <div>
                      <label className="text-xs font-medium text-red-600 mb-1 block">Seuil d'alerte (%)</label>
                      <input type="number" value={objForm.alert_threshold_pct} onChange={(e) => setObjForm({ ...objForm, alert_threshold_pct: e.target.value })} className="input-modern text-sm" placeholder="ex: 10" />
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Commentaire</label>
              <textarea value={objForm.commentaire} onChange={(e) => setObjForm({ ...objForm, commentaire: e.target.value })} className="input-modern text-sm" rows={2} />
            </div>
          </div>
        </Modal>

        {/* Modal nouvelle consigne */}
        <Modal isOpen={showConsigneModal} onClose={() => setShowConsigneModal(false)} title="Nouvelle consigne du directeur" size="md"
          footer={<>
            <button type="button" onClick={() => setShowConsigneModal(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="button" onClick={saveConsigne} className="flex-1 btn-primary text-sm">Enregistrer</button>
          </>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Du</label>
                <input type="date" value={consigneForm.date_start} onChange={(e) => setConsigneForm({ ...consigneForm, date_start: e.target.value })} className="input-modern text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Au</label>
                <input type="date" value={consigneForm.date_end} onChange={(e) => setConsigneForm({ ...consigneForm, date_end: e.target.value })} className="input-modern text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Priorité</label>
              <select value={consigneForm.priority} onChange={(e) => setConsigneForm({ ...consigneForm, priority: e.target.value })} className="input-modern text-sm">
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Message</label>
              <textarea value={consigneForm.message} onChange={(e) => setConsigneForm({ ...consigneForm, message: e.target.value })} className="input-modern text-sm" rows={4} autoFocus placeholder="Ex: Privilégier l'enlèvement des stocks de KINTSU pour libérer le quai 2…" />
            </div>
          </div>
        </Modal>
      </div>
    </Layout>
  );
}

function KPICard({ label, value, target, color }) {
  return (
    <div className="card-modern p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {target && <p className="text-xs text-slate-400">Objectif : {target}t</p>}
    </div>
  );
}

// Sélecteur de manager (Encadrant atelier / Contrôle tri)
function ManagerSelect({ value, onChange, managers }) {
  // Compose la liste : tous les managers tri + tous les users ADMIN/MANAGER
  const all = [
    ...(managers.employees || []).map((m) => ({ key: `e-${m.id}`, label: m.nom + (m.poste ? ` (${m.poste})` : '') })),
    ...(managers.users || []).map((u) => ({ key: `u-${u.id}`, label: u.nom + ` [${u.role}]` })),
  ];
  // Si la valeur ne correspond à aucun, on l'ajoute en tête (cas legacy texte libre)
  const valueExists = all.some((o) => o.label === value);
  const options = !value || valueExists ? all : [{ key: 'custom', label: value + ' (saisi)' }, ...all];

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className="input-modern text-sm"
    >
      <option value="">— Sélectionner —</option>
      {options.map((o) => (
        <option key={o.key} value={o.label}>{o.label}</option>
      ))}
    </select>
  );
}

// Panneau récapitulatif des objectifs en vigueur (trim entrée + mois tri) avec alerte CSR
function ObjectivesPanel({ objectives, onAdd, canEdit }) {
  const trim = objectives.filter((o) => o.period_type === 'trimestriel');
  const mois = objectives.filter((o) => o.period_type === 'mensuel');
  const csrObj = mois.find((o) => o.type === 'csr');

  const labelType = (t) => ({
    entree_ligne: 'Entrée chaîne (kg)',
    recyclage: '% Recyclage',
    reemploi: '% Réemploi',
    csr: '% CSR',
  })[t] || t;

  return (
    <div className="card-modern p-4 mb-4">
      <div className="flex items-center justify-between mb-3 border-b pb-2">
        <h2 className="text-sm font-bold text-slate-700">
          🎯 Objectifs en vigueur
        </h2>
        {canEdit && (
          <button onClick={onAdd} className="text-xs text-primary hover:underline">
            + Nouvel objectif
          </button>
        )}
      </div>

      {objectives.length === 0 ? (
        <p className="text-xs text-slate-400 italic text-center py-4">Aucun objectif défini pour cette période</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Trimestre */}
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <p className="text-xs font-bold text-blue-800 uppercase mb-2">Objectif trimestriel — Matière entrante</p>
            {trim.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Aucun</p>
            ) : trim.map((o) => (
              <div key={o.id} className="flex items-baseline justify-between text-sm">
                <span className="text-slate-600">{labelType(o.type)}</span>
                <span className="font-bold text-blue-700">{o.value_kg ? Number(o.value_kg).toLocaleString('fr-FR') + ' kg' : '—'}</span>
              </div>
            ))}
            {trim[0]?.period_start && (
              <p className="text-[10px] text-slate-400 mt-1">
                {new Date(trim[0].period_start).toLocaleDateString('fr-FR')} → {new Date(trim[0].period_end).toLocaleDateString('fr-FR')}
              </p>
            )}
          </div>

          {/* Mois */}
          <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
            <p className="text-xs font-bold text-emerald-800 uppercase mb-2">Objectif mensuel — Répartition tri</p>
            {mois.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Aucun</p>
            ) : mois.map((o) => (
              <div key={o.id} className="flex items-baseline justify-between text-sm">
                <span className="text-slate-600 flex items-center gap-1">
                  {labelType(o.type)}
                  {o.type === 'csr' && o.alert_threshold_pct && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">⚠ alerte ≥ {o.alert_threshold_pct}%</span>
                  )}
                </span>
                <span className="font-bold text-emerald-700">{o.value_pct != null ? `${o.value_pct}%` : '—'}</span>
              </div>
            ))}
            {csrObj?.alert_threshold_pct && (
              <p className="text-[10px] text-red-600 mt-1 italic">
                Alerte CSR : ne doit pas dépasser {csrObj.alert_threshold_pct}% sur le trimestre
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
