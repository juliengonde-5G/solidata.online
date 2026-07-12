# ai-agent — DÉCOMMISSIONNÉ

> **Statut : DÉCOMMISSIONNÉ (arbitrage A3, audit 2026-07).**
> Ce chatbot Flask n'est plus déployé et n'est plus maintenu.

## Pourquoi

Le chatbot conversationnel de SOLIDATA est désormais **le chat intégré au backend Node** :
[`backend/src/routes/chat.js`](../backend/src/routes/chat.js) (widget `SolidataBot`, monté sur `/api/chat`,
appelé par `frontend/src/pages/../SolidataBot.jsx`).

Le service Python de ce dossier (`app.py`, Flask) faisait **doublon** avec ce chat intégré :
mêmes prompts, mêmes outils de lecture, même contrôle RGPD par rôle — mais il était **mort en
production** :

- il n'apparaît dans **aucun** `docker-compose.yml` / `docker-compose.prod.yml` à la racine ;
- il n'est référencé par **aucune** configuration nginx (`deploy/nginx/`) ;
- il n'est appelé par **aucun** composant frontend ni mobile ;
- son schéma avait déjà **divergé** de celui du backend (ex. `matieres` vs `categories_sortantes`),
  donc il ne fonctionnerait probablement plus correctement s'il était redéployé tel quel.

Maintenir deux implémentations créait une confusion sur la source de vérité du chatbot et une
surface d'attaque / un coût inutiles. La direction a tranché (A3) : **on décommissionne**.

## Ce qui a été fait

- Le service **n'est monté nulle part** dans les composes racine ni la conf nginx (il ne l'a jamais
  été — rien à retirer, état confirmé lors de la vague 2).
- Le code Python (`app.py`, `templates/`, `static/`, `tests/`, `Dockerfile`) est **conservé pour
  référence**, mais **non déployé**.
- Le `docker-compose.yml` **de ce dossier** (`ai-agent/docker-compose.yml`) est le seul vecteur qui
  aurait pu lancer ce service : **ne pas l'exécuter**. Le remplaçant est `backend/src/routes/chat.js`.

## Si vous cherchez le chatbot

Tout se passe côté backend Node :

- Route : `backend/src/routes/chat.js` (montée sur `/api/chat` dans `backend/src/index.js`).
- Outils lecture seule, contrôle RGPD par rôle, historique, suggestions contextuelles.
- Front : widget `SolidataBot` (panneau slide-in, dictée vocale, synthèse vocale FR).

## Réactivation (déconseillée)

Le code est laissé en l'état pour l'archive. Une réactivation supposerait au minimum : réaligner les
requêtes SQL sur le schéma courant, recâbler un vhost/location nginx, ajouter le service à un compose,
et gérer les secrets — pour un service qui doublonne le chat intégré. Préférez faire évoluer
`backend/src/routes/chat.js`.
