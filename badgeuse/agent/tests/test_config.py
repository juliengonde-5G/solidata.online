"""Configuration — aucun secret n'a de valeur par défaut (SPEC §7.1)."""

import pytest

from badgeuse_agent.config import ConfigError, load

VALIDE = """
[server]
url = https://solidata.online
device_code = LH-P1
device_key = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

[site]
hmac_key = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f

[reader]
vendor_id = 0xffff
product_id = 0x0035

[system]
data_dir = /var/lib/badgeuse
target = pi5
"""


def ecrire(tmp_path, contenu, mode=0o600):
    chemin = tmp_path / "badgeuse.conf"
    chemin.write_text(contenu, encoding="utf-8")
    chemin.chmod(mode)
    return str(chemin)


def test_configuration_valide(tmp_path):
    config = load(ecrire(tmp_path, VALIDE))
    assert config.device_code == "LH-P1"
    assert config.target == "pi5"
    assert config.vendor_id == 0xFFFF
    assert config.product_id == 0x35
    assert config.warnings == []


def test_url_de_l_api_device(tmp_path):
    config = load(ecrire(tmp_path, VALIDE))
    assert config.api_base == "https://solidata.online/api/badgeuse/device/v1"
    assert config.device_url("pointages").endswith("/devices/LH-P1/pointages")


def test_fichier_absent(tmp_path):
    with pytest.raises(ConfigError, match="introuvable"):
        load(str(tmp_path / "inexistant.conf"))


@pytest.mark.parametrize(
    "section,option",
    [("server", "url"), ("server", "device_code"), ("server", "device_key")],
)
def test_cle_obligatoire_manquante(tmp_path, section, option):
    contenu = VALIDE.replace(f"{option} = ", f"#{option} = ")
    with pytest.raises(ConfigError, match=f"{section}.{option}"):
        load(ecrire(tmp_path, contenu))


def test_cle_de_site_manquante_bloque_le_demarrage(tmp_path):
    """Jamais de repli silencieux sur un secret : l'agent refuse de démarrer."""
    contenu = VALIDE.replace("hmac_key = ", "#hmac_key = ")
    with pytest.raises(ConfigError, match="site.hmac_key"):
        load(ecrire(tmp_path, contenu))


def test_section_site_absente(tmp_path):
    contenu = VALIDE.split("[site]")[0] + VALIDE.split("[reader]")[1]
    with pytest.raises(ConfigError):
        load(ecrire(tmp_path, contenu))


def test_cle_de_site_de_mauvaise_longueur(tmp_path):
    contenu = VALIDE.replace("000102030405060708090a0b0c0d0e0f" * 1, "00ff")
    with pytest.raises(ConfigError, match="hmac_key"):
        load(ecrire(tmp_path, contenu))


def test_cle_de_site_non_hexadecimale(tmp_path):
    contenu = VALIDE.replace(
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "z" * 64
    )
    with pytest.raises(ConfigError, match="hexadecimal"):
        load(ecrire(tmp_path, contenu))


def test_valeur_d_exemple_refusee(tmp_path):
    """Le fichier d'exemple ne doit jamais partir en production tel quel."""
    contenu = VALIDE.replace(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "CHANGE_ME_CLE_APPAREIL",
    )
    with pytest.raises(ConfigError, match="valeur d'exemple"):
        load(ecrire(tmp_path, contenu))


def test_http_en_clair_refuse(tmp_path):
    contenu = VALIDE.replace("https://solidata.online", "http://solidata.online")
    with pytest.raises(ConfigError, match="HTTPS"):
        load(ecrire(tmp_path, contenu))


def test_cible_inconnue_refusee(tmp_path):
    contenu = VALIDE.replace("target = pi5", "target = pi4")
    with pytest.raises(ConfigError, match="target"):
        load(ecrire(tmp_path, contenu))


def test_cible_pi3_acceptee(tmp_path):
    assert load(ecrire(tmp_path, VALIDE.replace("pi5", "pi3"))).target == "pi3"


def test_device_code_avec_separateur_canonique_refuse(tmp_path):
    contenu = VALIDE.replace("device_code = LH-P1", "device_code = LH|P1")
    with pytest.raises(ConfigError, match="'\\|'"):
        load(ecrire(tmp_path, contenu))


def test_lecteur_optionnel(tmp_path):
    contenu = VALIDE.split("[reader]")[0] + "[system]" + VALIDE.split("[system]")[1]
    config = load(ecrire(tmp_path, contenu))
    assert config.vendor_id is None
    assert config.product_id is None


def test_identifiant_usb_invalide(tmp_path):
    contenu = VALIDE.replace("vendor_id = 0xffff", "vendor_id = pas-un-id")
    with pytest.raises(ConfigError, match="vendor_id"):
        load(ecrire(tmp_path, contenu))


def test_permissions_trop_larges_signalees(tmp_path):
    config = load(ecrire(tmp_path, VALIDE, mode=0o644))
    assert any("0600" in avertissement for avertissement in config.warnings)


def test_vue_journalisable_sans_secret(tmp_path):
    config = load(ecrire(tmp_path, VALIDE))
    vue = repr(config.redacted())
    assert config.device_key not in vue
    assert config.hmac_key not in vue
    assert "<defini>" in vue


def test_tls_desactive_signale(tmp_path):
    contenu = VALIDE.replace("[site]", "verify_tls = false\n\n[site]")
    config = load(ecrire(tmp_path, contenu))
    assert config.verify_tls is False
    assert any("TLS" in avertissement for avertissement in config.warnings)
