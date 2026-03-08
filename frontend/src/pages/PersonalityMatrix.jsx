import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const TYPE_COLORS = {
  analyseur: '#3B82F6',
  perseverant: '#8B5CF6',
  empathique: '#EC4899',
  imagineur: '#6366F1',
  energiseur: '#F59E0B',
  promoteur: '#EF4444',
};

export default function PersonalityMatrix() {
  const [profiles, setProfiles] = useState([]);
  const [types, setTypes] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [view, setView] = useState('list'); // list, types, profile

  useEffect(() => {
    api.get('/pcm/profiles').then(r => setProfiles(r.data)).catch(() => {});
    api.get('/pcm/types').then(r => setTypes(r.data)).catch(() => {});
  }, []);

  const loadProfile = async (candidateId) => {
    try {
      const res = await api.get(`/pcm/profiles/${candidateId}`);
      setSelectedProfile(res.data);
      setView('profile');
    } catch (err) { console.error(err); }
  };

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Matrice PCM</h1>
            <p className="text-gray-500">Process Communication Model — 6 types de personnalité</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'list' ? 'bg-solidata-green text-white' : 'bg-gray-100'}`}>Profils</button>
            <button onClick={() => setView('types')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'types' ? 'bg-solidata-green text-white' : 'bg-gray-100'}`}>Types PCM</button>
          </div>
        </div>

        {view === 'list' && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Candidat</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Base</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Phase</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Alerte RPS</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => (
                  <tr key={p.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-medium text-sm">{p.first_name} {p.last_name}</td>
                    <td className="p-3">
                      <span className="px-2 py-1 rounded text-xs font-medium text-white" style={{ backgroundColor: TYPE_COLORS[p.base_type] }}>
                        {p.base_type}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-1 rounded text-xs font-medium text-white" style={{ backgroundColor: TYPE_COLORS[p.phase_type] }}>
                        {p.phase_type}
                      </span>
                    </td>
                    <td className="p-3">
                      {p.risk_alert && <span className="text-red-500 text-xs font-bold">⚠ Alerte</span>}
                    </td>
                    <td className="p-3 text-xs text-gray-500">{new Date(p.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="p-3">
                      <button onClick={() => loadProfile(p.candidate_id)} className="text-solidata-green text-xs font-medium hover:underline">
                        Voir profil
                      </button>
                    </td>
                  </tr>
                ))}
                {profiles.length === 0 && (
                  <tr><td colSpan="6" className="p-8 text-center text-gray-400">Aucun profil PCM généré</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {view === 'types' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {types.map(t => (
              <div key={t.key} className="bg-white rounded-xl shadow-sm border p-5">
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

        {view === 'profile' && selectedProfile && (
          <div className="space-y-6">
            <button onClick={() => setView('list')} className="text-solidata-green text-sm hover:underline">← Retour à la liste</button>

            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-xl font-bold mb-4">
                {selectedProfile.candidate.first_name} {selectedProfile.candidate.last_name}
              </h2>

              {/* Immeuble PCM */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3">Immeuble PCM</h3>
                  <p className="text-xs text-gray-500 mb-2">Classement des types par score (uniquement les types avec un score ; cohérent avec la Base et la Phase).</p>
                  <div className="space-y-1">
                    {selectedProfile.report.immeuble?.map(etage => (
                      <div key={etage.type} className="flex items-center gap-2">
                        <span className="text-xs w-6 text-gray-400">{etage.etage}</span>
                        <div className="flex-1 rounded" style={{ backgroundColor: TYPE_COLORS[etage.type] + '20' }}>
                          <div
                            className="h-8 rounded flex items-center px-2 text-xs font-medium text-white"
                            style={{ width: `${etage.score}%`, backgroundColor: TYPE_COLORS[etage.type], minWidth: '60px' }}
                          >
                            {etage.nom} ({etage.score}%)
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold mb-2">Base : {selectedProfile.report.base?.nom}</h3>
                    <p className="text-sm text-gray-600">{selectedProfile.report.base?.perception}</p>
                    <p className="text-sm text-gray-600">Canal : {selectedProfile.report.base?.canal}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Phase : {selectedProfile.report.phase?.nom}</h3>
                    <p className="text-sm text-gray-600">Besoin : {selectedProfile.report.phase?.besoinPsychologique}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Comportements principaux selon le profil */}
            {selectedProfile.report.comportementsPrincipaux && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="font-semibold text-solidata-dark mb-4">Comportements principaux</h3>
                <div className="grid grid-cols-1 md:grid-cols-1 gap-4 space-y-3">
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Avec les autres</h4>
                    <p className="text-sm text-gray-700">{selectedProfile.report.comportementsPrincipaux.avecAutres}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Sous stress</h4>
                    <p className="text-sm text-gray-700">{selectedProfile.report.comportementsPrincipaux.sousStress}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Avec le manager</h4>
                    <div className="flex flex-wrap gap-4">
                      {selectedProfile.report.comportementsPrincipaux.avecManager?.do?.length > 0 && (
                        <div className="flex-1 min-w-[200px]">
                          <p className="text-xs text-green-600 font-medium mb-1">À privilégier</p>
                          <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                            {selectedProfile.report.comportementsPrincipaux.avecManager.do.map((tip, i) => (
                              <li key={i}>{tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selectedProfile.report.comportementsPrincipaux.avecManager?.dont?.length > 0 && (
                        <div className="flex-1 min-w-[200px]">
                          <p className="text-xs text-red-600 font-medium mb-1">À éviter</p>
                          <ul className="text-sm text-gray-700 list-disc list-inside space-y-0.5">
                            {selectedProfile.report.comportementsPrincipaux.avecManager.dont.map((tip, i) => (
                              <li key={i}>{tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Guide Manager */}
            {selectedProfile.report.base?.guideManager && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-5">
                  <h3 className="font-semibold text-green-700 mb-3">Guide Manager — DO</h3>
                  <ul className="space-y-1">
                    {selectedProfile.report.base.guideManager.do?.map((tip, i) => (
                      <li key={i} className="text-sm text-green-800 flex gap-2">
                        <span className="text-green-500">✓</span> {tip}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                  <h3 className="font-semibold text-red-700 mb-3">Guide Manager — DON'T</h3>
                  <ul className="space-y-1">
                    {selectedProfile.report.base.guideManager.dont?.map((tip, i) => (
                      <li key={i} className="text-sm text-red-800 flex gap-2">
                        <span className="text-red-500">✗</span> {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Stress */}
            {selectedProfile.report.phase?.stressNiveaux && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
                <h3 className="font-semibold text-orange-700 mb-3">Niveaux de stress</h3>
                <div className="space-y-2">
                  {selectedProfile.report.phase.stressNiveaux.map(s => (
                    <div key={s.niveau} className="flex gap-3 text-sm">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                        s.niveau === 1 ? 'bg-yellow-400' : s.niveau === 2 ? 'bg-orange-500' : 'bg-red-600'
                      }`}>{s.niveau}</span>
                      <p className="text-orange-900 flex-1">{s.comportement}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Alerte RPS */}
            {selectedProfile.riskAlert && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5">
                <h3 className="font-bold text-red-700 mb-2">⚠ Alerte Risques Psychosociaux</h3>
                <ul className="space-y-1">
                  {selectedProfile.report.rpsIndicators?.map((ind, i) => (
                    <li key={i} className="text-sm text-red-800">{ind}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
