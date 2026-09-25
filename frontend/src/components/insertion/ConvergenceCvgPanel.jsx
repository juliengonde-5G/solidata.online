import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Download, Printer, History, RefreshCw, ShieldCheck, GitCompare, ListChecks, Users, Plus, Pencil, Trash2, Save, X, Lock,
} from 'lucide-react';
import api from '../../services/api';
import { exportConvergenceCvgPDF } from './pdf-convergence-cvg';
import {
  partiesCvg, blocJumeau, lignesSimples, lignesDoubles, valeurSimple, nonRenseigne, cellule, pctDe,
  LIGNES_EFFECTIFS, LIGNES_PUBLICS, LIGNES_HABITAT, LIGNES_FREINS, LIGNES_ORIENTEURS,
  LIGNES_SORTIE_EMPLOI, LIGNES_SORTIE_HORS_EMPLOI, LIGNES_SANTE,
  fmtNb, fmtPct, sommeEtp, phrasesMethode, periodeTexte, MENTION_NON_TRANSMIS, legendeSecret, ligneSecrete,
} from './convergence-cvg-structure';

/**
 * Onglet « Convergence (CVG) » de l'audit insertion (lot 2.60.0, contrat 30 § 2.4).
 *
 * Le document que le réseau Convergence France demande pour son dialogue de
 * gestion (programme CVG) : Partie 1 — le public, Partie 2 — les moyens
 * humains, puis les sortis en emploi / hors emploi. Même doctrine que la
 * synthèse de dialogue de gestion :
 *  · APERÇU — on regarde avant d'envoyer, rien n'est enregistré ;
 *  · GÉNÉRER ET ENREGISTRER — fige un instantané daté, rejouable à l'identique ;
 *  · CSV — le même document, à plat ;
 *  · HISTORIQUE — rejouer un instantané passé.
 * S'y ajoutent : COMPARER deux périodes (écarts + lecture rédigée par le
 * serveur), COMPLÉTUDE (qui n'a pas encore les informations CVG — lien vers la
 * fiche) et le registre des MOYENS HUMAINS (Partie 2).
 *
 * L'écran ne SAISIT rien du parcours : chaque information CVG se renseigne là
 * où elle naît (diagnostic à l'entrée, bilan de sortie à la sortie). Il lit, et
 * il nomme ce qui manque. Réservé ADMIN / RH.
 *
 * Une valeur absente s'affiche « — », jamais 0. Aucune boîte native.
 */

const TIMEOUT = 120000;

const iso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
};

const frDateHeure = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('fr-FR');
};

/** Semestres Convergence autour de la date du jour (1ᵉʳ avril → 30 sept., 1ᵉʳ oct. → 31 mars). */
function semestresConvergence(auj = new Date()) {
  const y = auj.getFullYear();
  const m = auj.getMonth(); // 0 = janvier
  // Semestre courant : avril-septembre si mois ∈ [3..8], sinon octobre-mars.
  let debut;
  if (m >= 3 && m <= 8) debut = new Date(y, 3, 1);
  else if (m >= 9) debut = new Date(y, 9, 1);
  else debut = new Date(y - 1, 9, 1);
  const liste = [];
  for (let i = 1; i >= -3; i--) {
    const d = new Date(debut.getFullYear(), debut.getMonth() + 6 * i, 1);
    const f = new Date(d.getFullYear(), d.getMonth() + 6, 0);
    const avril = d.getMonth() === 3;
    const label = avril
      ? `Avril → septembre ${d.getFullYear()}`
      : `Octobre ${d.getFullYear()} → mars ${d.getFullYear() + 1}`;
    liste.push({ debut: iso(d), fin: iso(f), label: `${label}${i === 0 ? ' (en cours)' : i > 0 ? ' (à venir)' : ''}`, courant: i === 0 });
  }
  return liste;
}

function messageErreur(err, defaut) {
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return "La composition du document a dépassé le délai d'attente. Réessayez.";
  }
  const d = err?.response?.data;
  if (d?.code === 'EXPORT_VIDE') {
    return `${d.error || "Aucun salarié accueilli ni sorti sur cette période : il n'y a rien à transmettre."}${d.hint ? ` — ${d.hint}` : ''}`;
  }
  return (d?.error || err?.message || defaut) + (d?.hint ? ` — ${d.hint}` : '');
}

/** Relit le motif d'une erreur reçue en blob (réponse attendue en fichier). */
async function messageErreurBlob(err, defaut) {
  try {
    const txt = await err.response?.data?.text?.();
    if (txt) {
      const j = JSON.parse(txt);
      if (j.code === 'EXPORT_VIDE') return `${j.error || 'Période vide : rien à exporter.'}${j.hint ? ` — ${j.hint}` : ''}`;
      return `${j.error || defaut}${j.hint ? ` — ${j.hint}` : ''}`;
    }
  } catch { /* message générique */ }
  return defaut;
}

const Tiret = () => <span className="text-gray-300">—</span>;
/** Case retenue au titre de la confidentialité (B-01) : « s », jamais « — » ni 0. */
const Secret = () => (
  <span className="text-slate-500 italic" title="Secret : effectif inférieur au seuil de confidentialité — case non diffusée">s</span>
);
const Nb = ({ v, secret }) => (secret ? <Secret /> : fmtNb(v) == null ? <Tiret /> : fmtNb(v));
const Pct = ({ v, secret }) => (secret ? <Secret /> : fmtPct(v) == null ? <Tiret /> : fmtPct(v));
const NonTransmis = () => <span className="text-[11px] italic text-slate-500">{MENTION_NON_TRANSMIS}</span>;

function NonRenseigne({ bloc, lignes }) {
  const nr = lignes || nonRenseigne(bloc);
  if (!nr || !nr.length) return null;
  return <p className="text-[11px] text-amber-700 mt-1">Non renseigné : {nr.join(' · ')}.</p>;
}

// ── Tableaux au format du formulaire ────────────────────────────────────────

function Bandeau({ children, colSpan }) {
  return (
    <tr><th colSpan={colSpan} className="bg-red-700 text-white text-center text-xs font-semibold py-1.5 px-2">{children}</th></tr>
  );
}

function TableSimple({ titre, entete = ['', 'nb', '%'], lignes, children }) {
  return (
    <table className="w-full text-sm border border-gray-300">
      <thead>
        {titre && <Bandeau colSpan={3}>{titre}</Bandeau>}
        <tr className="bg-orange-50 text-[11px] text-gray-600">
          <th className="text-left px-2 py-1 font-medium">{entete[0]}</th>
          <th className="text-right px-2 py-1 font-medium w-20">{entete[1]}</th>
          <th className="text-right px-2 py-1 font-medium w-24">{entete[2]}</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          l.inter ? (
            <tr key={`i${i}`} className="bg-orange-50">
              <td colSpan={3} className="text-center text-[11px] font-semibold uppercase text-gray-700 py-1">{l.inter}</td>
            </tr>
          ) : (
            <tr key={`${l.cle}${i}`} className={`border-t border-gray-200 ${l.bold ? 'font-semibold' : ''}`}>
              <td className={`px-2 py-1 ${l.indent ? 'pl-6 italic text-gray-600' : ''}`}>{l.libelle}</td>
              {l.nonTransmis ? (
                <td colSpan={2} className="px-2 py-1 text-right"><NonTransmis /></td>
              ) : (
                <>
                  <td className="px-2 py-1 text-right tabular-nums"><Nb v={l.nb} secret={l.secret} /></td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600"><Pct v={l.pct} secret={l.secret} /></td>
                </>
              )}
            </tr>
          )
        ))}
      </tbody>
      {children}
    </table>
  );
}

function TableDouble({ titre, col1, col2, lignes, note }) {
  return (
    <div>
      <table className="w-full text-sm border border-gray-300">
        <thead>
          <Bandeau colSpan={5}>{titre}</Bandeau>
          <tr className="bg-red-600 text-white text-[11px]">
            <th />
            <th colSpan={2} className="text-center px-2 py-1 font-medium">{col1}</th>
            <th colSpan={2} className="text-center px-2 py-1 font-medium">{col2}</th>
          </tr>
          <tr className="bg-orange-50 text-[11px] text-gray-600">
            <th />
            <th className="text-right px-2 py-1 font-medium w-16">nb</th>
            <th className="text-right px-2 py-1 font-medium w-20">%</th>
            <th className="text-right px-2 py-1 font-medium w-16">nb</th>
            <th className="text-right px-2 py-1 font-medium w-20">%</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle} className="border-t border-gray-200">
              <td className={`px-2 py-1 ${l.indent ? 'pl-6 italic' : ''}`}>{l.libelle}</td>
              {l.nonTransmis ? (
                <td colSpan={4} className="px-2 py-1 text-right"><NonTransmis /></td>
              ) : (
                <>
                  <td className="px-2 py-1 text-right tabular-nums"><Nb v={l.entree.nb} secret={l.entree.secret} /></td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600"><Pct v={l.entree.pct} secret={l.entree.secret} /></td>
                  <td className="px-2 py-1 text-right tabular-nums"><Nb v={l.sortie.nb} secret={l.sortie.secret} /></td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600"><Pct v={l.sortie.pct} secret={l.sortie.secret} /></td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="text-[11px] italic text-gray-400 mt-0.5">{note}</p>}
    </div>
  );
}

function TableauJumeau({ titre, structure, bloc, totalSorties, sousPop, postLibelle, nonTransmis = [] }) {
  const j = blocJumeau(bloc);
  const cTot = cellule(j.total);
  const base = cTot.nb ?? null;
  const cats = lignesSimples(j.categories, structure, totalSorties).filter((l) => !['total', 'sous_total'].includes(l.cle));
  const post = cellule(j.postSortie);
  const note = `Les % sont calculés sur le total des sorties ${sousPop}.`;
  return (
    <div className="space-y-3">
      <TableSimple titre={titre} entete={['', 'nombre', '% du total sorties']}
        lignes={[...cats, { cle: 'total', libelle: 'Total', nb: cTot.nb, pct: pctDe(cTot, totalSorties), bold: true }]} />
      <NonRenseigne lignes={j.nonRenseigne} />
      {j.confidentialite && (
        <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 flex items-start gap-1.5">
          <Lock className="w-3 h-3 mt-0.5 shrink-0" />
          Tableau de moins de {j.confidentialite.k} personnes : les lignes santé et justice, le logement et
          « dont parcours de soin » ne sont pas diffusés (« s ») — sa catégorie de sortie désigne les personnes.
        </p>
      )}
      <TableDouble titre="Évolution des freins" col1="Difficultés à l'entrée" col2="Résolution totale ou partielle à la sortie"
        lignes={lignesDoubles(j.freins, LIGNES_FREINS, base, { nonTransmis })} note={note} />
      <NonRenseigne bloc={j.freins} />
      <TableDouble titre="Évolution de la situation logement entrée / sortie" col1="Logement à l'entrée" col2="Logement à la sortie"
        lignes={lignesDoubles(j.logement, LIGNES_HABITAT, base)} note={note} />
      <NonRenseigne bloc={j.logement} />
      <TableDouble titre="Évolution de la situation santé entrée / sortie" col1="À l'entrée" col2="À la sortie"
        lignes={lignesDoubles(j.sante, LIGNES_SANTE, base)} note={note} />
      <NonRenseigne bloc={j.sante} />
      <TableSimple titre="Accompagnement post-sortie"
        lignes={[{ cle: 'post', libelle: postLibelle, nb: post.nb, pct: pctDe(post, base), secret: post.secret }]} />
    </div>
  );
}

function ApercuCvg({ contenu }) {
  const P = partiesCvg(contenu);
  const base = P.baseP1;
  const hab = lignesSimples(P.habitat, LIGNES_HABITAT, base).filter((l) => !['total', 'parcours_rue'].includes(l.cle));
  const totHab = cellule(P.habitat?.total);
  const rue = cellule(P.parcoursRue);
  const orient = lignesSimples(P.orienteurs, LIGNES_ORIENTEURS, base).filter((l) => l.cle !== 'total');
  const totOr = cellule(P.orienteurs?.total);
  const lignesP1 = [
    ...lignesSimples(P.publics, LIGNES_PUBLICS, base),
    { inter: "Type d'habitat à l'entrée du chantier" },
    ...hab,
    { cle: 'total_habitat', libelle: 'Total habitat', nb: totHab.nb, pct: pctDe(totHab, base), secret: totHab.secret, bold: true },
    { cle: 'parcours_rue', libelle: 'Personnes ayant connu un parcours de rue', nb: rue.nb, pct: pctDe(rue, base), secret: rue.secret, bold: true },
    { inter: "Difficultés à l'entrée" },
    ...lignesSimples(P.difficultes, LIGNES_FREINS, base, { nonTransmis: P.nonTransmis }),
    { inter: "Type d'orienteur (CVG)" },
    ...orient,
    { cle: 'total_orienteurs', libelle: 'Total orienteurs', nb: totOr.nb, pct: pctDe(totOr, base), secret: totOr.secret, bold: true },
  ];
  // Une case retenue n'est jamais laissée sans explication : légende dès qu'il y en a une.
  const aDesSecrets = lignesP1.some(ligneSecrete)
    || [P.emploi, P.horsEmploi].some((b) => !!(b && b.confidentialite));
  const kMin = P.confidentialite?.k_min;
  const nrP1 = [
    ['Publics', nonRenseigne(P.publics)], ['Habitat', nonRenseigne(P.habitat)],
    ['Difficultés', nonRenseigne(P.difficultes)], ['Orienteurs', nonRenseigne(P.orienteurs)],
  ].filter(([, n]) => n && n.length);

  const tInt = {
    total: P.totauxP2?.internes_etp_total ?? sommeEtp(P.internes, 'etp_total'),
    acc: P.totauxP2?.internes_etp_accompagnement ?? sommeEtp(P.internes, 'etp_accompagnement'),
    enc: P.totauxP2?.internes_etp_encadrement ?? sommeEtp(P.internes, 'etp_encadrement'),
  };
  const tMut = P.totauxP2?.mutualisees_etp_total ?? sommeEtp(P.mutualisees, 'etp_total');
  const tCvg = P.totauxP2?.total ?? (tInt.total == null && tMut == null ? null
    : Math.round(((tInt.total || 0) + (tMut || 0)) * 100) / 100);
  const methode = phrasesMethode(P.methode);

  return (
    <div className="space-y-6">
      {P.mentionDiffusion && (
        <div className="text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-2.5 flex items-start gap-2">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <span><strong>Diffusion restreinte.</strong> {P.mentionDiffusion}</span>
        </div>
      )}
      {aDesSecrets && <p className="text-[11px] text-slate-600">{legendeSecret(kMin)}</p>}
      {/* Partie 1 */}
      <section className="space-y-3">
        <h5 className="font-semibold text-gray-800 underline">Partie 1 : le public</h5>
        <table className="w-full max-w-xl text-sm border border-gray-300">
          <thead>
            <Bandeau colSpan={2}>Nombre de salariés en insertion en parcours CVG</Bandeau>
          </thead>
          <tbody>
            {LIGNES_EFFECTIFS.map(([cle, lib, opt = {}]) => {
              const x = valeurSimple(P.effectifs, cle, opt.alias);
              return (
                <tr key={cle} className="border-t border-gray-200">
                  <td className="px-2 py-1">{lib}</td>
                  <td className="px-2 py-1 text-right tabular-nums w-24">
                    {x == null && cle === 'etp_conventionnes'
                      ? <span className="text-[11px] text-gray-400">non paramétré</span> : <Nb v={x} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="max-w-2xl">
          <TableSimple titre="Les publics accompagnés dans CVG"
            entete={["Personnes salariées dans l'année", 'Nombre', '% / total CVG']} lignes={lignesP1} />
          {nrP1.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-1">
              Non renseigné — {nrP1.map(([b, n]) => `${b} : ${n.join(', ')}`).join(' · ')}.
            </p>
          )}
        </div>
      </section>

      {/* Partie 2 */}
      <section className="space-y-3">
        <h5 className="font-semibold text-gray-800 underline">
          Partie 2 : moyens humains dédiés à l'accompagnement socioprofessionnel et technique
        </h5>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-300">
            <thead>
              <tr>
                <th colSpan={2} className="bg-red-700 text-white text-left text-xs font-semibold py-1.5 px-2">Ressources internes</th>
                <th colSpan={3} className="bg-red-700 text-white text-center text-xs font-semibold py-1.5 px-2">Période en ETP</th>
              </tr>
              <tr className="bg-orange-50 text-[11px] text-gray-600">
                <th className="text-left px-2 py-1 font-medium">NOM Prénom</th>
                <th className="text-left px-2 py-1 font-medium">Fonction</th>
                <th className="text-right px-2 py-1 font-medium">Quotité totale</th>
                <th className="text-right px-2 py-1 font-medium">dont accompagnement</th>
                <th className="text-right px-2 py-1 font-medium">dont encadrement</th>
              </tr>
            </thead>
            <tbody>
              {P.internes.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-2 text-center text-xs text-gray-400">Aucune ressource interne au registre pour la période.</td></tr>
              )}
              {P.internes.map((r, i) => (
                <tr key={r.id ?? i} className="border-t border-gray-200">
                  <td className="px-2 py-1">{r.nom || <Tiret />}</td>
                  <td className="px-2 py-1">{r.fonction || <Tiret />}</td>
                  <td className="px-2 py-1 text-right tabular-nums"><Nb v={r.etp_total} /></td>
                  <td className="px-2 py-1 text-right tabular-nums"><Nb v={r.etp_accompagnement} /></td>
                  <td className="px-2 py-1 text-right tabular-nums"><Nb v={r.etp_encadrement} /></td>
                </tr>
              ))}
              <tr className="border-t border-gray-300 font-semibold bg-orange-50/60">
                <td className="px-2 py-1" colSpan={2}>Total ressources internes</td>
                <td className="px-2 py-1 text-right tabular-nums"><Nb v={tInt.total} /></td>
                <td className="px-2 py-1 text-right tabular-nums"><Nb v={tInt.acc} /></td>
                <td className="px-2 py-1 text-right tabular-nums"><Nb v={tInt.enc} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <table className="w-full max-w-2xl text-sm border border-gray-300">
          <thead>
            <tr>
              <th colSpan={2} className="bg-red-700 text-white text-left text-xs font-semibold py-1.5 px-2">Ressources mutualisées</th>
              <th className="bg-red-700 text-white text-center text-xs font-semibold py-1.5 px-2">Période en ETP</th>
            </tr>
            <tr className="bg-orange-50 text-[11px] text-gray-600">
              <th className="text-left px-2 py-1 font-medium">NOM Prénom</th>
              <th className="text-left px-2 py-1 font-medium">Fonction et employeur</th>
              <th className="text-right px-2 py-1 font-medium">Quotité affectée au chantier</th>
            </tr>
          </thead>
          <tbody>
            {P.mutualisees.length === 0 && (
              <tr><td colSpan={3} className="px-2 py-2 text-center text-xs text-gray-400">Aucune ressource mutualisée au registre pour la période.</td></tr>
            )}
            {P.mutualisees.map((r, i) => (
              <tr key={r.id ?? i} className="border-t border-gray-200">
                <td className="px-2 py-1">{r.nom || <Tiret />}</td>
                <td className="px-2 py-1">{[r.fonction, r.employeur].filter(Boolean).join(' — ') || <Tiret />}</td>
                <td className="px-2 py-1 text-right tabular-nums"><Nb v={r.etp_total} /></td>
              </tr>
            ))}
            <tr className="border-t border-gray-300 font-semibold bg-orange-50/60">
              <td className="px-2 py-1" colSpan={2}>Total ressources mutualisées</td>
              <td className="px-2 py-1 text-right tabular-nums"><Nb v={tMut} /></td>
            </tr>
          </tbody>
        </table>
        <div className="max-w-2xl flex items-center justify-between bg-red-700 text-white rounded px-3 py-2 text-sm font-semibold">
          <span>Total ressources CVG</span><span className="tabular-nums"><Nb v={tCvg} /></span>
        </div>
      </section>

      {/* Sorties */}
      <section className="space-y-4">
        <h5 className="font-semibold text-gray-800 underline">Situations des salariés CVG sortis sur la période</h5>
        <table className="w-full max-w-xl text-sm border border-gray-300">
          <tbody>
            <tr className="border-t border-gray-200">
              <td className="px-2 py-1">Nombre de salariés CVG sortis sur la période</td>
              <td className="px-2 py-1 text-right tabular-nums w-24"><Nb v={P.totalSorties} /></td>
            </tr>
            <tr className="border-t border-gray-200 font-semibold">
              <td className="px-2 py-1">Durée du parcours moyen en chantier des salariés sortis (mois)</td>
              <td className="px-2 py-1 text-right tabular-nums"><Nb v={P.dureeMoyenne} /></td>
            </tr>
          </tbody>
        </table>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <TableauJumeau titre="Salariés accédant à un emploi ou une formation à la sortie" structure={LIGNES_SORTIE_EMPLOI}
            bloc={P.emploi} totalSorties={P.totalSorties} sousPop="en emploi ou formation" nonTransmis={P.nonTransmis}
            postLibelle="Sortis en emploi ou formation ayant bénéficié d'un accompagnement post-sortie" />
          <TableauJumeau titre="Salariés n'accédant pas à l'emploi à la sortie" structure={LIGNES_SORTIE_HORS_EMPLOI}
            bloc={P.horsEmploi} totalSorties={P.totalSorties} sousPop="hors emploi" nonTransmis={P.nonTransmis}
            postLibelle="Sortis hors emploi ayant bénéficié d'un accompagnement post-sortie" />
        </div>
      </section>

      {methode.length > 0 && (
        <section>
          <h5 className="font-semibold text-gray-800 mb-1">Méthode</h5>
          <ol className="list-decimal ml-5 text-xs text-gray-600 space-y-1">
            {methode.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
        </section>
      )}
    </div>
  );
}

// ── Comparaison de deux périodes ────────────────────────────────────────────

/**
 * Couleur d'un écart. `sens` est fourni par le serveur ; formes acceptées :
 *  · 'favorable' / 'defavorable' / 'stable' (verdict déjà posé) ;
 *  · 'hausse_favorable' / 'baisse_favorable' / 'neutre', ou +1 / -1 / 0 (sens
 *    dans lequel une hausse est bonne) — combiné avec le signe de l'écart.
 * Sans sens connu ou sans écart : gris. La couleur double le signe, elle ne le
 * remplace jamais.
 */
function tonEcart(d) {
  const delta = d.delta_pts ?? d.delta_nb;
  if (delta === null || delta === undefined || Number(delta) === 0) return 'gris';
  const s = d.sens;
  if (s === 'favorable') return 'vert';
  if (s === 'defavorable') return 'rouge';
  if (s === 'stable' || s === 'neutre' || s === 0 || s == null) return 'gris';
  const hausseBonne = s === 'hausse_favorable' || s === 'hausse' || s === 1 || s === '+';
  const baisseBonne = s === 'baisse_favorable' || s === 'baisse' || s === -1 || s === '-';
  if (!hausseBonne && !baisseBonne) return 'gris';
  const hausse = Number(delta) > 0;
  return (hausse === hausseBonne) ? 'vert' : 'rouge';
}

const TON_CLASSE = { vert: 'text-green-700 bg-green-50', rouge: 'text-red-700 bg-red-50', gris: 'text-gray-500' };

const signe = (v, suffixe = '') => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  const txt = n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return `${n > 0 ? '+' : ''}${txt}${suffixe}`;
};

function Comparaison({ historique }) {
  const [mode, setMode] = useState('instantanes');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [per, setPer] = useState({ debut_a: '', fin_a: '', debut_b: '', fin_b: '' });
  const [resultat, setResultat] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    // Par défaut : les deux instantanés les plus récents, l'ancien en A.
    if (historique.length >= 2 && !a && !b) {
      setA(String(historique[1].id)); setB(String(historique[0].id));
    }
  }, [historique, a, b]);

  const comparer = async () => {
    setErreur(null); setResultat(null);
    let qs;
    if (mode === 'instantanes') {
      if (!a || !b) { setErreur('Choisissez deux instantanés.'); return; }
      if (a === b) { setErreur('Choisissez deux instantanés différents.'); return; }
      qs = new URLSearchParams({ a, b }).toString();
    } else {
      if (!per.debut_a || !per.fin_a || !per.debut_b || !per.fin_b) { setErreur('Renseignez les quatre dates.'); return; }
      if (per.debut_a > per.fin_a || per.debut_b > per.fin_b) { setErreur('Une date de début est postérieure à sa date de fin.'); return; }
      qs = new URLSearchParams(per).toString();
    }
    setChargement(true);
    try {
      const r = await api.get(`/insertion/convergence/comparaison?${qs}`, { timeout: TIMEOUT });
      setResultat(r.data);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de comparer ces deux périodes.'));
    }
    setChargement(false);
  };

  const groupes = useMemo(() => {
    const m = new Map();
    (resultat?.deltas || []).forEach((d) => {
      const k = d.bloc || 'Autres';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d);
    });
    return [...m.entries()];
  }, [resultat]);

  const libPeriode = (x) => {
    if (!x) return '—';
    const p = x.periode ?? x;
    return periodeTexte(typeof p === 'object' ? { debut: p.debut ?? p.periode_debut, fin: p.fin ?? p.periode_fin } : p);
  };

  return (
    <div className="bg-white rounded-xl border p-5 space-y-3">
      <h4 className="font-semibold text-gray-800 flex items-center gap-2">
        <GitCompare className="w-4 h-4 text-teal-600" /> Comparer deux périodes
      </h4>
      <p className="text-[11px] text-gray-500 max-w-3xl">
        L'écart se lit indicateur par indicateur, en nombre et en points de pourcentage, suivi d'une lecture
        rédigée. La lecture constate une évolution, elle n'en donne jamais la cause.
      </p>
      <div className="flex gap-3 text-sm">
        {[['instantanes', 'Deux instantanés enregistrés'], ['periodes', 'Deux périodes libres']].map(([k, l]) => (
          <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="cvg-cmp-mode" checked={mode === k} onChange={() => { setMode(k); setResultat(null); setErreur(null); }} />
            {l}
          </label>
        ))}
      </div>
      {mode === 'instantanes' ? (
        historique.length < 2 ? (
          <p className="text-xs text-gray-400 border border-dashed rounded-lg p-3">
            Il faut au moins deux instantanés enregistrés pour les comparer. Vous pouvez comparer deux périodes libres.
          </p>
        ) : (
          <div className="flex items-end gap-2 flex-wrap">
            {[['A (référence)', a, setA, 'cvg-a'], ['B (à comparer)', b, setB, 'cvg-b']].map(([l, val, set, id]) => (
              <div key={id}>
                <label htmlFor={id} className="block text-xs text-gray-500 mb-0.5">{l}</label>
                <select id={id} value={val} onChange={(e) => set(e.target.value)} className="input-modern py-1.5 text-sm">
                  <option value="">— choisir</option>
                  {historique.map((h) => (
                    <option key={h.id} value={h.id}>
                      n° {h.id} — {periodeTexte({ debut: h.periode_debut, fin: h.periode_fin })}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-3xl">
          {[['debut_a', 'Début A'], ['fin_a', 'Fin A'], ['debut_b', 'Début B'], ['fin_b', 'Fin B']].map(([k, l]) => (
            <div key={k}>
              <label htmlFor={`cvg-${k}`} className="block text-xs text-gray-500 mb-0.5">{l}</label>
              <input id={`cvg-${k}`} type="date" value={per[k]} onChange={(e) => setPer({ ...per, [k]: e.target.value })}
                className="input-modern py-1.5 text-sm w-full" />
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={comparer} disabled={chargement || (mode === 'instantanes' && historique.length < 2)}
        className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-1.5">
        <GitCompare className="w-4 h-4" /> {chargement ? 'Comparaison…' : 'Comparer'}
      </button>
      {erreur && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{erreur}</div>}

      {resultat && (
        <div className="space-y-3">
          <p className="text-xs text-gray-600">
            <strong>A</strong> : {libPeriode(resultat.a)} · <strong>B</strong> : {libPeriode(resultat.b)}
          </p>
          {resultat.methode_identique === false && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-2">
              Les deux documents n’ont pas été composés avec les mêmes réglages : les indicateurs concernés ne sont pas
              comparés (voir la lecture ci-dessous).
            </p>
          )}
          {groupes.length === 0 ? (
            <p className="text-sm text-gray-400">Aucun indicateur comparable.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-gray-400 border-b">
                    <th className="py-1.5 pr-2">Indicateur</th>
                    <th className="py-1.5 pr-2 text-right">A nb</th>
                    <th className="py-1.5 pr-2 text-right">A %</th>
                    <th className="py-1.5 pr-2 text-right">B nb</th>
                    <th className="py-1.5 pr-2 text-right">B %</th>
                    <th className="py-1.5 pr-2 text-right">Écart (nb)</th>
                    <th className="py-1.5 text-right">Écart (points)</th>
                  </tr>
                </thead>
                <tbody>
                  {groupes.map(([bloc, lignes]) => [
                    <tr key={`g-${bloc}`} className="bg-slate-50">
                      <td colSpan={7} className="py-1 px-1 text-[11px] font-semibold uppercase text-slate-600">{bloc}</td>
                    </tr>,
                    ...lignes.map((d, i) => {
                      const ton = tonEcart(d);
                      return (
                        <tr key={`${bloc}-${i}`} className="border-b border-gray-50">
                          <td className="py-1 pr-2 text-gray-700">
                            {d.indicateur}
                            {d.motif === 'methode' && (
                              <span className="ml-1 text-[10px] text-amber-700" title="Réglage de méthode différent entre les deux périodes">(méthode différente — non comparé)</span>
                            )}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums"><Nb v={d.a_nb} /></td>
                          <td className="py-1 pr-2 text-right tabular-nums text-gray-500"><Pct v={d.a_pct} /></td>
                          <td className="py-1 pr-2 text-right tabular-nums"><Nb v={d.b_nb} /></td>
                          <td className="py-1 pr-2 text-right tabular-nums text-gray-500"><Pct v={d.b_pct} /></td>
                          <td className={`py-1 pr-2 text-right tabular-nums rounded ${TON_CLASSE[ton]}`}>{signe(d.delta_nb) ?? <Tiret />}</td>
                          <td className={`py-1 text-right tabular-nums rounded ${TON_CLASSE[ton]}`}>{signe(d.delta_pts, ' pt') ?? <Tiret />}</td>
                        </tr>
                      );
                    }),
                  ])}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-gray-400">
            Vert : évolution favorable · rouge : évolution défavorable · gris : stable ou sans sens attendu.
          </p>
          {Array.isArray(resultat.lecture) && resultat.lecture.length > 0 && (
            <div className="rounded-lg border border-teal-100 bg-teal-50/60 p-3">
              <p className="text-xs font-semibold text-teal-900 mb-1">Lecture de l'évolution</p>
              <ul className="list-disc ml-5 text-sm text-gray-700 space-y-1">
                {resultat.lecture.map((ph, i) => <li key={i}>{ph}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Complétude ──────────────────────────────────────────────────────────────

function Completude({ debut, fin }) {
  const navigate = useNavigate();
  const [liste, setListe] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => { setListe(null); setErreur(null); }, [debut, fin]);

  const verifier = async () => {
    setChargement(true); setErreur(null);
    try {
      const r = await api.get(`/insertion/convergence/completude?${new URLSearchParams({ debut, fin })}`, { timeout: TIMEOUT });
      setListe(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.personnes) ? r.data.personnes : []));
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de vérifier la complétude.'));
    }
    setChargement(false);
  };

  const ouvrir = (p) => {
    const lien = typeof p.lien === 'string' && p.lien.startsWith('/') ? p.lien : `/insertion?employee=${p.employee_id}`;
    navigate(lien);
  };

  return (
    <div className="bg-white rounded-xl border p-5 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h4 className="font-semibold text-gray-800 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-teal-600" /> Informations Convergence à compléter
          </h4>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-2xl">
            Les personnes de la période dont une information du document manque. Elle se complète dans leur fiche :
            le diagnostic pour l'entrée, le bilan de sortie pour la sortie.
          </p>
        </div>
        <button type="button" onClick={verifier} disabled={chargement || !debut || !fin}
          className="btn-ghost text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${chargement ? 'animate-spin' : ''}`} /> {chargement ? 'Vérification…' : 'Vérifier'}
        </button>
      </div>
      {erreur && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{erreur}</div>}
      {liste && liste.length === 0 && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
          Rien ne manque : toutes les personnes de la période ont leurs informations Convergence.
        </p>
      )}
      {liste && liste.length > 0 && (
        <>
          <p className="text-xs text-amber-800">{liste.length} personne(s) avec au moins une information manquante.</p>
          <ul className="divide-y border rounded-lg">
            {liste.map((p) => (
              <li key={p.employee_id}>
                <button type="button" onClick={() => ouvrir(p)}
                  className="w-full text-left px-3 py-2 hover:bg-teal-50 flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-medium text-gray-800">{p.nom || `Salarié n° ${p.employee_id}`}</span>
                    <span className="block text-xs text-gray-500">
                      Manque : {(p.manques || []).join(', ') || '—'}
                    </span>
                  </span>
                  <span className="text-xs text-teal-700 whitespace-nowrap">Ouvrir la fiche →</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Registre des moyens humains (Partie 2) ─────────────────────────────────

const RESSOURCE_VIDE = {
  type: 'interne', user_id: '', nom: '', fonction: '', employeur: '',
  etp_total: '', etp_accompagnement: '', etp_encadrement: '', date_debut: '', date_fin: '', actif: true,
};

// m-06 — même borne que le serveur et le CHECK de la base (0 à 2 ETP).
const etpValide = (v) => v === '' || v === null || (/^\d+([.,]\d{1,2})?$/.test(String(v)) && Number(String(v).replace(',', '.')) <= 2);
const etpNum = (v) => (v === '' || v === null || v === undefined ? null : Math.round(Number(String(v).replace(',', '.')) * 100) / 100);

function MoyensHumains() {
  const [ressources, setRessources] = useState([]);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [edition, setEdition] = useState(null); // { id?|null, ...champs }
  const [aSupprimer, setASupprimer] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [info, setInfo] = useState(null);
  const [enregistrement, setEnregistrement] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const r = await api.get('/insertion/convergence/ressources');
      setRessources(Array.isArray(r.data) ? r.data : []);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger le registre des moyens humains.'));
    }
    setChargement(false);
  }, []);

  useEffect(() => {
    charger();
    api.get('/insertion/cip-referents')
      .then((r) => setUtilisateurs(Array.isArray(r.data) ? r.data : []))
      .catch(() => setUtilisateurs([]));
  }, [charger]);

  const ouvrir = (r = null) => {
    setErreur(null); setInfo(null); setASupprimer(null);
    if (!r) { setEdition({ ...RESSOURCE_VIDE, id: null }); return; }
    setEdition({
      ...RESSOURCE_VIDE, ...r,
      user_id: r.user_id != null ? String(r.user_id) : '',
      etp_total: r.etp_total ?? '', etp_accompagnement: r.etp_accompagnement ?? '', etp_encadrement: r.etp_encadrement ?? '',
      date_debut: r.date_debut ? String(r.date_debut).slice(0, 10) : '',
      date_fin: r.date_fin ? String(r.date_fin).slice(0, 10) : '',
      fonction: r.fonction || '', employeur: r.employeur || '', nom: r.nom || '',
      actif: r.actif !== false,
    });
  };

  const choisirUtilisateur = (id) => {
    const u = utilisateurs.find((x) => String(x.id) === id);
    setEdition((e) => ({
      ...e, user_id: id,
      nom: u ? `${(u.last_name || '').toUpperCase()} ${u.first_name || ''}`.trim() : e.nom,
    }));
  };

  const enregistrer = async () => {
    const e = edition;
    setErreur(null); setInfo(null);
    if (!e.nom.trim()) { setErreur('Indiquez le nom de la personne.'); return; }
    for (const [k, l] of [['etp_total', 'La quotité totale'], ['etp_accompagnement', "La quotité d'accompagnement"], ['etp_encadrement', "La quotité d'encadrement"]]) {
      if (!etpValide(e[k])) { setErreur(`${l} doit être un nombre entre 0 et 2 (deux décimales au plus).`); return; }
    }
    const tot = etpNum(e.etp_total);
    const somme = (etpNum(e.etp_accompagnement) || 0) + (etpNum(e.etp_encadrement) || 0);
    if (e.type === 'interne' && tot != null && somme > tot + 0.001) {
      setErreur("L'accompagnement et l'encadrement ensemble dépassent la quotité totale."); return;
    }
    if (e.date_debut && e.date_fin && e.date_debut > e.date_fin) { setErreur('La date de début est postérieure à la date de fin.'); return; }
    const body = {
      type: e.type,
      user_id: e.type === 'interne' && e.user_id ? Number(e.user_id) : null,
      nom: e.nom.trim(),
      fonction: e.fonction.trim() || null,
      employeur: e.type === 'mutualisee' ? (e.employeur.trim() || null) : null,
      etp_total: tot,
      etp_accompagnement: e.type === 'interne' ? etpNum(e.etp_accompagnement) : null,
      etp_encadrement: e.type === 'interne' ? etpNum(e.etp_encadrement) : null,
      date_debut: e.date_debut || null,
      date_fin: e.date_fin || null,
      actif: !!e.actif,
    };
    setEnregistrement(true);
    try {
      if (e.id) await api.put(`/insertion/convergence/ressources/${e.id}`, body);
      else await api.post('/insertion/convergence/ressources', body);
      setEdition(null);
      setInfo('Registre mis à jour.');
      await charger();
    } catch (err) {
      setErreur(messageErreur(err, "Impossible d'enregistrer cette ressource."));
    }
    setEnregistrement(false);
  };

  const supprimer = async (id) => {
    setErreur(null); setInfo(null);
    try {
      await api.delete(`/insertion/convergence/ressources/${id}`);
      setASupprimer(null);
      setInfo('Ressource retirée du registre.');
      await charger();
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de supprimer cette ressource.'));
    }
  };

  const internes = ressources.filter((r) => r.type !== 'mutualisee');
  const mutualisees = ressources.filter((r) => r.type === 'mutualisee');

  const ligne = (r) => (
    <tr key={r.id} className={`border-b border-gray-50 ${r.actif === false ? 'text-gray-400' : ''}`}>
      <td className="py-1.5 pr-2 font-medium">{r.nom}{r.actif === false && <span className="ml-1 text-[10px]">(inactive)</span>}</td>
      <td className="py-1.5 pr-2 text-xs">{[r.fonction, r.type === 'mutualisee' ? r.employeur : null].filter(Boolean).join(' — ') || '—'}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums"><Nb v={r.etp_total} /></td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.type === 'mutualisee' ? '' : <Nb v={r.etp_accompagnement} />}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{r.type === 'mutualisee' ? '' : <Nb v={r.etp_encadrement} />}</td>
      <td className="py-1.5 pr-2 text-xs text-gray-500">
        {r.date_debut ? periodeTexte({ debut: String(r.date_debut).slice(0, 10), fin: r.date_fin ? String(r.date_fin).slice(0, 10) : null }).replace('au —', '(sans fin)') : 'Sans date'}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        {aSupprimer === r.id ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-xs text-red-700">Retirer ?</span>
            <button type="button" onClick={() => supprimer(r.id)} className="text-xs px-2 py-0.5 rounded bg-red-600 text-white">Oui, retirer</button>
            <button type="button" onClick={() => setASupprimer(null)} className="text-xs px-2 py-0.5 rounded border">Annuler</button>
          </span>
        ) : (
          <span className="inline-flex gap-1">
            <button type="button" onClick={() => ouvrir(r)} aria-label={`Modifier ${r.nom}`}
              className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"><Pencil className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => { setASupprimer(r.id); setEdition(null); }} aria-label={`Retirer ${r.nom}`}
              className="p-1 rounded border border-gray-200 text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
          </span>
        )}
      </td>
    </tr>
  );

  const tableau = (titre, liste) => (
    <div>
      <p className="text-xs font-semibold text-gray-600 mb-1">{titre} ({liste.length})</p>
      {liste.length === 0 ? (
        <p className="text-xs text-gray-400 border border-dashed rounded-lg p-2 text-center">Aucune ressource.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-gray-400 border-b">
                <th className="py-1.5 pr-2">NOM Prénom</th>
                <th className="py-1.5 pr-2">Fonction</th>
                <th className="py-1.5 pr-2 text-right">ETP total</th>
                <th className="py-1.5 pr-2 text-right">dont accomp.</th>
                <th className="py-1.5 pr-2 text-right">dont encadr.</th>
                <th className="py-1.5 pr-2">Période</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>{liste.map(ligne)}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  const e = edition;
  return (
    <div className="bg-white rounded-xl border p-5 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h4 className="font-semibold text-gray-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-600" /> Moyens humains (Partie 2)
          </h4>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-2xl">
            Les permanents qui accompagnent et encadrent les salariés en parcours, et les personnes mises à
            disposition par un autre employeur. Quotités en ETP (1 = temps plein, deux décimales).
          </p>
        </div>
        <button type="button" onClick={() => ouvrir(null)}
          className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Ajouter une ressource
        </button>
      </div>
      {erreur && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{erreur}</div>}
      {info && <div className="text-xs bg-teal-50 border border-teal-200 text-teal-800 rounded-lg p-2.5">{info}</div>}

      {e && (
        <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3 space-y-3">
          <div className="flex gap-3 text-sm">
            {[['interne', 'Ressource interne'], ['mutualisee', 'Ressource mutualisée (autre employeur)']].map(([k, l]) => (
              <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="cvg-res-type" checked={e.type === k} onChange={() => setEdition({ ...e, type: k })} /> {l}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {e.type === 'interne' && utilisateurs.length > 0 && (
              <div>
                <label htmlFor="cvg-res-user" className="block text-xs text-gray-500 mb-0.5">Choisir un utilisateur (facultatif)</label>
                <select id="cvg-res-user" value={e.user_id} onChange={(ev) => choisirUtilisateur(ev.target.value)} className="input-modern py-1.5 text-sm w-full">
                  <option value="">— saisie libre</option>
                  {utilisateurs.map((u) => (
                    <option key={u.id} value={u.id}>{`${(u.last_name || '').toUpperCase()} ${u.first_name || ''}`.trim()}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="cvg-res-nom" className="block text-xs text-gray-500 mb-0.5">NOM Prénom</label>
              <input id="cvg-res-nom" value={e.nom} onChange={(ev) => setEdition({ ...e, nom: ev.target.value })} className="input-modern py-1.5 text-sm w-full" />
            </div>
            <div>
              <label htmlFor="cvg-res-fct" className="block text-xs text-gray-500 mb-0.5">Fonction</label>
              <input id="cvg-res-fct" value={e.fonction} onChange={(ev) => setEdition({ ...e, fonction: ev.target.value })}
                placeholder="CIP, encadrant technique…" className="input-modern py-1.5 text-sm w-full" />
            </div>
            {e.type === 'mutualisee' && (
              <div>
                <label htmlFor="cvg-res-emp" className="block text-xs text-gray-500 mb-0.5">Employeur</label>
                <input id="cvg-res-emp" value={e.employeur} onChange={(ev) => setEdition({ ...e, employeur: ev.target.value })} className="input-modern py-1.5 text-sm w-full" />
              </div>
            )}
            <div>
              <label htmlFor="cvg-res-etp" className="block text-xs text-gray-500 mb-0.5">
                {e.type === 'mutualisee' ? 'Quotité affectée au chantier (ETP)' : 'Quotité de travail totale (ETP)'}
              </label>
              <input id="cvg-res-etp" inputMode="decimal" value={e.etp_total} onChange={(ev) => setEdition({ ...e, etp_total: ev.target.value })}
                placeholder="ex. 0,8" className="input-modern py-1.5 text-sm w-full" />
            </div>
            {e.type === 'interne' && (
              <>
                <div>
                  <label htmlFor="cvg-res-acc" className="block text-xs text-gray-500 mb-0.5">dont accompagnement (ETP)</label>
                  <input id="cvg-res-acc" inputMode="decimal" value={e.etp_accompagnement} onChange={(ev) => setEdition({ ...e, etp_accompagnement: ev.target.value })}
                    className="input-modern py-1.5 text-sm w-full" />
                </div>
                <div>
                  <label htmlFor="cvg-res-enc" className="block text-xs text-gray-500 mb-0.5">dont encadrement (ETP)</label>
                  <input id="cvg-res-enc" inputMode="decimal" value={e.etp_encadrement} onChange={(ev) => setEdition({ ...e, etp_encadrement: ev.target.value })}
                    className="input-modern py-1.5 text-sm w-full" />
                </div>
              </>
            )}
            <div>
              <label htmlFor="cvg-res-deb" className="block text-xs text-gray-500 mb-0.5">Depuis le</label>
              <input id="cvg-res-deb" type="date" value={e.date_debut} onChange={(ev) => setEdition({ ...e, date_debut: ev.target.value })} className="input-modern py-1.5 text-sm w-full" />
            </div>
            <div>
              <label htmlFor="cvg-res-fin" className="block text-xs text-gray-500 mb-0.5">Jusqu'au (facultatif)</label>
              <input id="cvg-res-fin" type="date" value={e.date_fin} onChange={(ev) => setEdition({ ...e, date_fin: ev.target.value })} className="input-modern py-1.5 text-sm w-full" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm self-end pb-1.5">
              <input type="checkbox" checked={!!e.actif} onChange={(ev) => setEdition({ ...e, actif: ev.target.checked })} className="rounded border-gray-300" />
              Ressource active
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={enregistrer} disabled={enregistrement}
              className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              <Save className="w-4 h-4" /> {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button type="button" onClick={() => setEdition(null)} className="btn-ghost text-sm inline-flex items-center gap-1.5">
              <X className="w-4 h-4" /> Annuler
            </button>
          </div>
        </div>
      )}

      {chargement ? <p className="text-xs text-gray-400">Chargement…</p> : (
        <div className="space-y-4">
          {tableau('Ressources internes', internes)}
          {tableau('Ressources mutualisées', mutualisees)}
        </div>
      )}
    </div>
  );
}

// ── Panneau principal ───────────────────────────────────────────────────────

export default function ConvergenceCvgPanel({ canGenerer = false }) {
  const semestres = useMemo(() => semestresConvergence(), []);
  const courant = semestres.find((s) => s.courant) || semestres[0];
  const anneeCourante = new Date().getFullYear();

  const [mode, setMode] = useState('semestre'); // 'semestre' | 'annee' | 'libre'
  const [semestre, setSemestre] = useState(`${courant.debut}|${courant.fin}`);
  const [annee, setAnnee] = useState(anneeCourante);
  const [libre, setLibre] = useState({ debut: courant.debut, fin: courant.fin });

  const [contenu, setContenu] = useState(null);
  const [enregistre, setEnregistre] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [action, setAction] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [info, setInfo] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [histoOuvert, setHistoOuvert] = useState(false);
  const [vue, setVue] = useState('document'); // 'document' | 'comparer' | 'completude' | 'moyens'
  const [parametres, setParametres] = useState(null); // réglages de confidentialité en vigueur (B-01, B-02)

  const { debut, fin } = useMemo(() => {
    if (mode === 'semestre') { const [d, f] = semestre.split('|'); return { debut: d, fin: f }; }
    if (mode === 'annee') return { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
    return libre;
  }, [mode, semestre, annee, libre]);

  const periodeValide = !!debut && !!fin && debut <= fin;

  const chargerHistorique = useCallback(() => {
    api.get('/insertion/convergence/historique?limit=25')
      .then((r) => setHistorique(Array.isArray(r.data) ? r.data : []))
      .catch(() => setHistorique([]));
  }, []);

  useEffect(() => { chargerHistorique(); }, [chargerHistorique]);
  useEffect(() => {
    api.get('/insertion/convergence/parametres')
      .then((r) => setParametres(r.data || null))
      .catch(() => setParametres(null));
  }, []);

  // La période change → l'aperçu affiché ne lui correspond plus : on l'efface.
  useEffect(() => { setContenu(null); setEnregistre(null); setInfo(null); }, [debut, fin]);

  const qs = () => new URLSearchParams({ debut, fin }).toString();

  const apercu = async () => {
    if (!periodeValide) { setErreur('Période invalide : la date de début doit précéder la date de fin.'); return; }
    setChargement(true); setAction('apercu'); setErreur(null); setInfo(null);
    try {
      const r = await api.get(`/insertion/convergence/apercu?${qs()}`, { timeout: TIMEOUT });
      setContenu(r.data);
      setEnregistre(null);
    } catch (err) {
      setContenu(null);
      setErreur(messageErreur(err, 'Impossible de composer le document Convergence.'));
    }
    setChargement(false); setAction(null);
  };

  const generer = async () => {
    if (!periodeValide) { setErreur('Période invalide : la date de début doit précéder la date de fin.'); return; }
    setChargement(true); setAction('generer'); setErreur(null); setInfo(null);
    try {
      const r = await api.post('/insertion/convergence/generer', { debut, fin }, { timeout: TIMEOUT });
      const c = r.data?.contenu || r.data;
      setContenu(c);
      setEnregistre({ id: r.data?.id, genere_le: r.data?.genere_le || c?.en_tete?.genere_le });
      chargerHistorique();
      const ok = exportConvergenceCvgPDF(c, { id: r.data?.id, genere_le: r.data?.genere_le });
      setInfo(ok
        ? `Instantané enregistré (n° ${r.data?.id}) et ouvert pour impression.`
        : `Instantané enregistré (n° ${r.data?.id}). La fenêtre d'impression a été bloquée par le navigateur — autorisez les fenêtres pour ce site, puis rejouez-le depuis l'historique.`);
    } catch (err) {
      setErreur(messageErreur(err, "Impossible d'enregistrer l'instantané Convergence."));
    }
    setChargement(false); setAction(null);
  };

  const imprimer = () => {
    if (!contenu) return;
    const ok = exportConvergenceCvgPDF(contenu, enregistre || {});
    if (!ok) setErreur("La fenêtre d'impression a été bloquée par le navigateur — autorisez les fenêtres pour ce site.");
  };

  const telechargerCsv = async () => {
    if (!periodeValide) { setErreur('Période invalide : la date de début doit précéder la date de fin.'); return; }
    setChargement(true); setAction('csv'); setErreur(null); setInfo(null);
    try {
      const res = await api.get(`/insertion/convergence/csv?${qs()}`, { responseType: 'blob', timeout: TIMEOUT });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `convergence-cvg_${debut}_${fin}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      setErreur(await messageErreurBlob(err, 'Impossible de générer le fichier CSV.'));
    }
    setChargement(false); setAction(null);
  };

  const rejouer = async (h) => {
    setErreur(null); setInfo(null);
    try {
      const r = await api.get(`/insertion/convergence/snapshot/${h.id}`, { timeout: TIMEOUT });
      const c = r.data?.contenu || r.data;
      const ok = exportConvergenceCvgPDF(c, { id: h.id, genere_le: h.genere_le, genere_par_nom: h.genere_par_nom });
      if (!ok) setErreur("La fenêtre d'impression a été bloquée par le navigateur — autorisez les fenêtres pour ce site.");
      else setInfo(`Instantané n° ${h.id} rejoué tel qu'il a été enregistré.`);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de relire cet instantané.'));
    }
  };

  const completudeApercu = contenu?.completude;
  const nbIncomplets = Array.isArray(completudeApercu) ? completudeApercu.length
    : (completudeApercu && typeof completudeApercu === 'object' ? (completudeApercu.nb_incomplets ?? completudeApercu.personnes_incompletes ?? null) : null);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-600" /> Outil de dialogue de gestion — programme CVG
            </h3>
            <p className="text-[11px] text-gray-500 mt-1 max-w-2xl">
              Le document demandé par le réseau <strong>Convergence France</strong> : le public accompagné, les
              moyens humains, puis les sortis en emploi et hors emploi, au format de son formulaire. Les chiffres
              viennent de ce qui est saisi au fil de l'eau — le diagnostic à l'entrée, le bilan de sortie à la
              sortie. Une information non saisie s'affiche « — » et est comptée comme non renseignée.
            </p>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-100 inline-flex items-center gap-1 whitespace-nowrap">
            <ShieldCheck className="w-3 h-3" /> ADMIN / RH
          </span>
        </div>

        {/* Période */}
        <div className="mt-4 flex items-end gap-2 flex-wrap">
          <div>
            <label htmlFor="cvg-mode" className="block text-xs text-gray-500 mb-0.5">Période</label>
            <select id="cvg-mode" value={mode} onChange={(e) => setMode(e.target.value)} className="input-modern py-1.5 text-sm">
              <option value="semestre">Semestre Convergence</option>
              <option value="annee">Année civile</option>
              <option value="libre">Dates libres</option>
            </select>
          </div>
          {mode === 'semestre' && (
            <div>
              <label htmlFor="cvg-sem" className="block text-xs text-gray-500 mb-0.5">Semestre</label>
              <select id="cvg-sem" value={semestre} onChange={(e) => setSemestre(e.target.value)} className="input-modern py-1.5 text-sm">
                {semestres.map((s) => <option key={s.debut} value={`${s.debut}|${s.fin}`}>{s.label}</option>)}
              </select>
            </div>
          )}
          {mode === 'annee' && (
            <div>
              <label htmlFor="cvg-annee" className="block text-xs text-gray-500 mb-0.5">Année</label>
              <select id="cvg-annee" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className="input-modern py-1.5 text-sm">
                {[0, 1, 2, 3, 4].map((i) => <option key={i} value={anneeCourante - i}>{anneeCourante - i}</option>)}
              </select>
            </div>
          )}
          {mode === 'libre' && (
            <>
              <div>
                <label htmlFor="cvg-deb" className="block text-xs text-gray-500 mb-0.5">Du</label>
                <input id="cvg-deb" type="date" value={libre.debut} onChange={(e) => setLibre({ ...libre, debut: e.target.value })} className="input-modern py-1.5 text-sm" />
              </div>
              <div>
                <label htmlFor="cvg-fin" className="block text-xs text-gray-500 mb-0.5">Au</label>
                <input id="cvg-fin" type="date" value={libre.fin} onChange={(e) => setLibre({ ...libre, fin: e.target.value })} className="input-modern py-1.5 text-sm" />
              </div>
            </>
          )}
          <span className="text-xs text-gray-500 pb-2">{periodeValide ? periodeTexte({ debut, fin }) : 'Période invalide'}</span>
        </div>

        {/* Encadré de confidentialité — AVANT « Générer » (correctif B-01) : ce
            qui sortira, et en vertu de quel réglage. */}
        <div className="mt-4 text-xs bg-slate-50 border border-slate-300 rounded-lg p-3 text-slate-700 space-y-1">
          <p className="font-semibold flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Confidentialité du document transmis</p>
          {parametres ? (
            <>
              <p>
                {parametres.k_min > 1 ? (
                  <>Seuil de confidentialité <strong>k = {parametres.k_min}</strong>{' '}
                    ({parametres.k_source === 'defaut' ? 'défaut de l’outil' : 'réglage de la structure — décision du DPO'}) :
                    un tableau des sortis de moins de {parametres.k_min} personnes ne diffuse ni ses lignes santé et justice, ni son
                    logement, ni « dont parcours de soin » ; sous {Math.max(parametres.base_marginales_brutes, parametres.k_min)} accueillis,
                    les petites cases de la Partie 1 sont retenues. Une case retenue s’imprime « s ».</>
                ) : (
                  <>Aucun seuil de confidentialité (<strong>k = 1</strong>, décision de la structure) : le document reproduit le
                    format brut du réseau, effectifs de 1 et 2 compris.</>
                )}
              </p>
              <p>
                Frein « Justice » (article 10 du RGPD) :{' '}
                {parametres.transmettre_justice
                  ? <strong>transmis en agrégat (décision de la structure)</strong>
                  : <strong>non transmis</strong>}.
              </p>
              <p className="text-slate-500">
                Aucun nom de personne accompagnée — mais des effectifs très faibles peuvent désigner une personne : le document
                se transmet au seul dialogue de gestion avec Convergence France, il ne se publie ni ne se rediffuse.
              </p>
            </>
          ) : (
            <p className="text-slate-500">Réglages de confidentialité indisponibles : ils sont appliqués et rappelés dans la méthode du document.</p>
          )}
        </div>

        <div className="mt-3 flex items-end gap-2 flex-wrap">
          <button type="button" onClick={apercu} disabled={chargement || !periodeValide}
            className="btn-ghost text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${chargement && action === 'apercu' ? 'animate-spin' : ''}`} />
            {chargement && action === 'apercu' ? 'Composition…' : 'Aperçu'}
          </button>
          <button type="button" onClick={telechargerCsv} disabled={chargement || !periodeValide}
            className="btn-ghost text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download className="w-4 h-4" /> {chargement && action === 'csv' ? 'Export…' : 'CSV'}
          </button>
          {contenu && (
            <button type="button" onClick={imprimer} className="btn-ghost text-sm inline-flex items-center gap-1.5">
              <Printer className="w-4 h-4" /> Imprimer l'aperçu
            </button>
          )}
          {canGenerer && (
            <button type="button" onClick={generer} disabled={chargement || !periodeValide}
              title="Fige un instantané daté, journalisé, rejouable à l'identique"
              className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              {chargement && action === 'generer' ? 'Enregistrement…' : 'Générer et enregistrer (PDF)'}
            </button>
          )}
        </div>
        {erreur && <div className="mt-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{erreur}</div>}
        {info && <div className="mt-3 text-xs bg-teal-50 border border-teal-200 text-teal-800 rounded-lg p-2.5">{info}</div>}
      </div>

      {/* Sous-vues */}
      <div className="flex gap-1 border-b" role="tablist">
        {[
          ['document', 'Document', FileText],
          ['comparer', 'Comparer deux périodes', GitCompare],
          ['completude', 'À compléter', ListChecks],
          ['moyens', 'Moyens humains', Users],
        ].map(([cle, label, Icon]) => (
          <button key={cle} type="button" role="tab" aria-selected={vue === cle} onClick={() => setVue(cle)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-1.5 transition ${
              vue === cle ? 'border-teal-600 text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {vue === 'document' && (
        <>
          {contenu ? (
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="font-semibold text-gray-800">
                  Aperçu — {periodeTexte({ debut: contenu.en_tete?.periode_debut || debut, fin: contenu.en_tete?.periode_fin || fin })}
                </h4>
                <span className="text-[11px] text-gray-400">
                  Composé le {frDateHeure(contenu.en_tete?.genere_le)}
                  {enregistre ? ` · enregistré sous le n° ${enregistre.id}` : ' · non enregistré'}
                </span>
              </div>
              {nbIncomplets != null && Number(nbIncomplets) > 0 && (
                <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-2.5 flex items-center justify-between gap-2 flex-wrap">
                  <span><strong>{nbIncomplets} personne(s)</strong> de la période n'ont pas toutes leurs informations Convergence.</span>
                  <button type="button" onClick={() => setVue('completude')} className="underline font-medium">Voir qui</button>
                </div>
              )}
              <ApercuCvg contenu={contenu} />
            </div>
          ) : (
            <p className="text-sm text-gray-400 border border-dashed rounded-xl p-6 text-center bg-white">
              Choisissez une période puis « Aperçu » pour voir le document au format Convergence.
            </p>
          )}

          <div className="bg-white rounded-xl border p-5">
            <button type="button" onClick={() => setHistoOuvert((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
              <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                <History className="w-4 h-4 text-slate-500" /> Instantanés enregistrés ({historique.length})
              </h4>
              <span className="text-xs text-gray-400">{histoOuvert ? 'Replier' : 'Déplier'}</span>
            </button>
            {histoOuvert && (
              <div className="mt-3">
                <p className="text-[11px] text-gray-400 mb-2">
                  Rejouer un instantané imprime <strong>ce qui a été enregistré</strong>, pas ce que les dossiers disent aujourd'hui.
                </p>
                {historique.length === 0 ? (
                  <p className="text-sm text-gray-400 border border-dashed rounded-lg p-3 text-center">Aucun instantané enregistré pour l'instant.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase text-gray-400 border-b">
                          <th className="py-1.5 pr-2">N°</th>
                          <th className="py-1.5 pr-2">Période</th>
                          <th className="py-1.5 pr-2">Généré le</th>
                          <th className="py-1.5 pr-2">Par</th>
                          <th className="py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {historique.map((h) => (
                          <tr key={h.id} className="border-b border-gray-50">
                            <td className="py-1.5 pr-2 text-gray-500">{h.id}</td>
                            <td className="py-1.5 pr-2 font-medium text-gray-700">{periodeTexte({ debut: h.periode_debut, fin: h.periode_fin })}</td>
                            <td className="py-1.5 pr-2 text-gray-500 text-xs">{frDateHeure(h.genere_le)}</td>
                            <td className="py-1.5 pr-2 text-gray-500 text-xs">{h.genere_par_nom || '—'}</td>
                            <td className="py-1.5 text-right">
                              <button type="button" onClick={() => rejouer(h)}
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
        </>
      )}

      {vue === 'comparer' && <Comparaison historique={historique} />}
      {vue === 'completude' && (periodeValide
        ? <Completude debut={debut} fin={fin} />
        : <p className="text-sm text-red-700">Période invalide.</p>)}
      {vue === 'moyens' && <MoyensHumains />}
    </div>
  );
}
