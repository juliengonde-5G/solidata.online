"""Persistance locale — PST-05 (file, purge sur accusé, séquence monotone)."""

import datetime as dt
import json
import sqlite3

import pytest

from badgeuse_agent.chain import canonical, chain_hash, genesis_hash
from badgeuse_agent.store import Store, StoreError

DEVICE = "LH-P1"
UID_A = "6af79677ac212277ce9caf53668e1561c75c43aaba28c6588da17c55915551d8"
UID_B = "a" * 64


@pytest.fixture()
def store(tmp_path):
    with Store(str(tmp_path), DEVICE) as instance:
        yield instance


def utc(hour, minute=0, day=17):
    return dt.datetime(2026, 8, day, hour, minute, tzinfo=dt.timezone.utc)


# ------------------------------------------------------------------ file d'attente


def test_pointage_mis_en_file(store):
    payload = store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=12)
    assert store.queue_size() == 1
    assert payload["sequence_device"] == 1
    assert payload["uid_hmac"] == UID_A
    assert payload["sens"] == "entree"
    assert payload["source"] == "badge"
    assert payload["fuseau"] == "Europe/Paris"


def test_charge_utile_conforme_au_contrat_api(store):
    payload = store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=12)
    attendus = {
        "uuid", "sequence_device", "uid_hmac", "horodatage_utc",
        "horodatage_local", "fuseau", "sens", "source",
        "hash_precedent", "hash_courant",
    }
    assert attendus <= set(payload)


def test_lot_ordonne_par_sequence(store):
    for _ in range(5):
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    lot = store.pending_batch()
    assert [p["sequence_device"] for p in lot] == [1, 2, 3, 4, 5]


def test_lot_plafonne_a_100(store):
    for _ in range(105):
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    assert len(store.pending_batch(500)) == 100


# -------------------------------------------------------- purge sur accusé seul


def test_purge_sur_accuses_ok_duplicate_orphan(store):
    payloads = [
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
        for _ in range(3)
    ]
    store.ack(
        [
            {"uuid": payloads[0]["uuid"], "status": "ok"},
            {"uuid": payloads[1]["uuid"], "status": "duplicate"},
            {"uuid": payloads[2]["uuid"], "status": "orphan", "raison": "badge_inconnu"},
        ]
    )
    assert store.queue_size() == 0


@pytest.mark.parametrize("statut", ["error", "invalid_payload", "", "rejected", None])
def test_aucune_purge_sans_accuse(store, statut):
    payload = store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    store.ack([{"uuid": payload["uuid"], "status": statut}])
    assert store.queue_size() == 1


def test_lot_refuse_400_laisse_la_file_intacte(store):
    """Un lot syntaxiquement rejeté ne produit aucun accusé : rien ne se perd."""
    for _ in range(3):
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    store.ack([])  # le serveur a répondu 400, aucun résultat par élément
    assert store.queue_size() == 3


def test_accuse_partiel_purge_seulement_les_accuses(store):
    a = store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    b = store.enqueue_pointage(uid_hmac=UID_B, sens="entree", salarie_id=2)
    store.ack([{"uuid": a["uuid"], "status": "ok"}])
    restants = store.pending_batch()
    assert len(restants) == 1
    assert restants[0]["uuid"] == b["uuid"]


def test_accuse_inconnu_sans_effet(store):
    store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    store.ack([{"uuid": "uuid-jamais-emis", "status": "ok"}])
    assert store.queue_size() == 1


# ----------------------------------------------------------- séquence et chaîne


def test_sequence_strictement_monotone(store):
    sequences = [
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)[
            "sequence_device"
        ]
        for _ in range(50)
    ]
    assert sequences == list(range(1, 51))
    assert all(b > a for a, b in zip(sequences, sequences[1:]))


def test_sequence_jamais_reutilisee_apres_purge(store):
    payload = store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    store.ack([{"uuid": payload["uuid"], "status": "ok"}])
    suivant = store.enqueue_pointage(uid_hmac=UID_A, sens="sortie", salarie_id=1)
    assert suivant["sequence_device"] == 2


def test_premier_pointage_chaine_sur_la_genese(store):
    payload = store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    assert payload["hash_precedent"] == genesis_hash(DEVICE)


def test_chaine_continue_et_verifiable(store):
    payloads = [
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
        for _ in range(10)
    ]
    precedent = genesis_hash(DEVICE)
    for payload in payloads:
        assert payload["hash_precedent"] == precedent
        recalcule = chain_hash(
            precedent, canonical({**payload, "device_code": DEVICE})
        )
        assert payload["hash_courant"] == recalcule
        precedent = payload["hash_courant"]


def test_etat_de_chaine_persiste(store):
    payload = store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    etat = store.chain_state()
    assert etat["sequence"] == 1
    assert etat["last_hash"] == payload["hash_courant"]


def test_transaction_avortee_ne_consomme_pas_de_sequence(tmp_path):
    """Un échec d'écriture laisse la base intacte : ni trou, ni doublon."""
    with Store(str(tmp_path), DEVICE) as store:
        premier = store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)

        with pytest.raises(sqlite3.IntegrityError):
            store.enqueue_pointage(
                uid_hmac=UID_A,
                sens="sortie",
                salarie_id=1,
                pointage_uuid=premier["uuid"],  # collision de clé primaire
            )

        etat = store.chain_state()
        assert etat["sequence"] == 1
        assert etat["last_hash"] == premier["hash_courant"]

        suivant = store.enqueue_pointage(uid_hmac=UID_A, sens="sortie", salarie_id=1)
        assert suivant["sequence_device"] == 2
        assert suivant["hash_precedent"] == premier["hash_courant"]


# ------------------------------------------------------------- crash / relecture


def test_reouverture_apres_crash_donnees_intactes(tmp_path):
    """Arrêt brutal simulé : aucune fermeture propre, base rouverte ensuite."""
    store = Store(str(tmp_path), DEVICE)
    payloads = [
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=7)
        for _ in range(3)
    ]
    del store  # ni close(), ni flush() : le processus a disparu

    repris = Store(str(tmp_path), DEVICE)
    try:
        assert repris.queue_size() == 3
        assert repris.chain_state()["sequence"] == 3
        assert repris.chain_state()["last_hash"] == payloads[-1]["hash_courant"]

        suivant = repris.enqueue_pointage(uid_hmac=UID_A, sens="sortie", salarie_id=7)
        assert suivant["sequence_device"] == 4
        assert suivant["hash_precedent"] == payloads[-1]["hash_courant"]
    finally:
        repris.close()


def test_base_d_un_autre_poste_refusee(tmp_path):
    with Store(str(tmp_path), DEVICE) as store:
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    with pytest.raises(StoreError):
        Store(str(tmp_path), "AUTRE-P9")


# ------------------------------------------------------------------- badges


def test_cache_badges_limite_aux_champs_du_contrat(store):
    store.replace_badges(
        [
            {
                "uid_hmac": UID_A,
                "salarie_id": 123,
                "prenom": "Karim",
                "initiale_nom": "B",
                "nom": "NE DOIT PAS ETRE STOCKE",
                "equipe": "Tri",
                "salaire": 1800,
            }
        ]
    )
    badge = store.find_badge(UID_A)
    assert badge == {
        "uid_hmac": UID_A,
        "salarie_id": 123,
        "prenom": "Karim",
        "initiale": "B",
    }

    contenu = open(store.path, "rb").read()
    assert b"NE DOIT PAS ETRE STOCKE" not in contenu
    assert b"1800" not in contenu


def test_remplacement_complet_du_cache(store):
    store.replace_badges([{"uid_hmac": UID_A, "salarie_id": 1, "prenom": "A"}])
    store.replace_badges([{"uid_hmac": UID_B, "salarie_id": 2, "prenom": "B"}])
    assert store.find_badge(UID_A) is None
    assert store.find_badge(UID_B) is not None
    assert store.badges_count() == 1


def test_badge_inconnu(store):
    assert store.find_badge("f" * 64) is None


def test_badges_incomplets_ignores(store):
    assert store.replace_badges([{"prenom": "Sans identifiant"}, {"uid_hmac": UID_A}]) == 0


# --------------------------------------------------------------- alternance


def test_evenements_du_salarie_pour_l_alternance(store):
    store.enqueue_pointage(
        uid_hmac=UID_A, sens="entree", salarie_id=5, horodatage_utc=utc(6, 58)
    )
    store.enqueue_pointage(
        uid_hmac=UID_B, sens="entree", salarie_id=9, horodatage_utc=utc(7, 2)
    )
    events = store.events_for_salarie(5, reference_utc=utc(15))
    assert len(events) == 1
    assert events[0].sens == "entree"


def test_purge_des_evenements_anciens_epargne_la_file(store):
    ancien = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=60)
    payload = store.enqueue_pointage(
        uid_hmac=UID_A, sens="entree", salarie_id=5, horodatage_utc=ancien
    )
    assert store.purge_old_events(days=30) == 0  # encore en file : conservé
    store.ack([{"uuid": payload["uuid"], "status": "ok"}])
    assert store.purge_old_events(days=30) == 1


# ------------------------------------------------------------------- cache


def test_cache_config_et_etag(store):
    store.set_cache("config", {"overlay_duree_sec": 5}, etag='W/"abc"')
    assert store.get_cache("config")["overlay_duree_sec"] == 5
    assert store.get_etag("config") == 'W/"abc"'


def test_cache_absent_renvoie_le_defaut(store):
    assert store.get_cache("playlist", default=[]) == []


def test_cache_survit_a_la_reouverture(tmp_path):
    with Store(str(tmp_path), DEVICE) as store:
        store.set_cache("playlist", [{"id": 7, "type": "message"}], etag="e1")
    with Store(str(tmp_path), DEVICE) as store:
        assert store.get_cache("playlist")[0]["id"] == 7


# ------------------------------------------------------- absence d'UID en clair


def test_aucun_uid_en_clair_sur_disque(tmp_path):
    """L'UID brut ne doit apparaître nulle part dans le fichier SQLite."""
    with Store(str(tmp_path), DEVICE) as store:
        store.replace_badges([{"uid_hmac": UID_A, "salarie_id": 1, "prenom": "Karim"}])
        store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
        store.flush()
        chemin = store.path

    for suffixe in ("", "-wal", "-shm"):
        try:
            contenu = open(chemin + suffixe, "rb").read()
        except FileNotFoundError:
            continue
        assert b"04A23B1C" not in contenu
        assert b"04a23b1c" not in contenu


def test_payload_json_ne_contient_que_le_condensat(store):
    store.enqueue_pointage(uid_hmac=UID_A, sens="entree", salarie_id=1)
    brut = json.dumps(store.pending_batch())
    assert UID_A in brut
    assert "04A23B1C" not in brut
