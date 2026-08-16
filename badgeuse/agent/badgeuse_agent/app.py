"""Orchestration de l'agent : boucle principale et tâches périodiques.

Chaîne de traitement d'un badge :

    reader → normalize → hmac → debounce → cache badges → sens → store → UI

Le poste fonctionne **hors ligne indéfiniment** (PST-08) : la capture,
l'affichage et la mise en file ne dépendent ni du réseau ni du serveur. La
synchronisation est une tâche de fond opportuniste.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import logging
import os
import signal
import socket
from typing import Any, Dict, Optional

from . import __version__
from .clock import DriftMonitor
from .config import Config
from .debounce import DEFAULT_WINDOW_SEC, Debouncer
from .hmac_uid import hmac_uid, short
from .moments import bloc_affichage, clamp_overlay
from .motivation import phrase_du_jour
from .normalize import normalize_uid
from .reader import BadgeReader
from .sens import ENTREE, INCONNU, PARIS, determine_sens
from .store import Store
from .sync import CACHE_KEY_CONFIG, Syncer
from .ws_server import UiChannel

LOGGER = logging.getLogger("badgeuse.app")

DEFAULT_HEARTBEAT_SEC = 60
DEFAULT_BADGES_SEC = 300
DEFAULT_PLAYLIST_SEC = 900
QUEUE_TICK_SEC = 5
STATUS_TICK_SEC = 10
PURGE_TICK_SEC = 6 * 3600

#: Fréquence des pings watchdog (unité systemd : ``WatchdogSec=90``).
WATCHDOG_TICK_SEC = 30

RAISON_ILLISIBLE = "badge_illisible"
RAISON_INCONNU = "badge_inconnu"


class Agent:
    """Assemble les composants et fait tourner les boucles."""

    def __init__(self, config: Config) -> None:
        self._config = config
        self._store = Store(config.data_dir, config.device_code)
        self._ui = UiChannel(
            ws_port=config.ws_port, http_port=config.http_port, ui_dir=config.ui_dir
        )
        self._debouncer = Debouncer(window_sec=DEFAULT_WINDOW_SEC)
        self._drift = DriftMonitor()
        self._reader = BadgeReader(
            on_uid=self._on_uid,
            vendor_id=config.vendor_id,
            product_id=config.product_id,
            name_hint=config.reader_name,
            on_state=self._on_reader_state,
        )
        self._syncer: Optional[Syncer] = None
        self._stopping = asyncio.Event()
        self._reader_mode = "hex"
        self._reader_connected = False
        self._lock = asyncio.Lock()

        self._server_config: Dict[str, Any] = self._store.get_cache(
            CACHE_KEY_CONFIG, default={}
        ) or {}
        self._apply_server_config(self._server_config)

    # --------------------------------------------------------- configuration

    def _apply_server_config(self, config: Dict[str, Any]) -> None:
        """Applique les paramètres serveur (ADR-0002 : rien n'est codé en dur)."""
        if not config:
            return
        self._debouncer.set_window(
            _positive(config.get("anti_rebond_sec"), DEFAULT_WINDOW_SEC)
        )

    @property
    def _overlay_sec(self) -> int:
        return clamp_overlay(self._server_config.get("overlay_duree_sec"), 5)

    @property
    def _cumul_active(self) -> bool:
        """AFF-02 : désactivé par défaut, activé seulement par le serveur."""
        return bool(self._server_config.get("affichage_cumul_hebdo", False))

    @property
    def _affichage(self) -> Dict[str, Any]:
        """Bloc ``affichage`` de la config serveur (CONTRAT_API_DEVICE §3bis).

        Absent tant que le serveur est en v1.2 : l'écran retombe alors sur les
        gabarits par défaut, sans festif ni phrase (rétro-compatible).
        """
        return dict(bloc_affichage(self._server_config))

    def _phrase_motivation(self, maintenant: _dt.datetime) -> str:
        """Phrase du vivier générique pour le jour civil en cours.

        Vivier commun à tous, rotation quotidienne déterministe — jamais un
        message dérivé d'un profil individuel (ADR-0004 §2). Le jour est celui
        du calendrier **local** : la phrase change à minuit heure de Paris,
        pas à minuit UTC.
        """
        affichage = self._affichage
        return phrase_du_jour(
            affichage.get("phrases_motivation"),
            maintenant.astimezone(PARIS).date(),
            active=bool(affichage.get("motivation_active", False)),
        )

    # ------------------------------------------------------------- capture

    async def _on_uid(self, raw: str) -> None:
        """Traite une lecture. ``raw`` est l'UID brut : jamais journalisé."""
        async with self._lock:
            try:
                await self._process(raw)
            except Exception:  # noqa: BLE001 - une lecture ratée ne tue pas l'agent
                LOGGER.exception("echec de traitement d'une lecture de badge")
                await self._ui.badge_err(
                    RAISON_ILLISIBLE, overlay_duree_sec=self._overlay_sec
                )

    async def _process(self, raw: str) -> None:
        normalise = normalize_uid(raw)
        if normalise is None:
            # Lecture non conforme au contrat : pas d'enregistrement (CONTRAT_HMAC §2.4).
            LOGGER.warning("lecture de badge non conforme — aucun enregistrement")
            await self._ui.badge_err(
                RAISON_ILLISIBLE, overlay_duree_sec=self._overlay_sec
            )
            return

        self._reader_mode = normalise.reader_mode
        condensat = hmac_uid(self._config.hmac_key, normalise.uid)
        del normalise  # l'UID brut ne survit pas au calcul

        if not self._debouncer.accept(condensat):
            badge = self._store.find_badge(condensat)
            LOGGER.info("anti-rebond : badge %s ignore", short(condensat))
            await self._ui.badge_repeat(
                prenom=(badge or {}).get("prenom"),
                overlay_duree_sec=self._overlay_sec,
            )
            return

        maintenant = _dt.datetime.now(_dt.timezone.utc)
        badge = self._store.find_badge(condensat)

        if badge is None:
            # PST-04 : jamais de rejet silencieux — le pointage part en orphelin.
            self._store.enqueue_pointage(
                uid_hmac=condensat,
                horodatage_utc=maintenant,
                sens=INCONNU,
                source="badge",
                salarie_id=None,
            )
            LOGGER.warning(
                "badge inconnu du cache (%s) — pointage orphelin mis en file",
                short(condensat),
            )
            await self._ui.badge_err(
                RAISON_INCONNU, overlay_duree_sec=self._overlay_sec
            )
            await self._notify_status()
            return

        evenements = self._store.events_for_salarie(
            badge["salarie_id"], reference_utc=maintenant
        )
        sens = determine_sens(evenements, maintenant)

        self._store.enqueue_pointage(
            uid_hmac=condensat,
            horodatage_utc=maintenant,
            sens=sens,
            source="badge",
            salarie_id=badge["salarie_id"],
        )
        LOGGER.info(
            "pointage %s enregistre (badge %s, file %d)",
            sens,
            short(condensat),
            self._store.queue_size(),
        )

        # Le moment de la journée, le message et l'écran festif se décident
        # dans ``moments.construire_badge_ok`` (module PUR) à partir du badge
        # en cache et du bloc ``affichage`` du serveur : aucune règle
        # d'affichage n'est codée en dur ici (ADR-0002).
        await self._ui.badge_ok(
            badge=badge,
            sens=sens,
            heure_locale=maintenant.astimezone(PARIS).strftime("%H:%M:%S"),
            affichage=self._affichage,
            phrase_motivation=self._phrase_motivation(maintenant),
            overlay_duree_sec=self._overlay_sec,
            cumul_hebdo=self._cumul_hebdo(badge["salarie_id"], maintenant),
        )
        await self._notify_status()

    def _cumul_hebdo(self, salarie_id: int, maintenant: _dt.datetime) -> Optional[str]:
        """Cumul hebdomadaire local, **uniquement si le serveur l'autorise**.

        Calculé sur les seules paires entrée/sortie complètes de la semaine
        civile en cours (heure de Paris). C'est un affichage de courtoisie : le
        décompte qui fait foi est celui de SOLIDATA.
        """
        if not self._cumul_active:
            return None

        local = maintenant.astimezone(PARIS)
        debut_local = (local - _dt.timedelta(days=local.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        evenements = self._store.events_between(
            salarie_id, debut_local.astimezone(_dt.timezone.utc), maintenant
        )

        total = _dt.timedelta()
        ouverture: Optional[_dt.datetime] = None
        for evenement in evenements:
            if evenement.sens == ENTREE:
                ouverture = evenement.horodatage_utc
            elif ouverture is not None:
                total += evenement.horodatage_utc - ouverture
                ouverture = None

        minutes = int(total.total_seconds() // 60)
        return f"{minutes // 60} h {minutes % 60:02d}"

    async def _on_reader_state(self, connected: bool) -> None:
        self._reader_connected = connected
        await self._notify_status()

    # ---------------------------------------------------------- tâches de fond

    async def _loop_queue(self) -> None:
        """Transmet la file dès qu'elle n'est pas vide, sous réserve du backoff."""
        while not self._stopping.is_set():
            try:
                if (
                    self._syncer is not None
                    and self._store.queue_size() > 0
                    and self._syncer.ready()
                ):
                    accuses = await self._syncer.push_queue()
                    if accuses:
                        LOGGER.info("%d pointage(s) accuse(s) par le serveur", accuses)
                    await self._notify_status()
            except Exception:  # noqa: BLE001
                LOGGER.exception("echec d'envoi de la file")
            await self._sleep(QUEUE_TICK_SEC)

    async def _loop_badges(self) -> None:
        while not self._stopping.is_set():
            await self._refresh_badges()
            await self._sleep(
                _positive(
                    self._server_config.get("sync_badges_interval_sec"),
                    DEFAULT_BADGES_SEC,
                )
            )

    async def _refresh_badges(self) -> None:
        try:
            if self._syncer is not None and self._syncer.ready():
                await self._syncer.refresh_badges()
        except Exception:  # noqa: BLE001
            LOGGER.exception("echec de rafraichissement du cache badges")

    async def _loop_playlist(self) -> None:
        while not self._stopping.is_set():
            try:
                if self._syncer is not None and self._syncer.ready():
                    elements = await self._syncer.refresh_playlist()
                    if elements is not None:
                        # La playlist part à l'écran IMMÉDIATEMENT, avec les
                        # médias déjà en cache ; ceux qui manquent arrivent
                        # ensuite et déclenchent un second envoi.
                        await self._ui.playlist(elements)
                    await self._sync_media()
            except Exception:  # noqa: BLE001
                LOGGER.exception("echec de rafraichissement de la playlist")
            await self._sleep(
                _positive(
                    self._server_config.get("sync_playlist_interval_sec"),
                    DEFAULT_PLAYLIST_SEC,
                )
            )

    async def _sync_media(self) -> None:
        """Télécharge les médias manquants, puis renvoie la playlist à l'écran.

        Tâche de fond, **jamais sur le chemin d'un badgeage** : la capture, le
        calcul du sens et la mise en file ne dépendent ni du réseau ni de ce
        cache. Un média absent n'est pas une panne — l'élément concerné
        s'affiche avec son texte, et le média apparaîtra au cycle suivant.
        """
        if self._syncer is None:
            return
        try:
            recuperes = await self._syncer.sync_media()
        except Exception:  # noqa: BLE001 - l'affichage ne casse jamais le poste
            LOGGER.exception("echec de synchronisation des medias")
            return
        if recuperes:
            await self._ui.playlist(self._syncer.playlist_locale())

    async def _loop_heartbeat(self) -> None:
        while not self._stopping.is_set():
            try:
                await self._heartbeat_once()
            except Exception:  # noqa: BLE001
                LOGGER.exception("echec du heartbeat")
            await self._sleep(
                _positive(
                    self._server_config.get("heartbeat_interval_sec"),
                    DEFAULT_HEARTBEAT_SEC,
                )
            )

    async def _heartbeat_once(self) -> None:
        if self._syncer is None or not self._syncer.ready():
            return

        outcome = await self._syncer.send_heartbeat(
            derive_estimee_sec=self._drift.drift_sec, reader_mode=self._reader_mode
        )
        if outcome.ok:
            self._drift.observe(
                _dt.datetime.now(_dt.timezone.utc), outcome.server_time_utc
            )
            if self._drift.in_alert():
                LOGGER.warning(
                    "derive d'horloge de %.1f s — verifier NTP et la pile RTC",
                    self._drift.drift_sec or 0.0,
                )
            await self._refresh_config()
        await self._notify_status()

    async def _refresh_config(self) -> None:
        try:
            config = await self._syncer.refresh_config()  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            LOGGER.exception("echec de rafraichissement de la configuration")
            return
        if config:
            self._server_config = config
            self._apply_server_config(config)

    async def _loop_status(self) -> None:
        while not self._stopping.is_set():
            await self._notify_status()
            await self._sleep(STATUS_TICK_SEC)

    async def _loop_purge(self) -> None:
        while not self._stopping.is_set():
            await self._sleep(PURGE_TICK_SEC)
            try:
                supprimes = self._store.purge_old_events()
                if supprimes:
                    LOGGER.info("%d pointage(s) local(aux) purge(s)", supprimes)
            except Exception:  # noqa: BLE001
                LOGGER.exception("echec de purge des pointages locaux")

    async def _loop_watchdog(self) -> None:
        """Ping du watchdog systemd (PST-09)."""
        if not os.environ.get("NOTIFY_SOCKET"):
            return
        while not self._stopping.is_set():
            sd_notify("WATCHDOG=1")
            await self._sleep(WATCHDOG_TICK_SEC)

    async def _notify_status(self) -> None:
        await self._ui.status(
            online=bool(self._syncer and self._syncer.online),
            file=self._store.queue_size(),
            heure=_dt.datetime.now(PARIS).strftime("%H:%M"),
            lecteur=self._reader_connected,
        )

    async def _sleep(self, seconds: float) -> None:
        """Attente interruptible par la demande d'arrêt."""
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=max(0.5, seconds))
        except asyncio.TimeoutError:
            pass

    # ------------------------------------------------------------- exécution

    async def run(self) -> None:
        LOGGER.info(
            "demarrage agent %s — poste %s (%s)",
            __version__,
            self._config.device_code,
            self._config.target,
        )
        await self._ui.start()
        await self._notify_status()

        async with Syncer(self._config, self._store) as syncer:
            self._syncer = syncer
            # Le cache média appartient au Syncer ; l'interface le sert sous
            # /media/ sur la boucle locale (CSP 'self' préservée).
            self._ui.media_cache = syncer.media
            # Dernière playlist connue, médias déjà en cache : l'écran est
            # complet dès le démarrage, avant tout échange réseau (AFF-07).
            await self._ui.playlist(syncer.playlist_locale())
            sd_notify("READY=1")

            taches = [
                asyncio.create_task(self._reader.run(), name="reader"),
                asyncio.create_task(self._loop_queue(), name="queue"),
                asyncio.create_task(self._loop_badges(), name="badges"),
                asyncio.create_task(self._loop_playlist(), name="playlist"),
                asyncio.create_task(self._loop_heartbeat(), name="heartbeat"),
                asyncio.create_task(self._loop_status(), name="status"),
                asyncio.create_task(self._loop_purge(), name="purge"),
                asyncio.create_task(self._loop_watchdog(), name="watchdog"),
            ]
            await self._stopping.wait()

            sd_notify("STOPPING=1")
            for tache in taches:
                tache.cancel()
            await asyncio.gather(*taches, return_exceptions=True)

            # Dernière tentative d'écoulement de la file avant l'arrêt.
            try:
                if self._store.queue_size() and syncer.ready():
                    await asyncio.wait_for(syncer.push_queue(), timeout=10)
            except Exception:  # noqa: BLE001 - l'arrêt ne doit jamais échouer
                pass

        await self._ui.stop()
        restants = self._store.queue_size()
        self._store.close()
        LOGGER.info(
            "agent arrete proprement — %d pointage(s) conserve(s) en file", restants
        )

    def stop(self) -> None:
        if not self._stopping.is_set():
            LOGGER.info("arret demande — vidage de la base locale")
            self._stopping.set()


# --------------------------------------------------------------- systemd


def sd_notify(state: str) -> bool:
    """Notifie systemd via ``NOTIFY_SOCKET`` (implémentation minimale).

    Aucune dépendance : un simple datagramme sur socket UNIX. Gère l'espace de
    noms abstrait (adresse commençant par ``@``).
    """
    adresse = os.environ.get("NOTIFY_SOCKET")
    if not adresse:
        return False
    if adresse.startswith("@"):
        adresse = "\0" + adresse[1:]

    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM | socket.SOCK_CLOEXEC) as sock:
            sock.connect(adresse)
            sock.sendall(state.encode("utf-8"))
        return True
    except OSError as exc:
        LOGGER.debug("sd_notify indisponible : %s", exc)
        return False


def _positive(valeur: Any, defaut: float) -> float:
    try:
        nombre = float(valeur)
    except (TypeError, ValueError):
        return defaut
    return nombre if nombre > 0 else defaut


def run(config: Config) -> int:
    """Lance l'agent jusqu'à réception de SIGTERM/SIGINT."""
    agent = Agent(config)

    async def _main() -> None:
        boucle = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                boucle.add_signal_handler(sig, agent.stop)
            except NotImplementedError:  # pragma: no cover
                signal.signal(sig, lambda *_: agent.stop())
        await agent.run()

    try:
        asyncio.run(_main())
    except KeyboardInterrupt:  # pragma: no cover
        return 0
    return 0
