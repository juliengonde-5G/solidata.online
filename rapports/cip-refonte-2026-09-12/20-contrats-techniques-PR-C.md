# Contrats techniques — PR C « Section CIP et documents du salarié » (lots 5 + 7)

> Orchestrateur, 13/09/2026. Empilée sur la PR B (#167, branche `claude/solidata-cip-redesign-9fskwq-pr-b`).
> Branche : `claude/solidata-cip-redesign-9fskwq-pr-c`. Version cible : **2.54.0**.
> Sources : plan `07-plan-action.md` (lots 5 et 7, décisions § 8 n° 7 et 8), organisation cible `08-organisation-section-cip.md` (§ 0-3, 6-8 et **tous les amendements du § 10**), matrice autorité `09`.
> Même méthode que PR A/B : contrats FIGÉS, deux lots à fichiers DISJOINTS, pré-câblage par l'orchestrateur, puis revue sécurité (lecture seule), debug sur PostgreSQL réel, documentation, correctifs.

---

## 0. Ce que PR C livre, en une phrase par lot

- **Lot 5 — « Section CIP »** (agent `cip`) : l'espace CIP s'organise par ce que la conseillère doit faire **aujourd'hui** — écran « Mes échéances » à 5 blocs ordonnés (obligations reportables 48 h, jamais acquittables 7 j), **file active** restreinte aux parcours (permanents exclus) et enrichie, **fiche en 4 onglets** (Situation / Suivi / Dossier administratif / Diagnostic), diagnostic en **socle J+30 à 7 rubriques** + approfondissements repliés, **écran ETI à jeton public** `/eti/renouvellement/:token` (60 j), fiche collaborateur réduite, compteur d'échéances rouges dans la barre latérale, fin des `alert()`/`window.confirm`.
- **Lot 7 — « Le salarié »** (agent `salarie`) : deux documents **pour la personne** composés côté serveur en liste blanche — **« Mon parcours en une page »** (FALC : mes engagements, ceux de la structure, mes heures de la semaine, mon prochain rendez-vous, mon référent, mes documents remis) et **« Mon Récap »** (étapes datées, partageable, sans art. 9/10, sans texte libre) — avec **remise tracée** ; et les **rappels de rendez-vous J-1** par SMS ou e-mail Brevo, **sur consentement individuel tracé et révocable**, sans jamais nommer le type d'entretien.

**Ce qui n'est PAS dans PR C** (et ne doit pas y entrer) : le reporting autorité (lot 6, PR D), la documentation collaborateurs/autorité (lot 8, PR D — l'agent docs de PR C met à jour les guides existants pour ce que PR C change), l'espace salarié en ligne (décision 8 : reporté), l'API Emplois de l'inclusion (décision 6).

---

## 1. Propriété des fichiers (DISJOINTE — aucun fichier dans deux lots)

### 1.1 Pré-câblé par l'orchestrateur AVANT le lancement des lots (ne pas retoucher sauf mention)
| Fichier | Ce qui est posé |
|---|---|
| `backend/src/routes/insertion/index.js` | `router.use('/echeances', require('./echeances'));` et `router.use('/salarie', require('./salarie'));` montés AVANT `routes.js` (comme `/rsa`, `/temps`) |
| `backend/src/index.js` | `app.use('/api/eti', rateLimit({ windowMs: 15*60*1000, max: 60, ... }), require('./routes/insertion/eti-public'));` — **routeur SANS `authenticate`**, monté à côté de `/api/insertion` |
| `backend/src/scripts/init-db.js` | après `insertion-temps` : `await require('./migrations/insertion-echeances').run(client); await require('./migrations/insertion-salarie').run(client);` |
| `backend/src/utils/insertion-settings.js` | les clés du § 4 (lot 5 ET lot 7) avec leurs défauts et leur commentaire |
| `frontend/src/utils/rgpd-libelles.js` | TOUS les codes du § 7 (la garde anti-dérive Jest tombe sinon) |
| `frontend/src/App.jsx` | lazy `EtiRenouvellement` + route **publique** `/eti/renouvellement/:token` (hors `ProtectedRoute`, à côté de `/enquete/:token`) ; la route `/insertion/renouvellement/:milestoneId` **reste** (redirection / lien copié) |
| `frontend/src/pages/InsertionParcours.jsx` | points d'ancrage des composants du lot 7 (imports + `<DocumentsSalariePanel employee={…} />` sous les PMSMP de l'onglet Synthèse actuel + `<RappelsConsentement employee={…} />` dans `DossierAdministratif` via prop `extra`, + deux entrées « Mon parcours en une page » / « Mon Récap » dans le menu « Fiche PDF ▾ » qui appellent `pdf-salarie.js`). Le lot 5 **déplace** ces ancrages avec les onglets mais ne les supprime pas. |
| Squelettes | `routes/insertion/echeances.js`, `routes/insertion/salarie.js`, `routes/insertion/eti-public.js`, `migrations/insertion-echeances.js`, `migrations/insertion-salarie.js`, `services/echeances-cip.js`, `services/mon-parcours.js`, `services/rappels-rdv.js`, `frontend/src/pages/EtiRenouvellement.jsx`, `frontend/src/components/insertion/DocumentsSalariePanel.jsx`, `RappelsConsentement.jsx`, `pdf-salarie.js` — chacun avec un en-tête qui renvoie à ce contrat et un export minimal (le build et le `require` passent avant que les lots commencent) |

### 1.2 Lot 5 — agent `cip`
**Backend (crée)** : `routes/insertion/echeances.js`, `routes/insertion/eti-public.js`, `services/echeances-cip.js`, `scripts/migrations/insertion-echeances.js`, `tests/contract/insertion-echeances-contract.test.js`, `tests/contract/insertion-eti-public-contract.test.js`, `tests/contract/insertion-liste-contract.test.js`, `tests/unit/services/echeances-cip.test.js`, `tests/unit/migrations/insertion-echeances.test.js`.
**Backend (modifie)** : `routes/insertion/routes.js` — UNIQUEMENT : `GET /` (file active § 5.2), `GET /renouvellements` (+ `lien_eti`, `eti_expire_le`), nouvelle route `POST /renouvellements/:milestoneId/lien-eti`, extraction éventuelle d'un helper `cumulCddiMois` vers `services/echeances-cip.js` sans changer son résultat ; `routes/insertion/rsa.js` — UNIQUEMENT l'extraction du calcul de `GET /echeances-periodiques` vers `services/echeances-cip.js` (la route garde sa forme de réponse, ses tests existants restent verts).
**Frontend (modifie)** : `pages/InsertionParcours.jsx`, `pages/Employees.jsx`, `pages/RenouvellementETI.jsx` (devient : « ce lien est réservé aux comptes ; copiez le lien public » + le formulaire existant conservé pour les comptes), `pages/AdminInsertion.jsx` (accueille la sonde IA — bloc déplacé depuis l'onglet Assistant IA), `components/Layout.jsx` (compteur), `components/insertion/DiagnosticForm.jsx` (socle 7 rubriques + approfondissements), `components/insertion/DossierAdministratif.jsx` (prop `extra` rendue en bas ; rien d'autre), `components/insertion/RadarFreins.jsx` si besoin.
**Frontend (crée)** : `pages/EtiRenouvellement.jsx`, `components/insertion/EcheancesPanel.jsx`, `components/insertion/FileActive.jsx`, `components/insertion/FreinsDeltas.jsx`, `components/insertion/OngletSituation.jsx`, `components/insertion/OngletSuivi.jsx` (découpage libre, ces noms sont indicatifs — le seul impératif est que `InsertionParcours.jsx` **diminue** de taille, pas qu'il grossisse).
**Rapport** : `rapports/cip-refonte-2026-09-12/21-realisation-lot5.md`.

### 1.3 Lot 7 — agent `salarie`
**Backend (crée)** : `routes/insertion/salarie.js`, `services/mon-parcours.js` (compose AUSSI « Mon Récap »), `services/rappels-rdv.js`, `scripts/migrations/insertion-salarie.js`, `tests/contract/insertion-salarie-contract.test.js`, `tests/unit/services/mon-parcours.test.js`, `tests/unit/services/rappels-rdv.test.js`, `tests/unit/migrations/insertion-salarie.test.js`.
**Backend (modifie)** : `services/scheduler.js` (job `envoyerRappelsRdvSalaries` + branchement horaire § 6.4), `routes/monitoring.js` (`JOB_SCHEDULE`), `services/anonymization.js` (§ 8), `routes/rgpd.js` **uniquement** si une règle doit apparaître dans `GET /rgpd/politique` (rétention des rappels).
**Frontend (crée / remplit les squelettes)** : `components/insertion/DocumentsSalariePanel.jsx`, `components/insertion/RappelsConsentement.jsx`, `components/insertion/pdf-salarie.js`.
**Rapport** : `rapports/cip-refonte-2026-09-12/21-realisation-lot7.md`.

### 1.4 Interdits communs
- Aucun lot ne touche `init-db.js`, `index.js`, `insertion/index.js`, `App.jsx`, `insertion-settings.js`, `rgpd-libelles.js` (pré-câblés). Un manque → le signaler dans le rapport, l'orchestrateur l'ajoute.
- Aucun lot ne touche `CLAUDE.md`, `docs/`, les rapports d'un autre lot, `cadre.js`, `fse.js`, `conformite.js`, `temps.js`, `fiche-referent.js`, `exports*.js`.
- Le lot 7 ne touche pas `InsertionParcours.jsx` ni `routes.js` ; le lot 5 ne touche pas `scheduler.js`, `anonymization.js`, `notification.js`.

---

## 2. Doctrines (rappel, opposables aux deux lots)
1. **Jamais de valeur inventée** : `null` n'est jamais 0 ; une source absente est NOMMÉE.
2. **Refus AVANT toute lecture** : `authorize` / garde de rôle / garde de jeton posés avant la première requête.
3. **`pool.connect()` DANS le `try`, `release()` dans le `finally`** (défaut corrigé deux fois, PR A et PR B — un test exerce `pool.connect()` en échec).
4. **Journal RGPD** : les lectures de documents personnels et toute génération/remise sont journalisées ; pour un document qui SORT (remis à la personne, envoyé par Brevo) la journalisation est **bloquante** (elle échoue → la remise n'a pas lieu).
5. **Liste blanche serveur** pour tout document destiné à la personne ou à un tiers : le contenu est composé champ par champ ; **jamais** de santé (art. 9), de judiciaire (art. 10), de statut social (BRSA, catégorie FT), de notes de suivi, de note de profil, de texte libre de la CIP, et **sans mention** de ce qui est exclu.
6. **Jamais le mot « seuil »** ni « 15 h » présenté au salarié (décision 4, amendement CIP) : « Mon parcours » affiche ses heures, pas une cible.
7. **Dates civiles par `utils/date-iso.js`** (`aujourdhuiParis`, `jourParis`, `decalerJours`…) et conversions par PostgreSQL — jamais `toISOString().slice(0,10)` sur une date civile, jamais `getHours()` sur l'heure de Paris.
8. **Migrations idempotentes** appelées DANS la transaction d'`init-db` (`client.query` seulement, IF NOT EXISTS, DO-scan `pg_constraint`, entrée registre gardée par NOT EXISTS), rejouables deux fois.
9. **Pseudonymisation** avant toute IA (inchangé ; PR C n'ajoute aucun appel IA).
10. **Français** à l'écran, FALC sur les écrans destinés à l'ETI et à la personne.
11. **Aucune nouvelle dépendance** npm.

---

## 3. Schéma (DDL figée)

### 3.1 `migrations/insertion-echeances.js` (lot 5)
```sql
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS eti_token VARCHAR(32);
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS eti_token_expires_at TIMESTAMP;
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS eti_token_generated_by INTEGER REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_insertion_milestones_eti_token ON insertion_milestones(eti_token) WHERE eti_token IS NOT NULL;

-- Report 48 h d'une obligation (jamais un acquittement 7 j : ce sont les lignes
-- que l'autorité contrôle). Une ligne PAR report ; nb = COUNT sur (employee_id, type, parcours courant).
CREATE TABLE IF NOT EXISTS insertion_echeance_reports (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  echeance_type VARCHAR(40) NOT NULL,
  reporte_jusqu_au TIMESTAMP NOT NULL,
  motif VARCHAR(30),                       -- NULL au 1er report ; liste fermée § 5.1.3 à partir du 2e
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insertion_echeance_reports_emp ON insertion_echeance_reports(employee_id, echeance_type, reporte_jusqu_au DESC);
```
Aucune entrée registre art. 30 (les traitements existants couvrent ; l'ETI à jeton est un mode d'accès au traitement « accompagnement socio-professionnel »).

### 3.2 `migrations/insertion-salarie.js` (lot 7)
```sql
-- Consentement aux rappels de RDV (art. 6-1-a : consentement, révocable, tracé).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_consent BOOLEAN;             -- NULL = jamais demandé
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_canal VARCHAR(5);             -- 'sms' | 'email'
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_destinataire VARCHAR(255);    -- numéro ou adresse CHOISIS par la personne
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_consent_at TIMESTAMP;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rappel_rdv_consent_by INTEGER REFERENCES users(id);
-- CHECK canal par DO-scan : rappel_rdv_canal IS NULL OR IN ('sms','email')

-- Documents composés POUR la personne (liste blanche), snapshot = preuve de ce qui a été remis.
CREATE TABLE IF NOT EXISTS insertion_documents_salarie (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  parcours_num INTEGER NOT NULL DEFAULT 1,
  type VARCHAR(20) NOT NULL CHECK (type IN ('mon_parcours','mon_recap')),
  contenu JSONB NOT NULL,
  genere_par INTEGER REFERENCES users(id),
  genere_le TIMESTAMP NOT NULL DEFAULT NOW(),
  remis_le DATE,
  remis_mode VARCHAR(15) CHECK (remis_mode IS NULL OR remis_mode IN ('main_propre','email','courrier')),
  remis_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_insertion_documents_salarie_emp ON insertion_documents_salarie(employee_id, type, genere_le DESC);

-- Trace des rappels envoyés (un rappel au plus par entretien).
CREATE TABLE IF NOT EXISTS insertion_rappels_rdv (
  id SERIAL PRIMARY KEY,
  milestone_id INTEGER NOT NULL REFERENCES insertion_milestones(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  canal VARCHAR(5) NOT NULL,
  destinataire_masque VARCHAR(60) NOT NULL,       -- « 06 ** ** ** 12 » / « j***@gmail.com » — jamais le contact en clair
  statut VARCHAR(10) NOT NULL CHECK (statut IN ('envoye','echec','dry_run')),
  erreur TEXT,
  envoye_le TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(milestone_id)
);

-- Gabarits Brevo seedés (message_templates, category 'insertion_rappel_rdv'), gardés par NOT EXISTS :
--  sms   : « Bonjour {prenom}, rappel : vous avez rendez-vous demain {date} à {heure} avec {cip} à Solidarité Textiles. En cas d'empêchement, prévenez-nous. »
--  email : subject « Rappel de votre rendez-vous de demain », même corps.
-- INTERDIT dans un gabarit : le type d'entretien, le motif, tout élément du parcours.

-- Registre art. 30 (NOT EXISTS) : « Insertion — rappels de rendez-vous au salarié (SMS / e-mail) », base légale consentement, sous-traitant Brevo, rétention = celle de la trace (insertion.rappels_retention_jours, 365).
```

---

## 4. Réglages (`utils/insertion-settings.js`, pré-câblés ; défauts EN CODE, aucun seed)
| Clé | Défaut | Lot | Usage |
|---|---|---|---|
| `insertion.eti_token_validite_jours` | 60 | 5 | validité du jeton ETI (amendement : 60 j, le bloc renouvellements anticipe à 42 j) |
| `insertion.report_echeance_heures` | 48 | 5 | durée d'un report d'obligation |
| `insertion.file_active_terminees_mois` | 7 | 5 | terminés depuis < N mois restent dans la file (sortie à saisir + relevé +6 mois) |
| `insertion.categorie_g_alerte_jours` | 30 | 5 | catégorie FT = G depuis > N j → ligne ORANGE |
| `insertion.rappel_rdv_heure_envoi` | 18 | 7 | heure de Paris de l'envoi des rappels J-1 (job horaire : envoi quand `heureParis === valeur`) |
| `insertion.rappels_retention_jours` | 365 | 7 | purge de `insertion_rappels_rdv` (job de purge existant `services/rgpd-purges.js` : **10ᵉ purge**, `purgeRappelsRdv`) |

Déjà existants et réutilisés : `delai_diagnostic_jours` 30, `alerte_pass_iae_mois` 7, `renouvellement_anticipation_jours` 42, `post_sortie_mois` 6, `alerte_sortie_fse_j1/j2` 15/25, `cer_heures_min` 15, `semaines_sous_seuil_consecutives` 2, `point_etape_referent_mois` 3.

---

## 5. API (formes de réponse figées)

### 5.1 Lot 5 — `GET /api/insertion/echeances` (`routes/insertion/echeances.js`, ADMIN/RH/MANAGER)
Un seul appel pour l'écran « Mes échéances ». Calcul dans `services/echeances-cip.js` (`composerEcheances({ role, userId, mine })`), chaque source en `soft()` : une requête qui échoue vide SON bloc et le nomme dans `sources_indisponibles[]`, jamais 500.

```jsonc
{
  "genere_le": "2026-09-13T08:00:00.000Z",
  "obligations": [ /* § 5.1.1 — tri : rouge avant orange, puis échéance croissante */ ],
  "organisation": [ /* bilans en retard, RDV non planifié, renouvellements < 42 j (avec lien_eti), actions critiques en retard — acquittables 7 j par l'ack existant */ ],
  "rendez_vous_reguliers": { /* forme EXACTE de GET /insertion/rsa/echeances-periodiques (extrait vers le service) ; null pour MANAGER */ },
  "file_active": { "en_parcours": 0, "retards": 0, "a_venir_7j": 0, "sorties_dynamiques_pct": null, "sorties": {"dynamiques":0,"total":0}, "objectif_sorties": null, "completude_fse_asi_pct": null },
  "compteur_rouges": 0,           // obligations rouges NON reportées — c'est la pastille de la barre latérale
  "reportees": [ /* obligations reportées, avec reporte_jusqu_au et nb_reports — affichées grisées en bas du bloc */ ],
  "sources_indisponibles": []
}
```
**5.1.1 Forme d'une échéance** : `{ id: "<type>:<employee_id>", type, niveau: 'rouge'|'orange', employee_id, nom: "NOM Prénom", libelle, echeance: "YYYY-MM-DD"|null, jours: int|null, cible: { onglet: 'dossier'|'diagnostic'|'suivi'|'situation', champ: string|null }, nb_reports: 0 }`. Ligne agrégée (sans salarié) : `employee_id: null`, `nom: null`, `detail: [{employee_id, nom}]` (ADMIN/RH seulement).

**5.1.2 Types d'obligations (liste fermée, `TYPES_OBLIGATIONS` exporté)** :
| type | règle | niveau | rôles |
|---|---|---|---|
| `sortie_fse_a_saisir` | participant ASI dont le parcours est terminé (ou contrat fini) sans `insertion_fse_sorties` : J+`alerte_sortie_fse_j1` → orange, J+`alerte_sortie_fse_j2` → rouge (délai compté depuis la sortie de l'opération, comme PR A) | orange/rouge | ADMIN/RH |
| `pass_iae` | `pass_iae_statut` expiré ou suspendu → rouge ; fin < 2 mois → orange | | tous |
| `cddi_plafond` | cumul CDDI ≥ 23 mois sans `cddi_derogation_motif` → rouge | | tous |
| `diagnostic_socle` | pas de diagnostic « socle complet » (§ 5.5) > `delai_diagnostic_jours` après `insertion_start_date` → rouge | | tous |
| `fse_entree_manquant` | participant ASI, `insertion_diagnostics.fse_entree_complet` faux → orange ; > 30 j → rouge | | ADMIN/RH |
| `categorie_g` | `ft_categorie = 'G'` depuis > `categorie_g_alerte_jours` → **orange, jamais rouge** (seul le référent peut la changer) | orange | ADMIN/RH |
| `suivi_6_mois` | jalon `suivi_post_sortie` échu non réalisé → rouge | | tous |
| `referent_unique` | `referent_unique_type` NULL ou `non_determine` → rouge | | tous |
| `sous_15h` | **ligne agrégée** « N salariés sous 15 h » (réutilise `activiteHebdoCohorte` — alerte à 2 semaines consécutives relevées hors arrêt) → rouge | | ADMIN/RH |

MANAGER : types sociaux exclus **avant toute requête** (les fonctions ne sont pas appelées), périmètre identique à la file active. `?mine=1` : salariés dont `cip_referent_user_id = req.user.id`.

**5.1.3 Report** — `POST /api/insertion/echeances/report` `{ employee_id, type, motif? }` (ADMIN/RH ; MANAGER refusé 403 : reporter une obligation est un acte de la CIP) :
- `type` ∉ `TYPES_OBLIGATIONS` ou ligne agrégée → 400 ; salarié inconnu → 404.
- 1er report : motif facultatif ; **2e report et suivants : motif OBLIGATOIRE** (409 `MOTIF_REQUIS` sinon) parmi `MOTIFS_REPORT = ['attente_piece','attente_referent','personne_absente','rdv_planifie','autre']`.
- Report = `NOW() + report_echeance_heures` ; réponse `{ reporte_jusqu_au, nb_reports }` ; journal RGPD `INSERTION_ECHEANCE_REPORT`.
- Un report en cours → la ligne sort d'`obligations`, entre dans `reportees`, sort du `compteur_rouges`.

**5.1.4 Compteur** — `GET /api/insertion/echeances/compteur` → `{ rouges: int }` (même calcul, projection minimale, sans les listes ; **cache mémoire 60 s par (rôle, userId)** — la barre latérale l'appelle à chaque montage).

### 5.2 Lot 5 — file active `GET /api/insertion` (`routes.js`, modifiée)
- **Périmètre par défaut** : `insertion_status = 'en_parcours'` OU (`insertion_status = 'termine'` ET `insertion_end_date >= CURRENT_DATE - file_active_terminees_mois mois`). `?inclure=tous` → tous les `insertion_status <> 'none'`. **Les permanents (`none`) ne sont JAMAIS renvoyés.** `is_active` n'est plus un filtre (un sorti est inactif et doit rester visible 7 mois).
- Champs ajoutés par ligne : `insertion_status, insertion_start_date, insertion_end_date, parcours_num, cip_referent_user_id, cip_referent_nom, prochain_rdv: {date, heure|null, type}|null, dernier_entretien: date|null, risque: 'rouge'|'orange'|null` (dérivé des obligations du salarié — **même fonction** `niveauRisqueSalarie` du service, jamais une seconde règle), `projets: ['ASI'|'OCS']`, `pass_iae_statut`, `pass_iae_end`, `referent_unique_type`, `brsa` (**ADMIN/RH ; `null` pour MANAGER, colonne non lue**), `has_diagnostic`, `diagnostic_socle_complet`, `contract_end_date`, `urgency` (conservé).
- Tri : `UPPER(last_name), UPPER(first_name)` (inchangé). Les filtres sont **côté client** (`FileActive.jsx`) : En parcours / Terminés · Mes salariés · Projet ASI / OCS · BRSA (ADMIN/RH) · Sans diagnostic · Sans RDV planifié · Fin de contrat < 60 j · Risque.
- Test de contrat : un MANAGER ne reçoit jamais `brsa` (colonne absente de la requête, pas masquée après lecture — même correctif que C-03 PR A).

### 5.3 Lot 5 — ETI à jeton public
**Génération (authentifiée)** — `POST /api/insertion/renouvellements/:milestoneId/lien-eti` (`routes.js`) : ADMIN/RH, ou MANAGER **propriétaire** (`managerOwnsEmployee`). Entretien non `renouvellement` → 400 ; verrouillé → 409. Génère `eti_token = hex 32` (`crypto.randomBytes(16)`) + `eti_token_expires_at = NOW() + eti_token_validite_jours`, **remplace** un jeton existant (l'ancien lien meurt — c'est le mode de révocation), journal `INSERTION_ETI_LIEN_GENERATION`. Réponse `{ lien: "<PUBLIC_BASE_URL>/eti/renouvellement/<token>", expire_le }`. `GET /renouvellements` expose `entretien.lien_eti` (null si absent ou expiré) et `entretien.eti_expire_le`.

**Public (SANS authentification)** — `routes/insertion/eti-public.js`, monté `/api/eti` **hors** `authenticate` (pattern `/api/enquetes/public/:token`), rate-limité :
- `GET /api/eti/renouvellement/:token` (param hex 32 sinon 404) → jeton inconnu → **404 uniforme** ; expiré ou entretien verrouillé (`locked_at`) → **410** `{ code: 'LIEN_EXPIRE' | 'ENTRETIEN_CLOTURE' }` ; sinon `{ prenom, nom, poste, contract_end, formulaire: {…renouvellement_form}, avis, duree_mois, expire_le, lecture_seule: false }`. **Rien d'autre** : ni freins, ni statut, ni référent, ni dates de parcours.
- `PUT /api/eti/renouvellement/:token` : même validation de corps que `PUT /renouvellements/:id/formulaire` (3 champs seulement, 400 `champs_refuses`), mêmes 404/410, écrit les 3 champs + `validations` ← `{ role:'eti', mode:'jeton', at, token_prefix: token.slice(0,6) }`, snapshot si `realise` (réutiliser `snapshotMilestone` **exporté** depuis `routes.js` ou déplacé dans un helper du lot 5), journal RGPD `INSERTION_ETI_FORMULAIRE_JETON` (`user_id` NULL, détails `{ milestone_id, token_prefix, ip }`). Réponse `{ ok: true }` — **jamais la ligne complète** (un MANAGER connecté reçoit `maskInsertionRow`, un anonyme ne reçoit rien).
- Aucune de ces deux routes ne renvoie `employee_id`.

### 5.4 Lot 5 — frontend (formes contractuelles)
- `InsertionParcours.jsx` : vue par défaut = **Mes échéances** (`EcheancesPanel`) ; ordre des blocs **Aujourd'hui / Cette semaine → À traiter cette semaine — obligations → Organisation du suivi → Rendez-vous réguliers et rappels → Ma file active** ; un bloc vide reste affiché avec une phrase verte (« Rien à traiter cette semaine. »). `EcheancesRsaBloc` (PR B) devient le bloc « Rendez-vous réguliers et rappels » alimenté par `rendez_vous_reguliers` (un seul appel). Report : bouton « Reporter 48 h » sur chaque obligation ; au 2e report, `Modal` avec liste fermée de motifs.
- File active à gauche (`FileActive.jsx`) : recherche + filtres du § 5.2 ; ligne = NOM Prénom · prochain RDV · pastille de risque · badges BRSA (ADMIN/RH) / ASI / OCS ; sous `md`, sélecteur repliable en tête.
- Fiche : 4 onglets **Situation / Suivi / Dossier administratif / Diagnostic** (ordre figé). **Situation** : `AlertesBloc` → **Freins : `RadarFreins` + `FreinsDeltas`** (entrée → dernière évaluation, badge levé / stable / aggravé par axe, judiciaire absent pour MANAGER — source `GET /milestones/:id/radar`) → **Note de profil initial** (ADMIN/RH) → frise (`FriseParcours`, repliée « Voir le détail ») → `ChecklistEmbauche` (tant qu'incomplète) → `PmsmpPanel` → `SatisfactionForm` (si bilan de sortie) → **`DocumentsSalariePanel` (lot 7)** → bouton **« Proposition de synthèse (IA) »** (ex-« Analyser le profil », ADMIN/RH) avec son résultat. **Suivi** : entretiens & bilans (existant) → objectifs → actions → notes de suivi (ADMIN/RH) → `CompetencesETI` (encart repliable) → « Préparer l'entretien (IA) » (ADMIN/RH). **Dossier administratif** : `DossierAdministratif` existant + `extra = <RappelsConsentement>` (lot 7) en bas. **Diagnostic** : § 5.5. L'onglet « Assistant IA » disparaît ; la **sonde IA** (« Tester la connexion IA ») va dans `AdminInsertion` (ADMIN).
- `Modal` et `ConfirmDialog` partagés remplacent **tous** les `window.confirm` / `alert()` de `InsertionParcours.jsx`, `Employees.jsx` (onglet insertion), `RenouvellementETI.jsx`, `DiagnosticForm.jsx` (grep = 0 à la livraison).
- `Employees.jsx` onglet « Parcours insertion » → **résumé** : statut, parcours n°, CIP référent, référent unique (type), prochain RDV, dernier entretien, risque, « Ouvrir dans l'espace CIP ». Les panneaux détaillés (objectifs, actions, notes, compétences, frise, checklist, note de profil) **quittent** cette fiche (un seul chemin, REC-UX-12).
- `Layout.jsx` : `counts['/insertion'] = rouges` via `GET /insertion/echeances/compteur` (ADMIN/RH/MANAGER seulement, best-effort, silencieux).
- `EtiRenouvellement.jsx` (public) : FALC, gros contrôles, mêmes 3 échelles + participation + motifs + avis + durée que `RenouvellementETI.jsx` (**extraire le formulaire en composant partagé `components/insertion/FormulaireETI.jsx`** utilisé par les deux pages) ; états 404 (« Ce lien n'est pas valide »), 410 (« Ce lien a expiré / l'entretien est clôturé — demandez un nouveau lien à la CIP »), succès (« Merci ! Votre avis a été transmis »). Aucune donnée en dehors de § 5.3.
- `RenouvellementsBloc` : « Copier le lien » copie le **lien public** (le génère s'il manque via `POST …/lien-eti`), affiche « expire le … ».

### 5.5 Lot 5 — diagnostic : socle J+30 et approfondissements (`DiagnosticForm.jsx`)
`STEPS` réorganisé en **deux groupes** : `SOCLE` (7 rubriques, dans cet ordre) — 1 Cadre administratif & éligibilité (résumé en lecture depuis le dossier administratif : Pass IAE, référent, prescripteur + champs `piece_identite_validite`, `allocataire_caf`, `ressources`), 2 Logement, 3 Santé (minimum : `mutuelle_statut`, `rqth`, `contre_indications`, `suivi_sante` — sensible), 4 Mobilité, 5 Situation & projet professionnels (+ `cecrl_niveau`), 6 Expression du salarié + 9 freins, **7 Questionnaire FSE+ d'entrée** (pré-rempli par déduction, existant PR A — la CIP confirme ou corrige) ; `APPROFONDISSEMENTS` (repliés sous le socle, jamais dans la complétude) — Parcours & famille détaillé, Budget détaillé, Portefeuille & AFOM, Style d'apprentissage, Projet de formation / COA. **Complétude du socle** = `diagnostic_socle_complet` (booléen calculé **côté client** sur les champs du socle ET renvoyé par `GET /insertion` via une règle SQL équivalente documentée dans `echeances-cip.js` — les deux DOIVENT désigner les mêmes champs : constante `CHAMPS_SOCLE` exportée par le service et recopiée à l'identique dans le front, test unitaire qui compare les deux listes par un fichier JSON partagé `backend/src/data/diagnostic-socle-champs.json` importé des deux côtés). Rien n'est bloquant. MANAGER : rubrique FSE+ retirée (inchangé).

### 5.6 Lot 7 — `routes/insertion/salarie.js` (ADMIN/RH strict — les documents portent le référent unique et les heures ; un MANAGER n'y accède pas)
| Route | Effet |
|---|---|
| `GET /:employeeId/mon-parcours` | **aperçu** composé à la volée (`composerMonParcours`) — journal `INSERTION_DOC_SALARIE_APERCU` ; ne crée rien |
| `POST /:employeeId/mon-parcours` | **génération enregistrée** : snapshot dans `insertion_documents_salarie` (type `mon_parcours`), journal `INSERTION_DOC_SALARIE_GENERATION` (bloquant, dans la transaction), réponse `{ id, contenu, genere_le }` → le front imprime DEPUIS `contenu` |
| `GET /:employeeId/mon-recap` / `POST /:employeeId/mon-recap` | idem, type `mon_recap` |
| `GET /:employeeId/documents` | liste `{ id, type, genere_le, genere_par_nom, remis_le, remis_mode }` (sans contenu) |
| `GET /:employeeId/documents/:id` | contenu d'un document déjà généré — journal `INSERTION_DOC_SALARIE_CONSULTATION` ; 404 si le document n'appartient pas au salarié |
| `PUT /:employeeId/documents/:id/remise` | `{ remis_le: 'YYYY-MM-DD', remis_mode }` → trace, journal `INSERTION_DOC_SALARIE_REMISE` (bloquant) ; une remise déjà tracée → 409 |
| `GET /:employeeId/rappels-consentement` | `{ consent: null|true|false, canal, destinataire_masque, consent_at, consent_par_nom, contacts_disponibles: { phone_masque, email_masque, personal_email_masque } }` |
| `PUT /:employeeId/rappels-consentement` | `{ consent: true, canal, destinataire }` ou `{ consent: false }` → colonnes `employees.rappel_rdv_*` + upsert `rgpd_consents(entity_type='employee', entity_id, consent_type='rappel_rdv', granted, recorded_by)` ; journal `INSERTION_RAPPEL_CONSENTEMENT` ; `destinataire` validé (E.164/FR pour sms, e-mail pour email) — 400 sinon |
| `GET /:employeeId/rappels` | historique `insertion_rappels_rdv` du salarié (destinataire masqué) |

**5.6.1 Contenu de « Mon parcours en une page »** (`services/mon-parcours.js`, liste blanche, FALC, **tout champ absent est `null` et le PDF l'écrit « pas encore renseigné »**) :
```jsonc
{
  "personne": { "prenom", "nom" },
  "structure": { "nom": "Solidarité Textiles", "cip_nom": "Prénom N." },
  "mes_engagements": [ { "titre", "echeance" } ],              // insertion_objectifs origine='salarie' statut en cours (titre = texte co-construit AVEC la personne ; 120 car. max)
  "engagements_structure": [ { "categorie_libelle", "partenaire_nom", "echeance" } ],  // cip_action_plans en cours — CATÉGORIE (liste fermée) + partenaire, JAMAIS le libellé libre
  "mes_heures_semaine": { "semaine": "2026-W37", "travail_h": 26.0, "accompagnement_h": 1.5, "total_h": 27.5 } | null,   // dernière semaine RELEVÉE (activite-hebdo-engine) ; null si aucun relevé ; AUCUNE cible, AUCUN seuil, AUCUNE alerte
  "prochain_rdv": { "date", "heure", "avec": "Prénom N." } | null,                    // jamais le type d'entretien
  "mon_referent": { "type_libelle": "France Travail", "nom", "contact" } | null,     // referent_unique_* ; « non déterminé » → null + phrase « votre référent vous sera indiqué »
  "mes_documents_remis": [ { "libelle", "date" } ],           // insertion_pieces type entretien_signe/convention_pmsmp/accuse_remise + alimentations_referent remises à la personne + documents_salarie remis
  "genere_le"
}
```
**5.6.2 Contenu de « Mon Récap »** (partageable par la personne à un tiers de SON choix — **aucun texte libre**, aucune donnée art. 9/10, aucun statut social) :
```jsonc
{
  "personne": { "prenom", "nom" },
  "structure": { "nom", "activite": "collecte, tri et valorisation de textiles" },
  "contrats": [ { "type": "CDDI", "poste", "du", "au", "heures_hebdo" } ],
  "etapes": [ { "date", "type": "entretien"|"pmsmp"|"formation"|"action"|"evaluation", "libelle" } ],  // libellé = type d'entretien (liste fermée), PMSMP (organisme + dates + objet), action = catégorie + partenaire, évaluation de compétences = filière + moyenne /10 (jamais les items)
  "objectifs": { "atteints": 0, "en_cours": 0 },              // compteurs seulement
  "sortie": { "date", "classification_libelle", "type_libelle" } | null,
  "genere_le"
}
```
**Interdits prouvés par test** : aucune clé parmi `frein_*`, `sante`, `judiciaire`, `brsa`, `ft_categorie`, `note`, `observations`, `commentaire*`, `motif*`, `presence`, `absence*`, `bilan_*`, `avis_*`, `description` dans la sérialisation JSON de l'un ou l'autre document.

### 5.7 Lot 7 — rappels J-1 (`services/rappels-rdv.js` + job `envoyerRappelsRdvSalaries`)
- Sélection : entretiens `status = 'planifie'` avec `interview_date` **le jour civil de Paris de DEMAIN** (calcul par PostgreSQL : `(interview_date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date = (date de demain à Paris)`), salarié `rappel_rdv_consent = true` et `is_active`, sans ligne dans `insertion_rappels_rdv` pour ce `milestone_id`.
- Envoi par `services/notification.js` `sendNotification(template, email|null, phone|null, variables)` avec le gabarit `message_templates` de catégorie `insertion_rappel_rdv` et du bon type ; variables `{prenom, date, heure, cip}` — **`cip` = prénom + initiale** ; `heure` absente → « (heure à confirmer avec votre conseillère) ».
- Trace **avant** l'envoi (INSERT statut provisoire puis UPDATE) ? Non : INSERT après l'appel avec `statut` `envoye` / `echec` (`erreur` = message tronqué 200) / `dry_run` (pas de clé Brevo) ; l'UNIQUE(milestone_id) empêche le doublon même si deux ticks se chevauchent (23505 attrapé = « déjà envoyé »).
- Reprogrammation d'un entretien (nouvelle `interview_date`) → l'ancien rappel reste tracé, **aucun second envoi** (UNIQUE) : documenter la limite ; PR D pourra lever la contrainte si la CIP le demande.
- Journal RGPD `INSERTION_RAPPEL_ENVOI` par envoi (détails : milestone_id, canal, destinataire masqué — jamais le contact).
- Branchement (`scheduler.js`) : dans le tick horaire, **quand l'heure de Paris courante == `rappel_rdv_heure_envoi`** (helper local `heureParis(now)` par `Intl`, DST géré — même patron que `shouldRunAutoBackup`), `runInstrumented('envoyerRappelsRdvSalaries', …)` ; `JOB_SCHEDULE` (`routes/monitoring.js`) : quotidien, tolérance 26 h. Test unitaire : sous `TZ=UTC` et `TZ=Europe/Paris`, 18 h Paris été/hiver déclenchent, 17 h et 19 h non.
- Purge : `purgeRappelsRdv` ajoutée à `PURGES_RGPD` (`services/rgpd-purges.js`, seuil `insertion.rappels_retention_jours`) — **si** le registre exige une modification hors périmètre du lot 7, le lot 7 est autorisé à modifier `services/rgpd-purges.js` (ajout d'une entrée, forme identique aux 9 existantes).

---

## 6. Front — composants du lot 7 (formes)
- `DocumentsSalariePanel.jsx` (`{ employee }`, ADMIN/RH — non rendu sinon) : liste des documents générés (type, date, généré par, remise), boutons « Mon parcours en une page » et « Mon Récap » → `POST` puis `pdf-salarie.exportMonParcoursPDF(contenu)` / `exportMonRecapPDF(contenu)` ; sur chaque ligne « Tracer la remise » (`Modal` : date + mode) ; « Aperçu » (GET, sans enregistrement) ; « Réimprimer » (GET documents/:id). Erreurs en bandeau, jamais `alert()`.
- `RappelsConsentement.jsx` (`{ employee }`, ADMIN/RH) : état actuel (« Jamais demandé » / « Accepté le … par SMS au 06 ** ** ** 12 » / « Refusé le … »), formulaire : canal + destinataire choisi parmi les contacts masqués OU saisi, phrase d'information FALC à lire à la personne (« Vous recevrez un message la veille de chaque rendez-vous. Vous pouvez arrêter quand vous voulez. Le message ne dit jamais pourquoi vous avez rendez-vous. »), bouton « Retirer le consentement ». Historique des rappels envoyés (masqués).
- `pdf-salarie.js` : `openPrintWindow` de `pdf-insertion.js` réutilisé ; **« Mon parcours en une page » tient sur UNE page A4** (police ≥ 12 pt, 6 encadrés, pictogrammes texte, phrases courtes, tutoiement refusé → vouvoiement simple) ; « Mon Récap » = A4 portrait, une ou deux pages, en-tête neutre (pas de logo autre que le nom de la structure), mention « Document établi à la demande de la personne — ne contient aucune information de santé, de justice ni de situation sociale ». Le contenu rendu vient **exclusivement** de l'objet `contenu` du serveur.

---

## 7. Codes RGPD (pré-câblés dans `rgpd-libelles.js` ; la garde anti-dérive exige chacun)
| Code | Libellé | Lot |
|---|---|---|
| `INSERTION_ECHEANCES_CONSULTATION` | Consultation des échéances CIP (obligations et suivi) | 5 |
| `INSERTION_ECHEANCE_REPORT` | Report d'une obligation (48 h) | 5 |
| `INSERTION_ETI_LIEN_GENERATION` | Génération d'un lien public pour l'encadrant technique (renouvellement) | 5 |
| `INSERTION_ETI_FORMULAIRE_JETON` | Avis de l'encadrant transmis par lien public (sans compte) | 5 |
| `INSERTION_DOC_SALARIE_APERCU` | Aperçu d'un document pour le salarié (sans enregistrement) | 7 |
| `INSERTION_DOC_SALARIE_GENERATION` | Génération d'un document pour le salarié (Mon parcours / Mon Récap) | 7 |
| `INSERTION_DOC_SALARIE_CONSULTATION` | Consultation d'un document déjà remis au salarié | 7 |
| `INSERTION_DOC_SALARIE_REMISE` | Remise tracée d'un document au salarié | 7 |
| `INSERTION_RAPPEL_CONSENTEMENT` | Recueil ou retrait du consentement aux rappels de rendez-vous | 7 |
| `INSERTION_RAPPEL_ENVOI` | Envoi d'un rappel de rendez-vous au salarié (SMS / e-mail) | 7 |

Journalisation : helper `journaliser(req, action, employeeId, details)` de `rsa.js` — **à extraire** dans `backend/src/utils/insertion-journal.js` par le **lot 5** (qui touche `rsa.js`) ; le lot 7 l'importe s'il existe, sinon recopie la fonction (6 lignes) en attendant l'intégration — l'orchestrateur dédoublonne.

---

## 8. Anonymisation (`services/anonymization.js`, lot 7)
- `insertion_documents_salarie` : DELETE (documents remis à la personne, aucune valeur probante pour la structure au-delà de la trace de remise → la trace survit dans `rgpd_audit_log`).
- `insertion_rappels_rdv` : DELETE.
- `insertion_echeance_reports` : DELETE (le lot 7 l'ajoute aussi — table du lot 5, mais un seul fichier propriétaire ; `tableExists` garde).
- `employees.rappel_rdv_destinataire` → NULL, `rappel_rdv_consent` → NULL.
- `insertion_milestones.eti_token` → NULL (un lien public ne doit pas survivre à l'anonymisation).
- `rgpd_consents` : déjà traité par l'anonymisation existante (vérifier ; sinon DELETE de l'entrée `rappel_rdv`).

---

## 9. Preuves attendues de chaque lot (le rapport 21-… les liste avec les chiffres)
1. **Jest** : suite complète verte (`cd backend && npx jest`), nombre de suites/tests avant → après.
2. **Contrats** : chaque route du § 5 exercée avec `pg` simulé — rôles refusés **avant toute requête** (assert `pool.query` non appelé), formes de réponse, codes 400/403/404/409/410, `champs_refuses`, projection MANAGER sans `brsa`, absence prouvée des clés interdites (§ 5.6.2) dans les deux documents, `pool.connect()` en échec → 500 sans fuite.
3. **Migration** : test unitaire qui rejoue `run(client)` deux fois sur un client simulé et vérifie l'idempotence des instructions (comme `insertion-rsa.test.js`).
4. **Build Vite** (`cd frontend && npm run build`) vert ; `grep -c "window.confirm\|alert(" ` = 0 sur les fichiers du § 5.4.
5. **Contre-épreuves par mutation** : au moins 3 par lot (ex. lot 5 : retirer la garde `locked_at` de `PUT /api/eti/…`, faire lire `brsa` au MANAGER, rendre acquittable une obligation ; lot 7 : ajouter `frein_sante` au contenu de Mon Récap, envoyer sans consentement, retirer l'UNIQUE(milestone_id)) — chacune doit faire tomber au moins un test, puis être restaurée.
6. **Aucune preuve sur base réelle n'est demandée aux lots** (c'est le rôle de l'agent debug) — mais un `node -e "require(...)"` de chaque nouveau module doit passer (avec `JWT_SECRET`/`PCM_ENCRYPTION_KEY` factices).

---

## 10. Ordre d'exécution après les lots (orchestrateur)
1. Intégration : dédoublonnage `insertion-journal.js`, Jest complet, build, `require` de tous les modules, vérification des ancrages lot 7 dans la fiche réorganisée.
2. En parallèle : **revue sécurité** (lecture seule → `22-revue-securite-PR-C.md`), **debug PostgreSQL réel** (`backend/tests/e2e-pr-c/` + `23-debug-postgres-PR-C.md`, sous `TZ=UTC` ET `TZ=Europe/Paris`), **docs** (sonnet, `docs/` seulement).
3. Un agent **correctifs** (`24-correctifs-PR-C.md`).
4. `CLAUDE.md` 2.54.0, PR C → base `claude/solidata-cip-redesign-9fskwq-pr-b`.
