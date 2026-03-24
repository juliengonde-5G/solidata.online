# Plan de Test Exhaustif — SOLIDATA ERP v2.0

> **Rédigé le** : 2026-03-15
> **Méthodologie** : ISTQB Foundation + OWASP ASVS + WCAG 2.2 AA/AAA
> **Stack réelle** : React 18 / Express.js / PostgreSQL 15 + PostGIS / Redis / Docker / Nginx / PWA
> **Environnement** : Scaleway DEV1-S (2 vCPU, 2 Go RAM, 20 Go SSD) — Production solidata.online

---

## Table des matières

1. [Domaine 0 — UX Mobile (Critique)](#domaine-0--ux-mobile-critique)
2. [Domaine 1 — Use Cases Fonctionnels](#domaine-1--use-cases-fonctionnels)
3. [Domaine 2 — Sécurité](#domaine-2--sécurité)
4. [Domaine 3 — Logique Métier](#domaine-3--logique-métier)
5. [Domaine 4 — Réseau & Infrastructure](#domaine-4--réseau--infrastructure)
6. [Domaine 5 — Juridique & Conformité](#domaine-5--juridique--conformité)
7. [Domaine 6 — Data & Base de Données](#domaine-6--data--base-de-données)
8. [Domaine 7 — Ressources Humaines](#domaine-7--ressources-humaines)
9. [Domaine 8 — Opérations & DevOps](#domaine-8--opérations--devops)
10. [Domaine 9 — Logistique & Exutoires](#domaine-9--logistique--exutoires)
11. [Domaine 10 — Finances & Facturation](#domaine-10--finances--facturation)
12. [Domaine 11 — Communication & Notifications](#domaine-11--communication--notifications)
13. [Tableau Récapitulatif](#tableau-récapitulatif)
14. [Checklist Exportable](#checklist-exportable)
15. [Roadmap d'Exécution](#roadmap-dexécution)
16. [Recommandations Stack](#recommandations-stack)

---

## Métriques Cibles Globales

| Métrique | Objectif | Critique |
|----------|----------|----------|
| Disponibilité (uptime) | 99,9 % | < 99 % |
| Temps de réponse API | < 200 ms (P95) | > 2 s |
| Temps de chargement page | < 2 s (3G) | > 5 s |
| Taux d'erreur HTTP 5xx | < 0,1 % | > 1 % |
| Score Lighthouse Mobile | > 90 | < 70 |
| Couverture tests unitaires | > 80 % | < 50 % |
| Conformité OWASP Top 10 | 10/10 | < 8/10 |
| Conformité WCAG 2.2 AA | 100 % | < 80 % |

---

## Domaine 0 — UX Mobile (Critique)

### Contexte
PWA mobile (m.solidata.online) pour chauffeurs-collecteurs terrain. React 18 + Vite + html5-qrcode + Leaflet. 11 écrans : Login → VehicleSelect → Checklist → TourMap → QRScanner → FillLevel → Incident → ReturnCentre → WeighIn → TourSummary.

### Profil 1 — Opérateur Terrain (Smartphone Android standard)

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| M01 | Collecte complète < 45 s | 1. Scanner QR 2. Sélectionner remplissage 3. Valider | QR container réel | Workflow complet en < 45 s chrono | CRITIQUE | Manuel + chrono |
| M02 | Scan QR < 3 s | 1. Ouvrir QRScanner 2. Pointer caméra sur QR | QR 250×250 à 30 cm | Decode + navigation FillLevel en < 3 s | CRITIQUE | Manuel + chrono |
| M03 | Scan QR lumière variable | Tester : plein soleil, ombre, nuit (flash), pluie | QR sur container extérieur | Taux erreur < 2 % sur 50 scans | CRITIQUE | Manuel terrain |
| M04 | Fallback QR indisponible | 1. QR illisible → "QR indisponible" 2. Saisir code / sélectionner CAV | Code manuel ou dropdown | CAV identifié + raison enregistrée | Élevé | Manuel |
| M05 | Sync offline 5 min | 1. Activer mode avion 5 min 2. Effectuer actions 3. Réactiver réseau | Actions hors-ligne | Données synchronisées sans perte | CRITIQUE | Manuel |
| M06 | GPS tracking temps réel | 1. Lancer tournée 2. Se déplacer 3. Vérifier TourMap | Position GPS réelle | Marqueur mis à jour toutes les 10 s via Socket.IO | Élevé | Manuel + DevTools |
| M07 | Navigation pouce zone unique | Tester tous les boutons avec le pouce seul | Main droite, main gauche | Tous les CTA atteignables, touch targets ≥ 48 px | Élevé | Manuel |
| M08 | Scroll fluide 60 fps | 1. Charger liste > 100 CAVs 2. Scroller rapidement | Liste longue | Pas de jank, 60 fps constant (DevTools Performance) | Moyen | Chrome DevTools |
| M09 | Checklist pré-départ | Cocher les 10 items sécurité → Valider | 10 items checklist | Tous cochés = passage autorisé, incomplet = blocage | Élevé | Manuel |
| M10 | Résumé tournée CO₂ | Terminer tournée complète → TourSummary | Tournée avec pesée | Affichage : poids, distance, durée, CO₂ (×1,493 kg/kg) | Moyen | Manuel |

### Profil 2 — PCM Faible Lecture (TalkBack + Tuteur)

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| M11 | TalkBack lit TOUS les boutons | 1. Activer TalkBack Android 2. Parcourir chaque écran | Navigation séquentielle | Chaque bouton/icône annoncé vocalement (aria-label) | CRITIQUE | Manuel TalkBack |
| M12 | 3 taps max par action | Workflow : [Scan] → [Qualité] → [Validé] | Actions collecte | Chaque action principale en ≤ 3 taps | CRITIQUE | Manuel + comptage |
| M13 | Boutons 60 px minimum | Mesurer tous les boutons interactifs (profil PCM) | Inspecteur mobile | min-width/min-height ≥ 60 px (actuellement 48 px → à corriger) | CRITIQUE | Chrome DevTools |
| M14 | Contraste 4.5:1 minimum | Vérifier tous les textes/fonds avec analyseur | Toutes les pages | Ratio ≥ 4.5:1 (WCAG AA) — texte sur teal = 5.8:1 ✓ | Élevé | axe DevTools |
| M15 | Pictogrammes 100 % | Vérifier que chaque action a un pictogramme explicite | Parcours complet | Aucun bouton texte-seul sans icône associée | Élevé | Manuel |
| M16 | Vibration feedback | 1. Action réussie 2. Action erreur | Validation / erreur | Vibration 500 ms succès, 1000 ms erreur (navigator.vibrate) | Moyen | Manuel Android |
| M17 | Audio loop 3× instructions | Activer aide vocale sur chaque étape | Tap long = aide | Instruction vocale répétée 3 fois | Moyen | Manuel |
| M18 | Badges daltoniens-friendly | Vérifier 🟢🟡🔴 avec filtre deutéranopie | Simulation daltonisme | Différenciation par forme + texte (pas couleur seule) | Élevé | Sim-Daltonism |
| M19 | Dynamic Type Android | Changer taille police système → Relancer app | Police ×1.5, ×2.0 | Textes redimensionnés, mise en page non cassée | Moyen | Paramètres Android |
| M20 | Voice input poids | Dire "200 kg" → champ poids WeighIn | Commande vocale FR | Champ rempli avec 200 (Web Speech API) | Moyen | Manuel micro |

### Risques ESS / Textile spécifiques
- **Conditions terrain** : containers extérieurs, pluie, gants → écran tactile non réactif
- **Profil insertion CDDI** : alphabétisation limitée, stress numérique → interface simplifiée obligatoire
- **Multi-sites Rouen** : zones de couverture réseau variable (parking souterrain, zone industrielle)

### Outils
- Chrome DevTools (Performance, Lighthouse, Accessibility)
- Android TalkBack, iOS VoiceOver
- axe DevTools (audit WCAG automatique)
- Sim-Daltonism (simulation deutéranopie/protanopie)
- html5-qrcode debug mode

---

## Domaine 1 — Use Cases Fonctionnels

### Contexte
40+ pages frontend (React), 35+ routes backend (Express), 5 rôles RBAC : ADMIN, MANAGER, RH, COLLABORATEUR, AUTORITE.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| F01 | Workflow collecte complet | 1. Sélectionner véhicule/tournée 2. Checklist 3. Scanner CAVs 4. Remplissage 5. Retour centre 6. Pesée 7. Résumé | Tournée planifiée 8 CAVs | Tournée clôturée, poids enregistré, historique mis à jour | CRITIQUE | Manuel E2E |
| F02 | Gestion candidats Kanban | 1. Créer candidat 2. Upload CV 3. Parser compétences 4. Déplacer statut : Reçu → Entretien → Recruté | CV PDF, infos candidat | Kanban mis à jour, compétences extraites, historique traçé | CRITIQUE | Manuel |
| F03 | Test PCM personnalité | 1. Lancer test PCM 2. Répondre 30 questions 3. Consulter profil | Réponses PCM | Profil 6 types (Empathique/Travaillomane/Persévérant/Rêveur/Promoteur/Rebelle) + alertes risque | Élevé | Manuel |
| F04 | Plan de recrutement mensuel | 1. Onglet "Plan de recrutement" 2. Définir postes/mois 3. Suivre taux remplissage | Postes + slots mensuels | Tableau croisé postes×mois avec compteur recrutés vs objectif | Élevé | Manuel |
| F05 | Parcours insertion CDDI | 1. Créer parcours salarié 2. Définir objectifs 3. Évaluations périodiques 4. Clôturer | Salarié CDDI + objectifs | Parcours tracé, évaluations datées, progression visible | CRITIQUE | Manuel |
| F06 | Production chaîne de tri | 1. Démarrer session tri 2. Enregistrer catégories/poids 3. Clôturer | Pesées par catégorie textile | Bilan journalier correct, stock mis à jour automatiquement | CRITIQUE | Manuel |
| F07 | Commande exutoire complète | 1. Créer commande client 2. Préparer expédition 3. Charger 4. Peser 5. Facturer | Client + produits + quantités | Statut : en_attente → confirmée → en_préparation → chargée → expédiée → facturée | CRITIQUE | Manuel E2E |
| F08 | Dashboard multi-reporting | 1. Reporting Collecte 2. Reporting RH 3. Reporting Production 4. Refashion 5. Métropole | Période sélectionnée | Graphiques Recharts corrects, export Excel fonctionnel | Élevé | Manuel |
| F09 | Carte CAV + remplissage | 1. Carte Leaflet CAVs 2. Cliquer un CAV 3. Voir historique remplissage | Position GPS CAV | Carte affichée, marqueurs cliquables, données remplissage correctes | Élevé | Manuel |
| F10 | Gestion planning hebdo | 1. Créer planning semaine 2. Affecter collaborateurs 3. Modifier/publier | Semaine + équipe | Planning visible par tous les managers, pas de conflit horaire | Élevé | Manuel |
| F11 | Edge : dons massifs | Simuler 500 dépôts simultanés un samedi matin | 500 requêtes concurrentes | Système stable, pas de perte de données, temps < 2 s | CRITIQUE | JMeter |
| F12 | Edge : stock zéro | Tenter commande exutoire quand stock catégorie = 0 | Commande sans stock | Message erreur clair, commande bloquée ou alerte | Élevé | Manuel |
| F13 | Edge : multi-sites Rouen | Connecter 3 opérateurs de sites différents simultanément | 3 sessions concurrentes | Données isolées par site, pas de mélange de tournées | Élevé | Manuel |
| F14 | Suivi GPS temps réel | 1. Ouvrir LiveVehicles 2. Vérifier positions véhicules | Véhicules en tournée | Marqueurs mis à jour via WebSocket, positions correctes | Élevé | Manuel |
| F15 | Gestion véhicules + maintenance | 1. Ajouter véhicule 2. Planifier maintenance 3. Marquer indisponible | Véhicule + dates | Véhicule non sélectionnable pendant maintenance | Moyen | Manuel |

### Risques ESS / Textile
- **Traçabilité dons** : chaque textile doit être tracé du dépôt au recyclage (exigence Refashion)
- **Multi-qualités** : tri en 7+ catégories (original, CSR, effiloché blanc/couleur, jean, coton blanc/couleur)
- **Insertion sensible** : données CDDI = données personnelles sensibles (parcours social, compétences)

### Outils
- Selenium / Playwright (tests E2E automatisés)
- Postman (collections API)
- JMeter (tests de charge)

---

## Domaine 2 — Sécurité

### Contexte
JWT + bcrypt (10 rounds) + Helmet + Rate limiting (Express + Nginx). RBAC 5 rôles. PostgreSQL paramétré. Uploads multer. CORS whitelist.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| S01 | Injection SQL sur stocks | Envoyer payloads SQLi dans tous les champs de recherche/filtre | `'; DROP TABLE stock_movements;--` | Requête rejetée ou échappée (queries paramétrées $1,$2) | CRITIQUE | OWASP ZAP + Manuel |
| S02 | XSS stocké sur commentaires | Injecter `<script>alert(1)</script>` dans noms candidats, commentaires entretien | Payload XSS | HTML échappé à l'affichage, pas d'exécution script | CRITIQUE | OWASP ZAP |
| S03 | XSS réfléchi dans rapports | Injecter payload dans paramètres URL de recherche | `?q=<img onerror=alert(1)>` | Paramètre échappé, pas d'exécution | CRITIQUE | OWASP ZAP |
| S04 | Path Traversal fichiers CV | Tenter `GET /api/candidates/cv/download` avec path manipulé | `../../etc/passwd` dans cv_file_path | 403 ou 404, pas de lecture fichier système | CRITIQUE | Manuel + Burp |
| S05 | Brute force login | 50 tentatives login en 15 min | Credentials invalides | Blocage après 30 tentatives (rate limit), message "Trop de tentatives" | CRITIQUE | JMeter |
| S06 | Escalade de privilèges | Token COLLABORATEUR appelle endpoint ADMIN `/api/users` | JWT rôle COLLABORATEUR | 403 Forbidden | CRITIQUE | Postman |
| S07 | JWT token expiré | Utiliser token expiré (>8h) sur endpoint protégé | JWT expiré | 401 + refresh token flow | Élevé | Postman |
| S08 | JWT secret faible | Vérifier que JWT_SECRET ≠ valeur par défaut en production | Inspection env | Secret ≥ 64 caractères aléatoires, pas "change-this-in-production" | CRITIQUE | Audit config |
| S09 | Upload fichier malveillant | Upload .exe renommé en .pdf comme CV | Fichier binaire .exe → .pdf | Rejet (vérification MIME type) ou quarantaine | Élevé | Manuel |
| S10 | CORS cross-origin | Requête depuis domaine non autorisé | Origin: https://evil.com | Rejet CORS (pas de Access-Control-Allow-Origin) | Élevé | cURL |
| S11 | Headers sécurité | Vérifier présence de tous les security headers | GET / | HSTS, X-Content-Type-Options, X-Frame-Options, CSP | Élevé | SecurityHeaders.com |
| S12 | DoS sur API GPS Socket.IO | Flood 10 000 events gps-update en 1 min | Payload GPS massif | Rate limiting Socket.IO, pas de crash serveur | Élevé | Script Node.js |

### Vulnérabilités identifiées lors de l'audit

| ID | Vulnérabilité | Sévérité | Localisation | Action |
|----|--------------|----------|-------------|--------|
| V1 | Path Traversal download CV | MOYENNE | candidates.js:952 | Valider path.resolve() + startsWith() |
| V2 | Token JWT en localStorage | MOYENNE | frontend/api.js:48-55 | Migrer vers HTTPOnly cookies |
| V3 | Pas de chiffrement au repos | MOYENNE | Schéma DB | AES-256 sur email, téléphone, cv_raw_text |
| V4 | CSP désactivé (Helmet) | MOYENNE | index.js:49 | Configurer Content-Security-Policy |
| V5 | Validation extension seule uploads | BASSE | candidates.js:21-27 | Ajouter vérification MIME type |

### Outils
- OWASP ZAP (scan automatique + manuel)
- Burp Suite Community (interception proxy)
- SecurityHeaders.com (scan headers)
- jwt.io (décodage/vérification tokens)
- JMeter (tests brute force / DoS)

---

## Domaine 3 — Logique Métier

### Contexte
Règles métier textile circulaire : calculs volumes, valorisation, insertion, CO₂, stocks par qualité.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| L01 | Calcul CO₂ par tournée | Compléter tournée avec pesée | Poids collecté : 500 kg | CO₂ économisé = 500 × 1,493 = 746,5 kg | CRITIQUE | Manuel + vérif DB |
| L02 | % insertion par période | Générer reporting RH mensuel | Période : janvier 2026 | % salariés CDDI = (CDDI actifs / total effectif) × 100 | CRITIQUE | Manuel |
| L03 | Calcul prix revient recyclage | Facturer commande exutoire multi-produits | 10t original × 150€/t + 5t CSR × 80€/t | Total = 1 500 + 400 = 1 900 € HT | CRITIQUE | Manuel |
| L04 | Stock FIFO par qualité | Entrer stock → tri → sortir stock | 100 kg "bon état" + 50 kg "recyclage" | Stocks séparés par catégorie, pas de mélange | Élevé | Manuel |
| L05 | Écart pesée acceptable | Contrôle pesée exutoire | Pesée interne : 10 000 kg, Pesée client : 9 800 kg | Écart 2 % = "conforme" (seuil configurable) | CRITIQUE | Manuel |
| L06 | Écart pesée litige | Contrôle pesée avec gros écart | Interne : 10 000 kg, Client : 9 000 kg | Écart 10 % = "litige", alerte générée | CRITIQUE | Manuel |
| L07 | Concurrence updates tri | 2 opérateurs modifient même session tri simultanément | 2 requêtes PUT en parallèle | Pas de perte de données, version la plus récente gagne ou verrou | Élevé | Postman parallèle |
| L08 | Workflow statut commande | Tester toutes les transitions de statut commande | en_attente → ... → clôturée | Seules les transitions valides autorisées, pas de saut | Élevé | Manuel |
| L09 | Récurrence commandes | Créer commande hebdomadaire récurrente | Fréquence : "weekly", client X | Commande auto-générée chaque lundi | Élevé | Vérif DB |
| L10 | Calcul Refashion | Générer reporting Refashion annuel | Année 2025 complète | Tonnages conformes aux catégories Refashion/ADEME | CRITIQUE | Manuel + export |

### Risques ESS / Textile
- **Valorisation déchets** : règles ADEME/Refashion strictes sur catégorisation
- **Multi-qualité** : 7 types produits (original, CSR, effiloché blanc/couleur, jean, coton blanc/couleur)
- **Insertion** : calcul % insertion obligatoire pour subventions ESS

### Outils
- Postman (tests API calculs)
- PostgreSQL pgTAP (tests unitaires DB)
- Jest (tests unitaires backend)

---

## Domaine 4 — Réseau & Infrastructure

### Contexte
Docker Compose 7 services (db, redis, backend, frontend, mobile, nginx, certbot). Scaleway DEV1-S. Nginx reverse proxy + TLS 1.2/1.3.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| I01 | Scalabilité pic collecte samedi | Simuler 50 utilisateurs concurrents | 50 threads JMeter, 5 min | Temps réponse P95 < 500 ms, 0 erreur 5xx | CRITIQUE | JMeter |
| I02 | Latence API mobile 3G | Tester endpoints mobiles sur connexion 3G | Throttle 1.5 Mbps | Réponse API < 1 s, page < 3 s | CRITIQUE | Chrome DevTools throttle |
| I03 | Health check containers | Vérifier tous les healthchecks Docker | `docker compose ps` | Tous services "healthy", auto-restart si crash | CRITIQUE | Bash + health-check.sh |
| I04 | SSL/TLS configuration | Scanner configuration SSL | ssllabs.com/ssltest | Note A+ (TLS 1.2+, HSTS, ciphers forts) | CRITIQUE | SSL Labs |
| I05 | Failover Redis | Arrêter Redis → Vérifier comportement app | `docker stop redis` | App fonctionne (dégradé), pas de crash | Élevé | Manuel Docker |
| I06 | Failover PostgreSQL | Arrêter DB → Vérifier messages erreur | `docker stop db` | Messages erreur explicites, pas de données corrompues | Élevé | Manuel Docker |
| I07 | Docker rebuild sans cache | Rebuild complet après mise à jour | `docker compose build --no-cache` | Build réussi < 5 min, images < 500 Mo | Moyen | Bash + chrono |
| I08 | Disk space alerte | Remplir disque à 90 % | Simulation saturation | health-check.sh déclenche alerte CRITICAL | Élevé | Manuel |
| I09 | WebSocket stabilité | Maintenir connexion Socket.IO GPS 30 min | Session GPS continue | Pas de déconnexion, reconnexion auto si coupure | Élevé | Manuel + DevTools |
| I10 | Backup/Restore | 1. backup.sh 2. Modifier données 3. restore.sh | Backup quotidien | Données restaurées identiques à l'état pré-modification | CRITIQUE | Manuel |

### Outils
- JMeter (tests de charge / performance)
- SSL Labs (audit TLS)
- Prometheus + Grafana (monitoring — à implémenter)
- Docker CLI (health checks)
- Uptime Robot (monitoring externe)

---

## Domaine 5 — Juridique & Conformité

### Contexte
RGPD complet implémenté (routes /api/rgpd). Données sensibles : salariés CDDI, candidats, CV, profils PCM. Subventions ESS.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| J01 | RGPD Droit d'accès (Art. 15) | GET /api/rgpd/export/candidate/{id} | ID candidat existant | Export JSON complet : données perso, compétences, historique, PCM | CRITIQUE | Postman |
| J02 | RGPD Droit à l'oubli (Art. 17) | POST /api/rgpd/anonymize/candidate/{id} | ID + raison | Nom → "ANONYME", email/tel → NULL, CV supprimé, PCM supprimé | CRITIQUE | Postman + vérif DB |
| J03 | RGPD Registre traitements (Art. 30) | GET /api/rgpd/registre | — | Liste complète des traitements avec finalités, bases légales | CRITIQUE | Postman |
| J04 | RGPD Consentement | POST /api/rgpd/consent | Type + granted: true/false | Consentement enregistré avec date, upserté si existant | Élevé | Postman |
| J05 | RGPD Purge automatique 24 mois | POST /api/rgpd/purge-expired | — | Candidats non recrutés > 24 mois anonymisés automatiquement | CRITIQUE | Postman + vérif DB |
| J06 | Audit trail complet | Effectuer export + anonymisation → GET /api/rgpd/audit | Filtres action/entity | Toutes les actions RGPD tracées avec user_id, timestamp, détails | CRITIQUE | Postman |
| J07 | WCAG 2.2 AA scan global | Audit accessibilité de toutes les pages frontend | 40+ pages | Score axe-core > 90 %, 0 violation critique | Élevé | axe DevTools |
| J08 | Conformité ESS subventions | Vérifier que les métriques insertion sont exportables | Export reporting RH | Données conformes aux exigences DIRECCTE/Refashion | Élevé | Manuel |
| J09 | Licences OSS | Scanner toutes les dépendances pour licences | package.json (3 apps) | Aucune licence GPL/AGPL restrictive, licences MIT/Apache OK | Moyen | license-checker-webpack |
| J10 | Confidentialité profils PCM | Vérifier accès aux résultats PCM | Token COLLABORATEUR | 403 sur /api/pcm (réservé ADMIN/RH) | Élevé | Postman |

### Risques ESS / Textile
- **Données insertion** : profils sociaux extrêmement sensibles (parcours judiciaire, handicap, etc.)
- **Subventions** : traçabilité obligatoire pour justifier financements (DIRECCTE, Refashion, Métropole)
- **Dons textiles** : anonymisation des donateurs si collecte nominative

### Outils
- Postman (tests API RGPD)
- axe DevTools + pa11y (audit accessibilité)
- license-checker (audit licences OSS)
- CNIL checklist RGPD

---

## Domaine 6 — Data & Base de Données

### Contexte
PostgreSQL 15 + PostGIS. 50+ tables. Queries paramétrées ($1, $2). Pool : 20 connexions max, 30s idle timeout.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| D01 | Intégrité ACID stock | Transaction : INSERT stock + UPDATE total → simuler crash | Transaction partielle | Rollback complet, pas de données incohérentes | CRITIQUE | pgTAP |
| D02 | Contraintes FK | Supprimer un client_exutoire ayant des commandes | DELETE client avec FK | Erreur 23503 → 400 "Référence invalide" | CRITIQUE | Postman |
| D03 | Contraintes UNIQUE | Créer 2 utilisateurs avec même username | INSERT doublon | Erreur 23505 → 409 "Enregistrement en doublon" | Élevé | Postman |
| D04 | Backup quotidien 2h | Déclencher backup.sh et vérifier intégrité | `bash backup.sh` | Dump gzip créé, restaurable, rétention 30 jours | CRITIQUE | Bash |
| D05 | Performance requête reporting annuel | EXPLAIN ANALYZE sur reporting collecte 12 mois | SELECT avec JOIN 5 tables | Temps < 2 s, utilisation index, pas de seq scan | Élevé | psql EXPLAIN |
| D06 | Pool connexions épuisé | Ouvrir 25 connexions simultanées (max 20) | 25 requêtes concurrentes | Queuing gracieux, pas de crash, timeout configurable | Élevé | JMeter |
| D07 | PostGIS requêtes spatiales | Rechercher CAVs dans un rayon de 5 km | Coordonnées GPS + rayon | Résultats corrects, index spatial utilisé | Élevé | Postman |
| D08 | Migration schéma safe | Exécuter migrate-exutoires.js sur base existante | Script migration | Tables créées/modifiées, données existantes préservées | CRITIQUE | Manuel |
| D09 | Anonymisation irréversible | Anonymiser candidat → tenter récupération | POST anonymize + SELECT | Données personnelles définitivement supprimées, pas récupérables | CRITIQUE | psql |
| D10 | Import Excel production | Importer historique Excel via endpoint dédié | Fichier Excel 10 000 lignes | Import complet < 30 s, pas de doublons, erreurs tracées | Élevé | Manuel |

### Outils
- pgTAP (tests unitaires PostgreSQL)
- EXPLAIN ANALYZE (profiling requêtes)
- JMeter (tests charge DB)
- pg_dump / pg_restore (tests backup)

---

## Domaine 7 — Ressources Humaines

### Contexte
Gestion salariés CDDI (insertion), collaborateurs, compétences, heures de travail, parcours insertion. Routes : /api/employees, /api/insertion, /api/candidates, /api/pcm.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| H01 | CRUD collaborateurs | Créer, lire, modifier, supprimer un employé | Données employé complètes | Opérations CRUD fonctionnelles, validation champs | CRITIQUE | Postman |
| H02 | Suivi heures travail | Saisir heures semaine pour 10 collaborateurs | Heures par jour/collaborateur | Total hebdo correct, heures sup calculées | CRITIQUE | Manuel |
| H03 | Parcours insertion CDDI | 1. Créer parcours 2. Évaluations mensuelles 3. Clôturer | Salarié CDDI + objectifs | Progression tracée, évaluations datées, sortie documentée | CRITIQUE | Manuel |
| H04 | Matrice compétences | Affecter compétences tri/collecte à collaborateurs | Compétences + niveaux | Matrice croisée collaborateurs×compétences exportable | Élevé | Manuel |
| H05 | Confidentialité profils | Token COLLABORATEUR accède à son propre profil uniquement | JWT rôle COLLABORATEUR | Voir ses données, pas celles des autres (sauf RH/ADMIN) | CRITIQUE | Postman |
| H06 | Onboarding candidat recruté | Workflow : Candidat "Recruté" → Création employé | Candidat statut recruté | Données transférées automatiquement, pas de re-saisie | Élevé | Manuel |
| H07 | PCM profil risque | Candidat avec profil "Rebelle" fort → alerte | Résultats PCM extrêmes | Alerte visuelle pour RH, pas de blocage automatique | Élevé | Manuel |
| H08 | Export SIRH | Exporter données collaborateurs format standard | Bouton export | Fichier CSV/Excel conforme, données correctes | Moyen | Manuel |
| H09 | Planning hebdo conflit | Affecter même collaborateur à 2 postes simultanés | Conflit horaire | Alerte conflit, pas d'enregistrement doublon | Élevé | Manuel |
| H10 | Reporting RH dashboard | Afficher dashboard RH mensuel | Période sélectionnée | Métriques : effectif, turnover, heures, % insertion, formation | Élevé | Manuel |

### Risques ESS / Textile
- **CDDI** : contrats à durée déterminée d'insertion = données ultra-sensibles
- **Compétences tri** : spécifiques textile (tri qualité, catégorisation, machines effilochage)
- **Insertion** : suivi imposé par financeurs (DIRECCTE, Conseil Départemental)

---

## Domaine 8 — Opérations & DevOps

### Contexte
GitHub Actions CI (lint + test + build). Docker Compose prod 7 services. health-check.sh toutes les 5 min. backup.sh quotidien 2h.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| O01 | CI pipeline complet | Push sur branche → GitHub Actions | Code modifié | ESLint ✓, Jest ✓, Docker build ✓ | CRITIQUE | GitHub Actions |
| O02 | Deploy update | Exécuter deploy.sh update | Nouvelle version | Backup → pull → rebuild → restart → health check OK | CRITIQUE | SSH + Bash |
| O03 | Rollback après échec | Déployer version cassée → rollback | Version avec erreur | Retour version précédente, service restauré < 5 min | CRITIQUE | Manuel |
| O04 | Logs erreur centralisés | Provoquer erreurs → vérifier logs | Requête invalide | Logs structurés : timestamp, user, endpoint, erreur, stack | Élevé | Docker logs |
| O05 | Auto-restart container crash | Kill backend container | `docker kill backend` | Container redémarré automatiquement (restart: unless-stopped) | CRITIQUE | Docker |
| O06 | Health check alerte | Simuler service down | Arrêter un container | health-check.sh détecte + auto-restart + log alerte | CRITIQUE | Bash |
| O07 | Systemd service | Reboot serveur → vérifier démarrage auto | `reboot` | solidata.service démarre Docker Compose automatiquement | Élevé | SSH |
| O08 | Cron backup vérifié | Attendre 2h AM → vérifier backup | Cron automatique | Dump créé dans /backups/daily/, taille > 0 | Élevé | Bash |
| O09 | Cleanup Docker images | Exécuter cleanup hebdomadaire | Cron dimanche 4h | Images orphelines supprimées, espace récupéré | Moyen | Bash |
| O10 | Monitoring endpoints | Vérifier /api/health, /, /m/ | curl endpoints | 200 OK sur chaque endpoint, temps < 500 ms | CRITIQUE | curl + health-check.sh |

### Outils
- GitHub Actions (CI/CD)
- Docker CLI
- health-check.sh (monitoring interne)
- Uptime Robot (monitoring externe)

---

## Domaine 9 — Logistique & Exutoires

### Contexte
7 pages dédiées. Clients exutoires (recycleur, négociant, industriel). Commandes multi-produits. Préparation expédition. Gantt chargement. Calendrier prévisionnel. Contrôles pesée. Facturation OCR.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| X01 | Workflow commande E2E | Créer → confirmer → préparer → charger → expédier → peser → facturer → clôturer | Client + produits + quantités | 8 transitions statut validées, données cohérentes | CRITIQUE | Manuel E2E |
| X02 | Préparation expédition | 1. Planifier prep 2. Recevoir remorque 3. Charger 4. Peser interne 5. Expédier | Commande confirmée | Timeline complète : heure_réception → début_chargement → fin → départ | CRITIQUE | Manuel |
| X03 | Gantt chargement | Visualiser planning chargement semaine | Semaine avec 5 commandes | Barres Gantt correctes, pas de chevauchement quai | Élevé | Manuel |
| X04 | Calendrier prévisionnel alertes | Vérifier alertes : surcharge, prep manquante, stock insuffisant | Données calendrier | Alertes visuelles correctes par type | CRITIQUE | Manuel |
| X05 | Contrôle pesée conforme | Pesée interne vs client, écart < 2 % | 10 000 kg vs 9 850 kg | Statut "conforme", validation automatique | CRITIQUE | Postman |
| X06 | Contrôle pesée litige | Pesée interne vs client, écart > 5 % | 10 000 kg vs 9 200 kg | Statut "litige", workflow litige déclenché | CRITIQUE | Postman |
| X07 | Facturation OCR | Upload facture PDF → extraction automatique | Facture PDF client | Montant, date, référence extraits par Tesseract.js | Élevé | Manuel |
| X08 | Grille tarifaire client | Configurer tarifs par produit et client | Client + 7 types produits + prix/tonne | Tarifs appliqués automatiquement sur commandes | Élevé | Manuel |
| X09 | CO₂ impact par exutoire | Calculer empreinte CO₂ par type de client | Commande recycleur vs négociant | CO₂ différent selon ACV Refashion/ADEME | Élevé | Manuel + vérif |
| X10 | Affectation équipe préparation | Affecter 3 collaborateurs à une préparation | Préparation + 3 employés | Collaborateurs listés, disponibilité vérifiée | Moyen | Manuel |

### Risques ESS / Textile
- **Traçabilité totale** : de la collecte (dépôt CAV) au recyclage (exutoire) = obligation Refashion
- **Multi-entrepôts** : quai de chargement, garage remorque, cours — localisation précise nécessaire
- **Transporteurs** : intégration possible avec API transporteurs (non implémenté actuellement)

---

## Domaine 10 — Finances & Facturation

### Contexte
Facturation exutoires, reporting CA, prix de revient, subventions ESS. Routes : /api/factures-exutoires, /api/tarifs-exutoires, reporting.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| FI01 | Facturation commande | Clôturer commande → générer facture | Commande expédiée + pesée | Facture avec montant = quantité × tarif/tonne, TVA correcte | CRITIQUE | Manuel |
| FI02 | Rapprochement pesée/facture | Comparer pesée interne vs facture reçue | Facture OCR + pesée DB | Écarts identifiés, rapprochement automatique si conforme | CRITIQUE | Manuel |
| FI03 | Reporting CA mensuel | Dashboard finances → CA par mois | Période 12 mois | Graphique correct, total cohérent avec factures | Élevé | Manuel |
| FI04 | Prix de revient par catégorie | Calculer coût tri + transport + main d'œuvre par tonne | Données production + transport | Marge par catégorie textile calculée | Élevé | Manuel |
| FI05 | Export comptable | Exporter écritures pour comptabilité association | Période comptable | Fichier Excel/CSV format comptable standard | Élevé | Manuel |
| FI06 | Suivi subventions ESS | Tracer utilisation subventions (DIRECCTE, Refashion, Métropole) | Subventions actives | Montants alloués vs consommés, justificatifs disponibles | CRITIQUE | Manuel |
| FI07 | Facturation récurrente | Client avec commande hebdomadaire → factures auto | Commande récurrente | Facture générée à chaque expédition, numérotation séquentielle | Élevé | Manuel |
| FI08 | Anomalie facturation | Facture avec montant incohérent (0€, négatif) | Données invalides | Validation côté backend, rejet avec message explicite | Élevé | Postman |

### Risques ESS / Textile
- **Compta association** : règles comptables spécifiques au secteur associatif
- **Subventions** : traçabilité financière obligatoire pour renouvellement
- **TVA textile** : règles spécifiques selon type de vente (réemploi vs recyclage)

---

## Domaine 11 — Communication & Notifications

### Contexte
Brevo API (SMS + Email). Socket.IO (GPS temps réel). Pas de push notifications PWA actuellement.

### Tests clés

| # | Test | Étapes | Input | Output attendu | Priorité | Méthode |
|---|------|--------|-------|----------------|----------|---------|
| C01 | SMS convocation entretien | Envoyer convocation candidat via Brevo | N° téléphone + message | SMS reçu < 1 min, contenu correct, traçabilité DB | CRITIQUE | Manuel |
| C02 | Email notification RH | Déclencher notification email | Événement RH (nouveau candidat) | Email reçu, template correct, lien fonctionnel | Élevé | Manuel |
| C03 | Socket.IO GPS broadcast | Vérifier que position GPS est diffusée aux managers | Chauffeur en tournée | Position visible en temps réel sur LiveVehicles | Élevé | DevTools Network |
| C04 | Alerte stock bas | Stock produit fini < seuil → notification | Stock sous le seuil | Alerte visible dashboard + notification responsable | Élevé | Manuel |
| C05 | Alerte calendrier logistique | Surcharge semaine détectée par calendrier | Trop de commandes planifiées | Alerte orange/rouge dans ExutoiresCalendrier | Élevé | Manuel |
| C06 | Brevo API erreur | Simuler échec envoi SMS (mauvais numéro) | N° invalide | Erreur tracée, pas de crash, retry ou alerte admin | Élevé | Manuel |
| C07 | Documentation FR | Vérifier que toute l'UI est en français | Navigation complète | 100 % textes en français, pas de texte EN résiduel | Moyen | Manuel |
| C08 | Multilingue (futur) | Vérifier architecture i18n ready | Audit code | Textes externalisables dans fichiers de traduction | Faible | Code review |

### Outils
- Brevo dashboard (suivi envois)
- Chrome DevTools Network (WebSocket)
- Mailhog (test emails en dev)

---

## Tableau Récapitulatif

| Domaine | # Tests | Priorité Globale | Profil Impacté | Statut |
|---------|---------|-----------------|---------------|--------|
| **D0 — UX Mobile** | 20 | **CRITIQUE** | Opérateurs terrain + PCM | A tester |
| **D1 — Use Cases** | 15 | **CRITIQUE** | Tous | A tester |
| **D2 — Sécurité** | 12 | **CRITIQUE** | Tous | A tester |
| **D3 — Logique Métier** | 10 | **CRITIQUE** | Managers + Ops | A tester |
| **D4 — Réseau/Infra** | 10 | **CRITIQUE** | Tous | A tester |
| **D5 — Juridique/Conformité** | 10 | **CRITIQUE** | ADMIN + RH | A tester |
| **D6 — Data/BDD** | 10 | **CRITIQUE** | Tous | A tester |
| **D7 — Ressources Humaines** | 10 | Élevé | RH + Managers | A tester |
| **D8 — Opérations/DevOps** | 10 | **CRITIQUE** | ADMIN | A tester |
| **D9 — Logistique/Exutoires** | 10 | **CRITIQUE** | Ops + Managers | A tester |
| **D10 — Finances** | 8 | Élevé | Finances + ADMIN | A tester |
| **D11 — Communication** | 8 | Élevé | Tous | A tester |
| **TOTAL** | **133** | — | — | — |

---

## Checklist Exportable

```
### CRITIQUE — Semaine 1
- [ ] M01 : Collecte complète < 45 s (standard)
- [ ] M02 : Scan QR < 3 s
- [ ] M05 : Sync offline 5 min
- [ ] M11 : TalkBack lit TOUS les boutons
- [ ] M12 : 3 taps max par action (PCM)
- [ ] M13 : Boutons 60 px (PCM)
- [ ] F01 : Workflow collecte complet E2E
- [ ] F02 : Gestion candidats Kanban
- [ ] F05 : Parcours insertion CDDI
- [ ] F06 : Production chaîne de tri
- [ ] F07 : Commande exutoire complète
- [ ] S01 : Injection SQL sur stocks
- [ ] S02 : XSS stocké commentaires
- [ ] S04 : Path Traversal CV
- [ ] S05 : Brute force login
- [ ] S06 : Escalade de privilèges
- [ ] S08 : JWT secret production

### CRITIQUE — Semaine 2
- [ ] L01 : Calcul CO₂ par tournée
- [ ] L05 : Écart pesée acceptable
- [ ] L06 : Écart pesée litige
- [ ] L10 : Calcul Refashion
- [ ] I01 : Scalabilité 50 users concurrents
- [ ] I02 : Latence API mobile 3G
- [ ] I04 : SSL/TLS note A+
- [ ] I10 : Backup/Restore complet
- [ ] J01 : RGPD Droit d'accès
- [ ] J02 : RGPD Droit à l'oubli
- [ ] J05 : RGPD Purge 24 mois
- [ ] J06 : Audit trail RGPD
- [ ] D01 : Intégrité ACID stock
- [ ] D08 : Migration schéma safe
- [ ] X01 : Workflow commande E2E
- [ ] X05 : Contrôle pesée conforme
- [ ] X06 : Contrôle pesée litige

### ÉLEVÉ — Semaine 3
- [ ] M03 : Scan QR lumière variable
- [ ] M06 : GPS tracking temps réel
- [ ] M14 : Contraste 4.5:1
- [ ] M18 : Badges daltoniens-friendly
- [ ] F03 : Test PCM personnalité
- [ ] F04 : Plan recrutement mensuel
- [ ] F08 : Dashboard multi-reporting
- [ ] S07 : JWT token expiré
- [ ] S09 : Upload fichier malveillant
- [ ] S10 : CORS cross-origin
- [ ] S11 : Headers sécurité
- [ ] L07 : Concurrence updates tri
- [ ] H01-H10 : Tests RH complets
- [ ] O01-O10 : Tests DevOps complets
- [ ] X02-X10 : Tests logistique restants
- [ ] FI01-FI08 : Tests finances complets
- [ ] C01-C08 : Tests communication complets

### MOYEN / FAIBLE — Semaine 4
- [ ] M08 : Scroll fluide 60 fps
- [ ] M10 : Résumé tournée CO₂
- [ ] M16 : Vibration feedback
- [ ] M17 : Audio loop instructions
- [ ] M19 : Dynamic Type Android
- [ ] M20 : Voice input poids
- [ ] F15 : Gestion véhicules maintenance
- [ ] D06 : Pool connexions épuisé
- [ ] J09 : Licences OSS
- [ ] C07 : Documentation 100 % FR
- [ ] C08 : Architecture i18n ready
```

---

## Roadmap d'Exécution

```
SEMAINE 1 : SMOKE + UX MOBILE CRITIQUE
├── Jour 1-2 : Tests terrain avec 3 opérateurs + 1 duo PCM/tuteur
│   ├── M01-M10 : Profil standard (collecte, scan, GPS, offline)
│   └── M11-M20 : Profil PCM (TalkBack, boutons, voix, contraste)
├── Jour 3-4 : Smoke tests fonctionnels
│   ├── F01 : Workflow collecte E2E
│   ├── F02 : Kanban candidats
│   ├── F05 : Parcours insertion
│   ├── F06 : Production tri
│   └── F07 : Commande exutoire
└── Jour 5 : Sécurité critique
    ├── S01-S06 : OWASP Top 10 prioritaires
    └── S08 : Audit configuration JWT

SEMAINE 2 : INTÉGRATION + SÉCURITÉ + RGPD
├── Jour 1-2 : Logique métier + Data
│   ├── L01-L10 : Calculs, stocks, workflows
│   └── D01-D10 : ACID, backup, migrations
├── Jour 3 : Infrastructure + Performance
│   ├── I01-I04 : Charge, latence, SSL
│   └── I10 : Backup/Restore
├── Jour 4 : RGPD + Conformité
│   ├── J01-J06 : Articles 15, 17, 30
│   └── J07 : Scan WCAG
└── Jour 5 : Logistique critique
    └── X01-X06 : Commandes, pesées, alertes

SEMAINE 3 : RÉGRESSION COMPLÈTE
├── Jour 1-2 : Tous tests élevés restants
├── Jour 3 : RH + Finances complets
├── Jour 4 : Communication + DevOps
└── Jour 5 : Tests de non-régression automatisés

SEMAINE 4 : POLISH + DOCUMENTATION
├── Jour 1-2 : Tests moyens/faibles restants
├── Jour 3 : Correction des défauts trouvés
├── Jour 4 : Re-test des défauts corrigés
└── Jour 5 : Rapport final + recommandations
```

---

## Recommandations Stack

### Corrections Prioritaires (issues audit sécurité)

| # | Correction | Fichier | Effort |
|---|-----------|---------|--------|
| 1 | Path Traversal : valider `path.resolve()` + `startsWith(uploadsDir)` | candidates.js:952 | 1 h |
| 2 | JWT secret : fail-hard si non défini en production | index.js:174 | 30 min |
| 3 | HTTPOnly cookies : remplacer localStorage par cookies sécurisés | api.js:48-55 + auth.js | 4 h |
| 4 | CSP Header : configurer Content-Security-Policy dans Helmet | index.js:49 | 2 h |
| 5 | MIME type validation : vérifier Content-Type uploads (pas juste extension) | candidates.js:21-27 | 1 h |
| 6 | Chiffrement au repos : AES-256 sur email, téléphone, cv_raw_text | Nouveau middleware | 8 h |

### Améliorations Accessibilité Mobile (profil PCM)

| # | Amélioration | Impact | Effort |
|---|-------------|--------|--------|
| 1 | Ajouter aria-labels sur TOUS les boutons/icônes (actuellement 1 seul) | TalkBack fonctionnel | 4 h |
| 2 | Augmenter touch targets à 60 px pour profil PCM | Utilisabilité insertion | 2 h |
| 3 | Ajouter navigator.vibrate() feedback (500ms/1000ms) | Feedback tactile | 2 h |
| 4 | Implémenter Web Speech API pour saisie vocale poids | Accessibilité | 4 h |
| 5 | Remplacer emojis par icônes SVG + aria-label | Screen reader compatible | 4 h |
| 6 | Ajouter mode sombre (dark mode) pour usage extérieur | Lisibilité terrain | 8 h |

### Infrastructure

| # | Amélioration | Impact | Effort |
|---|-------------|--------|--------|
| 1 | Redis rate limiting (remplacer memory store) | Scalabilité | 2 h |
| 2 | Prometheus + Grafana monitoring | Observabilité | 8 h |
| 3 | Winston/Pino logger (remplacer console.log) | Logs structurés | 4 h |
| 4 | IndexedDB offline-first (remplacer localStorage seul) | Fiabilité terrain | 16 h |
| 5 | CRON automatique RGPD purge (remplacer trigger manuel) | Conformité | 2 h |

---

## Annexes

### A. Outils de Test Recommandés

| Outil | Usage | Licence |
|-------|-------|---------|
| Playwright | Tests E2E frontend (remplacement Selenium) | Apache 2.0 |
| Postman / Newman | Tests API + collections CI | Free tier |
| OWASP ZAP | Scan sécurité automatique | Apache 2.0 |
| JMeter | Tests charge / performance | Apache 2.0 |
| axe DevTools | Audit accessibilité WCAG | Free |
| Lighthouse CI | Performance + PWA scoring | Apache 2.0 |
| pgTAP | Tests unitaires PostgreSQL | MIT |
| Jest | Tests unitaires backend (déjà configuré) | MIT |
| SSL Labs | Audit TLS/HTTPS | Free |
| SecurityHeaders.com | Audit HTTP security headers | Free |

### B. Critères de Succès / Échec

| Critère | Succès | Échec |
|---------|--------|-------|
| Tests CRITIQUE | 100 % passés | ≥ 1 test critique échoué |
| Tests Élevé | ≥ 95 % passés | < 80 % passés |
| Sécurité OWASP | 0 vulnérabilité critique | ≥ 1 vulnérabilité critique |
| RGPD | Articles 15/17/30 fonctionnels | Article manquant |
| Performance | P95 < 500 ms | P95 > 2 s |
| Accessibilité | Score axe > 90 % | Score < 70 % |
| Uptime test | 99,9 % sur 7 jours | < 99 % |

### C. Matrice de Risques ESS / Textile

| Risque | Probabilité | Impact | Mitigation |
|--------|------------|--------|-----------|
| Perte données insertion CDDI | Faible | CRITIQUE | Backup quotidien + chiffrement |
| Faille RGPD données candidats | Moyenne | CRITIQUE | Anonymisation + audit trail |
| Traçabilité Refashion incomplète | Moyenne | Élevé | Tests E2E collecte → recyclage |
| Indisponibilité terrain (réseau) | Élevée | Élevé | Mode offline PWA renforcé |
| Erreur calcul subvention | Faible | CRITIQUE | Tests unitaires formules |
| Stress numérique salariés CDDI | Élevée | Moyen | UX simplifiée + formation |

---

*Plan de test rédigé sur la base d'un audit complet du codebase SOLIDATA. 133 tests couvrant 12 domaines, priorisés selon la criticité métier ESS/textile.*
