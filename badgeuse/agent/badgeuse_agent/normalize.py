"""Normalisation de l'UID de badge (CONTRAT_HMAC §2).

Module PUR : aucune dépendance hors stdlib, aucune entrée/sortie, aucun log.
L'UID brut ne doit jamais quitter la mémoire vive : ce module le reçoit, le
normalise et le rend au seul appelant autorisé (le calcul HMAC).
"""

from __future__ import annotations

from typing import NamedTuple, Optional

#: Longueurs hexadécimales acceptées (UID ISO14443A de 4, 7 ou 10 octets).
ACCEPTED_LENGTHS = (8, 14, 20)

#: Longueur d'une sortie décimale de lecteur mal configuré (CONTRAT_HMAC §2.3).
DECIMAL_LENGTH = 10

_HEX_DIGITS = frozenset("0123456789abcdefABCDEF")

READER_MODE_HEX = "hex"
READER_MODE_DECIMAL = "decimal"


class NormalizedUid(NamedTuple):
    """UID normalisé et mode de lecture détecté."""

    uid: str
    """UID hexadécimal en majuscules, de longueur 8, 14 ou 20."""

    reader_mode: str
    """``hex`` ou ``decimal`` (remonté au heartbeat, cf. CONTRAT_API_DEVICE §2.5)."""


def normalize_uid(raw: Optional[str]) -> Optional[NormalizedUid]:
    """Normalise une lecture de badge.

    Étapes du contrat, dans l'ordre :

    1. retrait de tout caractère hors ``[0-9A-Fa-f]`` (espaces, ``:``, ``-``,
       retours chariot du mode clavier) ;
    2. passage en majuscules ;
    3. sortie décimale de 10 chiffres → conversion en hexadécimal sur 8
       caractères, zéro-paddée à gauche, signalée ``reader_mode='decimal'`` ;
    4. longueur finale acceptée : 8, 14 ou 20.

    Retourne ``None`` si la lecture ne respecte pas le contrat : l'appelant doit
    alors afficher une erreur explicite et ne rien mettre en file (PST-04 —
    on n'enregistre pas une lecture non conforme).
    """
    if not raw:
        return None

    cleaned = "".join(c for c in raw if c in _HEX_DIGITS).upper()
    if not cleaned:
        return None

    reader_mode = READER_MODE_HEX

    if len(cleaned) == DECIMAL_LENGTH and cleaned.isdigit():
        # Lecteur configuré en décimal : la spec §3.6 impose de le repasser en
        # hexadécimal. On accepte la lecture mais on signale le mode.
        cleaned = format(int(cleaned, 10), "X").zfill(8)
        reader_mode = READER_MODE_DECIMAL

    if len(cleaned) not in ACCEPTED_LENGTHS:
        return None

    return NormalizedUid(uid=cleaned, reader_mode=reader_mode)
