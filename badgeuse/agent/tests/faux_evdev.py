"""Faux ``evdev`` : un lecteur RFID en émulation clavier, sans matériel.

Reproduit fidèlement ce que le poste voit d'un lecteur HID USB, y compris le
cas qui a coûté une journée de terrain : **un lecteur expose souvent DEUX
interfaces d'événements** (``/dev/input/eventX`` et ``eventY``) portant le même
nom et les mêmes identifiants USB, dont une seule émet réellement les frappes.

Ne dépend de rien : ni ``evdev``, ni matériel, ni permission particulière.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Iterable, List, Optional


class Ecodes:
    """Sous-ensemble de ``evdev.ecodes`` utilisé par le poste."""

    EV_KEY = 1
    EV_SYN = 0
    EV_MSC = 4

    KEY_ENTER = 28
    KEY_KPENTER = 96
    KEY_TAB = 15
    KEY_LEFTSHIFT = 42

    # KEY_0 … KEY_9 (valeurs réelles du noyau Linux).
    KEY_1, KEY_2, KEY_3, KEY_4, KEY_5 = 2, 3, 4, 5, 6
    KEY_6, KEY_7, KEY_8, KEY_9, KEY_0 = 7, 8, 9, 10, 11

    KEY_A, KEY_B, KEY_C, KEY_D, KEY_E, KEY_F = 30, 48, 46, 32, 18, 33

    # Touches d'une interface « consumer control » : présentes, mais aucune
    # d'elles ne compose un UID.
    KEY_PLAYPAUSE = 164
    KEY_VOLUMEUP = 115


ecodes = Ecodes()

#: Nom evdev de chaque code utilisé par les tests.
NOMS = {
    Ecodes.KEY_ENTER: "KEY_ENTER",
    Ecodes.KEY_KPENTER: "KEY_KPENTER",
    Ecodes.KEY_TAB: "KEY_TAB",
    Ecodes.KEY_LEFTSHIFT: "KEY_LEFTSHIFT",
    Ecodes.KEY_PLAYPAUSE: "KEY_PLAYPAUSE",
    Ecodes.KEY_VOLUMEUP: "KEY_VOLUMEUP",
}
for _chiffre in range(10):
    NOMS[getattr(Ecodes, f"KEY_{_chiffre}")] = f"KEY_{_chiffre}"
for _lettre in "ABCDEF":
    NOMS[getattr(Ecodes, f"KEY_{_lettre}")] = f"KEY_{_lettre}"

CODES = {nom: code for code, nom in NOMS.items()}

#: Capacités d'un clavier complet (ce que présente un lecteur RFID HID).
CLAVIER_COMPLET = sorted(CODES.values())

#: Capacités d'une interface « consumer control » : pas de chiffres.
CONSUMER = [Ecodes.KEY_PLAYPAUSE, Ecodes.KEY_VOLUMEUP]


class Info:
    def __init__(self, vendor: int, product: int) -> None:
        self.bustype = 3
        self.vendor = vendor
        self.product = product
        self.version = 1


class Evenement:
    def __init__(self, code: int, valeur: int, type_: int = Ecodes.EV_KEY) -> None:
        self.type = type_
        self.code = code
        self.value = valeur
        self.timestamp = lambda: 0.0


class ToucheCategorisee:
    key_up = 0
    key_down = 1
    key_hold = 2

    def __init__(self, evenement: Evenement) -> None:
        self.keystate = evenement.value
        self.keycode = NOMS.get(evenement.code, "KEY_UNKNOWN")
        self.event = evenement


def categorize(evenement: Evenement) -> ToucheCategorisee:
    return ToucheCategorisee(evenement)


class FauxPeripherique:
    """Un ``/dev/input/eventN``. Les frappes sont injectées par le test."""

    def __init__(
        self,
        path: str,
        name: str,
        vendor: int = 0xFFFF,
        product: int = 0x0035,
        capacites: Optional[Iterable[int]] = None,
        muet: bool = False,
        illisible: bool = False,
    ) -> None:
        self.path = path
        self.name = name
        self.info = Info(vendor, product)
        self._capacites = list(CLAVIER_COMPLET if capacites is None else capacites)
        self.muet = muet
        #: Droits insuffisants sur /dev/input/eventN (agent hors groupe input).
        self.illisible = illisible
        self.grabbed = False
        self.ferme = False
        self.grabs = 0
        self._file: "asyncio.Queue[Evenement]" = asyncio.Queue()

    # ---------------------------------------------------------------- evdev

    def capabilities(self, *_a: Any, **_k: Any) -> Dict[int, List[int]]:
        return {Ecodes.EV_KEY: list(self._capacites)}

    def grab(self) -> None:
        self.grabbed = True
        self.grabs += 1

    def ungrab(self) -> None:
        self.grabbed = False

    def close(self) -> None:
        self.ferme = True

    async def async_read_loop(self):
        while True:
            evenement = await self._file.get()
            yield evenement

    # ----------------------------------------------------------- injection

    def frapper(self, nom_touche: str) -> None:
        """Une frappe (appui + relâchement), comme le noyau les livre."""
        code = CODES[nom_touche]
        self._file.put_nowait(Evenement(code, 1))
        self._file.put_nowait(Evenement(code, 0))

    def saisir(self, texte: str, terminateur: Optional[str] = "KEY_ENTER") -> None:
        """Saisit un UID caractère par caractère, puis (option) « Entrée »."""
        if self.muet:
            return
        for caractere in texte:
            self.frapper(f"KEY_{caractere.upper()}")
        if terminateur:
            self.frapper(terminateur)


class FauxEvdev:
    """Le module ``evdev`` vu par ``reader.py``."""

    def __init__(self, peripheriques: List[FauxPeripherique]) -> None:
        self.peripheriques = peripheriques
        self.InputDevice = self._ouvrir

    def list_devices(self, *_a: Any) -> List[str]:
        return [p.path for p in self.peripheriques]

    def _ouvrir(self, path: str) -> FauxPeripherique:
        for peripherique in self.peripheriques:
            if peripherique.path == path:
                if peripherique.illisible:
                    raise PermissionError(13, "Permission denied", path)
                return peripherique
        raise OSError(f"peripherique inconnu : {path}")

    @staticmethod
    def categorize(evenement: Evenement) -> ToucheCategorisee:
        return categorize(evenement)
