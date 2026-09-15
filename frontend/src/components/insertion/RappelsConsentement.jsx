import { useState, useEffect, useCallback } from 'react';
import { BellRing } from 'lucide-react';
import { Section, FormField, LoadingSpinner, ConfirmDialog, useToast } from '../index';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { frDate } from './freins';

/**
 * Rappels de rendez-vous J-1 — recueil et retrait du consentement (PR C, lot 7).
 *
 * ═══ POURQUOI UN ÉCRAN DE CONSENTEMENT, ET PAS UNE CASE DANS LA FICHE ═════
 * Prévenir quelqu'un par SMS n'est ni une obligation contractuelle ni une
 * mission d'intérêt public : c'est un service qu'on lui rend, donc un traitement
 * fondé sur son CONSENTEMENT (art. 6-1-a), qui doit être éclairé, tracé, et
 * retirable aussi simplement qu'il a été donné (art. 7-3). D'où :
 *
 *  - la PHRASE À LIRE À LA PERSONNE, affichée en toutes lettres : la conseillère
 *    n'a pas à improviser l'information ;
 *  - le canal ET le destinataire CHOISIS par la personne — son numéro personnel
 *    n'est pas forcément celui que la paie connaît ;
 *  - un bouton de retrait aussi visible que le bouton d'accord ;
 *  - « jamais demandé » distinct de « a refusé » : la question reste à poser.
 *
 * ═══ CE QUE LE MESSAGE NE DIT JAMAIS ══════════════════════════════════════
 * Ni le type de rendez-vous, ni son motif, ni rien du parcours. C'est écrit à
 * l'écran parce que c'est ce que la personne demandera : un SMS arrive sur un
 * téléphone que d'autres voient.
 *
 * Les contacts connus sont proposés MASQUÉS. La conseillère vérifie de vive voix
 * (« c'est bien le 06 qui finit par 12 ? ») ; faire d'un écran de consentement un
 * annuaire de plus n'apporterait rien.
 *
 * ADMIN/RH strict : le composant ne rend rien pour les autres rôles.
 */

const CANAUX = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'E-mail' },
];

const STATUT_RAPPEL = { envoye: 'Envoyé', echec: 'Échec', dry_run: 'Simulé (envoi non configuré)' };

const messageErreur = (err, repli) => err?.response?.data?.error || err?.message || repli;

export default function RappelsConsentement({ employee }) {
  const { user } = useAuth();
  const toast = useToast();
  const baseRole = user?.base_role || user?.role;
  const adminRh = baseRole === 'ADMIN' || baseRole === 'RH';
  const employeeId = employee?.id;

  const [etat, setEtat] = useState(null);
  const [rappels, setRappels] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [form, setForm] = useState({ canal: 'sms', destinataire: '' });
  const [enregistrement, setEnregistrement] = useState(false);
  const [retraitDemande, setRetraitDemande] = useState(false);

  const charger = useCallback(() => {
    if (!adminRh || !employeeId) return undefined;
    let actif = true;
    setChargement(true);
    Promise.all([
      api.get(`/insertion/salarie/${employeeId}/rappels-consentement`),
      api.get(`/insertion/salarie/${employeeId}/rappels`).catch(() => ({ data: [] })),
    ])
      .then(([c, r]) => {
        if (!actif) return;
        setEtat(c.data || null);
        setRappels(Array.isArray(r.data) ? r.data : []);
        setForm((f) => ({ ...f, canal: c.data?.canal || 'sms' }));
        setErreur(null);
      })
      .catch((err) => {
        if (!actif) return;
        if (err?.response?.status === 403) { setEtat(null); setErreur(null); }
        else setErreur(messageErreur(err, 'Consentement indisponible'));
      })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [employeeId, adminRh]);

  useEffect(() => charger(), [charger]);

  if (!adminRh || !employeeId) return null;

  const ecrire = async (corps) => {
    setEnregistrement(true);
    try {
      await api.put(`/insertion/salarie/${employeeId}/rappels-consentement`, corps);
      setForm((f) => ({ ...f, destinataire: '' }));
      charger();
      toast.success(corps.consent ? 'Consentement enregistré.' : 'Consentement retiré.');
    } catch (err) {
      toast.error(messageErreur(err, 'Enregistrement impossible.'));
    }
    setEnregistrement(false);
  };

  const contacts = etat?.contacts_disponibles || {};
  const suggestions = [
    form.canal === 'sms' && contacts.phone_masque ? contacts.phone_masque : null,
    form.canal === 'email' && contacts.email_masque ? contacts.email_masque : null,
    form.canal === 'email' && contacts.personal_email_masque ? contacts.personal_email_masque : null,
  ].filter(Boolean);

  const accepte = etat?.consent === true;
  const refuse = etat?.consent === false;

  return (
    <>
      <Section title="Rappels de rendez-vous" icon={BellRing}
        subtitle="Un message la veille de chaque rendez-vous — uniquement si la personne l'a demandé">
        {chargement && <LoadingSpinner size="sm" message="Chargement…" />}
        {erreur && <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2 text-sm">{erreur}</div>}

        {!chargement && !erreur && (
          <>
            <div className={`rounded-[10px] p-3 text-sm mb-3 border ${
              accepte ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : refuse ? 'bg-slate-50 border-slate-200 text-slate-600'
                  : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              {accepte && (
                <>
                  <strong>Accepté</strong>
                  {etat.consent_at ? ` le ${frDate(etat.consent_at)}` : ''}
                  {etat.consent_par_nom ? ` (recueilli par ${etat.consent_par_nom})` : ''}
                  {' — '}
                  {etat.canal === 'email' ? 'par e-mail à ' : 'par SMS au '}
                  <strong>{etat.destinataire_masque || '—'}</strong>
                </>
              )}
              {refuse && (
                <>
                  <strong>Refusé</strong>
                  {etat.consent_at ? ` le ${frDate(etat.consent_at)}` : ''}
                  {' — aucun rappel ne sera envoyé. Vous pouvez reposer la question à tout moment.'}
                </>
              )}
              {!accepte && !refuse && (
                <>
                  <strong>Jamais demandé.</strong>{' '}
                  La question n&apos;a pas encore été posée à la personne : ce n&apos;est pas un refus.
                </>
              )}
            </div>

            <div className="bg-teal-50 border border-teal-200 rounded-[10px] p-3 text-sm text-teal-900 mb-3">
              <p className="font-medium mb-1">À lire à la personne avant de cocher :</p>
              <p>
                « Vous recevrez un message la veille de chaque rendez-vous. Vous pouvez arrêter quand vous voulez.
                Le message ne dit jamais pourquoi vous avez rendez-vous. »
              </p>
            </div>

            {!accepte && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <FormField label="Comment ?" name="rappel_canal" type="select"
                  value={form.canal} options={CANAUX}
                  onChange={(e) => setForm({ ...form, canal: e.target.value, destinataire: '' })} />
                <div className="sm:col-span-2">
                  <FormField
                    label={form.canal === 'sms' ? 'Numéro choisi par la personne' : 'Adresse choisie par la personne'}
                    name="rappel_destinataire"
                    type={form.canal === 'sms' ? 'text' : 'email'}
                    placeholder={form.canal === 'sms' ? '06 12 34 56 78' : 'prenom.nom@exemple.fr'}
                    value={form.destinataire}
                    onChange={(e) => setForm({ ...form, destinataire: e.target.value })}
                    hint={suggestions.length
                      ? `Contact connu : ${suggestions.join(' · ')} — vérifiez de vive voix, puis saisissez-le en entier.`
                      : 'Aucun contact connu dans la fiche : saisissez celui que la personne indique.'}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              {!accepte && (
                <button type="button" className="btn-primary text-sm"
                  disabled={enregistrement || !form.destinataire.trim()}
                  onClick={() => ecrire({ consent: true, canal: form.canal, destinataire: form.destinataire.trim() })}>
                  {enregistrement ? 'Enregistrement…' : 'La personne accepte les rappels'}
                </button>
              )}
              {!accepte && !refuse && (
                <button type="button" className="btn-secondary text-sm" disabled={enregistrement}
                  onClick={() => ecrire({ consent: false })}>
                  La personne ne souhaite pas de rappel
                </button>
              )}
              {accepte && (
                <button type="button" className="btn-secondary text-sm" disabled={enregistrement}
                  onClick={() => setRetraitDemande(true)}>
                  Retirer le consentement
                </button>
              )}
            </div>

            <p className="text-xs text-slate-500 mt-3">
              Le message est envoyé la veille, en fin de journée. Il porte le prénom de la personne, la date, l&apos;heure
              et le prénom de sa conseillère — rien d&apos;autre. Le contact enregistré est effacé dès le retrait du
              consentement.
            </p>

            {rappels.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <h4 className="text-sm font-medium text-slate-700 mb-2">Rappels envoyés</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                        <th className="py-1.5 pr-3">Envoyé le</th>
                        <th className="py-1.5 pr-3">Canal</th>
                        <th className="py-1.5 pr-3">Destinataire</th>
                        <th className="py-1.5">État</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rappels.map((r) => (
                        <tr key={r.id} className="border-b border-slate-50">
                          <td className="py-1.5 pr-3">{frDate(r.envoye_le)}</td>
                          <td className="py-1.5 pr-3">{r.canal === 'email' ? 'E-mail' : 'SMS'}</td>
                          <td className="py-1.5 pr-3 text-slate-500">{r.destinataire_masque}</td>
                          <td className="py-1.5">
                            <span className={r.statut === 'echec' ? 'text-red-600' : 'text-slate-600'}>
                              {STATUT_RAPPEL[r.statut] || r.statut}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      <ConfirmDialog
        isOpen={retraitDemande}
        title="Retirer le consentement"
        message="Plus aucun rappel ne sera envoyé, et le contact enregistré sera effacé. Vous pourrez reposer la question plus tard."
        confirmLabel="Retirer"
        loading={enregistrement}
        onCancel={() => setRetraitDemande(false)}
        onConfirm={() => { setRetraitDemande(false); ecrire({ consent: false }); }}
      />
    </>
  );
}
