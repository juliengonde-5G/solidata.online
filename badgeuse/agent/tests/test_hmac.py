"""Pseudonymisation — vecteur de test PARTAGÉ du CONTRAT_HMAC §4.

Ce vecteur fige le contrat entre les deux piles : le test Node
``backend/tests/unit/utils/badgeuse-crypto.test.js`` doit produire exactement le
même condensat. Toute modification ici est une rupture de contrat.
"""

import pytest

from badgeuse_agent.hmac_uid import hmac_uid, is_valid_uid_hmac, short
from badgeuse_agent.normalize import normalize_uid

CLE_SITE = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
UID_LU = "04 A2 3B 1C"
UID_NORMALISE = "04A23B1C"
UID_HMAC_ATTENDU = "6af79677ac212277ce9caf53668e1561c75c43aaba28c6588da17c55915551d8"


def test_vecteur_partage_du_contrat():
    """Le vecteur de référence, de la lecture brute au condensat."""
    normalise = normalize_uid(UID_LU)
    assert normalise is not None
    assert normalise.uid == UID_NORMALISE
    assert hmac_uid(CLE_SITE, normalise.uid) == UID_HMAC_ATTENDU


def test_condensat_hex_minuscule_64():
    condensat = hmac_uid(CLE_SITE, UID_NORMALISE)
    assert len(condensat) == 64
    assert condensat == condensat.lower()
    assert is_valid_uid_hmac(condensat)


def test_cle_decodee_hex_vers_octets():
    """Point de contrat : la clé est décodée, le message reste en ASCII.

    Si l'on hachait la clé comme du texte, le condensat différerait — ce test
    interdit cette erreur d'implémentation.
    """
    import hashlib
    import hmac as stdlib_hmac

    faux = stdlib_hmac.new(
        CLE_SITE.encode("ascii"), UID_NORMALISE.encode("ascii"), hashlib.sha256
    ).hexdigest()
    assert faux != UID_HMAC_ATTENDU
    assert hmac_uid(CLE_SITE, UID_NORMALISE) == UID_HMAC_ATTENDU


def test_deux_uid_distincts_donnent_deux_condensats():
    assert hmac_uid(CLE_SITE, "04A23B1C") != hmac_uid(CLE_SITE, "04A23B1D")


def test_meme_uid_cles_differentes_donnent_des_condensats_differents():
    autre_cle = "ff" * 32
    assert hmac_uid(CLE_SITE, UID_NORMALISE) != hmac_uid(autre_cle, UID_NORMALISE)


def test_determinisme():
    assert hmac_uid(CLE_SITE, UID_NORMALISE) == hmac_uid(CLE_SITE, UID_NORMALISE)


@pytest.mark.parametrize(
    "cle",
    [
        "",
        "abcd",  # trop courte
        "zz" * 32,  # non hexadécimale
        "00" * 31,  # 248 bits
    ],
)
def test_cle_invalide_refusee(cle):
    with pytest.raises(ValueError):
        hmac_uid(cle, UID_NORMALISE)


def test_uid_vide_refuse():
    with pytest.raises(ValueError):
        hmac_uid(CLE_SITE, "")


def test_message_d_erreur_ne_contient_jamais_la_cle():
    """Une exception ne doit pas faire fuiter le secret dans les journaux."""
    try:
        hmac_uid("zz" * 32, UID_NORMALISE)
    except ValueError as exc:
        assert "zz" not in str(exc)
    else:  # pragma: no cover
        pytest.fail("ValueError attendue")


def test_troncature_des_journaux_bornee_a_12():
    condensat = hmac_uid(CLE_SITE, UID_NORMALISE)
    assert short(condensat) == condensat[:12]
    assert len(short(condensat, 64)) == 12  # plafond dur
