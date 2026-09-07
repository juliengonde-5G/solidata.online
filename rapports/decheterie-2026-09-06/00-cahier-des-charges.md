# Collecte en déchèterie — bordereau Métropole Rouen Normandie

**Cahier des charges fonctionnel et technique — chantier 2.50.0**
Rédigé le 6 septembre 2026 à partir de la demande client du 4 septembre et du formulaire
« Bordereau de collecte des ESS sur les zones de réemploi » (scan fourni par le client).

---

## 1. Le besoin

Quand le point collecté est une **déchèterie** de la Métropole, celle-ci exige un bordereau
papier signé par son agent et par le chauffeur de l'ESS. Aujourd'hui SOLIDATA ne sait pas
qu'un point est une déchèterie (deux CAV portent « Dechetterie » dans leur nom, sans aucun
marquage), et rien n'est produit.

Le client demande :

1. **Mobile** — à la validation de la CAV, le chauffeur saisit un **poids indicatif** (jamais
   versé dans les pesées) et recueille **deux signatures manuscrites sur le téléphone** :
   l'agent de la déchèterie et lui-même.
2. **Manager** — notifié qu'une collecte en déchèterie vient d'avoir lieu.
3. **Document** — le bordereau de la Métropole est **pré-rempli** : case de la commune de la
   déchèterie, case « Solidarité Textile » figée, seul le champ **TLC (kg)** renseigné avec le
   poids du chauffeur, les deux signatures reportées.
4. **Validation** — chaque bordereau généré est **validé par le manager** depuis l'historique de
   la tournée ; la validation ajoute dans Remarque(s) : « Validé par Solidarité textiles sur
   Solidata le (date) ».
5. **Historisation** — le PDF est visible dans l'historique de la tournée ET dans la fiche de la
   déchèterie.

## 2. Le formulaire, tel qu'il est

Le scan est une image (aucune couche texte, logo illisible). Contenu relevé :

| Bloc | Contenu | Ce que SOLIDATA remplit |
|---|---|---|
| En-tête | Logo Métropole, titre, « Date de l'enlèvement le : / / » | La date de collecte (jour civil Paris) |
| Déchetterie | 7 cases : Cléon, Boos, Caudebec-lès-Elbeuf, Déville-lès-Rouen, Petit-Quevilly, Le Trait, Saint-Étienne-du-Rouvray | La case de la déchèterie du point |
| ESS collectrice | 8 cases : Atelier Autonome, Kintsu Jouets, Cicérone, La Marcotte, Emmaüs, Résistes, Envie ERG, **Solidarité Textile** | « Solidarité Textile », figée |
| Objets en nombre | DEA, gros/petits électroménagers, cycles | Rien (laissé vide) |
| Objets en caisses | 6 familles | Rien (laissé vide) |
| Objets en kg | « TLC : …… en kg (estimation) » | Le poids indicatif du chauffeur |
| Signatures | Agent de déchetterie / Chauffeur de l'ESS | Les deux signatures manuscrites |
| Remarque(s) | libre | La mention de validation du manager |

**Constat qui appelle un arbitrage** : les deux déchèteries déjà présentes dans le référentiel
CAV (« ROUEN - 1 Quai du Pré aux loups », « SAINT-MARTIN-DE-BOSCHERVILLE - 17 Chaussée
Saint-Georges ») **ne figurent pas** parmi les 7 cases du formulaire (question Q1).

## 3. Règles de gestion retenues

### 3.1 Marquage d'une déchèterie
- Nouveau drapeau `cav.is_decheterie` (défaut faux) + `cav.decheterie_code` (code parmi les 7
  du formulaire, nullable). Éditables dans Gestion des CAV (ADMIN/MANAGER), visibles par un badge
  « Déchèterie » dans la liste.
- Un point déchèterie **hors liste** (code null) produit un bordereau où la commune est écrite
  en clair en tête des Remarque(s) (« Déchèterie : <nom du point> ») — aucune case n'est cochée
  au hasard.
- Les deux CAV existantes nommées « Dechetterie » sont marquées **une fois** au démarrage
  (verrou `collecte.decheterie_flag_seed`, doctrine 2.26.4 : un démarquage manuel ne revient
  jamais).

### 3.2 Parcours chauffeur (FALC)
- Identification du point et niveau de remplissage **inchangés** (la collecte reste hors-ligne
  d'abord). Sur un point déchèterie, l'écran de confirmation enchaîne sur **« Bordereau
  déchèterie »** : (1) poids indicatif en kg (compteur à gros boutons + raccourcis, patron du
  compteur de sacs), (2) signature de l'agent, (3) signature du chauffeur.
- Le poids indicatif est **obligatoire**. Il est stocké UNIQUEMENT dans le bordereau : jamais
  dans `tour_weights`, jamais dans le total de la tournée, jamais dans l'apprentissage.
- Pad de signature **maison** (pointer events, `touch-action: none`, aucune librairie) — une
  signature vide (moins de N points) n'est pas acceptée.
- **Hors-ligne** : le bordereau est mis en file (IndexedDB) avec ses signatures encodées PNG
  (quelques dizaines de Ko), rejoué par la synchronisation — une signature d'agent ne peut pas
  être recueillie plus tard, la perdre serait irréparable. C'est une exception ASSUMÉE à la
  doctrine « aucun blob en file », valable pour les photos (Mo), pas pour des signatures bornées
  serveur à 200 Ko.
- Idempotence par `client_id` : un rejeu ne crée jamais deux bordereaux.

### 3.3 Génération du bordereau (serveur)
- Module PUR `utils/bordereau-decheterie-pdf.js` (pdfkit, déjà en dépendance) : reproduction
  vectorielle fidèle du formulaire, A4 paysage. Visuel validé avant déploiement (§7).
- Logo Métropole : texte de repli tant que le PNG officiel n'est pas déposé dans
  `backend/assets/logo-metropole-rouen.png` (le scan est inexploitable).
- Statut à la création : **à valider**. Pied de page discret : numéro, tournée, véhicule,
  point, horodatage de génération, statut.

### 3.4 Notification du manager
- Messagerie interne (conversation système « SOLIDATA », rôles ADMIN/MANAGER, lien vers la
  fiche de tournée) + notification push (canal existant) : « Collecte en déchèterie
  <libellé> — bordereau à valider ».

### 3.5 Validation
- Bouton « Valider » dans la fiche de tournée (ADMIN/MANAGER — question Q4). Effets : statut
  **validé**, `valide_par`/`valide_le`, régénération du PDF avec la mention
  « Validé par Solidarité textiles sur Solidata le JJ/MM/AAAA » dans Remarque(s).
- Une seconde validation est refusée (409). Le poids et les signatures ne sont **jamais**
  modifiables après coup (le document est une pièce signée par un tiers).

### 3.6 Historisation et consultation
- Fiche de tournée : section « Bordereaux déchèterie » (statut, poids, aperçu PDF, Valider,
  télécharger).
- Fiche CAV (Gestion des CAV) : section « Bordereaux » (historique, statut, aperçu).
- Chaque consultation d'un PDF est journalisée dans `rgpd_audit_log` (le document porte deux
  signatures manuscrites).

### 3.7 RGPD
- Les signatures sont des **données personnelles** (dont celle d'un tiers, l'agent de la
  déchèterie). Stockage en base (BYTEA), **jamais** sous `/uploads` (servi statiquement).
- Entrée au registre art. 30 ; codes d'audit traduits (garde anti-dérive) ; purge de rétention
  paramétrable `rgpd.bordereaux_decheterie_retention_jours` (question Q3), intégrée au registre
  `PURGES_RGPD` (bouton manuel + job). À l'anonymisation d'un salarié, la signature chauffeur des
  bordereaux de ses tournées est retirée (ligne conservée, PDF régénéré avec la mention
  « signature retirée — anonymisation »).
- Périmètre chauffeur : le bordereau ne peut être déposé que par le véhicule de la tournée
  (garde `-public` existante), et seulement sur un point marqué déchèterie de cette tournée.

## 4. Ce qui n'est PAS fait (et pourquoi)
- Pas de remplissage des blocs « en nombre » / « en caisses » : Solidarité Textiles ne collecte
  que du TLC sur ces zones (demande client).
- Pas de champ « Remarque » libre côté chauffeur : le formulaire de la Métropole est rempli au
  minimum ; les notes de collecte existantes restent dans la tournée.
- Pas d'envoi automatique à la Métropole : le PDF validé se télécharge et s'envoie par le canal
  habituel.

## 5. Arbitrages client (06/09/2026)
- **Q1 — Déchèteries hors des 7 cases** : le client a fourni le **réseau des 15 déchèteries
  de la Métropole** (open data) avec l'identifiant SOLIDATA du CAV correspondant (14 renseignés,
  Saint-Étienne-du-Rouvray sans CAV). Référentiel versionné dans
  `backend/src/data/decheteries-metropole.json`. Seed idempotent à verrou : marque `is_decheterie`
  sur ces CAV **par identifiant, avec garde sur la commune** (un identifiant qui ne tombe pas sur
  la bonne commune n'est jamais marqué — repli par nom « déchetterie » + commune pour les bases
  hors production). Les 7 communes du formulaire reçoivent leur `decheterie_code` ; les 8 autres
  restent hors liste (commune écrite en clair dans Remarque(s)).
- **Q2 — Agent indisponible** : le chauffeur continue avec un motif explicite tracé sur le
  bordereau (« Signature de l'agent non recueillie : agent indisponible »).
- **Q3 — Conservation** : 3 ans (`rgpd.bordereaux_decheterie_retention_jours` = 1095).
- **Q4 — Validation** : ADMIN et MANAGER.

## 6. Organisation du chantier (multi-agents, multi-modèles)
Agent de coordination (contrats figés, propriété des fichiers, intégration), 3 lots à fichiers
disjoints (backend / mobile / web), agent de sécurité (revue RGPD, périmètre, uploads,
autorisations), agent de debug (intégration, Jest/Vitest/builds, preuves sur PostgreSQL réel).

## 7. Visuel
`bordereau-valide.png` / `bordereau-sans-sig.png` : rendu réel du générateur, transmis au
client pour validation avant déploiement.
