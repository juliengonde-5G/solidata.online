# ============================================================================
# GARDE DE MAINTENANCE — à inclure en TÊTE de chaque location qui sert
# l'application (jamais dans /.well-known/acme-challenge/, sans quoi le
# renouvellement du certificat échouerait pendant une maintenance).
#
# Le fichier témoin est écrit sur l'hôte par deploy/scripts/maintenance.sh et
# lu ici à CHAQUE requête (open_file_cache est désactivé par défaut) : poser et
# lever la maintenance est immédiat, sans rechargement de nginx.
#
# Ce fichier porte l'extension .inc À DESSEIN : nginx.conf inclut
# « conf.d/*.conf », donc un .inc n'est jamais chargé comme bloc serveur — il
# n'existe que là où on l'inclut explicitement.
#
# EXCEPTION DE CONTRÔLE. Le health check et le smoke test du déploiement
# passent par nginx à dessein, pour couvrir aussi la configuration du proxy.
# Sans exception, ils se heurteraient à leur propre page de maintenance et
# feraient échouer un déploiement parfaitement sain. Ils posent donc l'en-tête
# X-Solidata-Bypass-Maintenance. Ce n'est pas un secret : au pire, quelqu'un
# qui le devine voit l'application pendant sa mise à jour — aucune donnée n'est
# exposée, aucun contrôle d'accès n'est contourné.
#
# nginx n'a pas de « et » dans ses `if` : on compose donc l'état dans une
# variable. C'est le motif documenté pour ce cas, et il reste sûr ici parce que
# seuls `set` et `return` sont employés (les mises en garde sur `if` visent les
# autres directives).
#
# Le 503 émis ici est intercepté par « error_page 503 @maintenance… ».
# Un 503 venant du backend, lui, N'EST PAS intercepté (proxy_intercept_errors
# est off par défaut) : une vraie panne applicative continue de se dire
# elle-même, au lieu d'être maquillée en maintenance planifiée.
# ============================================================================
set $solidata_maintenance "";
if (-f /etc/nginx/maintenance/ACTIF)        { set $solidata_maintenance "active"; }
if ($http_x_solidata_bypass_maintenance)    { set $solidata_maintenance "${solidata_maintenance}+controle"; }
if ($solidata_maintenance = "active")       { return 503; }
