import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen, Download, FileText, Check, X, AlertTriangle, Minus, Clock, Settings, Users,
} from 'lucide-react';
import api from '../services/api';
import PageHeader from '../components/PageHeader';
import Section from '../components/Section';
import KPICard from '../components/KPICard';
import ErrorState from '../components/ErrorState';
import { useToast } from '../components/Toast';
import FseSortieForm from '../components/insertion/FseSortieForm';

/**
 * « Dossiers FSE+ — pièces à compléter » (maquette « Dossiers_FSE »).
 *
 * POURQUOI CET ÉCRAN. La complétude du dossier européen se contrôlait jusqu'ici
 * dossier par dossier, donc jamais : on ne découvre pas un questionnaire d'entrée
 * manquant en ouvrant quatorze fiches. Ici, une ligne par participant, une
 * colonne par pièce, et le tri « incomplets d'abord » — ce qui manque se voit
 * en un coup d'œil, et chaque case ouvre le champ manquant.
 *
 * Deux exports au bas de la page : le CSV NOMINATIF des participants (29
 * colonnes dictées par l'autorité, réservé au contrôle) et le bilan
 * d'exécution AGRÉGÉ (non nominatif, qui accompagne la demande de paiement).
 * Un export à zéro ligne est REFUSÉ par le serveur : le message le dit.
 */

const PIECES = [
  { cle: 'eligibilite', court: 'Éligib.', long: "Éligibilité IAE référencée" },
  { cle: 'pass_iae', court: 'Pass', long: 'Pass IAE' },
  { cle: 'referent_unique', court: 'Référent', long: 'Référent unique' },
  { cle: 'fse_entree', court: 'FSE+ entrée', long: "Questionnaire FSE+ d'entrée" },
  { cle: 'diagnostic_socle', court: 'Diag. socle', long: "Diagnostic d'accueil (socle)" },
  { cle: 'fse_sortie', court: 'Sortie', long: 'Questionnaire FSE+ de sortie' },
  { cle: 'sortie_delai', court: 'Saisie < 30 j', long: 'Statut de sortie saisi dans le mois' },
  { cle: 'six_mois', court: '+6 mois', long: 'Suivi à +6 mois' },
  { cle: 'remise_documents', court: 'Remise', long: 'Remise des documents tracée' },
];

const CASES = {
  complet: { fond: 'bg-emerald-50', icone: Check, couleur: 'text-emerald-600', titre: 'complet' },
  partiel: { fond: 'bg-amber-50', icone: AlertTriangle, couleur: 'text-amber-600', titre: 'en cours' },
  a_faire: { fond: 'bg-red-50', icone: X, couleur: 'text-red-600', titre: 'à faire' },
  sans_objet: { fond: 'bg-slate-50', icone: Minus, couleur: 'text-slate-300', titre: 'sans objet' },
};

/** Quatre trimestres glissants + l'année en cours — suffisant pour un contrôle. */
function periodesDisponibles() {
  const out = [];
  const d = new Date();
  let annee = d.getFullYear();
  let t = Math.ceil((d.getMonth() + 1) / 3);
  for (let i = 0; i < 6; i++) {
    out.push({ valeur: `${annee}-T${t}`, annee, trimestre: t, libelle: `${annee} · T${t}` });
    t -= 1;
    if (t === 0) { t = 4; annee -= 1; }
  }
  return out;
}

/** Télécharge un blob renvoyé par l'API (le jeton ne voyage pas dans une URL). */
function telecharger(blob, nom) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

export default function DossiersFSE() {
  const navigate = useNavigate();
  const toast = useToast();
  const periodes = useMemo(() => periodesDisponibles(), []);

  const [projets, setProjets] = useState([]);
  const [projetId, setProjetId] = useState(null);
  const [periode, setPeriode] = useState(periodes[0].valeur);
  const [data, setData] = useState(null);
  const [postes, setPostes] = useState([]);
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [incompletsDabord, setIncompletsDabord] = useState(true);
  const [exportEnCours, setExportEnCours] = useState(null);
  // Saisie directe depuis le tableau : une case rouge « Sortie » ou « +6 mois »
  // ouvre le formulaire correspondant. C'est le geste que la vue transversale
  // doit permettre — repérer un trou et devoir ouvrir une fiche pour le combler
  // fait perdre la moitié de l'intérêt de l'écran.
  const [saisie, setSaisie] = useState(null); // { employeeId, nom, mode }

  // Projets : le sélecteur se cale par défaut sur l'opération à participants
  // (ASI) — l'OCS porte des postes, pas des personnes.
  useEffect(() => {
    let vivant = true;
    api.get('/insertion/projets')
      .then((r) => {
        if (!vivant) return;
        const liste = Array.isArray(r.data) ? r.data : [];
        setProjets(liste);
        const defaut = liste.find((p) => p.type === 'asi' && p.actif) || liste[0];
        setProjetId(defaut ? defaut.id : null);
        if (!defaut) setChargement(false);
      })
      .catch((err) => { if (vivant) { setErreur(err.response?.data?.error || err.message); setChargement(false); } });
    return () => { vivant = false; };
  }, []);

  const charger = useCallback(() => {
    if (!projetId) return undefined;
    let vivant = true;
    setChargement(true);
    api.get(`/insertion/conformite?projet=${projetId}&periode=${periode}`)
      .then((r) => { if (vivant) { setData(r.data); setErreur(null); } })
      .catch((err) => { if (vivant) { setErreur(err.response?.data?.error || err.message); setData(null); } })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [projetId, periode]);

  useEffect(() => charger(), [charger]);

  // Postes affectés : bloc « Projet OCS » de la maquette. Chargés pour le projet
  // OCS actif, indépendamment du projet sélectionné dans le tableau.
  useEffect(() => {
    const ocs = projets.find((p) => p.type === 'ocs' && p.actif);
    if (!ocs) { setPostes([]); return; }
    api.get(`/insertion/projets/${ocs.id}/postes`)
      .then((r) => setPostes(Array.isArray(r.data) ? r.data.map((x) => ({ ...x, projet: ocs })) : []))
      .catch(() => setPostes([]));
  }, [projets]);

  const projet = projets.find((p) => p.id === projetId) || null;
  const participants = useMemo(() => {
    const l = [...(data?.participants || [])];
    if (incompletsDabord) l.sort((a, b) => (b.a_faire?.length || 0) - (a.a_faire?.length || 0));
    return l;
  }, [data, incompletsDabord]);

  const aTraiter = participants.filter((p) => (p.pieces?.fse_sortie === 'a_faire' || p.pieces?.fse_entree === 'a_faire')).length;
  const sixMoisEchus = participants.filter((p) => p.pieces?.six_mois === 'a_faire').length;

  const lancerExport = async (type) => {
    if (!projet) return;
    const p = periodes.find((x) => x.valeur === periode) || periodes[0];
    setExportEnCours(type);
    try {
      if (type === 'csv') {
        const r = await api.get(
          `/exports/fse-plus?projet=${projet.id}&annee=${p.annee}&trimestre=${p.trimestre}`,
          { responseType: 'blob' }
        );
        telecharger(r.data, `fse-participants_${projet.code}_${p.annee}_T${p.trimestre}.csv`);
        toast.success('Export FSE+ téléchargé.');
      } else {
        const r = await api.get(`/exports/fse-plus/bilan?projet=${projet.id}&annee=${p.annee}`);
        telecharger(
          new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }),
          `fse-bilan-execution_${projet.code}_${p.annee}.json`
        );
        toast.success("Bilan d'exécution téléchargé.");
      }
    } catch (err) {
      // Le refus « zéro ligne » (409) est une RÉPONSE, pas une panne : on
      // affiche son motif tel quel plutôt qu'un « erreur réseau » générique.
      let message = err.response?.data?.error || err.message;
      if (err.response?.data instanceof Blob) {
        try { message = JSON.parse(await err.response.data.text()).error || message; } catch (_) { /* blob illisible */ }
      }
      toast.error(message);
    }
    setExportEnCours(null);
  };

  const ouvrirFiche = (employeeId) => navigate(`/insertion?employee=${employeeId}`);

  return (
    <div>
      <PageHeader
        title="Dossiers FSE+ — pièces à compléter"
        subtitle={projet ? `${projet.nom} · ${periodes.find((p) => p.valeur === periode)?.libelle || ''}` : 'Aucune opération cofinancée'}
        icon={FolderOpen}
        actions={(
          <button type="button" onClick={() => navigate('/admin/insertion')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            <Settings className="w-4 h-4" aria-hidden="true" /> Réglages des projets
          </button>
        )}
      />

      {erreur && !data && (
        <ErrorState variant="card" title="Dossiers FSE+ indisponibles" message={erreur} onRetry={charger} className="mb-4" />
      )}

      {/* 4 indicateurs de la maquette */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KPICard title="Participants" value={data ? data.nb_total : '—'} icon={Users}
          footer={<span className="text-xs text-slate-500">{projet ? projet.code : 'projet non sélectionné'}</span>}
          loading={chargement && !data} />
        <KPICard title="Dossiers complets" accent="emerald"
          value={data ? `${data.nb_complets} / ${data.nb_total}` : '—'} icon={Check}
          footer={<span className="text-xs text-slate-500">{data?.taux_completude != null ? `${data.taux_completude} %` : 'rien à mesurer'}</span>}
          loading={chargement && !data} />
        <KPICard title="À traiter (entrée ou sortie)" accent="red" value={data ? aTraiter : '—'} icon={AlertTriangle}
          footer={<span className="text-xs text-slate-500">questionnaires manquants</span>}
          loading={chargement && !data} />
        <KPICard title="Relevés à +6 mois échus" accent="amber" value={data ? sixMoisEchus : '—'} icon={Clock}
          footer={<span className="text-xs text-slate-500">indicateur de résultat</span>}
          loading={chargement && !data} />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={projetId || ''} onChange={(e) => setProjetId(parseInt(e.target.value, 10))}
          className="input-modern py-1.5 text-sm" aria-label="Opération cofinancée">
          {projets.length === 0 && <option value="">Aucune opération</option>}
          {projets.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nom}</option>)}
        </select>
        <select value={periode} onChange={(e) => setPeriode(e.target.value)}
          className="input-modern py-1.5 text-sm" aria-label="Période">
          {periodes.map((p) => <option key={p.valeur} value={p.valeur}>{p.libelle}</option>)}
        </select>
        <button type="button" onClick={() => setIncompletsDabord((v) => !v)}
          className={`px-3 py-1.5 rounded-lg border text-sm ${incompletsDabord ? 'bg-teal-50 border-teal-300 text-teal-800' : 'bg-white border-slate-300 text-slate-600'}`}>
          Incomplets d'abord
        </button>
      </div>

      <Section
        title="Pièces par participant"
        subtitle="Chaque ligne ouvre la fiche du salarié · un export à zéro ligne est refusé, jamais un fichier vide"
        icon={FolderOpen}
        actions={(
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => lancerExport('csv')} disabled={!projet || exportEnCours === 'csv'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Download className="w-4 h-4" aria-hidden="true" />
              {exportEnCours === 'csv' ? 'Export…' : 'Export FSE+ (CSV)'}
            </button>
            <button type="button" onClick={() => lancerExport('bilan')} disabled={!projet || exportEnCours === 'bilan'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
              <FileText className="w-4 h-4" aria-hidden="true" />
              {exportEnCours === 'bilan' ? 'Bilan…' : "Bilan d'exécution (JSON)"}
            </button>
          </div>
        )}
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left font-medium px-4 py-2">Participant</th>
                {PIECES.map((p) => (
                  <th key={p.cle} className="font-medium px-2 py-2 text-center whitespace-nowrap" title={p.long}>{p.court}</th>
                ))}
                <th className="text-left font-medium px-4 py-2">À faire</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {participants.map((p) => (
                <tr key={p.employee_id} className="hover:bg-slate-50/60 cursor-pointer"
                  onClick={() => ouvrirFiche(p.employee_id)}>
                  <td className="px-4 py-2">
                    <div className="font-semibold text-slate-800">{(p.nom || '').toUpperCase()} {p.prenom}</div>
                    <div className="text-[11px] text-slate-400">
                      {p.date_entree_projet ? `entré le ${new Date(p.date_entree_projet).toLocaleDateString('fr-FR')}` : ''}
                      {p.contract_end ? ` · fin de contrat ${new Date(p.contract_end).toLocaleDateString('fr-FR')}` : ''}
                    </div>
                  </td>
                  {PIECES.map((piece) => {
                    const etat = p.pieces?.[piece.cle] || 'sans_objet';
                    const c = CASES[etat] || CASES.sans_objet;
                    const Icone = c.icone;
                    // Seules les deux pièces saisissables depuis cet écran sont
                    // cliquables ; les autres se complètent dans la fiche.
                    const modeSaisie = etat === 'a_faire'
                      ? ({ fse_sortie: 'sortie', sortie_delai: 'sortie', six_mois: 'six_mois' }[piece.cle] || null)
                      : null;
                    const titre = `${piece.long} — ${c.titre}${p.details?.[piece.cle] ? ` (${p.details[piece.cle]})` : ''}`
                      + (modeSaisie ? ' · cliquez pour saisir' : '');
                    return (
                      <td key={piece.cle} className={`px-2 py-2 text-center ${c.fond}`} title={titre}>
                        {modeSaisie ? (
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); setSaisie({ employeeId: p.employee_id, nom: `${(p.nom || '').toUpperCase()} ${p.prenom}`, mode: modeSaisie }); }}
                            className="rounded p-0.5 hover:bg-white/70" aria-label={`${piece.long} : ${c.titre} — saisir`}>
                            <Icone className={`w-4 h-4 ${c.couleur}`} />
                          </button>
                        ) : (
                          <Icone className={`w-4 h-4 inline ${c.couleur}`} aria-label={`${piece.long} : ${c.titre}`} />
                        )}
                      </td>
                    );
                  })}
                  <td className={`px-4 py-2 text-[12px] ${p.a_faire?.length ? 'text-red-700' : 'text-slate-400'}`}>
                    {p.a_faire?.length ? p.a_faire.join(' · ') : 'complet'}
                  </td>
                </tr>
              ))}
              {participants.length === 0 && !chargement && (
                <tr>
                  <td colSpan={PIECES.length + 2} className="px-4 py-8 text-center text-sm text-slate-500">
                    Aucun participant rattaché à cette opération sur la période.
                    {' '}Les rattachements se saisissent dans les réglages du module — ils ne sont jamais déduits d'un statut.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {saisie && (
        <FseSortieForm
          employeeId={saisie.employeeId}
          mode={saisie.mode}
          onClose={() => setSaisie(null)}
          onSaved={() => charger()}
        />
      )}

      {/* Bloc OCS — postes et quotités (amendement F2 de l'autorité) */}
      <div className="mt-4">
        <Section title="Projet OCS — postes affectés" icon={Clock}
          subtitle="Quotité d'affectation et taux forfaitaire : sans eux, une feuille de temps ne se rattache à aucun plan de financement">
          {postes.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucun poste affecté à une opération en coûts simplifiés. Les postes et leurs quotités se saisissent
              dans les réglages du module.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {postes.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <span className="font-medium text-slate-800">{(p.last_name || '').toUpperCase()} {p.first_name}</span>
                    <span className="text-[12px] text-slate-500 ml-2">
                      quotité affectée {Number(p.quotite_pct)} %
                      {p.projet?.taux_forfaitaire_pct != null ? ` · taux forfaitaire ${Number(p.projet.taux_forfaitaire_pct)} %` : ' · taux forfaitaire non paramétré'}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {p.date_debut ? `du ${new Date(p.date_debut).toLocaleDateString('fr-FR')}` : ''}
                    {p.date_fin ? ` au ${new Date(p.date_fin).toLocaleDateString('fr-FR')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-400 mt-3">
            La feuille de temps mensuelle par intervenant arrive avec la PR B : tant qu'elle n'est pas déployée,
            le bilan d'exécution indique « non comptabilisable » plutôt qu'un zéro.
          </p>
        </Section>
      </div>
    </div>
  );
}
