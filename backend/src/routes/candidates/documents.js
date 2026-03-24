const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authorize } = require('../../middleware/auth');

// ══════════════════════════════════════════
// DOCUMENTS RECRUTEMENT (livret, charte, procédure, fiches)
// ══════════════════════════════════════════

const RECRUITMENT_DOCS = {
  livret_accueil: { filename: "Livret d'accueil collaborateur.pdf", label: "Livret d'accueil" },
  charte_insertion: { filename: "Charte d'insertion.pdf", label: "Charte d'insertion" },
  procedure_recrutement: { filename: 'Procédure recrutement.pdf', label: 'Procédure de recrutement' },
  fiche_mise_en_situation_collecte: { filename: 'Fiche de mise en situation - Collecte  Manutention.pdf', label: 'Fiche mise en situation - Collecte/Manutention' },
  fiche_mise_en_situation_craquage: { filename: 'Fiche de mise en situation - Craquage.pdf', label: 'Fiche mise en situation - Craquage' },
  fiche_mise_en_situation_qualite: { filename: 'Fiche de mise en situation - Qualité.pdf', label: 'Fiche mise en situation - Qualité' },
};

// GET /api/candidates/documents/list — Liste des documents disponibles
router.get('/list', authorize('ADMIN', 'RH', 'MANAGER'), (req, res) => {
  const docs = Object.entries(RECRUITMENT_DOCS).map(([key, doc]) => ({
    key,
    label: doc.label,
    url: `/uploads/documents/${doc.filename}`,
  }));
  res.json(docs);
});

// GET /api/candidates/documents/download/:docKey — Télécharger un document
router.get('/download/:docKey', authorize('ADMIN', 'RH', 'MANAGER'), (req, res) => {
  const doc = RECRUITMENT_DOCS[req.params.docKey];
  if (!doc) return res.status(404).json({ error: 'Document non trouvé' });
  const filePath = path.join(__dirname, '..', '..', '..', 'uploads', 'documents', doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  res.download(filePath, doc.filename);
});

// GET /api/candidates/documents/livret-content — Contenu du livret en texte structuré
router.get('/livret-content', authorize('ADMIN', 'RH', 'MANAGER'), (req, res) => {
  res.json({
    title: "Livret d'accueil collaborateur",
    sections: [
      { title: "Bienvenue !", content: "Merci de rejoindre Solidarité Textiles et Frip and Co, nos entreprises d'insertion. Ensemble nous allons construire le monde de demain et bouleverser les habitudes d'aujourd'hui. En rejoignant notre aventure, vous devenez un acteur privilégié de l'économie sociale et solidaire. Vous participez à réduire le gaspillage textile (activité Réemploi), préserver l'extraction de ressources naturelles et innover pour la production de nouveaux matériaux (activité Recyclage). Vous êtes la force de Solidarité Textiles et de Frip and Co." },
      { title: "Qui sommes-nous ?", content: "Solidarité Textiles est une association Loi 1901 agréée « Chantier d'insertion », ayant pour mission de favoriser le retour à l'emploi par le recyclage et la valorisation du textile. Créée en 1995, elle a pour support d'activité la collecte, le tri, le conditionnement et la valorisation des textiles usagés. L'association compte 42 salariés en parcours d'insertion et 7 salariés permanents. Frip & Co, entreprise filiale, se charge de la vente des textiles valorisables." },
      { title: "La filière TLC", content: "La collecte et le négoce des TLC usagés sont des activités économiques de longue date. Solidarité Textiles fait partie de la filière TLC en qualité de collecteur et opérateur de tri, répondant aux objectifs de Refashion (éco-organisme). Chaque trimestre, nous rendons compte des volumes collectés, triés, recyclés et revendus." },
      { title: "Vos premiers pas", content: "Vous devenez Opérateur de Tri TLC. Vos cinq sens seront mis à rude épreuve. Il faut environ 3 mois pour trouver le bon rythme et 6 mois pour que tous vos sens soient en éveil. Les 5R : un moyen mnémotechnique pour lutter contre le gaspillage et réduire notre empreinte environnementale." },
      { title: "Notre rôle", content: "4 camions sillonnent l'agglomération de Rouen. Nos chauffeurs font leurs tournées en binômes dès 7h30, récoltant plus de 5 tonnes de TLC par jour dans 240 collecteurs d'apport volontaire. Au total, 1600 tonnes de déchets textiles par an." },
      { title: "Frip & Co", content: "Les vêtements collectés en bon état sont triés et conditionnés pour les boutiques Frip and Co (Centre-Ville, rue de l'Hôpital — 100 clients/jour) et Frip and Co Family (quartier Saint-Sever, rue Lafayette). En 2026 : ouverture du Vinted Pro et développement de l'upcycling." },
      { title: "Votre contrat (CDDI)", content: "Contrat à Durée Déterminée d'Insertion — 1 mois de période d'essai, 5 mois renouvelable (24 mois max). 26 heures/semaine. 1 jour non travaillé par semaine. 1h de pause déjeuner. 15 jours de congés pour 5 mois." },
      { title: "Vos interlocuteurs", content: "Conseillère d'Insertion Professionnelle pour votre projet professionnel. Encadrement technique : responsable des opérations, responsable logistique, responsable des boutiques et leurs adjoints." },
      { title: "Cadre de vie professionnelle", content: "Convention collective « Atelier Chantier d'Insertion ». Mutuelle obligatoire. Prise en charge 50% transports en commun. Avantage : 1 carton de 5 kg de textiles/mois (sous condition d'assiduité)." },
      { title: "Contact", content: "Solidarité Textiles : 02.32.10.34.81 — contact@solidarite-textiles.fr. CIP Aline ROIX : 06.61.01.10.41 — asp@solidarite-textiles.fr. Bureau technique : 02.32.10.38.79" },
    ],
  });
});

// Export RECRUITMENT_DOCS for use in other modules (individual.js needs it for document delivery)
module.exports = router;
module.exports.RECRUITMENT_DOCS = RECRUITMENT_DOCS;
