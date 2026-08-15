"""Chaînage cryptographique des pointages (CONTRAT_INTEGRITE §2 et §3).

Module PUR. Conforme au caractère près : toute divergence de formatage casse la
vérification côté serveur et invalide la force probatoire du dispositif.

    hash_courant = SHA256( hash_precedent || canonical(pointage) )

où ``||`` est la concaténation des **chaînes de caractères** (le hash précédent
sous sa forme hexadécimale minuscule, suivi de la charge utile canonique), le
tout encodé en UTF-8. Le vecteur partagé du CONTRAT_HMAC §4 fige ce choix.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
from typing import Mapping

#: Ordre des champs de la charge utile canonique — ne jamais réordonner.
CANONICAL_FIELDS = (
    "uuid",
    "device_code",
    "sequence_device",
    "uid_hmac",
    "horodatage_utc",
    "sens",
    "source",
)

SEPARATOR = "|"

SENS_VALUES = ("entree", "sortie", "inconnu")
SOURCE_VALUES = ("badge", "manuel", "import")


def genesis_hash(device_code: str) -> str:
    """Hash de genèse d'un poste : ``SHA256("genesis:" + device_code)``.

    Sert de ``hash_precedent`` au tout premier pointage du poste.
    """
    if not device_code:
        raise ValueError("device_code vide")
    return hashlib.sha256(f"genesis:{device_code}".encode("utf-8")).hexdigest()


def canonical(p: Mapping[str, object]) -> str:
    """Sérialise un pointage en charge utile canonique.

    Champs attendus : ``uuid``, ``device_code``, ``sequence_device``,
    ``uid_hmac`` (``-`` pour un pointage manuel), ``horodatage_utc``
    (``YYYY-MM-DDTHH:MM:SS.mmmZ``), ``sens``, ``source``.

    :raises ValueError: champ manquant, vide, contenant le séparateur, ou
        valeur hors énumération du contrat.
    """
    values = []
    for field in CANONICAL_FIELDS:
        if field not in p:
            raise ValueError(f"champ canonique manquant : {field}")
        raw = p[field]

        if field == "sequence_device":
            sequence = int(raw)  # base 10, sans zéros de tête
            if sequence < 1:
                raise ValueError("sequence_device doit etre >= 1")
            value = str(sequence)
        else:
            value = str(raw)

        if value == "":
            raise ValueError(f"champ canonique vide : {field}")
        if SEPARATOR in value:
            raise ValueError(f"separateur interdit dans le champ {field}")
        values.append(value)

    payload = dict(zip(CANONICAL_FIELDS, values))
    if payload["sens"] not in SENS_VALUES:
        raise ValueError(f"sens invalide : {payload['sens']}")
    if payload["source"] not in SOURCE_VALUES:
        raise ValueError(f"source invalide : {payload['source']}")

    return SEPARATOR.join(values)


def chain_hash(previous_hash: str, canonical_payload: str) -> str:
    """Chaîne un pointage au précédent du même poste.

    :param previous_hash: hash du pointage précédent, ou :func:`genesis_hash`
        pour le premier pointage du poste (hex minuscule, 64 caractères).
    :param canonical_payload: sortie de :func:`canonical`.
    """
    if not previous_hash or len(previous_hash) != 64:
        raise ValueError("hash_precedent invalide")
    if not canonical_payload:
        raise ValueError("charge utile canonique vide")
    return hashlib.sha256(
        (previous_hash + canonical_payload).encode("utf-8")
    ).hexdigest()


def utc_iso_ms(moment: _dt.datetime) -> str:
    """Formate un instant en ``YYYY-MM-DDTHH:MM:SS.mmmZ`` (UTC, millisecondes).

    Un instant naïf est considéré comme déjà exprimé en UTC.
    """
    if moment.tzinfo is not None:
        moment = moment.astimezone(_dt.timezone.utc).replace(tzinfo=None)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def parse_utc_iso(value: str) -> _dt.datetime:
    """Relit un horodatage UTC ISO, avec ou sans millisecondes, suffixe ``Z``.

    Retourne un ``datetime`` conscient du fuseau (UTC).
    """
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = _dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_dt.timezone.utc)
    return parsed.astimezone(_dt.timezone.utc)
