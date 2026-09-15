import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import FormulaireETI from '../components/insertion/FormulaireETI';

/**
 * Écran de l'encadrant technique — LIEN PUBLIC `/eti/renouvellement/:token`
 * (PR C lot 5, contrat 20 § 5.4).
 *
 * ═══ POURQUOI CET ÉCRAN N'EST PAS DANS L'APPLICATION ══════════════════════
 * Son destinataire n'a pas de compte, et il n'en aura pas : c'est un encadrant
 * d'atelier à qui la CIP envoie un lien par message. L'écran précédent vivait
 * derrière l'authentification — le lien « copié » menait donc à une page de
 * connexion, et le geste le plus fréquent du module était impraticable.
 *
 * ═══ POURQUOI `axios` NU ET NON `services/api` ════════════════════════════
 * L'instance partagée pose l'en-tête `Authorization` et, sur un 401, tente un
 * renouvellement de jeton puis redirige vers la page de connexion. Ici il n'y
 * a aucune session : un intercepteur qui « répare » une authentification
 * absente ferait sortir l'encadrant de son formulaire. Même patron que
 * `EnqueteReponse.jsx` (réponse publique aux enquêtes).
 *
 * ═══ TROIS ÉTATS, TROIS MESSAGES ══════════════════════════════════════════
 * 404 « ce lien n'est pas valide » · 410 « lien expiré » ou « entretien
 * clôturé » (deux situations différentes pour lui) · succès. Aucune donnée
 * au-delà du § 5.3 : prénom, nom, poste, fin de contrat.
 */

const Cadre = ({ ton, children }) => (
  <div className={`rounded-2xl border-2 p-5 text-base ${ton}`}>{children}</div>
);

export default function EtiRenouvellement() {
  const { token } = useParams();
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [etatLien, setEtatLien] = useState(null); // null | 'inconnu' | 'expire' | 'cloture'
  const [erreur, setErreur] = useState(null);
  const [saving, setSaving] = useState(false);
  const [transmis, setTransmis] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true); setErreur(null); setEtatLien(null);
    try {
      const r = await axios.get(`/api/eti/renouvellement/${token}`);
      setDonnees(r.data);
    } catch (err) {
      const st = err.response?.status;
      const code = err.response?.data?.code;
      if (st === 404) setEtatLien('inconnu');
      else if (st === 410) setEtatLien(code === 'ENTRETIEN_CLOTURE' ? 'cloture' : 'expire');
      else setErreur(err.response?.data?.error || err.message);
    }
    setChargement(false);
  }, [token]);

  useEffect(() => { charger(); }, [charger]);

  const transmettre = async (charge) => {
    setSaving(true); setErreur(null);
    try {
      await axios.put(`/api/eti/renouvellement/${token}`, charge);
      setTransmis(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const st = err.response?.status;
      const d = err.response?.data;
      if (st === 410) setEtatLien(d?.code === 'ENTRETIEN_CLOTURE' ? 'cloture' : 'expire');
      else if (st === 404) setEtatLien('inconnu');
      else if (d?.champs_refuses) setErreur(`${d.error} (champs refusés : ${d.champs_refuses.join(', ')})`);
      else setErreur(d?.error || err.message);
    }
    setSaving(false);
  };

  const frDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        {chargement && <p className="text-center text-gray-500 py-10 text-lg">Chargement du formulaire…</p>}

        {!chargement && etatLien === 'inconnu' && (
          <Cadre ton="bg-red-50 border-red-200 text-red-800">
            <p className="text-xl font-bold mb-1">Ce lien n'est pas valide.</p>
            <p>Il a peut-être été mal recopié. Demandez un nouveau lien à la conseillère en insertion.</p>
          </Cadre>
        )}

        {!chargement && etatLien === 'expire' && (
          <Cadre ton="bg-amber-50 border-amber-300 text-amber-900">
            <p className="text-xl font-bold mb-1">Ce lien a expiré.</p>
            <p>Demandez un nouveau lien à la conseillère en insertion : elle le produit en un clic.</p>
          </Cadre>
        )}

        {!chargement && etatLien === 'cloture' && (
          <Cadre ton="bg-slate-100 border-slate-300 text-slate-700">
            <p className="text-xl font-bold mb-1">Cet entretien est clôturé.</p>
            <p>Votre avis a été enregistré, ou l'entretien s'est tenu entre-temps. Il n'y a rien à faire.</p>
          </Cadre>
        )}

        {!chargement && !etatLien && donnees && (
          <>
            <header className="text-center space-y-1">
              <p className="text-sm font-semibold text-teal-700 uppercase tracking-wide">
                Solidarité Textiles — avis de l'encadrant
              </p>
              <h1 className="text-2xl font-bold text-gray-800">Renouvellement de contrat</h1>
              <p className="text-lg text-gray-700">
                <span className="font-semibold">{`${String(donnees.nom || '').toUpperCase()} ${donnees.prenom || ''}`.trim()}</span>
                {donnees.poste && <span className="text-gray-500"> — {donnees.poste}</span>}
              </p>
              {donnees.contract_end && (
                <p className="text-base text-gray-600">Fin de contrat le <strong>{frDate(donnees.contract_end)}</strong></p>
              )}
            </header>

            {transmis && (
              <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-5 text-center space-y-1">
                <p className="text-3xl" aria-hidden="true">✅</p>
                <p className="text-lg font-bold text-green-800">Merci ! Votre avis a été transmis.</p>
                <p className="text-sm text-green-700">
                  Vous pouvez fermer cette page. La conseillère complète son volet et organise la suite.
                </p>
              </div>
            )}

            {erreur && (
              <div className="bg-red-50 border-2 border-red-300 text-red-700 rounded-2xl p-4 text-base">{erreur}</div>
            )}

            {!transmis && (
              <p className="text-sm text-gray-500 text-center">
                Répondez avec vos mots. Tout est facultatif sauf votre avis et la durée proposée.
              </p>
            )}

            <FormulaireETI
              initial={donnees}
              readOnly={transmis || donnees.lecture_seule === true}
              saving={saving}
              onTransmit={transmettre}
              onErreurLocale={setErreur}
            />

            <p className="text-center text-xs text-gray-400">
              {donnees.expire_le && `Ce lien est valable jusqu'au ${frDate(donnees.expire_le)}.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
