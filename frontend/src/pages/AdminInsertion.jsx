import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import {
  LoadingSpinner, PageHeader, Section, Modal, ConfirmDialog, FormField, useToast,
} from '../components';
import {
  Settings, Handshake, Target, Award, ListChecks, FolderOpen, Sparkles, Plus, Users,
} from 'lucide-react';
import api from '../services/api';
import { resetInsertionParametresCache } from '../components/insertion/parametres';
import { COMPETENCE_FILIERES, COMPETENCE_FILIERE_LABELS } from '../components/insertion/freins';

/**
 * Réglages du module Insertion (/admin/insertion — ADMIN).
 *
 * Cinq sections :
 *  - Paramètres du module — **UN SEUL bouton « Enregistrer »** (il y en avait
 *    sept : un par ligne, ce qui obligeait à cliquer sept fois pour une revue
 *    de réglages, et laissait croire qu'un réglage modifié était enregistré
 *    parce que le voisin l'avait été — amendement CIP § 10) ;
 *  - Critères d'éligibilité IAE (référentiel administrable, PR A lot 1) ;
 *  - Projets cofinancés FSE+ et leurs postes/quotités (API du lot 2) ;
 *  - Partenaires mobilisables ;
 *  - Grilles de compétences par filière ;
 *  - Sonde de connexion IA — DÉPLACÉE depuis l'onglet « Assistant IA » de la
 *    fiche d'un salarié : c'est un contrôle d'exploitation (clé, modèle,
 *    réseau), il n'a rien à faire dans le dossier d'une personne, et il y
 *    exposait la longueur de la clé et le nom du modèle à toute CIP.
 *
 * Toutes les fenêtres passent par `Modal` / `ConfirmDialog` partagés et tous
 * les retours par `useToast` : plus aucun `alert()` ni `window.confirm`.
 */

// « social » ajouté (PR A lot 1) : le CMS du Département est seedé dans cette
// catégorie, sans elle il s'afficherait « aucune catégorie » à l'écran.
const PARTENAIRE_CATEGORIES = ['administratif', 'emploi', 'logement', 'sante', 'social', 'justice', 'formation', 'mobilite', 'autre'];
const CATEGORIE_LABELS = {
  administratif: 'Administratif', emploi: 'Emploi', logement: 'Logement', sante: 'Santé',
  social: 'Social', justice: 'Justice', formation: 'Formation', mobilite: 'Mobilité', autre: 'Autre',
};

const PROJET_TYPES = [
  { value: 'asi', label: 'ASI — Accompagnement Social Intensif' },
  { value: 'ocs', label: 'OCS — postes cofinancés' },
  { value: 'autre', label: 'Autre' },
];

// Paramètres éditables — clé settings complète, libellé, aide, type, défaut code.
const PARAMS = [
  { key: 'insertion.delai_diagnostic_jours', name: 'delai_diagnostic_jours', label: 'Délai cible du diagnostic d\'accueil (jours)', help: 'Après l\'entrée en parcours ; au-delà, une alerte « diagnostic absent » s\'affiche.', type: 'number', def: 30 },
  { key: 'insertion.alerte_pass_iae_mois', name: 'alerte_pass_iae_mois', label: 'Alerte Pass IAE (mois avant échéance)', help: 'Premier seuil d\'alerte avant la fin du Pass (le second est fixé à 2 mois).', type: 'number', def: 7 },
  { key: 'insertion.echeance_action_defaut_jours', name: 'echeance_action_defaut_jours', label: 'Échéance par défaut d\'une action CIP (jours)', help: 'Pré-remplie dans « + Action » (modifiable à la saisie).', type: 'number', def: 14 },
  { key: 'insertion.rythme_bilans_mois', name: 'rythme_bilans_mois', label: 'Rythme usuel des bilans (mois)', help: 'Sert à proposer la date du prochain entretien à la clôture d\'un bilan.', type: 'number', def: 2 },
  { key: 'insertion.renouvellement_anticipation_jours', name: 'renouvellement_anticipation_jours', label: 'Anticipation des renouvellements (jours)', help: 'Fenêtre de la liste « Renouvellements à préparer » (défaut 42 j = 6 semaines).', type: 'number', def: 42 },
  // PR A — le suivi de résultat se relève à +6 mois, pas à +3 : un jalon posé à
  // +3 ne documente rien de ce que l'autorité et le FSE+ demandent.
  { key: 'insertion.post_sortie_mois', name: 'post_sortie_mois', label: 'Suivi post-sortie (mois après la sortie)', help: 'Échéance du jalon « Suivi post-sortie » — l\'indicateur de résultat FSE+ se mesure à 6 mois.', type: 'number', def: 6 },
  { key: 'insertion.alerte_sortie_fse_j1', name: 'alerte_sortie_fse_j1', label: 'Alerte « sortie FSE+ non renseignée » — 1er seuil (jours)', help: 'Jours après la fin du contrat. Passé ce délai, la donnée de sortie ne se rattrape plus auprès de la personne.', type: 'number', def: 15 },
  { key: 'insertion.alerte_sortie_fse_j2', name: 'alerte_sortie_fse_j2', label: 'Alerte « sortie FSE+ non renseignée » — 2e seuil (jours)', help: 'Second rappel, plus pressant.', type: 'number', def: 25 },
  { key: 'insertion.retention_months', name: 'retention_months', label: 'Rétention RGPD des dossiers sortis (mois)', help: 'Délai avant anonymisation des dossiers d\'insertion après la fin du parcours (référentiel CNIL : 24 mois).', type: 'number', def: 24 },
  { key: 'insertion.ia_preparation_auto', name: 'ia_preparation_auto', label: 'Préparation IA automatique à J-7', help: 'Génère la note de préparation IA 7 jours avant chaque entretien planifié.', type: 'boolean', def: false },
];

const msgErreur = (err, repli) => err?.response?.data?.error || err?.message || repli;

export default function AdminInsertion() {
  const toast = useToast();

  // ── Paramètres ──
  const [values, setValues] = useState(null);
  const [paramError, setParamError] = useState(null);
  const [savingParams, setSavingParams] = useState(false);

  // ── Critères d'éligibilité (PR A lot 1) ──
  const [criteres, setCriteres] = useState([]);
  const [critLoading, setCritLoading] = useState(true);
  const [critError, setCritError] = useState(null);
  const [editCrit, setEditCrit] = useState(null); // { code?, error, form }

  // ── Projets cofinancés (API du lot 2) ──
  const [projets, setProjets] = useState([]);
  const [projLoading, setProjLoading] = useState(true);
  const [projIndispo, setProjIndispo] = useState(false);
  const [projError, setProjError] = useState(null);
  const [editProj, setEditProj] = useState(null);
  const [postesDe, setPostesDe] = useState(null); // { projet, lignes, error }

  // ── Partenaires ──
  const [partenaires, setPartenaires] = useState([]);
  const [partError, setPartError] = useState(null);
  const [partLoading, setPartLoading] = useState(true);
  const [editPart, setEditPart] = useState(null);

  // ── Grilles de compétences ──
  const [refFiliere, setRefFiliere] = useState('tri');
  const [referentiels, setReferentiels] = useState([]);
  const [refLoading, setRefLoading] = useState(true);
  const [refError, setRefError] = useState(null);
  const [editRef, setEditRef] = useState(null);
  const [refASupprimer, setRefASupprimer] = useState(null);

  // ── Sonde IA (déplacée depuis la fiche salarié) ──
  const [iaDiag, setIaDiag] = useState(null);
  const [iaDiagLoading, setIaDiagLoading] = useState(false);

  const loadParams = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        api.get('/insertion/parametres'),
        api.get('/settings').catch(() => ({ data: [] })),
      ]);
      const settingsByKey = new Map((Array.isArray(sRes.data) ? sRes.data : []).map((r) => [r.key, r.value]));
      const out = {};
      for (const p of PARAMS) {
        let v = pRes.data?.[p.name];
        if (v === undefined) v = settingsByKey.get(p.key); // clés servies par /settings seulement
        if (v === undefined || v === null || v === '') v = p.def;
        out[p.name] = p.type === 'boolean'
          ? ['true', '1', 'oui', 'yes'].includes(String(v).trim().toLowerCase()) || v === true
          : String(v);
      }
      setValues(out);
      setParamError(null);
    } catch (err) {
      setParamError(msgErreur(err, 'Paramètres indisponibles'));
      setValues(Object.fromEntries(PARAMS.map((p) => [p.name, p.type === 'boolean' ? p.def : String(p.def)])));
    }
  }, []);

  const loadCriteres = useCallback(() => {
    setCritLoading(true);
    api.get('/insertion/eligibilite-criteres')
      .then((r) => { setCriteres(Array.isArray(r.data) ? r.data : []); setCritError(null); })
      .catch((err) => setCritError(msgErreur(err, 'Référentiel indisponible')))
      .finally(() => setCritLoading(false));
  }, []);

  const loadProjets = useCallback(() => {
    setProjLoading(true);
    api.get('/insertion/projets')
      .then((r) => { setProjets(Array.isArray(r.data) ? r.data : []); setProjIndispo(false); setProjError(null); })
      .catch((err) => {
        // L'API des projets appartient au lot 2 : tant qu'elle n'est pas
        // déployée, on affiche un état honnête plutôt qu'une erreur rouge.
        if (err?.response?.status === 404) setProjIndispo(true);
        else setProjError(msgErreur(err, 'Projets indisponibles'));
      })
      .finally(() => setProjLoading(false));
  }, []);

  const loadPartenaires = useCallback(() => {
    setPartLoading(true);
    api.get('/insertion/partenaires')
      .then((r) => { setPartenaires(Array.isArray(r.data) ? r.data : []); setPartError(null); })
      .catch((err) => setPartError(msgErreur(err, 'Partenaires indisponibles')))
      .finally(() => setPartLoading(false));
  }, []);

  const loadReferentiels = useCallback((filiere) => {
    setRefLoading(true);
    api.get(`/insertion/competence-referentiels?filiere=${filiere}`)
      .then((r) => { setReferentiels(Array.isArray(r.data) ? r.data : []); setRefError(null); })
      .catch((err) => setRefError(msgErreur(err, 'Référentiel indisponible')))
      .finally(() => setRefLoading(false));
  }, []);

  useEffect(() => { loadParams(); loadPartenaires(); loadCriteres(); loadProjets(); },
    [loadParams, loadPartenaires, loadCriteres, loadProjets]);
  useEffect(() => { loadReferentiels(refFiliere); }, [loadReferentiels, refFiliere]);

  // ── Un SEUL enregistrement pour tous les paramètres ─────────────────────
  // Les valeurs sont d'abord toutes VALIDÉES, puis toutes écrites : un lot à
  // moitié enregistré serait pire qu'un refus (l'écran dirait « enregistré »
  // alors que la moitié des réglages seraient restés en place).
  const saveParams = async () => {
    setParamError(null);
    const aEcrire = [];
    for (const p of PARAMS) {
      const raw = values[p.name];
      if (p.type === 'boolean') { aEcrire.push([p.key, raw ? 'true' : 'false']); continue; }
      const n = parseFloat(raw);
      if (raw === '' || Number.isNaN(n) || n < 0) {
        setParamError(`${p.label} : nombre positif attendu.`);
        return;
      }
      aEcrire.push([p.key, String(n)]);
    }
    setSavingParams(true);
    try {
      for (const [key, value] of aEcrire) {
        await api.put(`/settings/${encodeURIComponent(key)}`, { value });
      }
      resetInsertionParametresCache();
      toast.success('Paramètres enregistrés.');
    } catch (err) {
      const m = msgErreur(err, 'Enregistrement impossible');
      setParamError(m); toast.error(m);
    }
    setSavingParams(false);
  };

  // ── Critères d'éligibilité ──
  const openCrit = (c = null) => setEditCrit({
    code: c?.code || null, error: null,
    form: { code: c?.code || '', libelle: c?.libelle || '', ordre: c?.ordre ?? '', actif: c ? c.actif !== false : true },
  });

  const saveCrit = async () => {
    const { code, form } = editCrit;
    if (!form.libelle.trim()) { setEditCrit({ ...editCrit, error: 'Le libellé est obligatoire.' }); return; }
    const body = {
      libelle: form.libelle.trim(),
      ordre: form.ordre === '' ? 0 : (parseInt(form.ordre, 10) || 0),
      actif: form.actif,
    };
    try {
      if (code) await api.put(`/insertion/eligibilite-criteres/${encodeURIComponent(code)}`, body);
      else {
        const nouveau = form.code.trim().toLowerCase();
        if (!/^[a-z0-9_]{2,30}$/.test(nouveau)) {
          setEditCrit({ ...editCrit, error: 'Code invalide : 2 à 30 caractères, minuscules, chiffres ou tiret bas.' });
          return;
        }
        await api.post('/insertion/eligibilite-criteres', { ...body, code: nouveau });
      }
      setEditCrit(null); loadCriteres();
      toast.success('Référentiel mis à jour.');
    } catch (err) {
      setEditCrit({ ...editCrit, error: msgErreur(err, 'Enregistrement impossible') });
    }
  };

  const toggleCrit = async (c) => {
    try {
      await api.put(`/insertion/eligibilite-criteres/${encodeURIComponent(c.code)}`, { actif: c.actif === false });
      loadCriteres();
    } catch (err) { toast.error(msgErreur(err, 'Modification impossible')); }
  };

  // ── Projets cofinancés ──
  const openProj = (p = null) => setEditProj({
    id: p?.id || null, error: null,
    form: {
      code: p?.code || '', nom: p?.nom || '', type: p?.type || 'asi', financeur: p?.financeur || '',
      date_debut: (p?.date_debut || '').slice(0, 10), date_fin: (p?.date_fin || '').slice(0, 10),
      convention_ref: p?.convention_ref || '',
      taux_forfaitaire_pct: p?.taux_forfaitaire_pct ?? '', cofinancement_ue_pct: p?.cofinancement_ue_pct ?? '',
      actif: p ? p.actif !== false : true,
    },
  });

  const saveProj = async () => {
    const { id, form } = editProj;
    if (!form.code.trim() || !form.nom.trim()) {
      setEditProj({ ...editProj, error: 'Le code et le nom sont obligatoires.' }); return;
    }
    const body = {
      code: form.code.trim(), nom: form.nom.trim(), type: form.type,
      financeur: form.financeur.trim() || null,
      date_debut: form.date_debut || null, date_fin: form.date_fin || null,
      convention_ref: form.convention_ref.trim() || null,
      // « non renseigné » reste NULL : un taux à 0 dirait « aucun cofinancement ».
      taux_forfaitaire_pct: form.taux_forfaitaire_pct === '' ? null : parseFloat(form.taux_forfaitaire_pct),
      cofinancement_ue_pct: form.cofinancement_ue_pct === '' ? null : parseFloat(form.cofinancement_ue_pct),
      actif: form.actif,
    };
    try {
      if (id) await api.put(`/insertion/projets/${id}`, body);
      else await api.post('/insertion/projets', body);
      setEditProj(null); loadProjets();
      toast.success('Projet enregistré.');
    } catch (err) {
      setEditProj({ ...editProj, error: msgErreur(err, 'Enregistrement impossible') });
    }
  };

  const ouvrirPostes = async (projet) => {
    setPostesDe({ projet, lignes: null, error: null });
    try {
      const [p, u] = await Promise.all([
        api.get(`/insertion/projets/${projet.id}/postes`),
        api.get('/insertion/cip-referents').catch(() => ({ data: [] })),
      ]);
      setPostesDe({
        projet,
        utilisateurs: Array.isArray(u.data) ? u.data : [],
        lignes: (Array.isArray(p.data) ? p.data : []).map((l) => ({
          user_id: String(l.user_id), quotite_pct: String(l.quotite_pct ?? ''),
          date_debut: (l.date_debut || '').slice(0, 10), date_fin: (l.date_fin || '').slice(0, 10),
        })),
        error: null,
      });
    } catch (err) {
      setPostesDe({ projet, lignes: [], utilisateurs: [], error: msgErreur(err, 'Postes indisponibles (API du lot FSE+)') });
    }
  };

  const savePostes = async () => {
    try {
      await api.put(`/insertion/projets/${postesDe.projet.id}/postes`, postesDe.lignes
        .filter((l) => l.user_id && l.quotite_pct !== '')
        .map((l) => ({
          user_id: parseInt(l.user_id, 10), quotite_pct: parseFloat(l.quotite_pct),
          date_debut: l.date_debut || null, date_fin: l.date_fin || null,
        })));
      setPostesDe(null);
      toast.success('Postes et quotités enregistrés.');
    } catch (err) {
      setPostesDe({ ...postesDe, error: msgErreur(err, 'Enregistrement impossible') });
    }
  };

  // ── Partenaires ──
  const openPartenaire = (p = null) => setEditPart({
    id: p?.id || null, error: null,
    form: {
      nom: p?.nom || '', categorie: p?.categorie || '', contact_nom: p?.contact_nom || '',
      contact_tel: p?.contact_tel || '', contact_email: p?.contact_email || '',
      notes: p?.notes || '', actif: p ? p.actif !== false : true,
    },
  });

  const savePartenaire = async () => {
    const { id, form } = editPart;
    if (!form.nom.trim()) { setEditPart({ ...editPart, error: 'Le nom est obligatoire.' }); return; }
    const body = {
      nom: form.nom.trim(), categorie: form.categorie || null,
      contact_nom: form.contact_nom.trim() || null, contact_tel: form.contact_tel.trim() || null,
      contact_email: form.contact_email.trim() || null, notes: form.notes.trim() || null, actif: form.actif,
    };
    try {
      if (id) await api.put(`/insertion/partenaires/${id}`, body);
      else await api.post('/insertion/partenaires', body);
      setEditPart(null); loadPartenaires();
      toast.success('Partenaire enregistré.');
    } catch (err) {
      setEditPart({ ...editPart, error: msgErreur(err, 'Enregistrement impossible') });
    }
  };

  const toggleActif = async (p) => {
    try { await api.put(`/insertion/partenaires/${p.id}`, { actif: !p.actif }); loadPartenaires(); }
    catch (err) { setPartError(msgErreur(err, 'Modification impossible')); }
  };

  // ── Grilles de compétences ──
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
      setEditRef(null); loadReferentiels(refFiliere);
      toast.success('Référentiel mis à jour.');
    } catch (err) {
      setEditRef({ ...editRef, error: msgErreur(err, 'Enregistrement impossible') });
    }
  };

  const toggleRefActif = async (it) => {
    setRefError(null);
    try { await api.put(`/insertion/competence-referentiels/${it.id}`, { actif: it.actif === false }); loadReferentiels(refFiliere); }
    catch (err) { setRefError(msgErreur(err, 'Modification impossible')); }
  };

  const deleteRef = async (it) => {
    setRefError(null);
    try { await api.delete(`/insertion/competence-referentiels/${it.id}`); loadReferentiels(refFiliere); toast.success('Item supprimé.'); }
    catch (err) { setRefError(msgErreur(err, 'Suppression impossible')); }
  };

  const testerIa = async () => {
    setIaDiagLoading(true); setIaDiag(null);
    try {
      const res = await api.get('/insertion/ia/diagnostic');
      setIaDiag(res.data);
    } catch (err) {
      setIaDiag(err.response?.data || { ok: false, message: err.message });
    }
    setIaDiagLoading(false);
  };

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <PageHeader
          title="Réglages insertion"
          subtitle="Paramètres du module, critères d'éligibilité, projets cofinancés, partenaires, compétences"
          icon={Settings}
        />

        <div className="space-y-5">
          {/* ══ Paramètres — UN SEUL Enregistrer ══ */}
          <Section title="Paramètres du module" icon={Settings}
            subtitle="Chaque paramètre a un défaut en code : effacer une valeur ne casse rien."
            actions={(
              <button type="button" onClick={saveParams} disabled={savingParams || !values}
                className="btn-primary text-sm disabled:opacity-50">
                {savingParams ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            )}
          >
            {paramError && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{paramError}</div>}
            {!values ? <LoadingSpinner size="md" message="Chargement des paramètres…" /> : (
              <div className="space-y-3">
                {PARAMS.map((p) => (
                  <div key={p.key} className="flex items-center gap-3 flex-wrap border-b border-slate-50 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex-1 min-w-[240px]">
                      <p className="text-sm font-medium text-slate-700">{p.label}</p>
                      <p className="text-xs text-slate-500">{p.help} <span className="text-slate-400">— défaut : {String(p.def)}</span></p>
                    </div>
                    {p.type === 'boolean' ? (
                      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                        <input type="checkbox" checked={values[p.name] === true}
                          onChange={(e) => setValues({ ...values, [p.name]: e.target.checked })} className="rounded border-slate-300 w-4 h-4" />
                        {values[p.name] ? 'Activée' : 'Désactivée'}
                      </label>
                    ) : (
                      <input type="number" min="0" value={values[p.name]} aria-label={p.label}
                        onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                        className="input-modern py-1.5 w-24 text-sm" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ══ Cibles conventionnelles : lien unique ══ */}
          <div className="bg-teal-50 border border-teal-200 rounded-[14px] p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2">
              <Target className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-teal-800">Cibles conventionnelles (taux de sorties, ETP)</p>
                <p className="text-xs text-teal-700">Elles se saisissent dans « Pilotage &amp; indicateurs », au regard des taux réalisés — à reporter depuis l&apos;annexe financière confirmée par la direction.</p>
              </div>
            </div>
            <Link to="/insertion/audit" className="btn-primary text-xs whitespace-nowrap">Ouvrir Pilotage &amp; indicateurs</Link>
          </div>

          {/* ══ Critères d'éligibilité IAE ══ */}
          <Section title={`Critères d'éligibilité IAE (${criteres.length})`} icon={ListChecks}
            subtitle="Cochés dans le dossier administratif de chaque salarié. Un critère se désactive, il ne se supprime pas : l'historique des constats doit rester lisible."
            actions={(
              <button type="button" onClick={() => openCrit()} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Critère
              </button>
            )}
          >
            {critError && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{critError}</div>}
            {critLoading ? <LoadingSpinner size="md" message="Chargement du référentiel…" /> : criteres.length === 0 ? (
              <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-[10px] p-3 text-center">
                Aucun critère. Les 14 critères IAE sont normalement seedés au démarrage du serveur.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3">Ordre</th>
                      <th className="py-2 pr-3">Libellé</th>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Statut</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {criteres.map((c) => (
                      <tr key={c.code} className={`border-b border-slate-50 ${c.actif === false ? 'opacity-50' : ''}`}>
                        <td className="py-2 pr-3 text-slate-400">{c.ordre ?? 0}</td>
                        <td className="py-2 pr-3 font-medium text-slate-700">{c.libelle}</td>
                        <td className="py-2 pr-3 text-xs font-mono text-slate-500">{c.code}</td>
                        <td className="py-2 pr-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${c.actif === false ? 'bg-slate-100 text-slate-500' : 'bg-green-50 text-green-700'}`}>
                            {c.actif === false ? 'Désactivé' : 'Actif'}
                          </span>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openCrit(c)} className="text-xs text-teal-700 hover:underline mr-2">Modifier</button>
                          <button type="button" onClick={() => toggleCrit(c)} className="text-xs text-slate-500 hover:underline">
                            {c.actif === false ? 'Réactiver' : 'Désactiver'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ══ Projets cofinancés (API du lot FSE+) ══ */}
          <Section title="Projets cofinancés" icon={FolderOpen}
            subtitle="ASI, postes en OCS — le rattachement d'un salarié se saisit toujours à la main, jamais déduit d'un statut social."
            actions={!projIndispo ? (
              <button type="button" onClick={() => openProj()} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Projet
              </button>
            ) : null}
          >
            {projError && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{projError}</div>}
            {projIndispo ? (
              <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-[10px] p-3">
                Gestion des projets cofinancés indisponible sur ce serveur : le module FSE+ n&apos;est pas encore déployé.
                Les dossiers administratifs continuent de fonctionner sans lui.
              </p>
            ) : projLoading ? <LoadingSpinner size="md" message="Chargement des projets…" /> : projets.length === 0 ? (
              <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-[10px] p-3 text-center">
                Aucun projet cofinancé enregistré.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3">Projet</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Financeur</th>
                      <th className="py-2 pr-3">Participants</th>
                      <th className="py-2 pr-3">Statut</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {projets.map((p) => (
                      <tr key={p.id} className={`border-b border-slate-50 ${p.actif === false ? 'opacity-50' : ''}`}>
                        <td className="py-2 pr-3">
                          <span className="font-medium text-slate-700">{p.nom}</span>
                          <span className="block text-xs font-mono text-slate-400">{p.code}</span>
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{(PROJET_TYPES.find((t) => t.value === p.type) || {}).label || p.type}</td>
                        <td className="py-2 pr-3 text-slate-600">{p.financeur || <span className="text-slate-300">—</span>}</td>
                        <td className="py-2 pr-3 text-slate-600">{p.nb_participants ?? <span className="text-slate-300">—</span>}</td>
                        <td className="py-2 pr-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${p.actif === false ? 'bg-slate-100 text-slate-500' : 'bg-green-50 text-green-700'}`}>
                            {p.actif === false ? 'Clos' : 'Actif'}
                          </span>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openProj(p)} className="text-xs text-teal-700 hover:underline mr-2">Modifier</button>
                          <button type="button" onClick={() => ouvrirPostes(p)} className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" /> Postes
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ══ Partenaires ══ */}
          <Section title={`Partenaires mobilisables (${partenaires.length})`} icon={Handshake}
            subtitle="Rattachables aux actions CIP. La désactivation les retire des listes de saisie sans toucher à l'historique."
            actions={(
              <button type="button" onClick={() => openPartenaire()} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Partenaire
              </button>
            )}
          >
            {partError && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{partError}</div>}
            {partLoading ? <LoadingSpinner size="md" message="Chargement des partenaires…" /> : partenaires.length === 0 ? (
              <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-[10px] p-3 text-center">
                Aucun partenaire — ajoutez les organismes que vous mobilisez (France Travail, CCAS, CMS, missions locales…).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3">Nom</th>
                      <th className="py-2 pr-3">Catégorie</th>
                      <th className="py-2 pr-3">Contact</th>
                      <th className="py-2 pr-3">Statut</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {partenaires.map((p) => (
                      <tr key={p.id} className={`border-b border-slate-50 ${p.actif === false ? 'opacity-50' : ''}`}>
                        <td className="py-2 pr-3 font-medium text-slate-700">{p.nom}</td>
                        <td className="py-2 pr-3">
                          {p.categorie ? <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{CATEGORIE_LABELS[p.categorie] || p.categorie}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-500">
                          {[p.contact_nom, p.contact_tel, p.contact_email].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${p.actif === false ? 'bg-slate-100 text-slate-500' : 'bg-green-50 text-green-700'}`}>
                            {p.actif === false ? 'Désactivé' : 'Actif'}
                          </span>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openPartenaire(p)} className="text-xs text-teal-700 hover:underline mr-2">Modifier</button>
                          <button type="button" onClick={() => toggleActif(p)} className="text-xs text-slate-500 hover:underline">
                            {p.actif === false ? 'Réactiver' : 'Désactiver'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ══ Grilles de compétences ══ */}
          <Section title="Grilles de compétences" icon={Award}
            subtitle="Items évalués par l'encadrant technique (notes /10). La désactivation retire l'item des nouvelles grilles sans toucher aux évaluations passées."
            actions={(
              <div className="flex items-center gap-2">
                <select value={refFiliere} onChange={(e) => setRefFiliere(e.target.value)} aria-label="Filière"
                  className="input-modern py-1.5 text-sm">
                  {COMPETENCE_FILIERES.map((f) => <option key={f} value={f}>{COMPETENCE_FILIERE_LABELS[f]}</option>)}
                </select>
                <button type="button" onClick={() => openRef()} className="btn-secondary text-sm inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Plus className="w-4 h-4" /> Item
                </button>
              </div>
            )}
          >
            {refError && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{refError}</div>}
            {refLoading ? <LoadingSpinner size="md" message="Chargement du référentiel…" /> : referentiels.length === 0 ? (
              <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-[10px] p-3 text-center">
                Aucun item pour la filière « {COMPETENCE_FILIERE_LABELS[refFiliere]} » — ajoutez les compétences métier avec « + Item ».
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                      <th className="py-2 pr-3">Rubrique</th>
                      <th className="py-2 pr-3">Item</th>
                      <th className="py-2 pr-3">Ordre</th>
                      <th className="py-2 pr-3">Statut</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {referentiels.map((it) => (
                      <tr key={it.id} className={`border-b border-slate-50 ${it.actif === false ? 'opacity-50' : ''}`}>
                        <td className="py-2 pr-3 text-slate-600">{it.rubrique}</td>
                        <td className="py-2 pr-3 font-medium text-slate-700">{it.item}</td>
                        <td className="py-2 pr-3 text-slate-400">{it.ordre ?? 0}</td>
                        <td className="py-2 pr-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${it.actif === false ? 'bg-slate-100 text-slate-500' : 'bg-green-50 text-green-700'}`}>
                            {it.actif === false ? 'Désactivé' : 'Actif'}
                          </span>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openRef(it)} className="text-xs text-teal-700 hover:underline mr-2">Modifier</button>
                          <button type="button" onClick={() => toggleRefActif(it)} className="text-xs text-slate-500 hover:underline mr-2">
                            {it.actif === false ? 'Réactiver' : 'Désactiver'}
                          </button>
                          <button type="button" onClick={() => setRefASupprimer(it)} className="text-xs text-red-500 hover:underline">Supprimer</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ══ Sonde IA — déplacée depuis la fiche d'un salarié ══ */}
          <Section title="Connexion à l'assistant IA" icon={Sparkles}
            subtitle="Contrôle d'exploitation : clé, modèle et réseau. Aucun dossier de salarié n'est lu."
            actions={(
              <button type="button" onClick={testerIa} disabled={iaDiagLoading} className="btn-secondary text-sm disabled:opacity-50">
                {iaDiagLoading ? 'Test…' : 'Tester la connexion'}
              </button>
            )}
          >
            {!iaDiag ? (
              <p className="text-sm text-slate-500">
                La sonde envoie une requête minimale au modèle. Elle distingue un problème de réseau
                (aucun code HTTP) d&apos;un problème de clé ou de modèle (401 / 404).
              </p>
            ) : (
              <div className={`text-sm rounded-[10px] p-3 border ${iaDiag.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                <p className="font-semibold mb-1">{iaDiag.ok ? 'Connexion IA opérationnelle' : 'Échec de la connexion IA'}</p>
                <ul className="space-y-0.5 font-mono text-xs">
                  <li>configured : {String(iaDiag.configured)}{iaDiag.key_length ? ` (clé longueur ${iaDiag.key_length})` : ''}</li>
                  <li>model : {iaDiag.model || '—'}</li>
                  {iaDiag.status != null && <li>status HTTP : {iaDiag.status}</li>}
                  {iaDiag.type && <li>type : {iaDiag.type}</li>}
                  {iaDiag.latency_ms != null && <li>latence : {iaDiag.latency_ms} ms</li>}
                  {iaDiag.message && <li className="whitespace-pre-wrap break-words">message : {iaDiag.message}</li>}
                  {iaDiag.reply && <li>réponse : « {iaDiag.reply} »</li>}
                </ul>
                {!iaDiag.ok && iaDiag.configured === false && (
                  <p className="mt-2">La variable <code>ANTHROPIC_API_KEY</code> n&apos;est pas transmise au conteneur backend. Vérifiez le <code>.env</code> serveur puis redémarrez le backend.</p>
                )}
                {!iaDiag.ok && iaDiag.status === 404 && (
                  <p className="mt-2">Le modèle <code>{iaDiag.model}</code> n&apos;est pas disponible pour cette clé. Définissez <code>CLAUDE_MODEL</code> sur un modèle autorisé puis redémarrez le backend.</p>
                )}
                {!iaDiag.ok && iaDiag.status === 401 && (
                  <p className="mt-2">Clé <code>ANTHROPIC_API_KEY</code> invalide ou révoquée.</p>
                )}
              </div>
            )}
          </Section>
        </div>

        {/* ══ Modale : critère d'éligibilité ══ */}
        <Modal isOpen={!!editCrit} onClose={() => setEditCrit(null)} size="md"
          title={editCrit?.code ? 'Modifier le critère' : 'Nouveau critère d\'éligibilité'}
          footer={(
            <>
              <button type="button" onClick={() => setEditCrit(null)} className="btn-ghost text-sm">Annuler</button>
              <button type="button" onClick={saveCrit} className="btn-primary text-sm">Enregistrer</button>
            </>
          )}
        >
          {editCrit && (
            <>
              {editCrit.error && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{editCrit.error}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!editCrit.code && (
                  <FormField label="Code" name="crit_code" required value={editCrit.form.code}
                    hint="Minuscules, chiffres, tiret bas. Non modifiable ensuite : c'est la clé des constats déjà enregistrés."
                    onChange={(e) => setEditCrit({ ...editCrit, form: { ...editCrit.form, code: e.target.value } })} />
                )}
                <FormField label="Ordre d'affichage" name="crit_ordre" type="number" value={editCrit.form.ordre}
                  onChange={(e) => setEditCrit({ ...editCrit, form: { ...editCrit.form, ordre: e.target.value } })} />
                <div className="sm:col-span-2">
                  <FormField label="Libellé" name="crit_libelle" required value={editCrit.form.libelle}
                    placeholder="ex. Demandeur d'emploi de longue durée (12-24 mois)"
                    onChange={(e) => setEditCrit({ ...editCrit, form: { ...editCrit.form, libelle: e.target.value } })} />
                </div>
                <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={editCrit.form.actif} className="rounded border-slate-300"
                    onChange={(e) => setEditCrit({ ...editCrit, form: { ...editCrit.form, actif: e.target.checked } })} />
                  Critère actif (proposé dans les dossiers administratifs)
                </label>
              </div>
            </>
          )}
        </Modal>

        {/* ══ Modale : projet cofinancé ══ */}
        <Modal isOpen={!!editProj} onClose={() => setEditProj(null)} size="lg"
          title={editProj?.id ? 'Modifier le projet cofinancé' : 'Nouveau projet cofinancé'}
          footer={(
            <>
              <button type="button" onClick={() => setEditProj(null)} className="btn-ghost text-sm">Annuler</button>
              <button type="button" onClick={saveProj} className="btn-primary text-sm">Enregistrer</button>
            </>
          )}
        >
          {editProj && (
            <>
              {editProj.error && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{editProj.error}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Code" name="proj_code" required value={editProj.form.code}
                  placeholder="ex. ASI-2026-2027"
                  onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, code: e.target.value } })} />
                <FormField label="Type" name="proj_type" type="select" value={editProj.form.type} options={PROJET_TYPES}
                  onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, type: e.target.value } })} />
                <div className="sm:col-span-2">
                  <FormField label="Nom" name="proj_nom" required value={editProj.form.nom}
                    onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, nom: e.target.value } })} />
                </div>
                <FormField label="Financeur" name="proj_financeur" value={editProj.form.financeur}
                  placeholder="ex. FSE+ / Département 76"
                  onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, financeur: e.target.value } })} />
                <FormField label="Référence de convention" name="proj_conv" value={editProj.form.convention_ref}
                  onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, convention_ref: e.target.value } })} />
                <FormField label="Début" name="proj_debut" type="date" value={editProj.form.date_debut}
                  onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, date_debut: e.target.value } })} />
                <FormField label="Fin" name="proj_fin" type="date" value={editProj.form.date_fin}
                  onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, date_fin: e.target.value } })} />
                <FormField label="Taux forfaitaire (%)" name="proj_taux" type="number" step="0.01"
                  value={editProj.form.taux_forfaitaire_pct} hint="Laisser vide si non applicable — jamais 0 par défaut."
                  onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, taux_forfaitaire_pct: e.target.value } })} />
                <FormField label="Cofinancement UE (%)" name="proj_ue" type="number" step="0.01"
                  value={editProj.form.cofinancement_ue_pct}
                  onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, cofinancement_ue_pct: e.target.value } })} />
                <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={editProj.form.actif} className="rounded border-slate-300"
                    onChange={(e) => setEditProj({ ...editProj, form: { ...editProj.form, actif: e.target.checked } })} />
                  Projet actif (proposé au rattachement des participants)
                </label>
              </div>
            </>
          )}
        </Modal>

        {/* ══ Modale : postes et quotités d'un projet (OCS) ══ */}
        <Modal isOpen={!!postesDe} onClose={() => setPostesDe(null)} size="lg"
          title={postesDe ? `Postes et quotités — ${postesDe.projet.nom}` : ''}
          footer={(
            <>
              <button type="button" onClick={() => setPostesDe(null)} className="btn-ghost text-sm">Fermer</button>
              <button type="button" onClick={savePostes} className="btn-primary text-sm">Enregistrer</button>
            </>
          )}
        >
          {postesDe && (
            <>
              {postesDe.error && <div className="mb-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-[10px] p-2">{postesDe.error}</div>}
              {postesDe.lignes === null ? <LoadingSpinner size="md" message="Chargement…" /> : (
                <>
                  <p className="text-xs text-slate-500 mb-3">
                    Part du temps de chaque intervenant imputée à ce projet. L&apos;enregistrement REMPLACE
                    la liste complète.
                  </p>
                  <div className="space-y-2">
                    {postesDe.lignes.map((l, i) => (
                      <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                        <FormField label="Intervenant" name={`poste_user_${i}`} type="select" value={l.user_id}
                          placeholder="— choisir"
                          options={(postesDe.utilisateurs || []).map((u) => ({ value: String(u.id), label: `${(u.last_name || '').toUpperCase()} ${u.first_name || ''}`.trim() }))}
                          onChange={(e) => {
                            const lignes = [...postesDe.lignes]; lignes[i] = { ...l, user_id: e.target.value };
                            setPostesDe({ ...postesDe, lignes });
                          }} />
                        <FormField label="Quotité (%)" name={`poste_q_${i}`} type="number" min="0" max="100" step="1" value={l.quotite_pct}
                          onChange={(e) => {
                            const lignes = [...postesDe.lignes]; lignes[i] = { ...l, quotite_pct: e.target.value };
                            setPostesDe({ ...postesDe, lignes });
                          }} />
                        <FormField label="Début" name={`poste_d_${i}`} type="date" value={l.date_debut}
                          onChange={(e) => {
                            const lignes = [...postesDe.lignes]; lignes[i] = { ...l, date_debut: e.target.value };
                            setPostesDe({ ...postesDe, lignes });
                          }} />
                        <div className="flex gap-2 items-end">
                          <FormField className="flex-1" label="Fin" name={`poste_f_${i}`} type="date" value={l.date_fin}
                            onChange={(e) => {
                              const lignes = [...postesDe.lignes]; lignes[i] = { ...l, date_fin: e.target.value };
                              setPostesDe({ ...postesDe, lignes });
                            }} />
                          <button type="button" className="btn-ghost text-xs mb-1"
                            onClick={() => setPostesDe({ ...postesDe, lignes: postesDe.lignes.filter((_, j) => j !== i) })}>
                            Retirer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn-secondary text-sm mt-3 inline-flex items-center gap-1.5"
                    onClick={() => setPostesDe({ ...postesDe, lignes: [...postesDe.lignes, { user_id: '', quotite_pct: '', date_debut: '', date_fin: '' }] })}>
                    <Plus className="w-4 h-4" /> Ajouter un poste
                  </button>
                </>
              )}
            </>
          )}
        </Modal>

        {/* ══ Modale : partenaire ══ */}
        <Modal isOpen={!!editPart} onClose={() => setEditPart(null)} size="md"
          title={editPart?.id ? 'Modifier le partenaire' : 'Nouveau partenaire'}
          footer={(
            <>
              <button type="button" onClick={() => setEditPart(null)} className="btn-ghost text-sm">Annuler</button>
              <button type="button" onClick={savePartenaire} className="btn-primary text-sm">Enregistrer</button>
            </>
          )}
        >
          {editPart && (
            <>
              {editPart.error && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{editPart.error}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <FormField label="Nom" name="part_nom" required value={editPart.form.nom}
                    onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, nom: e.target.value } })} />
                </div>
                <FormField label="Catégorie" name="part_cat" type="select" placeholder="— aucune"
                  value={editPart.form.categorie}
                  options={PARTENAIRE_CATEGORIES.map((c) => ({ value: c, label: CATEGORIE_LABELS[c] }))}
                  onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, categorie: e.target.value } })} />
                <FormField label="Contact (nom)" name="part_contact" value={editPart.form.contact_nom}
                  onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, contact_nom: e.target.value } })} />
                <FormField label="Téléphone" name="part_tel" value={editPart.form.contact_tel}
                  onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, contact_tel: e.target.value } })} />
                <FormField label="Courriel" name="part_email" type="email" value={editPart.form.contact_email}
                  onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, contact_email: e.target.value } })} />
                <div className="sm:col-span-2">
                  <FormField label="Notes" name="part_notes" type="textarea" rows={2} value={editPart.form.notes}
                    onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, notes: e.target.value } })} />
                </div>
                <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={editPart.form.actif} className="rounded border-slate-300"
                    onChange={(e) => setEditPart({ ...editPart, form: { ...editPart.form, actif: e.target.checked } })} />
                  Partenaire actif (proposé à la saisie des actions)
                </label>
              </div>
            </>
          )}
        </Modal>

        {/* ══ Modale : item de référentiel de compétences ══ */}
        <Modal isOpen={!!editRef} onClose={() => setEditRef(null)} size="md"
          title={editRef?.id ? 'Modifier l\'item' : 'Nouvel item de compétence'}
          footer={(
            <>
              <button type="button" onClick={() => setEditRef(null)} className="btn-ghost text-sm">Annuler</button>
              <button type="button" onClick={saveRef} className="btn-primary text-sm">Enregistrer</button>
            </>
          )}
        >
          {editRef && (
            <>
              {editRef.error && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2">{editRef.error}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Filière" name="ref_filiere" type="select" value={editRef.form.filiere}
                  options={COMPETENCE_FILIERES.map((f) => ({ value: f, label: COMPETENCE_FILIERE_LABELS[f] }))}
                  onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, filiere: e.target.value } })} />
                <FormField label="Ordre d'affichage" name="ref_ordre" type="number" value={editRef.form.ordre}
                  onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, ordre: e.target.value } })} />
                <div className="sm:col-span-2">
                  <FormField label="Rubrique" name="ref_rubrique" required value={editRef.form.rubrique}
                    placeholder="ex. Savoir-faire techniques"
                    onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, rubrique: e.target.value } })} />
                </div>
                <div className="sm:col-span-2">
                  <FormField label="Item évalué" name="ref_item" required value={editRef.form.item}
                    placeholder="ex. Utiliser la presse à balles en sécurité"
                    onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, item: e.target.value } })} />
                </div>
                <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={editRef.form.actif} className="rounded border-slate-300"
                    onChange={(e) => setEditRef({ ...editRef, form: { ...editRef.form, actif: e.target.checked } })} />
                  Item actif (proposé dans les nouvelles grilles)
                </label>
              </div>
            </>
          )}
        </Modal>

        <ConfirmDialog
          isOpen={!!refASupprimer}
          title="Supprimer cet item du référentiel ?"
          message={refASupprimer ? `« ${refASupprimer.item} » — les évaluations déjà saisies conservent une copie de l'intitulé.` : ''}
          confirmLabel="Supprimer"
          onCancel={() => setRefASupprimer(null)}
          onConfirm={async () => { const it = refASupprimer; setRefASupprimer(null); await deleteRef(it); }}
        />
      </div>
    </Layout>
  );
}
