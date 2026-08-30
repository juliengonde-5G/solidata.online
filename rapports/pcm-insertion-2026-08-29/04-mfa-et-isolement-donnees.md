# Double authentification et isolement des données CIP — dossier de mise en œuvre (2.43.0)

**Objet** : l'accès aux données personnelles sensibles des salariés (dossiers d'insertion, freins,
profils PCM, données RH) exige désormais une **double authentification (TOTP)**, et la frontière
entre le périmètre CIP et le reste de l'application a été auditée puis **durcie** : un profil non
habilité — encadrant compris — n'atteint plus ces données, même par une porte détournée.

---

## 1. Double authentification (2FA / TOTP)

### 1.1 Qui est concerné

Les rôles ayant accès à des données sensibles : **ADMIN, RH (les CIP) et DPO** — ainsi
que tout rôle personnalisé construit sur l'un d'eux (la résolution passe par le rôle de base, on ne
contourne pas la mesure en dupliquant « RH »). Liste paramétrable (`settings`, clé
`securite.mfa_roles`) sans redéploiement. **Ne sont pas concernés** : encadrants MANAGER (accès
restreint et masqué conservé), **Praticien PCM** (retiré du périmètre par arbitrage : il fait passer
des tests sans accéder au dossier de recrutement ni au parcours d'insertion — le routeur `/api/pcm`
reste néanmoins gardé pour les ADMIN et RH qui l'empruntent), COLLABORATEUR, RESP_BTQ, AUTORITE,
FINANCE, QHSE, et les chauffeurs (jetons véhicule, jamais de session personne).

### 1.2 Comment ça marche

- **Enrôlement au premier login** : écran bloquant guidé (même mécanique éprouvée que le changement
  de mot de passe forcé) — installation d'une application d'authentification (Google/Microsoft
  Authenticator, FreeOTP…), scan d'un QR code (ou saisie manuelle de la clé), confirmation par un
  code à 6 chiffres, remise **unique** de 8 codes de secours à imprimer/copier.
- **Connexion** : identifiant + mot de passe, puis code à 6 chiffres (ou un code de secours, à
  usage unique). Standard TOTP RFC 6238 (implémentation interne vérifiée contre les 6 vecteurs
  officiels de la RFC), hors-ligne, aucun service externe.
- **Aucun jeton complet n'existe avant le second facteur** : le login d'un compte enrôlé ne délivre
  qu'un jeton de défi à usage unique (5 minutes), sans rôle exploitable. Le jeton définitif porte
  un claim `mfa` vérifié par le serveur.
- **Verrou anti-force-brute dédié** au code (8 échecs / 15 min → blocage temporaire, jamais
  définitif), distinct du compteur de mot de passe mais partageant le même verrou de compte.
- **Téléphone perdu** : code de secours, ou réinitialisation par un ADMIN (page Utilisateurs) —
  toutes les sessions sont alors révoquées et l'utilisateur ré-enrôle à sa prochaine connexion.
  Personne n'est jamais bloqué définitivement.

### 1.3 Protection côté serveur (défense en profondeur)

- Middleware `requireMfa` sur **11 routeurs sensibles** : insertion, pcm, employees, candidates,
  exports, rgpd, users, permissions, admin-db, activity-log, effectifs — sans effet pour les rôles
  non soumis (zéro régression MANAGER/AUTORITE/QHSE…).
- **Socket.IO** : le handshake temps réel refuse une session d'un rôle soumis non vérifiée MFA — y
  compris les jetons émis avant le déploiement (l'utilisateur se reconnecte : offrir 8 h de
  contournement à la fonctionnalité qu'on installe n'aurait pas de sens).
- **Secret TOTP chiffré** en base (AES-256-GCM, clé dédiée `MFA_ENCRYPTION_KEY`, cascade
  documentée) ; codes de secours stockés **hashés**, jamais relisibles.
- Faille fermée pendant l'implémentation : le jeton de défi ne peut appeler **aucune** route
  authentifiée (y compris le changement de mot de passe — sans cette garde, connaître le mot de
  passe aurait suffi à le changer sans franchir le second facteur).

### 1.4 Actions au déploiement

1. `deploy.sh update` (migrations idempotentes ; **backend et frontend partent ensemble** — le
   gate d'enrôlement du front est le chemin de sortie du 403 serveur).
2. Envoyer le **mail d'information** (`05-mail-information-utilisateurs.md`) aux comptes concernés.
3. Enrôler le **compte API du smoke test** puis renseigner `API_TOTP_SECRET` dans le `.env`
   serveur — sinon le contrôle post-déploiement des endpoints protégés tourne en mode dégradé
   (il l'annonce explicitement).
4. Optionnel mais recommandé : poser une clé dédiée `MFA_ENCRYPTION_KEY` dans le `.env`
   (sinon repli sur `PCM_ENCRYPTION_KEY`) — attention : si la cascade repose sur `JWT_SECRET` et
   que celui-ci est un jour tourné, les secrets TOTP deviennent illisibles (message explicite,
   réinitialisation ADMIN, jamais de crash).

## 2. Isolement des données CIP — audit et correctifs

L'audit transversal (auth + toutes les surfaces exposant des données d'insertion/PCM) a confirmé
que les exports, le RGPD, le chatbot, les agrégats Métropole/dashboard et le masquage du diagnostic
étaient corrects — et a trouvé **quatre écarts réels**, tous corrigés :

| Écart | Gravité | Correctif |
|---|---|---|
| Le **profil PCM déchiffré** et un extrait de l'entretien de recrutement fuyaient vers les MANAGER via la fiche insertion (`GET /insertion/:id`), alors que le module PCM leur refuse explicitement cet accès | **Critique** | Correctif **structurel** : pour un MANAGER, le moteur d'analyse n'est plus alimenté en données PCM ni en entretien — rien de dérivé ne peut donc fuir (type cité dans la synthèse, pistes métiers, recommandations). Les booléens de présence restent. Prouvé par contre-épreuve : rétablir l'ancien code fait tomber 8 tests. |
| `GET /employees` renvoyait **toutes les colonnes** aux MANAGER : salaire brut, RQTH, titres de séjour, adresse, lieu/date de naissance, visite médicale, contacts d'urgence… (le correctif fait sur `/teams` en 2.7.0 n'avait jamais été porté à la source première) | **Élevé** | Projection par rôle sur `GET /`, `GET /:id` **et `GET /:id/contracts`** (le salaire figurait aussi sur les avenants). ADMIN/RH inchangés ; la ville est conservée (utile aux tournées). |
| Les **actions CIP** exposaient du texte libre non masqué (dont l'axe judiciaire) aux MANAGER | Moyen | Axe judiciaire : ligne entière retirée (le libellé libre trahirait la nature de l'action), doublé en SQL pour que les totaux restent justes ; axe santé : texte libre retiré. |
| Un MANAGER pouvait **supprimer** une action CIP | Faible | `DELETE` resserré ADMIN/RH. |

S'y ajoutent les correctifs de conformité du module PCM issus de l'audit du volet 1 :
journalisation de chaque consultation d'un rapport de personnalité, entrée dédiée au **registre
art. 30** (le recrutement/PCM n'y figurait pas), **purge du PCM à l'anonymisation** du salarié (il
survivait indéfiniment), retrait du libellé « Alerte Risques Psychosociaux » de toutes les surfaces
(artefact statistique mesuré — 32 % de faux positifs sur réponses aléatoires — remplacé par un
indicateur neutre de cohérence, accompagné d'une mise en garde), encart de méthode sur la fiche,
les PDF et l'écran de passation, et fin de la transmission de cette « alerte » à l'IA.

## 3. Ce qui reste à l'arbitrage de la direction (recommandations, non implémentées)

1. **Déplacer la passation PCM après l'embauche** (acte d'accompagnement, pas de sélection) —
   recommandation centrale de la recherche (`02-recherche-bibliographique.md`, §6.3-6.4).
2. **Refonder ou supprimer l'indicateur « risque »** du moteur PCM (l'affichage est assaini, le
   calcul reste en base) et ajouter les colonnes de fiabilité (`01-audit-module-pcm.md`, D1/D2).
3. Étendre la MFA à FINANCE (données comptables) si souhaité — un réglage suffit.
4. **AIPD** sur le traitement « note de profil + PCM » (évaluation systématique + données
   sensibles + personnes vulnérables).
5. Faire instruire l'usage des marques « Process Communication Model » / « PCM » (Kahler
   Communications, Inc.) dans un logiciel exploité.
