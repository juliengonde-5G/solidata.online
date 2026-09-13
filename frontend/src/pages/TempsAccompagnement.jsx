import { useState, useEffect, useCallback, useMemo } from 'react';
import { Clock, Users, FolderOpen, BarChart3, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import Section from '../components/Section';
import KPICard from '../components/KPICard';
import ErrorState from '../components/ErrorState';
import FeuilleTemps from '../components/insertion/FeuilleTemps';

/**
 * PR B lot 4 — « Temps d'accompagnement » (/insertion/temps).
 *
 * Deux usages dans un seul écran, et ils n'ont pas le même public.
 *  - **Feuille de temps** : la pièce mensuelle que l'intervenant signe et que
 *    la RH contre-signe (export (c) de l'autorité). Un MANAGER n'y voit que la
 *    sienne — le serveur refuse le reste avant même de lire la base.
 *  - **Synthèse** (ADMIN/RH) : l'indicateur n° 14 de l'autorité, « heures
 *    d'accompagnement, agrégat et moyenne par personne ». Il se compose des
 *    MÊMES lignes que les feuilles : le chiffre annoncé au dialogue de gestion
 *    et les feuilles signées ne peuvent pas se contredire.
 */

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** 195 minutes → « 3 h 15 ». */
function enHeures(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')}`;
}

export default function TempsAccompagnement() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = user?.base_role || user?.role;
  const estAdmin = base === 'ADMIN';
  const estRh = base === 'RH';
  const gestionnaire = estAdmin || estRh;

  const aujourdhui = useMemo(() => new Date(), []);
  const [annee, setAnnee] = useState(aujourdhui.getFullYear());
  const [mois, setMois] = useState(aujourdhui.getMonth() + 1);
  // Un MANAGER n'a pas de sélecteur : sa feuille est la sienne, point.
  const [userId, setUserId] = useState(gestionnaire ? null : (user?.id ?? null));
  const [onglet, setOnglet] = useState('feuille');

  const [intervenants, setIntervenants] = useState([]);
  const [projets, setProjets] = useState([]);
  const [feuille, setFeuille] = useState(null);
  const [synthese, setSynthese] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(true);

  // Intervenants (ADMIN/RH seulement — la route est fermée aux autres).
  useEffect(() => {
    if (!gestionnaire) return undefined;
    let vivant = true;
    api.get(`/insertion/temps/intervenants?annee=${annee}`)
      .then((r) => {
        if (!vivant) return;
        const liste = Array.isArray(r.data) ? r.data : [];
        setIntervenants(liste);
        setUserId((actuel) => {
          if (actuel != null && liste.some((i) => i.user_id === actuel)) return actuel;
          // À défaut, la feuille de la personne connectée si elle en a une.
          const moi = liste.find((i) => i.user_id === user?.id);
          return (moi || liste[0])?.user_id ?? null;
        });
      })
      .catch((err) => { if (vivant) setErreur(err.response?.data?.error || err.message); });
    return () => { vivant = false; };
  }, [gestionnaire, annee, user?.id]);

  useEffect(() => {
    let vivant = true;
    api.get('/insertion/projets?actif=1')
      .then((r) => { if (vivant) setProjets(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (vivant) setProjets([]); });
    return () => { vivant = false; };
  }, []);

  const chargerFeuille = useCallback(async () => {
    if (userId == null) { setChargement(false); return; }
    setChargement(true);
    try {
      const r = await api.get(`/insertion/temps/${userId}/${annee}/${mois}`);
      setFeuille(r.data);
      setErreur(null);
    } catch (err) {
      setFeuille(null);
      setErreur(err.response?.data?.error || err.message);
    }
    setChargement(false);
  }, [userId, annee, mois]);

  useEffect(() => { chargerFeuille(); }, [chargerFeuille]);

  const chargerSynthese = useCallback(async () => {
    if (!gestionnaire) return;
    try {
      const r = await api.get(`/insertion/temps/synthese?annee=${annee}`);
      setSynthese(r.data);
    } catch (err) {
      setSynthese(null);
      setErreur(err.response?.data?.error || err.message);
    }
  }, [gestionnaire, annee]);

  useEffect(() => { if (onglet === 'synthese') chargerSynthese(); }, [onglet, chargerSynthese]);

  const annees = useMemo(() => {
    const y = aujourdhui.getFullYear();
    return [y + 1, y, y - 1, y - 2];
  }, [aujourdhui]);

  const onglets = gestionnaire
    ? [['feuille', 'Feuille de temps'], ['synthese', "Synthèse des heures d'accompagnement"]]
    : [['feuille', 'Feuille de temps']];

  return (
    <div>
      <PageHeader
        title="Temps d'accompagnement"
        subtitle={gestionnaire
          ? "Feuilles de temps par intervenant et par projet — pièce de justification d'une dépense cofinancée"
          : 'Votre feuille de temps mensuelle'}
        icon={Clock}
        actions={estAdmin ? (
          <button type="button" onClick={() => navigate('/admin/insertion')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            <Settings className="w-4 h-4" aria-hidden="true" /> Réglages insertion
          </button>
        ) : null}
      />

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {gestionnaire && (
          <select value={userId ?? ''} onChange={(e) => setUserId(e.target.value === '' ? null : parseInt(e.target.value, 10))}
            className="input-modern py-1.5 text-sm" aria-label="Intervenant">
            {intervenants.length === 0 && <option value="">Aucun intervenant</option>}
            {intervenants.map((i) => (
              <option key={i.user_id} value={i.user_id}>
                {i.nom}{i.postes?.length ? ` — ${i.postes.map((p) => p.projet_code).join(', ')}` : ''}
              </option>
            ))}
          </select>
        )}
        <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))}
          className="input-modern py-1.5 text-sm" aria-label="Année">
          {annees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={mois} onChange={(e) => setMois(parseInt(e.target.value, 10))}
          className="input-modern py-1.5 text-sm" aria-label="Mois">
          {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>

      {/* Onglets */}
      {onglets.length > 1 && (
        <div className="flex gap-1 border-b border-slate-200 mb-4">
          {onglets.map(([cle, libelle]) => (
            <button key={cle} type="button" onClick={() => setOnglet(cle)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${onglet === cle
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {libelle}
            </button>
          ))}
        </div>
      )}

      {erreur && !feuille && onglet === 'feuille' && (
        <ErrorState variant="card" title="Feuille de temps indisponible" message={erreur}
          onRetry={chargerFeuille} className="mb-4" />
      )}

      {onglet === 'feuille' && (
        <>
          {gestionnaire && intervenants.length === 0 && !chargement && (
            <Section title="Aucun intervenant identifié" icon={Users}>
              <p className="text-sm text-slate-600">
                Un intervenant est une personne qui a réellement mené un entretien dans l'année, saisi un temps,
                ou qui occupe un poste affecté à une opération cofinancée. Affectez les postes dans les réglages
                du module, ou renseignez la durée des entretiens à leur clôture.
              </p>
            </Section>
          )}
          {feuille && (
            <FeuilleTemps
              feuille={feuille}
              projets={projets}
              estAdmin={estAdmin}
              estRh={estRh}
              moiId={user?.id}
              onChange={chargerFeuille}
            />
          )}
          {!feuille && chargement && (
            <Section title="Feuille de temps"><p className="text-sm text-slate-500">Chargement…</p></Section>
          )}
        </>
      )}

      {onglet === 'synthese' && gestionnaire && (
        <SyntheseHeures synthese={synthese} annee={annee} />
      )}
    </div>
  );
}

/** Onglet « Synthèse » — agrégats ADMIN/RH (indicateur n° 14 de l'autorité). */
function SyntheseHeures({ synthese, annee }) {
  if (!synthese) {
    return (
      <Section title="Synthèse des heures d'accompagnement" icon={BarChart3}>
        <p className="text-sm text-slate-500">Chargement…</p>
      </Section>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title="Heures d'accompagnement" value={enHeures(synthese.global_minutes)} icon={Clock}
          footer={<span className="text-xs text-slate-500">année {annee}</span>} />
        <KPICard title="Personnes accompagnées" accent="emerald" value={synthese.nb_salaries_concernes} icon={Users}
          footer={<span className="text-xs text-slate-500">au moins un temps imputé</span>} />
        <KPICard title="Moyenne par personne" accent="slate" icon={BarChart3}
          value={synthese.moyenne_minutes_par_salarie == null ? '—' : enHeures(synthese.moyenne_minutes_par_salarie)}
          footer={(
            <span className="text-xs text-slate-500">
              {synthese.moyenne_minutes_par_salarie == null ? 'aucune personne accompagnée' : 'sur l’année'}
            </span>
          )} />
      </div>

      <Section title="Par opération cofinancée" icon={FolderOpen} padded={false}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left font-medium px-4 py-2">Projet</th>
                <th className="text-right font-medium px-3 py-2">Temps</th>
                <th className="text-left font-medium px-3 py-2 pl-6">Taux forfaitaire</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(synthese.par_projet || []).map((p) => (
                <tr key={p.code}>
                  <td className="px-4 py-2">{p.nom || p.code} <span className="text-slate-400">({p.code})</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.minutes} min ({enHeures(p.minutes)})</td>
                  <td className="px-3 py-2 pl-6">
                    {p.taux_forfaitaire_pct == null
                      ? <span className="text-slate-400 italic">non renseigné</span>
                      : `${p.taux_forfaitaire_pct} %`}
                  </td>
                </tr>
              ))}
              {(synthese.par_projet || []).length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">Aucun temps imputé sur l'année.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Par intervenant" icon={Users} padded={false}>
          <div className="overflow-x-auto max-h-96">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {(synthese.par_intervenant || []).map((i) => (
                  <tr key={i.user_id}>
                    <td className="px-4 py-2">{i.nom || `Intervenant #${i.user_id}`}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{enHeures(i.minutes)}</td>
                  </tr>
                ))}
                {(synthese.par_intervenant || []).length === 0 && (
                  <tr><td className="px-4 py-6 text-center text-slate-500">Aucun intervenant.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Par personne accompagnée" icon={Users} padded={false}
          subtitle="Agrégat réservé à l'ADMIN et à la RH">
          <div className="overflow-x-auto max-h-96">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {(synthese.par_salarie || []).map((s) => (
                  <tr key={s.employee_id}>
                    <td className="px-4 py-2">{s.nom || `Salarié #${s.employee_id}`}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{enHeures(s.minutes)}</td>
                  </tr>
                ))}
                {(synthese.par_salarie || []).length === 0 && (
                  <tr><td className="px-4 py-6 text-center text-slate-500">Aucune personne accompagnée.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
