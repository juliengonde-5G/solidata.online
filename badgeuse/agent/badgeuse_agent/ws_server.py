"""Canal local agent → interface kiosque.

Deux écoutes, **toutes deux sur la boucle locale exclusivement** (aucune écoute
réseau entrante, SPEC §7.1) :

- WebSocket ``127.0.0.1:8765`` : pousse les événements de badge, la playlist et
  l'état du poste vers l'interface ;
- HTTP ``127.0.0.1:8766`` : sert les fichiers statiques de ``ui/`` à Chromium,
  **et** les médias du cache local sous ``/media/`` (CDC_AFFICHAGE_V2 §2) —
  c'est ce qui permet à la CSP du kiosque de rester ``'self'`` alors que
  l'écran de veille affiche des images et des vidéos.

Aucune donnée personnelle au-delà du strict nécessaire à l'affichage (prénom et
initiale, exigence A5) ne transite par ce canal.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import threading
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Mapping, Optional, Set

import websockets

from .media_cache import (
    SOUS_REPERTOIRE as MEDIA_SOUS_REPERTOIRE,
    MediaCache,
    deviner_mime,
)

# Plafond juridique de l'overlay : défini dans le module PUR ``moments`` (donc
# testable sans websockets) et ré-exporté ici pour les appelants historiques.
from .moments import (  # noqa: F401  (ré-export volontaire)
    OVERLAY_MAX_SEC,
    OVERLAY_MIN_SEC,
    clamp_overlay,
    construire_badge_ok,
)

LOGGER = logging.getLogger("badgeuse.ws")

LOOPBACK = "127.0.0.1"

#: Préfixe d'URL des médias servis depuis le cache local.
PREFIXE_MEDIA = f"/{MEDIA_SOUS_REPERTOIRE}/"

_MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}


class UiChannel:
    """Diffuse les messages à l'interface et sert ses fichiers statiques."""

    def __init__(
        self,
        ws_port: int = 8765,
        http_port: int = 8766,
        ui_dir: Optional[str] = None,
    ) -> None:
        self._ws_port = ws_port
        self._http_port = http_port
        self._ui_dir = ui_dir or _default_ui_dir()
        self._clients: Set[Any] = set()
        self._server: Optional[Any] = None
        self._http: Optional[ThreadingHTTPServer] = None
        self._http_thread: Optional[threading.Thread] = None

        #: Cache média servi sous ``/media/``. Renseigné après coup (le cache
        #: appartient au ``Syncer``, créé plus tard) : tant qu'il est absent,
        #: ``/media/...`` répond 404 et l'interface dégrade sur le texte.
        self.media_cache: Optional[MediaCache] = None

        #: Dernier état connu, rejoué à chaque nouvelle connexion de l'UI.
        self._snapshot: Dict[str, Dict[str, Any]] = {}

    # ------------------------------------------------------------- démarrage

    async def start(self) -> None:
        self._server = await websockets.serve(
            self._handler, LOOPBACK, self._ws_port, ping_interval=20, ping_timeout=20
        )
        LOGGER.info("websocket UI en ecoute sur ws://%s:%d", LOOPBACK, self._ws_port)
        self._start_http()

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        if self._http is not None:
            self._http.shutdown()
            self._http.server_close()
            self._http = None

    def _start_http(self) -> None:
        if not os.path.isdir(self._ui_dir):
            LOGGER.error("repertoire d'interface introuvable : %s", self._ui_dir)
            return

        handler = partial(_StaticHandler, directory=self._ui_dir, canal=self)
        self._http = ThreadingHTTPServer((LOOPBACK, self._http_port), handler)
        self._http.daemon_threads = True
        self._http_thread = threading.Thread(
            target=self._http.serve_forever, name="badgeuse-ui-http", daemon=True
        )
        self._http_thread.start()
        LOGGER.info(
            "interface servie sur http://%s:%d (%s)",
            LOOPBACK,
            self._http_port,
            self._ui_dir,
        )

    # ------------------------------------------------------------- connexions

    async def _handler(self, websocket: Any, *_args: Any) -> None:
        self._clients.add(websocket)
        LOGGER.info("interface connectee (%d client(s))", len(self._clients))
        try:
            for message in self._snapshot.values():
                await websocket.send(json.dumps(message, ensure_ascii=False))
            async for _ in websocket:
                # L'interface n'émet rien : aucune saisie utilisateur (PST-10).
                pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self._clients.discard(websocket)

    # -------------------------------------------------------------- diffusion

    async def broadcast(self, message: Dict[str, Any], *, remember: bool = False) -> None:
        """Envoie un message à toutes les interfaces connectées."""
        if remember:
            self._snapshot[message["type"]] = message

        if not self._clients:
            return

        payload = json.dumps(message, ensure_ascii=False)
        await asyncio.gather(
            *(self._send(client, payload) for client in list(self._clients)),
            return_exceptions=True,
        )

    async def _send(self, client: Any, payload: str) -> None:
        try:
            await client.send(payload)
        except (websockets.exceptions.ConnectionClosed, RuntimeError):
            self._clients.discard(client)

    # ----------------------------------------------------- messages métier

    async def badge_ok(
        self,
        *,
        badge: Optional[Mapping[str, Any]],
        sens: str,
        heure_locale: str,
        affichage: Optional[Mapping[str, Any]] = None,
        phrase_motivation: Optional[str] = None,
        overlay_duree_sec: int = 5,
        cumul_hebdo: Optional[str] = None,
    ) -> None:
        """Pointage accepté (AFF-01, CDC_AFFICHAGE_V2 §1).

        La charge utile est assemblée par :func:`moments.construire_badge_ok`,
        fonction PURE : message du moment, phrase de motivation et écran festif
        se décident donc dans un module testable sans réseau ni matériel — et
        la conformité de ce qui s'affiche (prénom + initiale seulement, un seul
        festif, overlay plafonné) s'y vérifie par un test.

        ``cumul_hebdo`` reste ``None`` tant que le paramètre serveur
        ``affichage_cumul_hebdo`` n'est pas activé (AFF-02, désactivé par défaut).
        """
        await self.broadcast(
            construire_badge_ok(
                badge=badge,
                sens=sens,
                heure_locale=heure_locale,
                affichage=affichage,
                phrase_motivation=phrase_motivation,
                overlay_duree_sec=overlay_duree_sec,
                cumul_hebdo=cumul_hebdo,
            )
        )

    async def badge_err(self, raison: str, *, overlay_duree_sec: int = 5) -> None:
        """Lecture refusée : badge inconnu ou illisible (PST-04)."""
        await self.broadcast(
            {
                "type": "badge_err",
                "raison": raison,
                "overlay_duree_sec": clamp_overlay(overlay_duree_sec),
            }
        )

    async def badge_repeat(
        self, *, prenom: Optional[str] = None, overlay_duree_sec: int = 5
    ) -> None:
        """Anti-rebond : « déjà enregistré », ni succès ni erreur (PST-02)."""
        await self.broadcast(
            {
                "type": "badge_repeat",
                "prenom": prenom,
                "overlay_duree_sec": clamp_overlay(overlay_duree_sec),
            }
        )

    async def playlist(self, elements: Any) -> None:
        """Contenus de veille (AFF-05) ; rejoués hors ligne (AFF-07)."""
        await self.broadcast(
            {"type": "playlist", "elements": elements or []}, remember=True
        )

    async def status(
        self, *, online: bool, file: int, heure: str, lecteur: bool = True
    ) -> None:
        """État du poste : bandeau hors ligne (PST-08) et horloge de veille."""
        await self.broadcast(
            {
                "type": "status",
                "online": online,
                "file": file,
                "heure": heure,
                "lecteur": lecteur,
            },
            remember=True,
        )


class _StaticHandler(SimpleHTTPRequestHandler):
    """Serveur de fichiers minimal, sans listage ni journalisation bruyante.

    Deux racines, strictement séparées : l'interface (``ui/``, servie par la
    classe mère) et le cache média (``/media/``, servi ci-dessous depuis
    ``/var/lib/badgeuse/media/``). Le cache n'est jamais atteignable par un
    chemin relatif depuis l'interface, et réciproquement.
    """

    def __init__(self, *args: Any, canal: Optional[UiChannel] = None, **kwargs: Any) -> None:
        self._canal = canal
        # Valeur par défaut de l'en-tête de cache, surchargée pour les médias
        # (dont le nom est adressé par contenu, donc immuable).
        self._cache_control = "no-store"
        super().__init__(*args, **kwargs)

    # ------------------------------------------------------------- routage

    def do_GET(self) -> None:  # noqa: N802 - imposé par http.server
        self._router(corps=True)

    def do_HEAD(self) -> None:  # noqa: N802 - imposé par http.server
        self._router(corps=False)

    def _router(self, *, corps: bool) -> None:
        chemin_url = urllib.parse.urlsplit(self.path).path
        if chemin_url.startswith(PREFIXE_MEDIA):
            self._servir_media(chemin_url[len(PREFIXE_MEDIA) :], corps=corps)
            return
        if corps:
            super().do_GET()
        else:
            super().do_HEAD()

    # -------------------------------------------------------------- médias

    def _servir_media(self, nom_encode: str, *, corps: bool) -> None:
        """Sert un média du cache local. 404 dans tous les cas douteux.

        Résolution **stricte** : le nom est décodé puis confié à
        :meth:`MediaCache.chemin`, qui n'accepte que la forme canonique
        ``<id>-<empreinte>`` et vérifie le confinement du chemin réel. Aucune
        traversée (``..``, chemin absolu, lien symbolique sortant) n'aboutit.
        """
        cache = getattr(self._canal, "media_cache", None)
        if cache is None:
            self.send_error(404)
            return

        nom = urllib.parse.unquote(nom_encode)
        chemin = cache.chemin(nom)
        if not chemin or not os.path.isfile(chemin):
            self.send_error(404)
            return

        # Type déduit des octets réels : l'interface est servie en ``nosniff``,
        # un type approximatif empêcherait le rendu.
        mime = deviner_mime(cache.lire_entete(nom))
        if mime is None:
            # Contenu non reconnu : on ne le sert pas (liste blanche stricte).
            self.send_error(415)
            return

        try:
            taille = os.path.getsize(chemin)
            fichier = open(chemin, "rb") if corps else None
        except OSError:
            self.send_error(404)
            return

        # Nom adressé par contenu (identifiant + empreinte) : un média modifié
        # change de nom, celui-ci peut donc être mis en cache sans risque —
        # cela évite de relire le disque à chaque boucle d'une vidéo.
        self._cache_control = "public, max-age=86400, immutable"
        try:
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(taille))
            self.end_headers()
            if fichier is not None:
                shutil.copyfileobj(fichier, self.wfile)
        except (BrokenPipeError, ConnectionResetError):
            # Chromium a fermé la connexion (changement de diapositive) : ce
            # n'est pas une anomalie du poste.
            pass
        finally:
            if fichier is not None:
                fichier.close()

    # --------------------------------------------------------------- socle

    def list_directory(self, path: str):  # type: ignore[override]
        self.send_error(404)
        return None

    def guess_type(self, path: str) -> str:  # type: ignore[override]
        _, ext = os.path.splitext(path)
        return _MIME.get(ext.lower(), "application/octet-stream")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", self._cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        LOGGER.debug("ui-http " + format, *args)


def _default_ui_dir() -> str:
    """``badgeuse/ui`` en développement, ``/opt/badgeuse/ui`` une fois installé."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidat = os.path.normpath(os.path.join(here, "..", "..", "ui"))
    if os.path.isdir(candidat):
        return candidat
    return "/opt/badgeuse/ui"
