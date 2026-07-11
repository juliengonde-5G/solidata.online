# Test persona — Manager de chaîne de tri

**Date** : 11 juillet 2026
**Rôle applicatif testé** : MANAGER (web)
**Périmètre** : Tri & Production (chaînes de tri, lots, étiquetage, produits finis, planning filière tri, feuille de production)

---

## 1. Ma promesse

J'encadre deux chaînes de tri et des opérateurs en insertion. Pour réussir mon métier, l'application doit me permettre de préparer ma journée (qui est affecté où), de suivre en continu ce qu'il advient de la matière que je fais entrer en tri — quelle opération, quelle sortie par catégorie, quel carton, quel colis — et de mesurer ma productivité réelle par rapport à mes objectifs, jour après jour. La traçabilité n'est pas un confort : c'est ce qui me permet de répondre à un exutoire ou à Refashion sur l'origine d'un lot, et c'est ce qui me permet de motiver mes équipes avec des chiffres vrais.

## 2. Mon parcours

**Préparer la journée.** Le planning hebdomadaire (`/planning-hebdo`, `frontend/src/pages/PlanningHebdo.jsx`, roles ADMIN/MANAGER dans `frontend/src/App.jsx`) fait exactly ce qu'il faut : grille poste × jour × demi-journée, alerte rouge sur les postes obligatoires non couverts, sélecteur d'employé disponible filtré sur permis B/CACES (`GET /planning-hebdo/employes-disponibles`), et bouton « Confirmer » pour lever le statut provisoire. C'est une des pages les plus abouties que j'ai testées. Elle alimente ensuite en lecture seule les « Opérateurs sur table » de ma feuille de production du jour (`backend/src/routes/production.js`, route `GET /feuille/:date`, jointure `schedule → postes_operation → operations_tri → chaines_tri`). Bon point : je n'ai pas à ressaisir deux fois la même affectation.

**Lancer une opération de tri (crackage puis tri fin) et suivre les batchs.** C'est là que les choses se gâtent. Sur `/chaine-tri` (`frontend/src/pages/ChaineTri.jsx`), l'onglet « Lots de tri » me permet bien d'ouvrir un lot (chaîne + poids initial, `POST /tri/batches`) et de le démarrer (`PUT /tri/batches/:id/start`). Mais une fois le lot démarré, je n'ai **aucun bouton, aucun formulaire, nulle part dans le frontend** pour enregistrer qu'une opération (Crack 1, R1-R4, Réunion, Triage fin, Chiffons — les postes que je vois pourtant listés dans `POSTES_LABELS` du même fichier) a été exécutée sur ce lot. J'ai vérifié dans `backend/src/routes/tri.js` : les routes existent bel et bien (`POST /tri/executions`, `PUT /tri/executions/:id/complete` — transactionnelle, avec verrou `FOR UPDATE`, reversement automatique en stock par catégorie —, `POST /tri/executions/:id/outputs`), et la route `GET /tri/batches/:id` renvoie même le tableau `executions` avec ses `outputs`. Mais j'ai grep l'intégralité de `frontend/src` et `mobile/src` : aucune occurrence de `/tri/executions` ni d'appel à ces endpoints. Le détail de lot affiché dans `ChaineTri.jsx` (fonction `openLotDetail`) n'exploite que `chaine_nom`, `poids_initial_kg` et `cartons` — il ignore silencieusement `lotDetail.executions` que l'API lui fournit pourtant. Concrètement : je peux ouvrir un lot, mais je ne peux pas dire à l'application « ce lot vient de passer par le crackage, voici ce qui en est sorti par catégorie ». C'est du code mort côté backend, invisible côté manager.

**Coliser et sceller.** Même constat, encore plus net : `backend/src/routes/tri.js` code un cycle de vie complet des colisages (`POST /tri/colisages`, ajout d'articles, `PUT /tri/colisages/:id/status` avec machine à états ouvert→scellé→expédié→livré, historique `colisage_history`). Aucune page ne les appelle — mon grep sur « colisage » dans tout `frontend/src` ne retourne aucun fichier. Je ne peux tout simplement pas sceller un colis depuis le web.

**Saisir les sorties par catégorie (17 catégories + refus de tri).** J'ai vérifié dans `backend/src/scripts/init-db.js` (lignes ~1624-1654) que les 18 catégories sortantes existent bien en base (17 catégories Dashboard + « Refus de tri » obligatoire, avec `famille_refashion`). Elles s'affichent en lecture sur l'onglet « Chaînes & catégories » de `ChaineTri.jsx`. Pour les alimenter, je passe par le mouvement de stock générique de `/stock` (`frontend/src/pages/Stock.jsx`, formulaire « Mouvement de stock », `POST /stock`) — ça fonctionne, mais c'est un contournement : ce mouvement n'est rattaché à aucun lot ni aucune opération, alors que le circuit prévu (`operation_outputs` → reversement automatique en stock, déjà codé dans `PUT /tri/executions/:id/complete`) l'aurait fait proprement et avec traçabilité amont. Je perds le lien lot → opération → catégorie.

**Générer les étiquettes cartons.** Ici, très bonne surprise. `/tri/etiquettes` (`frontend/src/pages/EtiquetteGenerer.jsx`) est un vrai poste tactile pensé pour l'atelier : assistant en 6 étapes (catégorie → genre → saison → gamme → produit → poids au pavé numérique), impression immédiate, code-barres généré par poste (`backend/src/routes/etiquettes.js`, `formatId` base24, compteur par poste avec verrou `FOR UPDATE`), et surtout un sélecteur de lot optionnel qui rattache le carton au `batch_id` — c'est le seul endroit où la traçabilité lot → carton fonctionne réellement, et le rôle COLLABORATEUR y a accès (bon calcul : l'opérateur peut étiqueter sans moi).

**Enregistrer les produits finis.** Je découvre un deuxième chemin, `/produits-finis` (`frontend/src/pages/ProduitsFinis.jsx`), formulaire manuel avec code-barres en texte libre. Problème vérifié : son sélecteur de gamme propose « A — Premium / B — Standard / C — Déclassé » (lignes 139-143), alors que `backend/src/scripts/init-db.js` (lignes 1594-1602, migrations V2.1/V2.2) a supprimé ces anciennes valeurs au profit de `EXTRA / STANDARD / VAK / EXPORT` — les seules valeurs que le poste d'étiquetage utilise réellement (via `ref_dimensions`). Ce formulaire crée donc des cartons avec une gamme qui n'existe plus nulle part ailleurs dans l'application. Même symptôme dans `frontend/src/pages/SortieCartons.jsx` : la table `GAMME_COLORS` (lignes 8-14) code encore les couleurs pour `BTQ STAND`, `BTQ EXTRA`, `CHIF`, `Pvak` — toutes des gammes supprimées d'après le même changelog — si bien que le badge couleur au scan tombe presque toujours sur le gris par défaut aujourd'hui.

**Clôturer la journée et analyser les KPI.** La feuille de production (`Production.jsx`) est riche : objectifs éditables (entrée ligne/R3/R4, % recyclage/réemploi/CSR avec seuil d'alerte), consignes datées, commentaires, clôture avec verrouillage (`POST /production/feuille/:date/validate`) et réouverture réservée ADMIN. Mais j'ai trouvé un vrai problème de fond en lisant `saveFeuille()` : les champs envoyés à l'API sont `entree_recyclage_r3_kg: 0` et `entree_recyclage_r4_kg: 0`, **codés en dur**, alors que l'interface me fait pourtant saisir des objectifs cibles pour ces deux lignes. Je n'ai simplement aucun champ pour saisir la valeur réelle R3/R4 — tout le poids « Vers Atelier de tri » de la balance part dans `entree_ligne_kg`. Résultat : le graphique empilé de `ChaineTri.jsx` (« Chaîne Qualité » vs « Recyclage Exclusif R3 ») affichera toujours une part R3 nulle, et le calcul de « Rendement matière » de `ReportingProduction.jsx` (ligne ~39-41) compare `total_mois_t` (qui inclut r3+r4, ici toujours à 0) à `total_entree_ligne_kg + total_entree_r3_kg` — un ratio qui ne reflète aucune perte matière réelle, seulement un artefact de calcul.

## 3. Ce que je remonte

**Points forts**
- Planning hebdomadaire filière tri : alertes de couverture, filtre permis/CACES, très utilisable au quotidien (`PlanningHebdo.jsx`).
- Poste d'étiquetage tactile : rapide, ergonomique, code-barres fiable, rattachement lot optionnel (`EtiquetteGenerer.jsx`, `etiquettes.js`).
- Feuille de production : objectifs trimestriels/mensuels, consignes du directeur, clôture avec verrouillage et traçabilité de validation.
- Scan de sortie carton par douchette (`SortieCartons.jsx`) : flux mode BTQ/libre bien pensé, anti-double-scan.

**Points faibles**
- Deux chemins concurrents pour créer un produit fini (étiquetage vs formulaire manuel `ProduitsFinis.jsx`), avec un référentiel de gamme périmé sur le second.
- Sortie par catégorie déconnectée du lot/de l'opération (contournement via `Stock.jsx`).
- Catégories sortantes en lecture seule uniquement (pas d'admin dédiée pour les faire évoluer).
- Diagramme des flux et « Rendement matière » reposent sur des données R3/R4 jamais alimentées.

**Défaillances vérifiées dans le code**
1. `POST /tri/executions`, `PUT /tri/executions/:id/complete`, `POST /tri/executions/:id/outputs` (`backend/src/routes/tri.js`) : aucun appel dans `frontend/src` ni `mobile/src` — impossible d'enregistrer une opération de tri sur un lot depuis le web.
2. `POST /tri/colisages` et tout son cycle de vie (`tri.js`) : idem, aucune page ne les consomme — impossible de coliser/sceller depuis le web.
3. `frontend/src/pages/Production.jsx` (`saveFeuille`) : `entree_recyclage_r3_kg` et `entree_recyclage_r4_kg` envoyés en dur à 0, malgré des objectifs éditables pour ces lignes — la distinction Ligne/R3/R4 est cassée sur toute la chaîne de reporting.
4. `frontend/src/pages/ProduitsFinis.jsx` (gamme A/B/C) et `frontend/src/pages/SortieCartons.jsx` (`GAMME_COLORS`) : référentiel de gamme obsolète par rapport à la migration V2.1/V2.2 documentée dans `init-db.js`.

**Insuffisances fonctionnelles (métier)**
- Pas de vue « au poste » en temps réel (qui trie quoi, sur quel poste, maintenant) — le planning me dit qui est affecté, pas ce qui se passe réellement à l'instant T sur la chaîne.
- Pas de suivi des pertes/refus de tri par lot (la catégorie « Refus de tri » existe en base mais je ne peux la saisir que via un mouvement de stock générique, sans lien au lot).
- Pas d'alerte productivité en cours de journée (uniquement un bilan a posteriori) — un manager de chaîne a besoin de savoir vers midi si le rythme du matin tiendra l'objectif du jour.

## 4. Verdict

**Promesse partiellement tenue — note 5,5/10.**

Les deux bouts de ma chaîne de travail — préparer l'équipe et clôturer/analyser — sont bien traités. Mais le cœur de mon métier, le suivi opération par opération d'un lot en tri et la traçabilité jusqu'au colis scellé, est du code serveur prêt et non exposé : je ne peux pas m'en servir, alors même que la promesse de traçabilité des flux triés est explicitement au centre de ma fonction. Ajouté au bug silencieux R3/R4 qui fausse mes propres indicateurs de productivité, cela m'empêche de tenir pleinement mon rôle avec l'outil tel qu'il est aujourd'hui.
