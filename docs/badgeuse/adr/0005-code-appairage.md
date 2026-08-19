# ADR 0005 — Code d'appairage court pour la mise en service d'un poste

**Statut :** Accepté — Août 2026
**Contexte :** retour du premier déploiement. Mettre un poste en service exige de saisir
**deux clés de 64 caractères hexadécimaux** (clé du poste + clé HMAC du site), au clavier
d'un Raspberry, en atelier. C'est long, illisible, et générateur d'erreurs de frappe : la
moitié des incidents de mise en service observés viennent de là.

## Décision

Un **code d'appairage court**, à **usage unique** et **durée limitée**, remplace la saisie
des deux clés :

1. l'ADMIN clique « Code d'appairage » sur la fiche du poste (écran Supervision) ;
2. SOLIDATA affiche un code de **8 caractères** en `XXXX-XXXX` (alphabet sans caractères
   ambigus : ni `I`, `L`, `O`, `U`, ni `0`, `1`) valable **15 minutes** ;
3. sur le poste, l'installateur saisit ce code ;
4. le poste l'échange contre sa configuration complète : clé du poste **nouvellement
   générée**, clé HMAC du site, adresse du serveur, code du poste.

Le code est **consommé** à la première réussite. Les deux clés ne transitent donc plus par
un clavier ni par un presse-papiers : elles vont du serveur au fichier `0600` du poste.

## Analyse de risque

Le code est un secret court, échangé sur une surface publique : c'est le point à border.

| Garde-fou | Valeur |
|---|---|
| Espace de codes | **30⁸ ≈ 6,6 × 10¹¹** (alphabet de 30 symboles) |
| Durée de validité | 15 minutes (paramétrable `badgeuse.appairage_ttl_minutes`) |
| Usage | **unique** — consommé à la première réussite, effacé |
| Débit | 20 tentatives/heure/IP sur l'endpoint de réclamation |
| Portée | un seul poste, celui pour lequel le code a été émis |
| Journalisation | émission et consommation tracées (`badgeuse_badge_historique` non — voir §Conséquences) |

Brute force : le débit autorise **5 tentatives** pendant la fenêtre de validité de 15 minutes,
soit une probabilité de **≈ 7,6 × 10⁻¹²** de tomber sur un code vivant. Même en martelant
l'endpoint au débit maximal pendant une année entière, l'espérance reste de **≈ 2,7 × 10⁻⁷**.
Le risque résiduel est sans commune mesure avec le risque réel qu'il supprime — une clé
recopiée à la main sur un papier, ou une erreur de frappe silencieuse produisant des
condensats faux.

*Note de calcul : l'alphabet retenu compte 30 symboles (8 chiffres + 22 lettres), les
caractères ambigus étant exclus. Le tirage utilise `crypto.randomInt`, uniforme par rejet
d'échantillon — un `octet % 30` favoriserait les 16 premiers symboles d'environ 12 % et
rognerait l'entropie annoncée ici.*

**Ce que le code ne fait pas** : il ne donne accès à aucune donnée de pointage, à aucune
donnée personnelle. Il permet d'obtenir la configuration d'un poste — dont la clé HMAC du
site, qui sert à pseudonymiser les UID de badge. Un attaquant qui l'obtiendrait pourrait
calculer des `uid_hmac`, mais devrait encore disposer d'une clé de poste valide pour
déposer un pointage. La régénération de clé (bouton existant) reste la parade.

## Alternatives écartées

- **Saisie des deux clés** (existant) : conservée en repli, mais cesse d'être le chemin
  nominal.
- **Fichier de configuration déposé sur la carte SD** : conservé, et reste le plus sûr
  pour un déploiement préparé à l'avance depuis un PC. Ne couvre pas le cas « je suis
  devant le poste et je veux le mettre en service maintenant ».
- **QR code affiché à l'écran du back-office, lu par le poste** : élégant, mais suppose une
  caméra sur le poste — absente de la nomenclature.
- **Code sans expiration** : refusé. Un code qui traîne dans un e-mail est un secret
  permanent.

## Conséquences

- Nouvelles colonnes `badgeuse_devices.appairage_code_hash` (SHA-256, jamais le code en
  clair) et `appairage_expire_le`.
- Nouvel endpoint **public** `POST /api/badgeuse/device/v1/appairage`, à débit strictement
  limité, monté dans le routeur device existant.
- La **clé du poste est régénérée** à chaque appairage réussi : un code consommé donne
  toujours une clé neuve, et l'ancienne cesse de valoir. Réinstaller un poste révoque donc
  automatiquement sa clé précédente.
- Contrat d'API device : **v1.4**.
