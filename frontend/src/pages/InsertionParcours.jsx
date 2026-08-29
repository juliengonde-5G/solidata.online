import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader } from '../components';
import { Heart } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import {
  FREIN_LABEL_BY_COLUMN, FREIN_LEVEL_COLORS,
  ENTRETIEN_TYPE_LABELS, ENTRETIEN_STATUS_LABELS, ENTRETIEN_STATUS_COLORS,
  SORTIE_CLASS_LABELS, entretienLabel, frDate, isAdminRh,
} from '../components/insertion/freins';
import RadarFreins from '../components/insertion/RadarFreins';
import DiagnosticForm from '../components/insertion/DiagnosticForm';
import EntretienForm from '../components/insertion/EntretienForm';
import ObjectifsPanel from '../components/insertion/ObjectifsPanel';
import ActionsPanel from '../components/insertion/ActionsPanel';
import AlertesBloc from '../components/insertion/AlertesBloc';
import FriseParcours from '../components/insertion/FriseParcours';
import PmsmpPanel from '../components/insertion/PmsmpPanel';
import SatisfactionForm from '../components/insertion/SatisfactionForm';
import CompetencesETI from '../components/insertion/CompetencesETI';
import ChecklistEmbauche from '../components/insertion/ChecklistEmbauche';
import NoteProfilInitial from '../components/insertion/NoteProfilInitial';
import QuickActionButton, { pushRecent } from '../components/insertion/QuickActionButton';
import { exportFicheParcoursPDF, exportBilanProlongationPassIae } from '../components/insertion/pdf-insertion';
import { formatEmployeeName, compareByName } from '../utils/names';

// Les endpoints IA (Claude) génèrent 1500-2500 tokens et peuvent dépasser le
// timeout axios global de 30 s. Délai dédié de 2 min (nginx autorise 300 s).
const IA_TIMEOUT = 120000;

// Formate une erreur d'appel IA de façon lisible : timeout explicite, 503
// (clé absente), sinon message backend + hint/detail (endpoints ADMIN/RH).
function formatIaError(err, fallback = 'Erreur analyse IA') {
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
    return "L'analyse IA a dépassé le délai d'attente (le modèle met parfois 1 à 2 min). Réessayez.";
  }
  if (err.response?.status === 503) return err.response?.data?.error || 'Service IA non configuré (clé Anthropic absente).';
  const d = err.response?.data;
  return (d?.error || err.message || fallback) + (d?.hint ? ' — ' + d.hint : (d?.detail ? ' — ' + d.detail : ''));
}

const URGENCY_COLORS = {
  critique: 'bg-red-100 text-red-700 border-red-200',
  attention: 'bg-yellow-100 text-yellow-700 border-yellow-200',
};

// ═══════════════════════════════════════
// TIMELINE (liste chronologique verticale — vue de référence conservée)
// ═══════════════════════════════════════

function TimelineView({ timeline }) {
  if (!timeline || !timeline.events) return null;

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">Progression : {timeline.progression}%</span>
        {timeline.duree_totale_mois && <span className="text-sm text-gray-500">Durée : {timeline.duree_totale_mois} mois</span>}
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
        <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${timeline.progression}%` }} />
      </div>
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
        {timeline.events.map((event, i) => {
          const isRealise = event.status === 'realise';
          const isCurrent = event.status === 'planifie';
          return (
            <div key={i} className="relative flex items-start mb-6 pl-10">
              <div className={`absolute left-2.5 w-3 h-3 rounded-full border-2 ${
                isRealise ? 'bg-green-500 border-green-500' :
                isCurrent ? 'bg-blue-500 border-blue-500 animate-pulse' :
                'bg-white border-gray-300'
              }`} />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium ${isRealise ? 'text-green-700' : isCurrent ? 'text-blue-700' : 'text-gray-500'}`}>
                    {event.label}
                  </span>
                  {event.status && event.type === 'milestone' && (
                    <span className={`text-xs px-2 py-0.5 rounded ${ENTRETIEN_STATUS_COLORS[event.status] || ''}`}>
                      {ENTRETIEN_STATUS_LABELS[event.status] || event.status}
                    </span>
                  )}
                  {event.avis_global && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      event.avis_global === 'tres_positif' || event.avis_global === 'positif' ? 'bg-green-100 text-green-700' :
                      event.avis_global === 'mitige' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                    }`}>{event.avis_global.replace('_', ' ')}</span>
                  )}
                  {event.sortie_classification && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      event.sortie_classification === 'autre' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                    }`}>{SORTIE_CLASS_LABELS[event.sortie_classification] || `Sortie ${event.sortie_classification}`}</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {event.date ? new Date(event.date).toLocaleDateString('fr-FR') : 'Date non définie'}
                  {event.description && ` — ${event.description}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// AI RECOMMENDATIONS PANEL (algorithmique)
// ═══════════════════════════════════════

function AIRecommendationsPanel({ recommendations }) {
  if (!recommendations) return null;
  const { alertes, propositions, accompagnement } = recommendations;

  return (
    <div className="space-y-4">
      {alertes && alertes.length > 0 && (
        <div>
          <h4 className="font-semibold text-red-700 text-sm mb-2">Alertes</h4>
          {alertes.map((a, i) => (
            <div key={i} className={`p-2 rounded mb-1 text-sm ${a.urgence === 'haute' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
              <div className="font-medium">{a.message}</div>
              {a.actions_suggerees && a.actions_suggerees.length > 0 && (
                <ul className="mt-1 text-xs text-gray-600 list-disc list-inside">
                  {a.actions_suggerees.map((act, j) => <li key={j}>{act}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {propositions && propositions.length > 0 && (
        <div>
          <h4 className="font-semibold text-blue-700 text-sm mb-2">Propositions</h4>
          {propositions.map((p, i) => (
            <div key={i} className="p-2 rounded mb-1 text-sm bg-blue-50 border border-blue-200">
              <div className="font-medium">{p.message}</div>
              {p.detail && <div className="text-xs text-gray-600 mt-0.5">{p.detail}</div>}
            </div>
          ))}
        </div>
      )}
      {accompagnement && accompagnement.length > 0 && (
        <div>
          <h4 className="font-semibold text-purple-700 text-sm mb-2">Accompagnement CIP</h4>
          {accompagnement.map((a, i) => (
            <div key={i} className="p-2 rounded mb-1 text-sm bg-purple-50 border border-purple-200">
              <div className="font-medium">{a.message}</div>
              {a.detail && <div className="text-xs text-gray-600 mt-0.5">{a.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// COHORTE PANEL — Espace de travail CIP (pilotage)
// ═══════════════════════════════════════

function DashCard({ label, value, tone, sub }) {
  const tones = {
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone] || tones.slate}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wide">{label}</div>
      {sub && <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

// Barre réalisé vs objectif conventionné : jauge 0-100 % avec repère sur la
// cible DREETS. Vert si atteint, ambre si proche, rouge sinon.
function ObjectifBar({ realise, objectif }) {
  if (objectif == null) {
    return (
      <p className="text-xs text-gray-500">
        Aucun objectif conventionné défini.{realise != null ? ` Réalisé : ${realise} %.` : ''}
      </p>
    );
  }
  const r = realise == null ? 0 : realise;
  const atteint = realise != null && realise >= objectif;
  const proche = realise != null && !atteint && realise >= objectif * 0.8;
  const barColor = atteint ? 'bg-green-500' : proche ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="relative h-4 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-4 ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(100, r)}%` }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-slate-800" style={{ left: `${Math.min(100, objectif)}%` }} title={`Objectif ${objectif} %`} />
      </div>
      <div className="flex items-center justify-between mt-1 text-xs">
        <span className={atteint ? 'text-green-700 font-medium' : 'text-gray-600'}>
          {realise != null ? `${realise} % réalisé` : 'Aucune sortie cette année'}
        </span>
        <span className="text-slate-700 font-medium">Objectif : {objectif} %</span>
      </div>
      {realise != null && (
        <p className={`text-xs mt-0.5 ${atteint ? 'text-green-600' : 'text-amber-600'}`}>
          {atteint ? '✓ Objectif conventionné atteint' : `${Math.max(0, Math.round(objectif - realise))} pt(s) sous l'objectif`}
        </p>
      )}
    </div>
  );
}

// Bloc « Aujourd'hui / Cette semaine » (REC-UX-07/08) : entretiens du jour et
// de la semaine + retards réglementaires REGROUPÉS PAR SALARIÉ, rouges d'abord.
// Phase D (écart 1a) : libellé réel (titre), heure du rendez-vous quand
// interview_date est posée, badge « Préparation IA prête » (ia_preparation_ready).
const heureRdv = (d) => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null);

function IaPretBadge({ ready }) {
  if (!ready) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 whitespace-nowrap"
      title="Une note de préparation IA a déjà été générée pour cet entretien">
      Préparation IA prête
    </span>
  );
}

function AgendaBloc({ stats, onSelect }) {
  const today = (stats.agenda_30j || []).filter((j) => j.days_until === 0);
  const week = (stats.agenda_30j || []).filter((j) => j.days_until > 0 && j.days_until <= 7);
  // Retards regroupés par salarié : une ligne = un salarié, badges cumulés.
  const retardsParSalarie = new Map();
  for (const j of stats.jalons_en_retard || []) {
    const cur = retardsParSalarie.get(j.employee_id) || { id: j.employee_id, nom: formatEmployeeName(j.last_name, j.first_name), items: [] };
    cur.items.push(j);
    retardsParSalarie.set(j.employee_id, cur);
  }
  const retards = [...retardsParSalarie.values()];

  return (
    <div className="bg-white rounded-lg border p-4 space-y-3">
      <h4 className="font-semibold text-gray-800">Aujourd'hui / Cette semaine</h4>

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
                    {ENTRETIEN_TYPE_LABELS[it.milestone_type] || it.milestone_type} · {Math.abs(it.days_until)} j
                  </span>
                ))}
                {r.items.length > 3 && <span className="text-[10px] text-red-600">+{r.items.length - 3}</span>}
              </span>
            </button>
          ))}
          {retards.length > 6 && <p className="text-[11px] text-gray-400">… et {retards.length - 6} autre(s) salarié(s) — voir « Entretiens en retard » ci-dessous.</p>}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold text-teal-700 mb-1">Aujourd'hui ({today.length})</p>
          {today.length ? today.map((j) => (
            <button key={j.id} onClick={() => onSelect(j.employee_id)}
              className="w-full text-left flex items-center justify-between gap-2 p-2 rounded hover:bg-teal-50 text-sm">
              <span className="truncate">{formatEmployeeName(j.last_name, j.first_name)} — <span className="text-gray-500">{j.titre || ENTRETIEN_TYPE_LABELS[j.milestone_type] || j.milestone_type}</span></span>
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
              <span className="truncate">{formatEmployeeName(j.last_name, j.first_name)} — <span className="text-gray-500">{j.titre || ENTRETIEN_TYPE_LABELS[j.milestone_type] || j.milestone_type}</span></span>
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
    </div>
  );
}

// Bloc « Renouvellements à préparer » (EXG-04/REC-UX-06) — file des CDDI dont le
// contrat finit dans la fenêtre d'anticipation. « Créer l'entretien » pose
// l'entretien de renouvellement lié au contrat ; le lien direct vers l'écran ETI
// (/insertion/renouvellement/:id) se copie pour être envoyé à l'encadrant.
function RenouvellementsBloc({ onSelect }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null); // employee_id en cours de création
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    api.get('/insertion/renouvellements')
      .then((r) => { if (alive) { setData(r.data); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); });
    return () => { alive = false; };
  }, []);

  useEffect(() => load(), [load]);

  const createEntretien = async (r) => {
    setBusyId(r.employee_id); setError(null);
    try {
      // Échéance proposée : 14 j avant la fin du contrat, jamais dans le passé.
      const fin = r.contract_end ? new Date(r.contract_end) : new Date();
      fin.setDate(fin.getDate() - 14);
      const due = (fin > new Date() ? fin : new Date()).toISOString().slice(0, 10);
      await api.post('/insertion/milestones', {
        employee_id: r.employee_id,
        milestone_type: 'renouvellement',
        due_date: due,
        contract_id: r.contract_id,
      });
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setBusyId(null);
  };

  const copyLink = async (r) => {
    const url = `${window.location.origin}/insertion/renouvellement/${r.entretien.id}?salarie=${r.employee_id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(r.entretien.id);
      setTimeout(() => setCopiedId((c) => (c === r.entretien.id ? null : c)), 2500);
    } catch {
      window.prompt("Copiez le lien du formulaire encadrant :", url);
    }
  };

  if (error && !data) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <h4 className="font-semibold text-gray-700 mb-2">Renouvellements à préparer</h4>
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">Liste indisponible : {error}</div>
      </div>
    );
  }
  if (!data) return null;
  const rows = data.renouvellements || [];

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h4 className="font-semibold text-gray-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500" /> Renouvellements à préparer ({data.total || 0})
        </h4>
        <span className="text-[11px] text-gray-400">Fins de CDDI sous {data.anticipation_jours} jours</span>
      </div>
      {error && <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">Aucun renouvellement à préparer dans la fenêtre d'anticipation.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const e = r.entretien;
            return (
              <div key={`${r.employee_id}-${r.contract_id}`} className="flex items-center justify-between gap-2 p-2 rounded border border-gray-100 hover:bg-amber-50/40 flex-wrap">
                <button onClick={() => onSelect(r.employee_id)} className="text-left text-sm min-w-0">
                  <span className="font-medium text-gray-800">{formatEmployeeName(r.last_name, r.first_name)}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    fin de contrat {frDate(r.contract_end)}
                    {r.jours_restants != null && <span className={r.jours_restants <= 15 ? 'text-red-600 font-medium' : 'text-amber-700'}> · J-{r.jours_restants}</span>}
                  </span>
                </button>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {r.a_creer ? (
                    <button onClick={() => createEntretien(r)} disabled={busyId === r.employee_id}
                      className="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
                      {busyId === r.employee_id ? 'Création…' : "Créer l'entretien"}
                    </button>
                  ) : (
                    <>
                      {e.verrouille ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-white" title="Renouvellement clôturé et verrouillé">🔒 clôturé</span>
                      ) : e.formulaire_rempli ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200"
                          title={`Avis encadrant : ${e.renouvellement_avis || '—'}${e.renouvellement_duree_mois ? ` · ${e.renouvellement_duree_mois} mois` : ''}`}>
                          Avis encadrant reçu{e.renouvellement_avis ? ` — ${String(e.renouvellement_avis).replace('_', ' ')}` : ''}
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">Formulaire encadrant à remplir</span>
                      )}
                      <Link to={`/insertion/renouvellement/${e.id}?salarie=${r.employee_id}`}
                        className="px-2 py-1 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 whitespace-nowrap">
                        Formulaire
                      </Link>
                      {!e.verrouille && (
                        <button onClick={() => copyLink(r)}
                          title="Copier le lien direct à envoyer à l'encadrant technique (un écran, un salarié)"
                          className="px-2 py-1 rounded-lg border border-teal-300 text-teal-700 text-xs hover:bg-teal-50 whitespace-nowrap">
                          {copiedId === e.id ? '✓ Copié' : 'Copier le lien'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CohortePanel({ onSelect }) {
  const { user } = useAuth();
  const canExport = isAdminRh(user);
  const canEditObjectif = canExport; // ADMIN/RH
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState(false); // filtre « mes salariés »
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

  const downloadExport = async () => {
    setExporting(true); setExportError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      let url = '/exports/insertion';
      let filename = `insertion_complet_${stamp}.xlsx`;
      if (exportChoice !== 'xlsx') {
        url += `?format=csv&dataset=${exportChoice}`;
        filename = `insertion_${exportChoice}_${stamp}.csv`;
      }
      const res = await api.get(url, { responseType: 'blob', timeout: IA_TIMEOUT });
      const objUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      let msg = "Erreur lors de l'export des données d'insertion.";
      try { const txt = await err.response?.data?.text?.(); if (txt) msg = JSON.parse(txt).error || msg; } catch { /* garde le message générique */ }
      setExportError(msg);
    } finally {
      setExporting(false);
    }
  };

  const downloadFSE = async () => {
    setFseExporting(true); setFseError(null);
    try {
      const res = await api.get(`/exports/fse-plus?annee=${fseAnnee}&trimestre=${fseTrim}`, { responseType: 'blob', timeout: IA_TIMEOUT });
      const objUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `fse-plus_${fseAnnee}_T${fseTrim}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      let msg = "Erreur lors de l'export FSE+.";
      try { const txt = await err.response?.data?.text?.(); if (txt) msg = JSON.parse(txt).error || msg; } catch { /* message générique */ }
      setFseError(msg);
    } finally {
      setFseExporting(false);
    }
  };

  const loadStats = useCallback(() => {
    let alive = true;
    setLoading(true);
    api.get(`/insertion/cohorte/stats${mine ? '?mine=1' : ''}`)
      .then((r) => { if (alive) { setStats(r.data); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [mine]);

  useEffect(() => loadStats(), [loadStats]);

  const saveObjectif = async () => {
    setObjSaving(true); setObjError(null);
    try {
      const val = objInput.trim() === '' ? null : parseFloat(objInput);
      await api.put('/insertion/objectif-sorties', { objectif: val });
      setObjEditing(false);
      loadStats();
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

  if (loading) return <LoadingSpinner size="lg" message="Chargement du tableau de bord..." />;
  if (error) return <div className="bg-white rounded-lg border p-4"><div className="text-red-600 text-sm p-3 bg-red-50 rounded border border-red-200">Impossible de charger le tableau de bord : {error}</div></div>;
  if (!stats) return null;

  const s = stats.sorties || {};
  const freinsSorted = Object.entries(stats.freins_moyennes || {})
    .filter(([, v]) => v != null)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {/* Aujourd'hui / Cette semaine — point d'entrée du lundi matin (REC-UX-07) */}
      <AgendaBloc stats={stats} onSelect={onSelect} />

      {/* Renouvellements à préparer (EXG-04 — « il y en a toujours ») */}
      <RenouvellementsBloc onSelect={onSelect} />

      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-gray-800">Espace CIP — mes salariés</h3>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none whitespace-nowrap" title="N'afficher que les salariés dont je suis le CIP référent">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="rounded border-gray-300" />
              Mes salariés
            </label>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <QuickActionButton className="!py-1.5 !text-xs" />
            {canExport && (
              <div className="flex items-center gap-1.5">
                <select value={exportChoice} onChange={(e) => setExportChoice(e.target.value)}
                  title="Choisir le contenu et le format de l'export"
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700">
                  <option value="xlsx">Excel — tout (5 feuilles)</option>
                  <option value="salaries">CSV — Salariés</option>
                  <option value="diagnostics">CSV — Diagnostics CIP</option>
                  <option value="jalons">CSV — Entretiens</option>
                  <option value="actions">CSV — Plans d'action</option>
                </select>
                <button onClick={downloadExport} disabled={exporting}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {exporting ? 'Export…' : 'Exporter'}
                </button>
                <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden="true" />
                <select value={fseAnnee} onChange={(e) => setFseAnnee(Number(e.target.value))}
                  title="Année de l'export FSE+"
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700">
                  {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={fseTrim} onChange={(e) => setFseTrim(Number(e.target.value))}
                  title="Trimestre de l'export FSE+"
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-700">
                  {[1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t}</option>)}
                </select>
                <button onClick={downloadFSE} disabled={fseExporting}
                  title="Export réglementaire FSE+ (bénéficiaires CDDI du trimestre)"
                  className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50">
                  {fseExporting ? 'Export…' : 'Export FSE+'}
                </button>
              </div>
            )}
            {canExport && (
              <button onClick={runIaCohorte} disabled={iaLoading}
                className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
                {iaLoading ? 'Analyse IA…' : 'Analyser la cohorte (IA)'}
              </button>
            )}
          </div>
        </div>
        {exportError && <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{exportError}</div>}
        {fseError && <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{fseError}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DashCard label="En parcours" value={stats.nb_actifs} tone="blue" />
          <DashCard label="Entretiens en retard" value={stats.nb_jalons_en_retard} tone={stats.nb_jalons_en_retard ? 'red' : 'green'} sub={`${stats.taux_retard_jalons}% des échéances`} />
          <DashCard label="À venir (7 j)" value={stats.nb_jalons_a_venir} tone={stats.nb_jalons_a_venir ? 'amber' : 'slate'} />
          <DashCard label={`Sorties dynamiques ${stats.annee}`} value={s.taux_dynamiques != null ? s.taux_dynamiques + '%' : '—'} tone="green" sub={`${s.dynamiques || 0}/${s.total || 0} sorties`} />
        </div>

        {/* Objectif conventionné DREETS — réalisé vs cible */}
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Sorties dynamiques {stats.annee} — réalisé vs objectif conventionné</span>
            {canEditObjectif && !objEditing && (
              <button onClick={() => { setObjEditing(true); setObjError(null); setObjInput(stats.objectif_sorties_dynamiques != null ? String(stats.objectif_sorties_dynamiques) : ''); }}
                className="text-xs text-teal-700 hover:underline">
                {stats.objectif_sorties_dynamiques != null ? "Modifier l'objectif" : "Définir l'objectif"}
              </button>
            )}
          </div>
          {objEditing ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input type="number" min="0" max="100" step="1" value={objInput} onChange={(e) => setObjInput(e.target.value)}
                placeholder="% cible" className="input-modern py-1 w-28" />
              <span className="text-xs text-gray-500">% de sorties dynamiques</span>
              <button onClick={saveObjectif} disabled={objSaving} className="px-2 py-1 rounded bg-teal-600 text-white text-xs disabled:opacity-50">{objSaving ? '…' : 'Enregistrer'}</button>
              <button onClick={() => { setObjEditing(false); setObjError(null); }} className="px-2 py-1 text-xs text-gray-500">Annuler</button>
              {objError && <span className="text-xs text-red-600 w-full">{objError}</span>}
            </div>
          ) : (
            <ObjectifBar realise={s.taux_dynamiques} objectif={stats.objectif_sorties_dynamiques} />
          )}
        </div>

        {iaError && <div className="mt-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{iaError}</div>}
        {ia && (
          <div className="mt-3 bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-2">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Entretiens en retard */}
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" /> Entretiens en retard ({stats.jalons_en_retard?.length || 0})
          </h4>
          {stats.jalons_en_retard?.length ? (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {stats.jalons_en_retard.map((j) => (
                <button key={j.id} onClick={() => onSelect(j.employee_id)}
                  className="w-full text-left flex items-center justify-between p-2 rounded hover:bg-red-50 text-sm">
                  <span>{formatEmployeeName(j.last_name, j.first_name)} — <span className="text-gray-500">{ENTRETIEN_TYPE_LABELS[j.milestone_type] || j.milestone_type}</span></span>
                  <span className="text-xs text-red-600 font-medium">{Math.abs(j.days_until)} j</span>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-2">Aucun entretien en retard 👍</p>}
        </div>

        {/* À venir 7j */}
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> À planifier / à venir (7 j)
          </h4>
          {stats.jalons_a_venir_7j?.length ? (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {stats.jalons_a_venir_7j.map((j) => (
                <button key={j.id} onClick={() => onSelect(j.employee_id)}
                  className="w-full text-left flex items-center justify-between p-2 rounded hover:bg-amber-50 text-sm">
                  <span>{formatEmployeeName(j.last_name, j.first_name)} — <span className="text-gray-500">{ENTRETIEN_TYPE_LABELS[j.milestone_type] || j.milestone_type}</span></span>
                  <span className="text-xs text-amber-600 font-medium">J-{j.days_until}</span>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-2">Rien dans les 7 jours.</p>}
        </div>

        {/* Salariés à risque */}
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500" /> Fins de contrat (&lt; 60 j)
          </h4>
          {stats.salaries_a_risque?.length ? (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {stats.salaries_a_risque.map((c) => (
                <button key={c.id} onClick={() => onSelect(c.id)}
                  className="w-full text-left flex items-center justify-between p-2 rounded hover:bg-orange-50 text-sm">
                  <span>{formatEmployeeName(c.last_name, c.first_name)}</span>
                  <span className={`text-xs font-medium ${c.days <= 15 ? 'text-red-600' : 'text-orange-600'}`}>
                    {c.days < 0 ? 'échu' : c.days + ' j'} — {frDate(c.contract_end)}
                  </span>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-2">Aucune fin de contrat proche.</p>}
        </div>

        {/* Freins moyens de la cohorte */}
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2">Freins moyens de la cohorte</h4>
          {freinsSorted.length ? (
            <div className="space-y-1.5">
              {freinsSorted.map(([key, val]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-24 text-xs text-gray-600">{FREIN_LABEL_BY_COLUMN[key] || key}</span>
                  <div className="flex-1 bg-gray-200 rounded-full h-2.5">
                    <div className={`h-2.5 rounded-full ${val <= 2 ? 'bg-green-500' : val < 4 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${(val / 5) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{val}</span>
                </div>
              ))}
              {stats.frein_dominant && (
                <p className="text-xs text-gray-500 mt-2">Frein dominant : <strong>{FREIN_LABEL_BY_COLUMN[stats.frein_dominant] || stats.frein_dominant}</strong></p>
              )}
            </div>
          ) : <p className="text-sm text-gray-400 py-2">Pas encore d'évaluation de freins.</p>}
        </div>
      </div>

      {/* Sorties par catégorie / type */}
      {s.total > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-semibold text-gray-700 mb-2">Sorties {stats.annee} — {s.dynamiques}/{s.total} dynamiques ({s.taux_dynamiques}%)</h4>
          <div className="flex flex-wrap gap-2 mb-2">
            {Object.entries(s.par_classification || {}).map(([cl, n]) => (
              <span key={cl} className="text-xs px-2 py-1 rounded bg-teal-50 text-teal-700">{SORTIE_CLASS_LABELS[cl] || cl} : <strong>{n}</strong></span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(s.par_type || {}).map(([type, n]) => (
              <span key={type} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700">{type} : <strong>{n}</strong></span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// MAIN PAGE — Espace CIP
// ═══════════════════════════════════════

export default function InsertionParcours() {
  const { user } = useAuth();
  const adminRh = isAdminRh(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [referents, setReferents] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [activeTab, setActiveTab] = useState('synthese');
  const [activeEntretien, setActiveEntretien] = useState(null);
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [freinsDefinitions, setFreinsDefinitions] = useState(null);
  const [radarData, setRadarData] = useState(null);
  const [cddi, setCddi] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [competences, setCompetences] = useState([]);
  const [passBilanLoading, setPassBilanLoading] = useState(false);

  const [loadError, setLoadError] = useState(null);
  const [panelError, setPanelError] = useState(null);
  const [showDashboard, setShowDashboard] = useState(true);
  const [diagDirty, setDiagDirty] = useState(false);
  const [bilanDirty, setBilanDirty] = useState(false);
  const [newEntretienOpen, setNewEntretienOpen] = useState(false);
  const [newEntretien, setNewEntretien] = useState({ milestone_type: 'bilan_intermediaire', due_date: new Date().toISOString().slice(0, 10) });
  const [iaAnalyse, setIaAnalyse] = useState(null);
  const [iaError, setIaError] = useState(null);
  const [iaLoadingProfil, setIaLoadingProfil] = useState(false);
  const [iaDiag, setIaDiag] = useState(null);
  const [iaDiagLoading, setIaDiagLoading] = useState(false);

  const loadEmployees = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await api.get('/insertion');
      // Tri alphabétique NOM puis PRÉNOM (Lot 1 « Règles de gestion des noms »)
      // — filet de sécurité côté front en complément du tri backend.
      const list = Array.isArray(res.data) ? res.data : [];
      setEmployees([...list].sort(compareByName));
    } catch (err) {
      console.error('[InsertionParcours] Erreur chargement:', err);
      setLoadError(err.response?.data?.detail || err.message || 'Erreur de chargement');
    }
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => {
    api.get('/insertion/freins-definitions').then(r => setFreinsDefinitions(r.data)).catch((err) => console.error('[Insertion] freins-definitions indisponible:', err));
    api.get('/insertion/cip-referents').then(r => setReferents(Array.isArray(r.data) ? r.data : [])).catch((err) => console.error('[Insertion] cip-referents indisponible:', err));
  }, []);

  const saveReferent = async (userId) => {
    if (!selectedEmployee) return;
    setPanelError(null);
    try {
      const res = await api.put(`/insertion/${selectedEmployee.id}/cip-referent`, { user_id: userId || null });
      setAnalysis((a) => a ? { ...a, employee: { ...a.employee, cip_referent_user_id: res.data.cip_referent_user_id, cip_referent_nom: res.data.cip_referent_nom } } : a);
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message || 'Erreur lors de la mise à jour du référent');
    }
  };

  // Garde-fou : prévient la perte de saisie non enregistrée (l'autosave réduit
  // la fenêtre de risque mais la garde reste).
  const confirmLeave = () => ((!diagDirty && !bilanDirty) || window.confirm('Des modifications ne sont pas enregistrées. Continuer sans les enregistrer ?'));
  useEffect(() => {
    const handler = (e) => { if (diagDirty || bilanDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [diagDirty, bilanDirty]);

  const selectEmployee = useCallback(async (emp, { keepTab = false, keepEntretienId = null } = {}) => {
    setSelectedEmployee(emp);
    setShowDashboard(false);
    if (!keepTab) setActiveTab('synthese');
    setPanelError(null);
    setDiagDirty(false); setBilanDirty(false);
    setIaAnalyse(null); setIaError(null);
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
      // Contrats pour la frise (couloir Contrats) — best-effort, repli sur les
      // dates de la fiche si l'appel échoue.
      api.get(`/employees/${emp.id}/contracts`)
        .then((r) => setContracts(Array.isArray(r.data) ? r.data : []))
        .catch(() => setContracts([]));
      // Compétences ETI (Lot 8) — best effort, pour l'export PDF dossier.
      api.get(`/insertion/competences/${emp.id}`)
        .then((r) => setCompetences(Array.isArray(r.data) ? r.data : []))
        .catch(() => setCompetences([]));
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message || 'Erreur de chargement du parcours');
    }
    setLoading(false);
  }, []);

  const selectEmployeeById = useCallback((id) => {
    const emp = employees.find((e) => e.id === id) || { id };
    selectEmployee(emp);
  }, [employees, selectEmployee]);

  // Deep-link ?employee=<id> (depuis /employees « Ouvrir dans l'espace CIP »).
  useEffect(() => {
    const q = searchParams.get('employee');
    if (q && employees.length > 0 && !selectedEmployee) {
      const id = parseInt(q, 10);
      if (!Number.isNaN(id)) selectEmployeeById(id);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, searchParams]);

  const reloadSelected = (opts = {}) => { if (selectedEmployee) selectEmployee(selectedEmployee, { keepTab: true, ...opts }); };

  const initializeMilestones = async () => {
    if (!selectedEmployee) return;
    setPanelError(null);
    try {
      await api.post(`/insertion/milestones/${selectedEmployee.id}/initialize`);
      reloadSelected();
    } catch (err) {
      setPanelError((err.response?.data?.error || err.message) + (err.response?.data?.detail ? ` — ${err.response.data.detail}` : ''));
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
      setActiveTab('entretiens');
      selectEmployee(selectedEmployee, { keepTab: true, keepEntretienId: res.data?.id });
    } catch (err) {
      setPanelError(err.response?.data?.error || err.message);
    }
  };

  // Bilan de prolongation du Pass IAE (EXG-02/REC-UX-15) — PDF à 1 clic depuis
  // la fiche : le backend renvoie le JSON minimisé (sans judiciaire ni détail
  // santé), la fenêtre d'impression fait le reste.
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

  // Clic sur un élément de la frise → ouvre le bon onglet / le bon détail.
  const handleFriseSelect = ({ type, data }) => {
    if (!confirmLeave()) return;
    if (type === 'entretien' && data?.id) {
      const ms = milestones.find((m) => m.id === data.id) || data;
      setActiveTab('entretiens');
      setActiveEntretien(ms);
      setBilanDirty(false);
    } else if (type === 'objectif') {
      setActiveTab('objectifs');
      setActiveEntretien(null);
    }
    // contrat / pmsmp : le détail est déjà sous les yeux (Synthèse).
  };

  const tabs = [
    { id: 'synthese', label: 'Synthèse' },
    { id: 'diagnostic', label: 'Diagnostic' },
    { id: 'entretiens', label: 'Entretiens & bilans' },
    { id: 'competences', label: 'Compétences' },
    { id: 'objectifs', label: 'Objectifs & actions' },
    { id: 'freins', label: 'Freins' },
    { id: 'ia', label: 'Assistant IA' },
  ];

  const emp = analysis?.employee || {};
  const milestones = analysis?.milestones || [];
  const sortedMilestones = useMemo(
    () => [...milestones].sort((a, b) => new Date(b.due_date || 0) - new Date(a.due_date || 0)),
    [milestones]
  );
  const diagDeadline = emp.insertion_start_date
    ? new Date(new Date(emp.insertion_start_date).getTime() + 30 * 86400000)
    : null;

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Espace CIP — Parcours d'insertion"
          subtitle="Entretiens, freins périphériques, objectifs et plans d'action"
          icon={Heart}
        />

        <div className="grid grid-cols-12 gap-4">
          {/* Liste employés */}
          <div className="col-span-12 md:col-span-3 bg-white rounded-lg border p-3 max-h-[80vh] overflow-y-auto">
            <button onClick={() => { if (!confirmLeave()) return; setShowDashboard(true); setSelectedEmployee(null); setPanelError(null); setDiagDirty(false); setBilanDirty(false); }}
              className={`w-full mb-3 px-3 py-2 rounded text-sm font-semibold transition ${showDashboard ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              Tableau de bord CIP
            </button>
            <h2 className="font-semibold text-gray-700 mb-2">Salariés suivis ({employees.length})</h2>
            {loadError && <div className="text-red-600 text-xs mb-2 p-2 bg-red-50 rounded">{loadError}</div>}
            {!loadError && employees.length === 0 && <div className="text-gray-400 text-sm p-2">Aucun salarié actif trouvé</div>}
            {employees.map(e => (
              <button key={e.id} onClick={() => { if (confirmLeave()) selectEmployee(e); }}
                className={`w-full text-left p-2 rounded mb-1 text-sm transition ${
                  selectedEmployee?.id === e.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                }`}>
                <div className="font-medium">{formatEmployeeName(e.last_name, e.first_name)}</div>
                <div className="text-xs text-gray-500">{e.team_name || 'Équipe ?'} - {e.position || 'Poste ?'}</div>
                <div className="flex gap-1 mt-1">
                  {e.has_pcm && <span className="text-xs px-1 rounded bg-purple-100 text-purple-700">PCM</span>}
                  {e.has_diagnostic && <span className="text-xs px-1 rounded bg-green-100 text-green-700">Diag</span>}
                  {e.urgency && <span className={`text-xs px-1 rounded ${URGENCY_COLORS[e.urgency]}`}>{e.urgency}</span>}
                </div>
              </button>
            ))}
          </div>

          {/* Contenu principal */}
          <div className="col-span-12 md:col-span-9 space-y-4">
            {(!selectedEmployee || showDashboard) && (
              <CohortePanel onSelect={selectEmployeeById} />
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
                {/* ── En-tête fiche : identité, Pass IAE, parcours, CDDI, alertes ── */}
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
                        {emp.pass_iae_number ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${emp.pass_iae_end && new Date(emp.pass_iae_end) < new Date() ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
                            title={`Pass IAE n° ${emp.pass_iae_number}`}>
                            Pass IAE {emp.pass_iae_end ? `→ ${frDate(emp.pass_iae_end)}` : '✓'}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500" title="Numéro de Pass IAE non renseigné (fiche collaborateur)">Pass IAE non renseigné</span>
                        )}
                        {cddi?.is_cddi && (
                          <span className={`text-xs px-2 py-0.5 rounded ${cddi.months_total >= 23 ? 'bg-red-100 text-red-700' : cddi.months_total >= 20 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
                            title="Durée cumulée en CDDI (plafond légal 24 mois)">
                            CDDI : {cddi.months_total}/{cddi.cap_months} mois{cddi.nb_contracts > 1 ? ` (${cddi.nb_contracts} contrats)` : ''}
                          </span>
                        )}
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
                            <select
                              value={emp.cip_referent_user_id || ''}
                              onChange={(e) => saveReferent(e.target.value ? parseInt(e.target.value, 10) : null)}
                              className="bg-transparent text-teal-800 text-xs outline-none cursor-pointer"
                            >
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
                        <button onClick={() => { setNewEntretienOpen(true); }}
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
                          Fiche PDF
                        </button>
                        {adminRh && emp.pass_iae_number && (
                          <button onClick={exportPassIaeBilan} disabled={passBilanLoading}
                            title="Bilan du parcours en appui de la demande de prolongation du Pass IAE (destinataire : prescripteur habilité — sans données art. 9/10)"
                            className="px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-medium hover:bg-emerald-50 whitespace-nowrap disabled:opacity-50">
                            {passBilanLoading ? 'Génération…' : 'Bilan de prolongation (PDF)'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <AlertesBloc employeeId={selectedEmployee.id} />
                </div>

                {/* Modale nouveau entretien */}
                {newEntretienOpen && (
                  <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4" onClick={() => setNewEntretienOpen(false)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                      <h3 className="font-semibold text-gray-800">Nouvel entretien</h3>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Type</label>
                        <select value={newEntretien.milestone_type} onChange={(e) => setNewEntretien({ ...newEntretien, milestone_type: e.target.value })} className="input-modern py-1.5 w-full">
                          {Object.entries(ENTRETIEN_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <p className="text-[11px] text-gray-400 mt-1">Les bilans de suivi sont libres (n° auto). Diagnostic d'accueil et bilan de sortie sont uniques par parcours.</p>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Échéance</label>
                        <input type="date" value={newEntretien.due_date} onChange={(e) => setNewEntretien({ ...newEntretien, due_date: e.target.value })} className="input-modern py-1.5 w-full" />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setNewEntretienOpen(false)} className="px-3 py-1.5 text-sm text-gray-500">Annuler</button>
                        <button onClick={createEntretien} className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Créer</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tabs */}
                <div className="flex gap-1 bg-white rounded-lg border p-1 overflow-x-auto">
                  {tabs.map(tab => (
                    <button key={tab.id} onClick={() => { if (!confirmLeave()) return; setActiveTab(tab.id); setActiveEntretien(null); setBilanDirty(false); }}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition whitespace-nowrap ${
                        activeTab === tab.id ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab: Synthèse (frise + timeline + fiche synthèse) */}
                {activeTab === 'synthese' && (
                  <div className="space-y-4">
                    {/* Accueil / intégration — check-list d'embauche (Lot 8) */}
                    <div className="bg-white rounded-lg border p-3">
                      <ChecklistEmbauche employeeId={selectedEmployee.id} canEdit={adminRh} />
                    </div>
                    {/* Note de profil initial (2.43.0) — EN PRÉAMBULE du
                        diagnostic : elle se lit avant de commencer l'entretien,
                        d'où sa place juste au-dessus du bandeau ci-dessous.
                        Gate par rôle : la note croise le PCM et le dossier de
                        recrutement, le serveur la refuse (403) à un MANAGER —
                        on ne monte donc pas un bloc voué à afficher une erreur. */}
                    {adminRh && (
                      <NoteProfilInitial
                        employeeId={selectedEmployee.id}
                        employee={emp}
                        canGenerate={adminRh}
                        onDiagnostic={() => setActiveTab('diagnostic')}
                      />
                    )}
                    {!analysis.has_diagnostic && (
                      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 text-center">
                        <p className="text-sm font-medium text-teal-800">
                          Commencer le diagnostic d'accueil
                          {diagDeadline ? ` — à réaliser avant le ${diagDeadline.toLocaleDateString('fr-FR')}` : ''}
                        </p>
                        <p className="text-xs text-teal-600 mt-1">Le questionnaire se remplit rubrique par rubrique, avec sauvegarde automatique — possible en 2 séances.</p>
                        <button onClick={() => setActiveTab('diagnostic')}
                          className="mt-2 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700">
                          Ouvrir le diagnostic
                        </button>
                      </div>
                    )}
                    {/* Frise du parcours en couloirs (REC-UX-05) — la liste
                        chronologique verticale reste la vue de référence dessous. */}
                    <div className="bg-white rounded-lg border p-4">
                      <h3 className="font-semibold text-gray-800 mb-3">Frise du parcours</h3>
                      <FriseParcours
                        employee={emp}
                        contracts={contracts}
                        milestones={milestones}
                        objectifs={analysis.objectifs || []}
                        pmsmp={analysis.pmsmp || []}
                        hasCandidate={!!analysis.has_candidate_data}
                        hasPcm={!!analysis.has_pcm}
                        onSelect={handleFriseSelect}
                      />
                    </div>
                    {analysis.timeline && (
                      <div className="bg-white rounded-lg border p-4">
                        <h3 className="font-semibold text-gray-800 mb-4">Historique du parcours</h3>
                        <TimelineView timeline={analysis.timeline} />
                      </div>
                    )}
                    {/* PMSMP — immersions professionnelles (EXG-05) */}
                    <div className="bg-white rounded-lg border p-4">
                      <PmsmpPanel employeeId={selectedEmployee.id} canEdit={adminRh} />
                    </div>
                    {/* Questionnaire de satisfaction — visible dès qu'une sortie
                        existe ou que le questionnaire a été rempli. */}
                    {(analysis.satisfaction || emp.insertion_status === 'termine'
                      || milestones.some((m) => m.milestone_type === 'bilan_sortie' && m.status === 'realise')) && (
                      <div className="bg-white rounded-lg border p-4">
                        <SatisfactionForm employeeId={selectedEmployee.id} canEdit={adminRh}
                          onSaved={() => reloadSelected()} />
                      </div>
                    )}
                    {analysis.fiche_synthese && (
                      <div className="bg-white rounded-lg border p-4">
                        <h3 className="font-semibold text-gray-800 mb-2">Fiche synthèse</h3>
                        <p className="text-sm text-gray-700">{analysis.fiche_synthese.resume}</p>
                        {analysis.fiche_synthese.forces?.length > 0 && (
                          <div className="mt-2">
                            <span className="text-xs font-medium text-green-700">Forces : </span>
                            <span className="text-xs text-gray-600">{analysis.fiche_synthese.forces.join(', ')}</span>
                          </div>
                        )}
                        <div className="flex gap-2 mt-2 text-xs flex-wrap">
                          {analysis.data_sources && Object.values(analysis.data_sources).filter(s => s.available).map((s, i) => (
                            <span key={i} className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">{s.label}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Diagnostic (stepper avec autosave) */}
                {activeTab === 'diagnostic' && diagnostic && (
                  <DiagnosticForm
                    employeeId={selectedEmployee.id}
                    employee={emp}
                    diagnostic={diagnostic}
                    freinsDefinitions={freinsDefinitions}
                    baseRole={user?.base_role || user?.role}
                    onDirtyChange={setDiagDirty}
                    onSaved={(row) => { if (row) setDiagnostic((d) => ({ ...d, ...row })); }}
                  />
                )}

                {/* Tab: Entretiens & bilans */}
                {activeTab === 'entretiens' && (
                  <div className="space-y-4">
                    {activeEntretien ? (
                      <EntretienForm
                        milestone={activeEntretien}
                        employeeId={selectedEmployee.id}
                        employee={emp}
                        allMilestones={milestones}
                        onDirtyChange={setBilanDirty}
                        onSaved={(opts) => { if (opts?.reload) { setBilanDirty(false); reloadSelected({ keepEntretienId: activeEntretien.id }); } }}
                        onClosed={() => { setBilanDirty(false); setActiveEntretien(null); reloadSelected(); }}
                        onCloseForm={() => { setBilanDirty(false); setActiveEntretien(null); reloadSelected(); }}
                      />
                    ) : (
                      <div className="bg-white rounded-lg border p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-gray-800">Entretiens & bilans du parcours</h3>
                          <button onClick={() => setNewEntretienOpen(true)}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">
                            + Entretien / bilan
                          </button>
                        </div>
                        {sortedMilestones.length === 0 ? (
                          <div className="text-center text-gray-400 py-6">
                            <p>Aucun entretien pour l'instant.</p>
                            <p className="text-xs mt-1">« Démarrer le parcours » crée les échéances du parcours (diagnostic, bilans, sortie).</p>
                            <button onClick={initializeMilestones} className="mt-3 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700">
                              Démarrer le parcours
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {sortedMilestones.map(ms => (
                              <button key={ms.id} onClick={() => setActiveEntretien(ms)}
                                className="w-full text-left p-3 rounded border hover:bg-gray-50 transition flex items-center justify-between gap-2 flex-wrap">
                                <div className="min-w-0">
                                  <span className="font-medium text-gray-800">{entretienLabel(ms)}</span>
                                  <span className="text-xs text-gray-500 ml-2">
                                    Échéance : {frDate(ms.due_date)}
                                    {ms.completed_date ? ` · réalisé le ${frDate(ms.completed_date)}` : ''}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {ms.ia_preparation && ms.status !== 'realise' && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700" title="Une préparation IA est disponible">préparation prête ✨</span>
                                  )}
                                  {ms.avis_global && (
                                    <span className={`text-xs px-2 py-0.5 rounded ${
                                      ms.avis_global === 'tres_positif' || ms.avis_global === 'positif' ? 'bg-green-100 text-green-700' :
                                      ms.avis_global === 'mitige' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                                    }`}>{ms.avis_global.replace('_', ' ')}</span>
                                  )}
                                  {ms.locked_at && <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-white" title="Clôturé et verrouillé">🔒</span>}
                                  <span className={`text-xs px-2 py-0.5 rounded ${ENTRETIEN_STATUS_COLORS[ms.status]}`}>
                                    {ENTRETIEN_STATUS_LABELS[ms.status]}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Compétences (grille ETI, Lot 8) — saisissable ADMIN/RH/MANAGER */}
                {activeTab === 'competences' && (
                  <div className="bg-white rounded-lg border p-4">
                    <CompetencesETI employeeId={selectedEmployee.id} employee={emp}
                      canEdit={['ADMIN', 'RH', 'MANAGER'].includes(user?.base_role || user?.role)} />
                  </div>
                )}

                {/* Tab: Objectifs & actions */}
                {activeTab === 'objectifs' && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-lg border p-4">
                      <ObjectifsPanel employeeId={selectedEmployee.id} canEdit={adminRh} />
                    </div>
                    <div className="bg-white rounded-lg border p-4">
                      <ActionsPanel employeeId={selectedEmployee.id}
                        employeeName={formatEmployeeName(emp.last_name, emp.first_name)} />
                    </div>
                  </div>
                )}

                {/* Tab: Freins (toile d'araignée + cartographie) */}
                {activeTab === 'freins' && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-lg border p-4">
                      <h3 className="font-semibold text-gray-800 mb-3">Évolution des freins <span className="text-xs font-normal text-gray-400">(toile d'araignée)</span></h3>
                      <RadarFreins data={radarData} />
                    </div>
                    {analysis.freins_sociaux && analysis.freins_sociaux.freins?.length > 0 && (
                      <div className="bg-white rounded-lg border p-4 space-y-4">
                        <h3 className="font-semibold text-gray-800">Dernière évaluation par frein</h3>
                        <div className="space-y-2">
                          {analysis.freins_sociaux.freins.map(f => (
                            <div key={f.type} className="flex items-center gap-3 p-2 rounded bg-gray-50">
                              <span className="w-24 text-sm font-medium text-gray-700">{f.label}</span>
                              <div className="flex-1 bg-gray-200 rounded-full h-3">
                                <div className={`h-3 rounded-full ${
                                  f.niveau <= 2 ? 'bg-green-500' : f.niveau === 3 ? 'bg-yellow-500' : f.niveau === 4 ? 'bg-orange-500' : 'bg-red-500'
                                }`} style={{ width: `${f.niveau * 20}%` }} />
                              </div>
                              <span className={`text-xs px-2 py-0.5 rounded ${FREIN_LEVEL_COLORS[f.niveau]}`}>{f.niveau}/5</span>
                            </div>
                          ))}
                        </div>
                        {analysis.freins_sociaux.plan_actions?.length > 0 && (
                          <div>
                            <h4 className="font-semibold text-gray-700 mt-4 mb-2">Pistes de levée proposées</h4>
                            {analysis.freins_sociaux.plan_actions.map((a, i) => (
                              <div key={i} className={`p-2 rounded mb-1 text-sm ${a.priorite === 'haute' ? 'bg-red-50 border-l-4 border-red-400' : 'bg-yellow-50 border-l-4 border-yellow-400'}`}>
                                <div className="font-medium">{a.action}</div>
                                <div className="text-xs text-gray-500">{a.detail} — Échéance : {a.echeance}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Assistant IA */}
                {activeTab === 'ia' && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-lg border p-4">
                      <h3 className="font-semibold text-gray-800 mb-4">Recommandations algorithmiques</h3>
                      <AIRecommendationsPanel recommendations={analysis.ai_recommendations} />
                      {(!analysis.ai_recommendations ||
                        (!analysis.ai_recommendations.alertes?.length && !analysis.ai_recommendations.propositions?.length && !analysis.ai_recommendations.accompagnement?.length)) && (
                        <p className="text-sm text-gray-400 text-center py-4">Pas de recommandation pour le moment. Complétez le diagnostic et les bilans.</p>
                      )}
                    </div>

                    {analysis.pistes_metiers?.length > 0 && (
                      <div className="bg-white rounded-lg border p-4">
                        <h3 className="font-semibold text-gray-800 mb-2">Pistes métiers</h3>
                        {analysis.pistes_metiers.slice(0, 3).map((p, i) => (
                          <div key={i} className="flex items-center gap-3 p-2 rounded bg-gray-50 mb-1">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold"
                              style={{ backgroundColor: p.score >= 70 ? '#10B981' : p.score >= 50 ? '#F59E0B' : '#EF4444' }}>
                              {p.score}%
                            </div>
                            <div className="flex-1">
                              <div className="font-medium text-sm">{p.metier}</div>
                              <div className="text-xs text-gray-500">{p.pourquoi}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Analyse IA Claude */}
                    {adminRh && (
                      <div className="bg-white rounded-lg border p-4">
                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                          <h3 className="font-semibold text-gray-800">Analyse IA approfondie (Claude)</h3>
                          <div className="flex gap-2">
                            <button onClick={async () => {
                              setIaLoadingProfil(true); setIaError(null);
                              try {
                                const res = await api.get(`/insertion/ia/profil/${selectedEmployee.id}`, { timeout: IA_TIMEOUT });
                                setIaAnalyse(res.data);
                              } catch (err) { setIaError(formatIaError(err, 'Erreur analyse IA')); }
                              setIaLoadingProfil(false);
                            }} disabled={iaLoadingProfil}
                              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
                              {iaLoadingProfil ? 'Analyse…' : 'Analyser le profil'}
                            </button>
                            <button onClick={async () => {
                              setIaDiagLoading(true); setIaDiag(null); setIaError(null);
                              try {
                                const res = await api.get('/insertion/ia/diagnostic');
                                setIaDiag(res.data);
                              } catch (err) { setIaDiag(err.response?.data || { ok: false, message: err.message }); }
                              setIaDiagLoading(false);
                            }} disabled={iaDiagLoading}
                              title="Teste la connexion à Claude sans dépendre d'un salarié (clé, modèle, réseau)"
                              className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-300 disabled:opacity-50">
                              {iaDiagLoading ? 'Test…' : 'Tester la connexion IA'}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mb-3">La préparation IA d'un entretien précis se lance depuis l'entretien lui-même (« Préparer avec l'IA »).</p>

                        {iaDiag && (
                          <div className={`mb-3 text-xs rounded-lg p-3 border ${iaDiag.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                            <p className="font-semibold mb-1">
                              {iaDiag.ok ? '✓ Connexion IA opérationnelle' : '✗ Échec de la connexion IA'}
                            </p>
                            <ul className="space-y-0.5 font-mono text-[11px]">
                              <li>configured : {String(iaDiag.configured)}{iaDiag.key_length ? ` (clé longueur ${iaDiag.key_length})` : ''}</li>
                              <li>model : {iaDiag.model || '—'}</li>
                              {iaDiag.status != null && <li>status HTTP : {iaDiag.status}</li>}
                              {iaDiag.type && <li>type : {iaDiag.type}</li>}
                              {iaDiag.latency_ms != null && <li>latence : {iaDiag.latency_ms} ms</li>}
                              {iaDiag.message && <li className="whitespace-pre-wrap break-words">message : {iaDiag.message}</li>}
                              {iaDiag.reply && <li>réponse : « {iaDiag.reply} »</li>}
                            </ul>
                            {!iaDiag.ok && iaDiag.configured === false && (
                              <p className="mt-2 not-italic">→ La variable <code>ANTHROPIC_API_KEY</code> n'est pas transmise au conteneur backend. Vérifiez le <code>.env</code> serveur puis <code>docker compose ... restart backend</code>.</p>
                            )}
                            {!iaDiag.ok && iaDiag.status === 404 && (
                              <p className="mt-2">→ Le modèle <code>{iaDiag.model}</code> n'est pas disponible pour cette clé. Définissez <code>CLAUDE_MODEL</code> sur un modèle autorisé puis redémarrez le backend.</p>
                            )}
                            {!iaDiag.ok && iaDiag.status === 401 && (
                              <p className="mt-2">→ Clé <code>ANTHROPIC_API_KEY</code> invalide ou révoquée.</p>
                            )}
                          </div>
                        )}

                        {iaError && (
                          <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 flex items-start gap-2">
                            <span aria-hidden="true">⚠</span><span>{iaError}</span>
                          </div>
                        )}

                        {iaAnalyse && (
                          <div className="bg-violet-50 rounded-xl border border-violet-200 p-4 mb-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="font-semibold text-violet-800 text-sm">Analyse profil <span className="font-normal text-violet-500">(proposition IA)</span></h4>
                              {iaAnalyse.score_progression != null && (
                                <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                                  iaAnalyse.score_progression >= 60 ? 'bg-emerald-100 text-emerald-700' :
                                  iaAnalyse.score_progression >= 30 ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
                                }`}>Progression : {iaAnalyse.score_progression}%</span>
                              )}
                            </div>
                            {iaAnalyse.synthese && <p className="text-sm text-slate-700">{iaAnalyse.synthese}</p>}
                            {iaAnalyse.pcm_adaptation && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                <div className="bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Communication :</span> {iaAnalyse.pcm_adaptation.communication}</div>
                                <div className="bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Management :</span> {iaAnalyse.pcm_adaptation.management}</div>
                              </div>
                            )}
                            {iaAnalyse.risque_decrochage && (
                              <div className={`text-xs rounded-lg p-2 border ${
                                iaAnalyse.risque_decrochage.niveau === 'eleve' ? 'bg-red-50 border-red-200 text-red-700' :
                                iaAnalyse.risque_decrochage.niveau === 'moyen' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                'bg-green-50 border-green-200 text-green-700'
                              }`}>
                                Risque décrochage : <strong>{iaAnalyse.risque_decrochage.niveau}</strong>
                                {iaAnalyse.risque_decrochage.facteurs?.length > 0 && ` — ${iaAnalyse.risque_decrochage.facteurs.join(', ')}`}
                              </div>
                            )}
                            {iaAnalyse.risque_decrochage?.signaux_alerte?.length > 0 && (
                              <div className="text-xs text-red-700 bg-red-50 rounded-lg p-2 border border-red-200">
                                <span className="font-semibold">Signaux d'alerte :</span> {iaAnalyse.risque_decrochage.signaux_alerte.join(' · ')}
                              </div>
                            )}
                            {iaAnalyse.freins_prioritaires?.length > 0 && (
                              <div className="text-xs"><span className="font-semibold text-violet-700">Freins prioritaires :</span> {iaAnalyse.freins_prioritaires.join(', ')}</div>
                            )}
                            {iaAnalyse.pcm_adaptation?.vigilances && (
                              <div className="text-xs bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Vigilances PCM :</span> {iaAnalyse.pcm_adaptation.vigilances}</div>
                            )}
                            {iaAnalyse.plan_action_propose?.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-violet-700 mb-1">Plan d'action proposé</p>
                                <div className="space-y-1">
                                  {iaAnalyse.plan_action_propose.map((a, i) => (
                                    <div key={i} className="text-xs bg-white rounded p-2 border flex justify-between">
                                      <span>{a.action}</span>
                                      <span className="text-gray-400 ml-2">{a.echeance}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {iaAnalyse.prochaine_etape && (
                              <div className="text-xs bg-teal-50 rounded-lg p-2 border border-teal-200 text-teal-800">
                                <strong>Prochaine étape :</strong> {iaAnalyse.prochaine_etape}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
