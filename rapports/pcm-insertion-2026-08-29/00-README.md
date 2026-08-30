# Chantier PCM / Insertion / Sécurité des données — 29 août 2026 (v2.43.0)

Dossier des livrables du chantier demandé par la direction (quatre volets), et de ses suites :

| # | Volet | Livrable | Statut |
|---|-------|----------|--------|
| 1 | Audit du module PCM | `01-audit-module-pcm.md` — audit complet (cartographie, mesures réelles du moteur de scoring, écarts vs méthode canonique, sécurité/RGPD, 24 défauts numérotés, 16 recommandations en 4 priorités). Sondes de mesure reproductibles dans `annexes/probe.js` et `annexes/probe2.js`. | ✔ |
| 2 | Actualisation de la base de connaissance | `02-recherche-bibliographique.md` — recherche bibliographique et scientifique sourcée : corpus fondateur PCM (Kahler, Collignon, NASA/McGuire), statut scientifique, personnalité & recrutement (cadre légal L1221-6/8/9, doctrine CNIL, méta-analyses), stress & risque psychique (Gollac, Paul & Moser), publics en insertion et freins périphériques, synthèse opérationnelle (structure de note, garde-fous, interdits). Annexe d'honnêteté : points à revérifier sur source primaire avant usage opposable. | ✔ |
| 3 | Note de profil initial CIP | `03-note-profil-initial-cip.md` — cadrage fonctionnel et déontologique de la note générée à la liaison candidat→collaborateur (CV + entretien structuré + mises en situation + PCM), remise à la CIP en préambule du diagnostic d'accueil. | ✔ |
| 4 | MFA + isolement des données | `04-mfa-et-isolement-donnees.md` — double authentification TOTP (ADMIN/RH/DPO), correctifs d'isolement, journalisation. `05-mail-information-utilisateurs.md` — mail prêt à envoyer aux utilisateurs. | ✔ |
| 5 | Suites — AIPD | `06-aipd-mode-emploi.md` — mode d'emploi de l'analyse d'impact (pourquoi elle est obligatoire, qui fait quoi, méthode CNIL en 4 étapes, **dossier pré-rempli** des mesures déjà en place, risques à coter, calendrier) répondant à la recommandation du volet 4. | ✔ |

Référence externe reçue du client : parcours de formation PCM pour cadres (autre entreprise), utilisé comme référence comparative de la méthode canonique dans l'audit (volet 1) et comme amorce bibliographique (volet 2). Non versionné ici (document tiers).

Implémentation logicielle associée : voir l'entrée 2.43.0 du `CLAUDE.md` et la documentation applicative/technique mises à jour.
