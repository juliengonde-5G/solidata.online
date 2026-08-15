"""Client de l'API device (CONTRAT_API_DEVICE v1).

Transporte les pointages vers SOLIDATA et rapatrie le cache des badges, la
configuration et la playlist. Tout est conçu pour que **l'absence de serveur ne
soit jamais un incident** : la file reste, le poste continue de pointer.

Règles de journalisation : ni UID, ni clé d'appareil, ni clé de site ne figurent
dans les logs. Les condensats sont tronqués à 12 caractères (cf. ``hmac_uid.short``).
"""

from __future__ import annotations

import datetime as _dt
import logging
import os
import shutil
import subprocess
import time
from typing import Any, Dict, List, Mapping, NamedTuple, Optional

import httpx

from . import __version__
from .chain import utc_iso_ms
from .config import Config
from .store import MAX_BATCH, Store

LOGGER = logging.getLogger("badgeuse.sync")

#: Backoff exponentiel plafonné à 5 minutes (CONTRAT_API_DEVICE §3).
BACKOFF_START_SEC = 5.0
BACKOFF_MAX_SEC = 300.0

#: Délais courts : un poste ne doit jamais rester bloqué sur le réseau.
TIMEOUT_CONNECT_SEC = 5.0
TIMEOUT_READ_SEC = 15.0

CACHE_KEY_CONFIG = "config"
CACHE_KEY_PLAYLIST = "playlist"
CACHE_KEY_BADGES_ETAG = "badges"
CACHE_KEY_ALERTE = "derniere_alerte"


class Outcome(NamedTuple):
    """Issue d'un échange avec le serveur."""

    ok: bool
    status_code: Optional[int] = None
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

    @property
    def server_time_utc(self) -> Optional[str]:
        if isinstance(self.data, dict):
            value = self.data.get("server_time_utc")
            return str(value) if value else None
        return None


class Syncer:
    """Échanges avec SOLIDATA, avec backoff et gestion des ETag."""

    def __init__(self, config: Config, store: Store) -> None:
        self._config = config
        self._store = store
        self._client: Optional[httpx.AsyncClient] = None
        self._failures = 0
        self._next_attempt = 0.0
        self._online = False
        self._last_alert: Optional[str] = None

    # ------------------------------------------------------------ cycle de vie

    async def __aenter__(self) -> "Syncer":
        verify: Any = self._config.ca_bundle or self._config.verify_tls
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(TIMEOUT_READ_SEC, connect=TIMEOUT_CONNECT_SEC),
            verify=verify,
            headers={
                "X-Device-Key": self._config.device_key,
                "User-Agent": f"badgeuse-agent/{__version__}",
                "Accept": "application/json",
            },
            follow_redirects=False,
        )
        return self

    async def __aexit__(self, *_exc: object) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------ état

    @property
    def online(self) -> bool:
        return self._online

    @property
    def last_alert(self) -> Optional[str]:
        """Dernière anomalie à remonter au heartbeat (lot refusé, etc.)."""
        return self._last_alert

    def ready(self) -> bool:
        """Vrai si le backoff autorise une nouvelle tentative."""
        return time.monotonic() >= self._next_attempt

    def _succeeded(self) -> None:
        self._failures = 0
        self._next_attempt = 0.0
        self._online = True

    def _failed(self) -> None:
        self._failures += 1
        delay = min(BACKOFF_START_SEC * (2 ** (self._failures - 1)), BACKOFF_MAX_SEC)
        self._next_attempt = time.monotonic() + delay
        self._online = False
        LOGGER.info(
            "serveur injoignable (%d echec(s)) — nouvelle tentative dans %.0f s",
            self._failures,
            delay,
        )

    def _raise_alert(self, message: str) -> None:
        self._last_alert = message
        self._store.set_cache(CACHE_KEY_ALERTE, {"message": message, "le": _now_iso()})
        LOGGER.error("anomalie remontee au heartbeat : %s", message)

    def clear_alert(self) -> None:
        self._last_alert = None

    # --------------------------------------------------------------- pointages

    async def push_queue(self) -> int:
        """Dépose la file par lots ordonnés ; retourne le nombre d'accusés.

        La file n'est purgée **que** sur accusé de réception par élément
        (PST-05). Un ``400`` conserve le lot et lève une alerte : c'est un
        défaut de contrat, pas une raison de perdre des heures.
        """
        acquittes = 0
        while True:
            lot = self._store.pending_batch(MAX_BATCH)
            if not lot:
                break

            outcome = await self._post("pointages", {"pointages": lot})

            if not outcome.ok:
                if outcome.status_code == 400:
                    self._raise_alert(
                        f"lot refuse par le serveur (400) — {len(lot)} pointage(s) "
                        "conserves en file"
                    )
                elif outcome.status_code == 401:
                    self._raise_alert(
                        "cle d'appareil refusee (401) — reappairage necessaire"
                    )
                break

            resultats = (outcome.data or {}).get("resultats") or []
            purges = self._store.ack(resultats)
            acquittes += purges

            self._log_resultats(resultats)

            if purges == 0:
                # Aucun accusé exploitable : inutile de boucler sur le même lot.
                self._raise_alert(
                    "reponse serveur sans accuse exploitable — file conservee"
                )
                break

            self.clear_alert()
            if len(lot) < MAX_BATCH:
                break

        return acquittes

    def _log_resultats(self, resultats: List[Mapping[str, Any]]) -> None:
        orphelins = sum(1 for r in resultats if r.get("status") == "orphan")
        ruptures = sum(1 for r in resultats if r.get("avertissement") == "chain_broken")
        if orphelins:
            LOGGER.warning("%d pointage(s) orphelin(s) transmis pour traitement RH",
                           orphelins)
        if ruptures:
            LOGGER.error("%d rupture(s) de chaine signalee(s) par le serveur", ruptures)

    # ------------------------------------------------------------- caches ETag

    async def refresh_badges(self) -> Optional[int]:
        """Rafraîchit le cache des badges (PST-06). ``None`` si inchangé."""
        outcome = await self._get(
            "badges", etag=self._store.get_etag(CACHE_KEY_BADGES_ETAG)
        )
        if not outcome.ok or outcome.status_code == 304:
            return None

        data = outcome.data or {}
        count = self._store.replace_badges(data.get("badges") or [])
        self._store.set_cache(
            CACHE_KEY_BADGES_ETAG, {"count": count}, etag=data.get("etag")
        )
        LOGGER.info("cache badges rafraichi : %d badge(s) actif(s)", count)
        return count

    async def refresh_config(self) -> Optional[Dict[str, Any]]:
        """Rafraîchit la configuration d'affichage et de capture."""
        outcome = await self._get("config", etag=self._store.get_etag(CACHE_KEY_CONFIG))
        if not outcome.ok or outcome.status_code == 304:
            return None

        data = outcome.data or {}
        config = data.get("config") or {}
        self._store.set_cache(CACHE_KEY_CONFIG, config, etag=data.get("etag"))
        LOGGER.info("configuration serveur rafraichie")
        return config

    async def refresh_playlist(self) -> Optional[List[Dict[str, Any]]]:
        """Rafraîchit la playlist de veille (AFF-05/07)."""
        outcome = await self._get(
            "playlist", etag=self._store.get_etag(CACHE_KEY_PLAYLIST)
        )
        if not outcome.ok or outcome.status_code == 304:
            return None

        data = outcome.data or {}
        elements = data.get("elements") or []
        self._store.set_cache(CACHE_KEY_PLAYLIST, elements, etag=data.get("etag"))
        LOGGER.info("playlist rafraichie : %d element(s)", len(elements))
        return elements

    # ------------------------------------------------------------- heartbeat

    async def send_heartbeat(
        self,
        *,
        derive_estimee_sec: Optional[float],
        reader_mode: str = "hex",
    ) -> Outcome:
        """Remonte l'état du poste (PST-07, supervision BO-09)."""
        payload: Dict[str, Any] = {
            "version": __version__,
            "horloge_utc": _now_iso(),
            "derive_estimee_sec": derive_estimee_sec,
            "taille_file": self._store.queue_size(),
            "temperature_cpu": read_cpu_temperature(),
            "disque_libre_mo": read_disk_free_mo(self._config.data_dir),
            "cible": self._config.target,
            "reader_mode": reader_mode,
            "throttled": read_throttled(),
        }
        if self._last_alert:
            # Extension au contrat : l'anomalie remonte avec l'état du poste,
            # jamais en silence.
            payload["alerte"] = self._last_alert

        return await self._post("heartbeat", payload)

    # --------------------------------------------------------------- transport

    async def _post(self, suffix: str, payload: Mapping[str, Any]) -> Outcome:
        return await self._request("POST", suffix, json=payload)

    async def _get(self, suffix: str, etag: Optional[str] = None) -> Outcome:
        headers = {"If-None-Match": etag} if etag else None
        return await self._request("GET", suffix, headers=headers)

    async def _request(
        self,
        method: str,
        suffix: str,
        *,
        json: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> Outcome:
        if self._client is None:
            return Outcome(ok=False, error="client non initialise")

        url = self._config.device_url(suffix)
        try:
            response = await self._client.request(
                method, url, json=json, headers=headers
            )
        except httpx.TimeoutException:
            self._failed()
            return Outcome(ok=False, error="delai depasse")
        except httpx.HTTPError as exc:
            self._failed()
            return Outcome(ok=False, error=type(exc).__name__)

        if response.status_code == 304:
            self._succeeded()
            return Outcome(ok=True, status_code=304, data={})

        if response.status_code == 401:
            self._online = True  # le serveur répond : le réseau n'est pas en cause
            LOGGER.error("authentification du poste refusee (401)")
            return Outcome(ok=False, status_code=401)

        if response.status_code == 400:
            LOGGER.error("charge utile refusee par le serveur (400)")
            self._succeeded()
            return Outcome(ok=False, status_code=400, data=_safe_json(response))

        if response.status_code == 429 or response.status_code >= 500:
            self._failed()
            return Outcome(ok=False, status_code=response.status_code)

        if response.status_code >= 300:
            self._failed()
            return Outcome(ok=False, status_code=response.status_code)

        self._succeeded()
        return Outcome(ok=True, status_code=response.status_code,
                       data=_safe_json(response))


# ------------------------------------------------------------------ télémétrie


def read_cpu_temperature() -> Optional[float]:
    """Température du processeur, en °C (``None`` si indisponible)."""
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r", encoding="ascii") as fh:
            return round(int(fh.read().strip()) / 1000.0, 1)
    except (OSError, ValueError):
        return None


def read_disk_free_mo(path: str) -> Optional[int]:
    """Espace libre du volume de données, en Mo."""
    try:
        target = path if os.path.exists(path) else "/"
        return int(shutil.disk_usage(target).free / (1024 * 1024))
    except OSError:
        return None


def read_throttled() -> Optional[bool]:
    """Sous-alimentation ou bridage thermique signalé par le firmware.

    ``vcgencmd get_throttled`` renvoie un masque : toute valeur non nulle
    signale un incident présent ou passé (alimentation insuffisante, en
    particulier — cause n°1 des postes instables).
    """
    try:
        completed = subprocess.run(
            ["vcgencmd", "get_throttled"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None

    sortie = (completed.stdout or "").strip()
    if "=" not in sortie:
        return None
    try:
        return int(sortie.split("=", 1)[1], 0) != 0
    except ValueError:
        return None


def _safe_json(response: "httpx.Response") -> Dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _now_iso() -> str:
    return utc_iso_ms(_dt.datetime.now(_dt.timezone.utc))
