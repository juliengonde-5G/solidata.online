import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader } from '../components';
import { Settings, Handshake, Target, Award } from 'lucide-react';
import api from '../services/api';
import { resetInsertionParametresCache } from '../components/insertion/parametres';
import { COMPETENCE_FILIERES, COMPETENCE_FILIERE_LABELS } from '../components/insertion/freins';

/**
 * Réglages du module Insertion (/admin/insertion — ADMIN).
 *  - Partenaires : référentiel (GET/POST/PUT /insertion/partenaires) —
 *    ajout, édition, désactivation (pas de suppression : historique conservé) ;
 *  - Paramètres insertion.* : lus via GET /insertion/parametres (défauts en
 *    code) + GET /settings pour les clés serveur (anticipation renouvellements,
 *    rétention RGPD), écrits via PUT /settings/:key (pattern settings existant) ;
 *  - Cibles conventionnelles : formulaire UNIQUEMENT dans « Pilotage &
 *    indicateurs » (/insertion/audit) — simple lien ici, pas de doublon.
 */

const PARTENAIRE_CATEGORIES = ['administratif', 'emploi', 'logement', 'sante', 'justice', 'formation', 'mobilite', 'autre'];
const CATEGORIE_LABELS = {
  administratif: 'Administratif', emploi: 'Emploi', logement: 'Logement', sante: 'Santé',
  justice: 'Justice', formation: 'Formation', mobilite: 'Mobilité', autre: 'Autre',
};

// Paramètres éditables — clé settings complète, libellé, aide, type, défaut code.
const PARAMS = [
  { key: 'insertion.delai_diagnostic_jours', name: 'delai_diagnostic_jours', label: 'Délai cible du diagnostic d\'accueil (jours)', help: 'Après l\'entrée en parcours ; au-delà, une alerte « diagnostic absent » s\'affiche.', type: 'number', def: 30 },
  { key: 'insertion.alerte_pass_iae_mois', name: 'alerte_pass_iae_mois', label: 'Alerte Pass IAE (mois avant échéance)', help: 'Premier seuil d\'alerte avant la fin du Pass (le second est fixé à 2 mois).', type: 'number', def: 7 },
  { key: 'insertion.echeance_action_defaut_jours', name: 'echeance_action_defaut_jours', label: 'Échéance par défaut d\'une action CIP (jours)', help: 'Pré-remplie dans « + Action » (modifiable à la saisie).', type: 'number', def: 14 },
  { key: 'insertion.rythme_bilans_mois', name: 'rythme_bilans_mois', label: 'Rythme usuel des bilans (mois)', help: 'Sert à proposer la date du prochain entretien à la clôture d\'un bilan.', type: 'number', def: 2 },
  { key: 'insertion.renouvellement_anticipation_jours', name: 'renouvellement_anticipation_jours', label: 'Anticipation des renouvellements (jours)', help: 'Fenêtre de la liste « Renouvellements à préparer » (défaut 42 j = 6 semaines).', type: 'number', def: 42 },
  { key: 'insertion.retention_months', name: 'retention_months', label: 'Rétention RGPD des dossiers sortis (mois)', help: 'Délai avant anonymisation des dossiers d\'insertion après la fin du parcours (référentiel CNIL : 24 mois).', type: 'number', def: 24 },
  { key: 'insertion.ia_preparation_auto', name: 'ia_preparation_auto', label: 'Préparation IA automatique à J-7', help: 'Génère la note de préparation IA 7 jours avant chaque entretien planifié.', type: 'boolean', def: false },
];

export default function AdminInsertion() {
  // ── Paramètres ──
  const [values, setValues] = useState(null); // { name: string }
  const [paramError, setParamError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);

  // ── Partenaires ──
  const [partenaires, setPartenaires] = useState([]);
  const [partError, setPartError] = useState(null);
  const [partLoading, setPartLoading] = useState(true);
  const [editPart, setEditPart] = useState(null); // { id?, form }

  // ── Grilles de compétences (Lot 8) ──
  const [refFiliere, setRefFiliere] = useState('tri');
  const [referentiels, setReferentiels] = useState([]);
  const [refLoading, setRefLoading] = useState(true);
  const [refError, setRefError] = useState(null);
  const [editRef, setEditRef] = useState(null); // { id?, error, form:{filiere,rubrique,item,ordre,actif} }

  const loadParams = useCallback(async () => {
    try {
      // Les 5 clés exposées au module + les clés serveur via /settings (ADMIN).
      const [pRes, sRes] = await Promise.all([
        api.get('/insertion/parametres'),
        api.get('/settings').catch(() => ({ data: [] })),
      ]);
      const settingsByKey = new Map((Array.isArray(sRes.data) ? sRes.data : []).map((r) => [r.key, r.value]));
      const out = {};
      for (const p of PARAMS) {
        let v = pRes.data?.[p.name];
        if (v === undefined) v = settingsByKey.get(p.key); // clés serveur (anticipation, rétention)
        if (v === undefined || v === null || v === '') v = p.def;
        out[p.name] = p.type === 'boolean'
          ? ['true', '1', 'oui', 'yes'].includes(String(v).trim().toLowerCase()) || v === true
          : String(v);
      }
      setValues(out);
      setParamError(null);
    } catch (err) {
      setParamError(err.response?.data?.error || err.message);
      // Défauts affichés quand même (l'édition reste possible).
      setValues(Object.fromEntries(PARAMS.map((p) => [p.name, p.type === 'boolean' ? p.def : String(p.def)])));
    }
  }, []);

  const loadPartenaires = useCallback(() => {
    setPartLoading(true);
    api.get('/insertion/partenaires')
      .then((r) => { setPartenaires(Array.isArray(r.data) ? r.data : []); setPartError(null); })
      .catch((err) => setPartError(err.response?.data?.error || err.message))
      .finally(() => setPartLoading(false));
  }, []);

  const loadReferentiels = useCallback((filiere) => {
    setRefLoading(true);
    api.get(`/insertion/competence-referentiels?filiere=${filiere}`)
      .then((r) => { setReferentiels(Array.isArray(r.data) ? r.data : []); setRefError(null); })
      .catch((err) => setRefError(err.response?.data?.error || err.message))
      .finally(() => setRefLoading(false));
  }, []);

  useEffect(() => { loadParams(); loadPartenaires(); }, [loadParams, loadPartenaires]);
  useEffect(() => { loadReferentiels(refFiliere); }, [loadReferentiels, refFiliere]);

  const openRef = (it = null) => setEditRef({
    id: it?.id || null, error: null,
    form: { filiere: it?.filiere || refFiliere, rubrique: it?.rubrique || '', item: it?.item || '', ordre: it?.ordre ?? '', actif: it ? it.actif !== false : true },
  });

  const saveRef = async () => {
    const { id, form } = editRef;
    if (!form.rubrique.trim() || !form.item.trim()) { setEditRef({ ...editRef, error: 'Rubrique et item sont obligatoires.' }); return; }
    try {
      const body = {
        filiere: form.filiere, rubrique: form.rubrique.trim(), item: form.item.trim(),
        ordre: form.ordre === '' ? 0 : (parseInt(form.ordre, 10) || 0), actif: form.actif,
      };
      if (id) await api.put(`/insertion/competence-referentiels/${id}`, body);
      else await api.post('/insertion/competence-referentiels', body);
      setEditRef(null);
      loadReferentiels(refFiliere);
    } catch (err) {
      setEditRef({ ...editRef, error: err.response?.data?.error || err.message });
    }
  };

  const toggleRefActif = async (it) => {
    setRefError(null);
    try { await api.put(`/insertion/competence-referentiels/${it.id}`, { actif: it.actif === false }); loadReferentiels(refFiliere); }
    catch (err) { setRefError(err.response?.data?.error || err.message); }
  };

  const deleteRef = async (it) => {
    if (!window.confirm(`Supprimer « ${it.item} » du référentiel ? Les évaluations déjà saisies conservent une copie de l'intitulé.`)) return;
    setRefError(null);
    try { await api.delete(`/insertion/competence-referentiels/${it.id}`); loadReferentiels(refFiliere); }
    catch (err) { setRefError(err.response?.data?.error || err.message); }
  };

  const saveParam = async (p) => {
    setSavingKey(p.name); setParamError(null); setSavedKey(null);
    try {
      const raw = values[p.name];
      let value;
      if (p.type === 'boolean') value = raw ? 'true' : 'false';
      else {
        const n = parseFloat(raw);
        if (raw === '' || Number.isNaN(n) || n < 0) {
          setParamError(`${p.label} : nombre positif attendu.`);
          setSavingKey(null);
          return;
        }
        value = String(n);
      }
      await api.put(`/settings/${encodeURIComponent(p.key)}`, { value });
      resetInsertionParametresCache();
      setSavedKey(p.name);
      setTimeout(() => setSavedKey((k) => (k === p.name ? null : k)), 2500);
    } catch (err) {
      setParamError(err.response?.data?.error || err.message);
    }
    setSavingKey(null);
  };

  const savePartenaire = async () => {
    const { id, form } = editPart;
    if (!form.nom.trim()) { setEditPart({ ...editPart, error: 'Le nom est obligatoire.' }); return; }
    try {
      const body = {
        nom: form.nom.trim(),
        categorie: form.categorie || null,
        contact_nom: form.contact_nom.trim() || null,
        contact_tel: form.contact_tel.trim() || null,
        contact_email: form.contact_email.trim() || null,
        notes: form.notes.trim() || null,
        actif: form.actif,
      };
      if (id) await api.put(`/insertion/partenaires/${id}`, body);
      else await api.post('/insertion/partenaires', body);
      setEditPart(null);
      loadPartenaires();
    } catch (err) {
      setEditPart({ ...editPart, error: err.response?.data?.error || err.message });
    }
  };

  const toggleActif = async (p) => {
    setPartError(null);
    try {
      await api.put(`/insertion/partenaires/${p.id}`, { actif: !p.actif });
      loadPartenaires();
    } catch (err) {
      setPartError(err.response?.data?.error || err.message);
    }
  };

  const openPartenaire = (p = null) => setEditPart({
    id: p?.id || null,
    error: null,
    form: {
      nom: p?.nom || '', categorie: p?.categorie || '', contact_nom: p?.contact_nom || '',
      contact_tel: p?.contact_tel || '', contact_email: p?.contact_email || '',
      notes: p?.notes || '', actif: p ? p.actif !== false : true,
    },
  });

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <PageHeader
          title="Réglages insertion"
          subtitle="Paramètres du module, référentiel des partenaires, cibles conventionnelles"
          icon={Settings}
        />

        <div className="space-y-6">
          {/* ── Paramètres ── */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2"><Settings className="w-4 h-4 text-teal-600" /> Paramètres du module</h3>
            <p className="text-[11px] text-gray-400 mb-4">
              Chaque paramètre a un défaut en code : effacer une valeur ne casse rien. Les changements s'appliquent immédiatement (alertes au prochain calcul).
            </p>
            {paramError && <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{paramError}</div>}
            {!values ? <LoadingSpinner size="md" message="Chargement des paramètres…" /> : (
              <div className="space-y-3">
                {PARAMS.map((p) => (
                  <div key={p.key} className="flex items-center gap-3 flex-wrap border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex-1 min-w-[220px]">
                      <p className="text-sm font-medium text-gray-700">{p.label}</p>
                      <p className="text-[11px] text-gray-400">{p.help} <span className="text-gray-300">— défaut : {String(p.def)}</span></p>
                    </div>
                    {p.type === 'boolean' ? (
                      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                        <input type="checkbox" checked={values[p.name] === true}
                          onChange={(e) => setValues({ ...values, [p.name]: e.target.checked })} className="rounded border-gray-300 w-4 h-4" />
                        {values[p.name] ? 'Activée' : 'Désactivée'}
                      </label>
                    ) : (
                      <input type="number" min="0" value={values[p.name]}
                        onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                        className="input-modern py-1.5 w-24 text-sm" />
                    )}
                    <button type="button" onClick={() => saveParam(p)} disabled={savingKey === p.name}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50">
                      {savingKey === p.name ? '…' : savedKey === p.name ? '✓ Enregistré' : 'Enregistrer'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Cibles conventionnelles : lien unique (pas de doublon) ── */}
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <Target className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-teal-800">Cibles conventionnelles (taux de sorties, ETP)</p>
                <p className="text-xs text-teal-700">Elles se saisissent dans « Pilotage &amp; indicateurs », au regard des taux réalisés — à reporter depuis l'annexe financière confirmée par la direction.</p>
              </div>
            </div>
            <Link to="/insertion/audit" className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 whitespace-nowrap">
              Ouvrir Pilotage &amp; indicateurs
            </Link>
          </div>

          {/* ── Partenaires ── */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Handshake className="w-4 h-4 text-teal-600" /> Partenaires mobilisables ({partenaires.length})</h3>
              <button type="button" onClick={() => openPartenaire()}
                className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700">
                + Partenaire
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              Référentiel des partenaires rattachables aux actions CIP. La désactivation les retire des listes de saisie sans toucher à l'historique.
            </p>
            {partError && <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{partError}</div>}
            {partLoading ? <LoadingSpinner size="md" message="Chargement des partenaires…" /> : partenaires.length === 0 ? (
              <p className="text-sm text-gray-400 border border-dashed rounded-lg p-3 text-center">Aucun partenaire — ajoutez les organismes que vous mobilisez (France Travail, CCAS, missions locales…).</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="py-1.5 pr-2">Nom</th>
                      <th className="py-1.5 pr-2">Catégorie</th>
                      <th className="py-1.5 pr-2">Contact</th>
                      <th className="py-1.5 pr-2">Statut</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {partenaires.map((p) => (
                      <tr key={p.id} className={`border-b border-gray-50 ${p.actif === false ? 'opacity-50' : ''}`}>
                        <td className="py-1.5 pr-2 font-medium text-gray-700">{p.nom}</td>
                        <td className="py-1.5 pr-2">
                          {p.categorie ? <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{CATEGORIE_LABELS[p.categorie] || p.categorie}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-gray-500">
                          {[p.contact_nom, p.contact_tel, p.contact_email].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="py-1.5 pr-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${p.actif === false ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>
                            {p.actif === false ? 'Désactivé' : 'Actif'}
                          </span>
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openPartenaire(p)} className="text-xs text-teal-700 hover:underline mr-2">Modifier</button>
                          <button type="button" onClick={() => toggleActif(p)} className="text-xs text-gray-500 hover:underline">
                            {p.actif === false ? 'Réactiver' : 'Désactiver'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Grilles de compétences par filière (Lot 8) ── */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Award className="w-4 h-4 text-teal-600" /> Grilles de compétences</h3>
              <div className="flex items-center gap-2">
                <select value={refFiliere} onChange={(e) => setRefFiliere(e.target.value)} className="input-modern py-1.5 text-sm">
                  {COMPETENCE_FILIERES.map((f) => <option key={f} value={f}>{COMPETENCE_FILIERE_LABELS[f]}</option>)}
                </select>
                <button type="button" onClick={() => openRef()}
                  className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 whitespace-nowrap">
                  + Item
                </button>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              Items évalués par l'encadrant technique (notes /10). La désactivation retire l'item des nouvelles grilles sans toucher aux évaluations passées.
            </p>
            {refError && <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{refError}</div>}
            {refLoading ? <LoadingSpinner size="md" message="Chargement du référentiel…" /> : referentiels.length === 0 ? (
              <p className="text-sm text-gray-400 border border-dashed rounded-lg p-3 text-center">
                Aucun item pour la filière « {COMPETENCE_FILIERE_LABELS[refFiliere]} » — ajoutez les compétences métier avec « + Item ».
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="py-1.5 pr-2">Rubrique</th>
                      <th className="py-1.5 pr-2">Item</th>
                      <th className="py-1.5 pr-2">Ordre</th>
                      <th className="py-1.5 pr-2">Statut</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {referentiels.map((it) => (
                      <tr key={it.id} className={`border-b border-gray-50 ${it.actif === false ? 'opacity-50' : ''}`}>
                        <td className="py-1.5 pr-2 text-gray-600">{it.rubrique}</td>
                        <td className="py-1.5 pr-2 font-medium text-gray-700">{it.item}</td>
                        <td className="py-1.5 pr-2 text-gray-400">{it.ordre ?? 0}</td>
                        <td className="py-1.5 pr-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${it.actif === false ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>
                            {it.actif === false ? 'Désactivé' : 'Actif'}
                          </span>
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openRef(it)} className="text-xs text-teal-700 hover:underline mr-2">Modifier</button>
                          <button type="button" onClick={() => toggleRefActif(it)} className="text-xs text-gray-500 hover:underline mr-2">
                            {it.actif === false ? 'Réactiver' : 'Désactiver'}
                          </button>
                          <button type="button" onClick={() => deleteRef(it)} className="text-xs text-red-500 hover:underline">Supprimer</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Modale partenaire */}
        {editPart && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4" onClick={() => setEditPart(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold text-gray-800">{editPart.id ? 'Modifier le partenaire' : 'Nouveau partenaire'}</h3>
              {editPart.error && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{editPart.error}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Nom <span className="text-red-500">*</span></label>
                  <input value={editPart.form.nom} onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, nom: e.target.value } })} className="input-modern py-1.5 w-full" autoFocus />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Catégorie</label>
                  <select value={editPart.form.categorie} onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, categorie: e.target.value } })} className="input-modern py-1.5 w-full">
                    <option value="">— aucune —</option>
                    {PARTENAIRE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORIE_LABELS[c]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Contact (nom)</label>
                  <input value={editPart.form.contact_nom} onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, contact_nom: e.target.value } })} className="input-modern py-1.5 w-full" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Téléphone</label>
                  <input value={editPart.form.contact_tel} onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, contact_tel: e.target.value } })} className="input-modern py-1.5 w-full" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Email</label>
                  <input type="email" value={editPart.form.contact_email} onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, contact_email: e.target.value } })} className="input-modern py-1.5 w-full" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Notes</label>
                  <textarea value={editPart.form.notes} onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, notes: e.target.value } })} rows={2} className="input-modern py-1 w-full" />
                </div>
                <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={editPart.form.actif} onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, actif: e.target.checked } })} className="rounded border-gray-300" />
                  Partenaire actif (proposé à la saisie des actions)
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditPart(null)} className="px-3 py-1.5 text-sm text-gray-500">Annuler</button>
                <button type="button" onClick={savePartenaire} className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700">Enregistrer</button>
              </div>
            </div>
          </div>
        )}

        {/* Modale item de référentiel de compétences */}
        {editRef && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4" onClick={() => setEditRef(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold text-gray-800">{editRef.id ? 'Modifier l\'item' : 'Nouvel item de compétence'}</h3>
              {editRef.error && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{editRef.error}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Filière</label>
                  <select value={editRef.form.filiere} onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, filiere: e.target.value } })} className="input-modern py-1.5 w-full">
                    {COMPETENCE_FILIERES.map((f) => <option key={f} value={f}>{COMPETENCE_FILIERE_LABELS[f]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Ordre d'affichage</label>
                  <input type="number" value={editRef.form.ordre} onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, ordre: e.target.value } })} className="input-modern py-1.5 w-full" placeholder="0" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Rubrique <span className="text-red-500">*</span></label>
                  <input value={editRef.form.rubrique} maxLength={120} onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, rubrique: e.target.value } })} className="input-modern py-1.5 w-full" placeholder="ex. Savoir-faire techniques" autoFocus />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-0.5">Item évalué <span className="text-red-500">*</span></label>
                  <input value={editRef.form.item} maxLength={200} onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, item: e.target.value } })} className="input-modern py-1.5 w-full" placeholder="ex. Utiliser la presse à balles en sécurité" />
                </div>
                <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={editRef.form.actif} onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, actif: e.target.checked } })} className="rounded border-gray-300" />
                  Item actif (proposé dans les nouvelles grilles)
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditRef(null)} className="px-3 py-1.5 text-sm text-gray-500">Annuler</button>
                <button type="button" onClick={saveRef} className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700">Enregistrer</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
