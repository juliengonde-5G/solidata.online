# Note de profil initial CIP — cadrage fonctionnel et déontologique (2.43.0)

**Objet** : chaque nouvel embauché en parcours d'insertion fait l'objet d'une analyse systématique
de profil, remise à la CIP **en préambule de la préparation de l'entretien initial** (diagnostic
d'accueil). Elle croise les quatre sources déjà présentes dans SOLIDATA : le **CV** (texte brut),
les **notes de l'entretien de recrutement structuré** (7 sections, dont la section « Freins à
l'emploi » jusqu'ici sous-exploitée), les **mises en situation** (3 ateliers, 8 critères notés) et
l'**analyse PCM**. Elle fait partie de la fiche personnelle du salarié (onglet Parcours insertion)
et de l'espace CIP (onglet Synthèse).

Ce cadrage est fondé sur la recherche bibliographique du volet 2 (`02-recherche-bibliographique.md`,
§6) et sur l'audit du module PCM (`01-audit-module-pcm.md`). Il fait foi sur la doctrine d'usage.

---

## 1. Ce que la note est — et ce qu'elle n'est pas

**La note est** un outil de travail daté, révisable et contradictoire : un jeu d'**hypothèses à
vérifier avec le salarié**, destiné à ce que la CIP n'arrive pas « à vide » au diagnostic d'accueil.

**La note n'est pas** :
- un diagnostic médical ou psychologique — elle n'emploie aucun vocabulaire clinique ;
- un pronostic d'employabilité, de réussite du parcours ou de « compatibilité métier » — aucun
  score de ce type n'est produit, c'est un interdit codé dans le prompt du moteur ;
- un critère de sélection — elle est générée **après** l'embauche, à la liaison
  candidat→collaborateur ;
- un portrait : le bloc PCM est rédigé comme des **repères pour ajuster la communication du
  professionnel** (« s'engage plus volontiers quand… »), jamais comme une description de la
  personne (« c'est un Rebelle » est une formulation interdite).

Chaque note porte en permanence la mention : *« Analyse générée par IA à partir du dossier de
recrutement — hypothèses à vérifier avec le salarié. Ne constitue ni un diagnostic ni un critère de
sélection. »*

## 2. Structure de la note

| Bloc | Contenu | Source |
|---|---|---|
| Synthèse | 4-6 phrases de situation | toutes |
| **Expression de la personne** | verbatims (projet, attentes, contraintes qu'elle pose, ce qu'elle refuse), **en ses mots, entre guillemets** — affiché en premier : c'est la section où la personne est sujet | entretien structuré |
| Freins à l'emploi pressentis | par frein du registre (9 axes) : niveau **suggéré** (1-5 ou « non évaluable »), justification factuelle, **provenance** (cv / entretien / mise en situation / pcm) | croisement |
| Compétences observées | savoir-faire et savoir-être relevés | mises en situation, CV |
| Points de vigilance pour l'entretien | éléments à aborder avec précaution | croisement |
| Questions suggérées pour le diagnostic | amorces concrètes | croisement |
| **Repères de communication (PCM)** | canal, besoins, signaux de tension **avec « ce qui aide alors »** — encadré distinct, en dernier, avec le double chapeau « Ce que ce bloc est / n'est pas » et la clôture « Si l'expérience les contredit, c'est l'expérience qui a raison. » | PCM |
| Sources et limites | sources réellement disponibles et **manques nommés** (jamais devinés) | système |

**Règle structurante** : les niveaux de freins suggérés ne sont **jamais écrits** dans le
diagnostic — la CIP reste seule décisionnaire (même doctrine que les suggestions de niveau du
diagnostic d'accueil).

## 3. Cycle de vie

1. **Génération automatique** à la liaison candidat→collaborateur (réglage
   `insertion.note_profil_auto`, actif par défaut), en tâche de fond — la liaison n'échoue ni ne
   ralentit jamais à cause de la note. Un job filet rattrape les liaisons récentes sans note
   (< 30 jours, 5 par passage).
2. **Consultation** par la CIP dans l'onglet Synthèse de l'espace CIP, juste avant le bandeau
   « Commencer le diagnostic d'accueil » — et en lecture dans la fiche salarié.
3. **Prise de connaissance tracée** : bouton « J'en ai pris connaissance — préparer le
   diagnostic » (horodaté, nominatif, idempotent — la première prise de connaissance fait foi).
4. **Régénération** possible à la demande (bouton), la trace de prise de connaissance est
   conservée. **Export PDF** (variante dossier uniquement — une note d'hypothèses n'est pas un
   document que l'on remet tel quel au salarié ; ce qui lui est remis est le diagnostic,
   co-construit avec lui).

## 4. Sécurité et RGPD

- **Accès strictement ADMIN/RH (CIP)** — jamais MANAGER : la note croise le dossier de recrutement
  et le PCM, deux sources que l'encadrant technique n'est pas habilité à lire. Les routes sont en
  outre derrière la double authentification (volet 4).
- **Contenu chiffré en base** (même mécanique que les champs santé/judiciaire du diagnostic).
- **Chaque lecture et chaque génération sont journalisées** dans le registre d'audit RGPD.
- **Pseudonymisation avant IA** : aucun patronyme, e-mail, téléphone ni date de naissance exacte ne
  part vers le sous-traitant IA ; le détail du frein judiciaire n'est jamais transmis ; l'« alerte
  RPS » du module PCM n'est **pas** transmise (l'audit a établi que c'est un artefact statistique).
- **Anonymisation** : la note est supprimée intégralement à l'anonymisation du salarié (synthèse
  dérivée — les données sources suivent leur propre cycle).
- **Registre art. 30** : l'entrée « Accompagnement socio-professionnel » est mise à jour pour
  couvrir explicitement la note et le croisement recrutement/PCM par IA pseudonymisée.

## 5. Limites dites, et recommandations d'usage à la CIP

- La qualité du bloc « Expression de la personne » dépend directement de la **saisie de l'entretien
  structuré** au recrutement : sans lui, le bloc le dit explicitement. Renseigner l'entretien
  structuré est donc le meilleur investissement pour la qualité des notes.
- La note est générée à partir de données recueillies **en situation de recrutement** (enjeu
  élevé) : c'est le moment où un questionnaire de personnalité est le moins fiable. D'où la règle :
  tout ce qui vient du PCM est une hypothèse de communication, rien de plus.
- **Recommandation stratégique issue de la recherche (à l'arbitrage de la direction, non
  implémentée)** : déplacer la passation du PCM **après l'embauche**, comme acte d'accompagnement —
  cela supprime le problème de pertinence au recrutement (art. L1221-8), améliore la fiabilité
  (moins de désirabilité sociale) et rend le consentement réellement libre
  (`02-recherche-bibliographique.md`, §6.3.a et §6.4).
- Une **AIPD** (analyse d'impact) est recommandée : le traitement combine évaluation systématique
  d'aspects personnels, données sensibles et personnes vulnérables.
