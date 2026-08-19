"""Capture du lecteur RFID (PST-01) — sans matériel, avec un faux ``evdev``.

Ce module n'existait pas : ``reader.py`` était le seul composant du poste sans
aucun test, et c'est précisément là que s'est logé le défaut de terrain « le
lecteur est connecté, aucun badge n'arrive ». On teste donc ici ce que la
machine fait vraiment : quelle interface est saisie, ce qui est émis, et ce qui
n'est JAMAIS journalisé.

Rappel du matériel : un lecteur RFID en émulation clavier expose très souvent
**deux** ``/dev/input/eventN`` sous le même nom et les mêmes identifiants USB.
Une seule des deux émet les frappes. Choisir « la première qui correspond »
revient à jouer le badgeage à pile ou face.
"""

from __future__ import annotations

import asyncio
import logging

import pytest

from badgeuse_agent import reader as reader_mod
from badgeuse_agent.reader import BadgeReader, keyname_to_char

import faux_evdev
from faux_evdev import CONSUMER, FauxEvdev, FauxPeripherique

UID = "04A23B1C"


@pytest.fixture()
def evdev_factice(monkeypatch):
    """Installe le faux ``evdev`` dans le module ``reader``."""

    def installer(peripheriques):
        faux = FauxEvdev(peripheriques)
        monkeypatch.setattr(reader_mod, "evdev", faux)
        monkeypatch.setattr(reader_mod, "ecodes", faux_evdev.ecodes)
        monkeypatch.setattr(reader_mod, "EVDEV_AVAILABLE", True)
        return faux

    return installer


async def _capturer(lecteur: BadgeReader, action, delai: float = 1.0) -> None:
    """Lance la boucle du lecteur, exécute ``action``, puis arrête."""
    tache = asyncio.create_task(lecteur.run())
    await asyncio.sleep(0.05)          # ouverture + grab
    await action()
    fin = asyncio.get_event_loop().time() + delai
    while asyncio.get_event_loop().time() < fin:
        await asyncio.sleep(0.02)
    tache.cancel()
    try:
        await tache
    except asyncio.CancelledError:
        pass


class Collecteur:
    def __init__(self):
        self.uids = []
        self.etats = []

    async def on_uid(self, brut):
        self.uids.append(brut)

    async def on_state(self, connecte):
        self.etats.append(connecte)


# ------------------------------------------------------------------- pur


def test_keyname_to_char():
    assert keyname_to_char("KEY_4") == "4"
    assert keyname_to_char("KEY_A") == "A"
    assert keyname_to_char("KEY_KP7") == "7"
    assert keyname_to_char("KEY_ENTER") is None
    assert keyname_to_char("KEY_LEFTSHIFT") is None
    assert keyname_to_char("") is None
    assert keyname_to_char("BTN_LEFT") is None


# -------------------------------------------------------------- émission


def test_uid_emis_sur_entree(evdev_factice):
    lecteur_hid = FauxPeripherique("/dev/input/event0", "HCT USB Entry Keyboard")
    evdev_factice([lecteur_hid])
    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid, on_state=collecteur.on_state)

    async def action():
        lecteur_hid.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.3))

    assert collecteur.uids == [UID]
    assert collecteur.etats[0] is True
    assert lecteur_hid.grabs == 1        # EVIOCGRAB : accès exclusif


def test_uid_emis_apres_silence_sans_entree(evdev_factice, monkeypatch):
    """Lecteur sans « Entrée » finale : la saisie part au bout du délai."""
    monkeypatch.setattr(reader_mod, "FLUSH_TIMEOUT_SEC", 0.15)
    lecteur_hid = FauxPeripherique("/dev/input/event0", "lecteur")
    evdev_factice([lecteur_hid])
    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        lecteur_hid.saisir(UID, terminateur=None)

    asyncio.run(_capturer(lecteur, action, delai=0.6))
    assert collecteur.uids == [UID]


def test_touches_mortes_ignorees_sans_casser_la_saisie(evdev_factice):
    lecteur_hid = FauxPeripherique("/dev/input/event0", "lecteur")
    evdev_factice([lecteur_hid])
    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        lecteur_hid.frapper("KEY_LEFTSHIFT")
        lecteur_hid.saisir("04A2")
        # Complément : la saisie précédente s'est terminée sur « Entrée ».

    asyncio.run(_capturer(lecteur, action, delai=0.3))
    assert collecteur.uids == ["04A2"]


def test_flot_anormal_abandonne(evdev_factice, caplog, monkeypatch):
    """Un clavier fou ne doit jamais produire un pointage fantaisiste.

    Y compris sa QUEUE : après l'abandon du tampon, les caractères suivants
    étaient ré-accumulés et partaient au délai de silence comme s'il s'agissait
    d'une lecture normale. Tout est désormais jeté jusqu'au prochain
    terminateur.
    """
    caplog.set_level(logging.WARNING)
    monkeypatch.setattr(reader_mod, "FLUSH_TIMEOUT_SEC", 0.15)
    lecteur_hid = FauxPeripherique("/dev/input/event0", "lecteur")
    evdev_factice([lecteur_hid])
    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        lecteur_hid.saisir("1" * (reader_mod.MAX_BUFFER + 5), terminateur=None)

    asyncio.run(_capturer(lecteur, action, delai=0.6))
    assert collecteur.uids == []
    assert "tampon abandonne" in caplog.text


def test_apres_flot_anormal_la_saisie_suivante_repart(evdev_factice, monkeypatch):
    """L'abandon ne condamne pas le lecteur : le badge suivant passe."""
    monkeypatch.setattr(reader_mod, "FLUSH_TIMEOUT_SEC", 0.15)
    lecteur_hid = FauxPeripherique("/dev/input/event0", "lecteur")
    evdev_factice([lecteur_hid])
    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        lecteur_hid.saisir("1" * (reader_mod.MAX_BUFFER + 5))   # avec Entrée
        await asyncio.sleep(0.05)
        lecteur_hid.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.5))
    assert collecteur.uids == [UID]


# ----------------------------------------------- choix de l'interface (bug)


def test_deux_interfaces_memes_ids_usb_seule_la_seconde_emet(evdev_factice):
    """Défaut de terrain : le poste saisissait l'interface muette.

    Les deux ``eventN`` portent les MÊMES identifiants USB et le MÊME nom : le
    matériel ne permet pas de les distinguer. Le badgeage ne peut donc pas
    dépendre de l'ordre de ``list_devices()``.
    """
    muette = FauxPeripherique("/dev/input/event0", "HCT USB Entry Keyboard", muet=True)
    vivante = FauxPeripherique("/dev/input/event1", "HCT USB Entry Keyboard")
    evdev_factice([muette, vivante])

    collecteur = Collecteur()
    lecteur = BadgeReader(
        on_uid=collecteur.on_uid, vendor_id=0xFFFF, product_id=0x0035
    )

    async def action():
        vivante.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.3))
    assert collecteur.uids == [UID]


def test_deux_interfaces_filtre_par_nom(evdev_factice):
    muette = FauxPeripherique("/dev/input/event0", "HCT USB Entry Keyboard", muet=True)
    vivante = FauxPeripherique("/dev/input/event1", "HCT USB Entry Keyboard")
    evdev_factice([muette, vivante])

    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid, name_hint="hct")

    async def action():
        vivante.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.3))
    assert collecteur.uids == [UID]


def test_deux_interfaces_detection_par_capacites(evdev_factice):
    """Sans aucun filtre configuré : c'est le cas nominal du terrain."""
    muette = FauxPeripherique("/dev/input/event0", "HCT USB Entry Keyboard", muet=True)
    vivante = FauxPeripherique("/dev/input/event1", "HCT USB Entry Keyboard")
    evdev_factice([muette, vivante])

    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        vivante.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.3))
    assert collecteur.uids == [UID]


def test_interface_sans_chiffres_jamais_saisie(evdev_factice):
    """Une interface « consumer control » ne compose aucun UID : on l'écarte."""
    consumer = FauxPeripherique(
        "/dev/input/event0", "HCT USB Entry Keyboard", capacites=CONSUMER, muet=True
    )
    clavier = FauxPeripherique("/dev/input/event1", "HCT USB Entry Keyboard")
    evdev_factice([consumer, clavier])

    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        clavier.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.3))
    assert collecteur.uids == [UID]
    assert consumer.grabbed is False       # jamais saisie, donc jamais bloquée


def test_saisies_entrelacees_de_deux_interfaces_non_melangees(evdev_factice):
    """Deux interfaces qui parlent : chaque UID reste entier."""
    une = FauxPeripherique("/dev/input/event0", "lecteur")
    deux = FauxPeripherique("/dev/input/event1", "lecteur")
    evdev_factice([une, deux])

    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        une.frapper("KEY_0")
        deux.frapper("KEY_1")
        une.frapper("KEY_4")
        deux.frapper("KEY_2")
        une.frapper("KEY_A")
        deux.frapper("KEY_3")
        une.frapper("KEY_2")
        deux.frapper("KEY_4")
        for peripherique in (une, deux):
            peripherique.frapper("KEY_ENTER")

    asyncio.run(_capturer(lecteur, action, delai=0.3))
    assert sorted(collecteur.uids) == ["04A2", "1234"]


def test_aucun_lecteur_ne_tue_pas_la_boucle(evdev_factice, caplog):
    caplog.set_level(logging.WARNING)
    evdev_factice([])
    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid, on_state=collecteur.on_state)

    async def action():
        return None

    asyncio.run(_capturer(lecteur, action, delai=0.2))
    assert collecteur.uids == []
    assert "lecteur indisponible" in caplog.text
    assert True not in collecteur.etats


# ------------------------------------------------------------ confidentialité


def test_uid_jamais_journalise(evdev_factice, caplog):
    caplog.set_level(logging.DEBUG)
    lecteur_hid = FauxPeripherique("/dev/input/event0", "lecteur")
    evdev_factice([lecteur_hid])
    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        lecteur_hid.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.3))
    assert collecteur.uids == [UID]
    for fragment in (UID, UID.lower(), "04A2", "A23B"):
        assert fragment not in caplog.text


def test_interface_illisible_signalee(evdev_factice, caplog):
    """Un droit manquant ne doit plus disparaitre dans un `continue` muet."""
    caplog.set_level(logging.WARNING)
    interdite = FauxPeripherique("/dev/input/event0", "lecteur", illisible=True)
    lisible = FauxPeripherique("/dev/input/event1", "lecteur")
    evdev_factice([interdite, lisible])

    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        lisible.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.3))

    assert collecteur.uids == [UID]        # l'autre interface fonctionne
    assert "/dev/input/event0" in caplog.text
    assert "groupe" in caplog.text         # la correction est nommée


# ------------------------------------------------------------- inventaire


def test_inventaire_decrit_les_interfaces_et_le_verdict(evdev_factice):
    """``--lecteurs`` : le terrain doit VOIR ce que l'agent saisit."""
    consumer = FauxPeripherique(
        "/dev/input/event0", "HCT USB Entry Keyboard", capacites=CONSUMER
    )
    clavier = FauxPeripherique("/dev/input/event1", "HCT USB Entry Keyboard")
    evdev_factice([consumer, clavier])

    lignes = reader_mod.inventaire()
    par_chemin = {ligne["path"]: ligne for ligne in lignes}

    assert par_chemin["/dev/input/event0"]["clavier"] is False
    assert par_chemin["/dev/input/event0"]["retenu"] is False
    assert "aucun UID" in par_chemin["/dev/input/event0"]["motif"]
    assert par_chemin["/dev/input/event1"]["retenu"] is True
    assert par_chemin["/dev/input/event1"]["vendor_id"] == "0xffff"


def test_inventaire_ne_lit_aucune_frappe(evdev_factice):
    """L'inventaire ne peut pas divulguer un UID : il ne lit rien."""
    clavier = FauxPeripherique("/dev/input/event0", "lecteur")
    evdev_factice([clavier])
    clavier.saisir(UID)                    # frappes en attente dans la file

    reader_mod.inventaire()

    assert clavier.grabbed is False        # jamais saisi non plus


def test_tampon_vide_apres_emission(evdev_factice):
    """L'UID brut ne survit pas à l'appel (discipline de confidentialité)."""
    lecteur_hid = FauxPeripherique("/dev/input/event0", "lecteur")
    evdev_factice([lecteur_hid])
    collecteur = Collecteur()
    lecteur = BadgeReader(on_uid=collecteur.on_uid)

    async def action():
        lecteur_hid.saisir(UID)

    asyncio.run(_capturer(lecteur, action, delai=0.3))
    assert collecteur.uids == [UID]
    assert lecteur.tampons_vides()
