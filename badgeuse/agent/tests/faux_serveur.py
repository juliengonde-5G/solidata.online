"""Faux serveur de l'API device (CONTRAT_API_DEVICE v1.4), stdlib seule.

Sert aux tests « de la promesse » : l'agent réel parle à ce serveur comme il
parlerait à SOLIDATA, sans mock de ``httpx`` — c'est la seule façon de prouver
que la file part, qu'un ``retry`` ne purge rien et qu'un 500 ne perd rien.

Aucune dépendance : ``http.server`` suffit. Le serveur écoute sur un port
éphémère de la boucle locale et se ferme avec le test.
"""

from __future__ import annotations

import datetime as _dt
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional


def _maintenant_iso() -> str:
    moment = _dt.datetime.now(_dt.timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


class FauxServeur:
    """API device minimale, pilotable depuis un test.

    - ``politique`` décide du statut rendu pour chaque pointage déposé ;
    - ``statut_http`` force un code HTTP par suffixe d'endpoint
      (``{"pointages": 500}``) pour éprouver les chemins d'échec ;
    - tout ce qui est reçu est conservé (``lots``, ``heartbeats``) pour être
      vérifié par le test.
    """

    def __init__(self, device_code: str = "LH-P1", device_key: str = "k" * 64) -> None:
        self.device_code = device_code
        self.device_key = device_key
        self.lots: List[List[Dict[str, Any]]] = []
        self.heartbeats: List[Dict[str, Any]] = []
        self.badges: List[Dict[str, Any]] = []
        self.config: Dict[str, Any] = {}
        self.playlist: List[Dict[str, Any]] = []
        #: Médias servis par ``GET /devices/:code/media/:id`` (id -> octets).
        self.medias: Dict[str, bytes] = {}
        self.politique: Callable[[Dict[str, Any]], Dict[str, Any]] = lambda p: {
            "uuid": p["uuid"],
            "status": "ok",
        }
        self.statut_http: Dict[str, int] = {}
        self.cles_vues: List[Optional[str]] = []
        self._srv: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    # --------------------------------------------------------- cycle de vie

    def demarrer(self) -> str:
        serveur = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_a: Any) -> None:  # silence
                pass

            def _json(self, code: int, corps: Dict[str, Any]) -> None:
                donnees = json.dumps(corps).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(donnees)))
                self.end_headers()
                self.wfile.write(donnees)

            def _suffixe(self) -> str:
                return self.path.rstrip("/").rsplit("/", 1)[-1]

            def _autorise(self) -> bool:
                cle = self.headers.get("X-Device-Key")
                serveur.cles_vues.append(cle)
                if cle != serveur.device_key:
                    self._json(401, {"error": "unauthorized"})
                    return False
                return True

            def do_POST(self) -> None:  # noqa: N802
                if not self._autorise():
                    return
                taille = int(self.headers.get("Content-Length") or 0)
                corps = json.loads(self.rfile.read(taille) or b"{}")
                suffixe = self._suffixe()
                force = serveur.statut_http.get(suffixe)
                if force:
                    self._json(force, {"error": "force"})
                    return
                if suffixe == "pointages":
                    lot = corps.get("pointages") or []
                    serveur.lots.append(lot)
                    self._json(
                        200,
                        {
                            "resultats": [serveur.politique(p) for p in lot],
                            "server_time_utc": _maintenant_iso(),
                        },
                    )
                    return
                if suffixe == "heartbeat":
                    serveur.heartbeats.append(corps)
                    self._json(200, {"status": "ok", "server_time_utc": _maintenant_iso()})
                    return
                self._json(404, {"error": "not_found"})

            def do_GET(self) -> None:  # noqa: N802
                if not self._autorise():
                    return
                suffixe = self._suffixe()
                force = serveur.statut_http.get(suffixe)
                if force:
                    self._json(force, {"error": "force"})
                    return
                if suffixe == "badges":
                    self._json(200, {"etag": "b1", "badges": serveur.badges})
                    return
                if suffixe == "config":
                    self._json(200, {"etag": "c1", "config": serveur.config})
                    return
                if suffixe == "playlist":
                    self._json(200, {"etag": "p1", "elements": serveur.playlist})
                    return
                if "/media/" in self.path:
                    contenu = serveur.medias.get(suffixe)
                    if contenu is None:
                        self._json(404, {"error": "not_found"})
                        return
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(len(contenu)))
                    self.end_headers()
                    self.wfile.write(contenu)
                    return
                self._json(404, {"error": "not_found"})

        self._srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._srv.daemon_threads = True
        self._thread = threading.Thread(target=self._srv.serve_forever, daemon=True)
        self._thread.start()
        return self.url

    def arreter(self) -> None:
        if self._srv is not None:
            self._srv.shutdown()
            self._srv.server_close()
            self._srv = None

    @property
    def url(self) -> str:
        assert self._srv is not None
        return "http://127.0.0.1:%d" % self._srv.server_address[1]

    # ---------------------------------------------------------------- aides

    def uuids_recus(self) -> List[str]:
        return [p["uuid"] for lot in self.lots for p in lot]

    def sequences_recues(self) -> List[int]:
        return [int(p["sequence_device"]) for lot in self.lots for p in lot]
