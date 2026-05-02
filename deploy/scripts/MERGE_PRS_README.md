# Merge des PRs vers la branche feature

> Outils pour merger les 10 PRs (V1 → V4) du plan d'action multi-agents
> de façon ordonnée et sûre. Cible par défaut : `claude/design-app-architecture-hGVgg`.
>
> **Pas besoin de `gh` CLI** — les scripts utilisent uniquement `curl`,
> `jq`, `git`, `node` (universellement disponibles ou triviaux à installer)
> et un **token GitHub personnel** que tu génères en 30 secondes.

## 1. Génération du token GitHub (1×)

1. Aller sur : https://github.com/settings/tokens/new?scopes=repo&description=solidata-merge
2. Le scope `repo` est pré-coché
3. Définir une expiration (90 jours recommandé)
4. Cliquer **Generate token**
5. Copier le token (commence par `ghp_…`) — **il ne sera plus affiché après**

Puis l'exporter dans ton shell :

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> Pour le rendre persistant (optionnel) : ajouter la ligne ci-dessus
> dans `~/.bashrc` ou `~/.zshrc` (avec une expiration courte sur le token).

## 2. Vérification des dépendances

```bash
# Outils nécessaires (tous standards)
command -v curl >/dev/null && echo "curl OK"
command -v jq   >/dev/null && echo "jq OK"
command -v git  >/dev/null && echo "git OK"
command -v node >/dev/null && echo "node OK"
```

Si `jq` est absent (rare) :

```bash
# Linux — apt
sudo apt-get install -y jq

# macOS — brew
brew install jq

# OU sans permission root, binaire statique :
mkdir -p ~/.local/bin
curl -L -o ~/.local/bin/jq \
    https://github.com/jqlang/jq/releases/latest/download/jq-linux-amd64
chmod +x ~/.local/bin/jq
export PATH="$HOME/.local/bin:$PATH"
jq --version
```

## 3. Lancer les merges

### Procédure standard (interactive)

```bash
cd /chemin/vers/solidata.online
git pull origin claude/design-app-architecture-hGVgg

export GITHUB_TOKEN=ghp_xxxxx

# Lance l'orchestrateur — il merge les 10 PRs en pausant entre chaque.
bash deploy/scripts/merge-all-prs.sh
```

L'orchestrateur :
1. Lance le merge de **PR #31** (V1.1 — sécurité)
2. Pause si demandé (Entrée pour continuer)
3. Lance **#32**, **#33** (vague V1)
4. **Pause critique** après #33 (init-db modifié) — propose le rebuild prod
5. Continue avec **#34** → **#40** dans l'ordre
6. Affiche les rappels (rebuild docker, smoke tests…)

### Mode automatique (sans pause)

```bash
GITHUB_TOKEN=ghp_xxxxx bash deploy/scripts/merge-all-prs.sh --auto
```

### Reprise après échec

Si une PR échoue (conflit, syntax error…) :

```bash
# Corrige le problème (ex : résoudre les conflits via UI GitHub)
# puis relance à partir de la PR :
GITHUB_TOKEN=ghp_xxxxx FROM_PR=37 bash deploy/scripts/merge-all-prs.sh
```

### Merge d'une seule PR

```bash
GITHUB_TOKEN=ghp_xxxxx bash deploy/scripts/merge-prs.sh 31

# Avec options :
GITHUB_TOKEN=ghp_xxxxx MERGE_METHOD=squash bash deploy/scripts/merge-prs.sh 31
GITHUB_TOKEN=ghp_xxxxx BASE_BRANCH=main   bash deploy/scripts/merge-prs.sh 41
```

## 4. Contrôles effectués automatiquement

Pour chaque PR, le script :

1. **Pré-requis** : `curl`, `jq`, `git`, `node` disponibles + token valide
2. **PR ouverte** et état mergeable (refus si conflits)
3. **Base correcte** (refuse si la PR ne pointe pas vers la base attendue)
4. **Merge à blanc local** : test `git merge --no-commit --no-ff`
5. **Syntax check Node** sur tous les `.js` backend modifiés (via worktree temporaire — sans polluer ta branche courante)
6. **Merge GitHub** via API REST (`PUT /repos/.../pulls/N/merge`)
7. **Pull local** avec `--ff-only`
8. **Rappels post-merge** automatiques (init-db, docker, frontend)

Si une étape échoue, le script s'arrête et nettoie ses artefacts (worktrees, branches temp).

## 5. Plan d'enchaînement des 10 PRs

| # | PR | Vague | Description | Critique |
|---|---|---|---|---|
| 1 | #31 | V1.1 | Sécurité (placeholders .env, HttpOnly, err.message, npm audit) | |
| 2 | #32 | V1.2 | Bugs cachés (kg_entree, conversion candidat, FK batch) | |
| 3 | #33 | V1.3 | Conformité (visite médicale, prescripteurs, taux valorisation) | 🛑 init-db |
| 4 | #34 | V2.1 | Refashion auto-source (vues SQL + endpoints DPAV) | |
| 5 | #35 | V2.2 | Référentiel partners (fusion exutoires/clients/boutiques) | |
| 6 | #36 | V2.3 | State machine centralisée | 🛑 init-db |
| 7 | #37 | V3.1 | UX useConfirm (13 fichiers migrés) | |
| 8 | #38 | V3.2 | Dashboard exécutif 8 KPI + alert thresholds | |
| 9 | #39 | V3.3 | useAsyncData + Stock pilote | |
| 10 | #40 | V4 | Tests Jest + FSE+ + runbook restore | |

## 6. Après les 10 merges — rebuild prod

```bash
# Sur le serveur prod (51.159.144.100) :
ssh root@51.159.144.100
cd /opt/solidata.online
git pull origin claude/design-app-architecture-hGVgg
docker compose -f docker-compose.prod.yml up -d --build backend frontend

# Validation
curl -fsS https://solidata.online/api/health | jq .
curl -fsS https://solidata.online/api/health/ready
```

## 7. PR finale feature → main

Une fois la branche feature stabilisée et validée en prod :

```bash
# Création via API (équivalent gh pr create)
curl -fsSL -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    https://api.github.com/repos/juliengonde-5G/solidata.online/pulls \
    -d '{
        "title": "[feature] Plan d action multi-agents — V1 a V4 consolidees",
        "head":  "claude/design-app-architecture-hGVgg",
        "base":  "main",
        "body":  "Voir docs/RUNBOOK_INFRA_ROADMAP.md pour le detail"
    }'
```

Puis merger via le même script :

```bash
GITHUB_TOKEN=$GITHUB_TOKEN BASE_BRANCH=main \
    bash deploy/scripts/merge-prs.sh <pr-finale-num>
```

## 8. Nettoyage des branches feature après stabilisation

Après 1-2 semaines de stabilisation en prod, supprimer les 10 branches feature (gardées par défaut pour rollback) :

```bash
for branch in fix/security-quick-wins-2026-05 fix/data-quick-wins-2026-05 \
              fix/p1-conformite-2026-05 feat/refashion-auto-source-2026-05 \
              feat/partners-merge-2026-05 feat/state-machine-2026-05 \
              feat/ux-sprint-2026-05 feat/dashboard-executive-2026-05 \
              feat/ux-async-data-2026-05 feat/v4-tests-fse-restore-2026-05; do
    git push origin --delete "$branch"
done
```

## 9. Sécurité du token

- Ne jamais committer `GITHUB_TOKEN` dans le repo
- Préférer une expiration courte (90 jours)
- Si le token est compromis, le révoquer immédiatement sur :
  https://github.com/settings/tokens
- Ne pas le partager — chaque collaborateur génère le sien

## 10. Dépannage

### `Token GitHub invalide ou expiré`
→ Régénérer un token avec scope `repo` et exporter à nouveau.

### `PR #X non mergeable (CONFLICTING)`
→ Résoudre via UI GitHub puis relancer.

### Le script ne trouve pas `node`
→ Le syntax check requiert Node. Installer via `nvm` ou `apt`. Si pas
  possible, commenter la section "Syntax check" dans `merge-prs.sh`.

### `git fetch` échoue
→ Vérifier les credentials git (HTTPS ou SSH). Le token GitHub n'est
  pas utilisé pour `git`, seulement pour l'API. Pour `git`, utiliser
  un SSH key ou un credential helper séparé.

### Rate-limit GitHub
→ L'API authentifiée donne 5000 req/h. Largement suffisant pour 10 PRs.
