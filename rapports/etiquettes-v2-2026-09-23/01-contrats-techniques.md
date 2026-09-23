# Étiquettes v2 — contrats techniques figés (chantier 2.57.0, 23/09/2026)

Référence de tous les lots. **Ne pas s'en écarter sans le signaler dans le rapport de lot.**

## 0. Arbitrages client (23/09/2026)

| # | Décision |
|---|----------|
| Parcours | **Gamme → Catégorie → Produit → Genre → Saison → Poids**. Une étape à **choix unique se saute d'elle-même** (la valeur est posée et affichée dans le fil d'Ariane). |
| A1 | BTQ remplace STANDARD ; EXPORT disparaît de la saisie. |
| A2 | UP et CHIF sont de vraies gammes (imprimées, avec couleur). |
| B | Upcycling = gamme UP, catégorie Upcycling, produit « Upcycling », Sans Genre, Sans Saison. Plus de cas particulier « sans déclinaison » : la table des combinaisons suffit. Les anciens cartons Upcycling à champs NULL restent tels quels. |
| C1 | « Vestes / Adulte Homme / VAK » sans catégorie → Textiles. |
| C2 | Pulls Homme VAK : Été, Hiver ET Sans Saison. |
| C3 | Libellés d'âge uniformisés (« Enfant Fille 0-2 ans »…). |
| C4 | Correspondances anciennes → nouvelles valeurs pour les STATISTIQUES (Layette → Enfant … 0-2 ans ; BTQ STAND/STANDARD/BTQ FMR → BTQ ; BTQ EXTRA → EXTRA). Les cartons gardent leurs valeurs d'origine. |
| D1 | Journal de CHAQUE scan de sortie (réussi ou refusé), **sans l'identité de la personne**. Nouveau **profil unique** `OPERATEUR_STOCK` (« Opérateur étiquetage & sortie de stock ») : étiquetage + sortie de cartons, rien d'autre. Nouvelle habilitation `sortie_cartons`. |
| D2 | Réimpression autorisée, **même code**, tracée (journal d'impressions + compteur). Refusée pour un carton déjà sorti. |
| D3 | Annulation d'une sortie **aussi en scan libre** (contre-écriture de stock, jamais de suppression). |
| D4 | Bips inchangés : réussite 880 Hz 90 ms ; inconnu 220 Hz 350 ms carré ; déjà sorti double 220 Hz 200 ms. |
| E1 | Code hexadécimal Gamme → Catégorie → Produit → Genre → Saison + référence unique de colis. |
| E2 | Anciens formats à lire tels quels (fichier Dashboard 2026 : `P1`+4 base24, `P1`+3 base24, `P1`+AAMMJJhhmmss) + `PF-…` balance. |

## 1. Déjà posé (fondations — ne pas modifier sans raison)

- `backend/src/data/etiquettes-referentiel-2026.json` — référentiel normalisé (88 produits, 101 lignes → 254 combinaisons), codes figés.
- `backend/src/utils/codification-etiquettes.js` (+ tests `tests/unit/utils/codification-etiquettes.test.js`) :
  `composerCode({gamme,categorie,produit,genre,saison,reference})` → 13 hex ; `decomposerCodeV2` ; `formeLisible` (« 3-1-2A-02-2-00001F ») ; `normaliserScan(brut)` ; `analyserCode(brut)` → `{normalise, format: 'v2'|'ancien_base24'|'ancien_horodate'|'balance'|'inconnu', details}` ; `LIBELLES_FORMAT` ; `REFERENCE_MAX`.
  Largeurs : gamme 1, catégorie 1, produit 2, genre 2, saison 1, référence 6.
- `backend/src/scripts/migrations/etiquettes-v2.js` (appelée par init-db) :
  - `ref_dimensions.code SMALLINT` (unique par type), `ref_dimensions.definition`.
  - `etiquettes_produits(id, nom UNIQUE, code 1..255 UNIQUE, is_active)`.
  - `etiquettes_combinaisons(id, gamme, categorie_eco_org, produit_id→etiquettes_produits, genre, saison, is_active, source, created_at, updated_at, UNIQUE(gamme,categorie_eco_org,produit_id,genre,saison))` — valeurs en TEXTE = `ref_dimensions.valeur`.
  - `produits_finis` : `reference_colis INTEGER` (unique si non NULL, séquence `produits_finis_reference_seq`), `codification VARCHAR(12)` (`v2`|`ancien`|`balance`), `combinaison_id`, `nb_impressions INT DEFAULT 1`, `derniere_impression_at`.
  - `etiquettes_impressions(id, produit_fini_id, type 'creation'|'reimpression', motif, poste_etiquetage_id, imprime_at)`.
  - `sortie_cartons_journal(id, scanned_at, session_id, code_lu, code_normalise, format, resultat 'ok'|'inconnu'|'deja_sorti'|'commande_fermee'|'invalide'|'annulation', produit_fini_id, commande_type, commande_id, message)`.
  - `etiquettes_correspondances(type, ancienne_valeur, nouvelle_valeur)`.
  - Le bloc init-db qui SUPPRIMAIT toute gamme ≠ EXTRA/STANDARD/VAK/EXPORT est retiré ; STANDARD/EXPORT/Layette* sont désactivés (verrou `etiquettes.referentiel_2026_seed`).
- Codes : gammes EXTRA 1, BTQ 2, VAK 3, CHIF 4, UP 5 ; catégories Textiles 1 … Upcycling 9 ; genres Sans Genre 0 … Enfant Fille 10 ans et + 13 ; saisons Sans Saison 0, Été 1, Hiver 2.

## 2. API backend (lot B)

Toutes les routes : `authenticate`. Rôles « opérateur » = `ADMIN, COLLABORATEUR, OPERATEUR_STOCK`.

### 2.1 `/api/etiquettes` (habilitation `etiquettes`)

**GET `/referentiel`** (opérateur + `requireModule('etiquettes')`) → 200
```json
{
  "gammes":     [{ "valeur": "VAK", "code": 3, "definition": "Vente au kilo" }],
  "categories": [{ "valeur": "Textiles", "code": 1 }],
  "genres":     [{ "valeur": "Adulte Femme", "code": 2 }],
  "saisons":    [{ "valeur": "Hiver", "code": 2 }],
  "produits":   [{ "id": 12, "nom": "Paréos", "code": 57 }],
  "combinaisons": [{ "id": 1, "gamme": "VAK", "categorie_eco_org": "Textiles", "produit_id": 12, "produit": "Paréos", "genre": "Adulte Femme", "saison": "Été" }]
}
```
Uniquement ce qui est ACTIF **et codifié** (une combinaison dont une dimension est inactive ou sans code n'est pas servie). Listes triées par `ordre`, puis valeur.

**POST `/generer`** (opérateur + module) — corps `{ poste_id, gamme, categorie_eco_org, produit_id, genre, saison, poids_kg, batch_id? }`
- 400 `{ error, code:'PARAMETRES' }` si un champ manque ou `poids_kg` ∉ ]0 ; 1000].
- 400 `{ error, code:'COMBINAISON_INVALIDE' }` si la combinaison n'existe pas active (vérifiée SERVEUR, jamais confiée à l'écran), ou si une dimension n'a pas de code.
- Transaction : poste `FOR UPDATE` (404 si inactif) → lot optionnel (400 si fermé) → `nextval('produits_finis_reference_seq')` → `composerCode` → INSERT `produits_finis` avec `codification='v2'` (TOUJOURS explicite), `reference_colis`, `combinaison_id`, `produit` = nom, `source='etiquette'`, `status='en_stock'`, `poste_etiquetage_id`, `created_by`, `nb_impressions=1`, `derniere_impression_at=NOW()` ; `catalogue_id` via recherche/insertion dans `produits_catalogue` (le tuple est désormais toujours complet) → INSERT `etiquettes_impressions(type='creation')` → `postes_etiquetage.derniere_etiquette_at=NOW()` (le compteur base24 n'est plus incrémenté).
- 201 → `{ id, code_barre, code_lisible, codification, reference_colis, produit, categorie_eco_org, genre, saison, gamme, poids_kg, date_fabrication, batch_id, poste_label, poste_etiquetage_id, nb_impressions }`.
- Le générateur reste une fonction partagée exportée (`generateProduitFini`) : la voie manuelle `POST /api/produits-finis` l'appelle avec le même corps (source `'manuel'`).

**GET `/carton/:code`** (opérateur + module) — `analyserCode` puis recherche exacte sur `code_normalise` → 200 `{ carton: {...mêmes champs + status, date_sortie, nb_impressions}, format, format_libelle }` ; 404 `{ code:'NOT_FOUND', format, format_libelle, code_normalise }`.

**POST `/reimprimer`** (opérateur + module) — `{ code_barre, motif? }` (motif ≤ 200 car.)
- 404 inconnu ; 409 `{ code:'DEJA_SORTI' }` si sorti ; sinon `nb_impressions+1`, `derniere_impression_at`, journal `reimpression` → 200 carton (même forme que `/generer`, `code_lisible` = `formeLisible` pour v2, code brut sinon). Les anciens codes se réimpriment **tels quels**.

**Conservés** : `GET /postes`, `GET /lots-actifs` (ouverts à OPERATEUR_STOCK). `GET /dimensions` et `GET /options` peuvent rester pour compatibilité mais ne sont plus appelés par les écrans.

**Admin (ADMIN)** :
- `GET /admin/referentiel` → tout, actif ou non, avec codes, + combinaisons (avec `is_active`) + nb de cartons par combinaison.
- `POST /admin/produits-v2 { nom }` → code = plus petit code libre 1..255 (409 `CODES_EPUISES`), 409 si nom existant. `PATCH /admin/produits-v2/:id { is_active }` (le **nom n'est pas modifiable** une fois des cartons imprimés — 409 `PRODUIT_UTILISE`).
- `POST /admin/combinaisons { gamme, categorie_eco_org, produit_id, genre, saison }` (valeurs actives et codifiées, sinon 400) ; `PATCH /admin/combinaisons/:id { is_active }`. Jamais de DELETE d'une combinaison ayant servi.
- `POST /admin/dimensions` : attribue automatiquement le plus petit code libre du type (bornes : gamme/catégorie/saison 0..15, genre 0..255 ; gamme et catégorie commencent à 1) → 409 `CODES_EPUISES`. `PATCH /admin/dimensions/:id` : **refuse** de changer `valeur` si la valeur a un code (409 `VALEUR_CODIFIEE`) — renommer changerait la signification de codes déjà imprimés.
- Les routes admin produits/dimensions historiques peuvent rester.

**Retirés** de `/api/etiquettes` : `/sortie-scan`, `/sortie-session/*`, `/commandes-actives/*` (déménagent, § 2.2).

### 2.2 `/api/sortie-cartons` (NOUVEAU routeur `routes/sortie-cartons.js`, habilitation `sortie_cartons`)

Toutes : opérateur + `requireModule('sortie_cartons')`.

**GET `/commandes-actives/:type`** (`btq`|`vak`) — même contenu qu'avant.

**POST `/scan`** — `{ code_barre, commande_type: 'btq'|'vak'|'libre', commande_id?, session_id? }`
- `analyserCode(code_barre)` ; recherche exacte `WHERE code_barre = $normalise FOR UPDATE`.
- Chaque issue est inscrite dans `sortie_cartons_journal` (`code_lu` tronqué à 64, `code_normalise`, `format`, `resultat`, `produit_fini_id`, commande, `session_id` tronqué à 40, `message`) — **y compris les refus**, donc écrite HORS de la transaction annulée (ou après ROLLBACK). Jamais l'identifiant de l'utilisateur dans le journal.
- Réponses :
  - 200 `{ resultat:'ok', carton:{ id, code_barre, code_lisible, codification, produit, categorie_eco_org, genre, saison, gamme, poids_kg, date_fabrication, date_sortie }, commande:{id,reference,statut}|null }`
  - 404 `{ resultat:'inconnu', code:'NOT_FOUND', error, format, format_libelle, code_normalise }` (le message distingue « ancien code absent du stock importé » de « format non reconnu »).
  - 409 `{ resultat:'deja_sorti', code:'ALREADY_OUT', error, carton:{..., date_sortie, sortie_commande_type} }`
  - 409 `{ resultat:'commande_fermee', code:'COMMANDE_FERMEE', error }`
  - 400 `{ resultat:'invalide', code:'PARAMETRES'|'CODE_VIDE', error }`
- Effets d'une sortie : identiques à l'existant (`status='expedie'`, `date_sortie`, `sortie_commande_type/id`, `scanned_by`) ; mouvement `stock_movements` de sortie **pour `libre` seulement** (règle anti-double-compte inchangée).

**GET `/session/:type/:commande_id`** (`btq`|`vak`) → `{ items, count, total_kg }` (items avec `code_lisible`).

**POST `/annuler`** — `{ code_barre, commande_type, commande_id?, motif? }` (tous types, D3)
- 404 si le carton n'est pas sorti par CETTE commande (ou par une sortie libre si `libre`).
- Remet `status='en_stock'`, `date_sortie/sortie_commande_*/scanned_by = NULL`.
- `libre` : **contre-écriture** du mouvement `origine='sortie_carton'` (type `entree`, `origine='annulation'`, `reversed_of_id`, `reversal_reason`, et `reversal_movement_id` + `reversed_at` sur l'original — même mécanique que `POST /stock/movements/:id/cancel`), jamais de DELETE. `btq`/`vak` : pas de mouvement à contrepasser.
- Journal `resultat='annulation'`. 200 `{ ok:true, carton }`.

**GET `/journal?date=AAAA-MM-JJ&session_id=&resultat=&limit=`** (défaut : jour courant heure de Paris, limit 200, max 1000) → `{ items:[{ id, scanned_at, code_lu, code_normalise, format, resultat, message, commande_type, commande_id, carton:{code_barre, produit, gamme, poids_kg}|null }], compteurs:{ ok, inconnu, deja_sorti, commande_fermee, invalide, annulation } }`.

### 2.3 Rôle et habilitations
- `utils/roles.js` : ajouter `OPERATEUR_STOCK` à `BUILTIN_ROLES` ; `routes/permissions.js` : libellé « Opérateur étiquetage & sortie de stock », jamais base d'une duplication vers ADMIN ; clé de module `sortie_cartons` (« Inventaire › Sortie cartons ») au catalogue.
- `utils/module-routes.js` : `'/api/sortie-cartons': ['sortie_cartons']` (la garde anti-dérive l'exige).
- `OPERATEUR_STOCK` n'est ajouté à AUCUNE autre liste `authorize` que celles du présent contrat.

## 3. Écrans (lots C et D)

### 3.1 Étiquetage `/tri/etiquettes` (lot C)
- Charge `GET /etiquettes/postes`, `/etiquettes/referentiel`, `/etiquettes/lots-actifs` (facultatif).
- Parcours **Gamme → Catégorie → Produit → Genre → Saison → Poids**, chaque étape = valeurs distinctes des combinaisons compatibles avec les choix précédents ; **une seule valeur → posée automatiquement et étape sautée** (enchaînement récursif) ; fil d'Ariane cliquable pour revenir à une étape réellement choisie. Logique pure dans `frontend/src/utils/etiquettes-parcours.js` (réutilisée par ProduitsFinis).
- Poids : pavé numérique tactile ; `POST /etiquettes/generer` avec `produit_id`.
- Impression A4 (`EtiquetteA4.jsx`) : code-barres CODE128 = `code_barre` ; sous le code, `code_lisible` ; gamme en badge coloré ; Sans Genre / Sans Saison imprimés tels quels. Les anciens cartons réimprimés s'impriment avec leurs valeurs (NULL → rien).
- Panneau **« Réimprimer une étiquette »** : saisie/scan d'un code → `GET /etiquettes/carton/:code` (aperçu) → motif facultatif → `POST /etiquettes/reimprimer` → impression.
- Visuels : `utils/etiquettes-visuels.js` gère EXTRA (Premium), BTQ (Boutique), VAK (Vente au kilo), CHIF (Chiffons), UP (Upcycling), et garde STANDARD/EXPORT/BTQ STAND/BTQ EXTRA/Pvak pour l'affichage historique. **Exporte `visuelGamme(valeur)`** (utilisé aussi par l'écran de sortie).
- `AdminCatalogue.jsx` : onglets « Combinaisons » (filtres gamme/catégorie, ajout, activation) et « Produits (codification) » (code hex affiché), sur les routes admin du § 2.1.
- `ProduitsFinis.jsx` : formulaire manuel en listes en cascade via `etiquettes-parcours.js`.

### 3.2 Sortie de cartons `/inventaire/sortie-cartons` (lot D)
- Nouveau client API `/api/sortie-cartons/*`. `session_id` = UUID généré à l'ouverture d'une session (crypto.randomUUID, repli aléatoire).
- Retour immédiat et **identifiable** : plein écran vert + bip réussite ; rouge + bip erreur (inconnu, invalide, commande fermée) ; ambre + double bip (déjà sorti). Le message affiche le format reconnu (« Ancien code (compteur de poste) — absent du stock ») et le code lu. Durée du flash ≥ 1,2 s pour être vu depuis la douchette.
- Liste des cartons sortis de la session avec bouton **Annuler la sortie** (confirmation + motif facultatif) → `POST /annuler`.
- Onglet/encart **« Journal du jour »** : `GET /sortie-cartons/journal` (tous les scans, refus compris, compteurs).
- Rôles de la route et de l'entrée de menu : `ADMIN, COLLABORATEUR, OPERATEUR_STOCK`, `module="sortie_cartons"` ; entrée de menu `id:'sortie_cartons'`. `/tri/etiquettes` ouvert aussi à `OPERATEUR_STOCK`. Page d'accueil d'un `OPERATEUR_STOCK` = `/tri/etiquettes`.

### 3.3 Import du stock actuel (lot D) — `backend/src/scripts/import-stock-etiquettes.js`
- `--file=<chemin .xlsm|.xlsx>` obligatoire, simulation par défaut, `--apply` transactionnel. Feuille : la première dont une ligne d'en-tête (20 premières lignes) contient `ID` et `Produits`. Colonnes par NOM d'en-tête : ID, Produits, Catégorie Eco-org., Genre, Saison, Gamme, Poids, Date de fabrication, Date de sortie, Inventaire.
- Code = `normaliserScan(ID)` ; ligne ignorée (et comptée) si code vide, format `inconnu`, poids non numérique ou ≤ 0, doublon dans le fichier.
- Absent en base → INSERT `produits_finis` : valeurs TEXTE d'origine (aucune conversion), `codification` = `'ancien'` (ou `'balance'`/`'v2'` d'après le format), `source='import_excel'`, `status` = `'expedie'` si date de sortie sinon `'en_stock'`, dates, `date_inventaire` si date valide, `created_by NULL`. Aucun mouvement de stock écrit (le stock historique vit hors grand livre, comme les imports précédents).
- Présent en base → **jamais** de modification des dimensions ; si la base n'a pas de date de sortie et le fichier en a une → pose `date_sortie` + `status='expedie'` ; une sortie en base n'est **jamais** effacée. Écarts de dimensions comptés et listés (20 premiers).
- Idempotent (re-exécution = 0 écriture). Récapitulatif : lus, créés, mis à jour, inchangés, ignorés par motif, répartition par format et par gamme, cartons en stock / sortis, poids en stock.
- Fonctions de décision **pures et exportées** (testables sans base), tests Jest dans `backend/tests/unit/scripts/import-stock-etiquettes.test.js`.

## 4. Propriété des fichiers

| Lot | Modèle | Fichiers |
|-----|--------|----------|
| B backend | Opus | `backend/src/routes/etiquettes.js`, `routes/produits-finis.js`, `routes/sortie-cartons.js` (nouveau), `src/index.js` (montage seulement), `utils/module-routes.js`, `utils/roles.js`, `routes/permissions.js`, `utils/etiquettes-categories.js`, tests backend des routes (`tests/contract/**`, `tests/unit/routes/**`) |
| C étiquetage | Sonnet | `frontend/src/pages/EtiquetteGenerer.jsx`, `components/EtiquetteA4.jsx`, `utils/etiquettes-visuels.js`, `utils/etiquettes-parcours.js` (nouveau), `pages/AdminCatalogue.jsx`, `pages/ProduitsFinis.jsx`, `styles/etiquette-print.css` |
| D sortie + import | Sonnet | `frontend/src/pages/SortieCartons.jsx`, `utils/beep.js`, `hooks/useScannerInput.js`, `App.jsx`, `navigation/navTree.js`, redirection d'accueil, `backend/src/scripts/import-stock-etiquettes.js` + son test |
| Coordination | — | contrats, référentiel JSON, codification, migration, documentation |
