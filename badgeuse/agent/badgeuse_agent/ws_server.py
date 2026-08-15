"""Canal local agent → interface kiosque.

Deux écoutes, **toutes deux sur la boucle locale exclusivement** (aucune écoute
réseau entrante, SPEC §7.1) :

- WebSocket ``127.0.0.1:8765`` : pousse les événements de badge, la playlist et
  l'état du poste vers l'interface ;
- HTTP ``127.0.0.1:8766`` : sert les fichiers statiques de ``ui/`` à Chromium.

Aucune donnée personnelle au-delà du strict nécessaire à l'affichage (prénom et
initiale, exigence A5) ne transite par ce canal.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Set

import websockets

LOGGER = logging.getLogger("badgeuse.ws")

LOOPBACK = "127.0.0.1"

#: Plafond juridique de l'overlay, en secondes (AFF-01). Re-vérifié côté UI.
OVERLAY_MIN_SEC = 3
OVERLAY_MAX_SEC = 8

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


def clamp_overlay(duree: Any, defaut: int = 5) -> int:
    """Borne la durée d'overlay entre 3 et 8 secondes.

    Le serveur borne déjà cette valeur ; le poste la re-borne — double plafond
    exigé par la note juridique §3.5. L'UI applique un troisième plafond.
    """
    try:
        valeur = int(round(float(duree)))
    except (TypeError, ValueError):
        return defaut
    return max(OVERLAY_MIN_SEC, min(OVERLAY_MAX_SEC, valeur))


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

        handler = partial(_StaticHandler, directory=self._ui_dir)
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
        prenom: str,
        initiale: str,
        sens: str,
        heure_locale: str,
        overlay_duree_sec: int = 5,
        cumul_hebdo: Optional[str] = None,
    ) -> None:
        """Pointage accepté (AFF-01).

        ``cumul_hebdo`` reste ``None`` tant que le paramètre serveur
        ``affichage_cumul_hebdo`` n'est pas activé (AFF-02, désactivé par défaut).
        """
        await self.broadcast(
            {
                "type": "badge_ok",
                "prenom": prenom,
                "initiale": initiale,
                "sens": sens,
                "heure_locale": heure_locale,
                "cumul_hebdo": cumul_hebdo,
                "overlay_duree_sec": clamp_overlay(overlay_duree_sec),
            }
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
    """Serveur de fichiers minimal, sans listage ni journalisation bruyante."""

    def list_directory(self, path: str):  # type: ignore[override]
        self.send_error(404)
        return None

    def guess_type(self, path: str) -> str:  # type: ignore[override]
        _, ext = os.path.splitext(path)
        return _MIME.get(ext.lower(), "application/octet-stream")

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
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
