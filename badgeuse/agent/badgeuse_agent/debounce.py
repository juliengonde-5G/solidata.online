"""Anti-rebond par badge (PST-02).

Module PUR : horloge injectée, aucun effet de bord. Un même badge présenté deux
fois en moins de ``window_sec`` (défaut 8 s) ne génère qu'un pointage ; la
seconde présentation reçoit un message « déjà enregistré » — ni succès, ni
erreur, ton neutre.
"""

from __future__ import annotations

import time
from typing import Callable, Dict

DEFAULT_WINDOW_SEC = 8.0

#: Au-delà de ce multiple de la fenêtre, les entrées sont oubliées (mémoire bornée).
_PRUNE_FACTOR = 4


class Debouncer:
    """Mémoire courte des dernières présentations, indexée par ``uid_hmac``."""

    def __init__(
        self,
        window_sec: float = DEFAULT_WINDOW_SEC,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if window_sec < 0:
            raise ValueError("window_sec doit etre positif")
        self._window_sec = float(window_sec)
        self._clock = clock
        self._last_seen: Dict[str, float] = {}

    @property
    def window_sec(self) -> float:
        return self._window_sec

    def set_window(self, window_sec: float) -> None:
        """Ajuste la fenêtre (paramètre serveur ``anti_rebond_sec``)."""
        if window_sec < 0:
            raise ValueError("window_sec doit etre positif")
        self._window_sec = float(window_sec)

    def accept(self, uid_hmac: str) -> bool:
        """Enregistre une présentation et dit si elle doit produire un pointage.

        :returns: ``True`` si la présentation est retenue, ``False`` si elle
            tombe dans la fenêtre d'anti-rebond du même badge.
        """
        now = self._clock()
        previous = self._last_seen.get(uid_hmac)

        if previous is not None and (now - previous) < self._window_sec:
            # Rebond : on ne prolonge pas la fenêtre, sinon une carte laissée
            # devant le lecteur bloquerait le badge indéfiniment.
            return False

        self._last_seen[uid_hmac] = now
        self._prune(now)
        return True

    def remaining(self, uid_hmac: str) -> float:
        """Secondes restantes avant qu'un nouveau pointage soit accepté."""
        previous = self._last_seen.get(uid_hmac)
        if previous is None:
            return 0.0
        return max(0.0, self._window_sec - (self._clock() - previous))

    def _prune(self, now: float) -> None:
        horizon = self._window_sec * _PRUNE_FACTOR
        if len(self._last_seen) < 64:
            return
        self._last_seen = {
            key: seen for key, seen in self._last_seen.items() if now - seen <= horizon
        }
