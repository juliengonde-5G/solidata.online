import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity } from 'lucide-react';
import { Section, LoadingSpinner } from '../index';
import api from '../../services/api';

/**
 * Activité hebdomadaire (15-20 h) — PR B, lot 3.
 *
 * Ce composant existe pour que la CIP puisse RÉPONDRE au référent qui demande
 * « combien d'heures cette personne fait-elle ? » sans recompter à la main. Il
 * ne surveille personne : le travail en CDDI compte (décision 4), et un salarié
 * à 26 h de contrat est au-dessus du plancher par le seul fait de travailler.
 *
 * ═══ CE QUE L'ÉCRAN NE DIT JAMAIS ═════════════════════════════════════════
 * Le mot « seuil », le mot « obligation », le mot « insuffisant ». Le contrat
 * l'interdit sur toute surface que la personne peut voir, et la règle est plus
 * simple à tenir si on ne l'écrit nulle part. Une semaine basse s'affiche « en
 * dessous de 15 h », ce qui est un CONSTAT ; « sous le seuil » serait un
 * jugement, et c'est le référent — pas la structure d'accueil — qui juge.
 *
 * ═══ DEUX ÉTATS QU'ON NE CONFOND PAS ══════════════════════════════════════
 * Une semaine « non relevée » (le mois de paie n'est pas importé) s'affiche
 * « — » en gris et n'entre dans aucun compte. La montrer à 0 h ferait
 * apparaître, chaque début de mois, des semaines basses qui n'existent pas.
 *
 * Deux formes :
 *  - `variante="badge"` : la ligne discrète de l'en-tête de fiche ;
 *  - `variante="detail"` (défaut) : le tableau du Dossier administratif.
 */

/** Couleur d'une semaine — trois états, jamais un dégradé de reproche. */
function classeSemaine(s) {
  if (s.sans_releve) return 'bg-slate-50 text-slate-300';
  if (s.arret_declare) return 'bg-sky-50 text-sky-700';
  if (s.sous_seuil) return 'bg-amber-50 text-amber-800';
  return 'bg-emerald-50 text-emerald-800';
}

const RAISON_LABELS = {
  arret: 'Arrêt de travail déclaré',
  temps_partiel: 'Quotité contractuelle inférieure',
  absence: 'Congés',
  inconnue: 'Non expliqué — à voir avec la personne',
};

const heures = (v) => (v == null ? '—' : `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`);

export default function ActiviteHebdo({ employeeId, variante = 'detail', annee: anneeProp }) {
  const [annee, setAnnee] = useState(anneeProp || new Date().getFullYear());
  const [data, setData] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(() => {
    let actif = true;
    setChargement(true);
    api.get(`/insertion/rsa/${employeeId}/activite?annee=${annee}`)
      .then((r) => { if (actif) { setData(r.data); setErreur(null); } })
      .catch((err) => {
        if (!actif) return;
        // 403 : le compteur est ADMIN/RH. Ce n'est pas une panne, on n'affiche
        // simplement rien — annoncer une erreur là où il n'y a qu'une
        // habilitation envoie l'utilisateur chercher un problème inexistant.
        if (err?.response?.status === 403) { setData(null); setErreur(null); }
        else setErreur(err?.response?.data?.error || err?.message || 'Activité indisponible');
      })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [employeeId, annee]);

  useEffect(() => charger(), [charger]);

  /** Moyenne des semaines RELEVÉES — jamais des 52, dont la plupart sont vides. */
  const moyenne = useMemo(() => {
    if (!data) return null;
    const relevees = (data.semaines || []).filter((s) => !s.sans_releve && s.total_heures != null);
    if (relevees.length === 0) return null;
    return relevees.reduce((a, s) => a + s.total_heures, 0) / relevees.length;
  }, [data]);

  // ── Forme badge : une ligne dans l'en-tête de fiche ──────────────────────
  if (variante === 'badge') {
    if (chargement || !data) return null;
    const alerte = data.alerte && data.alerte.active;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
          alerte ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'
        }`}
        title={alerte
          ? `Depuis la semaine ${data.alerte.depuis_semaine}, l'activité relevée est en dessous de ${data.seuil_min} h par semaine.`
          : 'Moyenne des semaines dont les heures sont relevées.'}
      >
        {alerte && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
        <Activity className="w-3.5 h-3.5" aria-hidden="true" />
        {moyenne == null
          ? 'Activité : pas encore de relevé'
          : `Activité : ${moyenne.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h/sem.`}
      </span>
    );
  }

  // ── Forme détaillée : le tableau du Dossier administratif ────────────────
  const anneesDispo = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

  return (
    <Section
      title="Activité hebdomadaire"
      icon={Activity}
      subtitle={data ? `Repère de ${data.seuil_min} à ${data.seuil_max} h par semaine — le temps de travail compte` : undefined}
      actions={(
        <select
          value={annee}
          onChange={(e) => setAnnee(Number(e.target.value))}
          className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-700"
          aria-label="Année"
        >
          {anneesDispo.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
    >
      {chargement && <LoadingSpinner size="sm" message="Chargement de l'activité…" />}
      {erreur && <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-3 text-sm">{erreur}</div>}

      {!chargement && !erreur && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Carte
              libelle="Moyenne relevée"
              valeur={moyenne == null ? '—' : `${moyenne.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`}
              note={`${data.nb_semaines_relevees} semaine${data.nb_semaines_relevees > 1 ? 's' : ''} relevée${data.nb_semaines_relevees > 1 ? 's' : ''}`}
            />
            <Carte
              libelle={`Semaines en dessous de ${data.seuil_min} h`}
              valeur={String(data.nb_semaines_sous_seuil)}
              note="arrêts compris"
              ton={data.nb_semaines_sous_seuil > 0 ? 'ambre' : null}
            />
            <Carte
              libelle="Semaines sans relevé"
              valeur={String((data.semaines || []).filter((s) => s.sans_releve).length)}
              note="mois de paie non importés"
            />
            <Carte
              libelle="Signalement"
              valeur={data.alerte?.active ? `S${data.alerte.depuis_semaine}` : '—'}
              note={data.alerte?.active ? 'semaines consécutives basses' : 'aucun'}
              ton={data.alerte?.active ? 'ambre' : null}
            />
          </div>

          {data.alerte?.active && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-[10px] p-3 mb-4">
              Depuis la semaine {data.alerte.depuis_semaine}, l&apos;activité relevée est en dessous de {data.seuil_min} h
              par semaine, hors période d&apos;arrêt. À évoquer lors du prochain point avec la personne.
            </p>
          )}

          {/* Frise des semaines : une case par semaine ISO, lisible d'un coup
              d'œil. Le détail chiffré est dans l'infobulle — étaler 53 lignes
              de tableau ferait perdre la vue d'ensemble qu'on vient chercher. */}
          <div className="flex flex-wrap gap-1 mb-4">
            {(data.semaines || []).map((s) => (
              <span
                key={s.iso_week}
                className={`w-9 h-9 grid place-items-center rounded-md text-[10px] font-medium ${classeSemaine(s)}`}
                title={
                  s.sans_releve
                    ? `Semaine ${s.iso_week} (${s.week_start}) — heures non encore relevées par la paie`
                    : `Semaine ${s.iso_week} (${s.week_start}) — ${heures(s.heures_travail)} de travail`
                      + `${s.minutes_accompagnement ? ` + ${s.minutes_accompagnement} min d'accompagnement` : ''}`
                      + `${s.jours_pmsmp ? ` + ${s.jours_pmsmp} j d'immersion` : ''}`
                      + ` = ${heures(s.total_heures)}${s.arret_declare ? ' — arrêt déclaré' : ''}`
                }
              >
                {s.sans_releve ? '—' : Math.round(s.total_heures)}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-4">
            <Legende classe="bg-emerald-50 border-emerald-200" texte={`${data.seuil_min} h et plus`} />
            <Legende classe="bg-amber-50 border-amber-200" texte={`en dessous de ${data.seuil_min} h`} />
            <Legende classe="bg-sky-50 border-sky-200" texte="arrêt déclaré" />
            <Legende classe="bg-slate-50 border-slate-200" texte="pas encore relevé" />
          </div>

          {data.raisons && data.raisons.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Semaines en dessous de {data.seuil_min} h</h4>
              <ul className="text-sm text-slate-600 space-y-1">
                {data.raisons.map((r) => (
                  <li key={r.iso_week} className="flex items-center gap-2">
                    <span className="font-medium text-slate-700 w-12">S{r.iso_week}</span>
                    <span>{RAISON_LABELS[r.categorie] || r.categorie}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-slate-500 mt-3">
            Les heures travaillées proviennent de l&apos;import de paie ; l&apos;accompagnement, des entretiens et des
            actions dont la durée a été saisie. Une semaine dont les heures ne sont pas encore relevées n&apos;est
            jamais comptée comme une semaine à zéro heure.
          </p>
        </>
      )}
    </Section>
  );
}

function Carte({ libelle, valeur, note, ton }) {
  return (
    <div className={`rounded-[10px] border p-3 ${ton === 'ambre' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
      <div className="text-xs text-slate-500">{libelle}</div>
      <div className={`text-xl font-semibold ${ton === 'ambre' ? 'text-amber-800' : 'text-slate-800'}`}>{valeur}</div>
      {note && <div className="text-[11px] text-slate-400 mt-0.5">{note}</div>}
    </div>
  );
}

function Legende({ classe, texte }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded border ${classe}`} aria-hidden="true" />
      {texte}
    </span>
  );
}
