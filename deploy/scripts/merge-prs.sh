#!/usr/bin/env bash
# ============================================================
# SOLIDATA — Merge séquentiel des PRs vers la branche feature
#
# Usage : bash deploy/scripts/merge-prs.sh <pr-number>
# Ex    : bash deploy/scripts/merge-prs.sh 31
#
# Pré-requis :
#   - gh CLI installé et authentifié (`gh auth login`)
#   - jq installé (`apt-get install jq` ou `brew install jq`)
#   - Repo cloné, la branche feature en local
#
# Cible par défaut : claude/design-app-architecture-hGVgg
#   (override via env BASE_BRANCH=...)
#
# Le script effectue, pour la PR donnée :
#   1. Vérifie que gh + jq sont disponibles et authentifiés
#   2. Récupère les infos de la PR (titre, head, base, mergeable)
#   3. Refuse si la base ≠ branche feature ou si conflits
#   4. Test de merge à blanc local (avant le vrai merge GitHub)
#   5. Syntax check Node sur les .js backend modifiés
#   6. Merge GitHub (commit de merge classique, pas squash)
#   7. Pull en local
#   8. Rappels post-merge (init-db, docker rebuild, etc.)
# ============================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────
PR_NUMBER="${1:-}"
REPO="${REPO:-juliengonde-5G/solidata.online}"
BASE_BRANCH="${BASE_BRANCH:-claude/design-app-architecture-hGVgg}"
MERGE_METHOD="${MERGE_METHOD:-merge}"   # merge | squash | rebase

if [ -z "${PR_NUMBER}" ]; then
    cat <<EOF
Usage : $0 <pr-number>

Exemples :
    bash $0 31                       # merge la PR #31 sur ${BASE_BRANCH}
    BASE_BRANCH=main bash $0 41      # override la base
    MERGE_METHOD=squash bash $0 31   # squash plutôt que merge classique

Variables d'environnement :
    REPO            défaut : ${REPO}
    BASE_BRANCH     défaut : ${BASE_BRANCH}
    MERGE_METHOD    défaut : ${MERGE_METHOD} (merge|squash|rebase)
EOF
    exit 1
fi

# ─── Couleurs (no-op si tty absent) ───────────────────────────
if [ -t 1 ]; then
    C_RESET='\033[0m'; C_BOLD='\033[1m'; C_RED='\033[31m'
    C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_CYAN='\033[36m'
else
    C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

step()    { printf "${C_CYAN}→ %s${C_RESET}\n" "$*"; }
ok()      { printf "${C_GREEN}✓ %s${C_RESET}\n" "$*"; }
warn()    { printf "${C_YELLOW}⚠ %s${C_RESET}\n" "$*"; }
err()     { printf "${C_RED}✗ %s${C_RESET}\n" "$*" >&2; }
header()  { printf "\n${C_BOLD}════════════════════════════════════════${C_RESET}\n"; \
            printf "${C_BOLD}  %s${C_RESET}\n" "$*"; \
            printf "${C_BOLD}════════════════════════════════════════${C_RESET}\n"; }

# ─── Pré-requis ───────────────────────────────────────────────
header "MERGE PR #${PR_NUMBER} → ${BASE_BRANCH}"

command -v gh >/dev/null 2>&1 || { err "gh CLI absent — installer : https://cli.github.com/"; exit 1; }
command -v jq >/dev/null 2>&1 || { err "jq absent — apt-get install jq"; exit 1; }
gh auth status >/dev/null 2>&1 || { err "gh non authentifié — lance : gh auth login"; exit 1; }

# ─── 1. Récupérer infos PR ────────────────────────────────────
step "Récupération PR #${PR_NUMBER}"
PR_INFO=$(gh pr view "${PR_NUMBER}" --repo "${REPO}" \
    --json title,headRefName,baseRefName,mergeable,mergeStateStatus,state) || {
    err "PR #${PR_NUMBER} introuvable sur ${REPO}"; exit 1;
}

PR_TITLE=$(echo "${PR_INFO}" | jq -r .title)
PR_HEAD=$(echo "${PR_INFO}" | jq -r .headRefName)
PR_BASE=$(echo "${PR_INFO}" | jq -r .baseRefName)
PR_MERGEABLE=$(echo "${PR_INFO}" | jq -r .mergeable)
PR_STATUS=$(echo "${PR_INFO}" | jq -r .mergeStateStatus)
PR_STATE=$(echo "${PR_INFO}" | jq -r .state)

echo "  Title  : ${PR_TITLE}"
echo "  Head   : ${PR_HEAD}"
echo "  Base   : ${PR_BASE}"
echo "  State  : ${PR_STATE}"
echo "  Merge  : ${PR_MERGEABLE} / ${PR_STATUS}"

[ "${PR_STATE}" = "OPEN" ] || { err "PR n'est pas ouverte (state=${PR_STATE})"; exit 1; }
[ "${PR_BASE}" = "${BASE_BRANCH}" ] || {
    err "Base ${PR_BASE} ≠ ${BASE_BRANCH} attendue"
    err "Si voulu, lancer : BASE_BRANCH=${PR_BASE} bash $0 ${PR_NUMBER}"
    exit 1
}

case "${PR_MERGEABLE}" in
    MERGEABLE) ok "PR mergeable" ;;
    CONFLICTING) err "Conflits — résoudre via UI GitHub ou rebase local"; exit 1 ;;
    UNKNOWN) warn "État de mergeabilité non encore calculé par GitHub. Pause 5s et retry…"
             sleep 5
             PR_MERGEABLE=$(gh pr view "${PR_NUMBER}" --repo "${REPO}" --json mergeable --jq .mergeable)
             [ "${PR_MERGEABLE}" = "MERGEABLE" ] || { err "Toujours pas mergeable (${PR_MERGEABLE})"; exit 1; }
             ;;
esac

# ─── 2. Test de merge à blanc local ───────────────────────────
step "Test de merge à blanc local"
git fetch origin "${PR_HEAD}" --quiet
git fetch origin "${BASE_BRANCH}" --quiet

# Sauvegarder la branche courante pour restitution
ORIGINAL_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
TEMP_BRANCH="_test_merge_pr${PR_NUMBER}_$$"

cleanup() {
    git merge --abort 2>/dev/null || true
    git checkout "${ORIGINAL_BRANCH:-${BASE_BRANCH}}" >/dev/null 2>&1 || true
    git branch -D "${TEMP_BRANCH}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git checkout -B "${TEMP_BRANCH}" "origin/${BASE_BRANCH}" >/dev/null 2>&1
if git merge --no-commit --no-ff "origin/${PR_HEAD}" >/dev/null 2>&1; then
    ok "Merge à blanc OK"
    git merge --abort 2>/dev/null || true
else
    err "Conflits locaux — abandon. Résoudre manuellement puis relancer."
    git merge --abort 2>/dev/null || true
    exit 1
fi

git checkout "${BASE_BRANCH}" >/dev/null 2>&1
git branch -D "${TEMP_BRANCH}" >/dev/null 2>&1
trap - EXIT

# ─── 3. Syntax check Node ─────────────────────────────────────
step "Syntax check Node sur fichiers backend modifiés"
CHANGED_FILES=$(gh pr diff "${PR_NUMBER}" --repo "${REPO}" --name-only)
BACKEND_JS=$(echo "${CHANGED_FILES}" | grep -E '^backend/.*\.js$' | grep -v node_modules || true)

if [ -n "${BACKEND_JS}" ]; then
    # On crée un worktree temporaire pour le head de la PR pour vérifier
    # les fichiers tels qu'ils seront après merge.
    WORKTREE_DIR=$(mktemp -d /tmp/solidata-merge-XXXXX)
    git worktree add --quiet "${WORKTREE_DIR}" "origin/${PR_HEAD}"
    SYNTAX_FAIL=0
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        if [ -f "${WORKTREE_DIR}/${f}" ]; then
            if ! node --check "${WORKTREE_DIR}/${f}" 2>/dev/null; then
                err "Erreur syntaxe : ${f}"
                SYNTAX_FAIL=1
            fi
        fi
    done <<< "${BACKEND_JS}"
    git worktree remove --force "${WORKTREE_DIR}" 2>/dev/null || true
    rm -rf "${WORKTREE_DIR}" 2>/dev/null || true

    [ "${SYNTAX_FAIL}" -eq 0 ] || { err "Syntaxe KO — abandon"; exit 1; }
    ok "Syntaxe Node OK"
else
    echo "  (pas de .js backend modifié)"
fi

# ─── 4. Merge GitHub ──────────────────────────────────────────
step "Merge sur GitHub (méthode : ${MERGE_METHOD})"
MERGE_FLAGS=()
case "${MERGE_METHOD}" in
    merge)  MERGE_FLAGS=(--merge) ;;
    squash) MERGE_FLAGS=(--squash) ;;
    rebase) MERGE_FLAGS=(--rebase) ;;
    *)      err "MERGE_METHOD invalide : ${MERGE_METHOD} (merge|squash|rebase)"; exit 1 ;;
esac

# --delete-branch=false : on garde les branches pour traçabilité ;
# le user peut nettoyer plus tard avec : git push origin --delete <branch>
gh pr merge "${PR_NUMBER}" --repo "${REPO}" "${MERGE_FLAGS[@]}" --delete-branch=false

# ─── 5. Pull local ────────────────────────────────────────────
step "Pull local de ${BASE_BRANCH}"
git checkout "${BASE_BRANCH}" >/dev/null 2>&1
git pull --ff-only origin "${BASE_BRANCH}"

# ─── 6. Validation post-merge + rappels ───────────────────────
LATEST=$(git log --oneline -1)
echo "  Dernier commit local : ${LATEST}"

NEEDS_DB_INIT=0
NEEDS_DOCKER=0
NEEDS_FRONT_REBUILD=0

if echo "${CHANGED_FILES}" | grep -q "init-db.js"; then
    NEEDS_DB_INIT=1
fi
if echo "${CHANGED_FILES}" | grep -qE 'docker-compose|Dockerfile'; then
    NEEDS_DOCKER=1
fi
if echo "${CHANGED_FILES}" | grep -qE '^frontend/src/'; then
    NEEDS_FRONT_REBUILD=1
fi

ok "PR #${PR_NUMBER} mergée : ${PR_TITLE}"

echo ""
echo "${C_BOLD}Rappels post-merge :${C_RESET}"
[ "${NEEDS_DB_INIT}" = "1" ]      && warn "init-db.js modifié — migrations s'appliqueront au redémarrage du backend"
[ "${NEEDS_DOCKER}" = "1" ]       && warn "Docker modifié — sur le serveur prod : docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d"
[ "${NEEDS_FRONT_REBUILD}" = "1" ] && warn "Frontend modifié — sur le serveur prod : docker compose -f docker-compose.prod.yml up -d --build frontend"
[ "${NEEDS_DB_INIT}" = "0" ] && [ "${NEEDS_DOCKER}" = "0" ] && [ "${NEEDS_FRONT_REBUILD}" = "0" ] && echo "  (aucun rebuild requis pour cette PR)"

echo ""
echo "${C_BOLD}Prochaines étapes suggérées :${C_RESET}"
echo "  1. Smoke test rapide local (cf 'Test plan' dans la PR)"
echo "  2. Lancer la PR suivante : bash $0 <next-pr>"
echo ""
