import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Modal, ConfirmDialog } from '../components';
import { Heart } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { frDate, isAdminRh } from '../components/insertion/freins';
import DiagnosticForm from '../components/insertion/DiagnosticForm';
import AlertesBloc from '../components/insertion/AlertesBloc';
import DossierAdministratif from '../components/insertion/DossierAdministratif';
import EcheancesPanel from '../components/insertion/EcheancesPanel';
import FileActive from '../components/insertion/FileActive';
import OngletSituation from '../components/insertion/OngletSituation';
import OngletSuivi from '../components/insertion/OngletSuivi';
import { PASS_STATUT_LABELS, PASS_STATUT_CLASSES } from '../components/insertion/PassIaePanel';
import QuickActionButton, { pushRecent } from '../components/insertion/QuickActionButton';
import { exportFicheParcoursPDF, exportBilanProlongationPassIae } from '../components/insertion/pdf-insertion';
import { exportFicheReferentPDF, exportReleveAssiduitePDF } from '../components/insertion/pdf-referent';
// PR C lot 7 — consentement aux rappels de rendez-vous, rendu au bas du
// dossier administratif par la prop `extra`. Ancrage posé par l'orchestrateur :
// le lot 5 le DÉPLACE avec les onglets, il ne le supprime pas (contrat § 1.1).
import RappelsConsentement from '../components/insertion/RappelsConsentement';
import ActiviteHebdo from '../components/insertion/ActiviteHebdo';
import { TYPE_LABELS_RSA } from '../components/insertion/entretiens-rsa';
import { formatEmployeeName, compareByName } from '../utils/names';

/**
 * Espace CIP — « Mes échéances » et la fiche de parcours (PR C lot 5).
 *
 * ═══ CE QUI A CHANGÉ, ET CE QUE ÇA RÉPARE ═════════════════════════════════
 *
 * 1. L'ÉCRAN D'ACCUEIL est « Mes échéances » (`EcheancesPanel`) : ce que la
 *    conseillère doit faire aujourd'hui, dans l'ordre où ça se fait un lundi
 *    matin. Le tableau de bord précédent listait des statistiques.
 *
 * 2. LA FICHE a QUATRE onglets — Situation / Suivi / Dossier administratif /
 *    Diagnostic — au lieu de huit. Les huit ne décrivaient pas huit gestes : ils
 *    décrivaient huit endroits où la donnée était rangée. « Freins » et
 *    « Synthèse » étaient deux vues de la même situation ; « Entretiens »,
 *    « Objectifs & actions » et « Compétences » trois moments du même suivi —
 *    et poser une action décidée en entretien obligeait à changer d'onglet.
 *    L'onglet « Assistant IA » disparaît : la proposition de synthèse vit dans
 *    Situation, la préparation d'entretien dans l'entretien, et la SONDE de
 *    connexion est partie dans les Réglages (c'est un contrôle d'exploitation,
 *    il n'avait rien à faire dans le dossier d'une personne).
 *
 * 3. LA FILE ACTIVE (colonne de gauche) ne contient plus les permanents et
 *    garde les sortis sept mois — c'est APRÈS la sortie que la donnée FSE+ est
 *    due. Recherche, filtres et pastille de risque y sont.
 *
 * 4. PLUS AUCUNE boîte de dialogue native : la garde de saisie non
 *    enregistrée passe par `ConfirmDialog`. Une boîte native ne se traduit pas,
 *    ne se met pas à la charte, et sur un poste partagé elle bloque l'onglet.
 */

const IA_TIMEOUT = 120000;

const REFERENT_UNIQUE_LABELS = {
  structure: 'structure', france_travail: 'France Travail', cms: 'CMS',
  autre: 'autre', non_determine: 'non déterminé',
};

const ONGLETS = [
  { id: 'situation', label: 'Situation' },
  { id: 'suivi', label: 'Suivi' },
  { id: 'dossier', label: 'Dossier administratif' },
  { id: 'diagnostic', label: 'Diagnostic' },
];

export default function InsertionParcours() {
  const { user } = useAuth();
  const adminRh = isAdminRh(user);
  const baseRole = user?.base_role || user?.role;
  const [searchParams, setSearchParams] = useSearchParams();

  const [referents, setReferents] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [listeErreur, setListeErreur] = useState(null);
  const [listeChargement, setListeChargement] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [activeTab, setActiveTab] = useState('situation');
  const [activeEntretien, setActiveEntretien] = useState(null);
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [freinsDefinitions, setFreinsDefinitions] = useState(null);
  const [radarData, setRadarData] = useState(null);
  const [cddi, setCddi] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [competences, setCompetences] = useState([]);
  const [cadre, setCadre] = useState(null);
  const [cadreError, setCadreError] = useState(null);
  const [panelError, setPanelError] = useState(null);
  const [showDashboard, setShowDashboard] = useState(true);
  const [mine, setMine] = useState(false);
  const [diagDirty, setDiagDirty] = useState(false);
  const [bilanDirty, setBilanDirty] = useState(false);
  const [newEntretienOpen, setNewEntretienOpen] = useState(false);
  const [newEntretien, setNewEntretien] = useState({
    milestone_type: 'bilan_intermediaire', due_date: new Date().toISOString().slice(0, 10),
  });
  const [passBilanLoading, setPassBilanLoading] = useState(false);
  const [referentLoading, setReferentLoading] = useState(null);

  // ── Garde de saisie non enregistrée ────────────────────────────────────
  // Remplace la confirmation native du navigateur : une telle boîte n'est ni traduite, ni à la
  // charte, et elle fige l'onglet du navigateur. L'action demandée est mise en
  // attente, la boîte s'affiche, et l'action part (ou non) à la réponse.
  const [confirmation, setConfirmation] = useState(null);
  const actionEnAttente = useRef(null);
  const sale = () => diagDirty || bilanDirty;
  const naviguer = useCallback((action) => {
    if (!sale()) { action(); return; }
    actionEnAttente.current = action;
    setConfirmation('Des modifications ne sont pas enregistrées. Continuer sans les enregistrer ?');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagDirty, bilanDirty]);
  const confirmerNavigation = () => {
    const a = actionEnAttente.current;
    actionEnAttente.current = null;
    setConfirmation(null);
    setDiagDirty(false); setBilanDirty(false);
    if (a) a();
  };

  useEffect(() => {
    const handler = (e) => { if (diagDirty || bilanDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [diagDirty, bilanDirty]);

  // ── Chargements ────────────────────────────────────────────────────────
  const loadEmployees = useCallback(async () => {
    setListeChargement(true);
    try {
      setListeErreur(null);
      const res = await api.get('/insertion');
      const list = Array.isArray(res.data) ? res.data : [];
      setEmployees([...list].sort(compareByName));
    } catch (err) {
      console.error('[InsertionParcours] Erreur chargement:', err);
      setListeErreur(err.response?.data?.error || err.message || 'Erreur de chargement');
    }
    setListeChargement(false);
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => {
    api.get('/insertion/freins-definitions').then((r) => setFreinsDefinitions(r.data))
      .catch((err) => console.error('[Insertion] freins-definitions indisponible:', err));
    api.get('/insertion/cip-referents').then((r) => setReferents(Array.isArray(r.data) ? r.data : []))
      .catch((err) => console.error('[Insertion] cip-referents indisponible:', err));
  }, []);

  const selectEmployee = useCallback(async (emp, { keepTab = false, keepEntretienId = null, onglet = null } = {}) => {
    setSelectedEmployee(emp);
    setShowDashboard(false);
    if (onglet) setActiveTab(onglet);
    else if (!keepTab) setActiveTab('situation');
    setPanelError(null);
    setDiagDirty(false); setBilanDirty(false);
    setCadre(null); setCadreError(null);
    setLoading(true);
    pushRecent(emp.id);
    try {
      const [analysisRes, diagRes, radarRes] = await Promise.all([
        api.get(`/insertion/${emp.id}`),
        api.get(`/insertion/diagnostic/${emp.id}`),
        api.get(`/insertion/milestones/${emp.id}/radar`).catch(() => ({ data: null })),
      ]);
      setAnalysis(analysisRes.data);
      setDiagnostic(diagRes.data || {});
      setRadarData(radarRes.data);
      if (keepEntretienId) {
        const ms = (analysisRes.data.milestones || []).find((m) => m.id === keepEntretienId);
        setActiveEntretien(ms || null);
      } else {
        setActiveEntretien(null);
      }
      api.get(`/employees/${emp.id}/cddi-duration`).then((r) => setCddi(r.data)).catch(() => setCddi(null));
      api.get(`/insertion/cadre/${emp.id}`)
        .then((r) => { setCadre(r.data); setCadreError(null); })
        .catch((err) => setCadreError(err.response?.data?.error || err.message || 'Dossier administratif indisponible'));
      api.get(`/employees/${emp.id}/contracts`)
        .then((r) => setContracts(Array.isArray(r.data) ? r.data : []))
        .catch(() => setContracts([]));
      api.get(`/insertion/competences/${emp.id}`)
        .then((r) => setCompetences(Array.isArray(r.data) ? r.data : []))
        .catch(() => setCompetences([]));
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message || 'Erreur de chargement du parcours');
    }
    setLoading(false);
  }, []);

  /**
   * Ouverture depuis une échéance : la ligne porte sa CIBLE (onglet + champ),
   * l'écran s'ouvre donc là où le travail se fait — pas sur la page d'accueil
   * de la fiche, à charge pour la conseillère de retrouver l'onglet.
   */
  const selectEmployeeById = useCallback((id, cible = null) => {
    const emp = employees.find((e) => e.id === id) || { id };
    naviguer(() => selectEmployee(emp, { onglet: cible?.onglet || null }));
  }, [employees, selectEmployee, naviguer]);

  useEffect(() => {
    const q = searchParams.get('employee');
    if (q && employees.length > 0 && !selectedEmployee) {
      const id = parseInt(q, 10);
      if (!Number.isNaN(id)) {
        const emp = employees.find((e) => e.id === id) || { id };
        selectEmployee(emp);
      }
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, searchParams]);

  const reloadSelected = (opts = {}) => {
    if (selectedEmployee) selectEmployee(selectedEmployee, { keepTab: true, ...opts });
  };

  // ── Gestes de la fiche ─────────────────────────────────────────────────
  const saveReferent = async (userId) => {
    if (!selectedEmployee) return;
    setPanelError(null);
    try {
      const res = await api.put(`/insertion/${selectedEmployee.id}/cip-referent`, { user_id: userId || null });
      setAnalysis((a) => (a ? {
        ...a,
        employee: { ...a.employee, cip_referent_user_id: res.data.cip_referent_user_id, cip_referent_nom: res.data.cip_referent_nom },
      } : a));
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message || 'Erreur lors de la mise à jour du référent');
    }
  };

  const initializeMilestones = async () => {
    if (!selectedEmployee) return;
    setPanelError(null);
    try {
      await api.post(`/insertion/milestones/${selectedEmployee.id}/initialize`);
      reloadSelected();
    } catch (err) {
      setPanelError((err.response?.data?.error || err.message)
        + (err.response?.data?.detail ? ` — ${err.response.data.detail}` : ''));
    }
  };

  const resyncEcheances = async () => {
    if (!selectedEmployee) return;
    setPanelError(null);
    try {
      await api.post(`/insertion/${selectedEmployee.id}/resync-milestones`);
      reloadSelected();
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message);
    }
  };

  const createEntretien = async () => {
    if (!selectedEmployee) return;
    setPanelError(null);
    try {
      const res = await api.post('/insertion/milestones', {
        employee_id: selectedEmployee.id,
        milestone_type: newEntretien.milestone_type,
        due_date: newEntretien.due_date,
      });
      setNewEntretienOpen(false);
      setActiveTab('suivi');
      selectEmployee(selectedEmployee, { keepTab: true, keepEntretienId: res.data?.id });
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message);
    }
  };

  const exportPassIaeBilan = async () => {
    if (!selectedEmployee) return;
    setPassBilanLoading(true); setPanelError(null);
    try {
      const r = await api.get(`/insertion/pass-iae/bilan/${selectedEmployee.id}`, { timeout: IA_TIMEOUT });
      exportBilanProlongationPassIae(r.data);
    } catch (err) {
      setPanelError((err.response?.data?.error || err.message) + ' (bilan Pass IAE)');
    }
    setPassBilanLoading(false);
  };

  const ilYAUnAn = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };

  // Le raccourci d'en-tête ENREGISTRE avant d'imprimer (correctif M-03, PR B) :
  // une fiche imprimée EST une fiche transmise, le POST en garde la preuve.
  const exporterFicheReferent = async (employeeId) => {
    setReferentLoading('fiche'); setPanelError(null);
    try {
      const r = await api.post(`/insertion/rsa/${employeeId}/fiche-referent`, {
        moment: 'demande', du: ilYAUnAn(), au: new Date().toISOString().slice(0, 10),
      });
      exportFicheReferentPDF(r.data.contenu, { moment: 'demande' });
    } catch (err) {
      const d = err.response?.data;
      setPanelError(d?.code === 'REFERENT_NON_DETERMINE'
        ? `${d.error} ${d.hint || ''}`.trim()
        : (d?.error || err.message) + ' (fiche pour le référent)');
    }
    setReferentLoading(null);
  };

  const exporterAssiduite = async (employeeId) => {
    setReferentLoading('assiduite'); setPanelError(null);
    try {
      const r = await api.get(`/insertion/rsa/${employeeId}/assiduite?du=${ilYAUnAn()}&au=${new Date().toISOString().slice(0, 10)}`);
      exportReleveAssiduitePDF(r.data);
    } catch (err) {
      setPanelError((err.response?.data?.error || err.message) + " (relevé d'assiduité)");
    }
    setReferentLoading(null);
  };

  const handleFriseSelect = ({ type, data }) => {
    naviguer(() => {
      if (type === 'entretien' && data?.id) {
        const ms = milestones.find((m) => m.id === data.id) || data;
        setActiveTab('suivi');
        setActiveEntretien(ms);
      } else if (type === 'objectif') {
        setActiveTab('suivi');
        setActiveEntretien(null);
      }
    });
  };

  const emp = analysis?.employee || {};
  const milestones = analysis?.milestones || [];

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Espace CIP — Parcours d'insertion"
          subtitle="Échéances du jour, file active, entretiens et dossier administratif"
          icon={Heart}
        />

        <div className="grid grid-cols-12 gap-4">
          {/* ── Colonne gauche : file active ── */}
          <div className="col-span-12 md:col-span-3">
            <FileActive
              employees={employees}
              selectedId={selectedEmployee?.id}
              onSelect={(e) => naviguer(() => selectEmployee(e))}
              adminRh={adminRh}
              userId={user?.id}
              chargement={listeChargement}
              erreur={listeErreur}
              enTete={(
                <button
                  onClick={() => naviguer(() => { setShowDashboard(true); setSelectedEmployee(null); setPanelError(null); })}
                  className={`w-full mb-3 px-3 py-2 rounded text-sm font-semibold transition ${
                    showDashboard ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  Mes échéances
                </button>
              )}
            />
          </div>

          {/* ── Colonne droite : échéances ou fiche ── */}
          <div className="col-span-12 md:col-span-9 space-y-4">
            {(!selectedEmployee || showDashboard) && (
              <EcheancesPanel onSelect={selectEmployeeById} mine={mine} onMineChange={setMine} />
            )}

            {selectedEmployee && !showDashboard && loading && (
              <LoadingSpinner size="lg" message="Chargement du parcours..." />
            )}

            {selectedEmployee && !showDashboard && panelError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
                <span aria-hidden="true">⚠</span><span>{panelError}</span>
                <button onClick={() => setPanelError(null)} className="ml-auto text-red-500 hover:text-red-700" aria-label="Fermer">×</button>
              </div>
            )}

            {selectedEmployee && !showDashboard && !loading && analysis && (
              <>
                {/* ── En-tête de fiche ── */}
                <div className="bg-white rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-gray-800">{formatEmployeeName(emp.last_name, emp.first_name)}</h2>
                      <div className="text-sm text-gray-500">
                        {emp.position} - {emp.team_name}
                        {emp.insertion_start_date && ` | Début : ${frDate(emp.insertion_start_date)}`}
                        {emp.contract_end && ` | Fin contrat : ${frDate(emp.contract_end)}`}
                      </div>
                      <div className="flex gap-2 mt-1.5 flex-wrap items-center">
                        {emp.parcours_num > 1 && <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">Parcours n° {emp.parcours_num}</span>}
                        {cadre?.pass_iae ? (
                          cadre.pass_iae.numero ? (
                            <span className={`text-xs px-2 py-0.5 rounded ${PASS_STATUT_CLASSES[cadre.pass_iae.statut] || PASS_STATUT_CLASSES.inconnu}`}
                              title={`Pass IAE n° ${cadre.pass_iae.numero}`}>
                              Pass IAE {(PASS_STATUT_LABELS[cadre.pass_iae.statut] || cadre.pass_iae.statut).toLowerCase()}
                              {cadre.pass_iae.fin ? ` · fin ${frDate(cadre.pass_iae.fin)}` : ''}
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700"
                              title="Sans numéro de Pass, aucune alerte d'échéance ne peut être calculée">
                              Pass IAE non renseigné
                            </span>
                          )
                        ) : emp.pass_iae_number ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${emp.pass_iae_end && new Date(emp.pass_iae_end) < new Date() ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
                            title={`Pass IAE n° ${emp.pass_iae_number}`}>
                            Pass IAE {emp.pass_iae_end ? `→ ${frDate(emp.pass_iae_end)}` : '✓'}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500" title="Numéro de Pass IAE non renseigné (fiche collaborateur)">Pass IAE non renseigné</span>
                        )}
                        {/* Statuts sociaux : le serveur ne renvoie la clé `statuts`
                            qu'aux rôles ADMIN/RH — pas de garde de rôle à recopier
                            ici, l'absence de clé suffit. */}
                        {cadre?.statuts?.brsa === true && (
                          <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700" title="Bénéficiaire du RSA">BRSA</span>
                        )}
                        {(cadre?.projets || []).map((pr) => (
                          <span key={pr.id} className="text-xs px-2 py-0.5 rounded bg-teal-100 text-teal-800" title={pr.nom}>Projet {pr.code}</span>
                        ))}
                        {cadre?.orientation?.referent_unique && (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            cadre.orientation.referent_unique.type === 'non_determine' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                          }`} title="Référent unique (loi pour le plein emploi)">
                            Référent unique : {REFERENT_UNIQUE_LABELS[cadre.orientation.referent_unique.type] || cadre.orientation.referent_unique.type}
                            {cadre.orientation.referent_unique.nom ? ` — ${cadre.orientation.referent_unique.nom}` : ''}
                          </span>
                        )}
                        {cddi?.is_cddi && (
                          <span className={`text-xs px-2 py-0.5 rounded ${cddi.months_total >= 23 ? 'bg-red-100 text-red-700' : cddi.months_total >= 20 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
                            title="Durée cumulée en CDDI (plafond légal 24 mois)">
                            CDDI : {cddi.months_total}/{cddi.cap_months} mois{cddi.nb_contracts > 1 ? ` (${cddi.nb_contracts} contrats)` : ''}
                          </span>
                        )}
                        {adminRh && <ActiviteHebdo employeeId={selectedEmployee.id} variante="badge" />}
                        {analysis.has_pcm && <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">PCM recrutement</span>}
                        {(emp.prescripteur_nom || emp.prescripteur) && (
                          <span className="text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-700">
                            Prescripteur : {emp.prescripteur_nom || emp.prescripteur}
                            {emp.prescripteur_type ? ` (${emp.prescripteur_type})` : ''}
                          </span>
                        )}
                        {adminRh ? (
                          <label className="text-xs px-2 py-0.5 rounded bg-teal-50 text-teal-700 flex items-center gap-1" title="CIP référent de ce salarié">
                            CIP référent :
                            <select value={emp.cip_referent_user_id || ''}
                              onChange={(e) => saveReferent(e.target.value ? parseInt(e.target.value, 10) : null)}
                              className="bg-transparent text-teal-800 text-xs outline-none cursor-pointer">
                              <option value="">— non affecté —</option>
                              {referents.map((rf) => (
                                <option key={rf.id} value={rf.id}>{formatEmployeeName(rf.last_name, rf.first_name)}</option>
                              ))}
                            </select>
                          </label>
                        ) : emp.cip_referent_nom ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-teal-50 text-teal-700">CIP référent : {emp.cip_referent_nom}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 items-end">
                      <div className="flex gap-2 flex-wrap justify-end">
                        <QuickActionButton defaultEmployeeId={selectedEmployee.id}
                          defaultEmployeeName={formatEmployeeName(emp.last_name, emp.first_name)}
                          onCreated={() => reloadSelected()} className="!py-1.5 !text-xs" />
                        <button onClick={() => setNewEntretienOpen(true)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 whitespace-nowrap">
                          + Entretien / bilan
                        </button>
                      </div>
                      <div className="flex gap-2 flex-wrap justify-end">
                        {milestones.length === 0 && (
                          <button onClick={initializeMilestones} className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 whitespace-nowrap">
                            Démarrer le parcours
                          </button>
                        )}
                        {adminRh && milestones.length > 0 && (
                          <button onClick={resyncEcheances} title="Recale les échéances des entretiens non réalisés sur le contrat en cours"
                            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-50 whitespace-nowrap">
                            Mettre à jour les échéances
                          </button>
                        )}
                        <button onClick={() => exportFicheParcoursPDF(analysis, diagnostic, competences)}
                          className="px-3 py-1.5 rounded-lg border border-teal-300 text-teal-700 text-xs font-medium hover:bg-teal-50 whitespace-nowrap">
                          Fiche parcours (PDF)
                        </button>
                        {adminRh && emp.pass_iae_number && (
                          <button onClick={exportPassIaeBilan} disabled={passBilanLoading}
                            title="Bilan du parcours en appui de la demande de prolongation du Pass IAE (destinataire : prescripteur habilité — sans données art. 9/10)"
                            className="px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-50 whitespace-nowrap disabled:opacity-50">
                            {passBilanLoading ? 'Génération…' : 'Bilan de prolongation (PDF)'}
                          </button>
                        )}
                        {adminRh && (
                          <button onClick={() => exporterFicheReferent(selectedEmployee.id)} disabled={referentLoading}
                            title="Point de situation transmis au référent unique externe (CMS, France Travail) — sans aucune donnée de santé ni judiciaire. La fiche est enregistrée au registre des transmissions avant d'être imprimée."
                            className="px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 text-xs font-medium hover:bg-blue-50 whitespace-nowrap disabled:opacity-50">
                            {referentLoading === 'fiche' ? 'Génération…' : 'Fiche pour le référent (enregistrée)'}
                          </button>
                        )}
                        {adminRh && (
                          <button onClick={() => exporterAssiduite(selectedEmployee.id)} disabled={referentLoading}
                            title="Rendez-vous proposés, honorés et absences par motif catégorisé sur les douze derniers mois"
                            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 whitespace-nowrap disabled:opacity-50">
                            {referentLoading === 'assiduite' ? 'Génération…' : "Relevé d'assiduité"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {cadreError && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-sm">
                      Dossier administratif non chargé : {cadreError} — les badges Pass IAE, BRSA et référent unique
                      de cet en-tête peuvent être incomplets.
                    </div>
                  )}
                  {/* Le bandeau d'alertes reste au-dessus des onglets : il doit
                      être lu quel que soit l'onglet ouvert. */}
                  <AlertesBloc employeeId={selectedEmployee.id} />
                </div>

                {/* ── Onglets ── */}
                <div className="flex gap-1 bg-white rounded-lg border p-1 overflow-x-auto">
                  {ONGLETS.map((tab) => (
                    <button key={tab.id}
                      onClick={() => naviguer(() => { setActiveTab(tab.id); setActiveEntretien(null); })}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition whitespace-nowrap ${
                        activeTab === tab.id ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeTab === 'situation' && (
                  <OngletSituation
                    employeeId={selectedEmployee.id}
                    employee={emp}
                    analysis={analysis}
                    radarData={radarData}
                    contracts={contracts}
                    milestones={milestones}
                    adminRh={adminRh}
                    onDiagnostic={() => setActiveTab('diagnostic')}
                    onFriseSelect={handleFriseSelect}
                    onReload={() => reloadSelected()}
                  />
                )}

                {activeTab === 'suivi' && (
                  <OngletSuivi
                    employeeId={selectedEmployee.id}
                    employee={emp}
                    milestones={milestones}
                    activeEntretien={activeEntretien}
                    adminRh={adminRh}
                    baseRole={baseRole}
                    onOuvrirEntretien={(ms) => setActiveEntretien(ms)}
                    onNouvelEntretien={() => setNewEntretienOpen(true)}
                    onDirtyChange={setBilanDirty}
                    onSaved={(opts) => { if (opts?.reload) { setBilanDirty(false); reloadSelected({ keepEntretienId: activeEntretien?.id }); } }}
                    onClosed={() => { setBilanDirty(false); setActiveEntretien(null); reloadSelected(); }}
                    onDemarrerParcours={initializeMilestones}
                  />
                )}

                {activeTab === 'dossier' && (
                  <DossierAdministratif
                    employeeId={selectedEmployee.id}
                    employee={emp}
                    baseRole={baseRole}
                    onChanged={(d) => { setCadre(d); setCadreError(null); }}
                    extra={adminRh ? <RappelsConsentement employee={emp} /> : null}
                    onNaviguer={(lien) => {
                      const cible = String(lien || '').split('#')[0];
                      if (cible === 'diagnostic') setActiveTab('diagnostic');
                      else if (cible === 'suivi' || cible === 'entretiens') setActiveTab('suivi');
                    }}
                  />
                )}

                {activeTab === 'diagnostic' && diagnostic && (
                  <DiagnosticForm
                    employeeId={selectedEmployee.id}
                    employee={emp}
                    diagnostic={diagnostic}
                    freinsDefinitions={freinsDefinitions}
                    baseRole={baseRole}
                    cadre={cadre}
                    onDirtyChange={setDiagDirty}
                    onSaved={(row) => { if (row) setDiagnostic((d) => ({ ...d, ...row })); }}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Nouvel entretien */}
        <Modal isOpen={newEntretienOpen} onClose={() => setNewEntretienOpen(false)} title="Nouvel entretien" size="sm"
          footer={(
            <>
              <button onClick={() => setNewEntretienOpen(false)} className="px-4 py-2 text-sm text-slate-600">Annuler</button>
              <button onClick={createEntretien} className="px-4 py-2 rounded-[10px] bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Créer</button>
            </>
          )}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={newEntretien.milestone_type}
                onChange={(e) => setNewEntretien({ ...newEntretien, milestone_type: e.target.value })}
                className="input-modern py-1.5 w-full">
                {Object.entries(TYPE_LABELS_RSA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                Les bilans de suivi sont libres (n° auto). Diagnostic d'accueil et bilan de sortie sont uniques par parcours.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Échéance</label>
              <input type="date" value={newEntretien.due_date}
                onChange={(e) => setNewEntretien({ ...newEntretien, due_date: e.target.value })}
                className="input-modern py-1.5 w-full" />
            </div>
          </div>
        </Modal>

        <ConfirmDialog
          isOpen={!!confirmation}
          title="Modifications non enregistrées"
          message={confirmation || ''}
          confirmLabel="Continuer sans enregistrer"
          confirmVariant="danger"
          onConfirm={confirmerNavigation}
          onCancel={() => { actionEnAttente.current = null; setConfirmation(null); }}
        />
      </div>
    </Layout>
  );
}
