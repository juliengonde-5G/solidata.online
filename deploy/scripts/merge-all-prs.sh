#!/usr/bin/env bash
# ============================================================
# SOLIDATA — Orchestrateur de merge des 10 PRs (V1 → V4)
#
# Usage : bash deploy/scripts/merge-all-prs.sh [--auto]
#
#   sans --auto  : pause entre chaque PR pour validation manuelle (par défaut)
#   avec --auto  : enchaîne les 10 PRs sans pause
#
# Le script s'appuie sur deploy/scripts/merge-prs.sh pour chaque PR.
# Si une PR échoue (conflit, syntax, etc.), le script s'arrête —
# corriger puis relancer en passant la PR de reprise via FROM_PR=<n>.
#
# Exemples :
#   bash deploy/scripts/merge-all-prs.sh                  # interactif, depuis PR #31
#   bash deploy/scripts/merge-all-prs.sh --auto           # auto, sans pause
#   FROM_PR=37 bash deploy/scripts/merge-all-prs.sh       # reprend à PR #37
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MERGE_SCRIPT="${SCRIPT_DIR}/merge-prs.sh"

[ -x "${MERGE_SCRIPT}" ] || chmod +x "${MERGE_SCRIPT}"

AUTO=0
[ "${1:-}" = "--auto" ] && AUTO=1

# ─── Couleurs ─────────────────────────────────────────────────
if [ -t 1 ]; then
    C_RESET='\033[0m'; C_BOLD='\033[1m'; C_CYAN='\033[36m'; C_YELLOW='\033[33m'
else
    C_RESET=''; C_BOLD=''; C_CYAN=''; C_YELLOW=''
fi

# ─── Plan d'enchaînement ──────────────────────────────────────
# Format : "<pr_num>|<vague>|<description>|<pause_apres_si_critique>"
PLAN=(
    "31|V1.1|Sécurité (placeholders .env, refresh HttpOnly, err.message, npm audit)|0"
    "32|V1.2|Bugs cachés (kg_entree, conversion candidat, FK batch)|0"
    "33|V1.3|Conformité (visite médicale, prescripteurs, taux valorisation)|1"
    "34|V2.1|Refashion auto-source (vues SQL + endpoints DPAV)|0"
    "35|V2.2|Référentiel partners (fusion exutoires/clients/boutiques)|0"
    "36|V2.3|State machine centralisée|1"
    "37|V3.1|UX useConfirm (13 fichiers migrés)|0"
    "38|V3.2|Dashboard exécutif 8 KPI + alert thresholds|0"
    "39|V3.3|useAsyncData + Stock pilote|0"
    "40|V4|Tests Jest + FSE+ + runbook restore|0"
)

FROM_PR="${FROM_PR:-31}"

printf "${C_BOLD}══════════════════════════════════════════════════════════════════${C_RESET}\n"
printf "${C_BOLD}  SOLIDATA — Orchestration merge des PRs (à partir de #${FROM_PR})${C_RESET}\n"
printf "${C_BOLD}══════════════════════════════════════════════════════════════════${C_RESET}\n\n"

if [ "${AUTO}" = "1" ]; then
    printf "${C_YELLOW}Mode AUTO — pas de pause entre PRs${C_RESET}\n\n"
else
    printf "${C_CYAN}Mode INTERACTIF — pause entre PRs (Entrée pour continuer, Ctrl+C pour arrêter)${C_RESET}\n\n"
fi

SKIPPED=0

for entry in "${PLAN[@]}"; do
    IFS='|' read -r PR_NUM VAGUE DESC PAUSE_AFTER <<< "${entry}"

    if [ "${PR_NUM}" -lt "${FROM_PR}" ]; then
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    printf "\n${C_BOLD}─── PR #${PR_NUM} [${VAGUE}] ${DESC} ───${C_RESET}\n"

    # Lancer le merge
    if ! bash "${MERGE_SCRIPT}" "${PR_NUM}"; then
        printf "\n${C_YELLOW}⚠ Échec sur PR #${PR_NUM}. Pour reprendre après correction :${C_RESET}\n"
        printf "    FROM_PR=${PR_NUM} bash $0\n"
        exit 1
    fi

    # Pause après PR critique (init-db, migration de données)
    if [ "${PAUSE_AFTER}" = "1" ]; then
        printf "\n${C_YELLOW}━━ Pause critique après PR #${PR_NUM} ━━${C_RESET}\n"
        printf "${C_YELLOW}Cette PR a modifié init-db.js (migrations DB).${C_RESET}\n"
        printf "${C_YELLOW}Sur le serveur prod, redémarrer le backend pour appliquer :${C_RESET}\n"
        printf "    docker compose -f docker-compose.prod.yml up -d --build backend\n"
        printf "${C_YELLOW}Puis valider via :${C_RESET}\n"
        printf "    curl -fsS https://solidata.online/api/health | jq .\n"
    fi

    # Pause interactive si pas en mode auto
    if [ "${AUTO}" = "0" ] && [ "${PR_NUM}" != "40" ]; then
        printf "\n${C_CYAN}Appuyer sur Entrée pour passer à la PR suivante (Ctrl+C pour arrêter)…${C_RESET}\n"
        read -r _ </dev/tty || true
    fi
done

printf "\n${C_BOLD}══════════════════════════════════════════════════════════════════${C_RESET}\n"
printf "${C_BOLD}  ✓ Toutes les PRs traitées (${#PLAN[@]} planifiées, ${SKIPPED} skippées)${C_RESET}\n"
printf "${C_BOLD}══════════════════════════════════════════════════════════════════${C_RESET}\n\n"

cat <<EOF
Prochaines étapes :

1. Sur le serveur prod, rebuild final si pas déjà fait :
     docker compose -f docker-compose.prod.yml up -d --build backend frontend

2. Validation prod :
     curl -fsS https://solidata.online/api/health | jq .
     curl -fsS https://solidata.online/api/health/ready

3. Smoke tests métier (à faire manuellement via UI) :
     - Login admin
     - Créer un candidat → convertir en employé → vérifier diagnostic + jalons créés
     - Ouvrir /dashboard-executif
     - Tester /admin-alert-thresholds (modifier un seuil)
     - Page /stock charge avec ErrorState fonctionnel

4. PR finale feature → main :
     gh pr create --base main --head claude/design-app-architecture-hGVgg \\
        --title "[feature] Plan d'action multi-agents — V1 à V4 consolidées" \\
        --body-file docs/RUNBOOK_INFRA_ROADMAP.md
     # Puis valider en review et merger via :
     gh pr merge <pr-feature-num> --repo juliengonde-5G/solidata.online --merge
EOF
