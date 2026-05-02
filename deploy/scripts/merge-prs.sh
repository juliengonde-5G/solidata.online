#!/usr/bin/env bash
# ============================================================
# SOLIDATA — Merge séquentiel des PRs vers la branche feature
#
# Usage :
#   GITHUB_TOKEN=ghp_... bash deploy/scripts/merge-prs.sh <pr-number>
#
# Ex :
#   GITHUB_TOKEN=ghp_xxxxx bash deploy/scripts/merge-prs.sh 31
#
# ─── Pré-requis (que des outils universels) ──────────────────
#   - bash, curl, jq, git, node (déjà présents en général)
#   - Token GitHub avec scope `repo` :
#       https://github.com/settings/tokens/new?scopes=repo&description=solidata-merge
#     Une fois généré, exporter :
#       export GITHUB_TOKEN=ghp_xxxxx
#
# Si jq absent (rare) :
#   sudo apt-get install -y jq
#   # ou en binaire statique sans installation système :
#   curl -L -o ~/.local/bin/jq https://github.com/jqlang/jq/releases/latest/download/jq-linux-amd64
#   chmod +x ~/.local/bin/jq && export PATH="$HOME/.local/bin:$PATH"
#
# ─── Cible et options ────────────────────────────────────────
#   Cible par défaut : claude/design-app-architecture-hGVgg
#   (override via env BASE_BRANCH=...)
#
# Le script :
#   1. Vérifie outils + token
#   2. Récupère infos PR via API GitHub
#   3. Refuse si base ≠ branche cible ou si conflits
#   4. Test de merge à blanc local
#   5. Syntax check Node sur les .js backend modifiés
#   6. Merge via API GitHub (POST /merge)
#   7. Pull en local
#   8. Affiche les rappels post-merge
# ============================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────
PR_NUMBER="${1:-}"
REPO="${REPO:-juliengonde-5G/solidata.online}"
BASE_BRANCH="${BASE_BRANCH:-claude/design-app-architecture-hGVgg}"
MERGE_METHOD="${MERGE_METHOD:-merge}"   # merge | squash | rebase

if [ -z "${PR_NUMBER}" ]; then
    cat <<EOF
Usage : GITHUB_TOKEN=ghp_xxx $0 <pr-number>

Variables d'environnement :
    GITHUB_TOKEN    OBLIGATOIRE — token avec scope 'repo'
    REPO            défaut : ${REPO}
    BASE_BRANCH     défaut : ${BASE_BRANCH}
    MERGE_METHOD    défaut : ${MERGE_METHOD} (merge|squash|rebase)

Génère un token sur :
    https://github.com/settings/tokens/new?scopes=repo&description=solidata-merge
EOF
    exit 1
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "✗ GITHUB_TOKEN absent. Exporter d'abord :" >&2
    echo "    export GITHUB_TOKEN=ghp_xxxxx" >&2
    echo "  Génère un token avec scope 'repo' sur :" >&2
    echo "    https://github.com/settings/tokens/new?scopes=repo&description=solidata-merge" >&2
    exit 1
fi

# ─── Couleurs ─────────────────────────────────────────────────
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

for tool in curl jq git node; do
    command -v "${tool}" >/dev/null 2>&1 || { err "${tool} absent"; exit 1; }
done

# ─── Helpers API GitHub ───────────────────────────────────────
GITHUB_API="https://api.github.com"
AUTH_HEADER="Authorization: Bearer ${GITHUB_TOKEN}"
ACCEPT_HEADER="Accept: application/vnd.github+json"
API_VERSION="X-GitHub-Api-Version: 2022-11-28"

api_get() {
    local path="$1"
    curl -fsSL -H "${AUTH_HEADER}" -H "${ACCEPT_HEADER}" -H "${API_VERSION}" \
        "${GITHUB_API}${path}"
}

api_put() {
    local path="$1"
    local body="$2"
    curl -fsSL -X PUT -H "${AUTH_HEADER}" -H "${ACCEPT_HEADER}" -H "${API_VERSION}" \
        -H "Content-Type: application/json" \
        --data "${body}" \
        "${GITHUB_API}${path}"
}

# Vérifier que le token est valide en interrogeant /user
step "Validation du token GitHub"
USER_LOGIN=$(api_get "/user" 2>/dev/null | jq -r .login 2>/dev/null || echo "")
if [ -z "${USER_LOGIN}" ] || [ "${USER_LOGIN}" = "null" ]; then
    err "Token GitHub invalide ou expiré. Régénère sur :"
    err "  https://github.com/settings/tokens/new?scopes=repo&description=solidata-merge"
    exit 1
fi
ok "Authentifié comme ${USER_LOGIN}"

# ─── 1. Récupérer infos PR ────────────────────────────────────
step "Récupération PR #${PR_NUMBER}"
PR_INFO=$(api_get "/repos/${REPO}/pulls/${PR_NUMBER}") || {
    err "PR #${PR_NUMBER} introuvable sur ${REPO}"; exit 1;
}

PR_TITLE=$(echo "${PR_INFO}" | jq -r .title)
PR_HEAD=$(echo "${PR_INFO}" | jq -r .head.ref)
PR_BASE=$(echo "${PR_INFO}" | jq -r .base.ref)
PR_MERGEABLE=$(echo "${PR_INFO}" | jq -r .mergeable)         # true / false / null
PR_STATE=$(echo "${PR_INFO}" | jq -r .state)                 # open / closed
PR_MERGED=$(echo "${PR_INFO}" | jq -r .merged)               # true / false

echo "  Title  : ${PR_TITLE}"
echo "  Head   : ${PR_HEAD}"
echo "  Base   : ${PR_BASE}"
echo "  State  : ${PR_STATE}"
echo "  Merged : ${PR_MERGED}"
echo "  Merge  : ${PR_MERGEABLE}"

[ "${PR_MERGED}" != "true" ] || { warn "PR déjà mergée — skip"; exit 0; }
[ "${PR_STATE}" = "open" ] || { err "PR n'est pas ouverte (state=${PR_STATE})"; exit 1; }
[ "${PR_BASE}" = "${BASE_BRANCH}" ] || {
    err "Base ${PR_BASE} ≠ ${BASE_BRANCH} attendue"
    err "Si voulu, lancer : BASE_BRANCH=${PR_BASE} bash $0 ${PR_NUMBER}"
    exit 1
}

# mergeable peut être null si GitHub n'a pas encore calculé l'état
case "${PR_MERGEABLE}" in
    true)  ok "PR mergeable" ;;
    false) err "Conflits — résoudre via UI GitHub ou rebase local"; exit 1 ;;
    null)  warn "État non encore calculé par GitHub — pause 5s puis retry"
           sleep 5
           PR_MERGEABLE=$(api_get "/repos/${REPO}/pulls/${PR_NUMBER}" | jq -r .mergeable)
           [ "${PR_MERGEABLE}" = "true" ] || { err "Toujours non mergeable (${PR_MERGEABLE})"; exit 1; }
           ok "PR mergeable (après recalcul)"
           ;;
esac

# ─── 2. Test de merge à blanc local ───────────────────────────
step "Test de merge à blanc local"
git fetch origin "${PR_HEAD}" --quiet
git fetch origin "${BASE_BRANCH}" --quiet

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

# ─── 3. Liste des fichiers modifiés (via API) ─────────────────
step "Récupération liste des fichiers modifiés"
# /pulls/:n/files retourne paginé (max 30 par défaut, 100 par page)
CHANGED_FILES=$(api_get "/repos/${REPO}/pulls/${PR_NUMBER}/files?per_page=100" \
    | jq -r '.[].filename')
NB_FILES=$(echo "${CHANGED_FILES}" | grep -c . || true)
echo "  ${NB_FILES} fichiers modifiés"

BACKEND_JS=$(echo "${CHANGED_FILES}" | grep -E '^backend/.*\.js$' | grep -v node_modules || true)

# ─── 4. Syntax check Node ─────────────────────────────────────
if [ -n "${BACKEND_JS}" ]; then
    step "Syntax check Node sur fichiers backend modifiés"
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
fi

# ─── 5. Merge via API GitHub ──────────────────────────────────
step "Merge sur GitHub (méthode : ${MERGE_METHOD})"
MERGE_BODY=$(jq -n \
    --arg method "${MERGE_METHOD}" \
    --arg title "Merge PR #${PR_NUMBER}: ${PR_TITLE}" \
    '{merge_method: $method, commit_title: $title}')

MERGE_RESPONSE=$(api_put "/repos/${REPO}/pulls/${PR_NUMBER}/merge" "${MERGE_BODY}") || {
    err "Échec du merge via API"
    exit 1
}

MERGE_OK=$(echo "${MERGE_RESPONSE}" | jq -r .merged)
if [ "${MERGE_OK}" != "true" ]; then
    err "Réponse API : $(echo "${MERGE_RESPONSE}" | jq -c .)"
    exit 1
fi
MERGE_SHA=$(echo "${MERGE_RESPONSE}" | jq -r .sha)
ok "Mergée (SHA: ${MERGE_SHA:0:8})"

# ─── 6. Pull local ────────────────────────────────────────────
step "Pull local de ${BASE_BRANCH}"
if [ "${ORIGINAL_BRANCH}" = "${BASE_BRANCH}" ]; then
    git pull --ff-only origin "${BASE_BRANCH}"
else
    git fetch origin "${BASE_BRANCH}":"${BASE_BRANCH}" --quiet || \
        git fetch origin "${BASE_BRANCH}" --quiet
    warn "Branche courante : ${ORIGINAL_BRANCH} (pas ${BASE_BRANCH})"
    warn "Pour bénéficier du merge en local : git checkout ${BASE_BRANCH} && git pull --ff-only"
fi

# ─── 7. Validation post-merge + rappels ───────────────────────
LATEST=$(git log --oneline -1 "origin/${BASE_BRANCH}")
echo "  Dernier commit distant : ${LATEST}"

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
printf "${C_BOLD}Rappels post-merge :${C_RESET}\n"
[ "${NEEDS_DB_INIT}" = "1" ]      && warn "init-db.js modifié — migrations s'appliqueront au redémarrage du backend"
[ "${NEEDS_DOCKER}" = "1" ]       && warn "Docker modifié — sur le serveur prod : docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d"
[ "${NEEDS_FRONT_REBUILD}" = "1" ] && warn "Frontend modifié — sur le serveur prod : docker compose -f docker-compose.prod.yml up -d --build frontend"
[ "${NEEDS_DB_INIT}" = "0" ] && [ "${NEEDS_DOCKER}" = "0" ] && [ "${NEEDS_FRONT_REBUILD}" = "0" ] && echo "  (aucun rebuild requis pour cette PR)"

echo ""
printf "${C_BOLD}Prochaines étapes suggérées :${C_RESET}\n"
echo "  1. Smoke test rapide local (cf 'Test plan' dans la PR)"
echo "  2. Lancer la PR suivante : GITHUB_TOKEN=\$GITHUB_TOKEN bash $0 <next-pr>"
echo ""
