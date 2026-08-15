"""Chaîne d'intégrité — vecteurs du CONTRAT_INTEGRITE §2-3 / CONTRAT_HMAC §4."""

import datetime as dt

import pytest

from badgeuse_agent.chain import (
    canonical,
    chain_hash,
    genesis_hash,
    parse_utc_iso,
    utc_iso_ms,
)

DEVICE = "LH-P1"
GENESIS_ATTENDU = "07b7f5a016835efbc0fc3d021acfbae7a1e74f063531d133e2bab27b8207b1ab"
UID_HMAC = "6af79677ac212277ce9caf53668e1561c75c43aaba28c6588da17c55915551d8"
CANONICAL_ATTENDU = (
    "11111111-2222-4333-8444-555555555555|LH-P1|1|"
    f"{UID_HMAC}|2026-08-17T06:58:12.031Z|entree|badge"
)
HASH_ATTENDU = "07914d17bc6248178da6c6e859fc48b8d7dfa4d04e0b61f5a081ad4d3c8ff3ed"

POINTAGE = {
    "uuid": "11111111-2222-4333-8444-555555555555",
    "device_code": DEVICE,
    "sequence_device": 1,
    "uid_hmac": UID_HMAC,
    "horodatage_utc": "2026-08-17T06:58:12.031Z",
    "sens": "entree",
    "source": "badge",
}


def test_genesis_du_contrat():
    assert genesis_hash(DEVICE) == GENESIS_ATTENDU


def test_charge_utile_canonique_du_contrat():
    assert canonical(POINTAGE) == CANONICAL_ATTENDU


def test_hash_courant_du_contrat():
    assert chain_hash(genesis_hash(DEVICE), canonical(POINTAGE)) == HASH_ATTENDU


def test_concatenation_de_chaines_et_non_d_octets():
    """Le contrat concatène le hash sous sa forme hexadécimale, pas ses octets."""
    import hashlib

    variante_octets = hashlib.sha256(
        bytes.fromhex(GENESIS_ATTENDU) + CANONICAL_ATTENDU.encode()
    ).hexdigest()
    assert variante_octets != HASH_ATTENDU
    assert chain_hash(GENESIS_ATTENDU, CANONICAL_ATTENDU) == HASH_ATTENDU


def test_ordre_des_champs_fige():
    """Permuter deux champs change la charge utile : l'ordre est contractuel."""
    permute = dict(POINTAGE)
    permute["sens"], permute["source"] = "badge", "entree"
    with pytest.raises(ValueError):
        canonical(permute)


def test_sequence_sans_zeros_de_tete():
    payload = dict(POINTAGE, sequence_device="0042")
    assert "|42|" in canonical(payload)


def test_pointage_manuel_sans_badge():
    payload = dict(POINTAGE, uid_hmac="-", source="manuel")
    assert canonical(payload).split("|")[3] == "-"


@pytest.mark.parametrize("sens", ["entree", "sortie", "inconnu"])
def test_sens_du_contrat_acceptes(sens):
    assert canonical(dict(POINTAGE, sens=sens))


@pytest.mark.parametrize("valeur", ["entrée", "IN", "", "entree "])
def test_sens_hors_contrat_refuse(valeur):
    with pytest.raises(ValueError):
        canonical(dict(POINTAGE, sens=valeur))


@pytest.mark.parametrize("valeur", ["badge", "manuel", "import"])
def test_sources_du_contrat_acceptees(valeur):
    assert canonical(dict(POINTAGE, source=valeur))


def test_source_hors_contrat_refusee():
    with pytest.raises(ValueError):
        canonical(dict(POINTAGE, source="rfid"))


def test_champ_manquant_refuse():
    incomplet = {k: v for k, v in POINTAGE.items() if k != "uid_hmac"}
    with pytest.raises(ValueError):
        canonical(incomplet)


def test_separateur_interdit_dans_un_champ():
    with pytest.raises(ValueError):
        canonical(dict(POINTAGE, device_code="LH|P1"))


def test_sequence_doit_etre_positive():
    with pytest.raises(ValueError):
        canonical(dict(POINTAGE, sequence_device=0))


def test_alteration_d_un_horodatage_change_le_hash():
    """Modifier une heure a posteriori est détectable (exigence A4/A5)."""
    altere = dict(POINTAGE, horodatage_utc="2026-08-17T06:58:12.032Z")
    assert chain_hash(genesis_hash(DEVICE), canonical(altere)) != HASH_ATTENDU


def test_chainage_de_deux_pointages():
    premier = chain_hash(genesis_hash(DEVICE), canonical(POINTAGE))
    second_payload = dict(
        POINTAGE,
        uuid="22222222-2222-4333-8444-555555555555",
        sequence_device=2,
        sens="sortie",
        horodatage_utc="2026-08-17T15:02:00.000Z",
    )
    second = chain_hash(premier, canonical(second_payload))
    assert second != premier
    assert len(second) == 64


def test_hash_precedent_invalide_refuse():
    with pytest.raises(ValueError):
        chain_hash("trop-court", CANONICAL_ATTENDU)


def test_format_horodatage_millisecondes():
    moment = dt.datetime(2026, 8, 17, 6, 58, 12, 31000, tzinfo=dt.timezone.utc)
    assert utc_iso_ms(moment) == "2026-08-17T06:58:12.031Z"


def test_format_horodatage_depuis_un_fuseau_local():
    from zoneinfo import ZoneInfo

    paris = dt.datetime(2026, 8, 17, 8, 58, 12, 31000, tzinfo=ZoneInfo("Europe/Paris"))
    assert utc_iso_ms(paris) == "2026-08-17T06:58:12.031Z"


def test_relecture_horodatage():
    assert parse_utc_iso("2026-08-17T06:58:12.031Z") == dt.datetime(
        2026, 8, 17, 6, 58, 12, 31000, tzinfo=dt.timezone.utc
    )
    assert parse_utc_iso("2026-08-17T06:58:12Z").second == 12
