# Note de présentation aux organismes de contrôle et de certification

**Système d'information de l'accompagnement socio-professionnel — module Insertion de l'ERP SOLIDATA**

*Destinataires : DDETS de Seine-Maritime (dialogue de gestion et contrôle ACI), Conseil départemental de Seine-Maritime, Convergence, organisme labellisateur RSEi.*

> **→ version finalisée : `docs/NOTE_CERTIFICATEURS_INSERTION.md`** (ajustée au périmètre livré PR 1 + PR 2, le 23/07/2026). Le présent brouillon est conservé pour la traçabilité de la conception.

> **Version projetée — établie sur les plans validés du 22/07/2026, à finaliser après développement.**
> La présente note décrit le dispositif tel qu'il a été conçu, validé en interne et passé au crible de deux revues indépendantes (revue utilisatrice UX/CIP et revue d'audit en posture DDETS/qualité). Le développement est engagé sur cette base ; la note sera actualisée et rééditée à la mise en production, après vérification de la conformité du réalisé au conçu.

---

## 1. Objet et contexte

Solidarité Textiles (Solidarité Emploi Textile en Normandie) est un atelier et chantier d'insertion (ACI) de la métropole de Rouen, spécialisé dans la collecte, le tri et la valorisation de textiles usagés. La structure est conventionnée au titre de la convention pluriannuelle ACI 2026-2028 n° C076ACI262800008 (Préfet de la Seine-Maritime, Conseil départemental 76), pour environ 46 salariés en insertion représentant 24,76 ETP conventionnés, encadrés par 3 encadrants techniques (3,00 ETP) et une conseillère en insertion professionnelle (0,86 ETP).

La structure a fait le choix d'un **ERP interne unique (SOLIDATA)** couvrant l'ensemble de son activité (collecte, tri, ventes, RH, finance). Le module Insertion, objet de la présente note, en constitue l'extension dédiée à l'accompagnement socio-professionnel. Ce choix répond à un constat simple : l'accompagnement était jusqu'ici documenté sur des supports bureautiques dispersés (formulaires Word, classeurs Excel), fidèles aux trames internes mais difficilement traçables, non horodatés, et coûteux à consolider pour le dialogue de gestion.

Le module a été conçu selon une démarche formalisée : cahier des charges de la direction, référentiel de **48 exigences numérotées et sourcées** (textes applicables, convention, trames internes — chacune assortie d'un critère d'acceptation vérifiable), plan fonctionnel et plan de codage, puis deux revues avant tout développement : une revue d'usage avec la CIP (garantie d'adoption et de qualité de saisie) et une revue d'audit conduite en posture d'instructeur DDETS / auditeur qualité, dont les réserves ont été intégrées aux plans. L'article 12 de la convention subordonnant le renouvellement du conventionnement à la présentation du bilan de l'article 5 et aux contrôles, la valeur probante du dispositif a été traitée comme une exigence de conception à part entière.

## 2. Comment SOLIDATA outille l'accompagnement

Le module organise, pour chaque salarié en insertion, un **dossier unique de parcours** structuré en entretiens historisés — datés, typés, signés au sens du § 3, exportables en PDF — reliés par une frise chronologique allant du recrutement au suivi post-sortie.

**Le parcours type outillé :**

- **Recrutement et entrée** : la liaison avec le module de recrutement reporte dans le dossier le prescripteur, le Pass IAE, les critères d'éligibilité retenus (y compris en auto-prescription, avec la localisation des justificatifs — les pièces restant conservées sur la plateforme de l'inclusion) et les éléments utiles au premier entretien.
- **Diagnostic d'accueil** : réalisé selon la trame interne en neuf rubriques (logement, accès aux droits, santé, budget, mobilité, situation et projet professionnels, expression du salarié), complétée de volets linguistique et — sous un régime strictement minimisé — judiciaire. Le module suit le **délai cible de 30 jours** après l'embauche : tout salarié en parcours sans diagnostic réalisé à 30 jours est signalé au tableau de bord. L'expression propre du salarié (attentes, difficultés, objectifs, aide souhaitée) alimente directement les objectifs du parcours, marqués « origine : salarié ».
- **Bilans de suivi** : multiples, à la fréquence individualisée fixée par la CIP. Chaque bilan **commence par l'évaluation du bilan précédent** (objectifs et actions repris automatiquement, statut renseigné, respect des échéances calculé par le système), historise les neuf axes de freins (avec une valeur « non évalué » honnête, exclue des moyennes), et **ne peut être clôturé sans la planification du rendez-vous suivant** — clef de voûte de la continuité du suivi.
- **Renouvellements de CDDI** : traités comme des entretiens à part entière, selon le circuit réel de la structure — formulaire renseigné par l'encadrant technique sur un écran dédié, complété par la CIP, validé par triple validation encadrant/CIP/directeur. Au-delà de 24 mois de CDDI cumulés, le motif de dérogation (formation en cours, 50 ans et plus, RQTH, CDI inclusion) et la date de décision sont exigés.
- **PMSMP** : enregistrées avec leurs objets légaux et leurs bornes contrôlées (un mois maximum par convention ; cumul de 60 jours sur 12 mois glissants apprécié **par organisme d'accueil** ; deux conventions au plus avec un même accueil, pour des objets différents), et la mention de la saisie dans l'outil officiel (Immersion Facilitée), conformément à l'article 3.3 de la convention.
- **Sortie et post-sortie** : bilan de sortie obligatoire (synthèse d'évolution, deltas de freins, actions restantes, catégorie officielle de sortie, liste de contrôle des documents remis — solde de tout compte, certificat de travail, attestation France Travail), questionnaire de satisfaction, puis entretien de **suivi post-sortie planifié automatiquement à +3 mois** (fenêtre 3-6 mois) avec saisie de la situation constatée.

**Le journal des actions d'accompagnement** répond directement à l'article 5 de la convention (« nature, objet, durée des actions de suivi individualisé et d'accompagnement ») : chaque action porte sa catégorie (nature), son libellé (objet), ses dates de création et d'échéance, sa **durée**, sa criticité, le **partenaire mobilisé** (référentiel administrable : CAF, France Travail, CPAM, ANTS, SOLIHA, bailleurs sociaux, OPCO, missions locales…) et son **résultat**. Les entretiens portent également leur durée. Le module agrège ainsi un volume d'heures d'accompagnement par salarié et global, substituant des données constatées aux estimations pour le dossier unique d'instruction et le bilan annuel.

Enfin, la conception a intégré la contrainte de moyens de la structure (0,86 ETP de CIP pour ~46 salariés) : pré-remplissages systématiques, saisie d'une action en moins d'une minute, préparation d'entretien assistée. Un outil de traçabilité qui ne serait pas utilisé ne prouverait rien ; l'adoption par l'utilisatrice a été traitée comme une condition de la conformité.

## 3. Traçabilité et auditabilité

Le dispositif a été conçu pour qu'un contrôleur puisse **reconstituer un parcours complet sur pièces**, depuis le module, sans retraitement.

- **Auteur et horodatage systématiques** : toute écriture porte son auteur ; les validations (salarié en présence, CIP, encadrant, directeur selon le type d'entretien) sont horodatées par compte.
- **Verrouillage des entretiens clôturés** : un entretien clôturé et validé est **gelé**. Toute correction passe par une réouverture explicite, motivée et journalisée (qui, quand, motif), qui rend caduques les validations antérieures — à refaire après correction. Un historique par instantanés conserve les états successifs du contenu, sur le modèle déjà éprouvé dans l'ERP pour les déclarations réglementaires Refashion.
- **Preuve de co-construction** : la validation en présence du salarié est complétée par la **traçabilité de la remise** du document (date et mode) et par la possibilité de rattacher à l'entretien le **scan de l'exemplaire signé** (double signature pour les bilans, triple pour les renouvellements, conformément aux trames internes). La structure ne revendique pas de signature électronique qualifiée : elle documente un faisceau — validation par compte, PDF remis, exemplaire papier signé numérisé.
- **Journalisation transverse** : les consultations de dossiers sensibles et **chaque export nominatif** sont journalisés (qui, quand, quel périmètre) dans le journal RGPD existant de l'ERP.
- **Migration documentée** : les données d'accompagnement antérieures sont reprises sans perte dans le nouveau modèle ; la classification historique des sorties est conservée en parallèle de la nouvelle nomenclature (voir § 4).

Le tableau ci-dessous reprend la liste de contrôle « jour J » établie lors de la revue d'audit interne : les pièces et démonstrations habituellement demandées lors d'un contrôle sur place (article 10 de la convention) et l'endroit où le module les fournit.

| # | Pièce ou démonstration demandée | Où le module la fournit |
|---|---|---|
| 1 | Liste des salariés en insertion de l'année (entrées, sorties, contrats, ETP) | Export insertion + tableau des freins 23 colonnes (générations journalisées ; variante agrégée pour toute transmission) |
| 2 | Dossier tiré au sort : diagnostic d'accueil daté, délai par rapport à l'embauche | Fiche salarié, onglet Diagnostic + PDF ; alerte « diagnostic > 30 jours » |
| 3 | Éligibilité IAE : Pass (n°, dates), critères d'auto-prescription, localisation des justificatifs | En-tête de fiche (Pass IAE) + champs d'éligibilité ; les pièces restent sur la plateforme de l'inclusion, l'ERP les référence sans les dupliquer |
| 4 | Historique complet des entretiens datés, typés, avec contenu | Frise chronologique + onglet Entretiens & bilans + PDF par entretien ; contenus gelés à la clôture, réouvertures journalisées |
| 5 | Preuve de co-construction : validations du salarié, remise des documents | Bloc de validations horodatées + remise tracée (date, mode) + exemplaire signé numérisé rattaché |
| 6 | Journal des actions d'accompagnement : nature, objet, date, durée, partenaire, résultat (art. 5) | Page Actions CIP + export CSV filtrable ; agrégat d'heures d'accompagnement |
| 7 | Objectifs individualisés et leur suivi (échéances, dates butoirs, statuts) | Onglet Objectifs & actions ; l'origine « salarié / CIP » de chaque objectif matérialise la co-construction |
| 8 | Justification d'un renouvellement de CDDI | Entretien Renouvellement + PDF : formulaire encadrant, avis, durée, triple validation |
| 9 | Motif de dérogation d'un parcours > 24 mois + date de décision | Fiche : badge de cumul CDDI + motif ; file « dérogations à régulariser » pour les contrats entrés par la paie |
| 10 | PMSMP : conventions, objets légaux, bornes respectées, saisie dans l'outil officiel | Table PMSMP de la fiche + segments de frise ; bornes contrôlées par organisme d'accueil ; le Cerfa signé reste au dossier |
| 11 | Bilan de sortie : synthèse, évolution des freins, catégorie, documents remis | Entretien Bilan de sortie + liste de contrôle + PDF ; clôture impossible sans catégorie ni documents |
| 12 | Tableau des sorties de l'année et taux par catégorie vs objectifs négociés | Tableau de bord insertion + export de synthèse ; règle de calcul documentée à l'écran |
| 13 | ETP réalisés vs conventionnés ; états de présence | Bloc « contrôle » du tableau de bord + module pointage/heures ; la saisie ASP fait foi (étiquette explicite) ; rapprochement mensuel ERP ↔ ASP |
| 14 | Typologie des publics à l'entrée (bRSA, AAH, RQTH, niveaux de formation…) | Bloc typologies + export agrégé non nominatif, sur nomenclatures officielles |
| 15 | Preuve du suivi post-sortie 3-6 mois | Entretien Suivi post-sortie (situation constatée, date) ; opposition éventuelle de la personne consignée |
| 16 | Enquêtes de satisfaction de sortie et leur exploitation | Saisie liée au bilan de sortie + restitution annuelle anonymisée |
| 17 | Synthèse pour comités de pilotage (2×/an, art. 3.4) et bilan annuel | Export de synthèse agrégé PDF/CSV ; les comptes rendus de séance restent hors ERP |
| 18 | Registre RGPD, AIPD, note d'information remise, consultation du CSE | Module RGPD : entrée au registre, AIPD, note d'information versionnée, trace de la consultation du CSE |
| 19 | Journal des consultations sensibles et des exports nominatifs | Journal RGPD (qui, quand, quoi) — dispositif existant de l'ERP |
| 20 | Démonstration que l'IA n'a pas décidé (art. 22 RGPD / règlement IA) | Notes « Proposition IA » historisées et éditées par la CIP, pseudonymisation vérifiable, note d'information |

## 4. Qualité du reporting

- **Nomenclature officielle des sorties.** Le module classe chaque sortie selon la nomenclature ASP/DREETS — emploi durable, emploi de transition, sortie positive, autres sorties (avec sous-motifs) — et une destination détaillée. La règle de calcul des taux (numérateur, dénominateur « sorties constatées », période) est documentée à l'écran et dans les exports. La classification binaire antérieure est conservée à titre historique ; le premier bilan annuel produit avec le nouvel outil sera accompagné d'une **note méthodologique de bascule** signalant le changement d'outil et de nomenclature (2026), afin d'expliquer d'éventuels écarts avec les séries antérieures.
- **Indicateurs du dialogue de gestion.** Le tableau de bord consolide : taux de sorties par catégorie et taux de sorties dynamiques comparés aux objectifs conventionnels, ETP réalisés, typologie des publics à l'entrée, délai moyen de réalisation des diagnostics, entretiens dans les délais, renouvellements et Pass IAE à préparer, PMSMP et formations de l'année. Par doctrine interne (« indicateurs honnêtes »), **aucun objectif conventionnel n'est codé en dur** : les valeurs cibles sont paramétrées après confirmation sur les documents contractuels originaux — au plus tard avant le premier bilan annuel — et, dans l'intervalle, le tableau affiche « objectif non paramétré » plutôt qu'un chiffre non vérifié.
- **Articulation assumée avec les systèmes d'information de l'État.** SOLIDATA **prépare et contrôle** le reporting ; il **ne se substitue à aucune saisie officielle** : extranet ASP (états mensuels de présence, récapitulatifs des 5ᵉ, 10ᵉ et dernier mois), plateforme des emplois de l'inclusion (fiches salariés, Pass IAE et prolongations), Immersion Facilitée (PMSMP). Cette position est affichée à l'écran et **imprimée sur chaque export** (« Document de travail ERP — les saisies officielles font foi »), afin qu'aucun document issu de l'ERP ne puisse être pris pour une déclaration officielle. Un écran de rapprochement mensuel entre les heures de l'ERP et les états validés ASP transforme cette articulation en contrôle effectif de cohérence.

## 5. Protection des bénéficiaires

Le module traite des données de personnes en situation de vulnérabilité, dont des données de santé (article 9 RGPD) et, de façon strictement minimisée, des données relevant de l'article 10. Les garanties suivantes sont intégrées à la conception :

- **Analyse d'impact (AIPD)** : le traitement relevant des cas où l'AIPD est requise (accompagnement social, personnes vulnérables, données sensibles, évaluation systématique, assistance IA), une AIPD a été **engagée avant le développement** — ses conclusions pouvant modifier la conception — et sera **validée par le délégué à la protection des données avant la mise en production**, référencée dans l'entrée au registre des traitements.
- **Minimisation par construction** : le NIR, l'IBAN et le numéro d'allocataire CAF sont **exclus du schéma de données** (les champs n'existent pas). Les données de santé sont limitées à l'impact professionnel déclaré (contre-indications, RQTH et échéance, existence d'un suivi) ; le volet judiciaire ne comporte que le niveau de frein et l'impact organisationnel factuel — **jamais la nature des faits ni les condamnations** —, avec un rappel de cette interdiction affiché à la saisie. Les restitutions externes travaillent en données réduites (tranches d'âge, nationalité en trois classes, agrégats).
- **Sécurité et habilitations** : chiffrement applicatif des textes libres santé et judiciaire ; matrice d'habilitations par rôle (l'encadrant technique n'accède jamais aux volets santé, judiciaire ou budget ; le rôle auditeur externe n'accède qu'à des agrégats non nominatifs ; le frein judiciaire est exclu par défaut des exports), **couverte par des tests automatisés** rejoués à chaque livraison ; journalisation des accès sensibles et des exports.
- **Information et droits** : note d'information versionnée (finalités, destinataires, durées, droits, existence de l'assistance IA), remise tracée, référencée en pied de page de chaque PDF généré ; droit d'accès exercé notamment par la remise du PDF « exemplaire dossier » ; durées de conservation alignées sur le référentiel CNIL du secteur social et médico-social (base active limitée à 2 ans après le dernier contact, puis anonymisation automatique — les agrégats statistiques anonymes étant seuls conservés) ; pour le contact post-sortie, la personne est informée dès le bilan de sortie et son opposition éventuelle est consignée et respectée. Le comité social et économique est informé et consulté avant la mise en service.
- **IA strictement préparatoire** : l'assistance IA prépare des notes d'entretien et des synthèses. Tout appel est **pseudonymisé en amont** (aucune identité transmise au fournisseur), les sorties sont étiquetées « Proposition », éditables et historisées ; aucun score n'est imposé (les niveaux de freins proposés restent à la main de la CIP) et **aucune décision produisant des effets juridiques n'est automatisée** (article 22 RGPD). Les obligations de déployeur au titre du règlement européen sur l'IA (information des salariés et de leurs représentants, supervision humaine effective, journalisation) sont intégrées, et l'encadrement de la sous-traitance IA (garanties de transfert) est vérifié par le DPO.

## 6. Démarche qualité et amélioration continue

Le module referme la boucle qualité que les procédures internes prévoyaient déjà sur le papier :

- **Écoute des bénéficiaires** : questionnaire de satisfaction systématique à la sortie (accueil, accompagnement, compétences, conditions de travail, bilan personnel, situation à la sortie, satisfaction globale, suggestions), restitué exclusivement en agrégats anonymisés annuels.
- **Mesure des effets** : suivi post-sortie à 3-6 mois (situation constatée), évolution objectivée des freins entre l'entrée et la sortie, taux de sorties par catégorie.
- **Revues formalisées** : une revue annuelle croise résultats de satisfaction, situations post-sortie et indicateurs d'accompagnement, et débouche sur un **plan d'amélioration daté** ; un référentiel interne d'analyse de la pratique d'accompagnement (document distinct, conçu avec des garde-fous déontologiques explicites : agrégats, co-analyse, aucune notation individuelle) alimente des revues mensuelles avec la CIP et trimestrielles avec la direction.
- **Lien avec le label RSEi** : la structure est engagée dans une démarche de labellisation RSEi, qui fait l'objet d'une mission dédiée ; les éléments produits par le module (traçabilité de l'accompagnement, boucle d'écoute, indicateurs sociaux) constituent des preuves directement mobilisables pour le référentiel du label, et réciproquement les revues du label nourrissent le plan d'amélioration du module.

## 7. Limites assumées et calendrier de déploiement

Par transparence, la structure souhaite porter à la connaissance des organismes destinataires les limites suivantes, qui relèvent de choix documentés et non d'angles morts :

1. **Statut projeté.** À la date de la présente note, le module décrit est validé en conception (plans + deux revues) mais **non encore développé**. Aucune démonstration sur logiciel ne peut être proposée avant les premières livraisons ; la présente note sera rééditée à la mise en production.
2. **Pas de substitution aux plateformes de l'État.** L'ERP prépare et contrôle ; les saisies officielles (ASP, emplois de l'inclusion, Immersion Facilitée) demeurent la référence opposable. Un risque résiduel de divergence entre les deux saisies existe ; il est traité par le rapprochement mensuel et la mention portée sur les exports.
3. **Signature.** La structure met en œuvre des validations horodatées par compte, la remise tracée et le rattachement de l'exemplaire papier signé numérisé — non une signature électronique qualifiée, jugée disproportionnée pour ce contexte.
4. **Vue salarié en ligne reportée.** Les salariés n'ont pas d'accès en ligne à leur dossier dans cette version ; le droit d'accès s'exerce par les documents remis et le circuit RGPD existant. L'opportunité d'un espace salarié sera réexaminée après le déploiement.
5. **Espace encadrant technique complet en phase 2.** Le formulaire de renouvellement rempli par l'encadrant sur écran dédié est livré dès la phase initiale (c'est le maillon critique du circuit) ; les grilles de compétences métier et le portefeuille de compétences suivront en phase 2, après retours d'usage. Dans l'intervalle transitoire éventuel, un formulaire papier encadrant retranscrit par la CIP est admis, avec mention d'origine.
6. **FSE+ conditionnel.** La vérification de l'existence d'un cofinancement FSE+ (direct ou via le Département) a été inscrite comme préalable ; si elle est confirmée, le recueil des données participants à l'entrée et à la sortie et l'archivage en piste d'audit séparée seront intégrés dès la livraison de conformité, le recueil à l'entrée n'étant pas rattrapable a posteriori.
7. **Rupture de série statistique 2026.** Le passage à la nomenclature officielle des sorties crée une rupture de série assumée, documentée par la note méthodologique jointe au premier bilan annuel concerné.

**Calendrier prévisionnel** : développement en deux livraisons — (1) socle des entretiens historisés, diagnostic d'accueil refondu, objectifs et journal d'actions ; (2) conformité IAE (Pass, PMSMP, renouvellements, sorties, post-sortie), frise et fiche unifiée, tableau de bord et exports, assistance IA — suivies d'une phase 2 (espace encadrant complet). La **mise en production est conditionnée** à : validation de l'AIPD par le DPO, entrée au registre des traitements, consultation du CSE, tests d'habilitations verts, note d'information diffusée, et vérification de la migration sans perte des données existantes.

La structure se tient à la disposition des organismes destinataires pour présenter le dispositif, sur pièces ou sur site, et intégrer leurs observations avant la mise en production.

---

*Note établie le 22/07/2026 par la direction de Solidarité Textiles, sur la base des livrables de conception (référentiel d'exigences, plans fonctionnels, revue d'usage CIP, revue d'audit) archivés et disponibles sur demande. Contact protection des données : dpo@solidarite-textiles.fr.*
