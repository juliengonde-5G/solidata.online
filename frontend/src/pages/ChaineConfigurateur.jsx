import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Workflow, Save, Undo2, RotateCcw, AlertTriangle, Settings2, Users, CheckCircle2, Info,
} from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader, Modal, ErrorState } from '../components';
import useConfirm from '../hooks/useConfirm';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import CanevasChaine from '../components/chaine/CanevasChaine';
import PaletteBlocs from '../components/chaine/PaletteBlocs';
import PanneauProprietes from '../components/chaine/PanneauProprietes';
import BarreLayouts from '../components/chaine/BarreLayouts';
import { blocNeuf, effectifTotal, verifierPlan } from '../components/chaine/constantes';

const MAX_HISTORIQUE = 60;
const copie = (blocs) => blocs.map((b) => ({ ...b, proprietes: b.proprietes ? { ...b.proprietes } : null }));

/**
 * ChaineConfigurateur — plan 2D de la chaîne de tri.
 *
 * Le plan seedé (« Plan V7 — 15 personnes ») est un POINT DE DÉPART : l'atelier
 * le réorganise, ouvre ou ferme des postes, essaie une variante. D'où trois
 * partis pris :
 *  - l'enregistrement est EXPLICITE (rien n'est écrit en glissant un bloc) et
 *    les modifications non enregistrées sont annoncées ;
 *  - un dépassement de l'effectif de référence est signalé, jamais bloqué —
 *    on prépare une organisation avant de l'arbitrer ;
 *  - sans effectif de référence saisi, aucun plafond n'est supposé.
 */
export default function ChaineConfigurateur() {
  const { user } = useAuth();
  const role = user?.base_role || user?.role;
  const peutEditer = role === 'ADMIN' || role === 'MANAGER';
  const peutSupprimer = role === 'ADMIN';
  const lectureSeule = !peutEditer;
  const { confirm, ConfirmDialogElement } = useConfirm();

  const [layouts, setLayouts] = useState([]);
  const [layoutId, setLayoutId] = useState(null);
  const [layoutCourant, setLayoutCourant] = useState(null);
  const [blocs, setBlocs] = useState([]);
  const [selection, setSelection] = useState(null);

  const [historique, setHistorique] = useState([]);
  const [modifie, setModifie] = useState(false);
  const [aimantActif, setAimantActif] = useState(true);
  const [zoom, setZoom] = useState(1);

  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(null);
  const [banniere, setBanniere] = useState(null); // { type: 'succes'|'erreur'|'info', texte, details? }
  const [occupe, setOccupe] = useState(false);

  const [modaleReglages, setModaleReglages] = useState(false);
  const [formReglages, setFormReglages] = useState({ nom: '', description: '', effectif_max: '' });
  const [modaleNouveau, setModaleNouveau] = useState(null); // { duplication: bool, nom }

  const modifieRef = useRef(false);
  useEffect(() => { modifieRef.current = modifie; }, [modifie]);

  // Un plan en cours d'édition ne doit pas partir à la corbeille sur un onglet fermé.
  useEffect(() => {
    const garde = (e) => { if (modifieRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', garde);
    return () => window.removeEventListener('beforeunload', garde);
  }, []);

  // ── Chargement ──────────────────────────────────────────────────────────
  const appliquerReponse = useCallback((data) => {
    setLayoutCourant(data.layout || null);
    setBlocs(copie(data.postes || []));
    setHistorique([]);
    setModifie(false);
    setSelection(null);
  }, []);

  const chargerListe = useCallback(async (idSouhaite = null) => {
    setChargement(true);
    setErreurChargement(null);
    try {
      if (lectureSeule) {
        // Rôle non habilité à la gestion : on ne lit que le plan en vigueur.
        const res = await api.get('/chaine-config/layout-actif');
        setLayouts(res.data.layout ? [res.data.layout] : []);
        setLayoutId(res.data.layout?.id || null);
        appliquerReponse(res.data);
        if (!res.data.layout && res.data.motif) setBanniere({ type: 'info', texte: res.data.motif });
        return;
      }
      const res = await api.get('/chaine-config/layouts');
      const liste = res.data.layouts || [];
      setLayouts(liste);
      const cible = liste.find((l) => l.id === idSouhaite)
        || liste.find((l) => l.is_actif) || liste[0] || null;
      setLayoutId(cible?.id || null);
      if (cible) {
        const detail = await api.get(`/chaine-config/layouts/${cible.id}`);
        appliquerReponse(detail.data);
      } else {
        appliquerReponse({ layout: null, postes: [] });
      }
    } catch (err) {
      console.error('[ChaineConfigurateur] chargement :', err);
      setErreurChargement(
        err.response?.data?.error || "Impossible de charger les plans de la chaîne de tri."
      );
    } finally {
      setChargement(false);
    }
  }, [appliquerReponse, lectureSeule]);

  useEffect(() => { chargerListe(); }, [chargerListe]);

  const changerLayout = useCallback(async (id) => {
    // En consultation, seul le plan en vigueur est lisible : la liste complète
    // est refusée par le serveur (403), inutile d'aller s'y heurter.
    if (lectureSeule || !id || id === layoutId) return;
    if (modifieRef.current) {
      const ok = await confirm({
        title: 'Abandonner les modifications ?',
        message: 'Ce plan comporte des modifications non enregistrées. Elles seront perdues.',
        confirmLabel: 'Changer de plan',
        confirmVariant: 'danger',
      });
      if (!ok) return;
    }
    setChargement(true);
    setBanniere(null);
    try {
      const detail = await api.get(`/chaine-config/layouts/${id}`);
      setLayoutId(id);
      appliquerReponse(detail.data);
    } catch (err) {
      console.error('[ChaineConfigurateur] détail plan :', err);
      setBanniere({ type: 'erreur', texte: err.response?.data?.error || 'Impossible d’ouvrir ce plan.' });
    } finally {
      setChargement(false);
    }
  }, [appliquerReponse, confirm, layoutId, lectureSeule]);

  // ── Édition locale ──────────────────────────────────────────────────────
  const poserJalon = useCallback(() => {
    setHistorique((h) => [...h.slice(-(MAX_HISTORIQUE - 1)), copie(blocs)]);
    setModifie(true);
  }, [blocs]);

  const modifierBloc = useCallback((code, champs) => {
    setBlocs((liste) => liste.map((b) => (b.code === code ? { ...b, ...champs } : b)));
    setModifie(true);
    if (champs.code && champs.code !== code) setSelection(champs.code);
  }, []);

  // Le déplacement et le redimensionnement passent par le même chemin, mais
  // sans jalon (il est posé une fois, au début du geste, par le canevas).
  const deplacerBloc = useCallback((code, x, y) => {
    setBlocs((liste) => liste.map((b) => (b.code === code ? { ...b, x, y } : b)));
    setModifie(true);
  }, []);
  const redimensionnerBloc = useCallback((code, largeur, hauteur) => {
    setBlocs((liste) => liste.map((b) => (b.code === code ? { ...b, largeur, hauteur } : b)));
    setModifie(true);
  }, []);

  const modifierAvecJalon = useCallback((code, champs) => {
    poserJalon();
    modifierBloc(code, champs);
  }, [modifierBloc, poserJalon]);

  const ajouterBloc = useCallback((categorie) => {
    poserJalon();
    const neuf = blocNeuf(categorie, blocs.map((b) => b.code));
    setBlocs((liste) => [...liste, neuf]);
    setSelection(neuf.code);
    setModifie(true);
  }, [blocs, poserJalon]);

  const supprimerBloc = useCallback(async (code) => {
    const bloc = blocs.find((b) => b.code === code);
    if (!bloc) return;
    const ok = await confirm({
      title: `Supprimer « ${bloc.libelle} » ?`,
      message: 'Le bloc disparaîtra du plan. La suppression ne devient définitive qu’à l’enregistrement.',
      confirmLabel: 'Supprimer le bloc',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    poserJalon();
    setBlocs((liste) => liste.filter((b) => b.code !== code));
    setSelection(null);
    setModifie(true);
  }, [blocs, confirm, poserJalon]);

  const annuler = useCallback(() => {
    setHistorique((h) => {
      if (h.length === 0) return h;
      setBlocs(copie(h[h.length - 1]));
      return h.slice(0, -1);
    });
  }, []);

  const reinitialiser = useCallback(async () => {
    const ok = await confirm({
      title: 'Revenir au plan enregistré ?',
      message: 'Toutes les modifications non enregistrées seront perdues.',
      confirmLabel: 'Revenir au plan enregistré',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setBanniere(null);
    chargerListe(layoutId);
  }, [chargerListe, confirm, layoutId]);

  // ── Enregistrement ──────────────────────────────────────────────────────
  const anomalies = useMemo(() => verifierPlan(blocs), [blocs]);
  const total = useMemo(() => effectifTotal(blocs), [blocs]);
  const reference = layoutCourant?.effectif_max == null ? null : Number(layoutCourant.effectif_max);
  const depassement = reference !== null && total > reference;

  const enregistrer = useCallback(async () => {
    if (!layoutId) return;
    if (anomalies.length > 0) {
      setBanniere({
        type: 'erreur',
        texte: 'Le plan comporte des anomalies : corrigez-les avant d’enregistrer.',
        details: anomalies,
      });
      return;
    }
    setOccupe(true);
    setBanniere(null);
    try {
      const res = await api.put(`/chaine-config/layouts/${layoutId}/postes`, { postes: blocs });
      appliquerReponse(res.data);
      setBanniere(res.data.avertissement
        ? { type: 'info', texte: `Plan enregistré. ${res.data.avertissement}` }
        : { type: 'succes', texte: 'Plan enregistré.' });
      setLayouts((liste) => liste.map((l) => (l.id === layoutId ? { ...l, ...res.data.layout } : l)));
    } catch (err) {
      console.error('[ChaineConfigurateur] enregistrement :', err);
      setBanniere({
        type: 'erreur',
        texte: err.response?.data?.error || "L’enregistrement a échoué — le plan affiché n’est pas enregistré.",
      });
    } finally {
      setOccupe(false);
    }
  }, [anomalies, appliquerReponse, blocs, layoutId]);

  // ── Gestion des plans ───────────────────────────────────────────────────
  const creerPlan = useCallback(async () => {
    const nom = (modaleNouveau?.nom || '').trim();
    if (!nom) return;
    setOccupe(true);
    try {
      const res = await api.post('/chaine-config/layouts', {
        nom,
        ...(modaleNouveau.duplication && layoutId ? { depuis_layout_id: layoutId } : {}),
      });
      setModaleNouveau(null);
      await chargerListe(res.data.layout.id);
      setBanniere({
        type: 'succes',
        texte: modaleNouveau.duplication
          ? `Plan dupliqué sous le nom « ${nom} ». Il n’est pas en vigueur tant que vous ne l’activez pas.`
          : `Plan « ${nom} » créé.`,
      });
    } catch (err) {
      console.error('[ChaineConfigurateur] création plan :', err);
      setBanniere({ type: 'erreur', texte: err.response?.data?.error || 'La création du plan a échoué.' });
    } finally {
      setOccupe(false);
    }
  }, [chargerListe, layoutId, modaleNouveau]);

  const activerPlan = useCallback(async () => {
    if (!layoutId) return;
    const ok = await confirm({
      title: 'Mettre ce plan en vigueur ?',
      message: 'Il deviendra le plan de référence de la chaîne, à la place du plan actuellement en vigueur.',
      confirmLabel: 'Mettre en vigueur',
    });
    if (!ok) return;
    setOccupe(true);
    try {
      await api.post(`/chaine-config/layouts/${layoutId}/activer`);
      await chargerListe(layoutId);
      setBanniere({ type: 'succes', texte: 'Ce plan est désormais le plan en vigueur.' });
    } catch (err) {
      console.error('[ChaineConfigurateur] activation :', err);
      setBanniere({ type: 'erreur', texte: err.response?.data?.error || "L’activation a échoué." });
    } finally {
      setOccupe(false);
    }
  }, [chargerListe, confirm, layoutId]);

  const supprimerPlan = useCallback(async () => {
    if (!layoutId || !layoutCourant) return;
    const ok = await confirm({
      title: `Supprimer le plan « ${layoutCourant.nom} » ?`,
      message: 'Le plan et tous ses blocs seront définitivement supprimés.',
      confirmLabel: 'Supprimer le plan',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setOccupe(true);
    try {
      await api.delete(`/chaine-config/layouts/${layoutId}`);
      await chargerListe();
      setBanniere({ type: 'succes', texte: 'Plan supprimé.' });
    } catch (err) {
      console.error('[ChaineConfigurateur] suppression :', err);
      setBanniere({
        type: 'erreur',
        texte: err.response?.data?.code === 'LAYOUT_ACTIF'
          ? "Ce plan est en vigueur : mettez un autre plan en vigueur avant de le supprimer."
          : err.response?.data?.error || 'La suppression a échoué.',
      });
    } finally {
      setOccupe(false);
    }
  }, [chargerListe, confirm, layoutCourant, layoutId]);

  const enregistrerReglages = useCallback(async () => {
    if (!layoutId) return;
    setOccupe(true);
    try {
      const res = await api.put(`/chaine-config/layouts/${layoutId}`, {
        nom: formReglages.nom,
        description: formReglages.description,
        effectif_max: formReglages.effectif_max === '' ? null : Number(formReglages.effectif_max),
      });
      setLayoutCourant(res.data.layout);
      setLayouts((liste) => liste.map((l) => (l.id === layoutId ? { ...l, ...res.data.layout } : l)));
      setModaleReglages(false);
      setBanniere({ type: 'succes', texte: 'Réglages du plan enregistrés.' });
    } catch (err) {
      console.error('[ChaineConfigurateur] réglages :', err);
      setBanniere({ type: 'erreur', texte: err.response?.data?.error || "L’enregistrement des réglages a échoué." });
    } finally {
      setOccupe(false);
    }
  }, [formReglages, layoutId]);

  const blocSelectionne = blocs.find((b) => b.code === selection) || null;
  const nbObligatoires = blocs.filter((b) => b.categorie === 'poste' && b.obligatoire && b.actif !== false).length;
  const nbFacultatifs = blocs.filter((b) => b.categorie === 'poste' && !b.obligatoire && b.actif !== false).length;

  return (
    <Layout>
      <PageHeader
        title="Configurateur de la chaîne de tri"
        subtitle="Plan 2D des postes, des zones de dépose et des entrées de matière"
        icon={Workflow}
        breadcrumb={[{ label: 'Opérations' }, { label: 'Tri', path: '/tri' }, { label: 'Configurateur' }]}
        actions={!lectureSeule && (
          <div className="flex flex-wrap items-center gap-2">
            {modifie && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50
                               text-amber-800 text-xs font-medium border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Modifications non enregistrées
              </span>
            )}
            <button
              type="button" onClick={annuler} disabled={historique.length === 0 || occupe}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300
                         bg-white text-sm text-slate-700 hover:border-teal-400 disabled:opacity-40"
              title="Annuler la dernière action"
            >
              <Undo2 className="w-4 h-4" aria-hidden="true" /> Annuler
            </button>
            <button
              type="button" onClick={reinitialiser} disabled={!modifie || occupe}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300
                         bg-white text-sm text-slate-700 hover:border-teal-400 disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Revenir au plan enregistré
            </button>
            <button
              type="button" onClick={enregistrer} disabled={!layoutId || occupe}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm
                         font-medium hover:bg-teal-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" aria-hidden="true" /> Enregistrer le plan
            </button>
          </div>
        )}
      />

      {lectureSeule && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-slate-600">
            Consultation du plan en vigueur. La modification de la chaîne est réservée à la direction
            et aux responsables d’exploitation.
          </p>
        </div>
      )}

      {banniere && (
        <div
          role="alert"
          className={`mb-4 rounded-xl border p-3 text-sm ${
            banniere.type === 'erreur' ? 'border-red-200 bg-red-50 text-red-800'
              : banniere.type === 'succes' ? 'border-teal-200 bg-teal-50 text-teal-800'
                : 'border-amber-200 bg-amber-50 text-amber-900'}`}
        >
          <div className="flex items-start gap-2">
            {banniere.type === 'succes'
              ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
            <div className="min-w-0">
              <p>{banniere.texte}</p>
              {banniere.details?.length > 0 && (
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  {banniere.details.slice(0, 8).map((d, i) => <li key={i}>{d}</li>)}
                  {banniere.details.length > 8 && <li>… et {banniere.details.length - 8} autre(s).</li>}
                </ul>
              )}
            </div>
            <button
              type="button" onClick={() => setBanniere(null)}
              className="ml-auto text-xs underline shrink-0"
            >
              Masquer
            </button>
          </div>
        </div>
      )}

      {erreurChargement ? (
        <ErrorState
          variant="card" title="Chargement impossible"
          message={erreurChargement} onRetry={() => chargerListe(layoutId)}
        />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <BarreLayouts
              layouts={layouts}
              layoutId={layoutId}
              layoutCourant={layoutCourant}
              lectureSeule={lectureSeule}
              peutSupprimer={peutSupprimer}
              occupe={occupe}
              onChanger={changerLayout}
              onNouveau={() => setModaleNouveau({ duplication: false, nom: '' })}
              onDupliquer={() => setModaleNouveau({
                duplication: true, nom: `${layoutCourant?.nom || 'Plan'} (copie)`,
              })}
              onActiver={activerPlan}
              onSupprimer={supprimerPlan}
            />
          </div>

          {/* Compteur d'effectif — le chiffre qui gouverne le plan. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={`rounded-xl border p-4 ${
              depassement ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 mb-1">
                <Users className="w-3.5 h-3.5" aria-hidden="true" /> Effectif du plan
              </div>
              <p className={`text-2xl font-bold tabular-nums ${depassement ? 'text-red-700' : 'text-slate-800'}`}>
                {total}
                <span className="text-base font-medium text-slate-400">
                  {reference === null ? '' : ` / ${reference}`}
                </span>
              </p>
              <p className={`text-xs mt-1 ${depassement ? 'text-red-700' : 'text-slate-500'}`}>
                {reference === null
                  ? 'Aucun effectif de référence défini pour ce plan.'
                  : depassement
                    ? `Dépassement de ${total - reference} personne(s) — le plan reste enregistrable.`
                    : 'Somme des effectifs maximum des postes en service.'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Postes en service</p>
              <p className="text-2xl font-bold text-slate-800 tabular-nums">{nbObligatoires + nbFacultatifs}</p>
              <p className="text-xs text-slate-500 mt-1">
                {nbObligatoires} obligatoire(s) · {nbFacultatifs} facultatif(s)
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Blocs du plan</p>
                <p className="text-2xl font-bold text-slate-800 tabular-nums">{blocs.length}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {blocs.filter((b) => b.categorie === 'zone_depose').length} zone(s) de dépose ·{' '}
                  {blocs.filter((b) => b.categorie === 'entree').length} entrée(s)
                </p>
              </div>
              {!lectureSeule && layoutId && (
                <button
                  type="button"
                  onClick={() => {
                    setFormReglages({
                      nom: layoutCourant?.nom || '',
                      description: layoutCourant?.description || '',
                      effectif_max: layoutCourant?.effectif_max == null ? '' : String(layoutCourant.effectif_max),
                    });
                    setModaleReglages(true);
                  }}
                  className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border
                             border-slate-300 text-sm text-slate-600 hover:border-teal-400"
                >
                  <Settings2 className="w-4 h-4" aria-hidden="true" /> Réglages
                </button>
              )}
            </div>
          </div>

          {anomalies.length > 0 && !lectureSeule && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-medium mb-1">
                {anomalies.length} anomalie(s) empêchent l’enregistrement :
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {anomalies.slice(0, 6).map((a, i) => <li key={i}>{a}</li>)}
                {anomalies.length > 6 && <li>… et {anomalies.length - 6} autre(s).</li>}
              </ul>
            </div>
          )}

          <PaletteBlocs
            lectureSeule={lectureSeule}
            aimantActif={aimantActif}
            onBasculerAimant={() => setAimantActif((v) => !v)}
            zoom={zoom}
            onZoom={(d) => setZoom((z) => Math.min(2, Math.max(1, Math.round((z + d) * 100) / 100)))}
            onAjouter={ajouterBloc}
          />

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_22rem] gap-4 items-start">
            {chargement ? (
              <div className="rounded-xl border border-slate-200 bg-white h-72 flex items-center justify-center
                              text-sm text-slate-400">
                Chargement du plan…
              </div>
            ) : (
              <CanevasChaine
                blocs={blocs}
                selection={selection}
                lectureSeule={lectureSeule}
                aimantActif={aimantActif}
                zoom={zoom}
                onSelectionner={setSelection}
                onDeplacer={deplacerBloc}
                onRedimensionner={redimensionnerBloc}
                onDebutAction={poserJalon}
                onSupprimerSelection={() => selection && supprimerBloc(selection)}
              />
            )}

            <PanneauProprietes
              bloc={blocSelectionne}
              lectureSeule={lectureSeule}
              onModifier={modifierAvecJalon}
              onSupprimer={supprimerBloc}
            />
          </div>

          {!lectureSeule && (
            <p className="text-xs text-slate-400">
              Déplacez un bloc en le faisant glisser (souris ou doigt), ajustez sa taille par la poignée
              en bas à droite. Au clavier : flèches pour déplacer la sélection, Suppr pour la retirer,
              Échap pour désélectionner. Rien n’est enregistré tant que vous n’avez pas cliqué sur
              « Enregistrer le plan ».
            </p>
          )}
        </div>
      )}

      {/* ── Réglages du plan ── */}
      <Modal
        isOpen={modaleReglages} onClose={() => setModaleReglages(false)}
        title="Réglages du plan"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModaleReglages(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700">
              Annuler
            </button>
            <button type="button" onClick={enregistrerReglages} disabled={occupe || !formReglages.nom.trim()}
              className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium disabled:opacity-50">
              Enregistrer
            </button>
          </div>
        )}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="reglages-nom">
              Nom du plan
            </label>
            <input
              id="reglages-nom" maxLength={120} value={formReglages.nom}
              onChange={(e) => setFormReglages((f) => ({ ...f, nom: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="reglages-desc">
              Description
            </label>
            <textarea
              id="reglages-desc" rows={3} value={formReglages.description}
              onChange={(e) => setFormReglages((f) => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="reglages-effectif">
              Effectif de référence (personnes)
            </label>
            <input
              id="reglages-effectif" type="number" min={0} max={999} value={formReglages.effectif_max}
              onChange={(e) => setFormReglages((f) => ({ ...f, effectif_max: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">
              Laissé vide, aucun plafond n’est supposé : le plan n’affiche alors aucune alerte d’effectif.
            </p>
          </div>
        </div>
      </Modal>

      {/* ── Nouveau plan / duplication ── */}
      <Modal
        isOpen={!!modaleNouveau} onClose={() => setModaleNouveau(null)}
        title={modaleNouveau?.duplication ? 'Dupliquer le plan' : 'Nouveau plan'}
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModaleNouveau(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700">
              Annuler
            </button>
            <button type="button" onClick={creerPlan} disabled={occupe || !(modaleNouveau?.nom || '').trim()}
              className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium disabled:opacity-50">
              {modaleNouveau?.duplication ? 'Dupliquer' : 'Créer'}
            </button>
          </div>
        )}
      >
        <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="nouveau-nom">
          Nom du plan
        </label>
        <input
          id="nouveau-nom" maxLength={120} value={modaleNouveau?.nom || ''}
          onChange={(e) => setModaleNouveau((m) => ({ ...m, nom: e.target.value }))}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
        />
        <p className="text-xs text-slate-400 mt-2">
          {modaleNouveau?.duplication
            ? 'Tous les blocs du plan courant sont copiés. La copie n’entre pas en vigueur : il faudra la mettre en vigueur explicitement.'
            : 'Le plan est créé vide : ajoutez ses blocs depuis la palette.'}
        </p>
      </Modal>

      {ConfirmDialogElement}
    </Layout>
  );
}
