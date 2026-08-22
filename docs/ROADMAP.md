# SOLIDATA — Pistes de développement et innovation

> Feuille de route produit. Déplacé depuis `CLAUDE.md` (section 10) le 22 août 2026 :
> il s'agit de matière de planification, pas d'instructions pour les agents IA.

### Court terme (déjà amorcé)
- [ ] Capteurs IoT LoRaWAN sur les CAV (table `cav_sensor_readings` prête)
- [ ] Maintenance prédictive véhicules (tables `vehicle_maintenance*` prêtes)
- [ ] Contrôle pesée double (table prête, UI à enrichir)
- [ ] OCR factures fournisseurs (tesseract.js déjà en dépendance)

### Moyen terme (architecture prête)
- [ ] Modèle ML de prédiction remplissage CAV (tables ML prêtes, feedback loop en place)
- [ ] Optimisation IA des tournées avec contraintes temps réel (météo, trafic, événements)
- [ ] Application mobile offline-first complète (PWA + IndexedDB)
- [ ] Dashboard temps réel avec Socket.IO (KPIs live, alertes push)
- [ ] Notifications push mobile (Service Worker)
- [ ] Intégration ERP comptable (export FEC, lien avec logiciel compta)

### Long terme (vision)
- [ ] API ouverte pour partenaires (exutoires, associations, collectivités)
- [ ] Marketplace textile inter-SIAE
- [ ] Traçabilité blockchain de la fibre textile
- [ ] Computer vision pour classification automatique au tri
- [ ] Chatbot IA d'accompagnement insertion (basé sur données PCM + parcours)
- [ ] Multi-site (plusieurs centres de tri, consolidation reporting)
- [ ] Module RSE / bilan carbone complet
- [ ] Connexion Refashion API (quand disponible, actuellement déclaratif)

### Points d'extension technique
| Point d'entrée | Fichier | Usage potentiel |
|----------------|---------|-----------------|
| Nouvelles routes API | `backend/src/routes/` + `backend/src/index.js` (app.use) | Tout nouveau module |
| Nouvelles tables | `backend/src/scripts/init-db.js` (section CREATE TABLE) | Nouvelles entités |
| Nouvelles pages | `frontend/src/pages/` + `frontend/src/App.jsx` (Route) | Nouveaux écrans |
| Navigation | `frontend/src/components/Layout.jsx` (menuSections) | Nouveau menu |
| Socket.IO | `backend/src/index.js` (io.on) | Événements temps réel |
| Jobs asynchrones | BullMQ (déjà configuré) | Tâches longues, emails, ML |
| Imports données | `backend/src/scripts/` | Seeds, migrations, imports Excel/KML |

