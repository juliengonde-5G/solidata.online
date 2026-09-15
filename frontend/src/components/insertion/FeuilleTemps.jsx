import { useState, useMemo } from 'react';
import {
  Clock, Plus, Trash2, Printer, Download, CheckCircle2, AlertTriangle, Lock, RotateCcw, Info,
} from 'lucide-react';
import api from '../../services/api';
import Section from '../Section';
import Modal from '../Modal';
import { useToast } from '../Toast';
import { exportFeuilleTempsPDF } from './pdf-temps';

/**
 * PR B lot 4 — Feuille de temps mensuelle d'un intervenant (contrat 15 § 9).
 *
 * DEUX FAMILLES DE LIGNES, ET ELLES NE SE RESSEMBLENT PAS À L'ÉCRAN. Les
 * lignes COMPOSÉES (entretiens et actions) sont grisées et non modifiables
 * ici : elles viennent du dossier, et les corriger dans la feuille créerait
 * une seconde vérité. Les SAISIES (atelier collectif, réunion de projet) sont
 * éditables : elles n'existent nulle part ailleurs.
 *
 * UNE ANOMALIE DE COHÉRENCE NE BLOQUE PAS LA SIGNATURE. Elle s'affiche en
 * ambre, avec son détail, et elle s'imprime. C'est la règle du contrat : une
 * feuille bloquée reste non signée, c'est-à-dire une dépense écartée.
 */

const ACTIVITES_SAISIE = [
  { valeur: 'atelier_collectif', libelle: 'Atelier collectif' },
  { valeur: 'reunion_projet', libelle: 'Réunion de projet' },
  { valeur: 'autre', libelle: 'Autre' },
];
const LIBELLES_ACTIVITE = {
  entretien: 'Entretien', action: 'Action',
  atelier_collectif: 'Atelier collectif', reunion_projet: 'Réunion de projet', autre: 'Autre',
};
const DUREES = [15, 30, 45, 60, 90, 120];

const STATUTS = {
  brouillon: { libelle: 'Brouillon', classe: 'bg-slate-100 text-slate-700 border-slate-300' },
  validee_intervenant: { libelle: "Validée par l'intervenant", classe: 'bg-teal-50 text-teal-800 border-teal-300' },
  validee_rh: { libelle: 'Validée par la RH', classe: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
};

const frDate = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '');
const frDateHeure = (v) => (v ? new Date(v).toLocaleString('fr-FR') : '');

/** 195 minutes → « 3 h 15 ». Un décimal (3,25 h) se lit mal sur une feuille. */
function enHeures(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')}`;
}

function telecharger(blob, nom) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

/** Lit le motif d'un refus, y compris quand il arrive en blob (export CSV). */
async function messageErreur(err, defaut) {
  if (err?.response?.data instanceof Blob) {
    try { return JSON.parse(await err.response.data.text()).error || defaut; } catch (_) { /* blob illisible */ }
  }
  return err?.response?.data?.error || err?.message || defaut;
}

export default function FeuilleTemps({ feuille, projets = [], estAdmin, estRh, moiId, onChange }) {
  const toast = useToast();
  const [ajout, setAjout] = useState(false);
  const [reouverture, setReouverture] = useState(false);
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(null);

  const { annee, mois, statut, user_id: userId } = feuille;
  const lignes = useMemo(() => (Array.isArray(feuille.lignes) ? feuille.lignes : []), [feuille]);
  const totaux = feuille.totaux || { total_minutes: 0, par_projet: {}, quotites: {}, taux_forfaitaire: {} };
  const coherence = feuille.coherence || { conforme: true, anomalies: [] };
  const brouillon = statut === 'brouillon';
  const badge = STATUTS[statut] || STATUTS.brouillon;

  const peutValiderIntervenant = brouillon && lignes.length > 0;
  // La contre-signature relève de la RH ET d'une AUTRE personne : deux
  // signatures identiques ne prouvent rien (le serveur le refuse aussi).
  const signataire = feuille.validation_intervenant?.user_id;
  const peutValiderRh = statut === 'validee_intervenant' && (estAdmin || estRh)
    && Number(moiId) !== Number(userId) && Number(signataire) !== Number(moiId);

  const appel = async (action, fn, succes) => {
    setEnCours(action);
    try {
      await fn();
      if (succes) toast.success(succes);
      if (onChange) await onChange();
    } catch (err) {
      toast.error(await messageErreur(err, "L'opération a échoué."));
    }
    setEnCours(null);
  };

  const valider = () => appel('valider',
    () => api.post(`/insertion/temps/${userId}/${annee}/${mois}/valider`),
    brouillon ? 'Feuille validée et figée.' : 'Feuille contre-signée par la RH.');

  const rouvrir = () => appel('rouvrir',
    async () => {
      await api.post(`/insertion/temps/${userId}/${annee}/${mois}/rouvrir`, { motif });
      setReouverture(false); setMotif('');
    }, 'Feuille rouverte — les signatures sont retirées.');

  const supprimer = (id) => appel(`suppr-${id}`,
    () => api.delete(`/insertion/temps/saisies/${id}`), 'Saisie supprimée.');

  const exporterCsv = () => appel('csv', async () => {
    const r = await api.get(`/insertion/temps/${userId}/${annee}/${mois}/export.csv`, { responseType: 'blob' });
    telecharger(r.data, `temps_${annee}-${String(mois).padStart(2, '0')}.csv`);
  }, 'Export téléchargé.');

  // ══ M-05 — l'impression passe par une route DÉDIÉE et JOURNALISÉE ═══════
  // Le PDF est composé ici, à partir d'une réponse du serveur. Tant que cette
  // réponse était celle du GET ordinaire, la feuille sortait sans aucune trace
  // — alors que le CSV, qui porte le même contenu, la même mention « pièce de
  // justification d'une dépense cofinancée » et va au même destinataire, était
  // journalisé. La question « qui a sorti la feuille de septembre ? » n'avait
  // pas de réponse si elle était sortie en PDF.
  const imprimer = () => appel('pdf', async () => {
    const r = await api.get(`/insertion/temps/${userId}/${annee}/${mois}/export.pdf`);
    exportFeuilleTempsPDF({ feuille: r.data, intervenant: r.data.intervenant });
  }, null);

  return (
    <Section
      title={`Feuille de temps — ${String(mois).padStart(2, '0')}/${annee}`}
      subtitle={feuille.intervenant?.nom || null}
      icon={Clock}
      padded={false}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${badge.classe}`}>
            {statut !== 'brouillon' && <Lock className="w-3 h-3" aria-hidden="true" />}
            {badge.libelle}
          </span>
          {brouillon && (
            <button type="button" onClick={() => setAjout(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <Plus className="w-4 h-4" aria-hidden="true" /> Ajouter un temps
            </button>
          )}
          <button type="button" onClick={exporterCsv} disabled={enCours === 'csv'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download className="w-4 h-4" aria-hidden="true" /> {enCours === 'csv' ? 'Export…' : 'Exporter CSV'}
          </button>
          <button type="button" onClick={imprimer} disabled={enCours === 'pdf'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Printer className="w-4 h-4" aria-hidden="true" /> {enCours === 'pdf' ? 'Préparation…' : 'Imprimer'}
          </button>
        </div>
      )}
    >
      {/* Bandeau de clôture — signalement, jamais un blocage. */}
      {feuille.cloture_depassee && (
        <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>
            La clôture de cette feuille était attendue le {frDate(feuille.date_cloture)} : elle n'est pas encore
            contre-signée par la RH.
          </span>
        </div>
      )}

      <div className="overflow-x-auto mt-4">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left font-medium px-4 py-2">Date</th>
              <th className="text-left font-medium px-3 py-2">Projet</th>
              <th className="text-left font-medium px-3 py-2">Activité</th>
              <th className="text-left font-medium px-3 py-2">Bénéficiaire</th>
              <th className="text-right font-medium px-3 py-2">Durée</th>
              <th className="text-left font-medium px-3 py-2">Origine</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lignes.map((l, i) => (
              <tr key={`${l.source}-${l.source_id}-${i}`} className={l.origine === 'composee' ? 'bg-slate-50/60' : ''}>
                <td className="px-4 py-2 whitespace-nowrap">{frDate(l.date)}</td>
                <td className="px-3 py-2">
                  {l.projet_code === 'HORS_PROJET'
                    ? <span className="text-slate-400">Hors projet</span>
                    : <span className="font-medium text-slate-700">{l.projet_code}</span>}
                </td>
                <td className="px-3 py-2">
                  {LIBELLES_ACTIVITE[l.activite] || l.activite}
                  {l.libelle && <div className="text-[11px] text-slate-400">{l.libelle}</div>}
                </td>
                {/* Identifiant interne uniquement : le nom du bénéficiaire
                    n'entre pas dans cette pièce (09 § 2 (c)). */}
                <td className="px-3 py-2 text-slate-500">{l.employee_id == null ? '—' : `#${l.employee_id}`}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.duree_minutes} min</td>
                <td className="px-3 py-2 text-[12px] text-slate-500">
                  {l.origine === 'composee' ? 'Composée automatiquement' : 'Saisie manuelle'}
                </td>
                <td className="px-3 py-2 text-right">
                  {brouillon && l.origine === 'saisie' && (
                    <button type="button" onClick={() => supprimer(l.source_id)} disabled={enCours === `suppr-${l.source_id}`}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      aria-label={`Supprimer la saisie du ${frDate(l.date)}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {lignes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  Aucun temps d'accompagnement sur ce mois.
                  {' '}Un entretien réalisé <strong>sans durée renseignée</strong> ne produit pas de ligne : la durée
                  se saisit à la clôture de l'entretien, elle n'est jamais devinée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pied : totaux, quotités, taux forfaitaire, cohérence, signatures */}
      <div className="border-t border-slate-200 p-5 space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-sm text-slate-500">Total mensuel</span>
          <span className="text-2xl font-bold text-teal-700 tabular-nums">{totaux.total_minutes} min</span>
          <span className="text-sm text-slate-500">soit {enHeures(totaux.total_minutes)}</span>
        </div>

        {Object.keys(totaux.par_projet || {}).length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-left font-medium py-1">Projet</th>
                  <th className="text-right font-medium py-1">Temps</th>
                  <th className="text-left font-medium py-1 pl-6">Quotité d'affectation</th>
                  <th className="text-left font-medium py-1 pl-6">Taux forfaitaire</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(totaux.par_projet).map(([code, minutes]) => (
                  <tr key={code}>
                    <td className="py-1">{code === 'HORS_PROJET' ? 'Hors projet' : code}</td>
                    <td className="py-1 text-right tabular-nums">{minutes} min ({enHeures(minutes)})</td>
                    <td className="py-1 pl-6">
                      {totaux.quotites?.[code] != null
                        ? `${totaux.quotites[code]} %`
                        : <span className="text-slate-400 italic">non renseignée</span>}
                    </td>
                    <td className="py-1 pl-6">
                      {totaux.taux_forfaitaire?.[code] != null
                        ? `${totaux.taux_forfaitaire[code]} %`
                        : <span className="text-slate-400 italic">non renseigné</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Ligne de cohérence — imprimée même quand elle est bonne. */}
        <div className={`rounded-lg border px-3 py-2 text-sm ${coherence.conforme
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <div className="flex items-start gap-2">
            {coherence.conforme
              ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />}
            <div>
              <strong>Cohérence avec les congés : {coherence.conforme ? 'conforme' : 'à expliquer'}</strong>
              {!coherence.conforme && (
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {(coherence.anomalies || []).map((a, i) => (
                    <li key={i}>{a.date ? `${frDate(a.date)} — ` : ''}{a.detail}</li>
                  ))}
                </ul>
              )}
              {!coherence.conforme && (
                <p className="mt-1 text-[12px]">Une anomalie n'empêche pas la signature : elle appelle une explication.</p>
              )}
            </div>
          </div>
        </div>

        <p className="text-[12px] text-slate-500 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
          Durées déclarées par l'intervenant à la clôture des entretiens. Le nom du bénéficiaire ne figure
          ni dans l'export ni sur l'impression : seul son identifiant interne permet le rapprochement.
        </p>

        {/* Signatures */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[['L\'intervenant', feuille.validation_intervenant], ['La RH', feuille.validation_rh]].map(([role, v]) => (
            <div key={role} className="rounded-lg border border-dashed border-slate-300 p-3 text-sm">
              <div className="font-medium text-slate-700">{role}</div>
              {v ? (
                <div className="text-slate-600">
                  {v.nom || `utilisateur #${v.user_id}`}
                  <div className="text-[12px] text-slate-400">signé le {frDateHeure(v.at)}</div>
                </div>
              ) : <div className="text-slate-400">Signature manquante</div>}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {peutValiderIntervenant && (
            <button type="button" onClick={valider} disabled={enCours === 'valider'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Valider (intervenant)
            </button>
          )}
          {statut === 'validee_intervenant' && (
            <button type="button" onClick={valider} disabled={!peutValiderRh || enCours === 'valider'}
              title={peutValiderRh ? undefined : "La contre-signature revient à la RH, et à une autre personne que celle qui a déjà signé."}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Valider (RH)
            </button>
          )}
          {estAdmin && !brouillon && (
            <button type="button" onClick={() => setReouverture(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Rouvrir
            </button>
          )}
        </div>
      </div>

      <AjoutSaisie
        ouvert={ajout} onFermer={() => setAjout(false)}
        userId={userId} annee={annee} mois={mois} projets={projets}
        onAjoute={async () => { setAjout(false); if (onChange) await onChange(); }}
      />

      <Modal isOpen={reouverture} onClose={() => setReouverture(false)} title="Rouvrir la feuille de temps" size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setReouverture(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">Annuler</button>
            <button type="button" onClick={rouvrir} disabled={motif.trim().length < 3 || enCours === 'rouvrir'}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Rouvrir
            </button>
          </div>
        )}>
        <p className="text-sm text-slate-600 mb-3">
          La réouverture <strong>retire les signatures</strong> et remet la feuille au brouillon : un document
          modifié après coup ne peut pas continuer de porter l'accord de ses signataires. Le motif est journalisé.
        </p>
        <label className="block text-xs text-slate-500 mb-1" htmlFor="motif-reouverture">Motif de la réouverture</label>
        <textarea id="motif-reouverture" value={motif} onChange={(e) => setMotif(e.target.value)} rows={3}
          maxLength={500} className="input-modern w-full" placeholder="Ex. : durée d'un entretien corrigée après signature." />
      </Modal>
    </Section>
  );
}

/** Formulaire d'ajout d'un temps hors salarié (atelier, réunion de projet). */
function AjoutSaisie({ ouvert, onFermer, userId, annee, mois, projets, onAjoute }) {
  const toast = useToast();
  const defautDate = `${annee}-${String(mois).padStart(2, '0')}-01`;
  const [date, setDate] = useState(defautDate);
  const [activite, setActivite] = useState('atelier_collectif');
  const [projetId, setProjetId] = useState('');
  const [duree, setDuree] = useState(60);
  const [dureeLibre, setDureeLibre] = useState(false);
  const [libelle, setLibelle] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      await api.post(`/insertion/temps/${userId}/${annee}/${mois}/saisies`, {
        date, activite, projet_id: projetId === '' ? null : parseInt(projetId, 10),
        duree_minutes: duree, libelle: libelle.trim() || null,
      });
      toast.success('Temps ajouté.');
      setLibelle(''); setDuree(60); setDureeLibre(false);
      await onAjoute();
    } catch (err) {
      toast.error(await messageErreur(err, "L'ajout a échoué."));
    }
    setEnvoi(false);
  };

  const valide = Number.isFinite(Number(duree)) && Number(duree) >= 1 && Number(duree) <= 600 && !!date;

  return (
    <Modal isOpen={ouvert} onClose={onFermer} title="Ajouter un temps d'accompagnement" size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFermer} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">Annuler</button>
          <button type="button" onClick={enregistrer} disabled={!valide || envoi}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {envoi ? 'Enregistrement…' : 'Ajouter'}
          </button>
        </div>
      )}>
      <p className="text-sm text-slate-600 mb-4">
        Ce formulaire sert au temps qui ne passe par <strong>aucun salarié nommé</strong> : atelier collectif,
        réunion de projet. Les entretiens et les actions arrivent seuls dans la feuille, avec la durée saisie
        à leur clôture.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1" htmlFor="saisie-date">Date</label>
          <input id="saisie-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            min={defautDate} className="input-modern w-full py-1.5" />
          <p className="text-[11px] text-slate-400 mt-1">La date doit appartenir au mois de la feuille.</p>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1" htmlFor="saisie-activite">Activité</label>
          <select id="saisie-activite" value={activite} onChange={(e) => setActivite(e.target.value)} className="input-modern w-full py-1.5">
            {ACTIVITES_SAISIE.map((a) => <option key={a.valeur} value={a.valeur}>{a.libelle}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1" htmlFor="saisie-projet">Projet</label>
          <select id="saisie-projet" value={projetId} onChange={(e) => setProjetId(e.target.value)} className="input-modern w-full py-1.5">
            <option value="">Hors projet</option>
            {projets.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nom}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Durée</label>
          <div className="flex flex-wrap gap-1.5 items-center">
            {DUREES.map((v) => {
              const actif = !dureeLibre && Number(duree) === v;
              return (
                <button key={v} type="button" onClick={() => { setDuree(v); setDureeLibre(false); }}
                  className={`px-3 py-1.5 rounded-lg border text-sm ${actif ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-teal-400'}`}>
                  {v} min
                </button>
              );
            })}
            <button type="button" onClick={() => setDureeLibre((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-sm ${dureeLibre ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-300 text-slate-600'}`}>
              autre
            </button>
            {dureeLibre && (
              <input type="number" min="1" max="600" value={duree}
                onChange={(e) => setDuree(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                className="input-modern py-1 w-24 text-sm" aria-label="Durée en minutes" />
            )}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-slate-500 mb-1" htmlFor="saisie-libelle">Intitulé (facultatif)</label>
          <input id="saisie-libelle" type="text" value={libelle} maxLength={200}
            onChange={(e) => setLibelle(e.target.value)} className="input-modern w-full py-1.5"
            placeholder="Ex. : atelier mobilité — 6 participants" />
        </div>
      </div>
    </Modal>
  );
}
