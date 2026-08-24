#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# Remplacement de la clé API Anthropic dans le .env de production
# ══════════════════════════════════════════════════════════════════════════
#
# POURQUOI UN SCRIPT PLUTÔT QU'UN COUP D'ÉDITEUR
#   • la clé est saisie SANS ÉCHO et n'est jamais passée en argument : elle
#     n'apparaît donc ni à l'écran, ni dans ~/.bash_history, ni dans `ps` ;
#   • le fichier est SAUVEGARDÉ avant modification, en 600 ;
#   • les lignes orphelines de clé (une valeur repliée sur sa propre ligne,
#     à l'origine de l'incident du 24/08/2026) sont retirées au passage ;
#   • le fichier est réécrit sans jamais faire passer la clé par un motif
#     `sed` — aucun risque d'échappement ou de collision de délimiteur.
#
# USAGE (sur le serveur, depuis /opt/solidata.online) :
#   bash deploy/scripts/set-anthropic-key.sh
#
# La clé est demandée en saisie masquée. Rien n'est affiché en clair.

set -euo pipefail

ENV_FILE="${1:-.env}"
VARIABLE="ANTHROPIC_API_KEY"

rouge()  { printf '\033[0;31m%s\033[0m\n' "$*"; }
vert()   { printf '\033[0;32m%s\033[0m\n' "$*"; }
jaune()  { printf '\033[0;33m%s\033[0m\n' "$*"; }

if [ ! -f "$ENV_FILE" ]; then
  rouge "Fichier introuvable : $ENV_FILE"
  rouge "Placez-vous dans /opt/solidata.online, ou passez le chemin en argument."
  exit 1
fi

echo "Fichier ciblé : $ENV_FILE"
echo
echo "Collez la nouvelle clé Anthropic (la saisie reste invisible), puis Entrée :"
# -s : pas d'écho. -r : pas d'interprétation des antislashs.
read -rs CLE
echo

# ── Contrôles de forme, SANS jamais afficher la valeur ────────────────────
if [ -z "${CLE}" ]; then
  rouge "Aucune clé saisie — rien n'a été modifié."
  exit 1
fi
# Un copier-coller depuis un navigateur ramène souvent une espace ou un
# retour à la ligne : on les retire avant de valider la forme.
CLE="$(printf '%s' "$CLE" | tr -d '[:space:]')"
case "$CLE" in
  sk-ant-*) ;;
  *)
    rouge "Cette valeur ne ressemble pas à une clé Anthropic (elle doit commencer par « sk-ant- »)."
    rouge "Rien n'a été modifié."
    exit 1
    ;;
esac
if [ "${#CLE}" -lt 40 ]; then
  rouge "Clé trop courte (${#CLE} caractères) — copie probablement incomplète. Rien n'a été modifié."
  exit 1
fi

# ── Sauvegarde ────────────────────────────────────────────────────────────
HORODATAGE="$(date +%Y%m%d-%H%M%S)"
SAUVEGARDE="${ENV_FILE}.bak-${HORODATAGE}"
cp -p "$ENV_FILE" "$SAUVEGARDE"
chmod 600 "$SAUVEGARDE"
vert "Sauvegarde : $SAUVEGARDE"

# ── Réécriture ────────────────────────────────────────────────────────────
# On reconstruit le fichier plutôt que de faire un `sed` sur place : la clé
# ne traverse ainsi aucun motif d'expression régulière.
TEMPORAIRE="$(mktemp)"
chmod 600 "$TEMPORAIRE"
trap 'rm -f "$TEMPORAIRE"' EXIT

ANCIENNES="$(grep -c -E "^[[:space:]]*${VARIABLE}[[:space:]]*=" "$ENV_FILE" || true)"
ORPHELINES="$(grep -c -E '^[[:space:]]*sk-ant-' "$ENV_FILE" || true)"

grep -v -E "^[[:space:]]*${VARIABLE}[[:space:]]*=" "$ENV_FILE" \
  | grep -v -E '^[[:space:]]*sk-ant-' > "$TEMPORAIRE" || true

# La clé est écrite par printf, jamais par une substitution : les caractères
# spéciaux éventuels sont donc inertes.
printf '%s=%s\n' "$VARIABLE" "$CLE" >> "$TEMPORAIRE"

cat "$TEMPORAIRE" > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ── Vérification, sans révéler la valeur ──────────────────────────────────
APRES="$(grep -c -E "^${VARIABLE}=" "$ENV_FILE" || true)"
LONGUEUR="$(sed -n "s/^${VARIABLE}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\n' | wc -c)"

echo
vert "Clé enregistrée (${LONGUEUR} caractères)."
echo "  ${VARIABLE} : ${ANCIENNES} ligne(s) remplacée(s) → ${APRES} ligne."
if [ "${ORPHELINES}" -gt 0 ]; then
  jaune "  ${ORPHELINES} ligne(s) orpheline(s) de clé retirée(s) — c'était la cause de la fuite."
fi
unset CLE

echo
echo "Reste à faire :"
echo "  1. docker compose -f docker-compose.prod.yml restart backend"
echo "  2. Tester depuis l'application : Insertion → « Tester la connexion IA »"
echo "     (ou le widget SolidataBot, qui échouera si la clé est mauvaise)."
echo
jaune "Une fois la nouvelle clé validée, supprimez la sauvegarde : elle contient l'ancienne."
echo "  shred -u ${SAUVEGARDE}   # ou : rm ${SAUVEGARDE}"
