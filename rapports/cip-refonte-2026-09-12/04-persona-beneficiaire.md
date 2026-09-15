# Moi, Karim — ce que je vis avec le parcours d'insertion (persona bénéficiaire)

> Chantier `cip-refonte-2026-09-12`. Rédigé à la première personne par le persona **Karim, 34 ans**,
> salarié en CDDI (26 h/semaine, chaîne de tri) chez Solidarité Textiles depuis 4 mois. Ce document lit
> le module Insertion de SOLIDATA **du point de vue du bénéficiaire**, à partir de ce qui existe
> réellement dans l'outil (backend, frontend, guide CIP) — pas de ce qui pourrait exister un jour.
> Sources : `00-exigences-autorite.md`, `01-reconnaissance-backend.md`, `02-reconnaissance-frontend.md`,
> `docs/GUIDE_CIP_INSERTION.md`, `frontend/src/components/insertion/pdf-insertion.js`,
> `rapports/insertion-2026-07-22/11-synthese-et-arbitrages.md`.

---

## 1. Qui je suis et ce que je vis

Je m'appelle Karim, j'ai 34 ans. Ça fait 4 mois que je travaille à Solidarité Textiles, sur la chaîne de tri, 26 heures par semaine, en CDDI — un contrat d'insertion. Avant ça, j'étais au RSA depuis un moment. C'est le CMS (le centre médico-social du Département) qui m'a orienté vers la structure. Depuis le 1er janvier 2025, être au RSA veut dire que je suis automatiquement inscrit à France Travail, même si je n'ai jamais mis les pieds dans une agence pour ça — je l'ai appris en entretien, pas avant.

Ce que je vis, concrètement :

- **Le logement.** Je suis hébergé chez un ami depuis plusieurs mois. Ce n'est pas stable, je ne sais pas combien de temps ça va durer, et ça me stresse pour toutes mes démarches (adresse, courrier, domiciliation).
- **Le transport.** Je n'ai pas le permis. Pour venir au centre de tri, je prends le bus, et ça limite aussi les postes que je pourrais viser plus tard.
- **La langue écrite.** À l'oral, ça va, je me débrouille. À l'écrit, c'est plus dur (on m'a dit "niveau A2" à un moment, sans trop m'expliquer ce que ça voulait dire). Les papiers administratifs, les mails, les formulaires : je préfère qu'on m'explique de vive voix, ou qu'on remplisse avec moi.
- **L'argent.** J'ai des dettes en cours. Ça pèse, et ça revient souvent dans mes discussions avec la conseillère.
- **Le CER.** J'ai signé un **Contrat d'Engagements Réciproques** avec le Département — un papier qui dit ce que je m'engage à faire (chercher, me former, aller à mes rendez-vous, faire entre 15 et 20 heures d'activité par semaine) et ce que le Département s'engage à faire pour moi (m'aider, m'orienter, me recontacter). Je l'ai signé avec quelqu'un du CMS, pas avec la structure.
- **La peur de la suspension.** On m'a expliqué qu'il y a un contrôle trimestriel (la DTR) et que si je ne respecte pas mes engagements — sans bonne raison — mon RSA peut être suspendu, avec une étape de "remobilisation" avant de le retrouver. Ça me fait peur, honnêtement, parce que je ne sais pas toujours ce qui compte comme "motif légitime" pour une absence, ni qui vérifie quoi.

**Ce que j'attends de la structure** : qu'on me dise clairement où j'en suis, qu'on ne me fasse pas revivre trois fois la même démarche, qu'on m'aide à avancer sur mon logement et mon permis, et qu'on me protège en cas de contrôle — plutôt que de découvrir un problème le jour où ça tombe mal.

Un mot sur mon rapport à l'administratif en général, parce que ça compte pour comprendre tout ce qui suit : je n'ai pas peur des gens, j'ai peur des **papiers**. Un formulaire mal expliqué, un mot que je ne comprends pas, une case que je coche sans être sûr — ça m'a déjà coûté cher par le passé (un dossier refusé, une aide arrivée en retard). Alors quand on me dit qu'un document "est écrit pour moi, en langage simple", je le remarque tout de suite, et quand ce n'est pas le cas, aussi.

---

## 2. Mon parcours dans SOLIDATA tel qu'il existe

Je précise tout de suite : **je n'ai jamais vu SOLIDATA**. Je n'ai pas de compte, pas de mot de passe, pas d'écran à moi. Ce que je décris ici, c'est ce que je vois par-dessus l'épaule de la conseillère en insertion (la CIP) pendant nos entretiens, et les papiers qu'elle m'imprime.

### Mon embauche

Ma fiche a été créée par le service RH à partir de l'import de la paie — je ne sais même pas ce que ça veut dire concrètement, mais la CIP m'a dit que "c'est la paie qui crée le salarié dans le logiciel". Comme mon poste est un CDDI, je suis passé automatiquement "en parcours d'insertion" dans leur système, sans action de ma part.

*Ce que je comprends* : mon dossier existe dès le premier jour, avant même mon premier rendez-vous avec la CIP.
*Ce qui me rassure* : je n'ai rien eu à remplir moi-même pour "démarrer".
*Ce qui me perd un peu* : je ne sais pas ce qu'il y a dedans, ni qui peut le voir.

Je n'étais pas passé par le "recrutement classique" de la structure — le CMS m'a orienté directement — donc je n'ai pas eu le test de personnalité (le "PCM") que d'autres collègues, arrivés par une candidature, ont eu à faire avant l'embauche. Une collègue m'en a parlé : apparemment, avant de répondre aux questions, on lui a expliqué à quoi ça sert, à quoi ça ne sert pas, qui voit le résultat, combien de temps c'est gardé, et qu'elle pouvait refuser sans que ça lui soit reproché. Ça m'a semblé être une bonne chose à savoir avant de commencer, plutôt qu'après.

### Le diagnostic d'accueil (le grand entretien du début)

Environ un mois après mon arrivée, la CIP m'a convoqué pour ce qu'elle appelle le "diagnostic d'accueil" (`DiagnosticForm`). On s'est assis, elle avait son ordinateur ouvert, et on a fait le tour de plein de sujets, rubrique par rubrique — elle m'a dit qu'il y en a 14 : ma situation et ma famille, mon logement, mes droits et mes papiers, ma santé, mon budget, mes déplacements, le français, ma situation professionnelle, mon projet, ce que j'aime faire et ce que je sais faire, ma façon d'apprendre, et ce que j'ai à dire moi-même sur mes attentes et mes difficultés.

Ça a duré longtemps — presque deux heures, en une seule fois pour moi, même si elle m'a dit qu'on pouvait le faire en deux fois. À un moment il y a eu un questionnaire sur "ma façon d'apprendre" avec plein de petites phrases où je devais choisir entre deux réponses (24 questions, un vrai marathon) — apparemment ça sert à savoir comment mon encadrant doit m'expliquer les choses au poste.

Pour chaque sujet, la CIP appuyait sur un bouton pour dire "à quel point c'est bloquant pour moi" — de 1 à 5, ou "non évalué" si le sujet n'a pas été abordé à fond. Elle m'a bien dit : "si je ne sais pas, je mets non évalué, jamais 1 par défaut" — ça, ça m'a rassuré, ça veut dire qu'on ne m'a pas collé une étiquette au hasard.

À la fin, un dessin en toile d'araignée est apparu à l'écran, avec une pointe pour chaque sujet (logement, santé, mobilité...). Elle a imprimé un document pour moi — "l'exemplaire salarié" — avec ce dessin, en gros caractères, sans les détails de santé ni le sujet judiciaire (je n'ai pas de sujet judiciaire, mais elle m'a expliqué que si j'en avais un, il ne figurerait jamais sur mon exemplaire).

*Ce que je comprends* : on essaie de faire le tour de tout ce qui me freine, une seule fois, pas à chaque rendez-vous.
*Ce qu'on me demande* : de parler franchement de mon logement, mon budget, ma santé, ma mobilité.
*Ce qui me fait peur* : parler de mes dettes et de mon logement précaire devant quelqu'un que je connais depuis peu — même si la CIP m'a mis à l'aise.
*Ce qui me rassure* : le document qu'on m'a remis est écrit simplement, avec des pictogrammes, pas du jargon.
*Ce qui me perd* : je ne savais pas à quoi servait le questionnaire des 24 phrases avant qu'on me l'explique — j'ai cru un instant que c'était encore un test de personnalité comme celui du recrutement (le PCM).

Avant qu'on clôture ce diagnostic, la CIP a activé quelque chose qu'elle a appelé "le mode relecture" : l'écran est passé en grosse écriture et a caché certains champs, pour qu'on relise ensemble ce qu'elle avait noté, avant qu'elle ne valide définitivement. J'ai apprécié ce moment — c'est le seul où j'ai eu l'impression de vraiment "voir" ce qu'il y avait dans mon dossier, même brièvement, sur son écran à elle.

### La période d'essai (le point du premier mois)

Un mois après mon arrivée, on a fait un point plus court, uniquement pour dire si "ça se confirme". La CIP et mon encadrant ont donné leur avis, puis on m'a dit "confirmée". Ça n'a pas duré longtemps, pas de questions sur mes freins, juste : est-ce que je continue.

*Ce qui me rassure* : c'est court, ciblé, pas anxiogène.
*Ce que je ne sais pas* : que ce point était "programmé automatiquement" dès mon embauche — je pensais que c'était à l'initiative de la CIP ce jour-là.

### Les bilans (tous les deux mois environ)

Régulièrement, on refait un point — "Bilan n° 2", "Bilan n° 3"... On reprend ce qu'on s'était dit la fois d'avant : mes objectifs (est-ce que je les ai atteints, en partie, pas du tout), mes actions (faites ou pas), on remet à jour ma toile d'araignée des freins (elle superpose l'ancienne et la nouvelle, en pointillés, je vois si ça va mieux ou moins bien), et on fixe les objectifs suivants. À la fin, la CIP me relit tout, coche "relu avec le salarié", et on planifie déjà le prochain rendez-vous — je repars avec une date.

*Ce qui me rassure* : je ne repars jamais sans savoir quand est le prochain rendez-vous — ça, c'est du concret.
*Ce qui me manque* : entre deux bilans, si je veux un point rapide sur mon dossier (par exemple "où en est ma demande de logement"), je n'ai nulle part où regarder moi-même — je dois attendre le prochain rendez-vous ou aller frapper à la porte du bureau.

### Les actions (les petites choses entre les grands rendez-vous)

La CIP m'a dit qu'elle note des "actions" pour moi — par exemple un rendez-vous avec Action Logement, ou une inscription à une auto-école sociale pour le permis. Je n'ai jamais vu cette liste moi-même ; c'est elle qui me le rappelle oralement ou par téléphone.

*Ce qui me rassure* : ça veut dire que mon dossier logement et mon dossier permis ne sont pas oubliés dans un coin.
*Ce qui me manque* : je n'ai pas de rappel écrit ou par SMS de ces rendez-vous — tout passe par la mémoire de la CIP et la mienne.

J'ai cru comprendre qu'il existe, pour la CIP, une page entière rien que pour ces actions — un tableau avec tout le monde, les échéances, les retards — mais que ça reste son outil de travail à elle, pas un espace partagé avec moi. Je n'ai pas de "ma liste à moi" quelque part, même en version papier tenue à jour.

### Le journal de suivi (ce qui se passe entre deux rendez-vous)

La CIP m'a dit qu'elle tient aussi un genre de journal, où elle note un échange qu'on a eu à l'atelier, un appel d'un partenaire à mon sujet, ou un fait marquant — sans attendre le prochain grand entretien pour ne pas l'oublier. Elle m'a précisé que c'est chiffré dans leur base, que seules la CIP et la RH peuvent le lire (pas même mon encadrant), et que chaque écriture ou lecture est tracée quelque part — mais que le contenu de ce que ça raconte, lui, n'est jamais visible dans cette trace.

*Ce qui me rassure* : ça veut dire que ce que je dis "en passant" n'est pas perdu, et que ce n'est pas ouvert à tout le monde.
*Ce qui me manque* : je ne vois jamais ce journal moi-même, donc je ne sais pas ce qui y est réellement écrit sur moi — je dois faire confiance.

### La PMSMP (si un jour j'en fais une)

On m'a parlé d'une possibilité de "PMSMP" — une immersion de quelques jours dans une autre entreprise pour découvrir un métier ou confirmer un projet. Je n'en ai pas encore fait, mais la CIP m'a expliqué qu'il y a des règles strictes (un mois maximum par convention, 60 jours maximum sur un an chez la même entreprise) et qu'elle doit aussi la déclarer sur un site officiel appelé "Immersion Facilitée".

*Ce que j'attends* : que si l'occasion se présente, on m'en parle assez tôt pour que je puisse m'organiser (transport, horaires).

### Le renouvellement de mon contrat

Mon contrat CDDI arrive à échéance dans quelques semaines. La CIP m'a dit qu'un formulaire est en train de circuler entre mon encadrant technique (qui donne son avis sur mon assiduité, ma motivation, mon autonomie), la CIP, et le directeur, qui doivent tous les trois valider avant que le renouvellement soit acté. Je n'ai pas vu ce formulaire — mon encadrant le remplit sur un écran à lui (`RenouvellementETI`), pas moi.

*Ce qui me fait peur* : ne pas savoir à l'avance ce qui a été dit sur moi dans ce formulaire, et découvrir la décision au dernier moment.
*Ce qui me rassure un peu* : la CIP m'a promis qu'elle m'annoncerait la décision en entretien, pas par un simple mot glissé sous la porte.

### Si je sors (fin de parcours)

La CIP m'a expliqué comment ça se passerait le jour où je quitterai la structure : un "bilan de sortie" qui reprend tout mon parcours, une catégorie officielle de sortie (emploi durable, emploi de transition, sortie positive ou autre), les documents qu'on me remet obligatoirement (solde de tout compte, certificat de travail, attestation France Travail), et un questionnaire de satisfaction sur mon passage dans la structure. Elle m'a aussi dit qu'on me recontacterait quelques mois après mon départ pour savoir où j'en suis — et que je peux refuser ce recontact si je veux, ça sera noté.

*Ce qui me rassure* : je sais déjà, avant même d'y être, comment ça va se passer.
*Ce qui m'interroge* : "quelques mois" — je ne sais pas si c'est 3 ou 6 mois, et je ne sais pas ce qui se passe si on n'arrive pas à me joindre (je change parfois de numéro).

### Les tableaux qui existent, mais qui ne sont pas pour moi

La CIP m'a montré une fois, vite fait, un écran qu'elle appelle "Pilotage & indicateurs" — plein de chiffres, des cibles, des graphiques sur les freins de tout le monde, les sorties de l'année, les délais de diagnostic. Elle m'a dit que c'est pour la direction et pour les organismes qui contrôlent la structure (DDETS, Département). Il y a aussi, paraît-il, un export spécial avec un tableau détaillé sur les freins de chaque personne — mais celui-là, elle m'a assuré qu'il exclut par défaut le sujet judiciaire et qu'il est réservé à la direction et à la RH, avec une trace de qui l'a sorti et quand.

*Ce que ça me fait* : je suis content que ce ne soit pas ouvert à n'importe qui, mais un peu mal à l'aise de savoir que "mes chiffres" existent quelque part dans un tableau que je ne verrai jamais, pour des gens que je ne connais pas.

---

## 3. Ce qui manque pour moi au regard de mes obligations (CER, RSA, France Travail)

Je reprends les questions que je me pose, une par une, en disant honnêtement ce qui existe et ce qui n'existe pas dans l'outil aujourd'hui (d'après ce que montrent les documents de reconnaissance) :

- **Est-ce que je sais QUI est mon référent unique ?** Pas vraiment. La structure ne sait même pas encore officiellement si c'est elle (via la CIP) qui est mon référent unique, ou si c'est mon conseiller France Travail / le CMS. Dans l'outil, il y a bien une "CIP référente" attachée à mon dossier (`cip_referent_user_id`), mais rien qui dise "voici votre référent unique officiel au sens de la loi", ni qui distingue l'orienteur (celui qui a choisi mon parcours) de mon accompagnateur au quotidien. **Ça n'existe pas aujourd'hui.**
- **Est-ce que je vois mes 15-20 h d'activité ?** Non. Je ne sais même pas si mes 26 heures de travail par semaine comptent dans les 15-20 heures de mon CER, ou si je dois faire des heures d'accompagnement en plus. Personne ne me l'a dit clairement, et rien dans l'outil n'additionne mon temps de travail + mes rendez-vous + mes ateliers pour comparer au volume promis dans mon CER. **Ça n'existe pas aujourd'hui** (il n'y a aucun contrôle d'heures d'activité hebdomadaire dans le système).
- **Est-ce que je sais où en est mon Pass IAE, mon CER, mes engagements et ceux de la structure ?** Le Pass IAE, la CIP le voit sur ma fiche (numéro, dates), avec des alertes avant l'échéance — ça, ça existe côté outil, même si je ne le vois pas moi-même. Mon **CER**, en revanche, je l'ai signé en dehors de tout logiciel, avec le CMS ; **rien dans SOLIDATA ne le connaît** : pas de date, pas de contenu, pas de suivi de mes engagements ("15-20 h", "informer de tout changement") ni de ceux du Département (aides mobilité, garde d'enfants). **Ça n'existe pas aujourd'hui.**
- **Est-ce que je peux justifier une absence (motif légitime) pour éviter la suspension-remobilisation ?** Il y a bien un journal de suivi que la CIP tient (des notes datées sur ce qui se passe entre les rendez-vous), mais rien qui ressemble à un registre structuré "absence du [date], motif légitime : [tel motif]" que je pourrais produire en cas de contrôle DTR. **Ça n'existe pas aujourd'hui** sous une forme exploitable pour prouver un motif légitime.
- **Est-ce que je reçois des rappels de rendez-vous (comme RDV-Insertion) ?** Non, pas directement. J'ai appris qu'il existe un rappel automatique avant certains entretiens, mais il part vers la CIP (pour qu'elle prépare le rendez-vous), pas vers moi par SMS ou mail comme le fait, paraît-il, l'outil national RDV-Insertion. **Ça n'existe pas pour moi aujourd'hui** — aucun SMS, aucun mail de rappel ne m'arrive.
- **Est-ce que j'ai accès à mon récapitulatif (comme "Mon Récap") ?** Non. Il existe des exports de mon parcours (des PDF, des tableaux), mais ils sont faits **pour** des professionnels (la direction, un contrôleur), pas pour que je les consulte moi-même à tout moment. Il n'y a pas d'espace "Mon parcours" pour les salariés — j'ai cru comprendre que ça a été envisagé mais **reporté à une phase ultérieure du projet**. **Ça n'existe pas aujourd'hui.**
- **Est-ce que je sais à quoi servent les services (comme DORA) vers lesquels on m'oriente ?** Pas vraiment sous cette forme. La CIP m'oriente bien vers des partenaires concrets (par exemple une auto-école sociale pour le permis, Action Logement pour mon logement) et ça, c'est noté dans mes "actions". Mais il n'y a pas d'outil qui cherche pour moi, dans un annuaire officiel comme DORA, le bon service près de chez moi selon mon besoin exact, avec transmission directe et suivi du résultat. **Ça n'existe pas aujourd'hui.**
- **Comment se passe la sortie et le suivi à 6 mois ?** La sortie elle-même (catégorie, documents remis, satisfaction) existe bien et m'a été expliquée. Le suivi après mon départ, en revanche, est programmé automatiquement à **3 mois**, pas à 6 mois — alors qu'on m'a parlé de "3 à 6 mois". Si je change de numéro entre-temps, je ne sais pas ce qui se passe côté outil (rien ne semble prévu pour ce cas). **Ça existe partiellement** : le suivi post-sortie existe, mais pas exactement à l'échéance de 6 mois qu'exige, paraît-il, le financement FSE+.

---

## 4. Mes 10 attentes prioritaires

1. **Un document d'une page, en français simple, qui résume mes engagements, ceux de la structure, mes heures de la semaine et mon prochain rendez-vous.**
   *Pourquoi* : aujourd'hui, ce que je sais de mon parcours tient dans ma tête et dans les papiers qu'on me remet à des moments différents (diagnostic, bilan). Je n'ai jamais tout au même endroit.
   *Ce que ça change* : je pourrais le montrer à mon assistante sociale ou à mon conseiller France Travail sans avoir à tout raconter de mémoire. **Ça n'existe pas aujourd'hui** sous cette forme unique.

2. **Savoir si mes 26 heures de travail comptent dans mes 15-20 h d'engagement du CER, ou si je dois faire autre chose en plus.**
   *Pourquoi* : c'est une question très concrète qui conditionne si je respecte mon CER ou non, et donc si mon RSA est en sécurité.
   *Ce que ça change* : moins de stress à chaque contrôle trimestriel. **Ça n'existe pas aujourd'hui** — même la structure ne l'a pas encore tranché.

3. **Un moyen de prouver une absence avec un motif légitime (santé, rendez-vous administratif, garde d'enfant, transport en panne).**
   *Pourquoi* : j'ai peur qu'une absence, même justifiée, se transforme en "non-respect des engagements" faute de trace.
   *Ce que ça change* : ça me protégerait au moment de la DTR trimestrielle. **Ça n'existe pas aujourd'hui** sous forme structurée.

4. **Un rappel (SMS ou appel) avant mes rendez-vous importants avec la CIP ou un partenaire.**
   *Pourquoi* : je n'ai pas toujours un agenda organisé, et un oubli de rendez-vous peut être mal vu en cas de contrôle d'assiduité.
   *Ce que ça change* : moins de rendez-vous manqués, moins de suspicion. **Ça n'existe pas pour moi aujourd'hui** (le rappel automatique existant part vers la CIP, pas vers moi).

5. **Que quelqu'un m'explique clairement qui est mon "référent unique" officiel.**
   *Pourquoi* : je ne sais pas si c'est la CIP, mon conseiller France Travail, ou quelqu'un au CMS qui doit centraliser mon suivi.
   *Ce que ça change* : je saurais à qui m'adresser en priorité selon le sujet. **Ça n'existe pas aujourd'hui** dans l'outil (pas de champ "orienteur"/"référent unique" distinct).

6. **Que mon CER (le papier signé avec le Département) soit connu de la structure, pas seulement dans mon sac.**
   *Pourquoi* : aujourd'hui, si je perds ce papier ou si je change d'interlocuteur, personne à la structure ne sait ce qu'il contient exactement.
   *Ce que ça change* : la CIP pourrait m'aider à tenir mes engagements en connaissant le contenu réel du CER. **Ça n'existe pas aujourd'hui.**

7. **Que mes démarches logement et permis soient suivies avec un partenaire identifié et une date de prochain point.**
   *Pourquoi* : ce sont mes deux freins les plus lourds au quotidien.
   *Ce que ça change* : de la visibilité sur l'avancée réelle. **Ça existe partiellement** : les partenaires (Action Logement, auto-école sociale) sont déjà connus de l'outil et des actions peuvent leur être rattachées, mais je n'en vois jamais l'état moi-même — je dépends entièrement de ce que la CIP me raconte oralement.

8. **Que le questionnaire de satisfaction de sortie et le suivi après mon départ se fassent vraiment, même si j'ai changé de numéro.**
   *Pourquoi* : je veux que mon passage compte pour quelque chose, y compris pour ceux qui viendront après moi.
   *Ce que ça change* : une meilleure image de la structure auprès du Département, et une vraie occasion de dire ce qui a marché ou pas. **Ça existe** pour la satisfaction de sortie (agrégée, anonyme) ; **ça existe partiellement** pour le suivi post-sortie (programmé à 3 mois, sans solution prévue en cas de numéro injoignable).

9. **Ne pas répéter dix fois les mêmes informations (ma situation, mes freins, mes dettes) à chaque nouvel interlocuteur.**
   *Pourquoi* : c'est fatigant et parfois humiliant de se justifier en boucle.
   *Ce que ça change* : de la dignité dans le suivi. **Ça existe en partie** à l'intérieur de la structure (le diagnostic n'est fait qu'une fois, repris ensuite dans les bilans), mais rien ne circule vers l'extérieur (CMS, France Travail) sans un nouveau récit de ma part.

10. **Un espace à moi, même simple, où je pourrais voir mes prochains rendez-vous et mes documents remis (sans voir les notes internes).**
    *Pourquoi* : j'ai un smartphone, je pourrais vérifier moi-même au lieu de tout retenir.
    *Ce que ça change* : plus d'autonomie, moins de dépendance à la mémoire de la CIP ou à la mienne. **Ça n'existe pas aujourd'hui** — c'est précisément la fonctionnalité "Mon parcours" qui a été envisagée puis reportée à une phase ultérieure du projet.

---

## 5. Points de vigilance dignité / confidentialité

Ce que je **ne veux pas** :

- Que ma situation de santé ou une éventuelle situation judiciaire s'affiche devant mon encadrant technique ou n'importe qui d'autre que la CIP, la RH ou l'administrateur. **Ce point me protège déjà** : d'après ce qu'on m'a expliqué, un responsable d'équipe (manager) ne voit ni le détail de ma santé, ni quoi que ce soit sur un sujet judiciaire — ces champs lui sont retirés automatiquement. Et mon encadrant technique, qui note mes compétences au poste, n'a accès qu'à ça : jamais à ma santé, mon budget ou un sujet judiciaire.
- Qu'on me traite comme un élève qu'on note. Je suis rassuré de voir que, pour l'évaluation de mes compétences au poste, une compétence "pas encore travaillée" se dit "non évalué" et n'est jamais comptée comme un zéro qui plomberait ma moyenne — c'est la même logique que pour mes freins au diagnostic. **Point de vigilance à expliquer plus clairement** cependant : d'après ce que dit le guide de la CIP, l'accès à mes grilles de compétences **n'est pas limité à mon atelier** — un encadrant ou un responsable d'une autre équipe pourrait techniquement consulter mon évaluation. Ça, personne ne me l'a jamais dit, et je trouverais ça juste de le savoir.
- Qu'une intelligence artificielle décide quoi que ce soit de mon avenir. On m'a expliqué qu'une IA aide la CIP à préparer certains entretiens, mais qu'elle ne reçoit **jamais mon nom** (je deviens "Salarié A" dans ce qu'elle voit), qu'elle ne fixe aucun niveau de frein, ne classe aucune sortie, et que tout ce qu'elle propose reste une suggestion que la CIP peut jeter à la poubelle. **Ça me rassure**, à condition qu'on continue à me le dire clairement — je n'ai jamais vu ça écrit noir sur blanc avant qu'on m'en parle en entretien.
- Qu'on envoie mes données quelque part sans me prévenir. On m'a parlé d'un délégué à la protection des données que je peux contacter, et du fait que je peux m'opposer à être recontacté après ma sortie. Ça, c'est du concret et ça compte pour moi.

Ce qui reste, pour moi, **à expliquer davantage** (pas un manque technique, mais un manque d'information de ma part) :

- Je ne savais pas, avant qu'on me le dise en entretien préalable, qu'un questionnaire de personnalité (au moment du recrutement) pouvait être refusé sans que ça me porte préjudice — c'est bien ce qu'on m'a expliqué, mais ce n'est pas moi qui l'ai découvert seul, il a fallu qu'on me le dise oralement.
- Je ne sais toujours pas très bien ce que veut dire "conservé 2 ans après le dernier contact, puis anonymisé" pour mon dossier, ni ce que ça implique concrètement pour moi si je reviens un jour dans une autre structure d'insertion.
- Je voudrais qu'on m'explique, sur un ton simple, la différence entre "l'exemplaire qu'on me remet" et "l'exemplaire du dossier" — j'ai bien compris qu'il y en a deux et que le premier est allégé pour moi, mais je ne sais pas exactement ce que contient l'autre.
- Je ne sais pas non plus ce qui se passe si je demande un jour à voir "tout mon dossier" (pas juste l'exemplaire allégé) : on m'a dit que c'est mon droit, mais personne ne m'a montré comment ça se passerait concrètement — un rendez-vous ? Un courrier ? Une impression complète ?

Une dernière chose que je veux dire clairement, parce que c'est le fond de tout : je ne suis pas un dossier, je suis une personne qui essaie de s'en sortir. J'apprécie qu'on me pose des questions sur mes dettes ou mon logement uniquement pour m'aider, pas pour me juger. Tant que ça reste comme ça, je joue le jeu à fond.

---

## 6. Questions que j'aimerais que la direction tranche

1. **Est-ce que la structure se déclare "référent unique" de mon accompagnement, ou seulement "structure d'accueil" pendant que mon vrai référent reste au CMS/France Travail ?** J'ai besoin de savoir qui décide de quoi.
2. **Est-ce que mes 26 heures de travail hebdomadaires comptent dans les 15-20 heures d'activité que mon CER m'impose, ou dois-je faire des heures en plus ?** Cette question conditionne directement mon niveau de stress au quotidien.
3. **Est-ce qu'on me donne un jour un accès à mon espace (même très simple, sur mon téléphone), ou est-ce que je continuerai à tout recevoir uniquement sur papier ?**
4. **Comment fait-on si je change de numéro de téléphone avant mon suivi post-sortie — est-ce que quelqu'un essaiera de me retrouver autrement, ou est-ce que mon dossier restera simplement "injoignable" ?**
5. **Qui, à la structure, connaîtra le contenu réel de mon CER signé avec le Département — quelqu'un le lira-t-il un jour, ou restera-t-il uniquement dans mon sac ?**
6. **Est-ce que l'accès de mon encadrant technique à mes compétences restera limité à mon atelier, ou est-ce normal qu'un encadrant d'une autre équipe puisse me consulter ?**

---

## 7. Tableau récapitulatif

| Attente | Existe ? | Priorité |
|---|---|---|
| Document unique et simple (engagements, heures, prochain RDV) | Non | Haute |
| Savoir si mes 26 h comptent dans les 15-20 h du CER | Non | Haute |
| Registre des absences avec motif légitime, exploitable en cas de contrôle DTR | Non | Haute |
| Rappel (SMS/mail) de mes rendez-vous, à moi directement | Non (existe seulement vers la CIP) | Haute |
| Référent unique clairement identifié et distinct de l'orienteur | Non | Haute |
| CER connu et suivi par la structure (contenu, avenants, échéances) | Non | Moyenne |
| Suivi de mes démarches logement/permis avec partenaire et échéance visibles pour moi | Partiel (existe côté outil pour la CIP — pas pour moi) | Moyenne |
| Suivi post-sortie réellement à 6 mois (et non 3) + solution si injoignable | Partiel | Moyenne |
| Éviter de répéter dix fois la même information | Partiel (vrai en interne, pas vers l'extérieur) | Moyenne |
| Espace personnel "Mon parcours" (rendez-vous, documents remis) | Non (reporté à une phase ultérieure) | Moyenne |
| Diagnostic d'accueil unique, non répété à chaque entretien | Oui | — |
| "Non évalué" plutôt qu'une note par défaut sur mes freins et mes compétences | Oui | — |
| Exemplaire salarié en langage simple, sans santé/judiciaire | Oui | — |
| IA pseudonymisée, jamais décisionnaire, toujours modifiable par la CIP | Oui | — |
| Masquage santé/judiciaire pour les managers | Oui | — |
| Cloisonnement de mes compétences à mon seul atelier | Non (accès non cloisonné par équipe, assumé pour ce volet) | Basse |
| Opposition possible au contact post-sortie, avec trace | Oui | — |
| Explication orale claire de mes droits RGPD (accès, rectification, opposition) | Oui (mais dépend de la CIP, pas d'un support que je garde) | Basse |
| Mode relecture en fin d'entretien (grande écriture, champs internes masqués) | Oui | — |
| Journal des échanges entre deux rendez-vous, chiffré et limité CIP/RH | Oui (mais invisible pour moi) | Basse |
| Catégorie France Travail (F/G) et critères d'éligibilité IAE typés | Non | Basse (pour moi ; utile surtout à la structure) |
| Suspension du Pass IAE tracée dans l'outil | Non | Basse (pour moi) |

---

## Annexe — les mots que j'ai dû apprendre en 4 mois

Je note ici les mots que j'ai entendus sans forcément les comprendre du premier coup, tels qu'on me les a expliqués (pas de jargon technique inventé pour ce document — ce sont les mots réels du guide de la CIP et des documents du Département) :

- **CDDI** : mon contrat, jusqu'à 24 mois maximum en tout, sauf raisons particulières (formation en cours, avoir 50 ans ou plus, être reconnu travailleur handicapé, ou passer en CDI d'insertion).
- **CER** : le papier signé avec le Département — mes engagements et ceux du Département.
- **DTR** : le contrôle trimestriel de mes engagements (CAF/MSA) — celui qui peut mener à une suspension si je ne respecte rien, sauf motif légitime.
- **Diagnostic d'accueil** : le grand entretien du premier mois, en 14 étapes.
- **Bilan de suivi** : le point régulier avec la CIP, tous les deux mois environ.
- **PMSMP** : une immersion de courte durée dans une autre entreprise.
- **Pass IAE** : l'agrément qui me permet d'être en insertion, valable 24 mois, prolongeable.
- **Frein** : un mot un peu froid pour dire "une difficulté qui me freine" (logement, santé, argent, transport, langue, papiers, informatique, famille, justice) — noté de 1 à 5, ou "non évalué" si on n'a pas encore le recul.
- **Toile d'araignée** : le dessin qui montre mes 9 freins d'un coup d'œil.
- **Exemplaire salarié / exemplaire dossier** : les deux versions du même document — celle qu'on me remet est allégée et simplifiée, l'autre reste au dossier de la structure.
