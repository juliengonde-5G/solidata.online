"""Pseudonymisation de l'UID de badge (CONTRAT_HMAC §1).

Module PUR. Point de contrat critique : la clé de site est décodée **d'hex vers
octets** avant HMAC, tandis que le message est la **chaîne ASCII** de l'UID
normalisé (et non ses octets décodés).

    uid_hmac = HMAC-SHA256(bytes.fromhex(cle_site), uid_normalise.encode())

Le condensat est le seul identifiant de badge qui a le droit d'être écrit sur
disque, journalisé ou transmis.
"""

from __future__ import annotations

import hashlib
import hmac as _hmac

#: Taille attendue de la clé de site : 256 bits.
SITE_KEY_BYTES = 32

#: Nombre de caractères d'un ``uid_hmac`` (hex minuscule).
UID_HMAC_LENGTH = 64

#: Valeur littérale portée par un pointage manuel, sans badge (CONTRAT_INTEGRITE §2).
NO_BADGE = "-"


def hmac_uid(site_key_hex: str, uid_normalise: str) -> str:
    """Calcule le condensat pseudonyme d'un UID normalisé.

    :param site_key_hex: clé de site, 64 caractères hexadécimaux (256 bits).
    :param uid_normalise: UID issu de :func:`normalize.normalize_uid`.
    :returns: condensat hexadécimal minuscule de 64 caractères.
    :raises ValueError: clé mal formée ou UID vide.
    """
    if not uid_normalise:
        raise ValueError("uid_normalise vide")

    key = _decode_key(site_key_hex)
    return _hmac.new(key, uid_normalise.encode("ascii"), hashlib.sha256).hexdigest()


def _decode_key(site_key_hex: str) -> bytes:
    """Décode et valide la clé de site sans jamais l'exposer dans un message."""
    if not site_key_hex:
        raise ValueError("cle de site absente")
    try:
        key = bytes.fromhex(site_key_hex.strip())
    except ValueError as exc:  # pragma: no cover - message normalisé
        raise ValueError("cle de site non hexadecimale") from exc
    if len(key) != SITE_KEY_BYTES:
        raise ValueError(
            f"cle de site de {len(key)} octets, {SITE_KEY_BYTES} attendus"
        )
    return key


def is_valid_uid_hmac(value: str) -> bool:
    """Vrai si ``value`` a la forme d'un ``uid_hmac`` (hex minuscule, 64 car.)."""
    if not isinstance(value, str) or len(value) != UID_HMAC_LENGTH:
        return False
    return all(c in "0123456789abcdef" for c in value)


def short(uid_hmac: str, size: int = 12) -> str:
    """Tronque un condensat pour les journaux (12 caractères maximum).

    Les journaux du poste n'affichent jamais l'UID brut ni le condensat complet.
    """
    if not uid_hmac:
        return "?"
    return uid_hmac[: min(size, 12)]
