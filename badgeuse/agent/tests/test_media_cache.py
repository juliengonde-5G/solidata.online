"""Cache média local — nommage, empreinte, purge, éviction LRU, anti-traversal.

Le cœur de décision est PUR (listes injectées) ; la classe :class:`MediaCache`
n'utilise que la bibliothèque standard, donc ces tests tournent aussi sans
réseau ni matériel.
"""

import hashlib
import os

import pytest

from badgeuse_agent.media_cache import (
    DEFAUT_MAX_MO,
    FichierCache,
    MediaCache,
    appliquer_urls_locales,
    deviner_mime,
    local_media_url,
    manquants,
    nom_cache,
    nom_sur,
    plafond_effectif,
    porteurs_media,
    purger_non_references,
    references_playlist,
    selectionner_evictions,
    sha256_hex,
    verifier_sha256,
)

CONTENU = b"contenu binaire du media"
EMPREINTE = hashlib.sha256(CONTENU).hexdigest()
NOM = f"7-{EMPREINTE[:16]}"

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 24


# ------------------------------------------------------------------- nommage


def test_nom_cache_deterministe():
    assert nom_cache(7, EMPREINTE) == NOM
    assert nom_cache("7", EMPREINTE.upper()) == NOM


def test_nom_cache_change_avec_le_contenu():
    """Un média modifié côté serveur prend un nom différent : jamais de périmé."""
    autre = hashlib.sha256(b"autre").hexdigest()
    assert nom_cache(7, autre) != nom_cache(7, EMPREINTE)


@pytest.mark.parametrize(
    "media_id, empreinte",
    [
        (None, EMPREINTE),
        ("", EMPREINTE),
        ("../../etc/passwd", EMPREINTE),
        ("7/8", EMPREINTE),
        (7, None),
        (7, "trop court"),
        (7, "z" * 64),
    ],
)
def test_nom_cache_refuse_l_invalide(media_id, empreinte):
    assert nom_cache(media_id, empreinte) is None


# ------------------------------------------------------------ anti-traversal


@pytest.mark.parametrize(
    "nom",
    [
        "..",
        "../badgeuse.db",
        "../../etc/passwd",
        "/etc/passwd",
        "7-" + "a" * 16 + "/../x",
        "7-" + "a" * 16 + ".tmp",
        "badgeuse.db",
        "",
        None,
        "7-XYZ",
        "7-" + "a" * 15,
        "\x00",
    ],
)
def test_nom_sur_refuse_toute_traversee(nom):
    assert nom_sur(nom) is False


def test_nom_sur_accepte_la_forme_canonique():
    assert nom_sur(NOM) is True


def test_chemin_refuse_la_traversee(tmp_path):
    cache = MediaCache(str(tmp_path / "media"))
    for nom in ("../badgeuse.db", "../../etc/passwd", "/etc/passwd", ".."):
        assert cache.chemin(nom) is None


def test_chemin_reste_confine(tmp_path):
    cache = MediaCache(str(tmp_path / "media"))
    chemin = cache.chemin(NOM)
    assert chemin is not None
    assert chemin.startswith(os.path.realpath(str(tmp_path / "media")) + os.sep)


# ----------------------------------------------------------------- empreinte


def test_verifier_sha256_accepte_le_bon_contenu():
    assert verifier_sha256(CONTENU, EMPREINTE) is True
    assert verifier_sha256(CONTENU, EMPREINTE.upper()) is True


def test_verifier_sha256_refuse_un_contenu_altere():
    assert verifier_sha256(CONTENU + b"!", EMPREINTE) is False


@pytest.mark.parametrize("empreinte", [None, "", "abc", "z" * 64, 42])
def test_verifier_sha256_refuse_une_empreinte_absente_ou_malformee(empreinte):
    """« Pas de vérification » n'est pas « vérification réussie »."""
    assert verifier_sha256(CONTENU, empreinte) is False


def test_sha256_mismatch_rejete_l_ecriture(tmp_path):
    cache = MediaCache(str(tmp_path / "media"))
    faux = hashlib.sha256(b"autre chose").hexdigest()

    assert cache.stocker(NOM, CONTENU, faux) is False
    assert cache.existe(NOM) is False
    # Aucun résidu : ni fichier final, ni temporaire.
    assert os.listdir(str(tmp_path / "media")) == []


def test_stocker_ecrit_apres_verification(tmp_path):
    cache = MediaCache(str(tmp_path / "media"))
    assert cache.stocker(NOM, CONTENU, EMPREINTE) is True
    assert cache.existe(NOM) is True
    assert cache.lire(NOM) == CONTENU
    assert sha256_hex(cache.lire(NOM)) == EMPREINTE


def test_stocker_refuse_un_nom_non_sur(tmp_path):
    cache = MediaCache(str(tmp_path / "media"))
    assert cache.stocker("../evasion", CONTENU, EMPREINTE) is False


# ----------------------------------------------------------------- type MIME


@pytest.mark.parametrize(
    "entete, attendu",
    [
        (PNG, "image/png"),
        (JPEG, "image/jpeg"),
        (b"GIF89a" + b"\x00" * 16, "image/gif"),
        (b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 8, "image/webp"),
        (MP4, "video/mp4"),
        (b"\x1a\x45\xdf\xa3" + b"\x00" * 16, "video/webm"),
    ],
)
def test_deviner_mime_sur_les_octets_reels(entete, attendu):
    assert deviner_mime(entete) == attendu


def test_deviner_mime_replie_sur_le_type_annonce():
    assert deviner_mime(b"inconnu", "image") == "image/jpeg"
    assert deviner_mime(b"inconnu", "video") == "video/mp4"


def test_deviner_mime_refuse_l_inconnu():
    """Liste blanche stricte : ce qui n'est pas reconnu n'est pas servi."""
    assert deviner_mime(b"MZ\x90\x00", None) is None
    assert deviner_mime(b"", "application/x-executable") is None


# -------------------------------------------------------------------- purge


def fichier(nom, taille=10, horodatage=100.0):
    return FichierCache(nom=nom, taille_octets=taille, horodatage=horodatage)


def test_purge_des_non_references():
    fichiers = [fichier("1-" + "a" * 16), fichier("2-" + "b" * 16)]
    purges = purger_non_references(fichiers, {"1-" + "a" * 16})
    assert purges == ["2-" + "b" * 16]


def test_purge_vide_si_tout_est_reference():
    fichiers = [fichier("1-" + "a" * 16)]
    assert purger_non_references(fichiers, {"1-" + "a" * 16}) == []


def test_purge_tout_si_playlist_vide():
    fichiers = [fichier("1-" + "a" * 16), fichier("2-" + "b" * 16)]
    assert len(purger_non_references(fichiers, [])) == 2


# ------------------------------------------------------------- éviction LRU


def test_pas_d_eviction_sous_le_plafond():
    fichiers = [fichier("1-" + "a" * 16, taille=10)]
    assert selectionner_evictions(fichiers, 100) == []


def test_eviction_lru_du_plus_ancien_d_abord():
    fichiers = [
        fichier("1-" + "a" * 16, taille=50, horodatage=300.0),   # récent
        fichier("2-" + "b" * 16, taille=50, horodatage=100.0),   # le plus ancien
        fichier("3-" + "c" * 16, taille=50, horodatage=200.0),
    ]
    # Plafond 100 octets pour 150 stockés : il faut en évincer un.
    assert selectionner_evictions(fichiers, 100) == ["2-" + "b" * 16]


def test_eviction_s_arrete_des_que_le_plafond_est_tenu():
    fichiers = [
        fichier("1-" + "a" * 16, taille=40, horodatage=100.0),
        fichier("2-" + "b" * 16, taille=40, horodatage=200.0),
        fichier("3-" + "c" * 16, taille=40, horodatage=300.0),
    ]
    evinces = selectionner_evictions(fichiers, 50)
    # 120 stockés, plafond 50 : on retire les deux plus anciens (reste 40).
    assert evinces == ["1-" + "a" * 16, "2-" + "b" * 16]


def test_eviction_deterministe_a_horodatage_egal():
    fichiers = [
        fichier("2-" + "b" * 16, taille=50, horodatage=100.0),
        fichier("1-" + "a" * 16, taille=50, horodatage=100.0),
    ]
    assert selectionner_evictions(fichiers, 50) == ["1-" + "a" * 16]


def test_eviction_plafond_nul_vide_le_cache():
    fichiers = [fichier("1-" + "a" * 16, taille=10)]
    assert selectionner_evictions(fichiers, 0) == ["1-" + "a" * 16]


# ------------------------------------------------------- entretien (bout en bout)


def test_entretenir_purge_puis_evince(tmp_path):
    cache = MediaCache(str(tmp_path / "media"), max_mo=1)

    garde = b"a" * 1024
    jete = b"b" * 1024
    nom_garde = nom_cache(1, sha256_hex(garde))
    nom_jete = nom_cache(2, sha256_hex(jete))

    assert cache.stocker(nom_garde, garde, sha256_hex(garde))
    assert cache.stocker(nom_jete, jete, sha256_hex(jete))

    bilan = cache.entretenir([nom_garde])
    assert bilan["purges"] == [nom_jete]
    assert cache.existe(nom_garde) is True
    assert cache.existe(nom_jete) is False


def test_entretenir_sans_reference_vide_le_cache(tmp_path):
    cache = MediaCache(str(tmp_path / "media"))
    cache.stocker(NOM, CONTENU, EMPREINTE)
    cache.entretenir([])
    assert cache.existe(NOM) is False


def test_entretenir_ignore_les_fichiers_hors_forme(tmp_path):
    """Un fichier étranger déposé dans le cache n'est ni servi ni compté."""
    repertoire = tmp_path / "media"
    cache = MediaCache(str(repertoire))
    (repertoire / "intrus.txt").write_bytes(b"x")

    assert cache.lister() == []
    cache.entretenir([])
    assert (repertoire / "intrus.txt").exists()   # jamais supprimé non plus


# --------------------------------------------------------------- playlist


def element(media_id=7, empreinte=EMPREINTE, **extra):
    base = {
        "id": 1,
        "type": "media",
        "media_id": media_id,
        "media_sha256": empreinte,
        "media_type": "image",
        "media_url": "https://solidata.online/uploads/photo.jpg",
    }
    base.update(extra)
    return base


def test_references_playlist():
    assert references_playlist([element()]) == {NOM}


def test_references_ignore_les_elements_sans_media():
    elements = [{"type": "message", "corps": "coucou"}, element()]
    assert references_playlist(elements) == {NOM}


def test_references_tolere_une_playlist_absente():
    assert references_playlist(None) == set()
    assert references_playlist("pas une liste") == set()


def test_manquants_liste_ce_qui_n_est_pas_en_cache():
    absents = manquants([element()], presents=[])
    assert len(absents) == 1
    assert absents[0]["nom"] == NOM
    assert absents[0]["media_sha256"] == EMPREINTE


def test_manquants_exclut_ce_qui_est_deja_la():
    assert manquants([element()], presents=[NOM]) == []


def test_manquants_dedoublonne():
    """Deux éléments partageant le même média ne le téléchargent qu'une fois."""
    assert len(manquants([element(), element()], presents=[])) == 1


def test_url_locale_toujours_sur_la_boucle_locale():
    assert local_media_url(8766, NOM) == f"http://127.0.0.1:8766/media/{NOM}"


def test_appliquer_urls_locales_ecrase_toute_url_distante():
    """Le poste ne fetch JAMAIS un domaine externe (ADR-0004 §6)."""
    [rendu] = appliquer_urls_locales([element()], disponibles=[NOM], port=8766)
    assert rendu["media_url"] == f"http://127.0.0.1:8766/media/{NOM}"
    assert rendu["media_pret"] is True
    assert "solidata.online" not in rendu["media_url"]


def test_appliquer_urls_locales_annule_un_media_absent():
    [rendu] = appliquer_urls_locales([element()], disponibles=[], port=8766)
    assert rendu["media_url"] is None
    assert rendu["media_pret"] is False


def test_appliquer_urls_locales_laisse_les_elements_sans_media():
    texte = {"type": "message", "titre": "Consigne", "corps": "Gants obligatoires"}
    [rendu] = appliquer_urls_locales([texte], disponibles=[], port=8766)
    assert rendu == texte


def test_appliquer_urls_locales_ne_modifie_pas_l_original():
    original = element()
    appliquer_urls_locales([original], disponibles=[NOM], port=8766)
    assert original["media_url"] == "https://solidata.online/uploads/photo.jpg"


# ---------------------------------------------------------------- plafond


def test_plafond_serveur_fait_foi():
    assert plafond_effectif(256, None) == 256


def test_plafond_local_ne_peut_que_reduire():
    assert plafond_effectif(1024, 256) == 256
    assert plafond_effectif(128, 512) == 128


def test_plafond_defaut_si_rien_de_renseigne():
    assert plafond_effectif(None, None) == DEFAUT_MAX_MO


@pytest.mark.parametrize("valeur", [0, -5, "abc", True, None])
def test_plafond_ignore_les_valeurs_inexploitables(valeur):
    assert plafond_effectif(valeur, None) == DEFAUT_MAX_MO


# ------------------------------------------- médias NICHÉS (type « social »)
#
# Le serveur sert le type `social` avec un visuel PAR POST : les descripteurs
# de média sont dans `element.posts[]`, pas sur l'élément (cf.
# backend/src/routes/badgeuse-device.js, buildSocial). Le poste doit les
# télécharger et les réécrire comme les autres, sinon l'écran social reste
# muet.

EMPREINTE_A = "a" * 64
EMPREINTE_B = "b" * 64
NOM_A = f"s12-{EMPREINTE_A[:16]}"
NOM_B = f"s11-{EMPREINTE_B[:16]}"


def element_social():
    return {
        "id": 8,
        "type": "social",
        "corps": None,
        "posts": [
            {
                "media_id": "s12",
                "media_type": "image",
                "media_sha256": EMPREINTE_A,
                "reseau": "instagram",
                "compte": "fripandcorouen",
                "legende": "Nouvelle collecte",
            },
            {
                "media_id": "s11",
                "media_type": "image",
                "media_sha256": EMPREINTE_B,
                "reseau": "facebook",
                "compte": "SolidariteTextiles",
                "legende": None,
            },
        ],
    }


def test_porteurs_media_trouve_l_element_et_ses_sous_objets():
    assert len(porteurs_media(element_social())) == 2
    assert len(porteurs_media(element())) == 1
    assert porteurs_media({"type": "message", "corps": "texte"}) == []


def test_references_descend_dans_les_posts():
    assert references_playlist([element_social()]) == {NOM_A, NOM_B}


def test_manquants_descend_dans_les_posts():
    noms = {m["nom"] for m in manquants([element_social()], presents=[])}
    assert noms == {NOM_A, NOM_B}


def test_manquants_exclut_un_post_deja_en_cache():
    noms = {m["nom"] for m in manquants([element_social()], presents=[NOM_A])}
    assert noms == {NOM_B}


def test_urls_locales_reecrites_dans_les_posts():
    [rendu] = appliquer_urls_locales(
        [element_social()], disponibles=[NOM_A], port=8766
    )
    assert rendu["posts"][0]["media_url"] == f"http://127.0.0.1:8766/media/{NOM_A}"
    assert rendu["posts"][0]["media_pret"] is True
    # Visuel pas encore telecharge : annule, l'ecran degrade sur la legende.
    assert rendu["posts"][1]["media_url"] is None
    assert rendu["posts"][1]["media_pret"] is False


def test_urls_locales_ne_modifient_pas_les_posts_d_origine():
    original = element_social()
    appliquer_urls_locales([original], disponibles=[NOM_A, NOM_B], port=8766)
    assert "media_url" not in original["posts"][0]


def test_element_et_posts_traites_ensemble():
    """Un élément qui porterait À LA FOIS un média et des posts nichés."""
    mixte = dict(element_social())
    mixte["media_id"] = 7
    mixte["media_sha256"] = EMPREINTE
    assert references_playlist([mixte]) == {NOM, NOM_A, NOM_B}


def test_liste_de_valeurs_non_objets_ignoree():
    """Une liste de chaînes (ex. tags) ne doit pas casser le parcours."""
    element_tags = {"type": "message", "tags": ["a", "b"], "corps": "texte"}
    assert references_playlist([element_tags]) == set()
    [rendu] = appliquer_urls_locales([element_tags], disponibles=[], port=8766)
    assert rendu["tags"] == ["a", "b"]
