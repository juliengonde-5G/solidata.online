import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { DataTable, Modal, PageHeader } from '../components';
import { Shield, ScrollText, BookOpen, Clock, Trash2, Lock, UserCheck, FileClock, Bot, RefreshCw, CheckCircle2, AlertCircle, X } from 'lucide-react';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';
import { libelleActionRgpd, libelleEntiteRgpd } from '../utils/rgpd-libelles';

/**
 * Libellés du statut d'un passage de job (`job_runs.status`, via
 * GET /rgpd/purges → dernier_passage.statut). Ce n'est PAS un code
 * `rgpd_audit_log.action` (dictionnaire dans utils/rgpd-libelles.js) : c'est
 * l'état d'exécution technique du job lui-même, propre à cet écran.
 */
const STATUT_PASSAGE = {
  success: { label: 'Réussi', className: 'text-green-700' },
  error: { label: 'Échec', className: 'text-red-700' },
  timeout: { label: 'Délai dépassé', className: 'text-amber-700' },
};

const POLITIQUE_ICONS = {
  conservation: Clock,
  suppression: Trash2,
  chiffrement: Lock,
  droits: UserCheck,
  journalisation: FileClock,
  sous_traitance_ia: Bot,
};

export default function RGPD() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [tab, setTab] = useState('registre');
  const [registre, setRegistre] = useState([]);
  const [audit, setAudit] = useState([]);
  const [politique, setPolitique] = useState(null);
  const [politiqueError, setPolitiqueError] = useState(null);
  const [purges, setPurges] = useState([]);
  const [purgesError, setPurgesError] = useState(null);
  const [purgeRunning, setPurgeRunning] = useState({}); // { [cle]: bool }
  const [purgeResultat, setPurgeResultat] = useState(null); // bandeau de résultat { type, message }
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nom_traitement: '', finalite: '', base_legale: 'consentement', categories_personnes: '', categories_donnees: '', destinataires: '', duree_conservation: '', mesures_securite: '' });
  const [searchEntity, setSearchEntity] = useState({ type: 'candidate', id: '' });
  const [exportData, setExportData] = useState(null);

  useEffect(() => { loadData(); }, [tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'registre') {
        const r = await api.get('/rgpd/registre');
        setRegistre(r.data);
      } else if (tab === 'audit') {
        const r = await api.get('/rgpd/audit');
        setAudit(r.data);
      } else if (tab === 'politique') {
        setPolitiqueError(null);
        const r = await api.get('/rgpd/politique');
        setPolitique(r.data);
      } else if (tab === 'automatisations') {
        setPurgesError(null);
        const r = await api.get('/rgpd/purges');
        setPurges(listePurges(r.data));
      }
    } catch (err) {
      console.error(err);
      if (tab === 'politique') setPolitiqueError(err.response?.data?.error || 'Erreur de chargement');
      if (tab === 'automatisations') setPurgesError(err.response?.data?.error || 'Erreur de chargement des automatisations');
    }
    setLoading(false);
  };

  const addTraitement = async (e) => {
    e.preventDefault();
    try {
      await api.post('/rgpd/registre', form);
      setShowForm(false);
      setForm({ nom_traitement: '', finalite: '', base_legale: 'consentement', categories_personnes: '', categories_donnees: '', destinataires: '', duree_conservation: '', mesures_securite: '' });
      loadData();
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const handleExport = async () => {
    if (!searchEntity.id) return alert('ID requis');
    try {
      const r = await api.get(`/rgpd/export/${searchEntity.type}/${searchEntity.id}`);
      setExportData(r.data);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const handleAnonymize = async () => {
    if (!searchEntity.id) return alert('ID requis');
    const reason = prompt('Motif d\'anonymisation (obligatoire) :');
    if (!reason) return;
    const ok = await confirm({
      title: 'Anonymisation définitive',
      message: `ATTENTION : Anonymiser définitivement les données ${searchEntity.type} #${searchEntity.id} ? Conformité RGPD : action irréversible.`,
      confirmLabel: 'Anonymiser',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/rgpd/anonymize/${searchEntity.type}/${searchEntity.id}`, { reason });
      alert('Données anonymisées');
      setExportData(null);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  const handlePurge = async () => {
    const ok = await confirm({
      title: 'Purger les anciennes candidatures ?',
      message: 'Purger définitivement les candidatures non recrutées de plus de 24 mois ? Conforme RGPD (durée légale dépassée).',
      confirmLabel: 'Purger',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const r = await api.post('/rgpd/purge-expired');
      alert(r.data.message);
    } catch (err) { alert(err.response?.data?.error || 'Erreur'); }
  };

  // Déclenchement manuel d'une purge du registre (`GET /rgpd/purges`). Même
  // fonction serveur que le job planifié équivalent (doctrine anonymization.js
  // : un seul chemin par purge) — seul le déclencheur ('manual' vs 'auto') et
  // l'utilisateur journalisé changent. Résultat en BANDEAU, jamais d'alert() :
  // c'est justement ce que ce chantier corrige sur cet écran.
  const handleExecuterPurge = async (cle, libelle) => {
    const ok = await confirm({
      title: `Lancer la purge « ${libelle} » ?`,
      message: "Cette action supprime définitivement les données concernées, au-delà du seuil de rétention affiché. Irréversible, journalisée dans le journal d'audit RGPD.",
      confirmLabel: 'Lancer la purge',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setPurgeResultat(null);
    setPurgeRunning((r) => ({ ...r, [cle]: true }));
    try {
      const r = await api.post(`/rgpd/purges/${cle}/executer`);
      const detail = Object.entries(r.data.supprimes || {})
        .filter(([, n]) => Number(n) > 0)
        .map(([table, n]) => `${table} : ${n}`)
        .join(', ');
      const total = r.data.total ?? 0;
      setPurgeResultat({
        type: 'success',
        message: total > 0
          ? `« ${libelle} » — ${total} élément${total > 1 ? 's' : ''} supprimé${total > 1 ? 's' : ''}${detail ? ` (${detail})` : ''}.`
          : `« ${libelle} » — aucune donnée au-delà du seuil de rétention, rien à supprimer. Action journalisée.`,
      });
    } catch (err) {
      setPurgeResultat({
        type: 'error',
        message: `« ${libelle} » — ${err.response?.data?.error || "échec de l'exécution de la purge."}`,
      });
    }
    setPurgeRunning((r) => ({ ...r, [cle]: false }));
    // Rafraîchit la ligne (nouveau dernier passage) que l'exécution ait réussi ou non.
    try {
      const r2 = await api.get('/rgpd/purges');
      setPurges(listePurges(r2.data));
    } catch (err) { console.error(err); }
  };

  const TABS = [
    { key: 'registre', label: 'Registre des traitements' },
    { key: 'droits', label: 'Droits des personnes' },
    { key: 'automatisations', label: 'Automatisations & purges' },
    { key: 'audit', label: 'Journal d\'audit' },
    { key: 'politique', label: 'Règles de gestion des données' },
  ];

  const BASES = ['consentement', 'contrat', 'obligation_legale', 'interet_legitime', 'mission_publique', 'interet_vital'];

  const registreColumns = [
    { key: 'nom_traitement', label: 'Traitement', sortable: true, render: (r) => <span className="font-medium">{r.nom_traitement}</span> },
    { key: 'finalite', label: 'Finalité', render: (r) => <span className="text-gray-600">{r.finalite}</span> },
    { key: 'base_legale', label: 'Base légale', render: (r) => <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs">{r.base_legale}</span> },
    { key: 'duree_conservation', label: 'Durée conservation', render: (r) => r.duree_conservation || '—' },
    { key: 'is_active', label: 'Statut', render: (r) => (
      <span className={`px-2 py-0.5 rounded-full text-xs ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
        {r.is_active ? 'Actif' : 'Inactif'}
      </span>
    )},
  ];

  const auditColumns = [
    { key: 'created_at', label: 'Date', sortable: true, render: (a) => <span className="text-gray-500">{new Date(a.created_at).toLocaleString('fr-FR')}</span> },
    { key: 'user_name', label: 'Utilisateur', render: (a) => (a.user_id ? `${a.first_name || ''} ${a.last_name || ''}`.trim() || '—' : <span className="text-gray-400 italic">Automatique (job planifié)</span>) },
    { key: 'action', label: 'Action', render: (a) => (
      <span
        className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-xs font-medium"
        title={`Code technique : ${a.action}`}
      >
        {libelleActionRgpd(a.action)}
      </span>
    ) },
    { key: 'entity_type', label: 'Type', render: (a) => <span title={a.entity_type || ''}>{a.entity_type ? libelleEntiteRgpd(a.entity_type) : '—'}</span> },
    { key: 'entity_id', label: 'ID' },
    { key: 'details', label: 'Détails', render: (a) => <span className="text-gray-500 text-xs max-w-xs truncate block">{a.details ? JSON.stringify(a.details) : '—'}</span> },
  ];

  // `GET /rgpd/purges` renvoie un OBJET { generated_at, journal_disponible,
  // purges: [...] } — et non un tableau nu. Passer la réponse entière à
  // DataTable faisait planter tout l'écran (page blanche : « sortedData.map is
  // not a function »), alors même que l'appel répondait 200. On extrait la
  // liste, en tolérant qu'un serveur renvoie directement un tableau, et on ne
  // pose JAMAIS autre chose qu'un tableau dans l'état.
  const listePurges = (reponse) => (Array.isArray(reponse) ? reponse : (reponse?.purges ?? []));

  const purgesColumns = [
    { key: 'libelle', label: 'Purge', render: (p) => (
      <div>
        <span className="font-medium text-gray-900">{p.libelle}</span>
        {p.description && <p className="text-xs text-gray-500 mt-0.5 max-w-md">{p.description}</p>}
      </div>
    ) },
    // Le serveur renvoie `retention: { valeur, unite, defaut, source, parametrable }`
    // — la forme plate `retention_jours` est tolérée en repli (un serveur antérieur
    // au lot, ou une purge sans seuil). `source` dit d'où vient la valeur : l'écran
    // qui sert à PROUVER la conformité doit distinguer un seuil réglé d'un défaut.
    { key: 'retention', label: 'Rétention', render: (p) => {
      const valeur = p.retention?.valeur ?? p.retention_jours;
      if (valeur == null) return <span className="text-gray-400">—</span>;
      const unite = p.retention?.unite === 'jours' || !p.retention?.unite ? 'jour' : p.retention.unite;
      return (
        <div className="min-w-[7rem]">
          <span className="whitespace-nowrap">{valeur} {unite}{valeur > 1 && unite === 'jour' ? 's' : ''}</span>
          {p.retention?.source === 'code' && (
            <p className="text-xs text-gray-400">valeur par défaut</p>
          )}
          {p.retention?.source === 'settings' && (
            <p className="text-xs text-gray-400">réglée</p>
          )}
        </div>
      );
    } },
    { key: 'dernier_passage', label: 'Dernier passage', render: (p) => {
      const dp = p.dernier_passage;
      if (!dp || p.jamais_execute) return <span className="text-gray-400 italic">Jamais exécuté</span>;
      // Champs de `job_runs` tels que le serveur les expose (`status`,
      // `finished_at`, `items_processed`, `error_message`, `duration_ms`), avec
      // repli sur les noms francisés — sans quoi la colonne s'affiche vide en
      // silence, exactement le défaut de contrat corrigé ailleurs dans ce module.
      const statut = dp.status ?? dp.statut;
      const date = dp.finished_at ?? dp.started_at ?? dp.date;
      const items = dp.items_processed ?? dp.items;
      const duree = dp.duration_ms ?? dp.duree_ms;
      const erreur = dp.error_message ?? dp.erreur;
      const statutInfo = STATUT_PASSAGE[statut] || { label: statut || '—', className: 'text-gray-600' };
      return (
        <div className="space-y-0.5 min-w-[11rem]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${statutInfo.className}`}>{statutInfo.label}</span>
            {date && <span className="text-xs text-gray-400">{new Date(date).toLocaleString('fr-FR')}</span>}
          </div>
          <div className="text-xs text-gray-500">
            {items != null && <>{items} élément{items > 1 ? 's' : ''} traité{items > 1 ? 's' : ''}</>}
            {duree != null && <> · {duree} ms</>}
          </div>
          {erreur && <p className="text-xs text-red-600">{erreur}</p>}
        </div>
      );
    } },
    { key: 'lancer', label: '', render: (p) => (
      <button
        onClick={() => handleExecuterPurge(p.cle, p.libelle)}
        disabled={!!purgeRunning[p.cle]}
        className="btn-danger text-xs whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {purgeRunning[p.cle] ? (
          <span className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> En cours…</span>
        ) : 'Lancer maintenant'}
      </button>
    ) },
  ];

  return (
    <Layout>
      {ConfirmDialogElement}
      <div className="space-y-6">
        <PageHeader
          title="Conformité RGPD"
          subtitle="Gestion de la protection des données personnelles"
          icon={Shield}
          actions={
            <>
              {tab === 'registre' && (
                <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
                  Nouveau traitement
                </button>
              )}
              {tab === 'droits' && (
                <button onClick={handlePurge} className="btn-danger text-sm">
                  Purge auto (24 mois)
                </button>
              )}
            </>
          }
        />

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : (
          <>
            {tab === 'registre' && (
              <DataTable
                columns={registreColumns}
                data={registre}
                loading={false}
                emptyIcon={Shield}
                emptyMessage="Aucun traitement enregistré"
              />
            )}

            {tab === 'droits' && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border p-5">
                  <h3 className="font-semibold mb-3">Droit d'accès / Droit à l'effacement</h3>
                  <div className="flex gap-3 items-end">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Type</label>
                      <select value={searchEntity.type} onChange={e => setSearchEntity({ ...searchEntity, type: e.target.value })}
                        className="select-modern w-auto">
                        <option value="candidate">Candidat</option>
                        <option value="employee">Employé</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">ID</label>
                      <input type="number" value={searchEntity.id} onChange={e => setSearchEntity({ ...searchEntity, id: e.target.value })}
                        placeholder="ID" className="input-modern w-24" />
                    </div>
                    <button onClick={handleExport} className="btn-primary text-sm">Exporter les données</button>
                    <button onClick={handleAnonymize} className="btn-danger text-sm">Anonymiser</button>
                  </div>
                </div>
                {exportData && (
                  <div className="bg-white rounded-xl border p-5">
                    <h3 className="font-semibold mb-3">Données exportées ({exportData.type} #{exportData.id})</h3>
                    <pre className="bg-gray-50 rounded-lg p-4 text-xs overflow-auto max-h-96">{JSON.stringify(exportData.data, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}

            {tab === 'automatisations' && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 items-start">
                  <Clock className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-900">
                    <p className="font-medium">Purges de rétention — jobs planifiés et déclenchement manuel</p>
                    <p className="text-blue-800/80 mt-0.5">
                      Chaque purge ci-dessous tourne automatiquement (préfixe <code className="font-mono">AUTO_</code> dans
                      le journal d'audit) et peut aussi être lancée à la demande depuis cet écran — les deux voies
                      exécutent exactement le même code, seule la trace diffère (qui a agi, humain ou planifié).
                      Un déclenchement manuel est toujours journalisé, y compris quand il ne supprime rien : c'est la
                      preuve qu'une vérification a eu lieu.
                    </p>
                  </div>
                </div>

                {purgeResultat && (
                  <div className={`rounded-xl border p-4 text-sm flex items-start gap-3 ${
                    purgeResultat.type === 'success'
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}>
                    {purgeResultat.type === 'success'
                      ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                      : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
                    <span className="flex-1">{purgeResultat.message}</span>
                    <button onClick={() => setPurgeResultat(null)} aria-label="Fermer" className="shrink-0 opacity-60 hover:opacity-100">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {purgesError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{purgesError}</div>
                )}

                <DataTable
                  columns={purgesColumns}
                  data={purges}
                  loading={false}
                  emptyIcon={Trash2}
                  emptyMessage="Aucune purge enregistrée"
                />
              </div>
            )}

            {tab === 'audit' && (
              <DataTable
                columns={auditColumns}
                data={audit}
                loading={false}
                emptyIcon={ScrollText}
                emptyMessage="Aucune entrée"
                dense
              />
            )}

            {tab === 'politique' && (
              <div className="space-y-5">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 items-start">
                  <BookOpen className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-900">
                    <p className="font-medium">Rappel des règles de gestion réellement installées dans le code</p>
                    <p className="text-blue-800/80 mt-0.5">
                      Chaque règle ci-dessous reflète le comportement effectif du logiciel (durée de conservation, purge,
                      chiffrement, droits, journalisation, sous-traitance IA) — pas une intention. La référence indique le
                      fichier source qui l'implémente. Les valeurs marquées « paramétrable » sont lues en direct dans les
                      réglages de l'application.
                    </p>
                  </div>
                </div>

                {politiqueError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{politiqueError}</div>
                )}

                {politique && (
                  <>
                    <p className="text-xs text-gray-400">
                      Généré le {new Date(politique.generated_at).toLocaleString('fr-FR')}
                    </p>
                    {politique.categories.map((cat) => {
                      const Icon = POLITIQUE_ICONS[cat.key] || Shield;
                      return (
                        <div key={cat.key} className="bg-white rounded-xl border overflow-hidden">
                          <div className="flex items-center gap-2 px-5 py-3 border-b bg-gray-50">
                            <Icon className="w-4 h-4 text-primary" />
                            <h3 className="font-semibold text-gray-900">{cat.label}</h3>
                            {cat.description && <span className="text-xs text-gray-500 ml-1">— {cat.description}</span>}
                          </div>
                          <div className="divide-y">
                            {cat.regles.map((regle, i) => (
                              <div key={i} className="px-5 py-4 flex flex-col md:flex-row md:items-start gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-gray-900 text-sm">{regle.titre}</span>
                                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold whitespace-nowrap">
                                      {regle.valeur}
                                    </span>
                                    {regle.source !== 'code' && (
                                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs whitespace-nowrap" title="Paramétrable dans les réglages de l'application">
                                        paramétrable : {regle.source}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-600 mt-1">{regle.description}</p>
                                  <p className="text-xs text-gray-400 mt-1.5 font-mono truncate" title={regle.reference}>{regle.reference}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </>
        )}

        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouveau traitement" size="lg"
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="submit" form="rgpd-form" className="flex-1 btn-primary text-sm">Créer</button>
          </>}
        >
          <form id="rgpd-form" onSubmit={addTraitement} className="space-y-3">
            <input placeholder="Nom du traitement *" value={form.nom_traitement} onChange={e => setForm({ ...form, nom_traitement: e.target.value })} className="input-modern" required />
            <textarea placeholder="Finalité *" value={form.finalite} onChange={e => setForm({ ...form, finalite: e.target.value })} className="textarea-modern" rows={2} required />
            <select value={form.base_legale} onChange={e => setForm({ ...form, base_legale: e.target.value })} className="select-modern">
              {BASES.map(b => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
            </select>
            <input placeholder="Catégories de personnes" value={form.categories_personnes} onChange={e => setForm({ ...form, categories_personnes: e.target.value })} className="input-modern" />
            <input placeholder="Catégories de données" value={form.categories_donnees} onChange={e => setForm({ ...form, categories_donnees: e.target.value })} className="input-modern" />
            <input placeholder="Destinataires" value={form.destinataires} onChange={e => setForm({ ...form, destinataires: e.target.value })} className="input-modern" />
            <input placeholder="Durée de conservation" value={form.duree_conservation} onChange={e => setForm({ ...form, duree_conservation: e.target.value })} className="input-modern" />
            <textarea placeholder="Mesures de sécurité" value={form.mesures_securite} onChange={e => setForm({ ...form, mesures_securite: e.target.value })} className="textarea-modern" rows={2} />
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
