# Persona Manager Logistique — Audit opérationnel exutoires

**Date** : 2026-05-10
**Persona** : Manager équipe logistique (expéditions exutoires B2B)
**Périmètre** : 3 missions — info entrante, planification, réalisation

## Synthèse exécutive

| Mission | Couverture | Friction quotidienne |
|---|---|---|
| **1 — Info entrante** | Bonne | Sources multiples non centralisées |
| **2 — Planification** | Partielle | Vue éclatée sur 4 pages |
| **3 — Réalisation pipeline** | Partielle | 6+ pages pour conduire 1 commande |

**Note globale** : 6,2 / 10. L'application fonctionne mais demande 5-6 pages pour aller d'une commande à sa clôture.

## Mission 1 — Exhaustivité info entrante

**Sources commandes** :
1. Manuel : `ExutoiresCommandes.jsx` → `POST /commandes-exutoires`
2. Pennylane PULL : `/pennylane/sync/customer-invoices` (factures clients post-expédition, matching auto sur `external_reference`)
3. Référentiel clients : `ExutoiresClients.jsx` (40-60 clients actifs, SIRET unique)

**Complétude** : client, type_produit (array Original/CSR/Effilo/Jean/Coton B/C), date_commande, prix_tonne, tonnage_prévu, fréquence (unique/hebdo/bi-mensuel/mensuel), notes.

**Friction** :
- Pas de mécanisme anti-doublon sur les commandes → saisie 2× possible
- Grille tarifaire `grille_tarifaire` existe mais **pas connectée à l'API** → prix saisi manuellement à chaque commande
- Import Pennylane décalé de 15-30 j → info commande incomplete pendant le délai

## Mission 2 — Planification (espace, matériel, personnes)

**Pages** : `ExutoiresGantt.jsx` (3 couloirs : quai/garage/cours × 4 semaines), `ExutoiresCalendrier.jsx` (vue mensuelle + % occupation par lieu + alerte surcharge), `ExutoiresPreparation.jsx`.

**Espace** : ✅ Gantt opérationnel par lieu × période.

**Matériel** : ⚠️ pas de modélisation conteneur intermédiaire (balle, caisse, palette). La pesée est au niveau remorque entière. Bon pour bulk shipment mais pas de traçabilité intra-remorque.

**Personnes** : 
- Champ `collaborateurs[]` (array employee_id) sur `POST /preparations`
- ❌ Pas de vue planning équipe parallèle
- ❌ Pas de détection conflit (même agent assigné 2× le même jour)
- ❌ Pas de lien avec tournées de collecte (chauffeur qui rentre tard ne réajuste pas l'heure de chargement)

**Friction principale** : pour répondre à « quelle commande est planifiée sur quel quai à quelle heure avec quel agent ? » il faut combiner 3 pages (Commandes + Préparation + Gantt).

## Mission 3 — Réalisation pipeline

**State machine commandes** (9 statuts) : `en_attente → confirmee → en_preparation → chargee → expediee → pesee_recue → facturee → cloturee` (+ `annulee` à tout moment).

**State machine préparations** (5 statuts) : `planifiee → remorque_livree → en_chargement → prete → expediee` avec timestamps `heure_reception_remorque`, `heure_debut_chargement`, `heure_fin_chargement`, `heure_depart`.

**Pipeline complet 7 étapes** :

| Étape | Page | Action | Endpoint |
|---|---|---|---|
| 1 Créer cmd | Commandes | Formulaire | `POST /commandes-exutoires` |
| 2 Confirmer | Commandes | Bouton + modal | `PATCH /commandes-exutoires/:id/statut` |
| 3 Préparer | Préparation | Créer prep + assigner agents | `POST /preparations` |
| 4 Chargement | Préparation | Timestamps | `PATCH /preparations/:id/statut` |
| 5 Pesée client | Préparation (modal) | Pesée + upload PDF | `POST /controles-pesee` |
| 6 Rapprochement Pennylane | ControleFacturation | Link facture ↔ commande | `POST /factures-exutoires/:id/link-commande` |
| 7 Clôture | Auto au lien valide | — | — |

**Friction principale** : pas de **dashboard unifié** des 5 commandes de la semaine avec lieu/date/équipe/statut.

## Top 5 améliorations

| # | Amélioration | Effort | ROI |
|---|---|---|---|
| **P1** | Dashboard logistique `/logistique/dashboard-semaine` : 1 ligne = 1 commande, colonnes statut/lieu/équipe/heures, actions inline + Socket.IO temps réel | 16 h | Très haut — élimine 50 % des bascules de page |
| **P2** | Sync auto grille tarifaire à la création commande (lookup `client_id + type_produit + date`) avec fallback prix référence et override manuel | 6 h | Haut — moins d'erreurs de prix |
| **P3** | Page `/logistique/planning-equipe` : lignes = collaborateurs, colonnes = jours, détection surcharge (fond rouge >8 h/j), drag-drop réassignation | 8 h | Haut — anti-conflit, vision agent |
| **P4** | Alertes non-conformité pesée client : badge rouge + mail si écart > tolérance, audit log validation | 4 h | Moyen — détection précoce litige |
| **P5** | Module mobile chargement-photo (QR commande → photo upload → stockage `chargement_photo_url`) | 12 h | Moyen — preuve matérielle litiges |

**Total** : ~46 h de dev pour passer de 6,2 / 10 à ~9 / 10 sur le confort opérationnel.
