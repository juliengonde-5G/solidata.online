# Benchmark marché — SOLIDATA vs outils leaders du suivi & de la traçabilité des déchets (et du textile)

> **Audit exhaustif 2026 — volet 09**
> Date : 3 juillet 2026 — Toutes les URL citées ont été consultées le **3 juillet 2026**.
> Périmètre : comparaison de SOLIDATA (ERP interne de Solidarité Textiles, 27 modules — cf. `CLAUDE.md` §5) avec les acteurs du marché sur 6 axes : logiciels métier déchets, traçabilité réglementaire française, traçabilité textile/circularité, Passeport Numérique Produit (DPP), capteurs de remplissage, tri optique matière/couleur.
> Méthode : recherches web FR + EN (juillet 2026), croisement avec le code SOLIDATA (grep `trackdechets|RNDTS|GS1|bascule`). **Les informations introuvables ou incertaines sont signalées comme telles** — aucun prix ni fonctionnalité n'a été inventé.

---

## 0. Synthèse exécutive

SOLIDATA occupe une position **atypique et défendable** : aucun outil du marché identifié ne couvre, dans un seul produit, la chaîne verticale d'une SIAE textile — collecte CAV avec capteurs IoT et IA prédictive, chaîne de tri avec batch tracking, logistique exutoires, boutiques seconde main, vente au kilo, reporting éco-organisme Refashion, ET accompagnement d'insertion (CDDI, jalons, freins). Pour répliquer ce périmètre, il faudrait assembler au moins 4 outils du marché (ex. AMCS ou Ecocito + Simpliciti CITI'PAV + un logiciel SIAE type Logys AMAGIS + la caisse LogicS/SumUp), sans le liant Refashion.

En revanche, trois lames de fond réglementaires et technologiques arrivent d'ici 2026-2029 et ne sont **pas couvertes** : (1) le **registre national des déchets (RNDTS)**, désormais déclaré via Trackdéchets, qui vise aussi les installations de tri de déchets **non dangereux** ; (2) la **facturation électronique** (réception obligatoire 09/2026, émission PME 09/2027) ; (3) le **Passeport Numérique Produit textile** (acte délégué attendu ~2027, application ~2028-2029), qui transformera le tri : chaque vêtement portera un QR/DataMatrix lisible donnant sa composition. La future **sonde matière/couleur** (type Matoha) et la préparation DPP/GS1 sont les deux opportunités structurantes.

---

## 1. Panorama par catégorie

### 1.1 Logiciels métier gestion des déchets / recyclage

| Acteur | Origine | Fonctionnalités clés | Prix | Pertinence SIAE textile |
|---|---|---|---|---|
| **AMCS Platform** (+ Recy Systems, racheté) | Irlande, leader mondial | Pesée pont-bascule intégrée, **grading matière mobile** (composition, humidité, contamination, ajustement prix/qualité avec photos), stocks temps réel, optimisation tournées, facturation auto, paiements cashless, archivage numérique ; Recy = ERP négoce recyclage (achats/ventes matière, 600+ clients) | Sur devis (non public) | Référence fonctionnelle « grading + pesée + négoce », mais dimensionné grands opérateurs ; pas de spécificité TLC/REP française |
| **Divalto** (métier déchets) | France (ERP) | Tournées, gestion flotte, connecteur géolocalisation **PTV/Ubiwan** (app chauffeur, géoloc bacs) | Sur devis | ERP généraliste adapté ; pas de tri textile |
| **CAP Vision / CAP Collecte** | France | ERP déchets sur **Microsoft Dynamics 365 Business Central**, interfaçage **ponts-bascule**, facturation au poids/type de déchet, synchro temps réel des flux | Sur devis | Bon étalon « pesée interfacée → facturation » |
| **Tradim — Ecocito** | France | Traçabilité réglementaire (**CAP, BSD**), pesées multisites/multifilières, facturation personnalisée | Sur devis | Étalon « conformité réglementaire française » |
| **GESBAC** | France (1986) | Gestion déchets collectivités (historique) | n.c. | Faible (orienté collectivités) |
| **Arkelia — SigmaRecyc** | France | Pesage et transit matières via pont-bascule/balance camion | n.c. | Pesée uniquement |
| **UNICO** | France | Se présente comme « 1er logiciel métier dédié à la collecte des déchets » | n.c. | Collecte uniquement |
| **Sinari** | France | TMS transport/déchets ; communique sur les échéances Trackdéchets 2026 | n.c. | Transport uniquement |
| **Simpliciti — CITI'PAV** | France | **Optimisation des tournées de collecte en points d'apport volontaire** : app embarquée chauffeur (tablette), remontée automatique des taux de remplissage par capteurs, planification par remplissage réel, portail Geored Online | Sur devis | **Concurrent fonctionnel le plus proche du module Collecte de SOLIDATA** (CAV = PAV) |

**Introuvables / non concluants (à dire explicitement)** : les noms **« Héva », « C-Ways », « Trackyz », « iWaste », « Ecorec » et « Hexavia »** n'ont pas pu être rattachés à des éditeurs actifs de logiciels déchets lors des recherches du 03/07/2026 (Hexavia est un réseau d'entreprises, Ecorec correspond à des recycleurs, pas à des éditeurs). Possible confusion de noms ou acteurs trop confidentiels — à re-vérifier si le commanditaire a des sources précises.

Sources : [AMCS waste & recycling](https://www.amcsgroup.com/industries/waste-and-recycling/) ; [AMCS mobile grading](https://www.amcsgroup.com/resources/blogs/mobile-app-provides-in-process-material-grading/) ; [Recy Systems (AMCS)](https://www.amcsgroup.com/solutions/enterprise-management/recy-systems/) ; [CAP Vision ERP déchets](https://www.capvision.fr/solutions/logiciels-metiers/erp-gestion-dechets/) ; [Divalto gestion des déchets](https://www.divalto.com/metier/gestion-des-dechets/) ; [Tradim Ecocito](https://www.tradim.com/ecocito-logiciel-gestion-dechets/) ; [GESBAC](http://www.gesbac.fr/) ; [Arkelia SigmaRecyc](http://www.arkelia.com/sigmarecyc-fonctions.html) ; [UNICO](https://www.unicofrance.com/) ; [Sinari — Trackdéchets 2026](https://www.sinari.com/blog/reglementation-trackdechets) ; [Simpliciti CITI'PAV](https://www.simpliciti.fr/en/our-solutions/environment/voluntary-drop-off-collection/). (Consultées le 03/07/2026.)

---

### 1.2 Traçabilité réglementaire française

**a) Trackdéchets (BSD dématérialisé) — s'applique-t-il aux textiles ?**
- Trackdéchets est **obligatoire pour les déchets dangereux** (BSDD), DASRI, amiante, VHU, etc. Depuis le **1er janvier 2026**, l'obligation s'étend à **tous les transporteurs** impliqués dans la collecte/le groupement/le transport de déchets dangereux ([Sinari](https://www.sinari.com/blog/reglementation-trackdechets), consulté le 03/07/2026).
- Les **TLC usagés sont des déchets non dangereux** : **pas de BSD obligatoire**. Le suivi d'un déchet non dangereux dans Trackdéchets est **possible mais volontaire** (en remplissant les champs du BSDD) ([FAQ Trackdéchets](https://faq.trackdechets.fr/informations-generiques/reglementation/quest-ce-que-trackdechets/les-fonctionnalites-de-trackdechets) ; [ORDECO — TLC](https://www.ordeco.org/dechets/textiles-linges-chaussures-tlc), consultés le 03/07/2026). Exception : chiffons souillés par produits toxiques = déchets dangereux.
- Trackdéchets expose une **API GraphQL publique documentée** permettant aux SI métier de créer/signer/suivre des BSD et d'**exporter les registres** ; le code est open source ([doc.trackdechets.fr](https://doc.trackdechets.fr/) ; [developers.trackdechets.beta.gouv.fr](https://developers.trackdechets.beta.gouv.fr/) ; [GitHub MTES-MCT/trackdechets](https://github.com/MTES-MCT/trackdechets), consultés le 03/07/2026).

**b) RNDTS / registre national des déchets — le vrai sujet pour un centre de tri TLC.**
- Le décret n° 2021-321 du 25 mars 2021 a créé le registre national. L'article **R541-43 du code de l'environnement** impose un **registre chronologique** (production, expédition, réception, traitement) aux « exploitants des établissements produisant ou expédiant des déchets, collecteurs, transporteurs, négociants, courtiers, et **exploitants des installations de transit, de regroupement ou de traitement de déchets** » — **y compris pour les déchets non dangereux** — avec **transmission électronique depuis le 1er janvier 2022** ; contenu fixé par l'**arrêté du 31 mai 2021** ([Légifrance — arrêté 31/05/2021](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000043884563) ; [Légifrance — R541-42 à R541-48](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074220/LEGISCTA000006176982/) ; [ecologie.gouv.fr — traçabilité des déchets](https://www.ecologie.gouv.fr/politiques-publiques/tracabilite-dechets-terres-excavees-sediments), consultés le 03/07/2026).
- Depuis le **5 mai 2025**, les déclarations RNDTS se font **dans Trackdéchets** (fusion des plateformes), avec une tolérance jusqu'au 31/12/2025 pour rattraper les registres non dangereux de 2025 ([RNDTS — annonce fusion](https://rndts-diffusion.developpement-durable.gouv.fr/fr/actualite/actualite/trackdechets-rndts-une-seule-plateforme-pour-vos-declarations-des-mai-2025) ; [FAQ Trackdéchets registre national](https://faq.trackdechets.fr/registre-national/informations-generales), consultés le 03/07/2026). Délai de déclaration : 1 mois après expédition/réception.
- **Conséquence pour Solidarité Textiles** : un centre de tri TLC est une installation de tri/transit de déchets non dangereux (ICPE, rubrique 2714 vraisemblable) → il entre **a priori dans le périmètre du registre déchets non dangereux entrants/sortants et de sa télédéclaration**. ⚠️ Le grep du dépôt SOLIDATA (03/07/2026) ne retourne **aucune occurrence** de `trackdechets`/`RNDTS` : ni module, ni export. **Gap réglementaire à faire confirmer par un juriste/la DREAL** (seuils et modalités exacts pour un opérateur sous convention Refashion à préciser — non tranché par nos sources).

**c) Facturation électronique 2026-2027.**
- **1er septembre 2026** : toutes les entreprises (dont Solidarité Textiles) doivent pouvoir **recevoir** des factures électroniques ; grandes entreprises : émission. **1er septembre 2027** : **émission obligatoire pour PME/TPE/micro**. Transit obligatoire par une **Plateforme Agréée (PA)**, formats structurés **Factur-X / UBL / CII** ([economie.gouv.fr](https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises) ; [Urssaf](https://www.urssaf.fr/accueil/actualites/facturation-electronique.html) ; [impots.gouv.fr](https://www.impots.gouv.fr/depliant-la-facturation-electronique-en-4-questions) ; [calendrier Cegid](https://www.cegid.com/fr/facture-electronique-obligatoire/calendrier-facture-electronique/), consultés le 03/07/2026).
- SOLIDATA génère des factures internes (module 10) et fait du **PULL Pennylane** (module 23). Pennylane se positionne explicitement sur la réforme ([Pennylane — réforme 2026](https://www.pennylane.com/fr/fiches-pratiques/facture-electronique/reforme-facturation-electronique), consulté le 03/07/2026) : la voie la plus économe est de **faire porter l'e-facturation par Pennylane en tant que plateforme**, et d'adapter SOLIDATA (statuts de cycle de vie des factures, référencement des flux) plutôt que de développer un raccordement PA natif.

**d) Registre Refashion.** Le reporting éco-organisme (DPAV trimestriel, soutiens) reste **déclaratif via les outils Refashion** — pas d'API publique identifiée au 03/07/2026 (le CLAUDE.md liste d'ailleurs « Connexion Refashion API (quand disponible) » en vision long terme). À noter : soutien financier exceptionnel aux opérateurs de tri conventionnés — **≥ 49 M€ en 2025, 57 M€ en 2026** (arrêté du 13 août 2025) — signe d'une filière sous tension économique ([Refashion Pro — opérateurs de tri](https://pro.refashion.fr/fr/op%C3%A9rateurs-de-tri), consulté le 03/07/2026).

---

### 1.3 Traçabilité textile & circularité

| Acteur | Positionnement | Points clés (03/07/2026) | Pertinence pour un trieur SIAE |
|---|---|---|---|
| **Reverse Resources** | SaaS de traçage des **déchets textiles** de la source au recycleur | 1 211 fabricants, 239 recycleurs, **166 « waste handlers » (collecteurs/trieurs)**, 18 marques ; > 100 000 t tracées, ~50 % vers du recyclage textile-à-textile ; modules dédiés collecteurs/trieurs/pré-processeurs | **Élevée** : c'est LE modèle de données « lots de matière triée → recycleur » ; canal potentiel de valorisation des fractions recyclage |
| **TrusTrace** | Traçabilité chaîne d'appro fibre→produit (Stockholm, 2016) | Clients H&M, ASOS, Decathlon ; se positionne EUDR/CSDDD/**DPP ESPR** | Moyenne (outil de marques, pas de trieurs) — à connaître car les donneurs d'ordre l'utilisent |
| **Retraced** | Compliance & due diligence supply chain mode | Plateforme collaboration fournisseurs | Faible directe |
| **TextileGenesis / Textile Exchange « Trackit »** | Pilote d'**interopérabilité** entre plateformes de traçabilité (avec TrusTrace, Retraced) en 2025 | Framework multi-plateformes | Signal de standardisation à surveiller |
| **circular.fashion — circularity.ID®** | **DPP avant l'heure** + **stations de tri intelligentes** | Le trieur scanne l'ID → composition exacte + **valeur de revente** ; pilotes avec **FairWertung** (fédération allemande des collecteurs) ; 2 stations installées en Allemagne | **Très élevée** : préfigure exactement le poste de tri SOLIDATA post-DPP |
| **EON** | Protocole « Circular Product Data » (US) | Standardisation des données produit circulaires | Veille |
| **Refashion RECYCLE** (recycle.refashion.fr) | Plateforme de **mise en relation trieurs ↔ recycleurs** à l'échelle européenne | ~450 organisations, 103 recycleurs et 66 trieurs onboardés ; sourcing de débouchés par région | **Élevée et gratuite** : Solidarité Textiles devrait y référencer ses fractions |
| **Standards : GS1** | GTIN + **GS1 Digital Link** (QR/DataMatrix/RFID) retenus comme socle probable du DPP (travaux avec la Commission et **CIRPASS-2**) | Identifiants article/lot pour réemploi, revente, recyclage textile | **Structurant** : adopter GTIN/Digital Link sur les produits finis = se rendre DPP-ready |

Sources : [Reverse Resources](https://www.reverseresources.net/) ; [EU Textiles Ecosystem — cas Reverse Resources](https://transition-pathways.europa.eu/textiles/best-practices/connecting-actors-textile-value-chain-through-digital-platforms-case) ; [TrusTrace](https://trustrace.com/) ; [Retraced](https://www.retraced.com/) ; [pilote Trackit (RTIH)](https://retailtechinnovationhub.com/home/2025/2/5/trustrace-joins-textile-exchange-trackit-supply-chain-pilot-project-alongside-retraced-and-textilegenesis) ; [circularity.ID (FashionUnited)](https://fashionunited.com/news/fashion/making-circularity-a-reality-with-circularity-id/2022052347720) ; [EON](https://eon.xyz/initiatives/circular-product-data-protocol) ; [UIT — plateforme RECYCLE](https://www.textile.fr/en/actualite/recycle-plateforme-digitale-de-mise-en-relation-des-acteurs-du-recyclage-de-refashion) ; [Refashion Pro — RECYCLE](https://pro.refashion.fr/en/recycler/plateform-recycle-refashion) ; [GS1 — standards DPP](https://www.gs1.org/standards/standards-emerging-regulations/DPP) ; [GS1 in Europe — DPP](https://gs1.eu/activities/digital-product-passport/) ; [GS1 — DPP textile & footwear](https://support.gs1.org/support/solutions/articles/43000758759-which-dpp-information-do-you-envision-for-textile-and-footwear-products-). (Consultées le 03/07/2026.)

---

### 1.4 Passeport Numérique Produit (DPP / ESPR)

- **Calendrier réel (état au 03/07/2026)** : l'ESPR est en vigueur ; le textile est prioritaire dans le plan de travail 2025-2030. **L'acte délégué textile est attendu en 2027 (plusieurs analyses convergent sur ~T2 2027)**, suivi d'une transition d'au moins **18 mois** → application **fin 2028 / 2029**. Les dates ont déjà glissé une fois et peuvent encore bouger ([Carbonfact](https://www.carbonfact.com/blog/policy/digital-product-passport-fashion) ; [Regen Studio — acte délégué textile](https://www.regenstudio.world/blog/espr-textile-delegated-act/) ; [PassportCraft — timeline ESPR](https://passportcraft.com/insights/espr-timeline-what-brands-need-to-know), consultées le 03/07/2026).
- **Ce que le DPP change pour un centre de tri/réemploi** : le DPP sera accessible via un **support de données scannable** (QR, DataMatrix, RFID/NFC) apposé sur le produit ; des données spécifiques sont prévues **pour les acteurs de fin de vie** (composition/pureté matière, instructions de démontage) afin de faciliter tri et recyclage ([TracexTech — DPP textiles](https://tracextech.com/digital-product-passports-for-textiles/) ; [Ecochain — DPP 19 questions](https://ecochain.com/blog/digital-product-passports-dpp-everything-manufacturers-need-to-know-19-questions-answered/), consultées le 03/07/2026). Concrètement : à horizon 2029+, une part croissante du gisement entrant portera une étiquette lisible machine donnant la composition — **le poste de tri devient un poste de scan**. Point d'incertitude honnête : les obligations *propres* aux opérateurs de réemploi/seconde main (faut-il maintenir/mettre à jour le DPP d'un produit revendu ?) ne sont pas encore fixées — elles dépendront de l'acte délégué.
- **Cadre européen connexe** : collecte séparée des textiles obligatoire dans toute l'UE depuis le **1er janvier 2025** ; la **directive-cadre déchets révisée** (accord février 2025, publiée à l'automne 2025) impose une **filière REP textile harmonisée dans toute l'UE**, les producteurs finançant collecte/tri/réemploi/recyclage, avec ~30 mois de transposition ([Commission — représentation en France, 16/10/2025](https://france.representation.ec.europa.eu/informations/de-nouvelles-regles-en-matiere-de-dechets-visant-renforcer-la-circularite-du-secteur-textile-et-2025-10-16_fr) ; [Parlement européen](https://www.europarl.europa.eu/news/fr/press-room/20240212IPR17625/nouvelles-regles-pour-reduire-les-dechets-et-soutenir-l-economie-circulaire) ; [FashionUnited FR](https://fashionunited.fr/actualite/business/16-octobre-2025-cap-sur-la-durabilite-pour-le-textile-europeen-avec-la-nouvelle-directive-dechets/2025101639674), consultées le 03/07/2026). Effet attendu : plus de gisement, plus d'exigences de reporting, plus d'acteurs REP européens homologues de Refashion.
- **Initiatives françaises** : Refashion co-pilote la standardisation NIR (cf. §1.6) et anime la plateforme RECYCLE ; nous n'avons **pas identifié de programme DPP français dédié aux opérateurs de tri** au 03/07/2026 (au-delà des travaux CIRPASS-2/GS1 auxquels la France participe) — point à surveiller côté Refashion/ADEME.

---

### 1.5 Capteurs de remplissage & optimisation de collecte

| Acteur | Techno | Points clés (03/07/2026) | Prix |
|---|---|---|---|
| **Sensoneo** (SK) | Ultrason/radar + plateforme WMS + **route planning** + app chauffeur | Mesures pluri-quotidiennes, détection feu/basculement ; études de cas −30 % à −63 % de coûts de collecte | Sur devis |
| **Ecube Labs** (KR) | **CleanFLEX** ultrason 2-400 cm, IP67/IK10, LoRaWAN/NB-IoT + plateforme CCN | Détection feu/basculement/couvercle ouvert | Sur devis |
| **Heyliot** (FR, BH Environnement) | Capteur **ToF** (photons) — pertinent pour le textile (l'ultrason est perturbé par les textiles souples) ; **LoRaWAN/Sigfox bi-mode** ; résistant au lavage haute pression | **Testé sur des bornes textile à Poitiers** (lutte anti-dépôts sauvages), Trilib' Citeo à Paris, Rennes Métropole ; levée de fonds ~2,5 M€ | Sur devis |
| **Sigrenea** (Suez) | Ultrason, GSM + radio courte portée, offre aEner'COM / S.Monitor | 1 400+ conteneurs télé-relevés à Tours et Orléans ; acteur historique des colonnes d'apport volontaire | Sur devis |
| **Akanthas** (FR, Toulouse 2021) | **Caméra optique autonome** (solaire + 4G) + IA | Caractérisation automatique du contenu : 50 typologies de déchets, ~95 % de précision matière/volume annoncée, rapports PDF | Sur devis |
| **Enevo** | — | ⚠️ **Faillite 2020-2021** ; actifs repris par **Reen** (groupe ABAX, Norvège) | — (leçon : risque fournisseur sur ce marché) |
| **Citec Environnement** | — | **Fabricant de conteneurs PAV** (devenu ESE France), pas un éditeur de capteurs — la mention « Citec » comme solution logicielle est une confusion | — |

**Comparaison avec l'existant SOLIDATA** : le module capteurs (V1.4.2) — **Milesight EM400-MUD** (ultrason ToF) via **Orange Live Objects** (API + MQTT + webhook), pages AdminSensors, hook temps réel — plus l'IA prédictive maison (météo Open-Meteo, saisonnalité, feedback loop `collection_learning_feedback`) et l'optimisation de tournées OSRM placent SOLIDATA **au niveau fonctionnel des leaders** (mesure → prédiction → tournée dynamique → app chauffeur). Ce qui manque face à Sensoneo/Simpliciti : l'**abstraction multi-constructeurs** (mono-Milesight/mono-Live Objects aujourd'hui), les alertes matérielles enrichies (feu/basculement), et la profondeur de recul opérationnel (calibration de la précision sur textile). **Heyliot est le fournisseur alternatif à qualifier en priorité** (français, LoRa, éprouvé sur bornes textile).

Sources : [Sensoneo fill-level](https://www.sensoneo.com/waste-fill-level/) ; [Sensoneo route planning](https://www.sensoneo.com/products/route-planning/) ; [Ecube Labs CleanFLEX](https://www.ecubelabs.com/ultrasonic-fill-level-sensor/) ; [Heyliot](https://www.heyliot.com/en/) ; [Techniques de l'Ingénieur — Heywaste](https://www.techniques-ingenieur.fr/actualite/articles/heywaste-le-capteur-qui-optimise-la-collecte-des-conteneurs-de-dechets-108467/) ; [Smart City Mag — Heyliot](https://www.smartcitymag.fr/article/948/collecte-de-dechets-heyliot-ameliore-son-capteur-et-valorise-ses-donnees) ; [Le Poool — Heyliot × Rennes Métropole](https://lepoool.tech/retour-sur-lexperimentation-de-heyliot-bh-environnement-avec-la-direction-des-dechets-et-des-reseaux-denergie-de-rennes-metropole/) ; [Sigrenea (Suez)](https://www.suez.com/en/sigrenea) ; [Akanthas](https://www.akanthas.com/) ; [Techniques de l'Ingénieur — Akanthas](https://www.techniques-ingenieur.fr/actualite/articles/akanthas-le-numerique-pour-oter-une-epine-du-pied-des-gestionnaires-de-dechets-114569/) ; [Reen rachète Enevo (ABAX)](https://www.abax.com/en-gb/newsroom/the-abax-venture-company-reen-acquires-enevo-group-c3363064) ; [RTS reprend les comptes US d'Enevo](https://www.rts.com/rts-announces-acquisition-of-enevo-incs-us-accounts/) ; [Citec/ESE France](https://www.franceenvironnement.com/entreprise/citec-environnement--nanterre-cdx-400158638/concurrents). (Consultées le 03/07/2026.) Nota : nous n'avons **pas trouvé de source publique** documentant l'équipement en capteurs des conteneurs du Relais (recherche du 03/07/2026 non concluante).

---

### 1.6 Tri optique matière/couleur pour le réemploi (et préparation de la sonde SOLIDATA)

| Solution | Type | Points clés (03/07/2026) | Ordre de prix | Données produites |
|---|---|---|---|---|
| **Matoha FabriTell** (UK) | **NIR portable/desktop/bench** + IA | 9 matières pures + 13 mélanges bi-composants, précision annoncée ±5 % (pures) / ±10 % (mélanges) ; **900+ appareils vendus dans 60 pays** ; conçu pour trieurs/réemploi « à coût abordable » ; **S-Bench** : station de tri IA (caméras + NIR) avec suivi à la pièce | Vente **en ligne** (e-shop matoha.com, prix en GBP) — pages prix inaccessibles lors de l'audit (HTTP 403) : **prix exact à demander par devis** ; positionné « affordable » vs lignes industrielles | Plateforme cloud + exports ; détail API/CSV **à confirmer auprès de Matoha** (page produit inaccessible le 03/07/2026) |
| **Picvisa ECOSORT Textil** (ES) | Ligne de tri NIR + RGB + **hyperspectral** (Specim FX17) | Tri par composition ET couleur ; réf. Coleo Recycling (~5 000 t/an, Galice) | Ligne industrielle (6-7 chiffres, sur devis) | Sorties machine, intégration industrielle propriétaire |
| **Valvan Fibersort** (BE) | Ligne de tri NIRS composition + couleur | ~**2 000 pièces/h** ; issu du projet Fibersort (legacy Circle Economy), industrialisé par Valvan | Ligne industrielle, sur devis | Sorties machine propriétaires |
| **TOMRA AUTOSORT** (NO) | Tri optique industriel NIR/VIS + deep learning (GAINnext) | **1re usine de tri textile automatisée au monde** livrée avec Stadler pour Sysav (Malmö) | Industriel, sur devis | Intégration usine (SCADA) |
| **Pellenc ST** (FR, Pertuis) | Lignes de tri optique | Cité parmi les 4 fabricants de lignes textile (avec TOMRA, Picvisa, Valvan) ; ~10 lignes textile établies ou en projet en Europe | Industriel, sur devis | Intégration usine |
| **CETIA** (FR, Hendaye — ESTIA × CETI) | **Plateforme d'innovation** tri & démantèlement automatisés textile/chaussure | 1 200 m², ~2,4 M€ d'équipements ; 1re ligne 100 % automatisée de démantèlement de chaussures, démonstrateur « ID Shoes » ; travaille avec Decathlon, Eram, Petit Bateau, Zalando | Accès projet/partenariat | — (centre d'essais : **bon point d'entrée pour tester la sonde SOLIDATA**) |
| **Référentiels** | — | **Sorting for Circularity Europe** (Fashion for Good, rapport 2022) : Refashion y a piloté la **calibration NIR** pour standardiser les protocoles ; projet Horizon Europe **SORT4CIRC** (tri intelligent) en cours | — | Méthodologies publiques |

**Formats de données** : constat honnête — **aucun standard public d'échange n'émerge côté machines de tri** (intégrations propriétaires pour les lignes industrielles ; cloud + exports pour les appareils Matoha ; « Intelligent Sorting Stations » circular.fashion adossées au circularity.ID). Recommandation en conséquence : pour la future sonde matière/couleur de SOLIDATA, **imposer contractuellement une interface ouverte (API REST/webhook ou export CSV)** et modéliser dès maintenant une table `sorting_scans` (item/lot, composition % par fibre, couleur, confiance, device_id, horodatage, opérateur) alignée sur les catégories `famille_refashion` existantes — de sorte que n'importe quel matériel (FabriTell aujourd'hui, lecture DPP demain) alimente le même modèle.

Sources : [Matoha](https://www.matoha.com/) ; [Matoha — identification textiles](https://www.matoha.com/fabrics-identification) ; [UKFT — spotlight Matoha](https://ukft.org/spotlight-matoha/) ; [texfash — Matoha](https://texfash.com/special/sorting-out-making-recycling-easier-with-technology-that-identifies-fibres-and-fabrics) ; [Picvisa tri textile](https://picvisa.com/en/automated-textile-sorting/) ; [Specim × Picvisa](https://www.specim.com/case-study-picvisa-harnesses-hyperspectral-imaging-to-revolutionize-textile-sorting/) ; [Valvan tri textile](https://www.valvan.com/en/solutions/textile-sorting-recycling) ; [Fibersort](https://www.fibersort.com/) ; [TOMRA textiles](https://www.tomra.com/en/textiles/solutions) ; [TOMRA × Stadler × Sysav](https://www.tomra.com/waste-metal-recycling/media-center/customer-stories/sysav-industri-ab) ; [Fiber Journal — fabricants de lignes](https://www.fiberjournal.com/machinery-goes-digital/) ; [CETIA](https://cetia.tech/) ; [UIT — CETIA](https://www.textile.fr/actualite/cetia-innovation-tri-et-demantelement-chaussures-et-textiles) ; [FashionNetwork — CETIA Hendaye](https://fr.fashionnetwork.com/news/Le-cetia-accelerateur-de-la-recyclabilite-dans-la-mode-inaugure-a-hendaye,1552762.html) ; [rapport Sorting for Circularity Europe (PDF, hébergé par Refashion)](https://media-pro.refashion.fr/2025/10/sorting-for-circularity-europe_fashion-for-good.pdf) ; [SORT4CIRC (CORDIS)](https://cordis.europa.eu/project/id/101181988). (Consultées le 03/07/2026.)

---

## 2. Tableau comparatif — leaders du marché vs SOLIDATA

Légende : ✅ présent / 🟡 partiel / ❌ absent. « Meilleur du marché » = l'acteur de référence sur la fonction. État SOLIDATA fondé sur les 27 modules du `CLAUDE.md` et vérifications dans le code (03/07/2026).

| Fonctionnalité | Référence marché | SOLIDATA | Commentaire |
|---|---|---|---|
| Pesée (tare, double contrôle) | AMCS, CAP Vision | ✅ | `tour_weights`, tare véhicule, `controles_pesee` (pesée client vs interne) |
| **Interfaçage pont-bascule matériel** | AMCS, CAP Vision, SigmaRecyc | ❌ | Poids saisis manuellement (« kg pesés à la bascule du centre », init-db.js:669) |
| Grading qualité du flux entrant (composition, contamination, photos) | AMCS (mobile grading), Akanthas | 🟡 | Checklists et incidents existent ; pas de caractérisation formalisée des apports |
| Traçabilité par lots / batch tracking tri | AMCS, Reverse Resources | ✅ | `batch_tracking`, `operation_outputs`, colisages scellés, 17 catégories sortantes |
| Optimisation de tournées (remplissage réel) | Sensoneo, Simpliciti CITI'PAV | ✅ | 3 modes, OSRM, pause déjeuner, GPS 10 s |
| Capteurs de remplissage IoT | Sensoneo, Heyliot | ✅ | Milesight EM400-MUD + Orange Live Objects — **mono-constructeur** (🟡 sur la résilience fournisseur) |
| Prédiction IA du remplissage | Sensoneo (filling cycles) | ✅ | `ml_fill_predictions`, météo, événements locaux, feedback loop — rare à ce niveau chez les petits opérateurs |
| App chauffeur + checklists véhicule | AMCS, Simpliciti | ✅ | PWA mobile, auth « 1 URL = 1 véhicule », haptics |
| Maintenance flotte (alertes CT, vidange) | AMCS | ✅ | `vehicle_maintenance*`, plan constructeur IA |
| Facturation matière / négoce (contrats, cours) | Recy (AMCS) | 🟡 | Tarifs exutoires + factures ; pas de gestion de cours matière ni contrats d'achat |
| **E-facturation (Factur-X, Plateforme Agréée)** | Éditeurs FR (en cours généralisé) | ❌ | Pennylane PULL only ; échéance **réception 09/2026** |
| **Registre réglementaire déchets (RNDTS via Trackdéchets)** | Ecocito (CAP/BSD), Sinari | ❌ | Aucune occurrence dans le code ; registre DND entrants/sortants a priori exigible |
| BSD dématérialisé (Trackdéchets API) | Éditeurs FR déchets | ❌ | **Non requis** pour TLC non dangereux — pertinence limitée à des cas résiduels |
| Reporting éco-organisme (DPAV Refashion, subventions) | *(quasi inexistant sur le marché)* | ✅ | **Différenciateur** : DPAV + verrouillage trimestriel + taux subvention versionnés + 5 vues d'audit SQL |
| Traçabilité aval (exutoires, familles réemploi/recyclage/CSR, CO2) | Reverse Resources | ✅ | Expéditions, `famille_refashion`, CO2 évité au mix observé |
| **Traçabilité à l'article (ID unitaire vêtement)** | circular.fashion, TrusTrace | ❌ | SOLIDATA trace au lot/colisage ; étiquettes carton CODE128 ≠ ID article |
| **DPP-ready (GTIN/GS1 Digital Link, scan DPP)** | TrusTrace, GS1, circular.fashion | ❌ | Aucune référence GS1/GTIN dans le code (grep 03/07/2026) |
| **Intégration tri optique / sonde NIR** | Matoha S-Bench, Picvisa, Valvan | ❌ | Prévu (sonde matière/couleur en réflexion) — modèle de données à préparer |
| Marketplace / matching matières | Refashion RECYCLE, Reverse Resources | ❌ | En vision long terme CLAUDE.md ; « connect » plus pertinent que « build » |
| Retail seconde main (caisse, KPI, objectifs) | *(hors périmètre des outils déchets)* | ✅ | **Différenciateur** : import LogicS, IPT, panier moyen, météo/CA |
| Vente au kilo temps réel (SumUp, écran live) | *(inexistant sur le marché étudié)* | ✅ | **Différenciateur** unique |
| RH / parcours d'insertion (CDDI, jalons, freins) | Logys AMAGIS (SIAE, hors déchets) | ✅ | **Différenciateur majeur** : aucun ERP déchets ne couvre l'insertion |
| RGPD intégré (registre, consentements, anonymisation) | Variable | ✅ | Natif |
| Multi-site / consolidation | AMCS | ❌ | Mono-site (vision long terme) |
| API ouverte partenaires (collectivités, exutoires) | AMCS, Trackdéchets | ❌ | API interne JWT uniquement |

---

## 3. Positionnement : forces et gaps

### 3.1 Ce que SOLIDATA fait mieux que le marché (pour CE métier)

1. **Intégration verticale SIAE-TLC unique** : collecte CAV + tri + stock Refashion + exutoires + boutiques + VAK + insertion + RGPD dans un seul outil. Aucun acteur étudié ne couvre ce périmètre ; l'équivalent marché = 4-5 briques à intégrer (AMCS/Ecocito + Simpliciti + AMAGIS + caisse) pour un coût de licences très supérieur au coût marginal de SOLIDATA.
2. **Reporting Refashion natif** (DPAV, taux de subvention versionnés, vues d'audit, verrouillage trimestriel) : introuvable ailleurs — c'est un savoir-faire monétisable auprès des ~60 autres opérateurs de tri conventionnés (66 trieurs sur la plateforme RECYCLE).
3. **Boucle IoT → IA → tournées** complète et maîtrisée (capteurs, prédiction météo/événements, OSRM, GPS live) : au niveau fonctionnel de Sensoneo/Simpliciti, sans abonnement SaaS par capteur.
4. **Lien production ↔ social** : KPI de productivité par poste reliés au parcours d'insertion (IPT, jalons M1/M6/M12) — proposition de valeur spécifique IAE qu'aucun ERP déchets n'adresse.
5. **Agilité réglementaire démontrée** (sprints Refashion/Métropole/QHSE de mai 2026) vs cycles de release des grands éditeurs.

### 3.2 Gaps prioritaires (ordre de priorité proposé)

| # | Gap | Échéance / risque | Effort estimé |
|---|---|---|---|
| **G1** | **Registre déchets non dangereux + télédéclaration RNDTS (via Trackdéchets)** — entrants/sortants du centre de tri | Obligation en vigueur (décret 2021-321, transmission depuis 01/2022, plateforme unifiée depuis 05/2025) ; **faire valider le périmètre exact par un juriste** | Moyen : les données existent (`stock_movements`, expéditions, tonnage) → export conforme arrêté 31/05/2021 + API |
| **G2** | **E-facturation** : réception 09/2026, émission 09/2027 | < 2 mois pour la réception | Faible si porté par Pennylane (connect) ; adapter les statuts factures |
| **G3** | **DPP-readiness** : identifiants GS1 (GTIN/Digital Link) sur produits finis/boutiques, modèle de données scans | Acte délégué ~2027, application 2028-2029 | Moyen, à étaler ; commencer par le catalogue produits |
| **G4** | **Sonde matière/couleur** : aucune brique d'acquisition NIR ni table de scans | Opportunité productivité/pureté immédiate | Achat Matoha (« abordable », prix à confirmer) + table `sorting_scans` + écran poste de tri |
| **G5** | **Interfaçage pont-bascule + grading entrant** (photos, contamination) | Fiabilité des tonnages Refashion/Métropole | Moyen (matériel + protocole) |
| G6 | Abstraction multi-capteurs (Heyliot en 2e source), API ouverte, multi-site | Résilience/essaimage | Progressif |

---

## 4. Recommandations build / buy / connect

### BUILD (développer dans SOLIDATA)
1. **Module « Registre réglementaire »** (G1) : génération du registre chronologique DND conforme à l'arrêté du 31/05/2021 depuis les données existantes, puis télédéclaration — l'API Trackdéchets (GraphQL, open source) documente l'export de registres ; vérifier la couverture « registre DND » de l'API avant de coder ([developers.trackdechets.beta.gouv.fr](https://developers.trackdechets.beta.gouv.fr/guides/registre)).
2. **Table `sorting_scans` + écran poste de tri « scan »** (G4/G3) : modèle neutre (composition % fibres, couleur, confiance, device, lot/colisage) alimentable par FabriTell aujourd'hui et par lecture DPP demain ; mapping automatique vers `categories_sortantes`/`famille_refashion`.
3. **Champ GTIN/identifiant GS1 Digital Link** sur `produits_catalogue`/`produits_finis` + QR sur étiquettes (le générateur CODE128 jsbarcode existe déjà) — prérequis DPP et revente en ligne.
4. **Grading entrant léger** (G5) : photo + typologie + % contamination à la réception de tournée, inspiré du mobile grading AMCS — réutiliser l'upload photo mobile existant.

### BUY (acheter, avec clause d'ouverture des données)
5. **1 sonde NIR Matoha FabriTell** (desktop ou handheld) en pilote au crackage/tri fin — vendue en ligne, positionnée « abordable » pour le réemploi (900+ unités, 60 pays) ; **demander le prix et la doc API/export avant achat** (pages prix inaccessibles le 03/07/2026). Si concluant, étudier la station **S-Bench** (suivi à la pièce). Passer par **CETIA (Hendaye)** pour un essai comparatif Matoha/alternatives si possible.
6. **Qualifier Heyliot** comme 2e source de capteurs (français, ToF adapté textile, LoRa/Sigfox, éprouvé sur bornes textile) pour dé-risquer la dépendance Milesight/Live Objects — le précédent Enevo (faillite 2020) montre le risque fournisseur.

### CONNECT (s'interfacer, ne pas réinventer)
7. **E-facturation via Pennylane** comme plateforme (G2) : activer réception 09/2026, émission 09/2027 ; SOLIDATA reste l'outil de contrôle/rapprochement (module 23bis déjà en place).
8. **Référencer les fractions sur Refashion RECYCLE** (gratuit, 450 organisations) pour sécuriser des débouchés recyclage ; surveiller **Reverse Resources** si l'export de fractions vers des recycleurs européens se développe.
9. **Veille active** : acte délégué DPP textile (2027), CIRPASS-2/GS1, pilote Trackit (interopérabilité), évolutions du périmètre Trackdéchets (extension progressive constatée : transporteurs DD au 01/2026).

### Standards à adopter
- **GS1** : GTIN + **GS1 Digital Link** (QR) comme identifiants produits ; envisager la couche événementielle GS1 (EPCIS) pour les mouvements si l'essaimage multi-site se confirme ([GS1 — DPP](https://www.gs1.org/standards/standards-emerging-regulations/DPP)).
- **Codes déchets européens + format registre de l'arrêté 31/05/2021** comme pivot du module réglementaire.
- **Factur-X** pour les factures sortantes (via Pennylane).
- Pour la sonde : **exiger API/CSV documenté** — pas de standard de fait côté machines de tri (constat §1.6).

---

## 5. Limites de l'étude (transparence)

- **Prix** : AMCS, Sensoneo, Ecube, Heyliot, Picvisa, Valvan, TOMRA, Pellenc ST ne publient pas de tarifs (sur devis). Les pages prix de Matoha existent (e-shop) mais étaient inaccessibles depuis notre environnement (HTTP 403) le 03/07/2026 — **prix exacts non vérifiés**.
- **Héva, C-Ways, Trackyz, iWaste, Ecorec, Hexavia** : non identifiés comme éditeurs de logiciels déchets actifs (recherches FR/EN du 03/07/2026) — possibles confusions de noms.
- **Périmètre RNDTS exact pour un opérateur TLC sous convention Refashion** (seuils, cas d'exemption) : non tranché par les sources publiques consultées → **avis juridique recommandé** avant de dimensionner G1.
- Obligations DPP spécifiques aux opérateurs de **réemploi/seconde main** : non encore fixées (dépendent de l'acte délégué textile ~2027).
- Plusieurs pages officielles (faq.trackdechets.fr, ecologie.gouv.fr, rndts-diffusion) ont opposé des 403/DNS à notre proxy : les affirmations correspondantes s'appuient sur les extraits de recherche et sur Légifrance, cités ci-dessus.

---

*Rapport rédigé le 3 juillet 2026 dans le cadre de l'audit exhaustif SOLIDATA (volet 09 — benchmark marché). Sources listées in situ dans chaque section, toutes consultées le 3 juillet 2026.*
