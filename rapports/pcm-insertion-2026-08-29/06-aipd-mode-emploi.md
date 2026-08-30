# AIPD — mode d'emploi et dossier pré-rempli

**Objet** : l'audit et la recherche du chantier 2.43.0 recommandent une **AIPD** (analyse d'impact
relative à la protection des données, « PIA » en anglais) sur le traitement qui combine
l'accompagnement socio-professionnel, l'évaluation de personnalité (PCM) et la note de profil
initial générée par IA. Ce document répond à la question « **comment faire ?** » : qui la porte,
avec quel outil, en combien de temps, et **ce qui est déjà prêt** dans SOLIDATA pour la remplir.

> **Avertissement** : ce document est une aide à la conduite, pas un avis juridique. L'AIPD est un
> acte du **responsable de traitement** (la structure), **avec le conseil du DPO** qui en valide le
> contenu. Les références réglementaires citées doivent être relues sur les pages officielles avant
> tout usage opposable (cf. §11).

---

## 1. En deux minutes

| Question | Réponse |
|---|---|
| **Qui décide ?** | La direction (responsable de traitement). C'est elle qui valide et signe. |
| **Qui conseille ?** | Le DPO — son avis est requis et doit figurer au dossier (RGPD art. 35.2). |
| **Qui fournit la matière ?** | La CIP et le service RH (usage réel), la direction (finalités), l'appui technique (mesures de sécurité — déjà inventoriées au §6). |
| **Avec quel outil ?** | Le logiciel **PIA** de la CNIL, gratuit et libre (ou un simple document structuré : l'outil n'est pas obligatoire, la méthode l'est). |
| **Combien de temps ?** | 4 à 6 semaines en pratique, dont l'essentiel en attente d'ateliers — le remplissage effectif tient en 2 à 3 réunions (§9). |
| **Faut-il l'envoyer à la CNIL ?** | **Non**, sauf si un risque élevé subsiste malgré les mesures (art. 36). L'AIPD se conserve et se présente en cas de contrôle. |
| **Est-ce vraiment obligatoire ?** | Oui selon les critères usuels — le traitement en coche au moins 5 sur 9 (§2). |

---

## 2. Pourquoi elle est obligatoire ici

Le RGPD (art. 35) impose une AIPD quand un traitement est « susceptible d'engendrer un **risque
élevé** pour les droits et libertés des personnes ». Pour l'apprécier, la CNIL et le Comité européen
de la protection des données utilisent **neuf critères** : à partir de **deux critères réunis**,
l'AIPD est en principe requise.

| # | Critère | Notre traitement | Pourquoi |
|---|---|---|---|
| 1 | Évaluation ou notation (scoring) | **Oui** | Note de profil, niveaux de freins suggérés (1-5), grilles de compétences /10, type de personnalité. |
| 2 | Décision automatisée avec effet juridique ou significatif | **Non** | Aucune décision n'est prise par la machine : la CIP décide, et c'est écrit dans le produit comme dans les prompts. À conserver comme tel. |
| 3 | Surveillance systématique | **Partiel** | Pas sur ce traitement ; mais la structure exploite par ailleurs GPS et badgeuse — à ne pas mélanger ici. |
| 4 | Données sensibles ou hautement personnelles | **Oui** | Santé (art. 9), infractions (art. 10), situation sociale, RQTH. |
| 5 | Grande échelle | **Non** | Effectifs d'une SIAE — à dire honnêtement, cela ne joue pas. |
| 6 | Croisement d'ensembles de données | **Oui** | La note croise CV, entretien de recrutement, mises en situation et PCM — quatre sources collectées séparément. |
| 7 | Personnes vulnérables | **Oui** | Salariés (lien de subordination) **et** publics éloignés de l'emploi : c'est le cœur du métier. |
| 8 | Usage innovant / nouvelle technologie | **Oui** | Analyse par modèle de langage (IA générative) d'un dossier social. |
| 9 | Exclusion du bénéfice d'un droit ou d'un contrat | **À examiner** | Le PCM est aujourd'hui passé **au recrutement** : tant qu'il y reste, la question se pose (cf. recommandation §7). |

**Conclusion : 5 critères clairement réunis, un sixième à examiner.** L'AIPD n'est pas optionnelle.
Vérifiez en complément si le traitement figure sur la **liste des traitements pour lesquels la CNIL
impose une AIPD** (liste publiée, à consulter — §11).

---

## 3. Périmètre : une seule AIPD, pas trois

Tentation naturelle : faire une AIPD « PCM », une « note de profil », une « dossier d'insertion ».
**À éviter.** Les risques naissent précisément de leur **combinaison** (un type de personnalité seul
est anodin ; agrégé à un frein santé dans un fichier employeur, il ne l'est plus).

**Recommandation** : **une AIPD unique**, intitulée par exemple
« *Accompagnement socio-professionnel des salariés en insertion, incluant l'évaluation de
personnalité et la note de profil assistée par IA* », qui couvre :
- le diagnostic d'accueil et le suivi de parcours (9 freins, entretiens, objectifs, PMSMP) ;
- l'évaluation de personnalité (PCM) et sa réutilisation dans l'accompagnement ;
- la note de profil initial générée par IA, y compris la sous-traitance du modèle.

Elle s'appuie sur les entrées du registre déjà en place : *Accompagnement socio-professionnel*,
*Recrutement — évaluation de personnalité (PCM)*, *Assistance IA — sous-traitance Anthropic*.

---

## 4. Qui fait quoi

| Rôle | Contribution | Formalisation |
|---|---|---|
| **Direction** (responsable de traitement) | Arrête les finalités, arbitre les mesures, **valide** | Signature de l'AIPD |
| **DPO** | Conseille, challenge, rédige son **avis** | Avis écrit annexé (art. 35.2) |
| **CIP** | Décrit l'usage réel, les cas limites, ce qui aide et ce qui gêne | Compte rendu d'atelier |
| **RH / recrutement** | Décrit la collecte, l'information donnée aux candidats | Compte rendu d'atelier |
| **Encadrant technique** | Ce qu'il voit, ce qu'il ne voit pas (le cloisonnement a été durci en 2.43.0) | Compte rendu |
| **Appui technique** | Mesures de sécurité, durées, journalisation, sous-traitants | §6 de ce document, déjà rédigé |
| **Salariés / CSE** | Avis sur le traitement | §8 — recommandé, et à tracer |

---

## 5. La méthode, en quatre étapes

La méthode CNIL — reprise telle quelle par le logiciel PIA — se déroule en quatre temps.

**Étape 1 — Délimiter et décrire le contexte.** Finalités, données, personnes concernées, durées,
supports, destinataires, sous-traitants. → **Déjà rédigé au §6.1**, il reste à valider.

**Étape 2 — Évaluer les mesures garantissant la proportionnalité et les droits.** Base légale,
minimisation, qualité des données, information, droits d'accès/rectification/opposition, encadrement
de la sous-traitance. → **§6.2**, avec les points ouverts signalés.

**Étape 3 — Apprécier les risques.** Trois événements redoutés, cotés en gravité et vraisemblance :
**accès illégitime**, **modification non désirée**, **disparition** des données. → **§6.3**, avec les
risques propres à ce traitement (étiquetage, réutilisation hors finalité, sortie d'IA erronée).

**Étape 4 — Valider.** Décision de la direction au vu de l'avis du DPO, plan d'action daté,
date de révision. → **§9 et §10**.

L'outil PIA de la CNIL guide ces quatre étapes et produit un rapport exportable. Il s'installe en
local (ou s'utilise en ligne) — aucune donnée n'est envoyée à la CNIL.

---

## 6. Dossier pré-rempli — ce que SOLIDATA fournit déjà

C'est la partie qui fait gagner le plus de temps : la matière factuelle existe, elle est ici.

### 6.1 Description du traitement (étape 1)

- **Finalités** : accompagner le salarié en parcours d'insertion et lever ses freins à l'emploi ;
  préparer le diagnostic d'accueil ; produire le reporting réglementaire agrégé (DREETS/ASP, FSE+).
- **Personnes concernées** : candidats au recrutement, salariés en parcours (CDDI), salariés permanents
  pour la part RH.
- **Catégories de données** : identité et coordonnées ; parcours (CV, expériences, formation) ;
  entretien de recrutement structuré ; mises en situation (8 critères) ; diagnostic d'accueil
  (12 rubriques) ; **9 freins**, dont **santé (art. 9)** et **judiciaire (art. 10)** ; Pass IAE et
  éligibilité ; type de personnalité (base, phase) et réponses au questionnaire ; note de profil
  générée ; compétences évaluées.
- **Destinataires** : CIP et service RH ; direction ; encadrement technique **pour la seule part
  non sensible** ; financeurs et organismes de contrôle **en agrégé** ; jamais de tiers externe.
- **Sous-traitants** : hébergeur (Scaleway, France) ; fournisseur du modèle d'IA (Anthropic PBC —
  **transfert hors UE à documenter**, §6.2) ; envoi d'e-mails/SMS (Brevo).
- **Durées** : anonymisation automatique **2 ans après le dernier contact** ; suppression du profil
  PCM à l'anonymisation du salarié (corrigé en 2.43.0) ; suppression intégrale de la note de profil
  à l'anonymisation ; données FSE+ conservées séparément pour la piste d'audit.
- **Supports** : application web (HTTPS), base PostgreSQL chiffrée au champ pour les données
  sensibles, sauvegardes automatisées.

### 6.2 Mesures déjà en place (étape 2)

| Domaine | Mesure | Où |
|---|---|---|
| Authentification | **Double authentification TOTP** obligatoire pour ADMIN/RH-CIP/DPO ; codes de secours ; verrou anti-force-brute | 2.43.0 |
| Habilitations | Accès au module d'insertion réservé ; **masquage par rôle** des freins santé/judiciaire ; note de profil **ADMIN/RH strict** ; encadrant technique cloisonné (correctifs 2.43.0) | `masking.js`, projections par rôle |
| Chiffrement | AES au champ pour santé/judiciaire, rapport PCM chiffré, **note de profil chiffrée**, secrets TOTP chiffrés (AES-256-GCM) | `field-crypto`, `pcm-crypto`, `mfa-crypto` |
| Traçabilité | Journal d'activité + **journal RGPD de chaque consultation** (note de profil, rapport PCM, exports nominatifs) | `rgpd_audit_log` |
| Minimisation IA | **Pseudonymisation systématique avant tout envoi** au modèle (noms, coordonnées, date de naissance → tranche d'âge) ; **jamais** le détail judiciaire ; **jamais** l'indicateur de « risque » du PCM | `pii-pseudonymize` |
| Non-automatisation | Aucune décision automatisée : les niveaux de freins sont **suggérés**, la CIP décide ; règle inscrite dans le produit et dans les prompts | doctrine 2.43.0 |
| Droits | Registre art. 30 tenu ; page « Règles de gestion des données » exposant les règles réellement codées ; export des données d'une personne | module RGPD |
| Conservation | Anonymisation automatique planifiée ; purges par périmètre | `anonymization.js` |
| Sécurité générale | HTTPS/HSTS, pare-feu, sauvegardes automatiques, révocation de session immédiate | infrastructure |

**Points ouverts à traiter dans l'AIPD** (ne les masquez pas, ce sont eux qui font l'intérêt de l'exercice) :
1. **Transfert hors UE** vers le fournisseur du modèle d'IA : documenter les garanties (clauses
   contractuelles types, engagement de non-entraînement, durée de rétention côté sous-traitant).
2. **Information des personnes** : il n'existe pas encore de notice préalable en FALC avant la
   passation du questionnaire, ni de trace du consentement/refus (défaut relevé par l'audit).
3. **Restitution** : le résultat du test n'est pas systématiquement rendu à la personne.
4. **Base légale de la passation au recrutement** : fragile (§7).

### 6.3 Risques à coter (étape 3)

Aux trois événements redoutés de la méthode (accès illégitime, modification non désirée,
disparition), ajoutez les risques **propres** à ce traitement — ce sont eux que la CNIL attend :

| Risque | Impact pour la personne | Ce qui l'atténue déjà |
|---|---|---|
| **Étiquetage** : un type de personnalité devient une réputation qui suit la personne | Perte de chances, prophétie autoréalisatrice | Rédaction en « repères de communication », jamais en portrait ; mention de non-diagnostic ; interdits inscrits dans les prompts |
| **Décision fondée sur un artefact** : un indicateur non valide oriente une décision | Non-renouvellement, orientation subie | Libellé « alerte RPS » retiré (32 % de faux positifs mesurés) ; indicateur neutralisé à l'affichage et retiré des envois à l'IA |
| **Réutilisation hors finalité** : un profil collecté pour recruter sert à gérer | Détournement de finalité | Registre tenu ; cloisonnement des accès ; à trancher définitivement par §7 |
| **Accès illégitime interne** : un encadrant lit un frein santé | Atteinte à l'intimité, discrimination | Masquage par rôle, projections, MFA, journalisation |
| **Sortie d'IA erronée** reprise telle quelle | Diagnostic faussé | Sources et **manques nommés** ; hypothèses à vérifier avec la personne ; aucune écriture automatique dans le diagnostic |
| **Fuite de la base** | Divulgation massive de données sensibles | Chiffrement au champ, MFA, sauvegardes, hébergement UE |

---

## 7. La décision qui allègera le plus l'AIPD

L'audit et la recherche convergent sur un point : **déplacer la passation du PCM après l'embauche**.
Ce seul arbitrage :
- fait tomber le critère n° 9 (§2) et le débat sur la pertinence au recrutement (art. L1221-8 du
  Code du travail) ;
- rend le refus réellement sans conséquence, donc le consentement plus solide ;
- améliore la qualité de la donnée (moins de réponses « désirables » qu'en situation d'enjeu).

Si la direction retient cette option, écrivez-la dans l'AIPD comme **mesure de réduction du risque**
— c'est exactement ce que l'exercice attend.

---

## 8. Faut-il consulter les salariés ?

Le RGPD prévoit que le responsable de traitement demande, **le cas échéant**, l'avis des personnes
concernées (art. 35.9). Recommandation, cohérente avec la pratique de la structure :

- **Consulter le CSE** (il l'est déjà pour la badgeuse) et **conserver le PV** ;
- **Informer les salariés** par une note en FALC : à quoi sert la note de profil, qui la lit,
  combien de temps elle est conservée, comment en obtenir copie et faire rectifier ;
- si la direction choisit de **ne pas** consulter, **écrire pourquoi** dans l'AIPD : l'absence
  motivée est acceptable, l'absence silencieuse ne l'est pas.

---

## 9. Calendrier réaliste

| Semaine | Étape | Qui |
|---|---|---|
| S1 | Cadrage : périmètre (§3), désignation du pilote, installation de l'outil PIA | DPO + direction |
| S2 | Atelier n° 1 — contexte et données (étape 1), en partant du §6.1 | DPO, CIP, RH |
| S3 | Atelier n° 2 — proportionnalité, droits, sous-traitance (étape 2), points ouverts §6.2 | DPO, direction, appui technique |
| S4 | Atelier n° 3 — cotation des risques (étape 3) à partir du §6.3 | DPO, CIP, appui technique |
| S5 | Consultation CSE / information des salariés (§8) | Direction |
| S6 | Avis du DPO, plan d'action daté, **validation et signature** | Direction |

---

## 10. Après la validation

- **Conserver** l'AIPD (elle se présente en cas de contrôle) et la **lier au registre**.
- **Réviser** au moins tous les 2 ans, et **immédiatement** si : la passation du PCM change de
  moment, la finalité de la note évolue, le sous-traitant IA ou le modèle change, une nouvelle
  catégorie de données entre dans le dossier, ou un incident survient.
- **Consulter la CNIL** (art. 36) **uniquement** si, après mesures, un risque **élevé résiduel**
  subsiste — ce qui, au vu des mesures du §6.2, ne devrait pas être le cas.

---

## 11. Ce qui reste à vérifier avant usage opposable

Par honnêteté méthodologique, et dans la même logique que l'annexe du rapport de recherche :

1. **Les pages CNIL n'ont pas pu être consultées** depuis l'environnement de développement (accès
   réseau restreint) : les références ci-dessous sont issues d'une recherche, et les **formulations
   exactes doivent être relues** sur le site avant de citer.
2. Vérifier si le traitement figure sur la **liste des traitements pour lesquels une AIPD est
   obligatoire** publiée par la CNIL (elle s'ajoute au raisonnement par critères du §2).
3. Faire confirmer par le DPO la **base légale** retenue pour chacune des trois briques
   (accompagnement / évaluation de personnalité / analyse par IA).
4. Documenter les **garanties de transfert hors UE** du sous-traitant IA.
5. Instruire l'applicabilité du **règlement européen sur l'IA** à la situation exacte de la
   structure (le classement « haut risque » des systèmes liés à l'emploi mérite un examen dédié).

### Références

- CNIL — [L'analyse d'impact relative à la protection des données (AIPD)](https://www.cnil.fr/fr/RGPD-analyse-impact-protection-des-donnees-aipd)
- CNIL — [Ce qu'il faut savoir sur l'AIPD](https://www.cnil.fr/fr/ce-quil-faut-savoir-sur-lanalyse-dimpact-relative-la-protection-des-donnees-aipd)
- CNIL — [Outil PIA : télécharger et installer le logiciel](https://www.cnil.fr/fr/outil-pia-telechargez-et-installez-le-logiciel-de-la-cnil)
- CNIL — [PIA, la méthode (PDF)](https://www.cnil.fr/sites/default/files/atoms/files/cnil-pia-1-fr-methode.pdf)
- RGPD, articles 35 (analyse d'impact) et 36 (consultation préalable).
