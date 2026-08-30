import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { DataTable, PageHeader } from '../components';
import { Brain, Send, Copy, Check } from 'lucide-react';
import api from '../services/api';
import { PCM_MENTION_METHODE } from '../utils/pcm';
import { TYPE_COLORS } from '../utils/pcm-pdf';

/**
 * Console de passation PCM.
 *
 * Cet écran RESTITUAIT les profils : une liste de tous les rapports produits
 * (base, phase, indicateur de cohérence) et une fiche détaillée par personne,
 * ouverte à ADMIN, RH et au praticien PCM. Il ne le fait plus, pour PERSONNE —
 * le test « reste ancré dans la fiche du candidat et n'est plus accessible sur
 * un autre écran » (demande client 2.43.0).
 *
 * Ce qui reste ici est la passation : désigner la personne, lancer le test,
 * transmettre le lien, suivre l'avancement. Et le référentiel des 6 types, qui
 * ne contient aucune donnée personnelle.
 *
 * Ce qui a disparu : l'appel `GET /pcm/profiles` (route resserrée ADMIN/RH côté
 * serveur), la vue « Profils », la fiche détaillée et les deux exports PDF —
 * ces derniers ont suivi les résultats dans `utils/pcm-pdf.js`, appelé depuis
 * l'onglet PCM du dossier candidat.
 */
export default function PersonalityMatrix() {
  const [types, setTypes] = useState([]);
  const [view, setView] = useState('passer'); // passer, types
  // Liste MINIMALE de candidats (identité, poste visé, état du test). Le
  // praticien PCM n'a pas accès à la page Candidats — ni CV, ni entretiens :
  // cette projection lui suffit pour désigner qui teste. Elle ne porte aucun
  // résultat : `a_un_profil` dit que le test a abouti, pas ce qu'il a donné.
  const [candidats, setCandidats] = useState([]);
  const [erreur, setErreur] = useState(null);
  const [lancement, setLancement] = useState(null); // id du candidat en cours
  const [copie, setCopie] = useState(null);         // id dont le lien vient d'être copié

  useEffect(() => {
    api.get('/pcm/types').then(r => setTypes(r.data)).catch(() => {});
  }, []);

  const chargerCandidats = useCallback(async () => {
    try {
      setErreur(null);
      const r = await api.get('/pcm/candidats');
      setCandidats(r.data);
    } catch (err) {
      setErreur(err.response?.data?.error || 'Impossible de charger la liste des candidats.');
    }
  }, []);

  useEffect(() => { if (view === 'passer') chargerCandidats(); }, [view, chargerCandidats]);

  const lienTest = (token) => `${window.location.origin}/pcm-test/${token}`;

  const lancerTest = async (candidat) => {
    setLancement(candidat.id);
    setErreur(null);
    try {
      await api.post('/pcm/sessions', { candidate_id: candidat.id, mode: 'autonomous' });
      await chargerCandidats();
    } catch (err) {
      setErreur(err.response?.data?.error || 'Le test n\'a pas pu être créé.');
    } finally {
      setLancement(null);
    }
  };

  const copierLien = async (candidat) => {
    try {
      await navigator.clipboard.writeText(lienTest(candidat.access_token));
      setCopie(candidat.id);
      setTimeout(() => setCopie(null), 2500);
    } catch {
      setErreur('Copie impossible — sélectionnez le lien à la main.');
    }
  };

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Tests PCM"
          subtitle="Faire passer le questionnaire et suivre son avancement"
          icon={Brain}
          actions={
            <div className="flex gap-2">
              <button onClick={() => setView('passer')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'passer' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Faire passer un test</button>
              <button onClick={() => setView('types')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'types' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Types PCM</button>
            </div>
          }
        />

        {erreur && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {erreur}
          </div>
        )}

        {view === 'passer' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Choisissez un candidat, lancez le test, puis transmettez-lui le lien.
              Il répond depuis n'importe quel navigateur, sans compte ni installation.
            </p>
            {/* Formulation NEUTRE, volontairement : cet écran est ouvert au
                praticien PCM, qui n'a accès ni à la page Candidats ni à la
                fiche collaborateur. Lui nommer un écran qu'il ne peut pas
                ouvrir serait une promesse en l'air. Ce tableau lui dit où en
                est la passation ; le résultat, lui, se lit ailleurs. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Cette page sert à faire passer le test et à suivre son avancement.
              Les résultats se consultent dans la fiche de la personne, par les
              profils habilités.
            </div>
            <DataTable
              columns={[
                { key: 'nom', label: 'Candidat', sortable: true,
                  render: (c) => <span className="font-medium">{c.last_name?.toUpperCase()} {c.first_name}</span> },
                { key: 'poste_vise', label: 'Poste visé',
                  render: (c) => <span className="text-sm text-gray-600">{c.poste_vise || '—'}</span> },
                { key: 'etat', label: 'Test PCM', render: (c) => {
                  if (c.a_un_profil) return <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-medium">Profil disponible</span>;
                  if (c.session_status === 'in_progress') return <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">En cours</span>;
                  if (c.session_status === 'pending') return <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">Lien envoyé, en attente</span>;
                  return <span className="text-xs text-gray-500">Aucun test</span>;
                } },
                { key: 'actions', label: '', render: (c) => (
                  <div className="flex gap-2 justify-end">
                    {c.access_token && !c.a_un_profil && (
                      <button
                        onClick={() => copierLien(c)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
                        title="Copier le lien à transmettre au candidat"
                      >
                        {copie === c.id ? <Check size={14} /> : <Copy size={14} />}
                        {copie === c.id ? 'Copié' : 'Copier le lien'}
                      </button>
                    )}
                    {/* Un test déjà abouti n'ouvre plus rien ici : la colonne
                        « Test PCM » dit qu'un profil existe, elle ne le montre
                        pas. Relancer resterait possible côté ADMIN/RH depuis le
                        dossier de la personne. */}
                    {!c.a_un_profil && (
                      <button
                        onClick={() => lancerTest(c)}
                        disabled={lancement === c.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm disabled:opacity-50"
                      >
                        <Send size={14} />
                        {lancement === c.id ? 'Création…' : c.session_status ? 'Relancer' : 'Lancer le test'}
                      </button>
                    )}
                  </div>
                ) },
              ]}
              data={candidats}
              emptyMessage="Aucun candidat à tester."
            />
            {/* La mise en garde de méthode accompagne la passation : le
                praticien la lit avant de lancer le test, pas seulement le
                candidat au moment d'y répondre. */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-700 mb-1">Méthode — à lire avant de faire passer le test</p>
              <p className="text-xs text-slate-600 leading-relaxed">{PCM_MENTION_METHODE}</p>
            </div>
          </div>
        )}

        {view === 'types' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {types.map(t => (
              <div key={t.key} className="card-modern p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ backgroundColor: TYPE_COLORS[t.key] }}>
                    {t.nom[0]}
                  </div>
                  <div>
                    <h3 className="font-bold">{t.nom}</h3>
                    <p className="text-xs text-gray-400">{t.ancienNom !== t.nom ? `ex-${t.ancienNom}` : ''}</p>
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  <p><span className="text-gray-500">Perception :</span> {t.perception}</p>
                  <p><span className="text-gray-500">Canal :</span> {t.canal}</p>
                  <p><span className="text-gray-500">Points forts :</span> {t.pointsForts?.join(', ')}</p>
                  <p><span className="text-gray-500">Besoin :</span> {t.besoinPsychologique}</p>
                  <p><span className="text-gray-500">Driver :</span> {t.driverPrincipal}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
