"""Détermination du sens entrée / sortie (PST-03).

Module PUR : les pointages antérieurs sont **injectés** par l'appelant, aucune
lecture de base ici.

Règle : alternance depuis le dernier pointage connu du salarié **dans la journée
civile Europe/Paris** en cours. Premier pointage de la journée → ``entree``.

Rappel d'architecture (SPEC §4.1) : le serveur fait foi. Le sens calculé ici est
la meilleure estimation locale, nécessaire pour l'affichage immédiat et pour
figer la charge utile chaînée ; c'est SOLIDATA qui arbitre en dernier ressort.
"""

from __future__ import annotations

import datetime as _dt
from typing import Iterable, NamedTuple, Optional, Sequence
from zoneinfo import ZoneInfo

from .chain import parse_utc_iso

PARIS = ZoneInfo("Europe/Paris")

ENTREE = "entree"
SORTIE = "sortie"
INCONNU = "inconnu"


class PointageLocal(NamedTuple):
    """Pointage déjà enregistré localement pour un salarié."""

    horodatage_utc: _dt.datetime
    sens: str


def civil_day(moment_utc: _dt.datetime, tz: ZoneInfo = PARIS) -> _dt.date:
    """Jour civil local (Europe/Paris par défaut) d'un instant UTC.

    Un pointage à 00h30 heure de Paris appartient au jour local, pas au jour UTC
    de la veille — c'est la journée de travail du salarié qui fait référence.
    """
    return _as_utc(moment_utc).astimezone(tz).date()


def determine_sens(
    previous_events: Iterable[object],
    now_utc: _dt.datetime,
    tz: ZoneInfo = PARIS,
) -> str:
    """Calcule le sens du pointage courant par alternance.

    :param previous_events: pointages du salarié (ordre indifférent). Chaque
        élément peut être un :class:`PointageLocal`, un mapping
        ``{"horodatage_utc": ..., "sens": ...}`` ou un couple
        ``(horodatage_utc, sens)``. Les horodatages sont acceptés en
        ``datetime`` ou en chaîne ISO UTC.
    :param now_utc: instant du pointage en cours.
    :returns: ``entree`` ou ``sortie``.
    """
    today = civil_day(now_utc, tz)
    now = _as_utc(now_utc)

    last: Optional[PointageLocal] = None
    for raw in previous_events:
        event = _coerce(raw)
        if event is None or event.sens == INCONNU:
            # Un pointage orphelin n'est rattaché à aucun salarié : il ne peut
            # pas porter l'alternance.
            continue
        if event.horodatage_utc > now:
            continue
        if civil_day(event.horodatage_utc, tz) != today:
            continue
        if last is None or event.horodatage_utc > last.horodatage_utc:
            last = event

    if last is None:
        return ENTREE
    return SORTIE if last.sens == ENTREE else ENTREE


def _coerce(raw: object) -> Optional[PointageLocal]:
    """Ramène une forme d'entrée quelconque à un :class:`PointageLocal`."""
    horodatage: object
    sens: object

    if isinstance(raw, PointageLocal):
        horodatage, sens = raw.horodatage_utc, raw.sens
    elif hasattr(raw, "horodatage_utc") and hasattr(raw, "sens"):
        horodatage, sens = raw.horodatage_utc, raw.sens  # type: ignore[attr-defined]
    elif isinstance(raw, dict):
        if "horodatage_utc" not in raw or "sens" not in raw:
            return None
        horodatage, sens = raw["horodatage_utc"], raw["sens"]
    elif isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        if len(raw) < 2:
            return None
        horodatage, sens = raw[0], raw[1]
    else:
        return None

    if isinstance(horodatage, str):
        horodatage = parse_utc_iso(horodatage)
    if not isinstance(horodatage, _dt.datetime):
        return None

    return PointageLocal(horodatage_utc=_as_utc(horodatage), sens=str(sens))


def _as_utc(moment: _dt.datetime) -> _dt.datetime:
    """Rend l'instant conscient du fuseau (naïf = déjà UTC)."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=_dt.timezone.utc)
    return moment.astimezone(_dt.timezone.utc)
