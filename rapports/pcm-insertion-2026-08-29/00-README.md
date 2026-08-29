# Chantier PCM / Insertion / Sécurité des données — 29 août 2026 (v2.43.0)

Dossier des livrables du chantier demandé par la direction, en quatre volets :

| # | Volet | Livrable | Statut |
|---|-------|----------|--------|
| 1 | Audit du module PCM | `01-audit-module-pcm.md` — audit complet (cartographie, mesures réelles du moteur de scoring, écarts vs méthode canonique, sécurité/RGPD, 24 défauts numérotés, 16 recommandations en 4 priorités). Sondes de mesure reproductibles dans `annexes/probe.js` et `annexes/probe2.js`. | ✔ |
| 2 | Actualisation de la base de connaissance | `02-recherche-bibliographique.md` — recherche bibliographique et scientifique sourcée : corpus fondateur PCM (Kahler, Collignon, NASA/McGuire), statut scientifique, personnalité & recrutement (cadre légal L1221-6/8/9, doctrine CNIL, méta-analyses), stress & risque psychique (Gollac, Paul & Moser), publics en insertion et freins périphériques, synthèse opérationnelle (structure de note, garde-fous, interdits). Annexe d'honnêteté : points à revérifier sur source primaire avant usage opposable. | ✔ |
| 3 | Note de profil initial CIP | `03-note-profil-initial-cip.md` — cadrage fonctionnel et déontologique de la note générée à la liaison candidat→collaborateur (CV + entretien structuré + mises en situation + PCM), remise à la CIP en préambule du diagnostic d'accueil. | ✔ |
| 4 | MFA + isolement des données | `04-mfa-et-isolement-donnees.md` — double authentification TOTP (ADMIN/RH/DPO/PCM), correctifs d'isolement, journalisation. `05-mail-information-utilisateurs.md` — mail prêt à envoyer aux utilisateurs. | ✔ |

Référence externe reçue du client : parcours de formation PCM pour cadres (autre entreprise), utilisé comme référence comparative de la méthode canonique dans l'audit (volet 1) et comme amorce bibliographique (volet 2). Non versionné ici (document tiers).

Implémentation logicielle associée : voir l'entrée 2.43.0 du `CLAUDE.md` et la documentation applicative/technique mises à jour.
