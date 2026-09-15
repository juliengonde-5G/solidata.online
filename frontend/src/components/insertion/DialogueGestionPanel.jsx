import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Printer, History, RefreshCw, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import { exportDialogueGestionPDF } from './pdf-dialogue-gestion';

/**
 * Onglet « Dialogue de gestion » de l'audit insertion (PR D lot 6, contrat § 6).
 *
 * ═══ QUATRE GESTES, VOLONTAIREMENT DISTINCTS ══════════════════════════════
 *  · APERÇU — on regarde avant d'envoyer. Rien n'est enregistré.
 *  · GÉNÉRER ET ENREGISTRER (ADMIN/RH) — fige un snapshot daté et journalisé.
 *    C'est la pièce qui part à l'autorité ; elle doit pouvoir être rejouée
 *    telle quelle dans six mois, quand le dossier aura changé.
 *  · CSV — le même document, à plat, pour l'instructrice qui recalcule.
 *  · HISTORIQUE — rejouer une génération passée en PDF, depuis son snapshot.
 *
 * ═══ CE QUE L'ÉCRAN DIT TOUJOURS ══════════════════════════════════════════
 * La liste des agrégats non rendus par le seuil de confidentialité, en clair.
 * Un document qui masque sans le dire laisse croire à un chiffre à zéro.
 *
 * Aucun `alert()` ni `window.confirm` : les erreurs vivent dans un bandeau.
 */

const TIMEOUT = 120000;

const frDateHeure = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('fr-FR');
};

/** Message d'erreur lisible — jamais un objet brut, jamais une boîte native. */
function messageErreur(err, defaut) {
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return "La composition de la synthèse a dépassé le délai d'attente. Réessayez.";
  }
  const d = err?.response?.data;
  if (d?.code === 'EXPORT_VIDE') return `${d.error}${d.hint ? ` — ${d.hint}` : ''}`;
  return (d?.error || err?.message || defaut) + (d?.hint ? ` — ${d.hint}` : '');
}

/** Petite carte d'indicateur de tête, avec sa mention quand la valeur manque. */
function Tuile({ label, valeur, sub, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    teal: 'bg-teal-50 border-teal-100 text-teal-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{valeur ?? <span className="text-base font-normal opacity-60">non rendu</span>}</div>
      {sub && <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function DialogueGestionPanel({ year, canGenerer = false }) {
  const [annee, setAnnee] = useState(year || new Date().getFullYear());
  const [trimestre, setTrimestre] = useState('');
  const [contenu, setContenu] = useState(null);
  const [enregistre, setEnregistre] = useState(null); // { id, genere_le }
  const [chargement, setChargement] = useState(false);
  const [action, setAction] = useState(null); // 'apercu' | 'generer' | 'csv'
  const [erreur, setErreur] = useState(null);
  const [info, setInfo] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [histoOuvert, setHistoOuvert] = useState(false);

  useEffect(() => { setAnnee(year || new Date().getFullYear()); }, [year]);

  const qs = useCallback(() => {
    const p = new URLSearchParams({ annee: String(annee) });
    if (trimestre) p.set('trimestre', trimestre);
    return p.toString();
  }, [annee, trimestre]);

  const chargerHistorique = useCallback(() => {
    api.get('/insertion/reporting/dialogue-gestion/historique?limit=25')
      .then((r) => setHistorique(Array.isArray(r.data) ? r.data : []))
      .catch(() => setHistorique([]));
  }, []);

  useEffect(() => { chargerHistorique(); }, [chargerHistorique]);

  // La période change → l'aperçu affiché ne correspond plus : on l'efface
  // plutôt que de laisser lire des chiffres qui ne sont plus ceux du sélecteur.
  useEffect(() => { setContenu(null); setEnregistre(null); setInfo(null); }, [annee, trimestre]);

  const apercu = async () => {
    setChargement(true); setAction('apercu'); setErreur(null); setInfo(null);
    try {
      const r = await api.get(`/insertion/reporting/dialogue-gestion?${qs()}`, { timeout: TIMEOUT });
      setContenu(r.data);
      setEnregistre(null);
    } catch (err) {
      setContenu(null);
      setErreur(messageErreur(err, "Impossible de composer la synthèse."));
    }
    setChargement(false); setAction(null);
  };

  const generer = async () => {
    setChargement(true); setAction('generer'); setErreur(null); setInfo(null);
    try {
      const body = { annee };
      if (trimestre) body.trimestre = Number(trimestre);
      const r = await api.post('/insertion/reporting/dialogue-gestion', body, { timeout: TIMEOUT });
      setContenu(r.data.contenu);
      setEnregistre({ id: r.data.id, genere_le: r.data.genere_le });
      chargerHistorique();
      const ok = exportDialogueGestionPDF(r.data.contenu);
      setInfo(ok
        ? `Synthèse enregistrée (n° ${r.data.id}) et ouverte pour impression.`
        : `Synthèse enregistrée (n° ${r.data.id}). La fenêtre d'impression a été bloquée par le navigateur — autorisez les fenêtres pour ce site, puis rejouez la synthèse depuis l'historique.`);
    } catch (err) {
      setErreur(messageErreur(err, "Impossible d'enregistrer la synthèse."));
    }
    setChargement(false); setAction(null);
  };

  const imprimer = () => {
    if (!contenu) return;
    const ok = exportDialogueGestionPDF(contenu);
    if (!ok) setErreur("La fenêtre d'impression a été bloquée par le navigateur — autorisez les fenêtres pour ce site.");
  };

  const telechargerCsv = async () => {
    setChargement(true); setAction('csv'); setErreur(null); setInfo(null);
    try {
      const res = await api.get(`/insertion/reporting/dialogue-gestion?${qs()}&format=csv`,
        { responseType: 'blob', timeout: TIMEOUT });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dialogue-gestion_${annee}${trimestre ? `_T${trimestre}` : ''}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      // Le corps d'une erreur arrive en blob quand la réponse était attendue en
      // blob : on le relit pour rendre le motif du refus (409 EXPORT_VIDE).
      let msg = "Impossible de générer le fichier CSV.";
      try {
        const txt = await err.response?.data?.text?.();
        if (txt) {
          const j = JSON.parse(txt);
          msg = `${j.error || msg}${j.hint ? ` — ${j.hint}` : ''}`;
        }
      } catch { /* message générique */ }
      setErreur(msg);
    }
    setChargement(false); setAction(null);
  };

  const rejouer = async (id) => {
    setErreur(null); setInfo(null);
    try {
      const r = await api.get(`/insertion/reporting/dialogue-gestion/${id}`, { timeout: TIMEOUT });
      const ok = exportDialogueGestionPDF(r.data);
      if (!ok) setErreur("La fenêtre d'impression a été bloquée par le navigateur — autorisez les fenêtres pour ce site.");
      else setInfo(`Synthèse n° ${id} rejouée telle qu'elle a été transmise.`);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de relire cette synthèse.'));
    }
  };

  const anneeOptions = [];
  for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 5; y--) anneeOptions.push(y);

  const b6 = contenu?.blocs?.['6_sorties']?.methode_b;
  const b2 = contenu?.blocs?.['2_publics_entree'];
  const b1 = contenu?.blocs?.['1_effectifs_etp'];
  const sousSeuil = contenu?.sous_seuil || [];
  // `sous_seuil` compte par BLOC depuis le correctif B-01 ; `sous_seuil_total`
  // dit combien d'indicateurs sont concernés en tout.
  const total = contenu?.sous_seuil_total ?? sousSeuil.reduce((a, b) => a + (b.nb || 0), 0);

  return (
    <div className="space-y-4">
      {/* Ce que le document est, en une phrase — l'écran ne doit pas laisser
          croire qu'il s'agit d'un tableau de bord interne de plus. */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-600" /> Synthèse de dialogue de gestion
            </h3>
            <p className="text-[11px] text-gray-500 mt-1 max-w-2xl">
              Le document transmis à l'autorité <strong>quinze jours avant la séance</strong> : neuf blocs imposés,
              dont une page « Méthode » qui écrit la règle de calcul de chaque taux.
              <strong> Strictement non nominatif</strong> — aucun nom, aucun identifiant, et tout agrégat
              portant sur moins de 5 personnes est retiré et signalé.
            </p>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-100 inline-flex items-center gap-1 whitespace-nowrap">
            <ShieldCheck className="w-3 h-3" /> Agrégats seuls
          </span>
        </div>

        {/* Sélecteurs + actions */}
        <div className="mt-4 flex items-end gap-2 flex-wrap">
          <div>
            <label htmlFor="dg-annee" className="block text-xs text-gray-500 mb-0.5">Année</label>
            <select id="dg-annee" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}
              className="input-modern py-1.5 text-sm">
              {anneeOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dg-trim" className="block text-xs text-gray-500 mb-0.5">Période</label>
            <select id="dg-trim" value={trimestre} onChange={(e) => setTrimestre(e.target.value)}
              className="input-modern py-1.5 text-sm">
              <option value="">Année complète (9 blocs)</option>
              {[1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t} — version allégée (blocs 2 et 8)</option>)}
            </select>
          </div>
          <button type="button" onClick={apercu} disabled={chargement}
            className="btn-ghost text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${chargement && action === 'apercu' ? 'animate-spin' : ''}`} />
            {chargement && action === 'apercu' ? 'Composition…' : 'Aperçu'}
          </button>
          <button type="button" onClick={telechargerCsv} disabled={chargement}
            className="btn-ghost text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download className="w-4 h-4" /> {chargement && action === 'csv' ? 'Export…' : 'CSV'}
          </button>
          {contenu && (
            <button type="button" onClick={imprimer}
              className="btn-ghost text-sm inline-flex items-center gap-1.5">
              <Printer className="w-4 h-4" /> Imprimer l'aperçu
            </button>
          )}
          {canGenerer && (
            <button type="button" onClick={generer} disabled={chargement}
              title="Fige un exemplaire daté, journalisé, rejouable à l'identique"
              className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              {chargement && action === 'generer' ? 'Enregistrement…' : 'Générer et enregistrer (PDF)'}
            </button>
          )}
        </div>
        {!canGenerer && (
          <p className="text-[11px] text-gray-400 mt-2">
            L'enregistrement d'un exemplaire daté est réservé aux profils ADMIN / RH : il produit une pièce
            qui engage la structure vis-à-vis de son financeur.
          </p>
        )}

        {erreur && <div className="mt-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{erreur}</div>}
        {info && <div className="mt-3 text-xs bg-teal-50 border border-teal-200 text-teal-800 rounded-lg p-2.5">{info}</div>}
      </div>

      {/* Aperçu — les têtes de chapitre, pas le document entier : le document
          entier, c'est le PDF. */}
      {contenu && (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="font-semibold text-gray-800">
              Aperçu — {contenu.en_tete?.trimestre
                ? `${contenu.en_tete.annee} T${contenu.en_tete.trimestre} (allégée)`
                : `année ${contenu.en_tete?.annee}`}
            </h4>
            <span className="text-[11px] text-gray-400">
              Composé le {frDateHeure(contenu.en_tete?.genere_le)} · rôle {contenu.en_tete?.genere_par_role || '—'}
              {enregistre ? ` · enregistré sous le n° ${enregistre.id}` : ' · non enregistré'}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tuile label="Cohorte de la période" valeur={b2?.indisponible ? null : b2?.effectif}
              sub="personnes dont le parcours chevauche la période" tone="teal" />
            {b1 && (
              <Tuile label="ETP ASP moyen" valeur={b1.etp_asp_moyen}
                sub={b1.etp_conventionnes == null
                  ? 'objectif non paramétré'
                  : `cible ${b1.etp_conventionnes} ETP · base ${b1.base_heures} h`} />
            )}
            {b6 && (
              <>
                <Tuile label="Fins de parcours (méthode B)" valeur={b6.denominateur}
                  sub={`${b6.documentees} documentée(s)`} />
                <Tuile label="Sorties non documentées" valeur={b6.non_documentees}
                  sub="indicateur de qualité de la saisie, pas une faute"
                  tone={b6.non_documentees > 0 ? 'amber' : 'slate'} />
              </>
            )}
          </div>

          {/* Les agrégats retirés sont DITS : un document qui masque sans le
              dire laisse croire à un chiffre à zéro. */}
          <div className={`rounded-lg border p-3 text-xs ${total ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
            {total === 0 ? (
              <>Aucun agrégat n'a été retiré au titre du seuil de confidentialité.</>
            ) : (
              <>
                <strong>{total} indicateur(s) non rendu(s)</strong> : moins de{' '}
                {contenu.en_tete?.k_anonymat || 5} personnes concernées. Les valeurs à zéro, elles, sont conservées —
                « personne dans cette catégorie » ne désigne personne.
                <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
                  {sousSeuil.map((b) => (
                    <li key={b.bloc}>{b.libelle || b.bloc} : <strong>{b.nb}</strong></li>
                  ))}
                </ul>
                {/* Le CHEMIN exact de la case retirée n'est pas publié : sur une
                    ventilation qui somme à un effectif publié, il désignerait la
                    case à reconstituer par soustraction. Le détail non masqué se
                    lit dans l'onglet « Pilotage », qui n'applique aucun seuil. */}
                <p className="mt-1.5 text-[10px] opacity-80">
                  Le détail chiffré, sans suppression, se consulte dans l'onglet « Pilotage » — il ne sort
                  pas de la structure.
                </p>
              </>
            )}
          </div>

          <p className="text-[11px] text-gray-400">
            L'aperçu ne montre que les têtes de chapitre. Le document complet — les neuf blocs et la page
            « Méthode » — s'obtient par « Imprimer l'aperçu » ou « Générer et enregistrer ».
          </p>
        </div>
      )}

      {/* Historique des générations enregistrées */}
      <div className="bg-white rounded-xl border p-5">
        <button type="button" onClick={() => setHistoOuvert((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left">
          <h4 className="font-semibold text-gray-800 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" /> Synthèses déjà transmises ({historique.length})
          </h4>
          <span className="text-xs text-gray-400">{histoOuvert ? 'Replier' : 'Déplier'}</span>
        </button>
        {histoOuvert && (
          <div className="mt-3">
            <p className="text-[11px] text-gray-400 mb-2">
              Rejouer une synthèse imprime <strong>ce qui a été transmis</strong>, et non ce que le dossier dit
              aujourd'hui : c'est l'objet de l'enregistrement.
            </p>
            {historique.length === 0 ? (
              <p className="text-sm text-gray-400 border border-dashed rounded-lg p-3 text-center">
                Aucune synthèse enregistrée pour l'instant.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-gray-400 border-b">
                      <th className="py-1.5 pr-2">Période</th>
                      <th className="py-1.5 pr-2">Type</th>
                      <th className="py-1.5 pr-2">Générée le</th>
                      <th className="py-1.5 pr-2">Par</th>
                      <th className="py-1.5 pr-2">Version</th>
                      <th className="py-1.5"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historique.map((h) => (
                      <tr key={h.id} className="border-b border-gray-50">
                        <td className="py-1.5 pr-2 font-medium text-gray-700">
                          {h.annee}{h.trimestre ? ` — T${h.trimestre}` : ''}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-500 text-xs">
                          {h.trimestre ? 'Trimestrielle allégée' : 'Annuelle'}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-500 text-xs">{frDateHeure(h.genere_le)}</td>
                        <td className="py-1.5 pr-2 text-gray-500 text-xs">
                          {h.genere_par || '—'}{h.genere_par_role ? ` (${h.genere_par_role})` : ''}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-400 text-xs">{h.version || '—'}</td>
                        <td className="py-1.5 text-right">
                          <button type="button" onClick={() => rejouer(h.id)}
                            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1">
                            <Printer className="w-3 h-3" /> Rejouer
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
