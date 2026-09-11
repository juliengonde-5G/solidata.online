# Intégration Malibou — synchronisation des collaborateurs et des absences

> Malibou (https://app.malibou.com) est le logiciel de préparation de la paie de
> Solidarité Textiles ; la paie elle-même est établie sous SILAE.
> Cette note décrit ce que SOLIDATA récupère par l'**API publique Malibou**,
> ce qu'il n'en récupère pas, et pourquoi.
>
> Dernière mise à jour : 11 septembre 2026 — spécification OpenAPI **v1.11.0**.

---

## 1. Ce que la question posait

> « Est-ce que tu peux te connecter directement à Malibou ou SILAE pour recueillir
> les informations collaborateurs — sans avoir à passer par l'export comme
> actuellement ? »

**Réponse : oui pour Malibou, partiellement.** L'API publique donne l'identité,
les coordonnées, le statut d'emploi, les contrats et les **absences**. Elle ne
donne **pas** trois informations dont dépendent nos calculs réglementaires.
L'import du classeur de paie reste donc nécessaire — la synchronisation le
**complète**, elle ne le remplace pas.

**SILAE n'est pas accessible directement** : son API est réservée aux éditeurs
partenaires conventionnés, et Solidarité Textiles n'y accède que par
l'intermédiaire de Malibou.

---

## 2. Ce que l'API ne donne pas, et ce que cela empêche

Établi en extrayant la **liste complète des propriétés** de la spécification
OpenAPI v1.11.0, pas par sondage.

| Donnée absente | Ce qui en dépend | Conséquence |
|---|---|---|
| **Heures hebdomadaires contractuelles** | Quotité ETP = heures / 35 (module 32) | Sans elle, **aucun ETP conventionné** n'est calculable |
| **Libellé de poste** | `keepContractForInsertion` reconnaît un CDDI au poste « … Cddi » | Ni l'espace CIP ni le décompte ASP ne savent qui relève de l'insertion |
| **CDDI dans `natureContrat`** | L'énumération s'arrête à `fixed_term` | Un contrat d'insertion y est un CDD comme un autre |

C'est pourquoi le convertisseur **ne nomme pas** `weekly_hours` ni
`qualification` : non nommés, ils restent `null`, et la fusion `COALESCE` de
l'upsert **conserve ce que le classeur a posé** au lieu de l'effacer.

De même, `natureContrat: fixed_term` devient **CDD et jamais CDDI**. Le
requalifier sur une intuition ferait entrer dans le périmètre conventionné des
personnes qui n'en relèvent pas.

### Ce que la synchronisation apporte, en revanche

- l'**identité et les coordonnées** tenues à jour en continu ;
- le **statut d'emploi au jour le jour** — une sortie se voit sans attendre
  l'export mensuel ;
- les **dates de contrat**, fin comprise (alertes de fin de CDDI) ;
- surtout les **absences**, aujourd'hui disponibles une fois par mois seulement.

---

## 3. Minimisation — liste blanche, jamais liste noire

Le convertisseur ne lit **que les champs qu'il nomme**. C'est structurel : si
Malibou ajoute demain un identifiant fiscal ou un RIB secondaire, il n'entrera
pas, sans qu'on ait eu à penser à l'exclure. Une liste noire protège de ce qu'on
a prévu ; une liste blanche protège aussi du reste.

**Jamais lus, et ils existent pourtant dans la réponse** : `ssn`,
`socialSecurityNumber`, `bankAccount.iban`, `bankAccount.bic`. C'est la doctrine
de minimisation posée en 2.2.0 pour l'export, tenue ici à la source — et
vérifiée sur base réelle : après synchronisation, aucune colonne texte de
`employees` ne contient le NIR, l'IBAN ni le BIC de la charge de test.

Sont également **non repris** `nationality` et `address.country` : l'API les
donne en **codes ISO** (`fr`, `ma`…) alors que nos colonnes portent des libellés
lisibles saisis par les RH. Les écraser par un code appauvrirait la fiche.

---

## 4. Permissions de la clé

La clé est créée dans Malibou (**Paramètres → Clés d'API**), en **lecture seule**.

| Permission | Ce qu'elle ouvre | Nécessaire ? |
|---|---|---|
| `org:employee:read` | nom, prénom, **matricule**, e-mail, statut | **Indispensable** — le matricule est la clé de rapprochement |
| `org:employee:details:read` | adresse, téléphone, naissance, ancienneté… **et aussi NIR, IBAN, BIC** | Recommandée (voir ci-dessous) |
| `org:contract:details:read` | contrats, **dates de fin** | Recommandée — sans elle, pas d'alerte de fin de CDDI |
| `org:absence:read` + `org:absence:type:read` | absences et leur type | **Indispensable** au réalisé ETP |
| `org:work_location:read` | établissements | Facultative |

**Arbitrage à connaître** : Malibou **regroupe** dans `org:employee:details:read`
les coordonnées utiles et les données bancaires/NIR. On ne peut pas prendre les
unes sans que la clé ouvre les autres. C'est la liste blanche du convertisseur —
et non le périmètre de la clé — qui garantit que le NIR et l'IBAN n'entrent
jamais en base.

Les permissions `org:company:read` et `org:employee:health_insurance:manage`
sont réservées aux **partenaires conventionnés** : une clé auto-délivrée reçoit
toujours 403 sur les points d'accès correspondants.

---

## 5. Configuration

La clé **ne se saisit dans aucun écran et ne transite par aucune route**. Elle se
pose par un script, sur l'**entrée standard**, pour qu'elle ne traîne ni dans un
historique de shell, ni dans `ps`, ni dans un journal de requêtes :

```bash
docker compose -f docker-compose.prod.yml exec -T backend \
  node src/scripts/configurer-malibou.js --apply
# puis coller la clé, Entrée, Ctrl-D
```

Elle est stockée **chiffrée AES-256-GCM** dans `settings` (helper partagé
`utils/secret-settings.js`, même mécanisme que les jetons SumUp).

Il faut aussi l'**identifiant d'organisation**, qui fait partie du chemin de
chaque appel : Malibou → page « Clés d'API » → menu d'actions → « Copier l'ID
d'organisation ».

Réglages, tous dans `settings` : `malibou.api_key` (chiffrée),
`malibou.api_base`, `malibou.auth_mode`, `malibou.organization_id`.

### Vérifier

`node src/scripts/malibou-diagnostic.js` sonde l'hôte, l'authentification, les
ressources accessibles et rend une **forme rédigée** des réponses (structure et
types, valeurs masquées).

Côté application, ADMIN uniquement :

- `GET /api/malibou/statut` — état de la configuration (**jamais la clé**,
  seulement un aperçu masqué) ;
- `GET /api/malibou/essai` — un appel, qui rend *si l'on voit quelqu'un*, pas
  l'annuaire ;
- `POST /api/malibou/synchroniser` — **simulation par défaut** ;
  `{ "appliquer": true }` pour écrire.

---

## 6. Comment la synchronisation se comporte

Job quotidien **5 h** (`syncMalibou`, supervisé dans `/api/monitoring/jobs`).
Sans clé configurée, il ne fait rien **et ne crie pas**.

**Deux règles qu'on ne transgresse pas :**

1. **Elle n'écrit que ce qu'elle a vu.** Un salarié absent de la réponse n'est
   **jamais** désactivé : l'API peut être filtrée par établissement, une page
   peut manquer, une permission peut avoir été retirée. Désactiver par omission
   ferait disparaître des personnes des effectifs sur un incident réseau.
2. **Elle ne supprime rien.** La fusion est non destructive (`COALESCE`).

Ce qu'elle **signale** plutôt que de le deviner :

- un collaborateur **sans matricule** est compté, jamais apparié sur le nom (au
  premier homonyme, cela créerait un doublon) ;
- une absence dont le salarié est **inconnu de SOLIDATA** est comptée, jamais
  rattachée au hasard ;
- les **types d'absence propres à l'organisation** (`custom_*`) sont nommés :
  ils sont comptés comme déduisant du réalisé ETP, ce qui est le choix prudent,
  mais mérite d'être classé sciemment ;
- la permission `org:contract:details:read` manquante est **sondée une fois** et
  annoncée, au lieu de produire soixante refus.

---

## 7. Le point délicat : une absence, une ligne

`employee_leaves` a pour clé naturelle **(salarié, libellé, date de début)**.
L'import du classeur y écrit le **libellé français** de sa colonne « Type »
(« Congés Payés ») ; l'API, elle, ne connaît que des **codes** (`conge_paye`).

Écrire le code créerait une **seconde ligne pour la même absence**. Or le réalisé
du calcul ETP additionne les jours de chaque ligne : l'absence serait comptée
deux fois et nos ETP paraîtraient plus faibles qu'ils ne sont **devant le
financeur**.

La synchronisation convertit donc chaque code vers le **libellé que Malibou
publie lui-même** (les 28 types intégrés sont repris de la spécification, et un
test les y confronte : un type ajouté chez eux fait tomber la suite au lieu de
passer inaperçu). Un type `custom_*` garde son code — il n'a pas d'autre nom
connu, et en inventer un ne ferait que déplacer le problème.

De la même façon, la **catégorisation** (`holiday` / `sick` / `absence`) est une
**règle unique** extraite dans `utils/absences.js`, que les deux voies
consomment. Recopiée, elle aurait fini par diverger : la même absence aurait
alors changé de nature — donc le réalisé ETP avec elle — selon l'import qui a
tourné en dernier.

### À arbitrer

« Jour de récupération » et « Jour de repos » sont aujourd'hui comptés comme
**déduisant** du réalisé, alors qu'ils rémunèrent des heures **déjà
travaillées** — au même titre que le repos compensateur, qui, lui, ne déduit
pas. La règle en vigueur (celle de l'import du classeur) a été **conservée telle
quelle pour ne modifier aucun chiffre déjà déclaré**. Le jour où la direction
tranche, c'est une seule ligne à changer dans `utils/absences.js`.

---

## 8. Pagination

L'API n'a **pas de curseur**. Chaque réponse de liste déclare `total`, `page` et
`limit` (obligatoires dans la spécification), et la documentation dit par
ailleurs d'incrémenter `page` jusqu'à ce qu'une page rende moins d'éléments que
`limit`.

Le client applique **les deux** conditions d'arrêt, et se sert surtout du total
pour **vérifier** : si le compte final ne tombe pas dessus, l'écart est nommé au
journal. Un import qui perd des salariés en silence ressemble trait pour trait à
un import réussi, et ne se découvre qu'en comptant les absents, des mois plus
tard.

Sur 429, le client temporise et réessaie (retrait exponentiel), comme la
documentation le demande.

---

## 9. Fichiers

| Fichier | Rôle |
|---|---|
| `backend/src/services/malibou.js` | Client HTTP lecture seule (configuration, pagination, temporisation) |
| `backend/src/services/malibou-mapping.js` | Convertisseur **PUR** — liste blanche des champs, tables d'absences |
| `backend/src/services/malibou-sync.js` | Synchronisation (simulation par défaut) |
| `backend/src/utils/absences.js` | **Règle unique** de catégorisation, partagée avec l'import du classeur |
| `backend/src/utils/secret-settings.js` | Stockage chiffré AES-256-GCM des secrets de `settings` |
| `backend/src/routes/malibou.js` | Administration (ADMIN strict) |
| `backend/src/scripts/configurer-malibou.js` | Pose de la clé, **entrée standard uniquement** |
| `backend/src/scripts/malibou-diagnostic.js` | Sonde de configuration et forme rédigée des réponses |
| `backend/tests/fixtures/malibou-types-absence.json` | Les 28 types, extraits **mécaniquement** de la spécification |
