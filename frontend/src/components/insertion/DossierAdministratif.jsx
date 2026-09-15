import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Users, Lock, FolderOpen, Info, Copy, Check, Plus } from 'lucide-react';
import { FormField, Section, LoadingSpinner, useToast } from '../index';
import api from '../../services/api';
import { frDate, isAdminRh } from './freins';
import PassIaePanel from './PassIaePanel';
import PiecesPanel from './PiecesPanel';
import DossierConformite from './DossierConformite';
import { exportBilanProlongationPassIae } from './pdf-insertion';

/**
 * Onglet « Dossier administratif » de la fiche CIP (PR A, lot 1).
 *
 * Principe d'écran, repris de la maquette et de l'avis de la CIP : **le dossier
 * dit ce qui manque, il ne bloque jamais**. Aucun champ n'est obligatoire pour
 * continuer ; la colonne de droite (dossier de conformité, lot 2) liste les
 * pièces à compléter. C'est pour cela qu'un salarié qui vient d'entrer peut
 * être saisi en trois minutes puis complété au fil des semaines.
 *
 * Trois règles de fond visibles à l'écran :
 *  1. les JUSTIFICATIFS d'éligibilité ne sont pas déposés ici — seule leur
 *     LOCALISATION est notée (plan 07 § 9) ;
 *  2. le STATUT du Pass est calculé, jamais saisi ;
 *  3. « référent unique non déterminé » est un SIGNALEMENT en rouge, pas un
 *     champ vide : la structure est structure d'accueil, le référent est
 *     externe, et son absence doit remonter au Département quand la personne
 *     est bénéficiaire du RSA.
 *
 * Habilitations : ce composant n'est rendu qu'aux rôles ADMIN/RH pour les blocs
 * d'écriture ; la section « Statuts » (BRSA, catégorie France Travail) n'est
 * pas affichée du tout aux autres — le serveur ne la leur renvoie d'ailleurs
 * pas (la clé est absente de la réponse, pas nulle).
 */

const ORIENTEUR_OPTIONS = [
  { value: 'departement_cms', label: 'Département — CMS' },
  { value: 'france_travail', label: 'France Travail' },
  { value: 'mission_locale', label: 'Mission locale' },
  { value: 'cap_emploi', label: 'Cap emploi' },
  { value: 'ccas', label: 'CCAS' },
  { value: 'autre', label: 'Autre' },
];

const REFERENT_OPTIONS = [
  { value: 'non_determine', label: '— non déterminé' },
  { value: 'cms', label: 'CMS (Département)' },
  { value: 'france_travail', label: 'France Travail' },
  { value: 'structure', label: 'Solidarité Textiles (structure)' },
  { value: 'autre', label: 'Autre' },
];

const SOURCE_OPTIONS = [
  { value: 'auto_prescription', label: 'Auto-prescription' },
  { value: 'prescripteur_habilite', label: 'Prescripteur habilité' },
  { value: 'inconnu', label: 'Inconnue' },
];

const FT_CATEGORIE_OPTIONS = [
  { value: 'A', label: 'A — sans emploi, recherche active' },
  { value: 'B', label: 'B — activité réduite courte' },
  { value: 'C', label: 'C — activité réduite longue' },
  { value: 'D', label: 'D — sans recherche (formation, maladie…)' },
  { value: 'E', label: 'E — en emploi' },
  { value: 'F', label: 'F — accompagnement social' },
  { value: 'G', label: 'G — suspendu / droits en cours d’examen' },
];

const DEROGATION_OPTIONS = [
  { value: 'formation_en_cours', label: 'Formation en cours' },
  { value: 'senior_50', label: 'Senior (50 ans et plus)' },
  { value: 'rqth', label: 'Reconnaissance RQTH' },
  { value: 'cdi_inclusion', label: 'CDI Inclusion' },
];

const BRSA_OPTIONS = [
  { value: '', label: '— non renseigné' },
  { value: 'oui', label: 'Oui' },
  { value: 'non', label: 'Non' },
];

const PROJET_TYPE_LABELS = { asi: 'ASI', ocs: 'OCS', autre: 'Autre' };
const jourOuVide = (v) => (v ? String(v).slice(0, 10) : '');

export default function DossierAdministratif({ employeeId, employee, baseRole, onChanged, onNaviguer }) {
  const toast = useToast();
  const adminRh = isAdminRh({ base_role: baseRole });
  const [projetsActifs, setProjetsActifs] = useState([]);
  const [rattachement, setRattachement] = useState({ projet_id: '', date_entree: new Date().toISOString().slice(0, 10) });
  const [rattachementEnCours, setRattachementEnCours] = useState(false);
  useEffect(() => {
    if (!adminRh) return undefined;
    let actif = true;
    api.get('/insertion/projets')
      .then((r) => { if (actif) setProjetsActifs((r.data || []).filter((p) => p.actif !== false)); })
      .catch(() => { if (actif) setProjetsActifs([]); });
    return () => { actif = false; };
  }, [adminRh]);

  const [cadre, setCadre] = useState(null);
  const [criteres, setCriteres] = useState([]);
  const [prescripteurs, setPrescripteurs] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enregistre, setEnregistre] = useState(null); // section en cours d'enregistrement
  const [copie, setCopie] = useState(false);

  // Brouillons de section — un « Enregistrer » par section (avis CIP § 10).
  const [elig, setElig] = useState({ codes: [], verifiee_le: '', source: '', justificatifs_ref: '' });
  const [orient, setOrient] = useState({
    orienteur_type: '', orienteur_nom: '', prescripteur_id: '', date_prescription: '',
    referent_type: 'non_determine', referent_nom: '', referent_contact: '', actualisation_requise: false,
  });
  const [statuts, setStatuts] = useState({ brsa: '', brsa_date_constat: '', ft_categorie: '', ft_categorie_date: '', france_travail_id: '' });
  const [derog, setDerog] = useState({ motif: '', date: '' });

  /** Recharge le dossier et réinitialise les brouillons depuis le serveur. */
  const appliquer = useCallback((d) => {
    setCadre(d);
    setElig({
      codes: (d.eligibilite?.criteres || []).map((c) => c.code),
      verifiee_le: jourOuVide(d.eligibilite?.verifiee_le),
      source: d.eligibilite?.source || '',
      justificatifs_ref: d.eligibilite?.justificatifs_ref || '',
    });
    setOrient({
      orienteur_type: d.orientation?.orienteur_type || '',
      orienteur_nom: d.orientation?.orienteur_nom || '',
      prescripteur_id: d.orientation?.prescripteur?.id ? String(d.orientation.prescripteur.id) : '',
      date_prescription: jourOuVide(d.orientation?.date_prescription),
      referent_type: d.orientation?.referent_unique?.type || 'non_determine',
      referent_nom: d.orientation?.referent_unique?.nom || '',
      referent_contact: d.orientation?.referent_unique?.contact || '',
      actualisation_requise: !!d.orientation?.actualisation_ft?.requise,
    });
    if (d.statuts) {
      setStatuts({
        brsa: d.statuts.brsa === true ? 'oui' : d.statuts.brsa === false ? 'non' : '',
        brsa_date_constat: jourOuVide(d.statuts.brsa_date_constat),
        ft_categorie: d.statuts.ft_categorie || '',
        ft_categorie_date: jourOuVide(d.statuts.ft_categorie_date),
        france_travail_id: d.statuts.france_travail_id || '',
      });
    }
    setDerog({ motif: d.derogation_cddi?.motif || '', date: jourOuVide(d.derogation_cddi?.date) });
  }, []);

  const charger = useCallback(async () => {
    setChargement(true); setErreur(null);
    try {
      const r = await api.get(`/insertion/cadre/${employeeId}`);
      appliquer(r.data);
    } catch (err) {
      // JAMAIS silencieux : un dossier qui ne se charge pas se voit.
      setErreur(err?.response?.data?.error || err?.message || 'Dossier administratif indisponible.');
    }
    setChargement(false);
  }, [employeeId, appliquer]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    api.get('/insertion/eligibilite-criteres')
      .then((r) => setCriteres(Array.isArray(r.data) ? r.data : []))
      .catch(() => setCriteres([]));
    api.get('/prescripteurs?actif=true')
      .then((r) => setPrescripteurs(Array.isArray(r.data) ? r.data : []))
      .catch(() => setPrescripteurs([]));
  }, []);

  /** Envoie un corps PARTIEL et rafraîchit avec la réponse du serveur. */
  const enregistrer = async (section, corps) => {
    setEnregistre(section); setErreur(null);
    try {
      const r = await api.put(`/insertion/cadre/${employeeId}`, corps);
      appliquer(r.data);
      toast.success('Dossier administratif enregistré.');
      onChanged?.(r.data);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Enregistrement impossible.';
      setErreur(msg);
      toast.error(msg);
    }
    setEnregistre(null);
  };

  const rafraichir = async () => {
    try {
      const r = await api.get(`/insertion/cadre/${employeeId}`);
      appliquer(r.data);
      onChanged?.(r.data);
    } catch (err) {
      setErreur(err?.response?.data?.error || err?.message || 'Rechargement impossible.');
    }
  };

  const copierBloc = async () => {
    const texte = cadre?.bloc_emplois_inclusion || '';
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      setTimeout(() => setCopie(false), 2500);
    } catch (_) {
      // Presse-papiers refusé (contexte non sécurisé, permission) : on le DIT
      // et on laisse le texte sélectionnable — jamais un bouton qui ne fait rien.
      toast.warning('Copie automatique refusée par le navigateur : sélectionnez le texte ci-dessus puis Ctrl+C.');
    }
  };

  const criteresActifs = useMemo(
    () => criteres.filter((c) => c.actif !== false || elig.codes.includes(c.code)),
    [criteres, elig.codes]
  );
  const basculerCritere = (code) => setElig((e) => ({
    ...e, codes: e.codes.includes(code) ? e.codes.filter((c) => c !== code) : [...e.codes, code],
  }));

  const [bilanLoading, setBilanLoading] = useState(false);
  const bilanPassIae = async () => {
    setBilanLoading(true);
    try {
      const r = await api.get(`/insertion/pass-iae/bilan/${employeeId}`, { timeout: 120000 });
      exportBilanProlongationPassIae(r.data);
    } catch (err) {
      toast.error((err?.response?.data?.error || err?.message || 'Erreur') + ' (bilan Pass IAE)');
    }
    setBilanLoading(false);
  };

  if (chargement) return <LoadingSpinner size="lg" message="Chargement du dossier administratif…" />;

  if (!cadre) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-3 text-sm">
        {erreur || 'Dossier administratif indisponible.'}
        <button type="button" onClick={charger} className="ml-3 underline">Réessayer</button>
      </div>
    );
  }

  const referentNonDetermine = orient.referent_type === 'non_determine';
  const projets = cadre.projets || [];

  // Rattachement à un projet cofinancé (PR A) : l'API vit dans routes/insertion/projets.js ;
  // la liste des projets actifs est chargée à la demande, jamais bloquante pour la fiche.
  const rattacherAuProjet = async () => {
    setRattachementEnCours(true);
    try {
      await api.post(`/insertion/projets/${rattachement.projet_id}/participants`, {
        employee_id: Number(employeeId), date_entree: rattachement.date_entree,
      });
      toast.success('Rattachement enregistré');
      setRattachement({ projet_id: '', date_entree: new Date().toISOString().slice(0, 10) });
      await rafraichir();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Rattachement impossible');
    } finally {
      setRattachementEnCours(false);
    }
  };
  const sortirDuProjet = async (p) => {
    try {
      await api.put(`/insertion/projets/${p.id}/participants/${p.participant_id}`, {
        date_sortie: new Date().toISOString().slice(0, 10),
      });
      toast.success('Sortie du projet enregistrée à la date du jour');
      await rafraichir();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Sortie du projet impossible');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
      <div className="space-y-4 min-w-0">
        {erreur && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-3 text-sm">{erreur}</div>
        )}

        {/* ══ Éligibilité IAE ══ */}
        <Section title="Éligibilité IAE" icon={CheckCircle2}
          subtitle="Critères constatés sur les Emplois de l'inclusion — référencés, jamais recopiés">
          {/* Encadrement technique : le serveur ne lui envoie PAS la liste des
              critères (correctif de sécurité du 13/09) — elle porte le RSA, la
              RQTH, l'AAH et le fait d'être sortant de détention. Afficher les
              pastilles toutes décochées se lirait « aucun critère constaté »,
              ce qui serait faux. On dit donc ce qui est vrai : l'éligibilité est
              vérifiée, le détail est réservé. */}
          {!adminRh ? (
            <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 space-y-1">
              <p>
                <span className="font-semibold text-slate-700">
                  {cadre.eligibilite?.nb_criteres > 0
                    ? `${cadre.eligibilite.nb_criteres} critère${cadre.eligibilite.nb_criteres > 1 ? 's' : ''} d'éligibilité constaté${cadre.eligibilite.nb_criteres > 1 ? 's' : ''}`
                    : 'Aucun critère enregistré à ce jour'}
                </span>
                {cadre.eligibilite?.verifiee_le
                  ? ` · vérifiée le ${frDate(cadre.eligibilite.verifiee_le)}`
                  : ' · date de vérification non renseignée'}
                {cadre.eligibilite?.source ? ` · ${SOURCE_OPTIONS.find((o) => o.value === cadre.eligibilite.source)?.label || cadre.eligibilite.source}` : ''}
              </p>
              <p className="text-xs text-slate-500">
                Le détail des critères est réservé aux rôles Administrateur et RH : ce sont des
                statuts sociaux et, pour certains, des données de santé. Vous voyez ici que la
                vérification a bien eu lieu — c&apos;est la pièce du dossier de conformité qui vous concerne.
              </p>
            </div>
          ) : (
          <>
          <div className="flex flex-wrap gap-2">
            {criteresActifs.length === 0 && (
              <p className="text-sm text-slate-500">
                Aucun critère au référentiel. Les critères se gèrent dans <Link to="/admin/insertion" className="underline">Réglages insertion</Link>.
              </p>
            )}
            {criteresActifs.map((c) => {
              const on = elig.codes.includes(c.code);
              return (
                <button key={c.code} type="button" disabled={!adminRh}
                  onClick={() => basculerCritere(c.code)} aria-pressed={on}
                  title={c.libelle}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition ${
                    on ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-primary'
                  } ${adminRh ? '' : 'cursor-default opacity-90'}`}>
                  {on && <Check className="w-3.5 h-3.5" />}{c.libelle}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <FormField label="Date de vérification" name="elig_date" type="date" disabled={!adminRh}
              value={elig.verifiee_le} onChange={(e) => setElig({ ...elig, verifiee_le: e.target.value })} />
            <FormField label="Source" name="elig_source" type="select" disabled={!adminRh}
              placeholder="— à renseigner" value={elig.source} options={SOURCE_OPTIONS}
              onChange={(e) => setElig({ ...elig, source: e.target.value })} />
            <FormField label="Référence des justificatifs (localisation)" name="elig_ref" disabled={!adminRh}
              placeholder="ex. dossier Emplois de l'inclusion n°…"
              value={elig.justificatifs_ref} onChange={(e) => setElig({ ...elig, justificatifs_ref: e.target.value })} />
          </div>

          <p className="text-xs text-slate-500 mt-2">
            Les justificatifs restent sur les Emplois de l&apos;inclusion : l&apos;outil en garde la référence,
            jamais la copie. Rien n&apos;est obligatoire ici pour continuer — le dossier vous dit ce qui
            manque, il ne vous bloque pas.
          </p>
          </>
          )}

          {/* Bloc de report — décision 6 : copier-coller structuré, pas d'API. */}
          {cadre.bloc_emplois_inclusion && (
            <div className="mt-4 rounded-[10px] border border-dashed border-slate-300 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-slate-700">Bloc à coller sur les Emplois de l&apos;inclusion</p>
                <button type="button" onClick={copierBloc} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                  {copie ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copie ? 'Copié' : 'Copier'}
                </button>
              </div>
              {/* `select-all` : si la copie automatique est refusée, un clic
                  sélectionne tout le bloc — le repli reste utilisable. */}
              <p className="text-xs text-slate-600 font-mono break-words select-all">{cadre.bloc_emplois_inclusion}</p>
            </div>
          )}

          {adminRh && (
            <div className="flex justify-end mt-3">
              <button type="button" disabled={enregistre === 'elig'} className="btn-primary text-sm disabled:opacity-50"
                onClick={() => enregistrer('elig', {
                  eligibilite: {
                    criteres: elig.codes,
                    verifiee_le: elig.verifiee_le || null,
                    source: elig.source || null,
                    justificatifs_ref: elig.justificatifs_ref || null,
                  },
                })}>
                {enregistre === 'elig' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          )}
        </Section>

        {/* ══ Pass IAE ══ */}
        <PassIaePanel
          pass={cadre.pass_iae}
          canEdit={adminRh}
          saving={enregistre === 'pass'}
          onSave={(p) => enregistrer('pass', { pass_iae: p })}
          onAddEvenement={async (ev) => {
            const r = await api.post(`/insertion/cadre/${employeeId}/pass-iae/evenements`, ev);
            appliquer(r.data); onChanged?.(r.data);
          }}
          onDeleteEvenement={async (id) => {
            try {
              const r = await api.delete(`/insertion/cadre/${employeeId}/pass-iae/evenements/${id}`);
              appliquer(r.data); onChanged?.(r.data);
            } catch (err) {
              const msg = err?.response?.data?.error || err?.message || 'Suppression impossible.';
              setErreur(msg); toast.error(msg);
            }
          }}
          onBilanPdf={adminRh ? bilanPassIae : null}
          bilanLoading={bilanLoading}
        />

        {/* ══ Orientation et référent unique ══ */}
        <Section title="Orientation et référent unique" icon={Users}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Orienteur" name="orienteur_type" type="select" disabled={!adminRh}
              placeholder="— à renseigner" value={orient.orienteur_type} options={ORIENTEUR_OPTIONS}
              onChange={(e) => setOrient({ ...orient, orienteur_type: e.target.value })} />
            <FormField label="Prescripteur habilité" name="prescripteur_id" type="select" disabled={!adminRh}
              placeholder="— à renseigner" value={orient.prescripteur_id}
              options={prescripteurs.map((p) => ({ value: String(p.id), label: `${p.nom} (type ${p.type})` }))}
              onChange={(e) => setOrient({ ...orient, prescripteur_id: e.target.value })} />
            <FormField label="Nom de l'orienteur" name="orienteur_nom" disabled={!adminRh}
              value={orient.orienteur_nom} onChange={(e) => setOrient({ ...orient, orienteur_nom: e.target.value })} />
            <FormField label="Date de prescription" name="date_prescription" type="date" disabled={!adminRh}
              value={orient.date_prescription} onChange={(e) => setOrient({ ...orient, date_prescription: e.target.value })} />
            <FormField label="Référent unique" name="referent_type" type="select" disabled={!adminRh}
              value={orient.referent_type} options={REFERENT_OPTIONS}
              onChange={(e) => setOrient({ ...orient, referent_type: e.target.value })} />
            <FormField label="Nom du référent" name="referent_nom" disabled={!adminRh}
              value={orient.referent_nom} onChange={(e) => setOrient({ ...orient, referent_nom: e.target.value })} />
            <div className="sm:col-span-2">
              <FormField label="Contact du référent" name="referent_contact" disabled={!adminRh}
                placeholder="téléphone · courriel"
                value={orient.referent_contact} onChange={(e) => setOrient({ ...orient, referent_contact: e.target.value })} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 mt-3">
            <input type="checkbox" className="rounded border-slate-300 w-4 h-4" disabled={!adminRh}
              checked={orient.actualisation_requise}
              onChange={(e) => setOrient({ ...orient, actualisation_requise: e.target.checked })} />
            Actualisation mensuelle France Travail requise
            {orient.referent_type !== 'france_travail' && (
              <span className="text-xs text-slate-500">(le référent n&apos;est pas France Travail)</span>
            )}
          </label>

          {cadre.orientation?.actualisation_ft?.requise && (
            <div className="mt-2 flex items-center gap-3 flex-wrap text-sm">
              <span className="text-slate-600">
                Dernière actualisation : {cadre.orientation.actualisation_ft.derniere_date
                  ? frDate(cadre.orientation.actualisation_ft.derniere_date)
                  : <span className="text-slate-400">jamais enregistrée</span>}
                {cadre.orientation.actualisation_ft.rappels_non_honores > 0
                  && ` · ${cadre.orientation.actualisation_ft.rappels_non_honores} rappel(s) non honoré(s)`}
              </span>
              {adminRh && (
                <button type="button" className="btn-secondary text-xs"
                  onClick={async () => {
                    try {
                      const r = await api.post(`/insertion/cadre/${employeeId}/actualisation-ft`, {});
                      appliquer(r.data); onChanged?.(r.data);
                      toast.success('Actualisation du mois enregistrée.');
                    } catch (err) { toast.error(err?.response?.data?.error || err?.message || 'Erreur'); }
                  }}>
                  Actualisation faite aujourd&apos;hui
                </button>
              )}
            </div>
          )}

          {referentNonDetermine && (
            <p className="text-sm text-red-700 mt-3">
              Référent unique non déterminé : à signaler au Département si la personne est bénéficiaire du RSA.
            </p>
          )}

          {adminRh && (
            <div className="flex justify-end mt-3">
              <button type="button" disabled={enregistre === 'orient'} className="btn-primary text-sm disabled:opacity-50"
                onClick={() => enregistrer('orient', {
                  orientation: {
                    orienteur_type: orient.orienteur_type || null,
                    orienteur_nom: orient.orienteur_nom || null,
                    prescripteur_id: orient.prescripteur_id || null,
                    date_prescription: orient.date_prescription || null,
                    referent_unique: {
                      type: orient.referent_type || 'non_determine',
                      nom: orient.referent_nom || null,
                      contact: orient.referent_contact || null,
                    },
                    actualisation_ft: { requise: orient.actualisation_requise },
                  },
                })}>
                {enregistre === 'orient' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          )}
        </Section>

        {/* ══ Statuts sociaux — ADMIN/RH strict (le serveur ne les renvoie pas aux autres) ══ */}
        {cadre.statuts && (
          <Section title="Statuts" icon={Lock} subtitle="ADMIN / RH">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <FormField label="Bénéficiaire du RSA" name="brsa" type="select" disabled={!adminRh}
                value={statuts.brsa} options={BRSA_OPTIONS}
                hint="« non renseigné » n'est pas « non »."
                onChange={(e) => setStatuts({ ...statuts, brsa: e.target.value })} />
              <FormField label="Date de constat" name="brsa_date" type="date" disabled={!adminRh}
                value={statuts.brsa_date_constat} onChange={(e) => setStatuts({ ...statuts, brsa_date_constat: e.target.value })} />
              <FormField label="Catégorie France Travail" name="ft_cat" type="select" disabled={!adminRh}
                placeholder="— non renseignée" value={statuts.ft_categorie} options={FT_CATEGORIE_OPTIONS}
                onChange={(e) => setStatuts({ ...statuts, ft_categorie: e.target.value })} />
              <FormField label="Date de la catégorie" name="ft_cat_date" type="date" disabled={!adminRh}
                value={statuts.ft_categorie_date} onChange={(e) => setStatuts({ ...statuts, ft_categorie_date: e.target.value })} />
              <FormField label="Identifiant France Travail" name="ft_id" disabled={!adminRh}
                value={statuts.france_travail_id} onChange={(e) => setStatuts({ ...statuts, france_travail_id: e.target.value })} />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">RQTH</span>
                <span className="text-sm text-slate-600 px-3 py-2">
                  {cadre.statuts.rqth === true ? 'oui (diagnostic)'
                    : cadre.statuts.rqth === false ? 'non (diagnostic)'
                      : 'non renseigné'}
                </span>
                <p className="text-xs text-slate-500">Se saisit au diagnostic d&apos;accueil.</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Statuts sociaux : visibles ADMIN/RH uniquement, jamais en lecture encadrant.
            </p>
            {adminRh && (
              <div className="flex justify-end mt-3">
                <button type="button" disabled={enregistre === 'statuts'} className="btn-primary text-sm disabled:opacity-50"
                  onClick={() => enregistrer('statuts', {
                    statuts: {
                      brsa: statuts.brsa === '' ? null : statuts.brsa,
                      brsa_date_constat: statuts.brsa_date_constat || null,
                      ft_categorie: statuts.ft_categorie || null,
                      ft_categorie_date: statuts.ft_categorie_date || null,
                      france_travail_id: statuts.france_travail_id || null,
                    },
                  })}>
                  {enregistre === 'statuts' ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            )}
          </Section>
        )}

        {/* ══ Projets cofinancés — rattachement DATÉ, saisi par la CIP, jamais déduit d'un statut ══ */}
        <Section title="Projets cofinancés" icon={FolderOpen}>
          {projets.length === 0 ? (
            <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-[10px] p-3">
              Aucun rattachement à un projet cofinancé.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                    <th className="py-2 pr-3">Projet cofinancé</th>
                    <th className="py-2 pr-3">Entrée</th>
                    <th className="py-2 pr-3">Sortie</th>
                    {adminRh && <th className="py-2 pr-3"></th>}
                  </tr>
                </thead>
                <tbody>
                  {projets.map((p) => (
                    <tr key={p.participant_id || p.id} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-medium text-slate-700">
                        {p.nom} <span className="text-xs text-slate-400">({PROJET_TYPE_LABELS[p.type] || p.type} · {p.code})</span>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{frDate(p.date_entree)}</td>
                      <td className="py-2 pr-3 text-slate-600">{p.date_sortie ? frDate(p.date_sortie) : <span className="text-slate-400">—</span>}</td>
                      {adminRh && (
                        <td className="py-2 pr-3 text-right">
                          {!p.date_sortie && p.participant_id && (
                            <button type="button" className="btn-ghost text-xs" onClick={() => sortirDuProjet(p)}>
                              Sortie du projet
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {adminRh && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <div className="min-w-[260px] flex-1">
                <label className="label-modern">Rattacher à un projet</label>
                <select className="select-modern" value={rattachement.projet_id} onChange={(e) => setRattachement((r) => ({ ...r, projet_id: e.target.value }))}>
                  <option value="">— choisir un projet actif —</option>
                  {projetsActifs.map((p) => (
                    <option key={p.id} value={p.id}>{p.nom} ({PROJET_TYPE_LABELS[p.type] || p.type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-modern">Date d'entrée dans le projet</label>
                <input type="date" className="input-modern" value={rattachement.date_entree} onChange={(e) => setRattachement((r) => ({ ...r, date_entree: e.target.value }))} />
              </div>
              <button type="button" className="btn-primary text-sm" disabled={!rattachement.projet_id || !rattachement.date_entree || rattachementEnCours} onClick={rattacherAuProjet}>
                <Plus className="w-4 h-4" /> {rattachementEnCours ? 'Rattachement…' : 'Rattacher'}
              </button>
            </div>
          )}
          <p className="text-xs text-slate-500 mt-2">
            Le rattachement est un geste de la CIP, daté, jamais déduit d&apos;un statut social ; les projets eux-mêmes
            (dates, quotités des postes) se gèrent dans <Link to="/admin/insertion" className="underline">Réglages insertion</Link>.
          </p>
        </Section>

        {/* ══ Dérogation CDDI ══ */}
        <Section title="Dérogation CDDI" icon={Info}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <FormField label="Motif de dérogation > 24 mois" name="derog_motif" type="select" disabled={!adminRh}
              placeholder="— aucune" value={derog.motif} options={DEROGATION_OPTIONS}
              onChange={(e) => setDerog({ ...derog, motif: e.target.value })} />
            <FormField label="Date" name="derog_date" type="date" disabled={!adminRh}
              value={derog.date} onChange={(e) => setDerog({ ...derog, date: e.target.value })} />
            <p className="text-xs text-slate-500 pb-2">
              Requis seulement au-delà de 24 mois cumulés de CDDI (L. 5132-15-1).
            </p>
          </div>
          {adminRh && (
            <div className="flex justify-end mt-3">
              <button type="button" disabled={enregistre === 'derog'} className="btn-primary text-sm disabled:opacity-50"
                onClick={() => enregistrer('derog', {
                  derogation_cddi: { motif: derog.motif || null, date: derog.date || null },
                })}>
                {enregistre === 'derog' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          )}
        </Section>

        {/* ══ Pièces (ADMIN/RH — le serveur ne renvoie pas la clé aux autres) ══ */}
        {cadre.pieces && (
          <PiecesPanel employeeId={employeeId} pieces={cadre.pieces} canEdit={adminRh} onChanged={rafraichir} />
        )}
      </div>

      {/* ══ Colonne droite : dossier de conformité (lot 2) ══ */}
      {/* Réservée à ADMIN/RH, comme l'API qui l'alimente : rendue à un
          encadrant technique, elle n'affichait qu'un bandeau d'erreur 403
          dans la colonne de droite (constat m-07). Ne rien montrer vaut mieux
          qu'annoncer une panne là où il n'y a qu'une habilitation. */}
      {adminRh && (
        <div className="xl:sticky xl:top-4">
          {/* Colonne des 9 pièces (lot 2). `refreshKey` : toute écriture du
              dossier peut changer un état (éligibilité, Pass, référent) — sans
              cela la colonne resterait sur son état d'ouverture. */}
          <DossierConformite employeeId={employeeId} refreshKey={cadre} onNaviguer={onNaviguer} />
        </div>
      )}
    </div>
  );
}
