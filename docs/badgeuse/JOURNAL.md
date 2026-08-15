# Journal de projet — Badgeuse SOLIDATA (module « Temps & Présence »)

Tenu par l'Agent 0 (chef d'orchestre). Convention : les questions **ouvertes** sont en gras.

## Orchestration réalisée

| Rôle | Réalisation |
|---|---|
| A0 — chef d'orchestre | Session principale (Fable) : cadrage, contrats, ADR, séquencement, réconciliation, ce journal |
| A1 — architecte | Session principale : `MODELE_DONNEES.md`, `CONTRAT_API_DEVICE.md`, `CONTRAT_INTEGRITE.md`, `CONTRAT_HMAC.md` (vecteurs calculés, pas inventés), ADR 0001-0003 |
| A2 — backend SOLIDATA | Agent parallèle (Opus) : init-db, moteur pur, API device, back-office, exports, scheduler, tests Jest |
| A2b — frontend | Agent parallèle (Sonnet) : page Temps & Présence (7 onglets), sidebar, routes |
| A3 — embarqué Raspberry | Agent parallèle (Opus) : `badgeuse/` (agent Python, UI kiosque, scripts d'installation), tests pytest |
| A4 — QA (barrière) | Agent de vérification adversariale après réconciliation |
| A5 — conformité (barrière) | Agent de contrôle RGPD by design, preuves fichier:ligne |
| A6 — déploiement & doc | RUNBOOK, EXPLOITATION, MANUEL_RH après double feu vert |

## Décisions (voir ADR)

- **ADR-0001** : backend implémenté dans la pile réelle de SOLIDATA (Express/pg), pas FastAPI ;
  l'embarqué reste Python. Exigences fonctionnelles inchangées.
- **ADR-0002** : aucune règle de gestion en dur ; défauts seedés = recommandations écrites du RH
  (NOTE_RH §3) ; bandeau « à arbitrer » tant que la Direction n'a pas validé la grille dans l'écran
  Paramètres.
- **ADR-0003** : module neuf `badgeuse_*`, coexistence avec le module « Pointage » legacy (non
  modifié) ; pas d'écriture dans `work_hours` ni `employee_week_hours` en V1 (anti double-compte,
  la paie sort par les exports).

## Questions à la Direction (non bloquantes pour le pilote à blanc, bloquantes pour la production)

1. **Arbitrer la grille des règles de gestion** (écran Temps & Présence → Paramètres) — les 8
   décisions de NOTE_RH §3 sont préremplies aux recommandations RH, à confirmer et « marquer
   comme arbitrées ».
2. **Valider le budget matériel** (525 € TTC recommandé) et commander (BOM SPEC §3).
3. **Lancer la consultation du CSE** (préalable obligatoire — NOTE_JURIDIQUE §2.4) : le logiciel
   peut être montré en réunion, mais **aucune mise en service avant le PV**.
4. **Désigner** le valideur de playlist et le référent d'exploitation (+ suppléant).
5. **Confirmer** l'inscription au registre des traitements (une entrée est seedée dans le module
   RGPD de SOLIDATA — à faire relire par le référent RGPD) et les contrats art. 28.
6. La sonorité/duree overlay et la plage DPMS sont paramétrables — valider en réunion atelier.

## Passe de réconciliation front ↔ back (A0, après livraison des 3 agents parallèles)

Vérification point à point des hypothèses prises par l'agent frontend contre le code backend
réel. Quatre écarts corrigés :

1. **Clé HMAC d'appairage** : `POST /devices` renvoie `hmac_key` ; le front ne testait que
   `hmac_key_site`/`site_hmac_key` → clé jamais affichée à l'appairage. Corrigé
   (SupervisionPostes, chaîne de replis complétée).
2. **Corrections `modification`/`annulation`** : le backend exige `pointage_id` (400 sinon) ;
   la modale n'en portait pas → actions « Corriger »/« Annuler » ajoutées sur chaque ligne du
   journal (modale pré-remplie), champ « N° du pointage d'origine » en repli, l'annulation ne
   demande plus date/heure.
3. **Fuseau des corrections** : le front envoyait une heure murale Paris sans fuseau que
   Postgres aurait interprétée en heure serveur (UTC) → décalage 1-2 h. Le backend interprète
   désormais tout horodatage naïf comme heure murale Paris (`parisDateTimeToUTC`, doctrine
   2.20.0 du dépôt), un horodatage avec fuseau restant pris tel quel.
4. **Liste des sites** : le backend expose `GET /badgeuse/sites` (non prévu au contrat initial) ;
   la modale d'appairage le consomme désormais au lieu de déduire les sites des postes existants.

Divers : `PUT /parametres` marque l'arbitrage à tout enregistrement réussi (le drapeau
`marquer_arbitrees` envoyé par le front est ignoré sans effet — comportement voulu ADR-0002 §3).

## Écarts assumés à la lettre du dossier de prompts

- OpenAPI YAML remplacé par un contrat Markdown (ADR-0001) — même fonction, pile différente.
- Le rôle « salarié consulte ses propres données » est servi par (a) `GET /api/badgeuse/mes-pointages`
  pour les salariés disposant d'un compte (lien `employees.user_id`), (b) le relevé individuel
  imprimable remis par l'encadrant/RH (journalisé) — conforme à la note d'information salariés
  (« Demandez à votre encadrant, il vous montre »).
- Anomalie « absence non justifiée » (BO-05) : nécessite le planning théorique fiable ; V1 couvre
  oubli de sortie, journée > seuil, hors plage, orphelins. À raccorder au planning hebdo
  (`weekly_schedule`) en V1.1.
- MANAGER (encadrant) non restreint à son équipe en lecture : précédent documenté du dépôt
  (v2.12.0) ; l'anti-autocorrection (NOTE_RH §5.2) est, elle, appliquée strictement.
- Les tests « robustesse physique » d'A4 (20 coupures secteur, ventilateur entravé, 24 h hors
  ligne réelles) ne sont **pas exécutables en environnement de développement** : ils sont
  transcrits en tests logiciels équivalents (crash SQLite simulé, file hors ligne, plafonds) et
  consignés dans le RUNBOOK comme protocole de recette **sur matériel réel** avant mise en service.
