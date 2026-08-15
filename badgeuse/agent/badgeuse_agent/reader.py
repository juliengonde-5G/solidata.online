"""Capture du lecteur RFID en émulation clavier (PST-01).

Le lecteur est saisi en **accès exclusif** (``EVIOCGRAB``) : les frappes ne
partent donc pas dans Chromium ni dans une console, et la capture est
indépendante de la fenêtre active. Aucune saisie clavier n'est possible pour
l'utilisateur (PST-10).

L'import d'``evdev`` est **protégé** : le reste du paquet — et la totalité des
tests — reste importable sur une machine sans lecteur ni bibliothèque native.

Discipline de confidentialité : la mémoire tampon de frappes contient l'UID brut.
Elle n'est jamais journalisée, jamais tracée, et effacée dès l'émission.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, List, Optional

try:  # pragma: no cover - dépend du matériel
    import evdev
    from evdev import ecodes

    EVDEV_AVAILABLE = True
except ImportError:  # pragma: no cover - poste de développement
    evdev = None  # type: ignore[assignment]
    ecodes = None  # type: ignore[assignment]
    EVDEV_AVAILABLE = False

LOGGER = logging.getLogger("badgeuse.reader")

#: Silence après lequel une saisie sans « Entrée » est considérée terminée.
FLUSH_TIMEOUT_SEC = 1.5

#: Longueur maximale d'une saisie avant abandon (garde-fou anti-flot).
MAX_BUFFER = 64

BACKOFF_START_SEC = 1.0
BACKOFF_MAX_SEC = 30.0

_TERMINATORS = {"KEY_ENTER", "KEY_KPENTER", "KEY_TAB"}
_IGNORED_PREFIXES = ("KEY_LEFTSHIFT", "KEY_RIGHTSHIFT", "KEY_CAPSLOCK", "KEY_NUMLOCK")


def keyname_to_char(name: str) -> Optional[str]:
    """Traduit un nom de touche evdev en caractère.

    Seuls les caractères utiles à un UID sont retenus (chiffres et lettres) ;
    tout le reste est ignoré. Fonction pure, sans dépendance à ``evdev``.
    """
    if not name or not name.startswith("KEY_"):
        return None
    suffix = name[4:]

    if suffix.isdigit() and len(suffix) == 1:  # KEY_0 … KEY_9
        return suffix
    if suffix.startswith("KP") and suffix[2:].isdigit() and len(suffix) == 3:
        return suffix[2:]  # pavé numérique
    if len(suffix) == 1 and suffix.isalpha():  # KEY_A … KEY_Z
        return suffix
    return None


class BadgeReader:
    """Boucle de capture d'un lecteur, avec reconnexion automatique."""

    def __init__(
        self,
        on_uid: Callable[[str], Awaitable[None]],
        vendor_id: Optional[int] = None,
        product_id: Optional[int] = None,
        name_hint: Optional[str] = None,
        on_state: Optional[Callable[[bool], Awaitable[None]]] = None,
    ) -> None:
        self._on_uid = on_uid
        self._on_state = on_state
        self._vendor_id = vendor_id
        self._product_id = product_id
        self._name_hint = (name_hint or "").lower() or None
        self._buffer: List[str] = []
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    # ------------------------------------------------------------ boucle

    async def run(self) -> None:
        """Capture en continu ; ne rend la main que sur annulation."""
        if not EVDEV_AVAILABLE:
            LOGGER.error(
                "bibliotheque evdev absente : la capture du lecteur est "
                "desactivee (installer python3-evdev)"
            )
            return

        backoff = BACKOFF_START_SEC
        while True:
            device = None
            try:
                device = self._open_device()
                if device is None:
                    raise FileNotFoundError("aucun lecteur de badge detecte")

                device.grab()  # EVIOCGRAB : accès exclusif
                await self._set_connected(True)
                LOGGER.info(
                    "lecteur connecte : %s (%s)", device.name, device.path
                )
                backoff = BACKOFF_START_SEC
                await self._read_loop(device)

            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - la boucle ne doit jamais mourir
                LOGGER.warning("lecteur indisponible (%s) — nouvelle tentative "
                               "dans %.0f s", exc, backoff)
            finally:
                self._buffer.clear()
                await self._set_connected(False)
                if device is not None:
                    self._release(device)

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX_SEC)

    async def _read_loop(self, device: Any) -> None:
        """Lit les frappes jusqu'à déconnexion du périphérique."""
        pending: Optional[asyncio.Task] = None
        async for event in device.async_read_loop():
            if event.type != ecodes.EV_KEY:
                continue
            key = evdev.categorize(event)
            if key.keystate != key.key_down:
                continue

            name = key.keycode
            if isinstance(name, (list, tuple)):
                name = name[0]

            if pending is not None:
                pending.cancel()
                pending = None

            if name in _TERMINATORS:
                await self._emit()
                continue
            if name.startswith(_IGNORED_PREFIXES):
                continue

            char = keyname_to_char(name)
            if char is None:
                continue

            self._buffer.append(char)
            if len(self._buffer) >= MAX_BUFFER:
                # Flot anormal : on jette plutôt que d'émettre n'importe quoi.
                LOGGER.warning("saisie anormalement longue — tampon abandonne")
                self._buffer.clear()
                continue

            pending = asyncio.create_task(self._flush_later())

    async def _flush_later(self) -> None:
        """Émet la saisie si le lecteur n'envoie pas d'« Entrée » finale."""
        try:
            await asyncio.sleep(FLUSH_TIMEOUT_SEC)
            await self._emit()
        except asyncio.CancelledError:
            pass

    async def _emit(self) -> None:
        """Transmet la saisie puis efface immédiatement le tampon."""
        if not self._buffer:
            return
        raw = "".join(self._buffer)
        self._buffer.clear()
        try:
            await self._on_uid(raw)
        finally:
            del raw  # l'UID brut ne survit pas à l'appel

    # ------------------------------------------------------------ ouverture

    def _open_device(self) -> Optional[Any]:
        """Sélectionne le lecteur : identifiants USB, nom, puis capacités."""
        candidates = []
        for path in evdev.list_devices():
            try:
                candidates.append(evdev.InputDevice(path))
            except OSError:
                continue

        if not candidates:
            return None

        chosen = (
            self._match_by_usb_ids(candidates)
            or self._match_by_name(candidates)
            or self._match_by_capabilities(candidates)
        )

        for device in candidates:
            if chosen is None or device.path != chosen.path:
                self._close_quietly(device)
        return chosen

    def _match_by_usb_ids(self, candidates: List[Any]) -> Optional[Any]:
        if self._vendor_id is None or self._product_id is None:
            return None
        for device in candidates:
            info = device.info
            if info.vendor == self._vendor_id and info.product == self._product_id:
                return device
        LOGGER.warning(
            "aucun peripherique %04x:%04x — repli sur la detection par capacites",
            self._vendor_id,
            self._product_id,
        )
        return None

    def _match_by_name(self, candidates: List[Any]) -> Optional[Any]:
        if not self._name_hint:
            return None
        for device in candidates:
            if self._name_hint in (device.name or "").lower():
                return device
        return None

    def _match_by_capabilities(self, candidates: List[Any]) -> Optional[Any]:
        """Un clavier HID capable d'émettre les chiffres et « Entrée »."""
        required = {ecodes.KEY_ENTER, *(getattr(ecodes, f"KEY_{d}") for d in range(10))}
        for device in candidates:
            keys = set(device.capabilities().get(ecodes.EV_KEY, []))
            if required <= keys:
                return device
        return None

    @staticmethod
    def _close_quietly(device: Any) -> None:
        try:
            device.close()
        except OSError:
            pass

    def _release(self, device: Any) -> None:
        try:
            device.ungrab()
        except (OSError, RuntimeError):
            pass
        self._close_quietly(device)

    async def _set_connected(self, connected: bool) -> None:
        if connected == self._connected:
            return
        self._connected = connected
        if self._on_state is not None:
            await self._on_state(connected)
