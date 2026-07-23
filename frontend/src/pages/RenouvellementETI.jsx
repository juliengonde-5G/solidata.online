import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import api from '../services/api';
import { frDate } from '../components/insertion/freins';

/**
 * Écran ETI de renouvellement (REC-UX-06 — bloquant PR 2).
 * UN écran, UN salarié, accessible par LIEN DIRECT
 * (/insertion/renouvellement/:milestoneId) : l'encadrant technique remplit la
 * trame papier en boutons radio / cases LARGES (cibles ≥ 44 px), textes courts
 * facultatifs, puis « Transmettre à la CIP ». Aucune navigation dans le module.
 *
 * Contrat backend : PUT /insertion/renouvellements/:milestoneId/formulaire
 * n'accepte QUE renouvellement_form / renouvellement_avis /
 * renouvellement_duree_mois (400 { champs_refuses } sinon, 409 si verrouillé).
 * Chargement : GET /insertion/renouvellements (nom + état) puis
 * GET /insertion/milestones/:employeeId (pré-remplissage du formulaire) —
 * pas d'endpoint « un entretien par id », le salarié peut être passé en
 * ?salarie=<id> si la fenêtre d'anticipation est dépassée.
 */

const NIVEAUX = [['bonne', 'Bonne'], ['moyenne', 'Moyenne'], ['insuffisante', 'Insuffisante']];
const PARTICIPATIONS = [
  ['entretiens_cip', 'Vient aux entretiens avec la CIP'],
  ['formations', 'Participe aux formations proposées'],
  ['pmsmp', 'A fait ou prépare une immersion (PMSMP)'],
  ['demarches', 'Fait ses démarches (emploi, administratif)'],
];
const MOTIFS = [
  ['progression', 'La personne progresse, il faut continuer'],
  ['consolidation', 'Consolider les acquis au poste'],
  ['projet_en_cours', 'Un projet professionnel est en cours'],
  ['levee_freins', 'Des difficultés sont en cours de résolution'],
  ['autre', 'Autre raison (à préciser en commentaire)'],
];
const AVIS = [
  ['favorable', 'Favorable', 'bg-green-600 border-green-600', 'hover:border-green-400'],
  ['favorable_reserves', 'Favorable avec réserves', 'bg-amber-500 border-amber-500', 'hover:border-amber-400'],
  ['defavorable', 'Défavorable', 'bg-red-600 border-red-600', 'hover:border-red-400'],
];

// Bouton radio LARGE (≥ 44 px — utilisateur peu à l'aise au clavier/à l'écran).
function BigChoice({ selected, onClick, disabled, children, activeClass = 'bg-teal-600 border-teal-600', hoverClass = 'hover:border-teal-400' }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected}
      className={`min-h-[48px] px-5 rounded-xl border-2 text-base font-medium transition ${
        selected ? `${activeClass} text-white` : `bg-white border-gray-300 text-gray-700 ${disabled ? '' : hoverClass}`
      } ${disabled ? 'opacity-60 cursor-default' : ''}`}>
      {children}
    </button>
  );
}

function BigCheck({ checked, onChange, disabled, children }) {
  return (
    <label className={`flex items-center gap-3 min-h-[48px] px-4 rounded-xl border-2 text-base cursor-pointer transition ${
      checked ? 'bg-teal-50 border-teal-400 text-teal-900' : 'bg-white border-gray-300 text-gray-700 hover:border-teal-300'
    } ${disabled ? 'opacity-60 cursor-default' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 rounded border-gray-300" />
      {children}
    </label>
  );
}

export default function RenouvellementETI() {
  const { milestoneId } = useParams();
  const [searchParams] = useSearchParams();
  const msId = parseInt(milestoneId, 10);

  const [info, setInfo] = useState(null); // { nom, contract_end, jours_restants, verrouille, ... }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [transmitted, setTransmitted] = useState(false);
  const [locked, setLocked] = useState(false);

  const [form, setForm] = useState({
    assiduite: null, motivation: null, autonomie: null,
    participation_actions: [], competences_acquises: '', projet_professionnel: '',
    motifs: [], commentaires: '',
  });
  const [avis, setAvis] = useState(null);
  const [duree, setDuree] = useState(null);
  const [dureeAutre, setDureeAutre] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      // 1. File des renouvellements : nom du salarié + état de l'entretien.
      let entry = null;
      try {
        const r = await api.get('/insertion/renouvellements');
        entry = (r.data?.renouvellements || []).find((x) => x.entretien && x.entretien.id === msId) || null;
      } catch { /* la fiche milestone reste tentable via ?salarie= */ }

      const employeeId = entry?.employee_id || parseInt(searchParams.get('salarie'), 10) || null;
      let milestone = null;
      if (employeeId) {
        try {
          const ms = await api.get(`/insertion/milestones/${employeeId}`);
          milestone = (Array.isArray(ms.data) ? ms.data : []).find((m) => m.id === msId) || null;
        } catch { /* pré-remplissage indisponible — la saisie reste possible */ }
      }
      if (!entry && !milestone) {
        setLoadError("Formulaire introuvable : le lien est peut-être périmé, ou l'entretien de renouvellement n'existe plus. Demandez un nouveau lien à la CIP.");
        setLoading(false);
        return;
      }

      setInfo({
        nom: entry ? `${entry.first_name} ${entry.last_name}` : 'Salarié',
        contract_end: entry?.contract_end || null,
        jours_restants: entry?.jours_restants ?? null,
        titre: milestone?.titre || entry?.entretien?.titre || 'Renouvellement',
      });
      const verrou = milestone?.locked_at != null || entry?.entretien?.verrouille === true;
      setLocked(verrou);

      // Pré-remplissage depuis l'entretien (formulaire déjà commencé / rempli).
      const rf = milestone?.renouvellement_form;
      const parsed = (rf && typeof rf === 'object') ? rf : {};
      setForm((f) => ({
        ...f,
        assiduite: parsed.assiduite ?? null,
        motivation: parsed.motivation ?? null,
        autonomie: parsed.autonomie ?? null,
        participation_actions: Array.isArray(parsed.participation_actions) ? parsed.participation_actions : [],
        competences_acquises: parsed.competences_acquises || '',
        projet_professionnel: parsed.projet_professionnel || '',
        motifs: Array.isArray(parsed.motifs) ? parsed.motifs : [],
        commentaires: parsed.commentaires || '',
      }));
      const a = milestone?.renouvellement_avis ?? entry?.entretien?.renouvellement_avis ?? null;
      const d = milestone?.renouvellement_duree_mois ?? entry?.entretien?.renouvellement_duree_mois ?? null;
      setAvis(a);
      if (d != null) {
        if ([2, 4, 6].includes(Number(d))) setDuree(Number(d));
        else { setDuree('autre'); setDureeAutre(String(d)); }
      }
    } catch (err) {
      setLoadError(err.response?.data?.error || err.message);
    }
    setLoading(false);
  }, [msId, searchParams]);

  useEffect(() => { load(); }, [load]);

  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const transmit = async () => {
    setSaveError(null);
    if (!avis) { setSaveError("Choisissez votre avis (favorable, avec réserves ou défavorable) avant de transmettre."); return; }
    const dureeMois = duree === 'autre' ? parseInt(dureeAutre, 10) : duree;
    if (avis !== 'defavorable' && (!dureeMois || dureeMois < 1)) {
      setSaveError('Indiquez la durée de renouvellement proposée (2, 4, 6 mois ou autre).');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/insertion/renouvellements/${msId}/formulaire`, {
        renouvellement_form: {
          ...form,
          competences_acquises: form.competences_acquises.trim() || null,
          projet_professionnel: form.projet_professionnel.trim() || null,
          commentaires: form.commentaires.trim() || null,
          rempli_par: 'eti',
        },
        renouvellement_avis: avis,
        renouvellement_duree_mois: dureeMois || null,
      });
      setTransmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status === 409) {
        setLocked(true);
        setSaveError(d?.error || 'Cet entretien est verrouillé — le formulaire ne peut plus être modifié.');
      } else if (d?.champs_refuses) {
        setSaveError(`${d.error} (champs refusés : ${d.champs_refuses.join(', ')})`);
      } else {
        setSaveError(d?.error || err.message);
      }
    }
    setSaving(false);
  };

  const readOnly = locked || transmitted;

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        {loading && <p className="text-center text-gray-500 py-10 text-lg">Chargement du formulaire…</p>}

        {loadError && (
          <div className="bg-red-50 border-2 border-red-200 text-red-700 rounded-2xl p-5 text-base">
            {loadError}
            <div className="mt-3"><Link to="/insertion" className="text-sm underline text-red-600">Retour au module insertion</Link></div>
          </div>
        )}

        {!loading && !loadError && info && (
          <>
            <header className="text-center space-y-1">
              <p className="text-sm font-semibold text-teal-700 uppercase tracking-wide">Solidarité Textiles — avis de l'encadrant</p>
              <h1 className="text-2xl font-bold text-gray-800">Renouvellement de contrat</h1>
              <p className="text-lg text-gray-700">
                <span className="font-semibold">{info.nom}</span>
                {info.contract_end && <> — fin de contrat le <span className="font-semibold">{frDate(info.contract_end)}</span></>}
                {info.jours_restants != null && <span className="text-amber-700"> (dans {info.jours_restants} jours)</span>}
              </p>
            </header>

            {transmitted && (
              <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-5 text-center space-y-1">
                <p className="text-3xl" aria-hidden="true">✅</p>
                <p className="text-lg font-bold text-green-800">Merci ! Votre avis a été transmis à la CIP.</p>
                <p className="text-sm text-green-700">Vous pouvez fermer cette page. La CIP complète son volet et organise la suite.</p>
              </div>
            )}
            {locked && !transmitted && (
              <div className="bg-slate-100 border-2 border-slate-300 rounded-2xl p-4 text-center text-base text-slate-700">
                🔒 Cet entretien de renouvellement est clôturé : le formulaire est en lecture seule.
              </div>
            )}
            {saveError && (
              <div className="bg-red-50 border-2 border-red-300 text-red-700 rounded-2xl p-4 text-base">{saveError}</div>
            )}

            {/* 3 échelles : assiduité / motivation / autonomie */}
            {[
              ['assiduite', 'Assiduité et ponctualité', 'La personne vient-elle au travail, à l\'heure ?'],
              ['motivation', 'Motivation au travail', 'A-t-elle envie de bien faire, de s\'impliquer ?'],
              ['autonomie', 'Autonomie au poste', 'Sait-elle faire son travail sans aide permanente ?'],
            ].map(([key, title, help]) => (
              <section key={key} className="bg-white rounded-2xl border p-5 space-y-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-800">{title}</h2>
                  <p className="text-sm text-gray-500">{help}</p>
                </div>
                <div className="flex gap-3 flex-wrap">
                  {NIVEAUX.map(([v, l]) => (
                    <BigChoice key={v} selected={form[key] === v} disabled={readOnly}
                      onClick={() => setForm({ ...form, [key]: form[key] === v ? null : v })}
                      activeClass={v === 'insuffisante' ? 'bg-red-600 border-red-600' : v === 'moyenne' ? 'bg-amber-500 border-amber-500' : 'bg-green-600 border-green-600'}>
                      {l}
                    </BigChoice>
                  ))}
                </div>
              </section>
            ))}

            {/* Participation : cases */}
            <section className="bg-white rounded-2xl border p-5 space-y-3">
              <h2 className="text-lg font-bold text-gray-800">Participation à l'accompagnement</h2>
              <p className="text-sm text-gray-500">Cochez ce qui est vrai (plusieurs cases possibles).</p>
              <div className="grid grid-cols-1 gap-2">
                {PARTICIPATIONS.map(([v, l]) => (
                  <BigCheck key={v} checked={form.participation_actions.includes(v)} disabled={readOnly}
                    onChange={() => setForm({ ...form, participation_actions: toggleIn(form.participation_actions, v) })}>
                    {l}
                  </BigCheck>
                ))}
              </div>
            </section>

            {/* Compétences + projet : textes courts facultatifs */}
            <section className="bg-white rounded-2xl border p-5 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Compétences acquises</h2>
                <p className="text-sm text-gray-500 mb-2">En quelques mots : ce que la personne sait faire maintenant.</p>
                <input value={form.competences_acquises} disabled={readOnly} maxLength={300}
                  onChange={(e) => setForm({ ...form, competences_acquises: e.target.value })}
                  placeholder="Ex. : tri qualité, conduite du transpalette, accueil…"
                  className="input-modern w-full text-base py-3" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-800">Projet professionnel</h2>
                <p className="text-sm text-gray-500 mb-2">Ce que la personne veut faire ensuite (si vous le savez).</p>
                <textarea value={form.projet_professionnel} disabled={readOnly} rows={2}
                  onChange={(e) => setForm({ ...form, projet_professionnel: e.target.value })}
                  className="input-modern w-full text-base py-3" />
              </div>
            </section>

            {/* Motifs : cases */}
            <section className="bg-white rounded-2xl border p-5 space-y-3">
              <h2 className="text-lg font-bold text-gray-800">Pourquoi renouveler ?</h2>
              <div className="grid grid-cols-1 gap-2">
                {MOTIFS.map(([v, l]) => (
                  <BigCheck key={v} checked={form.motifs.includes(v)} disabled={readOnly}
                    onChange={() => setForm({ ...form, motifs: toggleIn(form.motifs, v) })}>
                    {l}
                  </BigCheck>
                ))}
              </div>
            </section>

            {/* Avis : 3 gros boutons */}
            <section className="bg-white rounded-2xl border-2 border-teal-200 p-5 space-y-3">
              <h2 className="text-lg font-bold text-gray-800">Votre avis sur le renouvellement</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {AVIS.map(([v, l, active, hover]) => (
                  <BigChoice key={v} selected={avis === v} disabled={readOnly}
                    onClick={() => setAvis(avis === v ? null : v)} activeClass={active} hoverClass={hover}>
                    {l}
                  </BigChoice>
                ))}
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-700 mt-2 mb-2">Pour quelle durée ?</h3>
                <div className="flex gap-3 flex-wrap items-center">
                  {[2, 4, 6].map((m) => (
                    <BigChoice key={m} selected={duree === m} disabled={readOnly}
                      onClick={() => { setDuree(duree === m ? null : m); setDureeAutre(''); }}>
                      {m} mois
                    </BigChoice>
                  ))}
                  <BigChoice selected={duree === 'autre'} disabled={readOnly} onClick={() => setDuree(duree === 'autre' ? null : 'autre')}>
                    Autre
                  </BigChoice>
                  {duree === 'autre' && (
                    <input type="number" min="1" max="24" value={dureeAutre} disabled={readOnly}
                      onChange={(e) => setDureeAutre(e.target.value)}
                      placeholder="mois" className="input-modern w-24 text-base py-3" />
                  )}
                </div>
              </div>
            </section>

            {/* Commentaires */}
            <section className="bg-white rounded-2xl border p-5">
              <h2 className="text-lg font-bold text-gray-800 mb-2">Commentaires (facultatif)</h2>
              <textarea value={form.commentaires} disabled={readOnly} rows={3}
                onChange={(e) => setForm({ ...form, commentaires: e.target.value })}
                placeholder="Tout ce qui peut aider la CIP…" className="input-modern w-full text-base py-3" />
            </section>

            {!readOnly && (
              <button type="button" onClick={transmit} disabled={saving}
                className="w-full min-h-[56px] rounded-2xl bg-teal-600 text-white text-xl font-bold hover:bg-teal-700 disabled:opacity-50 shadow-lg">
                {saving ? 'Transmission…' : 'Transmettre à la CIP ✓'}
              </button>
            )}

            <p className="text-center">
              <Link to="/insertion" className="text-xs text-gray-400 hover:text-gray-600 underline">Retour au module insertion</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
