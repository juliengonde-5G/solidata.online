import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { LoadingSpinner, Modal } from '../index';
import { frDate, isAdminRh } from './freins';
import { TYPE_LABELS_RSA } from './entretiens-rsa';
import QuickActionButton from './QuickActionButton';
import { formatEmployeeName } from '../../utils/names';

/**
 * « Mes échéances » — l'écran d'accueil de l'espace CIP (PR C lot 5).
 *
 * ═══ CE QUE CET ÉCRAN REMPLACE, ET POURQUOI ═══════════════════════════════
 *
 * Le tableau de bord précédent était organisé par ENDROIT où la donnée est
 * rangée. Celui-ci l'est par ce que la conseillère doit faire AUJOURD'HUI, et
 * il tient une distinction que l'outil ne faisait pas :
 *
 *   - une OBLIGATION est une ligne que l'autorité de tutelle contrôle. Elle ne
 *     s'acquitte pas sept jours comme une alerte de fiche : elle se REPORTE de
 *     48 h, et au deuxième report il faut dire pourquoi (liste fermée). Le
 *     report laisse une trace — c'est le nombre de reports qui dit qu'un
 *     dossier tourne en rond ;
 *   - l'ORGANISATION DU SUIVI (bilans en retard, rendez-vous non planifié,
 *     renouvellements, actions critiques) reste du travail à faire. Elle
 *     s'acquitte, elle ne se reporte pas.
 *
 * ═══ ORDRE DES BLOCS ══════════════════════════════════════════════════════
 * Aujourd'hui / Cette semaine → obligations → organisation → rendez-vous
 * réguliers → ma file active (amendement CIP § 10, validé par le persona).
 * **Un bloc vide reste affiché**, avec une phrase verte : disparaître ferait
 * douter — « est-ce qu'il n'y a rien, ou est-ce que ça n'a pas chargé ? ».
 */

const IA_TIMEOUT = 120000;

function formatIaError(err, fallback = 'Erreur analyse IA') {
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
    return "L'analyse IA a dépassé le délai d'attente (le modèle met parfois 1 à 2 min). Réessayez.";
  }
  if (err.response?.status === 503) return err.response?.data?.error || 'Service IA non configuré (clé Anthropic absente).';
  const d = err.response?.data;
  return (d?.error || err.message || fallback) + (d?.hint ? ' — ' + d.hint : (d?.detail ? ' — ' + d.detail : ''));
}

const heureRdv = (d) => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null);

/** Phrase d'un bloc sans rien à traiter — verte, jamais un vide muet. */
const RienAFaire = ({ children }) => (
  <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
    {children}
  </p>
);

function DashCard({ label, value, tone, sub }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone] || tones.slate}`}>
      <div className="text-2xl font-bold leading-none">{value ?? '—'}</div>
      <div className="text-xs mt-1 font-medium">{label}</div>
      {sub && <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function ObjectifBar({ realise, objectif }) {
  if (objectif == null) {
    return <p className="text-xs text-gray-400">Objectif conventionné non paramétré — aucun écart ne peut être affiché.</p>;
  }
  const r = realise == null ? 0 : realise;
  const atteint = r >= objectif;
  return (
    <div>
      <div className="relative w-full bg-gray-200 rounded-full h-3">
        <div className={`h-3 rounded-full ${atteint ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, r)}%` }} />
        <div className="absolute top-[-3px] h-[18px] w-0.5 bg-slate-700" style={{ left: `${Math.min(100, objectif)}%` }} title={`Objectif : ${objectif} %`} />
      </div>
      <p className="text-[11px] text-gray-500 mt-1">
        {realise == null ? 'Aucune sortie enregistrée cette année' : `${realise} % réalisé`} · objectif {objectif} %
      </p>
    </div>
  );
}

function IaPretBadge({ ready }) {
  if (!ready) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 whitespace-nowrap"
      title="Une note de préparation IA a déjà été générée pour cet entretien">
      Préparation IA prête
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Aujourd'hui / Cette semaine
// ═══════════════════════════════════════════════════════════════════════════
function AgendaBloc({ stats, onSelect }) {
  if (!stats) return null;
  const today = (stats.agenda_30j || []).filter((j) => j.days_until === 0);
  const week = (stats.agenda_30j || []).filter((j) => j.days_until > 0 && j.days_until <= 7);
  const retardsParSalarie = new Map();
  for (const j of stats.jalons_en_retard || []) {
    const cur = retardsParSalarie.get(j.employee_id)
      || { id: j.employee_id, nom: formatEmployeeName(j.last_name, j.first_name), items: [] };
    cur.items.push(j);
    retardsParSalarie.set(j.employee_id, cur);
  }
  const retards = [...retardsParSalarie.values()];

  return (
    <section className="bg-white rounded-lg border p-4 space-y-3">
      <h3 className="font-semibold text-gray-800">Aujourd'hui / Cette semaine</h3>

      {retards.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-red-700">À traiter en priorité (en retard)</p>
          {retards.slice(0, 6).map((r) => (
            <button key={r.id} onClick={() => onSelect(r.id)}
              className="w-full text-left flex items-center justify-between gap-2 p-2 rounded bg-red-50 hover:bg-red-100 text-sm border border-red-100">
              <span className="font-medium text-red-800">{r.nom}</span>
              <span className="flex items-center gap-1 flex-wrap justify-end">
                {r.items.slice(0, 3).map((it) => (
                  <span key={it.id} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-red-200 text-red-700">
                    {TYPE_LABELS_RSA[it.milestone_type] || it.milestone_type} · {Math.abs(it.days_until)} j
                  </span>
                ))}
                {r.items.length > 3 && <span className="text-[10px] text-red-600">+{r.items.length - 3}</span>}
              </span>
            </button>
          ))}
          {retards.length > 6 && <p className="text-[11px] text-gray-400">… et {retards.length - 6} autre(s) salarié(s).</p>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold text-teal-700 mb-1">Aujourd'hui ({today.length})</p>
          {today.length ? today.map((j) => (
            <button key={j.id} onClick={() => onSelect(j.employee_id)}
              className="w-full text-left flex items-center justify-between gap-2 p-2 rounded hover:bg-teal-50 text-sm">
              <span className="truncate">{formatEmployeeName(j.last_name, j.first_name)} — <span className="text-gray-500">{j.titre || TYPE_LABELS_RSA[j.milestone_type] || j.milestone_type}</span></span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <IaPretBadge ready={j.ia_preparation_ready} />
                <span className="text-xs text-teal-700 font-medium">{heureRdv(j.interview_date) || "aujourd'hui"}</span>
              </span>
            </button>
          )) : <p className="text-xs text-gray-400 py-1">Aucun entretien aujourd'hui.</p>}
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-1">Cette semaine ({week.length})</p>
          {week.length ? week.map((j) => (
            <button key={j.id} onClick={() => onSelect(j.employee_id)}
              className="w-full text-left flex items-center justify-between gap-2 p-2 rounded hover:bg-slate-50 text-sm">
              <span className="truncate">{formatEmployeeName(j.last_name, j.first_name)} — <span className="text-gray-500">{j.titre || TYPE_LABELS_RSA[j.milestone_type] || j.milestone_type}</span></span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <IaPretBadge ready={j.ia_preparation_ready} />
                <span className="text-xs text-slate-500 font-medium">
                  J-{j.days_until} · {frDate(j.due_date)}{heureRdv(j.interview_date) ? ` · ${heureRdv(j.interview_date)}` : ''}
                </span>
              </span>
            </button>
          )) : <p className="text-xs text-gray-400 py-1">Rien de planifié cette semaine.</p>}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. À traiter cette semaine — obligations
// ═══════════════════════════════════════════════════════════════════════════
const MOTIFS_REPORT = [
  ['attente_piece', "J'attends une pièce du salarié"],
  ['attente_referent', "J'attends une réponse du référent ou d'un partenaire"],
  ['personne_absente', 'La personne est absente ou injoignable'],
  ['rdv_planifie', 'Un rendez-vous est déjà pris pour le traiter'],
  ['autre', 'Autre raison'],
];

function ObligationsBloc({ donnees, onSelect, onReport, canReport }) {
  const [aReporter, setAReporter] = useState(null); // obligation en attente de motif
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(null);
  const [erreur, setErreur] = useState(null);

  const obligations = donnees.obligations || [];
  const reportees = donnees.reportees || [];

  const reporter = async (o, motifChoisi = null) => {
    setBusy(o.id); setErreur(null);
    try {
      await onReport(o, motifChoisi);
      setAReporter(null); setMotif('');
    } catch (err) {
      const d = err.response?.data;
      if (d?.code === 'MOTIF_REQUIS') { setAReporter(o); setErreur(null); }
      else setErreur(d?.error || err.message);
    }
    setBusy(null);
  };

  const Ligne = ({ o, grisee }) => (
    <div className={`flex items-start justify-between gap-2 p-2 rounded border flex-wrap ${
      grisee ? 'border-gray-100 bg-gray-50/60 opacity-75'
        : o.niveau === 'rouge' ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/40'
    }`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${grisee ? 'bg-gray-400' : o.niveau === 'rouge' ? 'bg-red-500' : 'bg-amber-500'}`} />
          {o.employee_id ? (
            <button onClick={() => onSelect(o.employee_id, o.cible)}
              className="font-medium text-gray-800 hover:underline text-sm text-left">{o.nom}</button>
          ) : (
            <span className="font-medium text-gray-800 text-sm">{donnees.libelle_agrege || 'Ensemble de la file'}</span>
          )}
          <span className="text-sm text-gray-600">— {o.libelle}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-0.5 ml-4">
          {o.echeance && <span className="text-[11px] text-gray-400">échéance {frDate(o.echeance)}</span>}
          {o.nb_reports > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700"
              title="Nombre de fois où cette obligation a été reportée">
              reportée {o.nb_reports} fois
            </span>
          )}
          {grisee && o.reporte_jusqu_au && (
            <span className="text-[11px] text-gray-500">revient le {frDate(o.reporte_jusqu_au)}</span>
          )}
          {/* La ligne agrégée porte ses personnes à part : la CIP doit pouvoir
              agir, mais l'écran ne met personne en tête d'affiche pour une
              activité basse. */}
          {o.detail?.length > 0 && (
            <span className="text-[11px] text-gray-500">
              {o.detail.slice(0, 4).map((d) => (
                <button key={d.employee_id} onClick={() => onSelect(d.employee_id, o.cible)}
                  className="underline hover:text-gray-700 mr-2">{d.nom}</button>
              ))}
              {o.detail.length > 4 && `+${o.detail.length - 4}`}
            </span>
          )}
        </div>
      </div>
      {!grisee && canReport && o.employee_id && (
        <button onClick={() => (o.nb_reports >= 1 ? setAReporter(o) : reporter(o))}
          disabled={busy === o.id}
          title="Cette ligne n'est pas acquittable : elle peut seulement être repoussée de 48 heures, et le report est tracé."
          className="px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-white whitespace-nowrap disabled:opacity-50">
          {busy === o.id ? '…' : 'Reporter 48 h'}
        </button>
      )}
    </div>
  );

  return (
    <section className="bg-white rounded-lg border p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-gray-800">À traiter cette semaine — obligations</h3>
        <span className="text-[11px] text-gray-400">
          Lignes contrôlées par l'autorité : reportables 48 h, jamais acquittables.
        </span>
      </div>
      {erreur && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{erreur}</div>}

      {obligations.length === 0
        ? <RienAFaire>Rien à traiter cette semaine.</RienAFaire>
        : <div className="space-y-1.5">{obligations.map((o) => <Ligne key={o.id} o={o} />)}</div>}

      {reportees.length > 0 && (
        <details className="pt-1">
          <summary className="cursor-pointer select-none text-xs text-gray-500 hover:text-gray-700">
            {reportees.length} obligation(s) reportée(s)
          </summary>
          <div className="space-y-1.5 mt-2">{reportees.map((o) => <Ligne key={o.id} o={o} grisee />)}</div>
        </details>
      )}

      <Modal isOpen={!!aReporter} onClose={() => { setAReporter(null); setMotif(''); }}
        title="Reporter à nouveau — pourquoi ?" size="sm"
        footer={(
          <>
            <button onClick={() => { setAReporter(null); setMotif(''); }} className="px-4 py-2 text-sm text-slate-600">Annuler</button>
            <button onClick={() => reporter(aReporter, motif)} disabled={!motif || busy}
              className="px-4 py-2 rounded-[10px] bg-teal-600 text-white text-sm font-medium disabled:opacity-50">
              Reporter 48 h
            </button>
          </>
        )}>
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            Cette obligation a déjà été reportée. Indiquez ce qui la bloque : c'est ce motif qui
            permettra de dire, plus tard, pourquoi le dossier a attendu.
          </p>
          <div className="space-y-1">
            {MOTIFS_REPORT.map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm p-2 rounded border cursor-pointer hover:bg-slate-50">
                <input type="radio" name="motif-report" value={v} checked={motif === v} onChange={() => setMotif(v)} />
                {l}
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Organisation du suivi
// ═══════════════════════════════════════════════════════════════════════════
function OrganisationBloc({ items, onSelect, onCreerEntretien, onLienEti }) {
  const [busy, setBusy] = useState(null);
  const [copie, setCopie] = useState(null);
  const [erreur, setErreur] = useState(null);

  const copier = async (o) => {
    setBusy(o.id); setErreur(null);
    try {
      const url = o.lien_eti || await onLienEti(o);
      try {
        await navigator.clipboard.writeText(url);
        setCopie(o.id);
        setTimeout(() => setCopie((c) => (c === o.id ? null : c)), 2500);
      } catch {
        // Presse-papiers refusé : on ne perd pas le lien, on le montre.
        setErreur(`Copie automatique impossible — le lien est : ${url}`);
      }
    } catch (err) {
      setErreur(err.response?.data?.error || err.message);
    }
    setBusy(null);
  };

  return (
    <section className="bg-white rounded-lg border p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-gray-800">Organisation du suivi</h3>
        <span className="text-[11px] text-gray-400">Bilans, rendez-vous, renouvellements, actions critiques.</span>
      </div>
      {erreur && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 break-all">{erreur}</div>}

      {items.length === 0 ? (
        <RienAFaire>Le suivi est à jour : aucun bilan en retard, aucun rendez-vous à poser.</RienAFaire>
      ) : (
        <div className="space-y-1.5">
          {items.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 p-2 rounded border border-gray-100 hover:bg-gray-50/60 flex-wrap">
              <div className="min-w-0">
                <button onClick={() => onSelect(o.employee_id, o.cible)} className="text-left text-sm">
                  <span className="font-medium text-gray-800">{o.nom}</span>
                  <span className="text-xs text-gray-500 ml-2">{o.libelle}</span>
                </button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {o.sous_type === 'renouvellement' && o.a_creer && (
                  <button onClick={() => onCreerEntretien(o)}
                    className="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700">
                    Créer l'entretien
                  </button>
                )}
                {o.sous_type === 'renouvellement' && !o.a_creer && !o.verrouille && (
                  <>
                    {o.formulaire_rempli && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">
                        Avis encadrant reçu
                      </span>
                    )}
                    <button onClick={() => copier(o)} disabled={busy === o.id}
                      title="Lien PUBLIC à envoyer à l'encadrant technique : il s'ouvre sans compte."
                      className="px-2 py-1 rounded-lg border border-teal-300 text-teal-700 text-xs hover:bg-teal-50 whitespace-nowrap disabled:opacity-50">
                      {busy === o.id ? '…' : copie === o.id ? '✓ Lien copié' : o.lien_eti ? 'Copier le lien encadrant' : 'Créer le lien encadrant'}
                    </button>
                    {o.eti_expire_le && <span className="text-[10px] text-gray-400">expire le {frDate(o.eti_expire_le)}</span>}
                  </>
                )}
                {o.sous_type === 'renouvellement' && o.verrouille && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-white">🔒 clôturé</span>
                )}
                {o.echeance && <span className={`text-xs font-medium ${o.niveau === 'rouge' ? 'text-red-600' : 'text-amber-700'}`}>{frDate(o.echeance)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Rendez-vous réguliers et rappels (cadre RSA, PR B — alimenté par la
//    réponse de /echeances : un bloc de plus ne doit pas coûter un appel de
//    plus au chargement du lundi matin)
// ═══════════════════════════════════════════════════════════════════════════
function RendezVousRegulersBloc({ data, onSelect }) {
  if (!data) return null; // MANAGER : ADMIN/RH strict, on ne montre rien plutôt qu'une panne

  const aFaire = (data.actualisations_ft_du_mois || []).filter((a) => a.honoree !== true);
  const points = data.points_referent_dus || [];
  const sousSeuil = data.semaines_sous_seuil || { nb_salaries: 0, employes: [] };
  const sansReferent = data.referents_non_determines || [];
  const rien = aFaire.length === 0 && points.length === 0 && sousSeuil.nb_salaries === 0 && sansReferent.length === 0;

  const Personne = ({ p, suffixe, ton }) => (
    <button type="button" onClick={() => onSelect?.(p.employee_id)}
      className={`text-left w-full px-2 py-1 rounded hover:bg-gray-50 text-sm ${ton || 'text-gray-700'}`}>
      <span className="font-medium">{p.nom}</span>
      {suffixe && <span className="text-gray-500"> — {suffixe}</span>}
    </button>
  );

  return (
    <section className="bg-white rounded-lg border p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <h3 className="font-semibold text-gray-800">Rendez-vous réguliers et rappels</h3>
        <span className="text-xs text-gray-400">
          Déclaration trimestrielle de ressources — {data.dtr?.trimestre}, échéance {frDate(data.dtr?.echeance)}
        </span>
      </div>

      {rien && <RienAFaire>Rien à rappeler cette semaine.</RienAFaire>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {aFaire.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Actualisation France Travail du mois ({aFaire.length})
            </h4>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {aFaire.map((a) => (
                <Personne key={a.employee_id} p={a}
                  ton={a.honoree === false ? 'text-amber-800' : undefined}
                  suffixe={a.honoree === false ? 'non faite'
                    : a.rappel_le ? `rappelée le ${frDate(a.rappel_le)}` : 'aucun rappel'} />
              ))}
            </div>
          </div>
        )}

        {points.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Point avec le référent à prévoir ({points.length})
            </h4>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {points.map((p) => (
                <Personne key={p.employee_id} p={p}
                  suffixe={p.dernier_le ? `dernier contact il y a ${p.du_depuis_jours} j` : 'jamais de contact tracé'} />
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Attendu tous les {data.periodicite_point_referent_mois} mois — un point tenu ou une fiche remise.
            </p>
          </div>
        )}

        {sousSeuil.nb_salaries > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Activité en dessous de 15 h par semaine ({sousSeuil.nb_salaries} salarié{sousSeuil.nb_salaries > 1 ? 's' : ''})
            </h4>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {sousSeuil.employes.map((e) => (
                <Personne key={e.employee_id} p={e} ton="text-amber-800"
                  suffixe={`${e.nb_semaines} semaine${e.nb_semaines > 1 ? 's' : ''} relevée${e.nb_semaines > 1 ? 's' : ''} basse${e.nb_semaines > 1 ? 's' : ''}`} />
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Hors périodes d&apos;arrêt déclaré ; les semaines dont les heures ne sont pas encore relevées ne comptent pas.
            </p>
          </div>
        )}

        {sansReferent.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-red-700 uppercase tracking-wide mb-1">
              Référent unique non déterminé ({sansReferent.length})
            </h4>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {sansReferent.map((r) => (
                <Personne key={r.employee_id} p={r} ton="text-red-700" suffixe="aucune fiche ne peut être transmise" />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Ma file active (KPI + jauge + barre d'outils)
// ═══════════════════════════════════════════════════════════════════════════
function FileActiveBloc({ kpi, annee, onSelect, salariesARisque }) {
  const { user } = useAuth();
  const canExport = isAdminRh(user);
  const [objEditing, setObjEditing] = useState(false);
  const [objInput, setObjInput] = useState('');
  const [objSaving, setObjSaving] = useState(false);
  const [objError, setObjError] = useState(null);
  const [ia, setIa] = useState(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportChoice, setExportChoice] = useState('xlsx');
  const now = new Date();
  const [fseAnnee, setFseAnnee] = useState(now.getFullYear());
  const [fseTrim, setFseTrim] = useState(Math.ceil((now.getMonth() + 1) / 3));
  const [fseExporting, setFseExporting] = useState(false);
  const [fseError, setFseError] = useState(null);
  const [objectif, setObjectif] = useState(kpi.objectif_sorties);

  useEffect(() => { setObjectif(kpi.objectif_sorties); }, [kpi.objectif_sorties]);

  const telecharger = async (url, filename, setBusy, setErr, message) => {
    setBusy(true); setErr(null);
    try {
      const res = await api.get(url, { responseType: 'blob', timeout: IA_TIMEOUT });
      const objUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = objUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      let msg = message;
      try { const txt = await err.response?.data?.text?.(); if (txt) msg = JSON.parse(txt).error || msg; } catch { /* message générique */ }
      setErr(msg);
    } finally { setBusy(false); }
  };

  const saveObjectif = async () => {
    setObjSaving(true); setObjError(null);
    try {
      const val = objInput.trim() === '' ? null : parseFloat(objInput);
      await api.put('/insertion/objectif-sorties', { objectif: val });
      setObjectif(val);
      setObjEditing(false);
    } catch (err) {
      setObjError(err.response?.data?.error || err.message || "Erreur d'enregistrement");
    }
    setObjSaving(false);
  };

  const runIaCohorte = async () => {
    setIaLoading(true); setIaError(null);
    try {
      const r = await api.get('/insertion/ia/cohorte', { timeout: IA_TIMEOUT });
      setIa(r.data);
    } catch (err) {
      setIaError(formatIaError(err, 'Erreur analyse IA de cohorte'));
    }
    setIaLoading(false);
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <section className="bg-white rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-gray-800">Ma file active</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <QuickActionButton className="!py-1.5 !text-xs" />
          {canExport && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <select value={exportChoice} onChange={(e) => setExportChoice(e.target.value)}
                title="Choisir le contenu et le format de l'export"
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700">
                <option value="xlsx">Excel — tout (5 feuilles)</option>
                <option value="salaries">CSV — Salariés</option>
                <option value="diagnostics">CSV — Diagnostics CIP</option>
                <option value="jalons">CSV — Entretiens</option>
                <option value="actions">CSV — Plans d'action</option>
              </select>
              <button onClick={() => telecharger(
                exportChoice === 'xlsx' ? '/exports/insertion' : `/exports/insertion?format=csv&dataset=${exportChoice}`,
                exportChoice === 'xlsx' ? `insertion_complet_${stamp}.xlsx` : `insertion_${exportChoice}_${stamp}.csv`,
                setExporting, setExportError, "Erreur lors de l'export des données d'insertion.",
              )} disabled={exporting}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                {exporting ? 'Export…' : 'Exporter'}
              </button>
              <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden="true" />
              <select value={fseAnnee} onChange={(e) => setFseAnnee(Number(e.target.value))}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700">
                {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={fseTrim} onChange={(e) => setFseTrim(Number(e.target.value))}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700">
                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t}</option>)}
              </select>
              <button onClick={() => telecharger(
                `/exports/fse-plus?annee=${fseAnnee}&trimestre=${fseTrim}`,
                `fse-plus_${fseAnnee}_T${fseTrim}.csv`, setFseExporting, setFseError, "Erreur lors de l'export FSE+.",
              )} disabled={fseExporting}
                title="Export réglementaire FSE+ (bénéficiaires CDDI du trimestre)"
                className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50">
                {fseExporting ? 'Export…' : 'Export FSE+'}
              </button>
              <button onClick={runIaCohorte} disabled={iaLoading}
                className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
                {iaLoading ? 'Analyse IA…' : 'Analyser la cohorte (IA)'}
              </button>
            </div>
          )}
        </div>
      </div>

      {exportError && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{exportError}</div>}
      {fseError && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{fseError}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <DashCard label="En parcours" value={kpi.en_parcours} tone="blue" />
        <DashCard label="Entretiens en retard" value={kpi.retards} tone={kpi.retards ? 'red' : 'green'} />
        <DashCard label="À venir (7 j)" value={kpi.a_venir_7j} tone={kpi.a_venir_7j ? 'amber' : 'slate'} />
        <DashCard label={`Sorties dynamiques ${annee}`}
          value={kpi.sorties_dynamiques_pct != null ? `${kpi.sorties_dynamiques_pct} %` : '—'}
          tone="green"
          sub={kpi.sorties ? `${kpi.sorties.dynamiques}/${kpi.sorties.total} sorties` : null} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Sorties dynamiques — réalisé vs objectif conventionné</span>
            {canExport && !objEditing && (
              <button onClick={() => { setObjEditing(true); setObjError(null); setObjInput(objectif != null ? String(objectif) : ''); }}
                className="text-xs text-teal-700 hover:underline">
                {objectif != null ? "Modifier l'objectif" : "Définir l'objectif"}
              </button>
            )}
          </div>
          {objEditing ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input type="number" min="0" max="100" step="1" value={objInput} onChange={(e) => setObjInput(e.target.value)}
                placeholder="% cible" className="input-modern py-1 w-28" />
              <button onClick={saveObjectif} disabled={objSaving} className="px-2 py-1 rounded bg-teal-600 text-white text-xs disabled:opacity-50">{objSaving ? '…' : 'Enregistrer'}</button>
              <button onClick={() => { setObjEditing(false); setObjError(null); }} className="px-2 py-1 text-xs text-gray-500">Annuler</button>
              {objError && <span className="text-xs text-red-600 w-full">{objError}</span>}
            </div>
          ) : (
            <ObjectifBar realise={kpi.sorties_dynamiques_pct} objectif={objectif} />
          )}
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <span className="text-xs font-semibold text-slate-600">Dossiers du projet ASI — questionnaire d'entrée</span>
          {kpi.completude_fse_asi_pct == null ? (
            <p className="text-xs text-gray-400 mt-1.5">
              Aucun participant rattaché à une opération cofinancée — rien à mesurer.
            </p>
          ) : (
            <>
              <div className="w-full bg-gray-200 rounded-full h-3 mt-2">
                <div className={`h-3 rounded-full ${kpi.completude_fse_asi_pct >= 90 ? 'bg-emerald-500' : kpi.completude_fse_asi_pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${kpi.completude_fse_asi_pct}%` }} />
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {kpi.completude_fse_asi_pct} % des participants ont leur questionnaire d'entrée complet.
                {' '}<Link to="/insertion/conformite" className="text-teal-700 underline">Voir les dossiers FSE+</Link>
              </p>
            </>
          )}
        </div>
      </div>

      {salariesARisque > 0 && (
        <p className="text-xs text-gray-500">
          {salariesARisque} salarié(s) portent au moins une obligation en rouge — ils sont signalés dans la file, à gauche.
        </p>
      )}

      {iaError && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{iaError}</div>}
      {ia && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-2">
          {ia.synthese && <p className="text-sm text-slate-700">{ia.synthese}</p>}
          {ia.alertes?.length > 0 && (
            <div className="text-xs text-red-700"><span className="font-semibold">Alertes :</span> {ia.alertes.join(' · ')}</div>
          )}
          {ia.recommandations_cip?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-violet-700 mb-1">Recommandations CIP</p>
              <ul className="list-disc list-inside text-xs text-slate-700 space-y-0.5">
                {ia.recommandations_cip.map((r, i) => <li key={i}>{typeof r === 'string' ? r : (r.action || JSON.stringify(r))}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Panneau complet
// ═══════════════════════════════════════════════════════════════════════════
export default function EcheancesPanel({ onSelect, mine, onMineChange }) {
  const { user } = useAuth();
  // Reporter une obligation est un acte de la CIP : le serveur le refuse en 403
  // à un MANAGER. Lui montrer le bouton serait lui promettre un geste qui
  // échouera — on ne le rend donc pas.
  const peutReporter = isAdminRh(user);
  const [donnees, setDonnees] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(() => {
    let vivant = true;
    setLoading(true);
    const q = mine ? '?mine=1' : '';
    Promise.all([
      api.get(`/insertion/echeances${q}`),
      api.get(`/insertion/cohorte/stats${q}`).catch(() => ({ data: null })),
    ])
      .then(([e, s]) => { if (vivant) { setDonnees(e.data); setStats(s.data); setErreur(null); } })
      .catch((err) => { if (vivant) setErreur(err.response?.data?.error || err.message); })
      .finally(() => { if (vivant) setLoading(false); });
    return () => { vivant = false; };
  }, [mine]);

  useEffect(() => charger(), [charger]);

  const reporter = useCallback(async (o, motif) => {
    await api.post('/insertion/echeances/report', {
      employee_id: o.employee_id, type: o.type, ...(motif ? { motif } : {}),
    });
    charger();
  }, [charger]);

  const creerEntretien = useCallback(async (o) => {
    // Échéance proposée : 14 j avant la fin du contrat, jamais dans le passé.
    const fin = o.echeance ? new Date(o.echeance) : new Date();
    fin.setDate(fin.getDate() - 14);
    const due = (fin > new Date() ? fin : new Date()).toISOString().slice(0, 10);
    await api.post('/insertion/milestones', {
      employee_id: o.employee_id, milestone_type: 'renouvellement', due_date: due,
    });
    charger();
  }, [charger]);

  const lienEti = useCallback(async (o) => {
    if (!o.milestone_id) throw new Error("L'entretien de renouvellement n'existe pas encore — créez-le d'abord.");
    const r = await api.post(`/insertion/renouvellements/${o.milestone_id}/lien-eti`);
    charger();
    return r.data.lien;
  }, [charger]);

  const annee = useMemo(() => (stats?.annee || new Date().getFullYear()), [stats]);

  if (loading && !donnees) return <LoadingSpinner size="lg" message="Chargement de vos échéances..." />;
  if (erreur && !donnees) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <div className="text-red-600 text-sm p-3 bg-red-50 rounded border border-red-200">
          Impossible de charger vos échéances : {erreur}
          <button onClick={charger} className="ml-2 underline">Réessayer</button>
        </div>
      </div>
    );
  }
  if (!donnees) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-800">Mes échéances</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none"
            title="N'afficher que les salariés dont je suis le CIP référent">
            <input type="checkbox" checked={!!mine} onChange={(e) => onMineChange?.(e.target.checked)} className="rounded border-gray-300" />
            Mes salariés
          </label>
          <button onClick={charger} className="text-xs text-teal-700 hover:underline">Actualiser</button>
        </div>
      </div>

      {donnees.sources_indisponibles?.length > 0 && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">
          Certaines sources n'ont pas répondu ({donnees.sources_indisponibles.join(', ')}) : les blocs
          correspondants peuvent être incomplets. Ce n'est pas « rien à faire ».
        </div>
      )}

      <AgendaBloc stats={stats} onSelect={onSelect} />
      <ObligationsBloc donnees={donnees} onSelect={onSelect} onReport={reporter} canReport={peutReporter} />
      <OrganisationBloc items={donnees.organisation || []} onSelect={onSelect}
        onCreerEntretien={creerEntretien} onLienEti={lienEti} />
      <RendezVousRegulersBloc data={donnees.rendez_vous_reguliers} onSelect={onSelect} />
      <FileActiveBloc kpi={donnees.file_active || {}} annee={annee} onSelect={onSelect}
        salariesARisque={donnees.file_active?.salaries_en_risque || 0} />
    </div>
  );
}
