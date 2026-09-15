# PR C « Section CIP et documents du salarié » — correctifs

> **Agent de correctifs**, 13/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-c`,
> base `1d2a9e5` (rapport de debug 23).
> **Traite** : `22-revue-securite-PR-C.md` (2 bloquants, 10 majeurs, 12 mineurs) et
> `23-debug-postgres-PR-C.md` (1 bloquant, 2 majeurs, 2 moyens, 2 mineurs, § 6 constats).
> **Méthode** : le correctif proposé par le rapport est le point de départ ; quand il a été fait
> autrement, la raison est écrite. Chaque correctif est **verrouillé par un test qui échouait
> avant**. Les rouges du rapport 23 passent au vert **sous `TZ=UTC` ET `TZ=Europe/Paris`**.
> **Périmètre d'écriture** : code PR C, tests, `deploy/nginx`. Ni `docs/`, ni `CLAUDE.md` — les
> phrases de documentation que ces correctifs rendent fausses sont listées au § 6.

---

## 0. En une phrase

**31 constats sur 31 sont corrigés** (24 sécurité + 7 debug, dont trois couples qui désignaient le
même défaut). Ce qui bloquait tient en trois choses, et les trois tombent : le **jeton ETI** — un
identifiant de connexion sans compte, valable 60 jours — ne sort plus d'aucune surface et n'est plus
servi à qui n'a pas le droit d'écrire le formulaire qu'il ouvre ; **l'écran public** ne rend plus que
ce que l'encadrant a lui-même écrit, dans une enveloppe bornée et sous transaction tracée ; et le
**SMS de rappel** annonce enfin l'heure que la conseillère a saisie, au lieu de la décaler de deux
heures sur la seule fonction de la PR qui parle directement à la personne.

Trois défauts **hors périmètre PR C** ont été corrigés au passage parce qu'ils appartenaient à la
même famille et que les laisser aurait rendu le correctif partiel : le titre libre d'un entretien
servi par `GET /insertion/cohorte/stats` (préexistant, même classe que M-01), le contact en clair
écrit au journal serveur en dry-run (`notification.js`, m-11) et l'absence d'échappement HTML du
corps d'e-mail (m-10) — ce dernier profitant aux six autres appelants du service.

**Chiffres** : Jest **244 suites / 4 928 tests verts** (11 suites ignorées : les e2e à base réelle) ;
**136 vérifications e2e PR C vertes** sous les deux fuseaux (129 avant, dont 8 et 9 rouges) ;
**non-régression PR A + PR B : 180/180** sous les deux fuseaux ; build Vite vert ; migrations
rejouées deux fois sur base existante **et sur base neuve** ; **14 contre-épreuves par mutation**,
toutes restaurées.

---

## 1. Constats BLOQUANTS

### B-01 + D-02 — le jeton ETI, credential d'écriture non authentifiée, ne sort plus

*Les deux rapports désignent le même défaut par ses deux bouts : la revue le prend par le masquage et
par `lien_eti`, le debug par les trois surfaces qui rendent la ligne entière. Un seul correctif.*

**Vecteur 1 — le `SELECT im.*`.** `backend/src/routes/insertion/masking.js:68-90` : nouvelle liste
`ALWAYS_HIDDEN_FIELDS` et fonction `stripSecrets(row)`, appelée par `maskInsertionRow` **avant** le
test de rôle (l. 76) et par `maskInsertionRows` pour tous les rôles. Le masquage réservé au MANAGER
laissait le jeton traverser le réseau pour une CIP, s'inscrire dans l'historique de son navigateur et
pouvoir être réexpédié par qui le voit.

> **Fait autrement que proposé** — la revue proposait « une projection explicite » des `SELECT *`.
> Écrite sur une table de plus de soixante colonnes qui en gagne à chaque PR, une projection
> explicite *oublie* : c'est le front qui casse silencieusement à la colonne suivante. Le retrait
> **centralisé** couvre au contraire toute route qui passe par le masquage — y compris celles écrites
> demain — et les trois réponses qui n'y passaient pas ont reçu un `stripSecrets` nommé
> (`routes.js:746`, `:775`, `:1231`). Le test, lui, cherche le jeton **dans la réponse**, pas dans le
> SQL : il tiendrait quelle que soit la méthode.

`backend/src/routes/insertion/routes.js:100` (m-02) : `snapshotMilestone` photographie une **copie**
de la ligne dépouillée du jeton — l'historique partait dans les sauvegardes avec un jeton VIVANT.

**Vecteur 2 — `lien_eti` sans garde d'appartenance.** Nouveau prédicat unique
`backend/src/utils/insertion-appartenance.js` (`estProprietaireEncadrant`, `peutVoirLienEti:58`),
consommé par la garde d'écriture historique (`managerOwnsEmployee`, `routes.js:845`) **et** par les
deux surfaces de cohorte : `routes.js:2911` (`GET /renouvellements`) et `echeances-cip.js:705`
(bloc « Organisation du suivi »). Les deux requêtes projettent `cip_referent_user_id` et
`mgr.user_id` ; c'est la fonction — la seule — qui tranche.

> **Pourquoi pas « ADMIN/RH seulement »**, qui aurait été plus simple : le MANAGER encadrant est le
> destinataire NORMAL de ce lien, et le bouton retombe alors sur `POST …/lien-eti`, qui **régénère**
> — c'est-à-dire qui tue silencieusement le lien que la CIP venait d'envoyer.

**Tests** : `tests/e2e-pr-c/pr-c-eti-e2e.test.js` « DÉFAUT D-02 » et « (suite) » (les trois surfaces,
ADMIN et MANAGER) ; **V-64bis** (un MANAGER non encadrant ne reçoit le lien ni par
`/renouvellements` ni par `/echeances`) et **V-64ter** (l'encadrant référent, lui, le reçoit).
**Preuve** : rouges avant (reproduits à l'identique du rapport 23), verts après, sous les deux
fuseaux. Contre-épreuves M-1 et M-2 (§ 5).

### B-02 — l'écran public ne rend plus le texte libre de la CIP ni son avis

`backend/src/routes/insertion/eti-public.js:50-90` : liste blanche `CLES_FORMULAIRE_ETI`, garde
`remplParEti` et projection `projeterFormulaire:73`. Le GET public ne rend que les clés que **cet
écran** écrit, et seulement si `rempli_par === 'eti'` ; l'avis et la durée de la structure ne sont
plus montrés tant que l'encadrant n'a pas donné les siens (rendre l'avis « défavorable » de la CIP
avant de demander le sien ne fausse pas seulement la confidentialité, il fausse le recueil).

**`rempli_par` est posé par le SERVEUR** à l'écriture (`eti-public.js:268`) : le client ne décide pas
de ce qui sera relu.

**Complément non demandé, mais nécessaire** — les deux trames partageaient la MÊME clé
`commentaires` : l'avis de l'encadrant **écrasait** le commentaire interne de la conseillère, et
celui-ci pouvait reparaître à l'écran public au rechargement. La trame interne écrit désormais
`commentaires_cip` (`frontend/src/components/insertion/EntretienForm.jsx:1002`, lecture avec repli
sur l'ancienne clé). Côté écrans, `projeterFormulaireEti`
(`frontend/src/components/insertion/FormulaireETI.jsx:57`) applique la même liste blanche à l'écran
**authentifié** (`RenouvellementETI.jsx:92`), qui pré-remplissait le commentaire de la CIP dans le
formulaire de l'encadrant — et le lui faisait RENVOYER comme s'il était le sien.

**Tests** : `tests/contract/insertion-eti-public-contract.test.js` — « le texte libre de la CIP ne
sort JAMAIS, ni son avis » (fixture portant « Arrêts maladie répétés… » + `rempli_par` absent),
« une clé étrangère glissée dans le blob n'est pas relayée », « le serveur POSE `rempli_par: eti` ».
Contre-épreuve M-3.

### D-01 — le rappel annonçait 16 h pour un rendez-vous saisi à 14 h *(≈ M-08)*

**Cause** : `interview_date` est un `TIMESTAMP WITHOUT TIME ZONE` qui porte **déjà** l'heure murale de
Paris (saisie `datetime-local`, écrite telle quelle). La convertir « vers Paris » lui ajoute l'offset
une seconde fois.

Nouveau helper PUR `heureMurale` dans `backend/src/utils/date-iso.js:94` — documenté à côté
d'`isoDate`, dont il partage la doctrine (composantes **locales**, jamais l'UTC). Les trois lecteurs
sont alignés, et **deux d'entre eux demandent désormais la valeur à PostgreSQL**, ce qui les rend
indépendants du fuseau du processus :

| Lecteur | Correctif |
|---|---|
| `routes/insertion/routes.js:281` (file active) | `to_char(im.interview_date, 'YYYY-MM-DD' / 'HH24:MI')` dans le LATERAL |
| `services/mon-parcours.js:254` + requête `prochain_rdv` | `to_char`, repli `heureRdv = heureMurale` |
| `services/rappels-rdv.js` (SMS) | `to_char(m.interview_date, 'DD/MM/YYYY' / 'HH24:MI')`, `formaterRdv` réécrit sans aucune conversion |

La règle « minuit ⇒ heure inconnue » porte maintenant sur la valeur **stockée** : l'ancienne effaçait
une heure réelle de 02 h du matin et laissait passer minuit.

**Tests** : e2e « DÉFAUT D-01 » (document ET message), « DÉFAUT D-01 — file active » (14:00 sous les
deux fuseaux), contrat `insertion-liste` (« l'heure et le jour sont lus par PostgreSQL »), unitaire
`rappels-rdv` (fixture réécrite pour porter ce que la BASE porte, avec la raison en commentaire).
Contre-épreuve M-5.

---

## 2. Constats MAJEURS

### M-01 — le titre LIBRE d'un entretien ne prime plus sur la liste fermée

`insertion_milestones.titre` est un `VARCHAR(120)` librement saisi, non masqué, non chiffré.
Il n'est plus **SÉLECTIONNÉ** là où il fuyait : `services/echeances-cip.js` (les deux requêtes du
bloc « Organisation du suivi », libellés en `MILESTONE_TYPE_LABELS_ALL` l. 682 et 691),
`routes/insertion/routes.js:281` (LATERAL de la file active) et `:336` (`prochain_rdv.type`).

Traité **dans la foulée**, comme le demandait la revue : `GET /insertion/cohorte/stats`
(`routes.js:3401`) exposait le même titre pour toute la cohorte à tous les rôles depuis bien avant la
PR C — la clé `titre` est conservée pour le front, mais elle porte le libellé du TYPE.

**Source unique** : `MILESTONE_TYPE_LABELS_ALL` posée dans `routes/insertion/engine.js:39` et
consommée par `routes.js`, `services/fiche-referent.js` et `services/mon-parcours.js` — **trois
copies locales fondues**. C'est l'absence de cette table complète qui avait laissé le moteur
d'échéances retomber sur le titre saisi.

**Tests** : e2e **V-11bis** (« SECRET_TITRE_LIBRE » absent de toute la réponse), contrat
`insertion-liste` (« le TITRE saisi n'est ni lu ni rendu »), contrat `insertion-contract`
(`cohorte/stats` rend « Bilan intermédiaire »). Contre-épreuve M-9bis.

### M-02 — le PUT public borne la forme du JSON avant de le stocker

`eti-public.js:93` `formulaireValide` : objet non-tableau, clés de la liste blanche uniquement,
chaînes ≤ 2 000 caractères, listes ≤ 20 éléments de ≤ 100 caractères, scalaires. Vérifié **avant
toute lecture en base**, comme la liste des noms l'était déjà. 400 `FORMULAIRE_INVALIDE`.

**Tests** : contrat — 2 Mo refusés (le test app monte `express.json({ limit: '10mb' })`, la limite
**réelle** de production : sans cela le parseur répondait 413 et la borne applicative n'était jamais
exercée), 2 000 niveaux d'imbrication refusés, clé inconnue / tableau trop long / objet imbriqué /
tableau nu refusés, `pool.query` jamais appelé. Contre-épreuve M-4.

### M-03 — l'anonymisation ne s'effondre plus sur une colonne absente

`services/anonymization.js:367` : `existingColumns` interroge le catalogue avant l'UPDATE du jeton,
et les cinq colonnes de consentement passent par `nullifyBy` (helper du fichier). Les deux
`try { … } catch (42703)` promettaient « l'anonymisation ne doit pas échouer pour autant » quand,
dans PostgreSQL, une instruction en erreur **avorte la transaction entière** : le droit à
l'effacement n'était pas exercé du tout, et l'erreur rendue (`25P02`) ne nommait même pas la colonne
manquante.

> **Fait autrement que proposé** : la revue offrait le SAVEPOINT ou le catalogue. Le catalogue est
> retenu parce que le fichier l'emploie déjà trois fois et qu'il **n'essaie pas pour voir** — un
> SAVEPOINT rattrape l'erreur, il ne l'évite pas.

**Test** : e2e **V-129** — la colonne `eti_token` est retirée (base où la migration PR C n'est pas
passée : déploiement interrompu, recette, restauration partielle), l'anonymisation **aboutit**, la
colonne est rétablie. **Preuve** : contre-épreuve M-14 → `current transaction is aborted`, le dossier
reste nommé, exactement la reproduction de la revue.

### M-04 — un refus d'envoi n'est plus enregistré « envoyé », et le numéro est envoyable

`services/notification.js` réécrit : `normaliserTelephone:32` (E.164 réel — l'ancien
`+33${phone.substring(1)}` **conservait les espaces**, si bien que le format encouragé par l'écran de
consentement était précisément celui que Brevo refusait), et la réponse porte `ok` + `status` **en
plus** du corps de Brevo (ajout additif : les six autres appelants ignorent la valeur de retour).
`services/rappels-rdv.js:316` : le statut n'est `envoye` que **sur preuve** (`ok`, `messageId`,
`reference`), sinon `echec` avec le motif tronqué ; le bilan du job compte l'échec.
`routes/insertion/salarie.js:422` : le numéro est **normalisé à l'écriture**, et
`masquerDestinataire` le re-présente en forme française (`rappels-rdv.js:117`) — la conseillère
vérifie de vive voix (« c'est bien le 06 qui finit par 78 ? ») et « 33 ** ** ** 78 » ne ressemble à
rien de ce que la personne connaît de son propre numéro.

**Tests** : unitaires « un REFUS de Brevo est tracé echec, jamais envoye » / « un envoi réussi reste
envoye » ; contrat « le numéro est stocké en E.164, jamais avec ses séparateurs » ; e2e V-98 (base
réelle). Contre-épreuve M-8.

### M-05 — le contact est vérifié, et le message ne nomme plus la personne

Deux mesures, la seconde étant celle que la revue proposait à défaut :

1. **Message de vérification** (`routes/insertion/salarie.js:98` `envoyerVerification`, gabarits
   `insertion_rappel_verification` seedés par la migration) : envoyé **au recueil**, pendant que la
   personne est encore devant la conseillère, qui peut demander « vous l'avez reçu ? ». Best effort —
   il n'échoue jamais un consentement déjà écrit et tracé —, son issue est rendue à l'écran
   (`verification.statut`) et journalisée sous un code **distinct**
   (`INSERTION_RAPPEL_VERIFICATION`, libellé ajouté à `rgpd-libelles.js`) : deux lignes portant le
   même code se liraient comme deux consentements.
2. **Le prénom quitte le gabarit** (`migrations/insertion-salarie.js:75`) : c'est lui qui
   transformait une erreur d'un chiffre en divulgation nominative. Mise à jour **non destructive** —
   seul un gabarit resté identique au texte d'origine, mot pour mot, est réécrit ; un gabarit
   retouché par un administrateur ne l'est jamais.

Ce **n'est pas** un double opt-in strict (qui exigerait une confirmation avant d'activer les
rappels, sans voie de retour depuis un SMS) : il reste à l'arbitrage (§ 7).

**Tests** : unitaire de migration (« le message de vérification ne nomme personne », « le gabarit ne
porte plus `{prenom}` », garde d'idempotence étendue aux deux `UPDATE` gardés), contrat (« un message
de vérification est envoyé au recueil », « aucun sur un RETRAIT »), e2e V-109.

### M-06 — le jeton n'apparaît plus en clair dans les journaux nginx

`deploy/nginx/nginx.conf:29-30` : deux expressions ajoutées au `map` existant, pour la **page** et
pour l'**API**. Le raisonnement est celui de la 2.0.1 sur le jeton chauffeur, mot pour mot : c'est
une clé d'authentification, elle n'a rien à faire dans un fichier que l'exploitation lit tous les
jours.

**Test** : `tests/unit/nginx-redaction-jetons.test.js` — il lit le fichier **réel**, en extrait les
expressions du `map` et les rejoue sur des adresses (jeton véhicule en non-régression, page ETI, API
ETI, chaîne de requête, adresse sans jeton). `nginx -t` n'est pas disponible dans cet environnement ;
la syntaxe du bloc est inchangée (mêmes captures nommées, même forme), seules deux lignes s'ajoutent.

### M-07 — les parcours terminés sortent de la file active de l'encadrant

`routes/insertion/routes.js:245` et `services/echeances-cip.js:252` : la rémanence
(`file_active_terminees_mois`) et `?inclure=tous` sont **bornés au rôle**. Le MANAGER retrouve le
périmètre qu'il avait avant la PR C — `en_parcours` seul —, dans la file active **comme** dans le
moteur d'échéances ; la CIP garde les deux, parce que la sortie FSE+ et le relevé à +6 mois se
saisissent APRÈS la sortie et sont ADMIN/RH strict.
`sqlPerimetreFileActive` accepte désormais `moisTermines: 0` et distingue **0 de « non renseigné »**
(`Number(null)` vaut 0).

**Tests** : contrat (trois cas : MANAGER sans terminés, `?inclure=tous` sans effet, CIP inchangée),
e2e **V-06bis** sur base réelle. Contre-épreuve M-7.

### M-08 — voir D-01 (même correctif) · **D-04** en complément

`routes/insertion/routes.js:318` : `insertion_start_date`, `insertion_end_date`, `pass_iae_end`,
`contract_start`, `contract_end` et `contract_end_date` passent par `isoDate` à la composition de la
ligne — le pilote construit une colonne `DATE` à minuit **local**, que `JSON.stringify` rend en UTC :
sous Europe/Paris, `2027-07-10` partait « 2027-07-09T22:00:00Z » et l'écran affichait la veille.
**Test** : e2e « DÉFAUT D-04 » (rouge sous Paris avant, vert sous les deux fuseaux après).

### M-09 — l'écriture ANONYME est transactionnelle, et sa trace est bloquante

`eti-public.js:246-300` : `BEGIN` → snapshot (sur un entretien réalisé) → `UPDATE` → journal RGPD →
`COMMIT`, `pool.connect()` **dans le `try`**, `release()` dans le `finally`. Le journal n'est plus
avalé : sur la seule surface où personne n'est identifié, la trace est ce qui reste.

**Tests** : contrat — ordre `BEGIN`/journal/`COMMIT` vérifié, journal en échec → **500 + ROLLBACK +
aucun COMMIT**, `pool.connect()` en échec → 500 sans fuite du message technique. Contre-épreuve M-10.

### M-10 — « Mon Récap » cesse de nommer la conciliation et l'entreprise d'accueil

`services/mon-parcours.js:92` `TYPE_ENTRETIEN_LABELS_RECAP` : « Entretien de conciliation (protection
des droits) » et « Point avec le référent » sont regroupés sous **« Entretien d'accompagnement »** ;
`:516` la raison sociale de la PMSMP n'est plus imprimée (et, si elle est rétablie, elle est
**tronquée** comme les autres textes). Les deux restent nommés dans « Mon parcours », qui ne circule
pas.

**Réversible par réglage** (doctrine des arbitrages) : `insertion.recap_neutralise`, défaut `true`,
documenté dans `utils/insertion-settings.js:143`. Un réglage illisible retient la valeur la plus
sûre.

**Tests** : e2e **V-81bis** (« conciliation » et « Point avec le référent » absents du JSON stocké,
« Entretien d'accompagnement » présent) et **V-84** (l'objet et les dates restent, la raison sociale
part). Contre-épreuve M-13.

---

## 3. Constats du debug restants

| # | Correctif | Fichier:ligne | Test |
|---|---|---|---|
| **D-03** | La sélection compare le jour **STOCKÉ** (`m.interview_date::date`) à « demain » à Paris : la conversion faisait basculer un rendez-vous de 23:30 au surlendemain — aucun rappel, ni ce soir-là ni jamais | `services/rappels-rdv.js:177` | e2e « DÉFAUT D-03 » ; unitaire « demain est le jour civil de PARIS, comparé au jour STOCKÉ » · contre-épreuve M-6 |
| **D-05** | `reporte_jusqu_au` désigne un **instant** : la colonne passe en `TIMESTAMPTZ` (conversion idempotente, lignes existantes interprétées en UTC — le fuseau du serveur qui les a écrites) | `scripts/migrations/insertion-echeances.js:117` | e2e « DÉFAUT D-05 » (rouge sous Paris avant) |
| **D-06** | **Une seule règle** de délai de sortie FSE+ (`evaluerSortieFse`, fonction PURE) partagée par l'écran des échéances et l'alerte de fiche, qui ne la réclame plus qu'aux **participants** d'un projet cofinancé et la date depuis la sortie de l'OPÉRATION | `services/echeances-cip.js:181` ; `routes/insertion/routes.js:2365` | e2e « DÉFAUT D-06 » et « (suite) » ; 4 tests de contrat `fse-plus` réécrits (seuils, non-participant, rupture anticipée) · contre-épreuve M-11 |
| **D-07** | `job_dating` et `formation` ajoutés au dictionnaire — une action de formation **disparaissait** des engagements de la structure sur le document remis à la personne | `services/mon-parcours.js:115` | e2e « DÉFAUT D-07 » (compare le dictionnaire au CHECK réel) · contre-épreuve M-12 |

**O-02** (constat du debug) est traité avec M-10. **O-01** (deux horloges dans le moteur
d'échéances), **O-03** (parcours terminé sans date de fin) et **O-04** (la trace de remise survit à
l'anonymisation sans dire que le dossier l'a été) restent **non corrigés et documentés** : les trois
sont des constats de doctrine sans conséquence mesurée, et O-01 demande de reprendre chaque
`CURRENT_DATE` du module — un geste qui dépasse un correctif de PR et qui vaut d'être fait d'un seul
tenant (§ 7, point 8).

---

## 4. Constats MINEURS

| # | Correctif | Fichier:ligne |
|---|---|---|
| m-01 | `esc()` échappe aussi `"` et `'` — sans effet aujourd'hui, mais la première interpolation en **attribut** ouvrirait une injection | `frontend/…/pdf-insertion.js:24` |
| m-02 | Le snapshot d'historisation ne recopie plus un jeton VIVANT (traité avec B-01) | `routes/insertion/routes.js:100` |
| m-03 | Le DO-scan du CHECK porte sur `conrelid` **et** `conname` — un homonyme sur une autre table aurait fait croire la contrainte posée | `scripts/migrations/insertion-echeances.js:92` |
| m-04 | Le report est borné à la **file active** : il acceptait n'importe quel salarié existant, permanent compris, et incrémentait un compteur pour rien (404 `HORS_FILE_ACTIVE`) | `routes/insertion/echeances.js:138` |
| m-05 | Une remise **antérieure à la génération** est refusée (400 `REMISE_ANTERIEURE_GENERATION`) : la date n'était bornée que dans le futur | `routes/insertion/salarie.js:301` |
| m-06 | Le **code est aligné sur le registre** art. 30 : un permanent ne peut pas consentir (409 `HORS_PARCOURS`), le RETRAIT reste toujours possible (art. 7-3), et le libellé du registre est précisé pour couvrir le relevé à +6 mois (mise à jour non destructive) | `routes/insertion/salarie.js:459` ; `migrations/insertion-salarie.js:270` |
| m-07 | Un réglage volontairement mis à **0** n'est plus confondu avec l'absence (l'absence est testée avant la conversion) | `services/echeances-cip.js:330` |
| m-08 | `openPrintWindow` ne lève plus de boîte native : elle rend un booléen, l'écran affiche son bandeau | `frontend/…/pdf-insertion.js:36` ; `DocumentsSalariePanel.jsx:97` |
| m-09 | Un local-part de moins de trois caractères est masqué **entièrement** (`a***@x.fr` le révélait) | `services/rappels-rdv.js:102` |
| m-10 | Le corps d'e-mail est **échappé** avant d'être versé dans du HTML (premier appelant à y mettre une donnée de dossier) | `services/notification.js:20` |
| m-11 | Le journal de dry-run masque le destinataire — c'est l'état des environnements de recette | `services/notification.js:69` |
| m-12 | **Noté, non corrigé** (le rapport ne demandait rien) : `GET /echeances/compteur` n'est pas journalisé et recalcule la cohorte derrière un cache de 60 s. À surveiller quand la file grandira ; aucune mesure de charge n'a été faite. |

---

## 5. Contre-épreuves par mutation

Chaque mutation a été appliquée **seule**, la suite jouée, puis le fichier **restauré** (vérifié par
`git diff` après chaque).

| # | Mutation | Effet observé |
|---|---|---|
| M-1 | `stripSecrets` désarmé dans `maskInsertionRow` | **2 rouges** (le jeton ressort pour ADMIN et pour MANAGER) |
| M-2 | `peutVoirLienEti` rend toujours `true` | **1 rouge** (V-64bis : le MANAGER non encadrant reçoit le lien) |
| M-3 | La projection publique rend le blob dès qu'il est un objet | **1 rouge** (« Arrêts maladie… » ressort sur l'écran public) |
| M-4 | La validation de forme du PUT public est neutralisée | **3 rouges** (2 Mo, imbrication, clés hors liste) |
| M-5 | L'heure du SMS est de nouveau convertie vers Paris | **1 rouge** (« 16:00 » pour un rendez-vous de 14:00) |
| M-6 | La sélection reconvertit le jour (`AT TIME ZONE`) | **1 rouge** (le rendez-vous de 23:30 n'est plus candidat) |
| M-7 | Le MANAGER retrouve la rémanence de 7 mois | **1 rouge** (V-06bis) |
| M-8 | Un refus Brevo redevient « envoye » | **1 rouge** (bilan et trace) |
| M-9 | Le titre libre revient dans le libellé, **sans** la colonne | **0 rouge** — *la mutation n'en était pas une* : l'alias n'existait plus dans la requête externe, le code retombait sur le type. Refaite complètement (M-9bis) |
| M-9bis | Le titre libre revient **vraiment** (colonne + alias + libellé) | **1 rouge** (V-11bis : « SECRET_TITRE_LIBRE » ressort) |
| M-10 | Le journal de l'écriture anonyme redevient best-effort | **1 rouge** (l'écriture aboutit sans trace) |
| M-11 | L'alerte de fiche ignore la date de sortie de l'opération | **1 rouge** (D-06 : la fiche se tait quand l'écran alerte) |
| M-12 | Les deux catégories d'action redisparaissent | **1 rouge** (l'engagement de formation quitte le document) |
| M-13 | « Mon Récap » renomme la conciliation | **1 rouge** (V-81bis) |
| M-14 | Le `try/catch 42703` est rétabli dans l'anonymisation | **1 rouge** — `current transaction is aborted`, dossier **non anonymisé** : la reproduction exacte de la revue |

**Ce que M-9 a appris** : une mutation qui ne fait rien tomber n'est pas une preuve que le test est
faible — encore faut-il vérifier que la mutation reproduit bien le défaut. Celle-ci ne le
reproduisait pas ; refaite correctement, elle est rouge.

---

## 6. Preuves — chiffres

| Vérification | Avant | Après |
|---|---|---|
| **Jest complet** (sans base) | 243 suites / 4 898 | **244 suites / 4 928 tests verts**, 11 suites ignorées |
| **e2e PR C** `TZ=UTC` | 121 vertes / **8 rouges** | **136 / 136** |
| **e2e PR C** `TZ=Europe/Paris` | 120 vertes / **9 rouges** | **136 / 136** |
| **Non-régression PR A + PR B** (deux fuseaux) | 180 / 180 | **180 / 180** |
| **Build Vite** | vert | vert |
| **`require` de tous les modules modifiés** (17 fichiers) + montage des routeurs + scheduler | — | vert |
| **Migrations** — base existante rejouée 2× / base **neuve** rejouée 2× | — | exit 0, 0 erreur ; 4 gabarits (2 rappel + 2 vérification), 1 entrée art. 30, colonne en `timestamp with time zone` |

**Commandes exactes**

```bash
source <scratchpad>/db-test.env
cd backend
node src/scripts/init-db.local.js && node src/scripts/init-db.local.js      # idempotence
PR_C_E2E_DB=1 npx jest tests/e2e-pr-c --runInBand                           # 136/136
TZ=Europe/Paris PR_C_E2E_DB=1 npx jest tests/e2e-pr-c --runInBand           # 136/136
PR_A_E2E_DB=1 npx jest tests/e2e-pr-a tests/e2e-pr-b --runInBand            # 180/180
npx jest                                                                    # 244 suites / 4 928
cd ../frontend && npm run build
```

**Deux échecs PRÉEXISTANTS sous `TZ=Europe/Paris`**, hors périmètre PR C et **hors de tout fichier
touché ici** : `tests/unit/cav-photo.test.js` (« la bascule se fait exactement à l'échéance ») et
`tests/contract/tours-planification-contract.test.js` (« saturation-risks : tri par urgence »).
Vérifié par un `git worktree` sur `1d2a9e5` : les deux tombent à l'identique **avant** les
correctifs. Module Collecte — même famille de dates que celle que la PR B a traitée dans l'insertion,
à signaler pour un prochain lot.

---

## 7. Ce qui reste à l'arbitrage (direction / DPO) — avec le défaut appliqué

| # | Question | Ce qui est appliqué en attendant | Comment revenir dessus |
|---|---|---|---|
| 1 | **Durée du lien ETI** (60 j) et extinction à la première transmission | 60 j **conservés** : c'est un arbitrage CIP figé au contrat (« le lien doit survivre à l'entretien qu'il prépare »). La revue suggérait 14 j | `insertion.eti_token_validite_jours` |
| 2 | **Le lien au registre art. 30** comme mode d'accès | Non inscrit : le contrat § 3.1 l'écarte explicitement (mode d'accès, pas traitement). Le geste appartient au DPO | — |
| 3 | **Double opt-in strict** des rappels | Message de **vérification** envoyé au recueil (mesure technique, tracée) ; l'activation reste immédiate, faute de voie de retour depuis un SMS | retirer l'envoi = désactiver les gabarits `insertion_rappel_verification` |
| 4 | **Rétention de la trace des rappels** | **90 jours** (au lieu de 365) : minimisation, et la purge lit désormais **une seule** source de défaut | `insertion.rappels_retention_jours` |
| 5 | **Contenu de « Mon Récap »** (conciliation, référent, entreprise PMSMP) | Neutralisé : libellé générique, pas de raison sociale | `insertion.recap_neutralise = false` |
| 6 | **Mention de pied de « Mon parcours »** | Réécrite : elle dit ce que le document contient (dont le référent) et renvoie au Récap pour ce qui circule | code |
| 7 | **`mes_engagements` imprime le titre d'objectif saisi** | Conservé — c'est le texte co-construit **avec** la personne, seul texte libre du document. À rappeler aux CIP : ce champ s'imprime | — |
| 8 | **O-01 — deux horloges** (`aujourdhuiParis()` en JS, `CURRENT_DATE` en SQL) | Non traité : elles ne divergent qu'entre minuit et 2 h à Paris. À reprendre d'un seul tenant sur tout le module | — |
| 9 | **Périmètre du MANAGER par équipe** (réserve E1 des trois revues) | Non traité — M-07 en réduit la portée sans la traiter | — |
| 10 | **`rgpd_consents` n'est purgé que de l'entrée `rappel_rdv`** à l'anonymisation | Inchangé (défaut préexistant, hors périmètre) | — |

---

## 8. Phrases de documentation que ces correctifs rendent fausses

*(l'orchestrateur les ajuste ; `docs/` n'a pas été touché)*

1. **`docs/GUIDE_CIP_INSERTION.md`, cas 28** — « **Ce qui part dans le message** : le prénom de la
   personne, la date et l'heure… ». Le **prénom a été retiré** du gabarit (M-05). À remplacer par
   « la date et l'heure du rendez-vous, le prénom et l'initiale de la conseillère ».
2. **Même cas 28** — rien n'y annonce le **message de vérification** envoyé au moment du recueil ; il
   change le pas à pas (point 3 : « un message part aussitôt, demandez à la personne si elle l'a
   reçu »). Ajouter aussi qu'un **permanent** ne peut pas consentir (409) et que le **retrait** reste
   toujours possible.
3. **Même cas 28** — « la trace… » : la rétention passe de 365 à **90 jours**.
4. **`docs/VARIABLES_APPLICATION.md:295`** — « `insertion.rappels_retention_jours` défaut **365**
   jours » → **90**. Ajouter `insertion.recap_neutralise` (défaut `true`).
5. **`docs/GUIDE_CIP_INSERTION.md`, cas 27** — « PMSMP avec **l'organisme d'accueil** » : la raison
   sociale n'est plus imprimée sur « Mon Récap ». Et « entretiens désignés par leur type » mérite la
   précision : conciliation et point avec le référent y sont regroupés sous « Entretien
   d'accompagnement ».
6. **Même cas 27** — la mention de pied de « Mon parcours » est réécrite (elle ne promet plus
   l'absence de « situation sociale » sur un document qui nomme le référent).
7. **`docs/DOCUMENTATION_APPLICATIVE.md:269`** (lot 5, file active) — le périmètre
   `en_parcours OU termine < 7 mois` et `?inclure=tous` sont désormais **réservés à ADMIN/RH** ; un
   MANAGER ne reçoit que `en_parcours`.
8. **`docs/DOCUMENTATION_APPLICATIVE.md:268`** (lot 5, échéances) — préciser que les libellés
   viennent de la liste **fermée** des types et que le titre saisi n'est plus lu ; et que `lien_eti`
   n'est servi qu'à ADMIN/RH ou à l'encadrant **référent**.
9. **`docs/DOCUMENTATION_APPLICATIVE.md:274`** (lot 7, rappels) — « seuil
   `insertion.rappels_retention_jours` défaut **365** » → 90 ; « gabarits catégorie
   `insertion_rappel_rdv` » → ajouter `insertion_rappel_verification` ; « demain calculé par
   PostgreSQL en `Europe/Paris` » → préciser **sur le jour stocké, sans conversion** (le contraire
   était le défaut D-03).
10. **`docs/DOCUMENTATION_APPLICATIVE.md:273`** (lot 7, documents) — ajouter que le `TIMESTAMP`
    d'entretien porte l'heure **murale** de Paris et qu'elle n'est jamais reconvertie.
11. **`docs/GUIDE_UTILISATEUR.md` § 4.4** — rien n'y est faux à la lecture, mais la section décrit la
    file active sans distinguer les rôles : la phrase sur les parcours terminés visibles « 7 mois »
    vaut pour la CIP, pas pour l'encadrant.

---

## 9. Commits

```
2db05cd  mention de pied de « Mon parcours » (arbitrage 6)
fc48124  rétention des rappels : une seule source (90 j)
fff2c91  preuve e2e du périmètre du lien encadrant (B-01 vecteur 2)
aaf1042  constats mineurs (m-01, m-03, m-05, m-06, m-08)
f97c3c4  périmètre du MANAGER, rédaction nginx, report borné (M-07, M-06, m-04, m-07)
9a6b49d  refus d'envoi, vérification du contact, anonymisation (M-04, M-05, M-03, m-09/10/11)
857ec57  écran public : projection, bornes, transaction (B-02, M-02, M-09)
8781010  heure murale, Mon Récap (D-01, D-03, D-05, D-07, M-10)
e479301  jeton ETI, titre libre, règle FSE+ unique (B-01, D-02, m-02, M-01, M-08, D-04, D-06)
```

*Agent de correctifs — PR C. Aucun fichier de `docs/` ni `CLAUDE.md` modifié ; les ajustements de
documentation sont listés au § 8.*
