import { useState, useEffect, useCallback } from 'react';
import { Send, Printer, Eye, CalendarCheck } from 'lucide-react';
import { Section, FormField, Modal, LoadingSpinner, useToast } from '../index';
import api from '../../services/api';
import { frDate } from './freins';
import { exportFicheReferentPDF, exportReleveAssiduitePDF } from './pdf-referent';
import { MOMENTS_FICHE, MOMENT_LABELS, MODES_REMISE, MODE_REMISE_LABELS, DESTINATAIRE_LABELS } from './entretiens-rsa';

/**
 * « Fiche pour le référent » et « Actualisation France Travail » — PR B, lot 3.
 *
 * Solidarité Textiles est structure d'accueil : elle ALIMENTE un référent
 * unique externe. Ce panneau est l'endroit où cette alimentation devient un
 * geste tracé, avec trois garde-fous visibles à l'écran :
 *
 *  1. SANS RÉFÉRENT, PAS DE FICHE. Le serveur refuse en 409 ; l'écran n'attend
 *     pas ce refus pour le dire, et renvoie vers la rubrique où se saisit le
 *     référent. Un document sans destinataire n'existe pas.
 *
 *  2. L'APERÇU N'ÉCRIT RIEN. On regarde ce qui partirait avant de décider, puis
 *     « Générer » enregistre un SNAPSHOT : ce qui a été transmis le 12 mars
 *     reste ce qu'il était le 12 mars, même si le dossier a changé depuis.
 *
 *  3. LA REMISE SE TRACE DEUX FOIS — au référent ET à la personne. Ce qu'on dit
 *     d'elle à un tiers, elle doit pouvoir le lire.
 *
 * Le bloc « Actualisation France Travail » ne s'affiche que si la personne y
 * est soumise, et ses trois états sont distincts : « faite », « non faite »,
 * et surtout « on ne sait pas » — un « non » déduit du silence accuserait d'un
 * manquement que personne n'a constaté.
 */

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const ilYAUnAn = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

export default function FicheReferentPanel({ employeeId, cadre, adminRh }) {
  const toast = useToast();
  const referent = (cadre && cadre.orientation && cadre.orientation.referent_unique) || {};
  const referentDetermine = referent.type && referent.type !== 'non_determine';
  const actualisationRequise = !!(cadre && cadre.orientation
    && cadre.orientation.actualisation_ft && cadre.orientation.actualisation_ft.requise);

  const [fiches, setFiches] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [periode, setPeriode] = useState({ du: ilYAUnAn(), au: aujourdhui() });
  const [moment, setMoment] = useState('demande');
  const [enCours, setEnCours] = useState(null); // 'apercu' | 'generation' | 'assiduite'
  const [apercu, setApercu] = useState(null);
  const [remiseDe, setRemiseDe] = useState(null); // fiche en cours d'édition de remise

  const charger = useCallback(() => {
    let actif = true;
    setChargement(true);
    api.get(`/insertion/rsa/${employeeId}/alimentations`)
      .then((r) => { if (actif) { setFiches(Array.isArray(r.data) ? r.data : []); setErreur(null); } })
      .catch((err) => {
        if (!actif) return;
        if (err?.response?.status === 403) { setFiches([]); setErreur(null); }
        else setErreur(err?.response?.data?.error || err?.message || 'Historique indisponible');
      })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [employeeId]);

  useEffect(() => charger(), [charger]);

  /** Message d'erreur lisible : le 409 « référent non déterminé » a son propre texte. */
  const messageErreur = (err, repli) => {
    const d = err?.response?.data;
    if (d?.code === 'REFERENT_NON_DETERMINE') return `${d.error} ${d.hint || ''}`.trim();
    return d?.error || err?.message || repli;
  };

  const voirApercu = async () => {
    setEnCours('apercu');
    try {
      const r = await api.get(`/insertion/rsa/${employeeId}/fiche-referent?du=${periode.du}&au=${periode.au}`);
      setApercu(r.data.contenu);
    } catch (err) {
      toast.error(messageErreur(err, 'Aperçu impossible.'));
    }
    setEnCours(null);
  };

  const generer = async () => {
    setEnCours('generation');
    try {
      const r = await api.post(`/insertion/rsa/${employeeId}/fiche-referent`, { moment, du: periode.du, au: periode.au });
      toast.success('Fiche enregistrée. Vous pouvez l\'imprimer puis tracer sa remise.');
      setApercu(null);
      charger();
      exportFicheReferentPDF(r.data.contenu, { moment });
    } catch (err) {
      toast.error(messageErreur(err, 'Génération impossible.'));
    }
    setEnCours(null);
  };

  const imprimerFiche = async (id) => {
    try {
      const r = await api.get(`/insertion/rsa/${employeeId}/alimentations/${id}`);
      exportFicheReferentPDF(r.data.contenu, { moment: r.data.moment });
    } catch (err) {
      toast.error(messageErreur(err, 'Fiche illisible.'));
    }
  };

  const imprimerAssiduite = async (variante) => {
    setEnCours('assiduite');
    try {
      const r = await api.get(`/insertion/rsa/${employeeId}/assiduite?du=${periode.du}&au=${periode.au}&variante=${variante}`);
      exportReleveAssiduitePDF(r.data);
    } catch (err) {
      toast.error(messageErreur(err, 'Relevé indisponible.'));
    }
    setEnCours(null);
  };

  const enregistrerRemise = async (corps) => {
    try {
      await api.put(`/insertion/rsa/${employeeId}/alimentations/${remiseDe.id}/remise`, corps);
      setRemiseDe(null);
      charger();
      toast.success('Remise enregistrée.');
    } catch (err) {
      toast.error(messageErreur(err, 'Enregistrement impossible.'));
    }
  };

  return (
    <>
      <Section title="Fiche pour le référent" icon={Send}
        subtitle="Solidarité Textiles est structure d'accueil : elle alimente le référent unique, elle ne tient pas le contrat d'engagements réciproques">
        {!referentDetermine && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-3 text-sm mb-3">
            Aucun référent unique n&apos;est déterminé pour cette personne : la fiche ne peut pas être produite.
            Renseignez-le dans la rubrique « Orientation et référent unique » ci-dessus.
          </div>
        )}
        {referentDetermine && (
          <p className="text-sm text-slate-600 mb-3">
            Destinataire : <strong>{DESTINATAIRE_LABELS[referent.type] || referent.type}</strong>
            {referent.nom ? ` — ${referent.nom}` : ''}
            {referent.contact ? ` (${referent.contact})` : ''}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="Période — du" name="fiche_du" type="date" disabled={!adminRh}
            value={periode.du} onChange={(e) => setPeriode({ ...periode, du: e.target.value })} />
          <FormField label="au" name="fiche_au" type="date" disabled={!adminRh}
            value={periode.au} onChange={(e) => setPeriode({ ...periode, au: e.target.value })} />
          <FormField label="Motif de la transmission" name="fiche_moment" type="select" disabled={!adminRh}
            value={moment} options={MOMENTS_FICHE}
            onChange={(e) => setMoment(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5"
            disabled={!adminRh || !referentDetermine || enCours === 'apercu'} onClick={voirApercu}>
            <Eye className="w-4 h-4" aria-hidden="true" />
            {enCours === 'apercu' ? 'Chargement…' : 'Voir ce qui serait transmis'}
          </button>
          <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5"
            disabled={!adminRh || !referentDetermine || enCours === 'generation'} onClick={generer}>
            <Send className="w-4 h-4" aria-hidden="true" />
            {enCours === 'generation' ? 'Génération…' : 'Générer la fiche'}
          </button>
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5"
            disabled={enCours === 'assiduite'} onClick={() => imprimerAssiduite('tiers')}>
            <Printer className="w-4 h-4" aria-hidden="true" />
            Relevé d&apos;assiduité
          </button>
          {adminRh && (
            <button type="button" className="btn-secondary text-sm" disabled={enCours === 'assiduite'}
              title="Version interne, avec les références des justificatifs — ne se transmet pas au référent"
              onClick={() => imprimerAssiduite('dossier')}>
              Relevé (exemplaire dossier)
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500 mt-3">
          La fiche ne contient aucune donnée de santé ni aucune donnée judiciaire, et un exemplaire est remis à la
          personne concernée. « Voir ce qui serait transmis » n&apos;enregistre rien ; « Générer » conserve une copie
          exacte de ce qui est parti.
        </p>

        {/* ── Historique des fiches transmises ── */}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h4 className="text-sm font-medium text-slate-700 mb-2">Fiches déjà produites</h4>
          {chargement && <LoadingSpinner size="sm" message="Chargement…" />}
          {erreur && <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2 text-sm">{erreur}</div>}
          {!chargement && !erreur && fiches.length === 0 && (
            <p className="text-sm text-slate-400">Aucune fiche produite pour l&apos;instant.</p>
          )}
          {fiches.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="py-1.5 pr-3">Produite le</th>
                    <th className="py-1.5 pr-3">Motif</th>
                    <th className="py-1.5 pr-3">Période</th>
                    <th className="py-1.5 pr-3">Remise au référent</th>
                    <th className="py-1.5 pr-3">Remise à la personne</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {fiches.map((f) => (
                    <tr key={f.id} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3">{frDate(f.genere_le)}</td>
                      <td className="py-1.5 pr-3">{MOMENT_LABELS[f.moment] || f.moment}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{frDate(f.periode_debut)} → {frDate(f.periode_fin)}</td>
                      <td className="py-1.5 pr-3">
                        {f.remis_referent_le
                          ? `${frDate(f.remis_referent_le)}${f.remis_referent_mode ? ` — ${MODE_REMISE_LABELS[f.remis_referent_mode] || f.remis_referent_mode}` : ''}`
                          : <span className="text-amber-700">à tracer</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {f.remis_salarie_le ? frDate(f.remis_salarie_le) : <span className="text-amber-700">à tracer</span>}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <button type="button" className="text-teal-700 hover:underline text-xs mr-3"
                          onClick={() => imprimerFiche(f.id)}>Imprimer</button>
                        {adminRh && (
                          <button type="button" className="text-slate-600 hover:underline text-xs"
                            onClick={() => setRemiseDe(f)}>Tracer la remise</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      {actualisationRequise && (
        <ActualisationFtBloc employeeId={employeeId} adminRh={adminRh} />
      )}

      {/* Aperçu — ce qui partirait, avant de décider */}
      <Modal isOpen={!!apercu} onClose={() => setApercu(null)} title="Ce qui serait transmis au référent" size="lg">
        {apercu && <ApercuFiche contenu={apercu} />}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary text-sm" onClick={() => setApercu(null)}>Fermer</button>
          <button type="button" className="btn-secondary text-sm"
            onClick={() => exportFicheReferentPDF(apercu, { moment })}>Imprimer sans enregistrer</button>
          <button type="button" className="btn-primary text-sm" disabled={!adminRh} onClick={generer}>Générer et enregistrer</button>
        </div>
      </Modal>

      <ModalRemise fiche={remiseDe} onClose={() => setRemiseDe(null)} onSubmit={enregistrerRemise} />
    </>
  );
}

/** Aperçu synthétique : les rubriques et leur volume, pas une seconde mise en page. */
function ApercuFiche({ contenu }) {
  const c = contenu || {};
  const lignes = [
    ['Identité et destinataire', `${(c.identite || {}).nom || ''} ${(c.identite || {}).prenom || ''}`.trim() || '—'],
    ['Situation d\'emploi', (c.situation_emploi || {}).type_contrat || 'non renseignée'],
    ['Activité hebdomadaire', `${((c.activite || {}).semaines || []).length} semaine(s) — ${(c.activite || {}).nb_semaines_sous_seuil || 0} en dessous de 15 h`],
    ['Assiduité', `${(c.assiduite || {}).rdv_proposes || 0} rendez-vous, ${(c.assiduite || {}).rdv_honores || 0} honoré(s)`],
    ['Freins suivis', `${(c.freins || []).length} domaine(s) — ni santé, ni judiciaire`],
    ['Actions et orientations', `${(c.actions || []).length} action(s)`],
    ['Objectifs en cours', `${(c.objectifs || []).length} objectif(s)`],
    ['Prochaines échéances', (c.prochaines_echeances || {}).prochain_rdv ? frDate(c.prochaines_echeances.prochain_rdv) : 'aucune'],
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        Les rubriques ci-dessous sont les <strong>seules</strong> qui composent la fiche. Les données de santé
        (article 9) et les données judiciaires (article 10) n&apos;y figurent pas, et leur absence n&apos;y est pas
        signalée non plus.
      </p>
      <dl className="divide-y divide-slate-100 border border-slate-200 rounded-[10px]">
        {lignes.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <dt className="text-sm text-slate-700">{k}</dt>
            <dd className="text-sm text-slate-500 text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Trace de remise — les deux dates sont indépendantes, et une date future est refusée. */
function ModalRemise({ fiche, onClose, onSubmit }) {
  const [form, setForm] = useState({ remis_referent_le: '', remis_referent_mode: '', remis_salarie_le: '' });
  useEffect(() => {
    if (!fiche) return;
    setForm({
      remis_referent_le: fiche.remis_referent_le ? String(fiche.remis_referent_le).slice(0, 10) : '',
      remis_referent_mode: fiche.remis_referent_mode || '',
      remis_salarie_le: fiche.remis_salarie_le ? String(fiche.remis_salarie_le).slice(0, 10) : '',
    });
  }, [fiche]);

  return (
    <Modal isOpen={!!fiche} onClose={onClose} title="Tracer la remise de la fiche">
      <div className="space-y-3">
        <FormField label="Remise au référent le" name="remis_referent_le" type="date" max={aujourdhui()}
          value={form.remis_referent_le} onChange={(e) => setForm({ ...form, remis_referent_le: e.target.value })} />
        <FormField label="Par quel moyen" name="remis_referent_mode" type="select" placeholder="— non précisé"
          value={form.remis_referent_mode} options={MODES_REMISE}
          onChange={(e) => setForm({ ...form, remis_referent_mode: e.target.value })} />
        <FormField label="Exemplaire remis à la personne le" name="remis_salarie_le" type="date" max={aujourdhui()}
          hint="Ce qui est dit d'elle à un tiers, elle doit pouvoir le lire."
          value={form.remis_salarie_le} onChange={(e) => setForm({ ...form, remis_salarie_le: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" className="btn-secondary text-sm" onClick={onClose}>Annuler</button>
        <button type="button" className="btn-primary text-sm"
          onClick={() => onSubmit({
            remis_referent_le: form.remis_referent_le || null,
            remis_referent_mode: form.remis_referent_mode || null,
            remis_salarie_le: form.remis_salarie_le || null,
          })}>Enregistrer</button>
      </div>
    </Modal>
  );
}

/**
 * Actualisation mensuelle France Travail — douze mois, trois états.
 *
 * « ? » n'est pas un défaut d'affichage : c'est l'état normal d'un mois dont
 * personne n'a constaté quoi que ce soit. Le forcer à « non » ferait de chaque
 * mois non vérifié un manquement de la personne, et c'est ce constat qui peut
 * fonder une suspension de droits.
 */
function ActualisationFtBloc({ employeeId, adminRh }) {
  const toast = useToast();
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [mois, setMois] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(() => {
    let actif = true;
    setChargement(true);
    api.get(`/insertion/rsa/${employeeId}/actualisations-ft?annee=${annee}`)
      .then((r) => { if (actif) { setMois(r.data?.mois || []); setErreur(null); } })
      .catch((err) => {
        if (!actif) return;
        if (err?.response?.status === 403) { setMois([]); setErreur(null); }
        else setErreur(err?.response?.data?.error || err?.message || 'Registre indisponible');
      })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [employeeId, annee]);

  useEffect(() => charger(), [charger]);

  const ecrire = async (m, corps) => {
    try {
      await api.put(`/insertion/rsa/${employeeId}/actualisations-ft/${m}`, corps);
      charger();
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Enregistrement impossible.');
    }
  };

  const anneesDispo = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

  return (
    <Section title="Actualisation France Travail" icon={CalendarCheck}
      subtitle="Rappel mensuel et constat — un mois non vérifié reste « on ne sait pas »"
      actions={(
        <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))}
          className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-700" aria-label="Année">
          {anneesDispo.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}>
      {chargement && <LoadingSpinner size="sm" message="Chargement…" />}
      {erreur && <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2 text-sm">{erreur}</div>}
      {!chargement && !erreur && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {mois.map((m, i) => (
            <div key={m.mois} className="border border-slate-200 rounded-[10px] p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{MOIS_COURTS[i]}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  m.honoree === true ? 'bg-emerald-50 text-emerald-700'
                    : m.honoree === false ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-400'
                }`}>
                  {m.honoree === true ? 'faite' : m.honoree === false ? 'non faite' : 'non constatée'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {m.rappel_le ? `Rappel le ${frDate(m.rappel_le)}` : 'Aucun rappel'}
              </div>
              {adminRh && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  <button type="button" className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50"
                    onClick={() => ecrire(m.mois, { rappel_le: new Date().toISOString().slice(0, 10) })}>Rappel fait</button>
                  <button type="button" className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => ecrire(m.mois, { honoree: true, constat_le: new Date().toISOString().slice(0, 10) })}>Faite</button>
                  <button type="button" className="text-[11px] px-1.5 py-0.5 rounded border border-amber-200 text-amber-800 hover:bg-amber-50"
                    onClick={() => ecrire(m.mois, { honoree: false, constat_le: new Date().toISOString().slice(0, 10) })}>Non faite</button>
                  {m.honoree != null && (
                    <button type="button" className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                      title="Revenir à « non constatée » — on ne sait pas est un état à part entière"
                      onClick={() => ecrire(m.mois, { honoree: null })}>Effacer</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
