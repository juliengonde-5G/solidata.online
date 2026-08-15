"""Normalisation de l'UID — CONTRAT_HMAC §2."""

import pytest

from badgeuse_agent.normalize import (
    READER_MODE_DECIMAL,
    READER_MODE_HEX,
    normalize_uid,
)


@pytest.mark.parametrize(
    "raw",
    [
        "04A23B1C",
        "04 A2 3B 1C",
        "04:A2:3B:1C",
        "04-a2-3b-1c",
        "04a23b1c\r\n",
        "  04 a2 3B 1c  ",
    ],
)
def test_separateurs_et_casse_convergent(raw):
    """Séparateurs, casse et retours chariot du mode clavier sont absorbés."""
    result = normalize_uid(raw)
    assert result is not None
    assert result.uid == "04A23B1C"
    assert result.reader_mode == READER_MODE_HEX


def test_longueur_7_octets_acceptee():
    result = normalize_uid("04:a2:3b:1c:5d:6e:7f")
    assert result is not None
    assert result.uid == "04A23B1C5D6E7F"
    assert len(result.uid) == 14


def test_longueur_10_octets_acceptee():
    result = normalize_uid("04a23b1c5d6e7f8091a2")
    assert result is not None
    assert len(result.uid) == 20


def test_sortie_decimale_convertie_et_signalee():
    """Lecteur en décimal : conversion hex 8 + signalement (spec §3.6)."""
    result = normalize_uid("0123456789")
    assert result is not None
    assert result.uid == "075BCD15"
    assert result.reader_mode == READER_MODE_DECIMAL


def test_sortie_decimale_zero_paddee_a_gauche():
    result = normalize_uid("0000000255")
    assert result is not None
    assert result.uid == "000000FF"
    assert result.reader_mode == READER_MODE_DECIMAL


def test_hexa_de_8_chiffres_reste_en_hexa():
    """Un UID hex composé de chiffres n'est pas confondu avec du décimal."""
    result = normalize_uid("12345678")
    assert result is not None
    assert result.uid == "12345678"
    assert result.reader_mode == READER_MODE_HEX


def test_decimal_hors_capacite_4_octets_rejete():
    """9999999999 -> 9 caractères hex : hors longueurs du contrat, rejeté."""
    assert normalize_uid("9999999999") is None


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "   ",
        "ZZZZ",  # aucun caractère hexadécimal
        "04A2",  # 4 caractères
        "04A23B1C5D",  # 10 caractères hex, longueur non prévue
        "04A23B1C5D6E7F80",  # 16 caractères
    ],
)
def test_lectures_non_conformes_rejetees(raw):
    """Hors contrat -> None : rien n'est mis en file (PST-04)."""
    assert normalize_uid(raw) is None


def test_aucun_effet_de_bord_sur_l_entree():
    raw = "04 a2 3b 1c"
    normalize_uid(raw)
    assert raw == "04 a2 3b 1c"
