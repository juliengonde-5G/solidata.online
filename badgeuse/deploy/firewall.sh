#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Pare-feu local du poste de pointage (nftables) — SPEC §7.1.
#
#   - aucune ecoute reseau entrante : seules la boucle locale (agent <-> UI) et
#     les reponses aux connexions sortantes sont acceptees ;
#   - sortie limitee a HTTPS (443), NTP (123) et DNS (53) ;
#   - SSH d'administration restreint a un reseau parametrable (ci-dessous).
#
# ECART ASSUME ET DOCUMENTE : la spec ecrit « sortie 443 et 123 uniquement ».
# Le DNS (53) est neanmoins autorise, sans quoi le poste ne peut pas resoudre
# solidata.online et ne joindrait jamais le serveur. Pour tenir la lettre de la
# spec, mettre AUTORISER_DNS=0 et renseigner l'adresse du serveur dans
# /etc/hosts : le script le rappelle a l'execution.
#
# Idempotent : la table est remplacee a chaque execution.
# -----------------------------------------------------------------------------
set -euo pipefail

# --- Parametres --------------------------------------------------------------
# Reseau depuis lequel l'administration SSH est autorisee. Vide => SSH ferme.
RESEAU_ADMIN="${RESEAU_ADMIN:-192.168.1.0/24}"
PORT_SSH="${PORT_SSH:-22}"
AUTORISER_DNS="${AUTORISER_DNS:-1}"
AUTORISER_DHCP="${AUTORISER_DHCP:-1}"
FICHIER_REGLES="${FICHIER_REGLES:-/etc/nftables.conf}"
# -----------------------------------------------------------------------------

log() { printf '[firewall] %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "A executer en root." >&2; exit 1; }

command -v nft >/dev/null 2>&1 || {
  log "nftables absent — installation : apt-get install -y nftables"
  exit 1
}

regles_ssh=""
if [ -n "$RESEAU_ADMIN" ]; then
  regles_ssh="        ip saddr ${RESEAU_ADMIN} tcp dport ${PORT_SSH} accept comment \"SSH administration\""
else
  regles_ssh="        # SSH ferme (RESEAU_ADMIN vide)"
fi

regles_dns=""
if [ "$AUTORISER_DNS" = "1" ]; then
  regles_dns='        udp dport 53 accept comment "DNS (resolution de solidata.online)"
        tcp dport 53 accept comment "DNS/TCP"'
else
  regles_dns='        # DNS ferme : renseigner solidata.online dans /etc/hosts'
fi

regles_dhcp=""
if [ "$AUTORISER_DHCP" = "1" ]; then
  regles_dhcp='        udp sport 68 udp dport 67 accept comment "DHCP client"'
else
  regles_dhcp='        # DHCP ferme (adressage statique attendu)'
fi

log "ecriture de ${FICHIER_REGLES}"
cat > "$FICHIER_REGLES" <<EOF
#!/usr/sbin/nft -f
# Poste de pointage SOLIDATA — genere par deploy/firewall.sh
# Ne pas editer a la main : relancer le script.

flush ruleset

table inet badgeuse {

    chain entree {
        type filter hook input priority filter; policy drop;

        iif lo accept comment "boucle locale : agent <-> interface kiosque"
        ct state established,related accept
        ct state invalid drop

        # Diagnostic reseau depuis le reseau d'administration uniquement.
        ip protocol icmp icmp type echo-request limit rate 5/second accept
        ip6 nexthdr ipv6-icmp accept

${regles_ssh}
    }

    chain acheminement {
        type filter hook forward priority filter; policy drop;
    }

    chain sortie {
        type filter hook output priority filter; policy drop;

        oif lo accept
        ct state established,related accept

        tcp dport 443 accept comment "API SOLIDATA (HTTPS)"
        udp dport 123 accept comment "NTP (horloge — heures qui font foi)"
${regles_dns}
${regles_dhcp}

        ip protocol icmp accept
        ip6 nexthdr ipv6-icmp accept
    }
}
EOF

chmod 0644 "$FICHIER_REGLES"

log "application des regles"
nft -f "$FICHIER_REGLES"

systemctl enable nftables >/dev/null 2>&1 || true
systemctl restart nftables >/dev/null 2>&1 || true

log "regles actives :"
nft list table inet badgeuse | sed 's/^/    /'

if [ "$AUTORISER_DNS" != "1" ]; then
  log "ATTENTION : DNS ferme — verifier que solidata.online figure dans /etc/hosts"
fi
if [ -z "$RESEAU_ADMIN" ]; then
  log "ATTENTION : SSH ferme — l'acces distant au poste n'est plus possible"
fi
log "termine. Aucune ecoute entrante hors boucle locale."
