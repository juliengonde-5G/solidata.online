"""Capture du lecteur RFID en émulation clavier (PST-01).

Le lecteur est saisi en **accès exclusif** (``EVIOCGRAB``) : les frappes ne
partent donc pas dans Chromium ni dans une console, et la capture est
indépendante de la fenêtre active. Aucune saisie clavier n'est possible pour
l'utilisateur (PST-10).

**Toutes** les interfaces d'entrée qui correspondent au lecteur sont saisies et
lues **simultanément**, jamais une seule. Raison, constatée sur le terrain : un
lecteur RFID HID expose fréquemment DEUX ``/dev/input/eventN`` sous le même nom
et les mêmes identifiants USB (interface « clavier » et interface « consumer /
vendor »), et rien ne permet de savoir depuis l'espace utilisateur laquelle
émettra les frappes. En n'en retenant qu'une, le poste jouait le badgeage à
pile ou face : l'interface muette était saisie, le journal annonçait « lecteur
connecte », et aucun badge n'arrivait jamais — sans le moindre message. Chaque
interface a sa propre mémoire tampon : deux saisies simultanées ne peuvent pas
se mélanger.

L'import d'``evdev`` est **protégé** : le reste du paquet — et la totalité des
tests — reste importable sur une machine sans lecteur ni bibliothèque native.

Discipline de confidentialité : la mémoire tampon de frappes contient l'UID brut.
Elle n'est jamais journalisée, jamais tracée, et effacée dès l'émission. Les
journaux de ce module ne comptent que des ÉVÉNEMENTS, jamais leur contenu.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

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


def _ouvrir_candidats() -> List[Any]:
    """Ouvre toutes les interfaces d'entrée visibles.

    Une interface qui refuse de s'ouvrir est **signalée** : c'était jusqu'ici
    un ``continue`` muet, et si l'interface écartée était justement celle qui
    émet les frappes, le poste restait silencieux sans que rien ne l'explique.
    Le cas le plus courant est un droit manquant sur ``/dev/input/eventN``
    (l'agent doit appartenir au groupe ``input``).
    """
    candidats: List[Any] = []
    for path in sorted(evdev.list_devices()):
        try:
            candidats.append(evdev.InputDevice(path))
        except OSError as exc:
            LOGGER.warning(
                "interface %s illisible (%s) — verifier l'appartenance au "
                "groupe « input »",
                path,
                exc,
            )
    return candidats


def _est_clavier(device: Any) -> bool:
    """Vrai si le périphérique peut composer un UID (chiffres et « Entrée »).

    C'est la seule qualification objective disponible : un périphérique qui
    n'annonce pas les chiffres ne produira jamais de badge, quel que soit son
    nom. Une interface illisible est considérée comme non qualifiée plutôt que
    saisie « au cas où » — on ne bloque pas un périphérique inconnu.
    """
    if ecodes is None:  # pragma: no cover - sans evdev
        return False
    requis = {ecodes.KEY_ENTER, *(getattr(ecodes, f"KEY_{d}") for d in range(10))}
    try:
        touches = set(device.capabilities().get(ecodes.EV_KEY, []))
    except (OSError, AttributeError, TypeError):
        return False
    return requis <= touches


class _Saisie:
    """Mémoire tampon d'UNE interface d'entrée.

    Une par périphérique : deux interfaces qui émettent en même temps (cas
    courant d'un lecteur composite) ne peuvent pas produire un UID mélangé.
    """

    __slots__ = ("buffer", "pending", "ignorer", "frappes")

    def __init__(self) -> None:
        self.buffer: List[str] = []
        self.pending: Optional[asyncio.Task] = None
        #: Vrai après un flot anormal : tout est jeté jusqu'au prochain
        #: terminateur, plutôt que d'émettre la fin d'une saisie tronquée.
        self.ignorer = False
        self.frappes = 0

    def annuler(self) -> None:
        if self.pending is not None:
            self.pending.cancel()
            self.pending = None


class BadgeReader:
    """Boucle de capture des lecteurs, avec reconnexion automatique."""

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
        self._saisies: Dict[str, _Saisie] = {}
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    def tampons_vides(self) -> bool:
        """Vrai si aucune mémoire tampon ne retient de caractère.

        Sert aux tests de confidentialité : l'UID brut ne doit pas survivre à
        son émission.
        """
        return all(not saisie.buffer for saisie in self._saisies.values())

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
            devices: List[Any] = []
            try:
                devices = self._open_devices()
                if not devices:
                    raise FileNotFoundError("aucun lecteur de badge detecte")

                for device in devices:
                    device.grab()  # EVIOCGRAB : accès exclusif
                await self._set_connected(True)
                LOGGER.info(
                    "lecteur connecte : %d interface(s) saisie(s) — %s",
                    len(devices),
                    ", ".join(f"{d.name} ({d.path})" for d in devices),
                )
                if len(devices) > 1:
                    LOGGER.info(
                        "plusieurs interfaces indiscernables : toutes sont "
                        "ecoutees (une seule emet en general les frappes)"
                    )
                backoff = BACKOFF_START_SEC
                await self._read_all(devices)

            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - la boucle ne doit jamais mourir
                LOGGER.warning("lecteur indisponible (%s) — nouvelle tentative "
                               "dans %.0f s", exc, backoff)
            finally:
                self._oublier_saisies()
                await self._set_connected(False)
                for device in devices:
                    self._release(device)

            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX_SEC)

    async def _read_all(self, devices: List[Any]) -> None:
        """Lit toutes les interfaces en parallèle jusqu'à la première panne."""
        taches = [
            asyncio.create_task(self._read_loop(device), name=f"lecteur:{device.path}")
            for device in devices
        ]
        try:
            await asyncio.gather(*taches)
        finally:
            for tache in taches:
                tache.cancel()
            await asyncio.gather(*taches, return_exceptions=True)

    async def _read_loop(self, device: Any) -> None:
        """Lit les frappes d'une interface jusqu'à sa déconnexion."""
        cle = str(device.path)
        saisie = self._saisies.setdefault(cle, _Saisie())

        async for event in device.async_read_loop():
            if event.type != ecodes.EV_KEY:
                continue
            key = evdev.categorize(event)
            if key.keystate != key.key_down:
                continue

            name = key.keycode
            if isinstance(name, (list, tuple)):
                name = name[0]

            saisie.frappes += 1
            if saisie.frappes == 1:
                # Trace décisive en exploitation : elle distingue « le lecteur
                # est saisi mais ne parle pas » de « il parle et le poste ne
                # sait pas quoi en faire ». Aucun contenu, jamais.
                LOGGER.info("premiere frappe recue de %s", cle)

            saisie.annuler()

            if name in _TERMINATORS:
                if saisie.ignorer:
                    saisie.ignorer = False
                    saisie.buffer.clear()
                    continue
                await self._emit(saisie, cle)
                continue
            if name.startswith(_IGNORED_PREFIXES):
                continue

            char = keyname_to_char(name)
            if char is None:
                continue
            if saisie.ignorer:
                continue

            saisie.buffer.append(char)
            if len(saisie.buffer) >= MAX_BUFFER:
                # Flot anormal : on jette tout jusqu'au prochain terminateur
                # plutôt que d'émettre la queue d'une saisie tronquée.
                LOGGER.warning(
                    "saisie anormalement longue sur %s — tampon abandonne", cle
                )
                saisie.buffer.clear()
                saisie.ignorer = True
                continue

            saisie.pending = asyncio.create_task(self._flush_later(saisie, cle))

    async def _flush_later(self, saisie: _Saisie, cle: str) -> None:
        """Émet la saisie si le lecteur n'envoie pas d'« Entrée » finale."""
        try:
            await asyncio.sleep(FLUSH_TIMEOUT_SEC)
            await self._emit(saisie, cle)
        except asyncio.CancelledError:
            pass

    async def _emit(self, saisie: _Saisie, cle: str) -> None:
        """Transmet la saisie puis efface immédiatement le tampon."""
        if not saisie.buffer:
            return
        raw = "".join(saisie.buffer)
        saisie.buffer.clear()
        # INFO et pas DEBUG : quand la normalisation aval rejette la lecture,
        # cette ligne est la SEULE trace de ce que le lecteur a reellement
        # envoye — interface d'origine et longueur, jamais le contenu.
        LOGGER.info("saisie emise depuis %s (%d caracteres)", cle, len(raw))
        try:
            await self._on_uid(raw)
        finally:
            del raw  # l'UID brut ne survit pas à l'appel

    def _oublier_saisies(self) -> None:
        for saisie in self._saisies.values():
            saisie.annuler()
            saisie.buffer.clear()
        self._saisies.clear()

    # ------------------------------------------------------------ ouverture

    def _open_devices(self) -> List[Any]:
        """Sélectionne **toutes** les interfaces du lecteur.

        Ordre des filtres : identifiants USB, puis nom, puis capacités. Un
        filtre qui ne désigne rien retombe sur le suivant, avec un
        avertissement — jamais sur le silence.
        """
        candidates = _ouvrir_candidats()
        if not candidates:
            return []

        retenus = (
            self._match_by_usb_ids(candidates)
            or self._match_by_name(candidates)
            or self._match_by_capabilities(candidates)
        )

        gardes = {device.path for device in retenus}
        for device in candidates:
            if device.path not in gardes:
                self._close_quietly(device)
        return retenus

    def _match_by_usb_ids(self, candidates: List[Any]) -> List[Any]:
        if self._vendor_id is None or self._product_id is None:
            return []
        trouves = [
            device
            for device in candidates
            if device.info.vendor == self._vendor_id
            and device.info.product == self._product_id
            and _est_clavier(device)
        ]
        if not trouves:
            LOGGER.warning(
                "aucun clavier %04x:%04x — repli sur la detection par capacites",
                self._vendor_id,
                self._product_id,
            )
        return trouves

    def _match_by_name(self, candidates: List[Any]) -> List[Any]:
        if not self._name_hint:
            return []
        trouves = [
            device
            for device in candidates
            if self._name_hint in (device.name or "").lower() and _est_clavier(device)
        ]
        if not trouves:
            LOGGER.warning(
                "aucun clavier dont le nom contient « %s » — repli sur la "
                "detection par capacites",
                self._name_hint,
            )
        return trouves

    def _match_by_capabilities(self, candidates: List[Any]) -> List[Any]:
        """Tous les claviers HID capables d'émettre chiffres et « Entrée »."""
        return [device for device in candidates if _est_clavier(device)]

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


def inventaire(
    vendor_id: Optional[int] = None,
    product_id: Optional[int] = None,
    name_hint: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Décrit les interfaces d'entrée vues par le poste, et lesquelles il saisit.

    Sert au diagnostic de terrain (``python -m badgeuse_agent --lecteurs``) :
    on voit d'un coup d'œil si le lecteur expose deux interfaces, laquelle est
    qualifiée, et pourquoi une autre est écartée. **Aucune frappe n'est lue** :
    cette fonction ne peut pas divulguer un UID.
    """
    if not EVDEV_AVAILABLE:
        return []

    lecteur = BadgeReader(
        on_uid=_ignorer_uid,
        vendor_id=vendor_id,
        product_id=product_id,
        name_hint=name_hint,
    )

    peripheriques = _ouvrir_candidats()

    retenus = (
        lecteur._match_by_usb_ids(peripheriques)
        or lecteur._match_by_name(peripheriques)
        or lecteur._match_by_capabilities(peripheriques)
    )
    gardes = {device.path for device in retenus}

    lignes = []
    for device in peripheriques:
        clavier = _est_clavier(device)
        lignes.append(
            {
                "path": device.path,
                "nom": device.name,
                "vendor_id": f"0x{device.info.vendor:04x}",
                "product_id": f"0x{device.info.product:04x}",
                "clavier": clavier,
                "retenu": device.path in gardes,
                "motif": (
                    "saisi par l'agent"
                    if device.path in gardes
                    else ("ecarte par le filtre de configuration" if clavier
                          else "pas de chiffres ni d'Entree : ne compose aucun UID")
                ),
            }
        )
        BadgeReader._close_quietly(device)
    return lignes


async def _ignorer_uid(_raw: str) -> None:  # pragma: no cover - jamais appelée
    return None
