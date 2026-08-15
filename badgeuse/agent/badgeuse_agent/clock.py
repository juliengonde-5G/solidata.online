"""Surveillance de la dérive d'horloge (PST-07).

Module PUR : les instants sont injectés. La dérive est estimée en comparant
l'horloge locale au ``server_time_utc`` renvoyé par chaque réponse du serveur
(CONTRAT_API_DEVICE §2.1 et §2.5) et remontée dans le heartbeat ; au-delà de
2 secondes le serveur journalise une anomalie.

Le poste **ne recale jamais son horloge lui-même** : NTP et la RTC s'en
chargent. Une horloge fausse est un incident d'exploitation, pas quelque chose
qu'un agent applicatif corrige en silence sous des heures qui font foi.
"""

from __future__ import annotations

import datetime as _dt
from typing import Optional, Union

from .chain import parse_utc_iso

#: Seuil d'alerte, en secondes (CONTRAT_API_DEVICE §2.5).
DRIFT_ALERT_SEC = 2.0

Instant = Union[_dt.datetime, str]


def estimate_drift(local_utc: Instant, server_utc: Instant) -> float:
    """Dérive de l'horloge locale, en secondes.

    Positif = le poste est en avance sur le serveur.
    La latence réseau est incluse dans la mesure ; avec un seuil à 2 s elle
    reste négligeable et l'estimation est volontairement prudente.
    """
    local = _to_datetime(local_utc)
    server = _to_datetime(server_utc)
    return round((local - server).total_seconds(), 3)


def is_drift_alert(drift_sec: Optional[float], threshold: float = DRIFT_ALERT_SEC) -> bool:
    """Vrai si la dérive dépasse le seuil (en valeur absolue)."""
    if drift_sec is None:
        return False
    return abs(drift_sec) > threshold


class DriftMonitor:
    """Conserve la dernière dérive observée pour le heartbeat."""

    def __init__(self, threshold: float = DRIFT_ALERT_SEC) -> None:
        self._threshold = threshold
        self._drift: Optional[float] = None
        self._observed_at: Optional[_dt.datetime] = None

    @property
    def drift_sec(self) -> Optional[float]:
        """Dernière dérive mesurée, ``None`` tant qu'aucune réponse serveur."""
        return self._drift

    @property
    def observed_at(self) -> Optional[_dt.datetime]:
        return self._observed_at

    def observe(self, local_utc: Instant, server_utc: Optional[Instant]) -> Optional[float]:
        """Enregistre une observation ; retourne la dérive ou ``None``."""
        if not server_utc:
            return self._drift
        try:
            self._drift = estimate_drift(local_utc, server_utc)
        except (ValueError, TypeError):
            # Horodatage serveur illisible : on garde la dernière valeur connue
            # plutôt que d'inventer une dérive nulle.
            return self._drift
        self._observed_at = _to_datetime(local_utc)
        return self._drift

    def in_alert(self) -> bool:
        return is_drift_alert(self._drift, self._threshold)


def _to_datetime(value: Instant) -> _dt.datetime:
    if isinstance(value, str):
        return parse_utc_iso(value)
    if isinstance(value, _dt.datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=_dt.timezone.utc)
        return value.astimezone(_dt.timezone.utc)
    raise TypeError("instant attendu : datetime ou chaine ISO")
