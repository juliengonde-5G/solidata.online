import { useState, useEffect, useCallback } from 'react';
import { Save, Sparkles } from 'lucide-react';
import api from '../../services/api';
import {
  CVG_SORTIE_LABELS, CVG_SORTIE_EMPLOI, CVG_SORTIE_HORS_EMPLOI, CVG_HABITAT_KEYS, CVG_HABITAT_LABELS,
} from './freins';

/**
 * Bloc « Situation à la sortie (Convergence) » du bilan de sortie
 * (lot 2.60.0, contrat 30 § 2.1 et § 2.4).
 *
 * ═══ POURQUOI UN ENREGISTREMENT À PART ════════════════════════════════════
 * Ces réponses vivent dans `insertion_sortie_cvg`, pas dans l'entretien : le
 * bilan se verrouille à la clôture, mais la situation Convergence peut se
 * préciser dans les 30 jours qui suivent (obligation « sortie_cvg » de Mes
 * échéances). Le bouton est donc le sien, et reste disponible après la clôture.
 *
 * ═══ PROPOSER, JAMAIS ÉCRIRE À LA PLACE DE LA CIP ═════════════════════════
 * Tant que rien n'est saisi, le serveur PROPOSE des valeurs (déduites du type
 * de sortie, de la RQTH et de l'habitat du diagnostic), avec leur provenance en
 * toutes lettres. Un clic les reprend dans le formulaire ; rien n'est
 * enregistré sans le bouton « Enregistrer la situation de sortie ».
 *
 * Les questions oui / non ont trois états : Oui, Non, et « pas encore
 * renseigné ». Une case à cocher ne sait dire que oui ou non — une case vide
 * se lirait « non », et le document Convergence compterait un « non » que
 * personne n'a donné.
 */

const CHAMPS = [
  'categorie', 'parcours_de_soin', 'habitat_type_sortie', 'rqth_sortie', 'aah_sortie',
  'pension_invalidite_sortie', 'medecin_traitant_sortie', 'couverture_sante_amelioree',
  'accompagnement_post_sortie',
];

const VIDE = Object.fromEntries(CHAMPS.map((c) => [c, null]));

const QUESTIONS_SANTE = [
  ['rqth_sortie', 'RQTH à la sortie'],
  ['aah_sortie', 'AAH à la sortie'],
  ['pension_invalidite_sortie', "Pension d'invalidité à la sortie"],
  ['medecin_traitant_sortie', 'Médecin traitant déclaré à la sortie'],
  ['couverture_sante_amelioree', 'La couverture santé s\'est améliorée pendant le parcours'],
];

const LIBELLES_CHAMPS = {
  categorie: 'Situation', parcours_de_soin: 'Parcours de soin', habitat_type_sortie: 'Habitat à la sortie',
  rqth_sortie: 'RQTH', aah_sortie: 'AAH', pension_invalidite_sortie: "Pension d'invalidité",
  medecin_traitant_sortie: 'Médecin traitant', couverture_sante_amelioree: 'Couverture santé améliorée',
  accompagnement_post_sortie: 'Accompagnement après la sortie',
};

function OuiNon({ value, onChange, disabled }) {
  return (
    <div className="flex gap-1.5">
      {[[true, 'Oui'], [false, 'Non']].map(([v, l]) => (
        <button key={String(v)} type="button" disabled={disabled} onClick={() => onChange(value === v ? null : v)}
          aria-pressed={value === v}
          className={`px-3 py-1 rounded-lg border text-sm transition disabled:opacity-60 ${value === v
            ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Pastille({ selected, onClick, disabled, children }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected}
      className={`px-3 py-1 rounded-lg border text-sm transition disabled:opacity-60 ${selected
        ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'}`}>
      {children}
    </button>
  );
}

const affiche = (champ, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (champ === 'categorie') return CVG_SORTIE_LABELS[v] || v;
  if (champ === 'habitat_type_sortie') return CVG_HABITAT_LABELS[v] || v;
  return String(v);
};

function messageErreur(err, defaut) {
  const d = err?.response?.data;
  return (d?.error || err?.message || defaut) + (d?.hint ? ` — ${d.hint}` : '');
}

export default function SituationSortieCvg({ employeeId, parcoursNum = null, canEdit = false }) {
  const [form, setForm] = useState(VIDE);
  const [saisie, setSaisie] = useState(false); // une situation existe déjà en base
  const [proposition, setProposition] = useState(null);
  const [meta, setMeta] = useState(null); // { saisi_par_nom, saisi_at }
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [modifie, setModifie] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [info, setInfo] = useState(null);

  const charger = useCallback(async () => {
    if (!employeeId) return;
    setChargement(true); setErreur(null);
    try {
      const qs = parcoursNum != null ? `?parcours_num=${encodeURIComponent(parcoursNum)}` : '';
      const r = await api.get(`/insertion/convergence/situation-sortie/${employeeId}${qs}`);
      const d = r.data || {};
      // Forme attendue : { situation: {...} | null, proposition: {...} | null }.
      // Tolère une situation rendue à plat.
      const s = d.situation !== undefined ? d.situation : (d.categorie !== undefined ? d : null);
      if (s) {
        setForm({ ...VIDE, ...Object.fromEntries(CHAMPS.map((c) => [c, s[c] ?? null])) });
        setSaisie(true);
        // 2.60.0 (m-03) : l'auteur initial n'est plus écrasé — la dernière
        // modification a son propre auteur, et le nombre de versions antérieures
        // conservées est dit.
        setMeta({
          saisi_par_nom: s.saisi_par_nom || null, saisi_at: s.saisi_at || s.updated_at || null,
          modifie_par_nom: s.modifie_par_nom || null, modifie_at: s.modifie_par ? s.updated_at : null,
          versions: Number(s.versions_anterieures) || 0,
        });
      } else {
        setForm(VIDE);
        setSaisie(false);
        setMeta(null);
      }
      setProposition(d.proposition || null);
      setModifie(false);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de lire la situation de sortie Convergence.'));
    }
    setChargement(false);
  }, [employeeId, parcoursNum]);

  useEffect(() => { charger(); }, [charger]);

  const set = (champ, v) => {
    setForm((f) => {
      const n = { ...f, [champ]: v };
      // « Parcours de soin » n'a de sens qu'avec une sortie reconnue positive.
      if (champ === 'categorie' && v !== 'autre_positive') n.parcours_de_soin = null;
      return n;
    });
    setModifie(true); setInfo(null);
  };

  const reprendreProposition = () => {
    if (!proposition) return;
    setForm((f) => {
      const n = { ...f };
      CHAMPS.forEach((c) => { if (proposition[c] !== undefined && proposition[c] !== null && n[c] == null) n[c] = proposition[c]; });
      return n;
    });
    setModifie(true);
    setInfo('Proposition reprise dans le formulaire. Vérifiez-la, puis enregistrez.');
  };

  const enregistrer = async () => {
    setEnregistrement(true); setErreur(null); setInfo(null);
    try {
      const body = { ...form };
      if (parcoursNum != null) body.parcours_num = parcoursNum;
      await api.put(`/insertion/convergence/situation-sortie/${employeeId}`, body);
      setInfo('Situation de sortie Convergence enregistrée.');
      await charger();
    } catch (err) {
      setErreur(messageErreur(err, "Impossible d'enregistrer la situation de sortie Convergence."));
    }
    setEnregistrement(false);
  };

  // Provenance : chaîne unique, ou une phrase par champ.
  const sources = proposition?.source ?? proposition?.sources ?? null;
  const champsProposes = proposition
    ? CHAMPS.filter((c) => proposition[c] !== undefined && proposition[c] !== null)
    : [];
  const montrerProposition = !saisie && !modifie && champsProposes.length > 0;
  const disabled = !canEdit || enregistrement;

  return (
    <div className="border-t border-purple-200 pt-3 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-purple-900">Situation à la sortie (Convergence)</p>
        {meta?.saisi_at && (
          <span className="text-[11px] text-gray-400">
            Enregistrée le {new Date(meta.saisi_at).toLocaleDateString('fr-FR')}{meta.saisi_par_nom ? ` par ${meta.saisi_par_nom}` : ''}
            {meta.modifie_at && ` · modifiée le ${new Date(meta.modifie_at).toLocaleDateString('fr-FR')}${meta.modifie_par_nom ? ` par ${meta.modifie_par_nom}` : ''}`}
            {meta.versions > 0 && ` · ${meta.versions} version(s) antérieure(s) conservée(s)`}
          </span>
        )}
      </div>
      <p className="text-[11px] text-purple-800">
        Ces réponses servent au document envoyé au réseau Convergence. Elles s'enregistrent à part du bilan,
        avec leur propre bouton, et peuvent être complétées après la clôture.
      </p>

      {chargement ? (
        <p className="text-xs text-gray-400">Chargement…</p>
      ) : (
        <>
          {montrerProposition && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-2.5 text-xs text-teal-900 space-y-1.5">
              <p className="font-semibold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Proposition à partir du dossier (rien n'est encore enregistré)
              </p>
              <ul className="ml-4 list-disc space-y-0.5">
                {champsProposes.map((c) => (
                  <li key={c}>
                    {LIBELLES_CHAMPS[c]} : <strong>{affiche(c, proposition[c])}</strong>
                    {sources && typeof sources === 'object' && sources[c] ? <span className="text-teal-700"> — {sources[c]}</span> : null}
                  </li>
                ))}
              </ul>
              {typeof sources === 'string' && <p className="text-teal-700">{sources}</p>}
              {canEdit && (
                <button type="button" onClick={reprendreProposition}
                  className="mt-1 px-3 py-1 rounded-lg border border-teal-400 text-teal-800 bg-white hover:bg-teal-100 text-xs font-medium">
                  Reprendre la proposition
                </button>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">En emploi ou en formation</label>
            <div className="flex flex-wrap gap-1.5">
              {CVG_SORTIE_EMPLOI.map((k) => (
                <Pastille key={k} disabled={disabled} selected={form.categorie === k}
                  onClick={() => set('categorie', form.categorie === k ? null : k)}>{CVG_SORTIE_LABELS[k]}</Pastille>
              ))}
            </div>
            <label className="block text-xs text-gray-500 mb-1 mt-2">Sans emploi à la sortie</label>
            <div className="flex flex-wrap gap-1.5">
              {CVG_SORTIE_HORS_EMPLOI.map((k) => (
                <Pastille key={k} disabled={disabled} selected={form.categorie === k}
                  onClick={() => set('categorie', form.categorie === k ? null : k)}>{CVG_SORTIE_LABELS[k]}</Pastille>
              ))}
            </div>
          </div>

          {form.categorie === 'autre_positive' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Dont sortie en parcours de soin</label>
              <OuiNon value={form.parcours_de_soin} disabled={disabled} onChange={(v) => set('parcours_de_soin', v)} />
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">Habitat à la sortie</label>
            <div className="flex flex-wrap gap-1.5">
              {CVG_HABITAT_KEYS.map((k) => (
                <Pastille key={k} disabled={disabled} selected={form.habitat_type_sortie === k}
                  onClick={() => set('habitat_type_sortie', form.habitat_type_sortie === k ? null : k)}>{CVG_HABITAT_LABELS[k]}</Pastille>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {QUESTIONS_SANTE.map(([c, l]) => (
              <div key={c}>
                <label className="block text-xs text-gray-500 mb-1">{l}</label>
                <OuiNon value={form[c]} disabled={disabled} onChange={(v) => set(c, v)} />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">A bénéficié d'un accompagnement après la sortie</label>
              <OuiNon value={form.accompagnement_post_sortie} disabled={disabled} onChange={(v) => set('accompagnement_post_sortie', v)} />
            </div>
          </div>

          {erreur && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{erreur}</div>}
          {info && <div className="text-xs bg-teal-50 border border-teal-200 text-teal-800 rounded-lg p-2">{info}</div>}

          {canEdit ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={enregistrer} disabled={enregistrement || !modifie}
                className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5" /> {enregistrement ? 'Enregistrement…' : 'Enregistrer la situation de sortie'}
              </button>
              {modifie && <span className="text-[11px] text-amber-700">Modifications non enregistrées.</span>}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">Lecture seule — la saisie est réservée aux profils ADMIN / RH.</p>
          )}
        </>
      )}
    </div>
  );
}
