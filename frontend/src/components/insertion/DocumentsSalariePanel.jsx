import { useState, useEffect, useCallback } from 'react';
import { FileText, Printer, Eye } from 'lucide-react';
import { Section, FormField, Modal, LoadingSpinner, useToast } from '../index';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { frDate } from './freins';
import { exportMonParcoursPDF, exportMonRecapPDF } from './pdf-salarie';

/**
 * « Mon parcours en une page » et « Mon Récap » — PR C, lot 7.
 *
 * Les deux seuls documents de l'outil écrits POUR la personne accompagnée. Trois
 * garde-fous visibles à l'écran :
 *
 *  1. L'APERÇU N'ENREGISTRE RIEN. On regarde ce que dirait le document avant de
 *     le produire. « Générer » enregistre un SNAPSHOT : ce qui a été remis le
 *     12 mars reste ce qu'il était le 12 mars, alors que le dossier a changé.
 *
 *  2. LE PDF EST RENDU DEPUIS LE SNAPSHOT, jamais recomposé. « Réimprimer »
 *     relit le document enregistré : deux exemplaires du même document ne
 *     peuvent pas diverger.
 *
 *  3. LA REMISE SE TRACE, ET UNE SEULE FOIS. Un document généré n'est pas un
 *     document remis ; et une remise déjà tracée ne se retrace pas (le serveur
 *     refuse en 409) — pour une nouvelle remise, on génère un document à jour.
 *
 * ADMIN/RH strict : le composant ne rend RIEN pour les autres rôles (les
 * documents portent le référent unique et les heures hebdomadaires). Ne pas
 * l'afficher plutôt que l'afficher vide — un cadre vide se lit « il n'y a rien »,
 * ce qui est faux.
 */

const TYPE_LABELS = {
  mon_parcours: 'Mon parcours en une page',
  mon_recap: 'Mon Récap',
};

const MODES_REMISE = [
  { value: 'main_propre', label: 'En main propre' },
  { value: 'email', label: 'Par e-mail' },
  { value: 'courrier', label: 'Par courrier' },
];
const MODE_LABELS = Object.fromEntries(MODES_REMISE.map((m) => [m.value, m.label]));

const aujourdhui = () => {
  // Jour civil de Paris : sur un poste réglé sur un autre fuseau, un
  // `toISOString().slice(0,10)` proposerait la veille comme date de remise.
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return p;
};

const messageErreur = (err, repli) =>
  err?.response?.data?.error || err?.message || repli;

export default function DocumentsSalariePanel({ employee }) {
  const { user } = useAuth();
  const toast = useToast();
  const baseRole = user?.base_role || user?.role;
  const adminRh = baseRole === 'ADMIN' || baseRole === 'RH';
  const employeeId = employee?.id;

  const [documents, setDocuments] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(null);   // 'apercu:<type>' | 'generation:<type>' | 'impression'
  const [apercu, setApercu] = useState(null);     // { type, contenu }
  const [remiseDe, setRemiseDe] = useState(null); // document en cours de traçage

  const charger = useCallback(() => {
    if (!adminRh || !employeeId) return undefined;
    let actif = true;
    setChargement(true);
    api.get(`/insertion/salarie/${employeeId}/documents`)
      .then((r) => { if (actif) { setDocuments(Array.isArray(r.data) ? r.data : []); setErreur(null); } })
      .catch((err) => {
        if (!actif) return;
        if (err?.response?.status === 403) { setDocuments([]); setErreur(null); }
        else setErreur(messageErreur(err, 'Historique indisponible'));
      })
      .finally(() => { if (actif) setChargement(false); });
    return () => { actif = false; };
  }, [employeeId, adminRh]);

  useEffect(() => charger(), [charger]);

  // Le composant ne rend rien hors ADMIN/RH — hooks appelés avant, pour ne pas
  // violer l'ordre des hooks entre deux rendus.
  if (!adminRh || !employeeId) return null;

  const imprimer = (type, contenu) => {
    if (type === 'mon_recap') exportMonRecapPDF(contenu);
    else exportMonParcoursPDF(contenu);
  };

  const voirApercu = async (type) => {
    setEnCours(`apercu:${type}`);
    try {
      const url = type === 'mon_recap' ? 'mon-recap' : 'mon-parcours';
      const r = await api.get(`/insertion/salarie/${employeeId}/${url}`);
      setApercu({ type, contenu: r.data.contenu });
    } catch (err) {
      toast.error(messageErreur(err, 'Aperçu impossible.'));
    }
    setEnCours(null);
  };

  const generer = async (type) => {
    setEnCours(`generation:${type}`);
    try {
      const url = type === 'mon_recap' ? 'mon-recap' : 'mon-parcours';
      const r = await api.post(`/insertion/salarie/${employeeId}/${url}`);
      setApercu(null);
      charger();
      imprimer(type, r.data.contenu);
      toast.success(`${TYPE_LABELS[type]} enregistré. Vous pouvez l'imprimer puis tracer sa remise.`);
    } catch (err) {
      toast.error(messageErreur(err, 'Génération impossible.'));
    }
    setEnCours(null);
  };

  const reimprimer = async (doc) => {
    setEnCours('impression');
    try {
      const r = await api.get(`/insertion/salarie/${employeeId}/documents/${doc.id}`);
      imprimer(r.data.type, r.data.contenu);
    } catch (err) {
      toast.error(messageErreur(err, 'Document illisible.'));
    }
    setEnCours(null);
  };

  const enregistrerRemise = async (corps) => {
    try {
      await api.put(`/insertion/salarie/${employeeId}/documents/${remiseDe.id}/remise`, corps);
      setRemiseDe(null);
      charger();
      toast.success('Remise enregistrée.');
    } catch (err) {
      toast.error(messageErreur(err, 'Enregistrement impossible.'));
    }
  };

  return (
    <>
      <Section title="Documents pour la personne" icon={FileText}
        subtitle="Deux documents écrits pour elle : ce qui l'engage et ce qui engage la structure, puis le récapitulatif de son parcours">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {['mon_parcours', 'mon_recap'].map((type) => (
            <div key={type} className="border border-slate-200 rounded-[10px] p-3">
              <h4 className="text-sm font-medium text-slate-800">{TYPE_LABELS[type]}</h4>
              <p className="text-xs text-slate-500 mt-1 mb-2">
                {type === 'mon_parcours'
                  ? 'Une page, en langage simple : mes engagements, ceux de la structure, mes heures de la semaine, mon prochain rendez-vous, mon référent.'
                  : 'Les étapes datées de mon parcours, que je peux montrer à qui je veux — sans donnée de santé, de justice ni de situation sociale.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5"
                  disabled={enCours === `apercu:${type}`} onClick={() => voirApercu(type)}>
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  {enCours === `apercu:${type}` ? 'Chargement…' : 'Aperçu'}
                </button>
                <button type="button" className="btn-primary text-xs inline-flex items-center gap-1.5"
                  disabled={enCours === `generation:${type}`} onClick={() => generer(type)}>
                  <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                  {enCours === `generation:${type}` ? 'Génération…' : 'Générer et imprimer'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500 mt-3">
          « Aperçu » n&apos;enregistre rien. « Générer » conserve une copie exacte de ce qui a été édité : c&apos;est
          elle qui est réimprimée plus tard, pour que deux exemplaires du même document ne puissent pas diverger.
        </p>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <h4 className="text-sm font-medium text-slate-700 mb-2">Documents déjà produits</h4>
          {chargement && <LoadingSpinner size="sm" message="Chargement…" />}
          {erreur && <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2 text-sm">{erreur}</div>}
          {!chargement && !erreur && documents.length === 0 && (
            <p className="text-sm text-slate-400">Aucun document produit pour l&apos;instant.</p>
          )}
          {documents.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="py-1.5 pr-3">Document</th>
                    <th className="py-1.5 pr-3">Produit le</th>
                    <th className="py-1.5 pr-3">Par</th>
                    <th className="py-1.5 pr-3">Remis</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3">{TYPE_LABELS[d.type] || d.type}</td>
                      <td className="py-1.5 pr-3">{frDate(d.genere_le)}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{d.genere_par_nom || '—'}</td>
                      <td className="py-1.5 pr-3">
                        {d.remis_le
                          ? `${frDate(d.remis_le)}${d.remis_mode ? ` — ${MODE_LABELS[d.remis_mode] || d.remis_mode}` : ''}`
                          : <span className="text-amber-700">à tracer</span>}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <button type="button" className="text-teal-700 hover:underline text-xs mr-3"
                          disabled={enCours === 'impression'} onClick={() => reimprimer(d)}>Réimprimer</button>
                        {!d.remis_le && (
                          <button type="button" className="text-slate-600 hover:underline text-xs"
                            onClick={() => setRemiseDe(d)}>Tracer la remise</button>
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

      <Modal isOpen={!!apercu} onClose={() => setApercu(null)}
        title={apercu ? `Ce que dirait « ${TYPE_LABELS[apercu.type]} »` : ''} size="lg">
        {apercu && <ApercuDocument type={apercu.type} contenu={apercu.contenu} />}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary text-sm" onClick={() => setApercu(null)}>Fermer</button>
          <button type="button" className="btn-primary text-sm" onClick={() => generer(apercu.type)}>
            Générer et imprimer
          </button>
        </div>
      </Modal>

      <ModalRemise document={remiseDe} onClose={() => setRemiseDe(null)} onSubmit={enregistrerRemise} />
    </>
  );
}

/** Aperçu synthétique : les rubriques et leur volume, jamais une seconde mise en page. */
function ApercuDocument({ type, contenu }) {
  const c = contenu || {};
  const lignes = type === 'mon_recap'
    ? [
      ['Contrats', `${(c.contrats || []).length} contrat(s)`],
      ['Étapes du parcours', `${(c.etapes || []).length} étape(s) datée(s)`],
      ['Objectifs', `${(c.objectifs || {}).atteints || 0} atteint(s), ${(c.objectifs || {}).en_cours || 0} en cours`],
      ['Sortie', c.sortie ? (c.sortie.classification_libelle || 'renseignée') : 'parcours en cours'],
    ]
    : [
      ['Ce que je fais', `${(c.mes_engagements || []).length} engagement(s)`],
      ['Ce que la structure fait', `${(c.engagements_structure || []).length} action(s)`],
      ['Mes heures de la semaine', c.mes_heures_semaine ? `${c.mes_heures_semaine.total_h} h (${c.mes_heures_semaine.semaine})` : 'pas encore relevées'],
      ['Mon prochain rendez-vous', c.prochain_rdv ? c.prochain_rdv.date : 'aucun'],
      ['Mon référent', c.mon_referent ? c.mon_referent.type_libelle : 'à indiquer'],
      ['Documents remis', `${(c.mes_documents_remis || []).length} document(s)`],
    ];
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        Les rubriques ci-dessous sont les <strong>seules</strong> qui composent ce document. Aucune donnée de santé,
        de justice ni de situation sociale n&apos;y figure, et aucun commentaire écrit par la conseillère non plus.
        {type === 'mon_parcours' && ' Les heures de la semaine sont affichées telles quelles, sans objectif ni comparaison.'}
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

/** Trace de remise — date passée obligatoire, mode en liste fermée. */
function ModalRemise({ document: doc, onClose, onSubmit }) {
  const [form, setForm] = useState({ remis_le: aujourdhui(), remis_mode: 'main_propre' });
  useEffect(() => {
    if (doc) setForm({ remis_le: aujourdhui(), remis_mode: 'main_propre' });
  }, [doc]);

  return (
    <Modal isOpen={!!doc} onClose={onClose} title="Tracer la remise du document">
      <div className="space-y-3">
        <FormField label="Remis à la personne le" name="remis_le" type="date" max={aujourdhui()}
          value={form.remis_le} onChange={(e) => setForm({ ...form, remis_le: e.target.value })} />
        <FormField label="Par quel moyen" name="remis_mode" type="select"
          value={form.remis_mode} options={MODES_REMISE}
          onChange={(e) => setForm({ ...form, remis_mode: e.target.value })} />
        <p className="text-xs text-slate-500">
          Une remise se trace une seule fois. Pour une nouvelle remise, générez un document à jour.
        </p>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" className="btn-secondary text-sm" onClick={onClose}>Annuler</button>
        <button type="button" className="btn-primary text-sm"
          disabled={!form.remis_le || !form.remis_mode}
          onClick={() => onSubmit({ remis_le: form.remis_le, remis_mode: form.remis_mode })}>
          Enregistrer
        </button>
      </div>
    </Modal>
  );
}
