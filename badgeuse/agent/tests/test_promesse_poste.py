"""La PROMESSE du poste, de bout en bout, sans matériel.

Ces tests ne recomposent pas des modules purs à la main (c'est le rôle de
``test_pipeline.py``) : ils font tourner **l'agent réel** (``app.Agent``), avec
sa vraie base SQLite, son vrai canal WebSocket et son vrai client HTTP, face à
un faux serveur qui applique le CONTRAT_API_DEVICE. C'est le seul niveau où se
voient les défauts que 400 tests unitaires ne voyaient pas : un badge qui
n'affiche rien, une file qui se purge à tort, une chaîne qui repart de zéro.

Le lecteur physique est remplacé par l'injection d'un UID dans ``_on_uid`` —
exactement ce que fait ``BadgeReader`` quand une carte est présentée.

Aucune dépendance de test supplémentaire : les coroutines sont lancées par
``asyncio.run`` (pas de pytest-asyncio). ``httpx`` et ``websockets`` sont
celles du poste ; absentes, le module est ignoré et la suite reste exécutable
sur une machine nue.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import json
import logging
import socket

import pytest

pytest.importorskip("httpx", reason="client HTTP du poste absent")
pytest.importorskip("websockets", reason="canal UI du poste absent")

import websockets  # noqa: E402

from badgeuse_agent import chain as chain_mod  # noqa: E402
from badgeuse_agent.app import Agent  # noqa: E402
from badgeuse_agent.config import Config  # noqa: E402
from badgeuse_agent.debounce import Debouncer  # noqa: E402
from badgeuse_agent.hmac_uid import hmac_uid  # noqa: E402
from badgeuse_agent.store import Store, StoreError  # noqa: E402

from faux_serveur import FauxServeur  # noqa: E402

CLE_SITE = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
CLE_POSTE = "k" * 64
POSTE = "LH-P1"

UID_KARIM = "04A23B1C"
UID_INCONNU = "0B1C2D3E"


def _port_libre() -> int:
    with socket.socket() as prise:
        prise.bind(("127.0.0.1", 0))
        return int(prise.getsockname()[1])


class Horloge:
    """Horloge monotone pilotée (anti-rebond)."""

    def __init__(self, depart: float = 1000.0) -> None:
        self.valeur = depart

    def __call__(self) -> float:
        return self.valeur

    def avancer(self, secondes: float) -> None:
        self.valeur += secondes


class Poste:
    """Agent réel + canal UI réel, démarrés et arrêtés ensemble."""

    def __init__(self, dossier, serveur: FauxServeur) -> None:
        self.serveur = serveur
        self.ws_port = _port_libre()
        self.config = Config(
            server_url=serveur.url,
            device_code=POSTE,
            device_key=CLE_POSTE,
            hmac_key=CLE_SITE,
            data_dir=str(dossier),
            target="pi5",
            ws_port=self.ws_port,
            http_port=_port_libre(),
        )
        self.agent = Agent(self.config)
        self.horloge = Horloge()
        # Horloge injectée, mais fenêtre d'anti-rebond RÉELLE : la figer à 8 s
        # ici laissait passer des scénarios que le poste de production refuse
        # (deux badgeages à 60 s d'intervalle), et masquait donc le défaut même
        # que ces tests doivent surveiller.
        self.agent._debouncer = Debouncer(clock=self.horloge)
        self.tache = None
        self.ui = None
        self.messages = []

    async def demarrer(self) -> None:
        self.tache = asyncio.create_task(self.agent.run())
        for _ in range(200):                      # attente de l'écoute WS
            try:
                self.ui = await websockets.connect(
                    "ws://127.0.0.1:%d" % self.ws_port, open_timeout=2
                )
                break
            except (OSError, asyncio.TimeoutError):
                await asyncio.sleep(0.02)
        assert self.ui is not None, "le canal UI n'a jamais ouvert"
        self._collecteur = asyncio.create_task(self._collecter())
        await asyncio.sleep(0.1)
        await self.agent._refresh_badges()        # cache badges, voie réelle

    async def _collecter(self) -> None:
        try:
            async for brut in self.ui:
                self.messages.append(json.loads(brut))
        except Exception:  # noqa: BLE001 - fermeture de fin de test
            pass

    async def arreter(self) -> None:
        self.agent.stop()
        if self.tache is not None:
            await asyncio.wait_for(self.tache, timeout=15)
        if self.ui is not None:
            await self.ui.close()

    # ------------------------------------------------------------ scénarios

    async def badger(self, uid: str) -> None:
        """Présente un badge, comme le fait le lecteur."""
        await self.agent._on_uid(uid)
        await asyncio.sleep(0.05)

    def recus(self, type_message: str) -> list:
        return [m for m in self.messages if m.get("type") == type_message]

    async def pousser(self) -> int:
        """Force un cycle d'envoi de la file (le vrai code de ``sync``)."""
        return await self.agent._syncer.push_queue()


@pytest.fixture()
def serveur():
    srv = FauxServeur(device_code=POSTE, device_key=CLE_POSTE)
    srv.demarrer()
    srv.badges = [
        {
            "uid_hmac": hmac_uid(CLE_SITE, UID_KARIM),
            "salarie_id": 42,
            "prenom": "Karim",
            "initiale_nom": "B",
        }
    ]
    yield srv
    srv.arreter()


def scenario(fonction):
    """Exécute une coroutine de scénario avec un poste démarré puis arrêté."""

    async def executer(dossier, serveur, *args):
        poste = Poste(dossier, serveur)
        await poste.demarrer()
        try:
            await fonction(poste, *args)
        finally:
            await poste.arreter()

    return executer


# --------------------------------------------------------------------- badge


def test_journee_operateur_entree_pause_retour_soir(tmp_path, serveur, caplog):
    """Matin, pause, retour, soir : quatre badgeages, sens alternés."""
    caplog.set_level(logging.INFO)

    @scenario
    async def corps(poste):
        for _ in range(4):
            await poste.badger(UID_KARIM)
            poste.horloge.avancer(3600)        # matin → pause → retour → soir

        sens = [m["sens"] for m in poste.recus("badge_ok")]
        assert sens == ["entree", "sortie", "entree", "sortie"]

        # L'écran ne reçoit que prénom + initiale (ADR-0004 §1).
        premier = poste.recus("badge_ok")[0]
        assert premier["prenom"] == "Karim"
        assert premier["initiale"] == "B"
        assert 3 <= premier["overlay_duree_sec"] <= 8
        assert "nom" not in premier and "salarie_id" not in premier
        assert premier["message"]              # jamais d'écran muet

        assert poste.agent._store.queue_size() == 4

    asyncio.run(corps(tmp_path, serveur))
    assert "pointage entree enregistre" in caplog.text


def test_badge_inconnu_orphelin_en_file_et_transmis(tmp_path, serveur, caplog):
    """PST-04 : jamais de rejet silencieux — l'orphelin part quand même."""
    caplog.set_level(logging.INFO)

    @scenario
    async def corps(poste):
        await poste.badger(UID_INCONNU)

        erreurs = poste.recus("badge_err")
        assert erreurs and erreurs[-1]["raison"] == "badge_inconnu"
        assert poste.agent._store.queue_size() == 1

        await poste.pousser()
        envoyes = poste.serveur.lots[-1]
        assert len(envoyes) == 1
        assert envoyes[0]["sens"] == "inconnu"
        assert envoyes[0]["uid_hmac"] == hmac_uid(CLE_SITE, UID_INCONNU)
        assert poste.agent._store.queue_size() == 0

    asyncio.run(corps(tmp_path, serveur))
    assert "badge inconnu du cache" in caplog.text


def test_lecture_non_conforme_rien_en_file(tmp_path, serveur, caplog):
    caplog.set_level(logging.INFO)

    @scenario
    async def corps(poste):
        await poste.badger("XYZ")              # ni hex, ni longueur du contrat
        assert poste.agent._store.queue_size() == 0
        assert poste.recus("badge_err")[-1]["raison"] == "badge_illisible"

    asyncio.run(corps(tmp_path, serveur))
    assert "non conforme" in caplog.text


def test_anti_rebond(tmp_path, serveur, caplog):
    caplog.set_level(logging.INFO)

    @scenario
    async def corps(poste):
        await poste.badger(UID_KARIM)
        poste.horloge.avancer(2)               # dans la fenêtre
        await poste.badger(UID_KARIM)

        assert poste.agent._store.queue_size() == 1
        assert poste.recus("badge_repeat")
        assert poste.recus("badge_repeat")[-1]["prenom"] == "Karim"

    asyncio.run(corps(tmp_path, serveur))
    assert "anti-rebond" in caplog.text


def test_representation_apres_une_demi_minute_annoncee_a_l_ecran(tmp_path, serveur):
    """Le défaut remonté par l'exploitation : « rebadger ne dit rien ».

    Avec l'ancienne fenêtre de 8 s, une présentation 30 s plus tard était
    ACCEPTÉE : aucun message, mais un second pointage bien réel. La personne
    croyait s'être trompée, et sa journée se refermait sur une paire de 30 s.
    Désormais elle est refusée ET annoncée.
    """
    @scenario
    async def corps(poste):
        await poste.badger(UID_KARIM)
        poste.horloge.avancer(30)
        await poste.badger(UID_KARIM)

        assert poste.agent._store.queue_size() == 1        # un seul pointage
        repeat = poste.recus("badge_repeat")
        assert len(repeat) == 1                            # et un message, pas le silence
        assert repeat[-1]["prenom"] == "Karim"

    asyncio.run(corps(tmp_path, serveur))


def test_le_message_de_rebond_dit_depuis_combien_de_temps(tmp_path, serveur):
    """« Déjà enregistré » sans repère est inexploitable sur 5 minutes.

    L'écran a besoin d'une DURÉE pour écrire « il y a 3 minutes ». C'est une
    durée, jamais un horodatage : la charge utile reste au prénom + initiale.
    """
    @scenario
    async def corps(poste):
        await poste.badger(UID_KARIM)
        poste.horloge.avancer(185)
        await poste.badger(UID_KARIM)

        message = poste.recus("badge_repeat")[-1]
        assert message["depuis_sec"] == 185
        # Rien d'autre que le prénom ne doit transiter (NOTE_JURIDIQUE §3.5).
        assert set(message) == {"type", "prenom", "depuis_sec", "overlay_duree_sec"}
        assert "nom" not in message and "uid" not in message and "uid_hmac" not in message

    asyncio.run(corps(tmp_path, serveur))


def test_fenetre_de_cinq_minutes_appliquee_quand_le_serveur_la_pousse(tmp_path, serveur):
    """ADR-0002 de bout en bout : la valeur vient de GET /config et AGIT."""
    @scenario
    async def corps(poste):
        poste.serveur.config = {"anti_rebond_sec": 300}
        await poste.agent._heartbeat_once()
        assert poste.agent._debouncer.window_sec == 300.0

        await poste.badger(UID_KARIM)
        poste.horloge.avancer(120)                   # 2 min : dans la fenêtre
        await poste.badger(UID_KARIM)
        assert poste.agent._store.queue_size() == 1
        assert poste.recus("badge_repeat")[-1]["depuis_sec"] == 120

        poste.horloge.avancer(200)                   # 320 s : fenêtre écoulée
        await poste.badger(UID_KARIM)
        assert poste.agent._store.queue_size() == 2  # ce passage-là compte

    asyncio.run(corps(tmp_path, serveur))


def test_uid_brut_et_secrets_jamais_dans_les_journaux(tmp_path, serveur, caplog):
    caplog.set_level(logging.DEBUG)

    @scenario
    async def corps(poste):
        await poste.badger(UID_KARIM)
        await poste.pousser()
        await poste.agent._heartbeat_once()

    asyncio.run(corps(tmp_path, serveur))
    assert UID_KARIM not in caplog.text
    assert UID_KARIM.lower() not in caplog.text
    assert CLE_POSTE not in caplog.text
    assert CLE_SITE not in caplog.text


# ------------------------------------------------------------------ réseau


def test_hors_ligne_prolonge_puis_rattrapage(tmp_path, serveur):
    """La file se conserve hors ligne, part intégralement au retour."""

    @scenario
    async def corps(poste):
        poste.serveur.statut_http["pointages"] = 503

        for _ in range(3):
            await poste.badger(UID_KARIM)
            poste.horloge.avancer(3600)        # trois passages d'une vraie journée
        await poste.pousser()
        assert poste.agent._store.queue_size() == 3

        poste.serveur.statut_http.clear()
        poste.agent._syncer._next_attempt = 0.0    # fin du backoff
        accuses = await poste.pousser()

        assert accuses == 3
        assert poste.agent._store.queue_size() == 0
        assert poste.serveur.sequences_recues() == [1, 2, 3]

        # Chaîne continue : chaque hash_precedent est le hash_courant du
        # pointage précédent, à partir de la genèse du poste.
        envoyes = [p for lot in poste.serveur.lots for p in lot]
        precedent = chain_mod.genesis_hash(POSTE)
        for pointage in envoyes:
            assert pointage["hash_precedent"] == precedent
            precedent = pointage["hash_courant"]

    asyncio.run(corps(tmp_path, serveur))


def test_erreur_500_ne_perd_rien(tmp_path, serveur):
    @scenario
    async def corps(poste):
        await poste.badger(UID_KARIM)
        poste.serveur.statut_http["pointages"] = 500
        await poste.pousser()
        assert poste.agent._store.queue_size() == 1

    asyncio.run(corps(tmp_path, serveur))


def test_retry_arrete_le_lot_et_ne_purge_pas(tmp_path, serveur, caplog):
    """v1.2 : ``retry`` n'est pas un accusé — la file reste intacte."""
    caplog.set_level(logging.INFO)

    @scenario
    async def corps(poste):
        poste.serveur.politique = lambda p: {"uuid": p["uuid"], "status": "retry"}

        for _ in range(2):
            await poste.badger(UID_KARIM)
            poste.horloge.avancer(3600)        # deux passages distincts
        accuses = await poste.pousser()

        assert accuses == 0
        assert poste.agent._store.queue_size() == 2
        assert poste.agent._syncer.last_alert is None   # QA-14 : pas d'alerte

        poste.serveur.politique = lambda p: {"uuid": p["uuid"], "status": "ok"}
        assert await poste.pousser() == 2
        assert poste.agent._store.queue_size() == 0

    asyncio.run(corps(tmp_path, serveur))
    assert "differe" in caplog.text


def test_invalid_purge_compte_et_alerte(tmp_path, serveur):
    @scenario
    async def corps(poste):
        poste.serveur.politique = lambda p: {"uuid": p["uuid"], "status": "invalid"}
        await poste.badger(UID_KARIM)
        await poste.pousser()

        assert poste.agent._store.queue_size() == 0
        assert poste.agent._store.invalid_count() == 1
        assert poste.agent._syncer.last_alert is not None

    asyncio.run(corps(tmp_path, serveur))


def test_statut_inconnu_conserve_la_file(tmp_path, serveur):
    @scenario
    async def corps(poste):
        poste.serveur.politique = lambda p: {"uuid": p["uuid"], "status": "soleil"}
        await poste.badger(UID_KARIM)
        await poste.pousser()
        assert poste.agent._store.queue_size() == 1

    asyncio.run(corps(tmp_path, serveur))


def test_cle_du_poste_transmise_a_chaque_appel(tmp_path, serveur):
    @scenario
    async def corps(poste):
        await poste.agent._heartbeat_once()
        assert poste.serveur.heartbeats
        assert poste.serveur.cles_vues
        assert set(poste.serveur.cles_vues) == {CLE_POSTE}

    asyncio.run(corps(tmp_path, serveur))


# ------------------------------------------------------ paramétrage serveur


def test_overlay_replafonne_a_huit_secondes(tmp_path, serveur):
    """Verrou juridique : quoi qu'annonce le serveur, 8 s maximum (AFF-01)."""
    @scenario
    async def corps(poste):
        poste.serveur.config = {"overlay_duree_sec": 30}
        await poste.agent._heartbeat_once()          # récupère la config
        await poste.badger(UID_KARIM)
        assert poste.recus("badge_ok")[-1]["overlay_duree_sec"] == 8

    asyncio.run(corps(tmp_path, serveur))


def test_anti_rebond_pilote_par_le_serveur(tmp_path, serveur):
    """ADR-0002 : la règle vient du serveur, rien n'est codé en dur."""
    @scenario
    async def corps(poste):
        poste.serveur.config = {"anti_rebond_sec": 2}
        await poste.agent._heartbeat_once()
        assert poste.agent._debouncer.window_sec == 2.0

        await poste.badger(UID_KARIM)
        poste.horloge.avancer(3)                     # au-delà des 2 s
        await poste.badger(UID_KARIM)
        assert poste.agent._store.queue_size() == 2

    asyncio.run(corps(tmp_path, serveur))


def test_cumul_hebdomadaire_desactive_par_defaut(tmp_path, serveur):
    """AFF-02 : rien ne s'affiche tant que le serveur ne l'a pas activé."""
    @scenario
    async def corps(poste):
        await poste.badger(UID_KARIM)
        assert poste.recus("badge_ok")[-1]["cumul_hebdo"] is None

    asyncio.run(corps(tmp_path, serveur))


# ---------------------------------------------------------- interface locale


def test_interface_servie_sur_la_boucle_locale(tmp_path, serveur):
    """Ce que le kiosque affiche vient de l'agent, en local, sans réseau."""
    import httpx

    @scenario
    async def corps(poste):
        base = "http://127.0.0.1:%d" % poste.config.http_port
        async with httpx.AsyncClient(timeout=5) as client:
            page = await client.get(base + "/")
            assert page.status_code == 200
            assert "Présentez votre badge" in page.text
            assert page.headers["X-Content-Type-Options"] == "nosniff"

            # Ni listage de répertoire, ni traversée, ni média inventé.
            assert (await client.get(base + "/media/")).status_code == 404
            assert (await client.get(base + "/media/inconnu")).status_code == 404
            fuite = await client.get(base + "/media/..%2f..%2fetc%2fpasswd")
            assert fuite.status_code == 404

    asyncio.run(corps(tmp_path, serveur))


def test_aucune_ecoute_hors_boucle_locale(tmp_path, serveur):
    """SPEC §7.1 : aucune écoute réseau entrante, ni HTTP ni WebSocket."""
    @scenario
    async def corps(poste):
        canal = poste.agent._ui
        assert canal._http.server_address[0] == "127.0.0.1"
        for prise in canal._server.sockets:
            hote = prise.getsockname()[0]
            assert hote in ("127.0.0.1", "::1"), f"ecoute exposee sur {hote}"

    asyncio.run(corps(tmp_path, serveur))


def _png() -> bytes:
    """Un PNG minuscule mais valide (l'en-tête suffit au sniffing)."""
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
        + b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
        + b"\x1f\x15\xc4\x89" + b"\x00" * 16
    )


def test_media_verifie_puis_servi_en_local(tmp_path, serveur):
    """ADR-0004 §6 : le média vient du serveur, il est servi en 127.0.0.1."""
    import hashlib

    import httpx

    contenu = _png()
    empreinte = hashlib.sha256(contenu).hexdigest()

    @scenario
    async def corps(poste):
        poste.serveur.medias = {"7": contenu}
        poste.serveur.playlist = [
            {
                "id": 1,
                "type": "media",
                "titre": "Affiche",
                "media_id": "7",
                "media_type": "image",
                "media_sha256": empreinte,
                "media_url": "https://exemple.invalide/affiche.png",
                "duree_sec": 10,
                "ordre": 1,
            }
        ]
        await poste.agent._syncer.refresh_playlist()
        assert await poste.agent._syncer.sync_media() == 1

        elements = poste.agent._syncer.playlist_locale()
        url = elements[0]["media_url"]
        assert url.startswith("http://127.0.0.1:%d/media/" % poste.config.http_port)
        assert elements[0]["media_pret"] is True

        async with httpx.AsyncClient(timeout=5) as client:
            reponse = await client.get(url)
        assert reponse.status_code == 200
        assert reponse.headers["Content-Type"] == "image/png"
        assert reponse.content == contenu

    asyncio.run(corps(tmp_path, serveur))


def test_media_dont_l_empreinte_ne_correspond_pas_est_refuse(tmp_path, serveur):
    """Un contenu substitué ou corrompu n'entre jamais dans le cache."""
    import hashlib

    @scenario
    async def corps(poste):
        poste.serveur.medias = {"7": b"contenu different"}
        poste.serveur.playlist = [
            {
                "id": 1,
                "type": "media",
                "media_id": "7",
                "media_type": "image",
                "media_sha256": hashlib.sha256(_png()).hexdigest(),
                "duree_sec": 10,
            }
        ]
        await poste.agent._syncer.refresh_playlist()
        assert await poste.agent._syncer.sync_media() == 0

        elements = poste.agent._syncer.playlist_locale()
        assert elements[0]["media_url"] is None      # l'écran dégrade sur le texte
        assert elements[0]["media_pret"] is False

    asyncio.run(corps(tmp_path, serveur))


def test_seconde_interface_recoit_l_etat_courant(tmp_path, serveur):
    """Chromium redémarre : l'écran retrouve playlist et état sans réseau."""
    @scenario
    async def corps(poste):
        await poste.agent._ui.playlist([{"id": 1, "type": "message", "titre": "Sécurité"}])
        seconde = await websockets.connect(
            "ws://127.0.0.1:%d" % poste.ws_port, open_timeout=5
        )
        recus = []
        for _ in range(2):
            recus.append(json.loads(await asyncio.wait_for(seconde.recv(), timeout=5)))
        await seconde.close()

        types = {m["type"] for m in recus}
        assert types == {"playlist", "status"}

    asyncio.run(corps(tmp_path, serveur))


def test_boucle_de_file_transmet_sans_intervention(tmp_path, serveur, monkeypatch):
    """La file part toute seule : c'est la vraie boucle qui l'envoie."""
    import badgeuse_agent.app as app_mod

    monkeypatch.setattr(app_mod, "QUEUE_TICK_SEC", 0.1)

    @scenario
    async def corps(poste):
        await poste.badger(UID_KARIM)
        for _ in range(60):
            if poste.agent._store.queue_size() == 0:
                break
            await asyncio.sleep(0.1)
        assert poste.agent._store.queue_size() == 0
        assert poste.serveur.uuids_recus()

    asyncio.run(corps(tmp_path, serveur))


def test_heartbeat_porte_la_taille_de_file_et_l_alerte(tmp_path, serveur):
    @scenario
    async def corps(poste):
        poste.serveur.politique = lambda p: {"uuid": p["uuid"], "status": "invalid"}
        await poste.badger(UID_KARIM)
        await poste.pousser()
        await poste.agent._heartbeat_once()

        dernier = poste.serveur.heartbeats[-1]
        assert dernier["cible"] == "pi5"
        assert dernier["taille_file"] == 0
        assert "invalide" in dernier["alerte"]

    asyncio.run(corps(tmp_path, serveur))


def test_horloge_de_l_ecran_est_celle_du_poste(tmp_path, serveur):
    """L'écran affiche l'heure qui HORODATE, pas celle du fuseau système.

    Sans cette référence, la veille suivait l'horloge du navigateur : sur une
    image Raspberry Pi OS restée en UTC, l'écran montrait 09:41 en veille et
    11:41 sur l'overlay de badgeage. Deux heures sur le même écran.
    """
    from zoneinfo import ZoneInfo

    @scenario
    async def corps(poste):
        etat = poste.recus("status")[-1]
        assert "horloge_locale" in etat

        attendu = _dt.datetime.now(ZoneInfo("Europe/Paris"))
        lu = _dt.datetime.strptime(etat["horloge_locale"], "%Y-%m-%dT%H:%M:%S")
        assert abs((attendu.replace(tzinfo=None) - lu).total_seconds()) < 60
        assert etat["heure"] == lu.strftime("%H:%M")

        # Et l'overlay de badgeage utilise la MÊME référence.
        await poste.badger(UID_KARIM)
        heure_overlay = poste.recus("badge_ok")[-1]["heure_locale"]
        assert heure_overlay[:2] == lu.strftime("%H")

    asyncio.run(corps(tmp_path, serveur))


def test_un_ecran_fige_ne_bloque_pas_le_badgeage(tmp_path, serveur, caplog):
    """Chromium figé : le pointage passe quand même, l'écran est abandonné.

    L'envoi à l'interface se fait sous le verrou de ``_on_uid`` : sans délai
    de garde, un client qui n'accuse plus réception immobilisait TOUS les
    badgeages suivants — sans le moindre message.
    """
    import badgeuse_agent.ws_server as ws_mod

    caplog.set_level(logging.WARNING)

    class ClientFige:
        async def send(self, _payload):
            await asyncio.sleep(3600)      # ne rend jamais la main

        async def close(self):
            return None

    @scenario
    async def corps(poste):
        ws_mod.ENVOI_TIMEOUT_SEC = 0.2
        fige = ClientFige()
        poste.agent._ui._clients.add(fige)

        debut = asyncio.get_event_loop().time()
        await poste.badger(UID_KARIM)
        duree = asyncio.get_event_loop().time() - debut

        assert duree < 2.0, "le badgeage a attendu l'ecran"
        assert poste.agent._store.queue_size() == 1
        assert fige not in poste.agent._ui._clients      # client abandonné

    try:
        asyncio.run(corps(tmp_path, serveur))
    finally:
        ws_mod.ENVOI_TIMEOUT_SEC = 5.0

    assert "interface muette" in caplog.text


def test_etat_du_lecteur_remonte_a_l_ecran(tmp_path, serveur):
    """Sans lecteur, l'écran doit le dire (bandeau) — jamais faire semblant."""
    @scenario
    async def corps(poste):
        etats = poste.recus("status")
        assert etats, "aucun etat transmis a l'interface"
        assert etats[-1]["lecteur"] is False      # evdev absent en test
        await poste.agent._on_reader_state(True)
        await asyncio.sleep(0.05)
        assert poste.recus("status")[-1]["lecteur"] is True

    asyncio.run(corps(tmp_path, serveur))


# --------------------------------------------------------------- redémarrage


def test_redemarrage_sequence_monotone_et_chaine_reprise(tmp_path, serveur):
    """Un redémarrage ne réinitialise ni la séquence ni la chaîne."""
    etat = {}

    @scenario
    async def premier(poste):
        await poste.badger(UID_KARIM)
        poste.horloge.avancer(3600)            # entrée puis sortie, pas un rebond
        await poste.badger(UID_KARIM)
        etat.update(poste.agent._store.chain_state())

    @scenario
    async def second(poste):
        await poste.badger(UID_KARIM)
        await poste.pousser()

    asyncio.run(premier(tmp_path, serveur))
    asyncio.run(second(tmp_path, serveur))

    assert serveur.sequences_recues() == [1, 2, 3]
    envoyes = [p for lot in serveur.lots for p in lot]
    assert envoyes[2]["hash_precedent"] == etat["last_hash"]


def test_base_d_un_autre_poste_refusee(tmp_path):
    """La chaîne appartient à un poste : elle ne se poursuit pas sous un autre."""
    store = Store(str(tmp_path), "LH-P1")
    store.close()
    with pytest.raises(StoreError):
        Store(str(tmp_path), "LH-P2")


def test_pointage_horodate_en_utc_et_en_local(tmp_path, serveur):
    @scenario
    async def corps(poste):
        await poste.badger(UID_KARIM)
        charge = poste.agent._store.pending_batch()[0]
        moment = chain_mod.parse_utc_iso(charge["horodatage_utc"])
        assert moment.tzinfo is not None
        assert abs((_dt.datetime.now(_dt.timezone.utc) - moment).total_seconds()) < 30
        assert charge["fuseau"] == "Europe/Paris"

    asyncio.run(corps(tmp_path, serveur))
