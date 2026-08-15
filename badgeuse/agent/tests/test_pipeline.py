"""Chaîne complète de traitement d'un badge, sans aucune dépendance externe.

Reproduit l'enchaînement de ``app.Agent._process`` en ne composant que des
modules purs :

    normalize -> hmac -> debounce -> cache badges -> sens -> chain -> store

Ce que ce test prouve, et que les tests unitaires ne prouvent pas : l'**ordre**
des étapes et les décisions de bout en bout (orphelin jamais silencieux,
lecture illisible jamais enregistrée, file qui ne se purge que sur accusé).
"""

import datetime as dt

import pytest

from badgeuse_agent.chain import canonical, chain_hash, genesis_hash
from badgeuse_agent.debounce import Debouncer
from badgeuse_agent.hmac_uid import hmac_uid
from badgeuse_agent.normalize import normalize_uid
from badgeuse_agent.sens import INCONNU, determine_sens
from badgeuse_agent.store import Store

DEVICE = "LH-P1"
CLE_SITE = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

BADGE_KARIM = "04 A2 3B 1C"
BADGE_INCONNU = "0B:1C:2D:3E"


class Horloge:
    def __init__(self, depart=1000.0):
        self.valeur = depart

    def __call__(self):
        return self.valeur

    def avancer(self, secondes):
        self.valeur += secondes


class Poste:
    """Assemblage minimal reproduisant la boucle de l'agent."""

    def __init__(self, store, horloge):
        self.store = store
        self.debouncer = Debouncer(window_sec=8.0, clock=horloge)
        self.affichages = []

    def presenter(self, lecture, maintenant):
        normalise = normalize_uid(lecture)
        if normalise is None:
            self.affichages.append(("badge_err", "badge_illisible"))
            return None  # aucun enregistrement (CONTRAT_HMAC §2.4)

        condensat = hmac_uid(CLE_SITE, normalise.uid)

        if not self.debouncer.accept(condensat):
            self.affichages.append(("badge_repeat", None))
            return None

        badge = self.store.find_badge(condensat)

        if badge is None:
            payload = self.store.enqueue_pointage(
                uid_hmac=condensat,
                horodatage_utc=maintenant,
                sens=INCONNU,
                salarie_id=None,
            )
            self.affichages.append(("badge_err", "badge_inconnu"))
            return payload

        evenements = self.store.events_for_salarie(
            badge["salarie_id"], reference_utc=maintenant
        )
        sens = determine_sens(evenements, maintenant)
        payload = self.store.enqueue_pointage(
            uid_hmac=condensat,
            horodatage_utc=maintenant,
            sens=sens,
            salarie_id=badge["salarie_id"],
        )
        self.affichages.append(("badge_ok", sens))
        return payload


@pytest.fixture()
def poste(tmp_path):
    horloge = Horloge()
    with Store(str(tmp_path), DEVICE) as store:
        store.replace_badges(
            [
                {
                    "uid_hmac": hmac_uid(CLE_SITE, "04A23B1C"),
                    "salarie_id": 42,
                    "prenom": "Karim",
                    "initiale_nom": "B",
                }
            ]
        )
        instance = Poste(store, horloge)
        instance.horloge = horloge
        yield instance


def utc(hour, minute=0, day=17):
    return dt.datetime(2026, 8, day, hour, minute, tzinfo=dt.timezone.utc)


def test_journee_type_d_un_salarie(poste):
    """Entrée, rebond ignoré, sortie, retour, sortie : 4 pointages en file."""
    poste.presenter(BADGE_KARIM, utc(6, 0))

    poste.horloge.avancer(3)  # carte represente aussitot
    poste.presenter(BADGE_KARIM, utc(6, 0))

    poste.horloge.avancer(20)
    poste.presenter(BADGE_KARIM, utc(11, 30))
    poste.horloge.avancer(20)
    poste.presenter(BADGE_KARIM, utc(12, 15))
    poste.horloge.avancer(20)
    poste.presenter(BADGE_KARIM, utc(15, 0))

    assert [a[0] for a in poste.affichages] == [
        "badge_ok", "badge_repeat", "badge_ok", "badge_ok", "badge_ok",
    ]
    assert [a[1] for a in poste.affichages if a[0] == "badge_ok"] == [
        "entree", "sortie", "entree", "sortie",
    ]
    assert poste.store.queue_size() == 4


def test_badge_inconnu_produit_un_orphelin_jamais_un_silence(poste):
    """PST-04 : le pointage part quand même, en sens ``inconnu``."""
    payload = poste.presenter(BADGE_INCONNU, utc(6, 0))

    assert payload is not None
    assert payload["sens"] == INCONNU
    assert poste.affichages == [("badge_err", "badge_inconnu")]
    assert poste.store.queue_size() == 1


def test_lecture_illisible_n_enregistre_rien(poste):
    assert poste.presenter("ZZZ", utc(6, 0)) is None
    assert poste.presenter("04A2", utc(6, 1)) is None
    assert poste.affichages == [
        ("badge_err", "badge_illisible"),
        ("badge_err", "badge_illisible"),
    ]
    assert poste.store.queue_size() == 0


def test_lecteur_en_decimal_reste_le_meme_salarie(poste):
    """Un lecteur bascule en décimal : le condensat doit rester identique."""
    poste.presenter(BADGE_KARIM, utc(6, 0))
    poste.horloge.avancer(20)
    poste.presenter("0077740828", utc(15, 0))  # 0x04A23B1C ecrit en decimal

    assert [a[1] for a in poste.affichages] == ["entree", "sortie"]


def test_chaine_integralement_verifiable_apres_une_journee(poste):
    """Rejeu de la chaîne : c'est ce que fera la vérification serveur."""
    for heure in (6, 11, 12, 15):
        poste.horloge.avancer(20)
        poste.presenter(BADGE_KARIM, utc(heure))

    precedent = genesis_hash(DEVICE)
    for pointage in poste.store.pending_batch():
        assert pointage["hash_precedent"] == precedent
        attendu = chain_hash(
            precedent, canonical({**pointage, "device_code": DEVICE})
        )
        assert pointage["hash_courant"] == attendu
        precedent = pointage["hash_courant"]


def test_alteration_d_un_pointage_casse_la_chaine(poste):
    """Une heure modifiée après coup ne recolle plus : la preuve tient."""
    poste.presenter(BADGE_KARIM, utc(6, 0))
    poste.horloge.avancer(20)
    poste.presenter(BADGE_KARIM, utc(15, 0))

    lot = poste.store.pending_batch()
    falsifie = dict(lot[0], horodatage_utc="2026-08-17T05:00:00.000Z")
    recalcule = chain_hash(
        genesis_hash(DEVICE), canonical({**falsifie, "device_code": DEVICE})
    )
    assert recalcule != falsifie["hash_courant"]
    assert lot[1]["hash_precedent"] != recalcule


def test_journee_hors_ligne_puis_reconnexion(poste):
    """Le poste pointe sans serveur, la file s'écoule ensuite intégralement."""
    for index, heure in enumerate((6, 11, 12, 15)):
        poste.horloge.avancer(20)
        poste.presenter(BADGE_KARIM, utc(heure))
    assert poste.store.queue_size() == 4

    lot = poste.store.pending_batch()
    reponse = [{"uuid": p["uuid"], "status": "ok"} for p in lot]
    assert poste.store.ack(reponse) == 4
    assert poste.store.queue_size() == 0


def test_serveur_muet_ne_purge_rien(poste):
    poste.presenter(BADGE_KARIM, utc(6, 0))
    poste.store.ack([])  # timeout, 503, 400 : aucun accusé
    assert poste.store.queue_size() == 1


def test_le_lendemain_repart_sur_une_entree(poste):
    poste.presenter(BADGE_KARIM, utc(6, 0, day=17))
    poste.horloge.avancer(20)
    poste.presenter(BADGE_KARIM, utc(15, 0, day=17))
    poste.horloge.avancer(20)
    poste.presenter(BADGE_KARIM, utc(6, 0, day=18))

    assert [a[1] for a in poste.affichages] == ["entree", "sortie", "entree"]


def test_deux_salaries_ne_se_melangent_pas(poste):
    autre = hmac_uid(CLE_SITE, "0B1C2D3E")
    poste.store.replace_badges(
        [
            {
                "uid_hmac": hmac_uid(CLE_SITE, "04A23B1C"),
                "salarie_id": 42,
                "prenom": "Karim",
                "initiale_nom": "B",
            },
            {"uid_hmac": autre, "salarie_id": 43, "prenom": "Awa", "initiale_nom": "D"},
        ]
    )

    poste.presenter(BADGE_KARIM, utc(6, 0))
    poste.horloge.avancer(1)
    poste.presenter(BADGE_INCONNU, utc(6, 1))  # premier pointage d'Awa

    assert [a[1] for a in poste.affichages] == ["entree", "entree"]

    poste.horloge.avancer(20)
    poste.presenter(BADGE_KARIM, utc(15, 0))
    assert poste.affichages[-1][1] == "sortie"
