"""Phrase de motivation — vivier générique, rotation déterministe (ADR-0004 §2)."""

import datetime as dt

import pytest

from badgeuse_agent.motivation import PHRASE_MAX, phrase_du_jour, vivier

PHRASES = [
    "Chaque geste compte.",
    "Un textile trié, c'est un textile sauvé.",
    "Bravo pour le travail d'équipe.",
]


# ----------------------------------------------------------------- rotation


def test_rotation_sur_le_jour_de_l_annee():
    """jour de l'année % taille du vivier (CDC_AFFICHAGE_V2 §1)."""
    # 2026-01-01 = 1er jour → index 1 % 3 = 1
    assert phrase_du_jour(PHRASES, "2026-01-01") == PHRASES[1]
    # 2026-01-02 → index 2 % 3 = 2
    assert phrase_du_jour(PHRASES, "2026-01-02") == PHRASES[2]
    # 2026-01-03 → index 3 % 3 = 0
    assert phrase_du_jour(PHRASES, "2026-01-03") == PHRASES[0]


def test_meme_jour_meme_phrase():
    """Stabilité intra-journée : deux badgeages du même jour, même phrase.

    Sans cela, l'affichage donnerait l'illusion d'un message personnalisé qui
    change d'une personne à l'autre (ce que l'ADR-0004 §2 exclut).
    """
    premiere = phrase_du_jour(PHRASES, "2026-08-16")
    for _ in range(50):
        assert phrase_du_jour(PHRASES, "2026-08-16") == premiere


def test_deterministe_entre_postes():
    """Aucun aléa : deux postes du site affichent la même phrase le même jour."""
    assert phrase_du_jour(PHRASES, "2026-03-07") == phrase_du_jour(PHRASES, "2026-03-07")


def test_rotation_couvre_tout_le_vivier():
    vues = {
        phrase_du_jour(PHRASES, dt.date(2026, 1, 1) + dt.timedelta(days=n))
        for n in range(10)
    }
    assert vues == set(PHRASES)


def test_jour_suivant_change_de_phrase():
    hier = phrase_du_jour(PHRASES, "2026-05-04")
    aujourdhui = phrase_du_jour(PHRASES, "2026-05-05")
    assert hier != aujourdhui


def test_vivier_d_une_seule_phrase():
    assert phrase_du_jour(["Seule phrase."], "2026-08-16") == "Seule phrase."


# ------------------------------------------------------------- cas dégradés


def test_vivier_vide_renvoie_une_chaine_vide():
    for phrases in ([], None, {}, "pas une liste", [""], ["   "]):
        assert phrase_du_jour(phrases, "2026-08-16") == ""


def test_desactive_renvoie_une_chaine_vide():
    assert phrase_du_jour(PHRASES, "2026-08-16", active=False) == ""


def test_date_illisible_renvoie_une_chaine_vide():
    for date in (None, "", "pas une date", "2026-13-45", 42):
        assert phrase_du_jour(PHRASES, date) == ""


def test_jamais_none():
    """L'appelant concatène : on ne renvoie jamais None."""
    assert phrase_du_jour(None, None) == ""
    assert isinstance(phrase_du_jour(PHRASES, "2026-08-16"), str)


# ---------------------------------------------------------- formes acceptées


@pytest.mark.parametrize(
    "date",
    [
        "2026-08-16",
        "2026-08-16T09:12:00",
        "2026-08-16 09:12:00",
        dt.date(2026, 8, 16),
        dt.datetime(2026, 8, 16, 9, 12),
    ],
)
def test_formes_de_date_acceptees(date):
    assert phrase_du_jour(PHRASES, date) == phrase_du_jour(PHRASES, "2026-08-16")


# --------------------------------------------------------------------- vivier


def test_vivier_ignore_les_entrees_vides_et_conserve_l_ordre():
    assert vivier(["  a  ", "", None, "b", "   "]) == ["a", "b"]


def test_vivier_recompacte_les_espaces():
    assert vivier(["trop    d'espaces\n ici"]) == ["trop d'espaces ici"]


def test_phrase_tronquee():
    longue = "x" * 400
    rendue = phrase_du_jour([longue], "2026-08-16")
    assert len(rendue) == PHRASE_MAX
    assert rendue.endswith("…")
