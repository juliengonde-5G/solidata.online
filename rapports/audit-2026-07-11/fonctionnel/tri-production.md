# Audit fonctionnel — Module « Chaîne de tri & production »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/{tri.js, production.js, produits-finis.js, etiquettes.js}` + pages web `ChaineTri`, `Production`, `ProduitsFinis`, `EtiquetteGenerer`, `BalancePage`
**Utilisateurs cibles** : manager de chaîne de tri, opérateurs (salariés en insertion), direction

---

## 1. Couverture fonctionnelle réelle

Le module couvre en réalité **trois sous-systèmes assez indépendants** :

1. **La feuille de production quotidienne** (`production.js` + `Production.jsx`) : saisie manager d'un jour de tri — effectifs par catégorie (tri, récupération, CP, formation, absence, AM, lus en lecture seule depuis le planning hebdo), entrées pondérales par flux (« ligne » R1/R2, R3, R4), objectifs trimestriels/mensuels (`production_objectives`), consignes datées de direction (`production_consignes`), commentaires horodatés, et une **clôture de journée** (`validated_at`/`validated_by`, réouverture réservée ADMIN). Les entrées « ligne » sont désormais alimentées automatiquement par les pesées de la balance (`stock_original_movements` où `destination='atelier_tri'`), ce qui est une vraie amélioration de fiabilité par rapport à une ressaisie manuelle.
2. **La traçabilité par lot** (`tri.js`) : ouverture d'un lot (`batch_tracking`) avec poids initial, exécution d'opérations (`operation_executions`) avec sorties pondérées par catégorie (`operation_outputs`), complétion transactionnelle qui reverse automatiquement le stock trié (`stock_movements`), puis colisage (`colisages`/`colisage_items`) avec cycle de statut `ouvert → scellé → expédié → livré` tracé dans `colisage_history`. C'est le sous-système le plus riche en ingénierie (verrou `FOR UPDATE`, idempotence sur la complétion, cf. `tri.js:314-386`).
3. **L'étiquetage carton** (`etiquettes.js` + `EtiquetteGenerer.jsx`) : assistant en 6 étapes (catégorie → genre → saison → gamme → produit → poids) qui génère un code-barres séquentiel compact (`P<poste><base24 sur 4 caractères>`, `backend/src/utils/base24.js`), imprime une étiquette A4 avec code-barres CODE128 (`EtiquetteA4.jsx`, lib `jsbarcode`), et peut rattacher le carton à un lot ouvert. Un flux de sortie scannée (`/sortie-scan`) referme la boucle vers les commandes boutique ou VAK.

À cela s'ajoute la **page balance** (`BalancePage.jsx`), qui est en réalité un kiosque de pesée du module Stock (routes dans `stock-original.js`, hors du périmètre backend demandé mais page listée dans le périmètre) : saisie tactile entrée/sortie de matière avec tares de contenants pré-enregistrées.

Ce que le module ne fait **pas** : il n'existe aucune interface pour configurer les chaînes, opérations, postes et sorties (`chaines_tri`, `operations_tri`, `postes_operation`, `sorties_operation`) — ces tables sont peuplées une seule fois par un script de seed (`init-db.js:1914-1990`) et les routes de création existent côté API (`POST /tri/chaines`, `/operations`, `/postes`, `/sorties`) mais ne sont appelées par **aucune page** (`ChaineTri.jsx` ne fait qu'afficher les chaînes existantes, `AdminCatalogue.jsx` ne gère que produits/catégories eco-org/genres/saisons/gammes/conteneurs). La configuration physique de la ligne de tri est donc gelée côté code.

## 2. Adéquation aux besoins des utilisateurs et parties prenantes

Pour les **opérateurs** (salariés en insertion), les deux outils réellement conçus pour le terrain — `EtiquetteGenerer` et `BalancePage` — sont bien pensés : gros boutons, icônes par catégorie, clavier numérique tactile intégré (pas de clavier physique requis), retour visuel de succès avec auto-reset, aucune friction de connexion sur la balance (endpoint public, cf. §5). C'est cohérent avec un public parfois éloigné du numérique. En revanche, le sous-système de traçabilité par lot (`tri.js`) est réservé ADMIN/MANAGER — un opérateur ne peut ni ouvrir un lot, ni déclarer une sortie d'opération, ni gérer un colisage. Cela explique en creux pourquoi ce sous-système, malgré sa qualité technique, semble peu utilisé au quotidien : le manager devrait ressaisir manuellement chaque étape pour chaque table, ce qui n'est pas réaliste en pratique — d'où le repli de fait sur la feuille agrégée.

Pour le **manager de chaîne de tri**, la feuille de production (`Production.jsx`) est un vrai outil de pilotage journalier (objectifs, effectifs, consignes, clôture) mais il ne peut pas faire évoluer la configuration de sa ligne (ajouter un poste, une opération, une sortie) sans une intervention développeur — un gap direct par rapport à son besoin d'autonomie opérationnelle.

Pour la **direction et les exigences réglementaires** (Refashion DPAV, Métropole), le module fournit une bonne base : la taxonomie `categories_sortantes.famille_refashion` (réutilisation/recyclage/csr/élimination/retour, `init-db.js:1612-1654`) est correctement alignée sur les familles officielles Refashion, et les vues `vw_tonnage_reconciliation_jour`/`vw_refashion_dpav_source` croisent collecte, tri et DPAV. Mais deux défauts factuels minent la fiabilité de ce reporting : les volumes R3/R4 (« Recyclage Exclusif ») sont **structurellement enregistrés à zéro** (voir §5), et les cartons produits finis sont créés par trois voies aux niveaux de complétude différents, ce qui fragmente toute agrégation par catégorie ou par gamme.

## 3. Benchmark marché

Le contexte réglementaire pousse justement dans le sens de ce que SOLIDATA tente de faire : le nouveau cahier des charges Refashion 2026 fait de la traçabilité précise une condition du soutien REP (« chaque flux sera tracé, chaque euro justifié ») et pousse à l'abandon des méthodologies d'estimation au profit de balances et logiciels de caisse — SOLIDATA est donc positionné dans la bonne direction philosophique (pesée systématique, code-barres par carton). Les solutions spécialisées du marché pour le réemploi/recyclage textile (ex. RTS — Recycled Textiles Tracking System) reposent sur le même principe central : un identifiant de balle/carton unique servant de fil rouge pour la production, le mouvement, l'audit et l'expédition — ce que `produits_finis.code_barre` fait correctement **quand** il passe par le générateur d'étiquettes. Là où SOLIDATA prend du retard par rapport à un MES-léger de tri industriel classique, c'est sur le suivi de **productivité par poste** (temps de cycle, débit par station, détection de goulot d'étranglement) et sur l'absence d'un référentiel de configuration éditable — deux fonctions présentes dans les outils MES génériques mais que SOLIDATA ne fait qu'esquisser (le modèle `operation_executions` le permettrait techniquement, mais rien ne l'exploite côté KPI).

*(Recherches web ciblées effectuées : cahier des charges Refashion 2026/traçabilité ; logiciels de suivi production/bale-tracking textile.)*

## 4. Forces

- Modèle transactionnel solide sur la complétion d'exécution : verrou `FOR UPDATE`, garde anti-double-complétion, reversement automatique du stock trié par catégorie (`tri.js:314-386`) — corrige une rupture de traçabilité identifiée dans un audit antérieur (commentaire « I4 » dans le code).
- Taxonomie `categories_sortantes` correctement mappée sur les 5 familles Refashion officielles, avec ordre d'affichage et catégorie « Refus de tri » obligatoire.
- UX shop-floor soignée sur les deux outils réellement utilisés par les opérateurs (étiqueteuse, balance) : zéro friction de connexion sur la balance, parcours pas-à-pas tactile sur l'étiqueteuse.
- Intégration RH cohérente : `postes_operation.competences_requises` est réellement exploité par le planning hebdomadaire (`planning-hebdo.js`) pour exiger par exemple un CACES — pas un champ mort.
- Gouvernance de la feuille de production : objectifs périodiques, consignes datées avec priorité, clôture/réouverture tracée et réservée ADMIN.
- Hygiène sécurité de base conforme aux règles du projet : requêtes systématiquement paramétrées, `authenticate`/`authorize` cohérents sur les routes de mutation dans les 4 fichiers audités.

## 5. Faiblesses, manques, irritants UX

- **Volumes R3/R4 toujours à zéro** : `Production.jsx` (fonction `saveFeuille`) envoie en dur `entree_recyclage_r3_kg: 0` et `entree_recyclage_r4_kg: 0` à chaque enregistrement — aucun champ de saisie réelle n'existe dans la feuille pour ces deux flux, bien qu'ils soient affichés comme des KPI actifs avec objectifs éditables sur `ChaineTri.jsx` (vue « diagramme », premier écran vu par défaut), `Production.jsx` (vue mensuelle) et `ReportingProduction.jsx`. Le dashboard mensuel (`GET /production/dashboard`) calcule donc un total et une moyenne R3 toujours nuls sur la seule voie d'entrée existante.
- **Trois voies de création de `produits_finis` non harmonisées** : (1) `EtiquetteGenerer` → code-barres séquentiel `P<poste><base24>`, tous les attributs renseignés ; (2) formulaire manuel « Ajouter » de `ProduitsFinis.jsx` → l'utilisateur saisit un code-barres en texte libre, et le payload envoyé (`catalogue_id`, `code_barre`, `poids_kg`, `gamme`, `date_fabrication`) omet `produit`/`categorie_eco_org`/`genre`/`saison`, qui restent donc `NULL` en base bien que la route les accepte ; (3) sortie balance vers « Tri pré-classé »/« Original Conditionné » (`stock-original.js:118-126`) → code-barres ad hoc `PF-<timestamp>`, seulement 4 colonnes renseignées, **endpoint entièrement public** (monté avant `authenticate`) donc sans utilisateur attribué. Pour un domaine exposé publiquement (`solidata.online`), cela signifie qu'un tiers connaissant l'URL peut injecter des pesées et créer des cartons sans compte ni traçabilité d'auteur.
- **Référentiel de gammes obsolète dans le formulaire manuel** : `ProduitsFinis.jsx` propose « Gamme A — Premium / B — Standard / C — Déclassé » alors que le référentiel réel (`ref_dimensions`, depuis la refonte V2.1/V2.2, `init-db.js:1594-1602`) est `EXTRA/STANDARD/VAK/EXPORT`. Toute création via ce formulaire enregistre une valeur incompatible avec les filtres et la synthèse par gamme.
- **Code-barres saisi en texte libre** sur ce même formulaire manuel — aucune génération automatique, aucun contrôle de format, alors que le générateur d'étiquettes existe précisément pour fiabiliser cette saisie sur un public peu à l'aise avec la ressaisie de codes.
- **Aucune interface de configuration** des chaînes/opérations/postes/sorties — un changement de ligne (nouveau poste, nouvelle sortie) exige un accès direct à la base ou à l'API.
- **Pas de suivi de productivité par poste** : seul un ratio global (kg entrant ÷ effectif total) est calculé ; impossible d'identifier un poste en sous-régime malgré un modèle de données (`operation_executions`) qui le permettrait.
- Palette de couleurs de l'étiquette imprimée (`EtiquetteA4.jsx`, `GAMME_COLORS`) encore indexée sur les anciens codes (« BTQ STAND », « BTQ EXTRA », « CHIF », « Pvak », « A/B/C ») — les gammes actuelles EXTRA/STANDARD/EXPORT retombent sur un gris par défaut, perdant la différenciation visuelle rapide sur le carton physique.
- Champs `signature_encadrant`/`signature_direction` présents en base et acceptés par l'API historique, mais jamais renseignés par aucune page actuelle (fonctionnalité de signature de clôture orpheline) ; statut `produits_finis.status = 'colisé'` jamais assigné nulle part.
- Capacité multi-poste d'étiquetage (jusqu'à 9 postes en base) non exploitable : un seul poste est seedé, aucune UI n'en crée d'autre, et `EtiquetteGenerer.jsx` sélectionne toujours le premier poste actif sans sélecteur.

## 6. Recommandations priorisées

| # | Recommandation | Priorité | Effort |
|---|---|---|---|
| 1 | Réintroduire une saisie réelle (ou une source automatique équivalente à la balance) pour les entrées R3/R4 dans la feuille de production | P0 | S |
| 2 | Harmoniser les 3 voies de création de `produits_finis` (mêmes champs obligatoires, même format de code-barres) et attribuer systématiquement un auteur, y compris sur le flux balance | P0 | M |
| 3 | Ajouter une interface d'administration CRUD pour chaînes/opérations/postes/sorties, au lieu du seed figé | P1 | M |
| 4 | Aligner le formulaire manuel `ProduitsFinis.jsx` sur le référentiel réel de gammes (EXTRA/STANDARD/VAK/EXPORT), ou le retirer au profit du générateur d'étiquettes | P1 | S |
| 5 | Remplacer la saisie libre du code-barres par une génération automatique (même mécanisme que `EtiquetteGenerer`) sur le formulaire manuel | P1 | S |
| 6 | Ajouter un suivi de productivité par poste (temps, poids, opérateur) en exploitant `operation_executions` | P2 | L |
| 7 | Mettre à jour la palette `GAMME_COLORS` de l'étiquette imprimée sur les gammes actuelles | P2 | S |
| 8 | Statuer sur les champs orphelins (signatures de clôture, statut « colisé ») : réactiver ou purger | P2 | S |

## Conclusion

Le module « Chaîne de tri & production » repose sur une architecture de données ambitieuse et par endroits bien conçue (traçabilité par lot transactionnelle, taxonomie Refashion propre, intégration compétences/planning), mais son usage réel semble concentré sur la feuille agrégée et les deux outils terrain (étiqueteuse, balance), pendant que le sous-système de traçabilité fine reste largement en jachère faute d'ergonomie adaptée à un usage quotidien par les opérateurs. Les deux défauts P0 (R3/R4 à zéro, fragmentation des voies de création) faussent concrètement des chiffres qui remontent jusqu'à la direction et, potentiellement, jusqu'au reporting Refashion — ils méritent un traitement rapide au regard du durcissement 2026 de l'éco-organisme sur la précision de la traçabilité.
