# Réalisation — PR D, lot 8 « Documentation et présentation »

> Orchestrateur d'après le compte rendu de l'agent `docs`, 14/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-d`.
> Contrat : `25-contrats-techniques-PR-D.md` § 1.3. Cahier des charges : `09-matrice-reporting-autorite.md` § 4.3 (les cinq conditions), § 2 (exports), `06-persona-autorite.md` § 7.2 (les neuf questions).

## 0. En une phrase
Le dossier avec lequel la direction se présente à l'autorité : une **matrice « qui voit quoi » sur une page**, chaque case vérifiée dans le code ; un **déroulé de démonstration d'une heure** répondant aux cinq conditions de la gestionnaire ; la **liste des pièces hors logiciel** avec gabarits ; et une **note aux certificateurs relue promesse par promesse**.

## 1. Créés
| Fichier | Contenu |
|---|---|
| `docs/MATRICE_QUI_VOIT_QUOI_INSERTION.md` | rôles (ADMIN, RH/CIP, MANAGER, COMMUNICATION, AUTORITE, DPO, encadrant par lien public, personne accompagnée) × surfaces, légende ✓ / ∅ absent de l'écran / — masqué / 📄 document ; vérifié dans `insertion/index.js`, `routes.js`, `masking.js`, `cadre.js`, `echeances-cip.js`, `rsa.js`, `temps.js`, `eti-public.js`, `exports.js`, `exports-fse.js`. Constat fait en lisant le code : le MANAGER voit le référent unique (type, nom, contact) alors qu'il n'accède à aucun autre statut social — écrit tel quel, pas supposé. |
| `docs/PRESENTATION_AUTORITE_DEMONSTRATION.md` | les cinq conditions pas à pas, chemins de clic réels, ce que l'autorité doit voir, ce qu'il faut préparer la veille, ce qui peut mal se passer. |
| `docs/PIECES_HORS_LOGICIEL_INSERTION.md` | AIPD, consultation du CSE, note d'information des salariés, base légale de la transmission au référent, convention / annexe financière, maquette MDFSE+ — qui, quand, gabarit, preuve à joindre depuis l'outil (registre art. 30, politique, purges). |

## 2. Modifiés
`PRESENTATION_AUTORITE_INSERTION.md` (section « Ce que vous recevrez » : exports (a)-(f), fréquence, habilitation, état réel ; deux libellés de bouton inexacts corrigés), `NOTE_CERTIFICATEURS_INSERTION.md` (chaque promesse du chantier D vérifiée ; tableau des points retirés / reformulés), `GUIDE_CIP_INSERTION.md` (cas 29-32, 7 captures intégrées, un menu inexistant retiré), `GUIDE_CIP_CONFORMITE_FSE.md` (§ 13, FAQ), `DOCUMENTATION_APPLICATIVE.md` § 2.3.4, `VARIABLES_APPLICATION.md`, `GUIDE_UTILISATEUR.md` § 4.4, `FORMATION_MANAGER_RH_INSERTION.md` (partie 6 dépassée depuis juillet — 7 freins, échelle inversée, jalons M1/M6/M12 — remplacée par un renvoi).

## 3. Ce que le lot a écrit honnêtement, et ce qui a changé ensuite
Le lot 6 travaillait en parallèle : à l'heure de la rédaction, les écrans (onglet « Dialogue de gestion », DORA / aide, débouché PMSMP, tableau des freins enrichi) n'étaient pas encore livrés, et la note aux certificateurs le disait (« aucun écran ne donne accès à ce qui précède »). Le lot 6 les a livrés ensuite ; les correctifs (`29` § 8 bis) ont recensé dix phrases devenues fausses par cet ordre d'exécution, et une **repasse documentaire** les a mises au présent après les correctifs. La leçon est notée pour la méthode : un lot documentaire qui court en parallèle d'un lot de code documente un état intermédiaire — la repasse finale n'est pas optionnelle.

## 4. Non vérifiable au moment de la rédaction
Le rendu visuel du PDF de la synthèse (contrôle à faire) ; les captures d'écran restent les maquettes validées en PR A (`maquettes/captures/`), pas des captures de l'application livrée.
