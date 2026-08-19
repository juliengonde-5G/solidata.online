"""Anti-rebond par badge (PST-02).

Module PUR : horloge injectée, aucun effet de bord. Un même badge présenté deux
fois en moins de ``window_sec`` ne génère qu'un pointage ; la seconde
présentation reçoit un message « déjà enregistré » — ni succès, ni erreur, ton
neutre.

POURQUOI 5 MINUTES ET NON 8 SECONDES. La fenêtre d'origine (8 s) ne couvrait
que le rebond MATÉRIEL du lecteur. En exploitation, le geste qui pose problème
est humain : quelqu'un doute que son badge ait été pris et le représente une
demi-minute plus tard. À 8 s cette seconde présentation était acceptée, donc
silencieuse — aucun message à l'écran — et elle produisait un vrai second
pointage. Le sens alternant, la journée se refermait sur une paire de quelques
secondes et le vrai départ du soir devenait une entrée orpheline : quelques
heures de travail disparaissaient de la feuille de temps.

La fenêtre reste une RÈGLE DE GESTION arbitrable (ADR-0002) : elle descend du
serveur par ``GET /config`` (``badgeuse.anti_rebond_sec``). La valeur ci-dessous
n'est qu'un repli, utilisé tant que le poste n'a pas reçu sa configuration.

CONTREPARTIE ASSUMÉE : un aller-retour réel plus court que la fenêtre (sortir
et revenir en 3 minutes) n'est pas compté. C'est pourquoi le refus n'est JAMAIS
muet — l'écran dit qu'il ne compte pas ce passage, et depuis combien de temps
le badge est déjà enregistré.
"""

from __future__ import annotations

import time
from typing import Callable, Dict, Optional

DEFAULT_WINDOW_SEC = 300.0

#: Au-delà de ce multiple de la fenêtre, les entrées sont oubliées (mémoire bornée).
_PRUNE_FACTOR = 4

#: Plafond DUR du nombre de badges mémorisés.
#:
#: L'oubli par ancienneté seul suffisait avec une fenêtre de 8 s (horizon 32 s).
#: À 300 s l'horizon passe à 20 minutes : sur un poste très fréquenté, ou si un
#: exploitant règle une fenêtre très large, le dictionnaire pourrait croître
#: sans borne effective. Le plafond garantit la borne quelle que soit la valeur
#: réglée — un poste embarqué ne doit jamais voir sa mémoire dériver avec un
#: paramètre. 512 dépasse largement l'effectif d'un site.
_MAX_ENTREES = 512


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

    def elapsed(self, uid_hmac: str) -> Optional[float]:
        """Secondes écoulées depuis la présentation RETENUE de ce badge.

        Sert à dire à la personne *quand* son passage a été enregistré. Sans
        cette information, « déjà enregistré » ne lui apprend rien : elle ne
        sait ni si c'était il y a dix secondes ni s'il faut voir l'encadrant.

        :returns: ``None`` si ce badge n'a aucune présentation en mémoire.
        """
        previous = self._last_seen.get(uid_hmac)
        if previous is None:
            return None
        return max(0.0, self._clock() - previous)

    def _prune(self, now: float) -> None:
        if len(self._last_seen) < 64:
            return
        horizon = self._window_sec * _PRUNE_FACTOR
        self._last_seen = {
            key: seen for key, seen in self._last_seen.items() if now - seen <= horizon
        }
        # Filet de sécurité : si la fenêtre réglée est si large que l'oubli par
        # ancienneté ne retire rien, on ne garde que les présentations les plus
        # récentes. Les plus anciennes sont, par construction, celles dont la
        # fenêtre est la plus proche d'expirer.
        if len(self._last_seen) > _MAX_ENTREES:
            recents = sorted(self._last_seen.items(), key=lambda kv: kv[1], reverse=True)
            self._last_seen = dict(recents[:_MAX_ENTREES])
