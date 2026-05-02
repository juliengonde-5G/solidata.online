# Merge des PRs vers la branche feature

> Outils pour merger les 10 PRs (V1 → V4) du plan d'action multi-agents
> de façon ordonnée et sûre. Cible par défaut : `claude/design-app-architecture-hGVgg`.

## Pré-requis

Sur la machine d'où tu lances les merges (poste local ou serveur de déploiement) :

```bash
# gh CLI (GitHub)
# Linux Debian/Ubuntu :
type -p curl >/dev/null || sudo apt-get install -y curl
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
sudo apt-get update && sudo apt-get install -y gh

# jq (parser JSON)
sudo apt-get install -y jq

# Authentification gh (browser-based, fait une fois)
gh auth login

# Vérification
gh auth status
```

> **Note** : si l'installation `gh` te déconnecte du SSH, lance les merges
> depuis ton poste local plutôt que sur le serveur prod. Le merge se fait
> côté GitHub via API ; aucune action serveur n'est nécessaire au moment
> du merge. Le serveur prod ne doit être touché qu'après le merge pour
> rebuild les conteneurs (cf §5).

## Scripts disponibles

| Script | Usage |
|---|---|
| `merge-prs.sh <pr-num>` | merge **une seule** PR avec validations (test merge à blanc + syntax check) |
| `merge-all-prs.sh [--auto]` | orchestrateur des **10 PRs** dans l'ordre, avec pauses |

## Procédure standard (interactive)

```bash
cd /chemin/vers/solidata.online
git pull origin claude/design-app-architecture-hGVgg

# Lance l'orchestrateur — il va merger les 10 PRs en demandant
# confirmation entre chacune.
bash deploy/scripts/merge-all-prs.sh
```

L'orchestrateur :
1. Lance le merge de **PR #31** (V1.1 — sécurité)
2. Pause si demandé
3. Lance **#32**, **#33** (vague V1)
4. **Pause critique** après #33 (init-db modifié) — proposition de rebuild prod
5. Continue avec **#34** → **#40** dans l'ordre
6. Affiche les rappels (rebuild docker, smoke tests…)

## Mode automatique (sans pause)

```bash
bash deploy/scripts/merge-all-prs.sh --auto
```

Utile si tu as déjà une fenêtre de maintenance et veux enchaîner.

## Reprise après échec

Si une PR échoue (conflit non détecté, syntax error…) :

```bash
# Corrige le problème (ex : résoudre les conflits via UI GitHub)
# puis relance à partir de la PR suivante :
FROM_PR=37 bash deploy/scripts/merge-all-prs.sh
```

## Merge d'une seule PR

```bash
bash deploy/scripts/merge-prs.sh 31

# Avec options :
MERGE_METHOD=squash bash deploy/scripts/merge-prs.sh 31
BASE_BRANCH=main bash deploy/scripts/merge-prs.sh 41
```

## Contrôles effectués par le script

Pour chaque PR :

1. **Pré-requis** : gh + jq disponibles, gh authentifié
2. **PR ouverte** et état mergeable (refus si CONFLICTING)
3. **Base correcte** (refuse si la PR ne pointe pas vers la base attendue)
4. **Merge à blanc local** : test git merge sans commit
5. **Syntax check Node** sur tous les `.js` backend modifiés (via worktree temporaire)
6. **Merge GitHub** via `gh pr merge` (méthode `merge` par défaut)
7. **Pull local** avec `--ff-only`
8. **Rappels post-merge** automatiques (init-db, docker, frontend)

Si une étape échoue, le script s'arrête et nettoie ses artefacts (worktrees, branches temp).

## Plan d'enchaînement

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

## Après les 10 merges — rebuild prod

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

## PR finale feature → main

Une fois la branche feature stabilisée et validée en prod, merger vers `main` :

```bash
gh pr create \
    --repo juliengonde-5G/solidata.online \
    --base main \
    --head claude/design-app-architecture-hGVgg \
    --title "[feature] Plan d'action multi-agents — V1 à V4 consolidées" \
    --body "Voir docs/RUNBOOK_INFRA_ROADMAP.md pour le détail"

# Après revue, merger :
gh pr merge <num> --repo juliengonde-5G/solidata.online --merge
```

## Nettoyage des branches feature après stabilisation

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
