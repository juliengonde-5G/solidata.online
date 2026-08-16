"""Message de badgeage — moments, gabarits, festif (CDC_AFFICHAGE_V2 §1).

Module PUR : aucun de ces tests n'a besoin de réseau, de disque ni de
matériel. C'est le point où se vérifie ce que l'écran montre réellement — donc
aussi où se vérifie la conformité (ADR-0004).
"""

import pytest

from badgeuse_agent.moments import (
    MATIN,
    MESSAGE_MAX,
    OVERLAY_MAX_SEC,
    OVERLAY_MIN_SEC,
    PAUSE,
    RETOUR,
    SOIR,
    annees_entreprise,
    bloc_affichage,
    clamp_overlay,
    construire_badge_ok,
    determine_moment,
    festif_du_badge,
    gabarit_pour,
    message_du_moment,
    parse_hhmm,
    render_message,
    tronquer,
)

PLAGES = {
    "moment_matin_fin": "11:30",
    "pause_debut": "11:00",
    "pause_fin": "14:00",
    "retour_fin": "15:00",
    "soir_debut": "14:00",
}


# --------------------------------------------------------------- plages nominales


@pytest.mark.parametrize(
    "heure, attendu",
    [
        ("05:00", MATIN),
        ("07:45", MATIN),
        ("11:29", MATIN),
        ("11:30", RETOUR),      # borne de fin exclue : bascule sur retour
        ("13:15", RETOUR),
        ("14:59", RETOUR),
    ],
)
def test_entree_selon_les_plages(heure, attendu):
    assert determine_moment("entree", heure, PLAGES) == attendu


@pytest.mark.parametrize(
    "heure, attendu",
    [
        ("11:00", PAUSE),       # borne de début incluse
        ("12:30", PAUSE),
        ("13:59", PAUSE),
        ("14:00", SOIR),        # borne de fin exclue : bascule sur soir
        ("17:45", SOIR),
        ("20:59", SOIR),
    ],
)
def test_sortie_selon_les_plages(heure, attendu):
    assert determine_moment("sortie", heure, PLAGES) == attendu


def test_aucune_heure_n_appartient_a_deux_moments():
    """Intervalles semi-ouverts : une heure pile a toujours UN seul moment."""
    for minutes in range(0, 24 * 60):
        heure = f"{minutes // 60:02d}:{minutes % 60:02d}"
        assert determine_moment("entree", heure, PLAGES) in (MATIN, RETOUR)
        assert determine_moment("sortie", heure, PLAGES) in (PAUSE, SOIR)


# ------------------------------------------------------------------------ replis


def test_entree_hors_plage_avant_midi_donne_matin():
    """Plages resserrées : une entrée à 09:00 reste un « bonjour » (repli)."""
    plages = {**PLAGES, "moment_matin_fin": "06:00", "retour_fin": "06:30"}
    assert determine_moment("entree", "09:00", plages) == MATIN


def test_entree_apres_les_plages_donne_retour():
    assert determine_moment("entree", "18:30", PLAGES) == RETOUR


def test_repli_entree_bascule_a_midi_pile():
    """Le repli documenté bascule à 12:00 : avant → matin, à partir de → retour."""
    plages = {**PLAGES, "moment_matin_fin": "06:00", "retour_fin": "06:30"}
    assert determine_moment("entree", "11:59", plages) == MATIN
    assert determine_moment("entree", "12:00", plages) == RETOUR


def test_sortie_hors_plage_donne_soir():
    """Une sortie avant l'ouverture de la pause reste un départ."""
    assert determine_moment("sortie", "07:15", PLAGES) == SOIR


def test_heure_illisible_replie_par_sens():
    for heure in (None, "", "midi", "99:99", "12"):
        assert determine_moment("entree", heure, PLAGES) == MATIN
        assert determine_moment("sortie", heure, PLAGES) == SOIR


def test_plages_absentes_utilisent_les_defauts():
    assert determine_moment("entree", "08:00", None) == MATIN
    assert determine_moment("sortie", "12:15", None) == PAUSE
    assert determine_moment("sortie", "17:00", {}) == SOIR


def test_plage_illisible_retombe_sur_le_defaut():
    """Une valeur serveur cassée ne désactive pas silencieusement la plage."""
    assert determine_moment("entree", "08:00", {"moment_matin_fin": "n'importe quoi"}) == MATIN


def test_sens_inconnu_traite_comme_une_arrivee():
    """En cas de doute, on salue plutôt qu'on ne dit au revoir."""
    assert determine_moment("inconnu", "08:00", PLAGES) == MATIN
    assert determine_moment(None, "08:00", PLAGES) == MATIN


def test_secondes_tolerees():
    """app.py envoie « HH:MM:SS » : la forme doit être acceptée telle quelle."""
    assert determine_moment("entree", "08:12:45", PLAGES) == MATIN


@pytest.mark.parametrize(
    "valeur, attendu",
    [("00:00", 0), ("8:05", 485), ("23:59", 1439), ("11:30:59", 690)],
)
def test_parse_hhmm(valeur, attendu):
    assert parse_hhmm(valeur) == attendu


@pytest.mark.parametrize("valeur", ["24:00", "12:60", "-1:00", "abc", "", None, "1200"])
def test_parse_hhmm_refuse_l_invalide(valeur):
    assert parse_hhmm(valeur) is None


# ---------------------------------------------------------------------- gabarits


def test_render_message_substitue_le_prenom():
    assert render_message("Bonjour, {prenom} !", "Karim") == "Bonjour, Karim !"


def test_render_message_substitue_les_annees():
    assert render_message("{annees} ans avec nous, {prenom} !", "Karim", 2) == (
        "2 ans avec nous, Karim !"
    )


def test_render_message_annees_absentes_ne_laisse_pas_de_trou():
    assert render_message("{annees} ans, {prenom} !", "Karim") == "ans, Karim !"


def test_render_message_prenom_vide_ne_laisse_pas_double_espace():
    assert render_message("Bonjour, {prenom} !", "") == "Bonjour, !"


def test_render_message_gabarit_vide_renvoie_vide():
    for gabarit in (None, "", "   "):
        assert render_message(gabarit, "Karim") == ""


def test_render_message_tronque_a_120_caracteres():
    rendu = render_message("A" * 300 + " {prenom}", "Karim")
    assert len(rendu) == MESSAGE_MAX
    assert rendu.endswith("…")


def test_render_message_ne_tronque_pas_sous_la_limite():
    court = "Bonjour, Karim !"
    assert render_message("Bonjour, {prenom} !", "Karim") == court
    assert len(court) < MESSAGE_MAX


def test_render_message_ignore_les_accolades_parasites():
    """Une accolade saisie au back-office ne doit jamais lever d'exception."""
    assert render_message("Bonjour {inconnu} {prenom}", "Karim") == (
        "Bonjour {inconnu} Karim"
    )


def test_tronquer_respecte_la_borne():
    assert tronquer("abcdef", 4) == "abc…"
    assert tronquer("abc", 10) == "abc"
    assert tronquer("abc", 0) == ""


def test_gabarit_pour_prend_le_serveur_puis_le_defaut():
    assert gabarit_pour({"matin": "Salut {prenom} !"}, "matin") == "Salut {prenom} !"
    assert gabarit_pour({}, "matin") == "Bonjour, {prenom} !"
    assert gabarit_pour({"matin": "   "}, "matin") == "Bonjour, {prenom} !"
    assert gabarit_pour(None, "soir") == "Bonne fin de journée, {prenom} !"


def test_message_du_moment_par_defaut():
    assert message_du_moment(PAUSE, "Karim") == "Bon appétit, Karim !"


# ------------------------------------------------------------------------ festif


def test_festif_premier_jour():
    festif = festif_du_badge({"prenom": "Karim", "premier_jour": True}, actif=True)
    assert festif["type"] == "premier_jour"
    assert festif["message"] == "Bienvenue chez Solidarité Textiles, Karim !"


def test_festif_anniversaire():
    festif = festif_du_badge({"prenom": "Karim", "anniversaire": True}, actif=True)
    assert festif["type"] == "anniversaire"
    assert "Karim" in festif["message"]


def test_festif_anniversaire_entreprise_porte_les_annees():
    festif = festif_du_badge(
        {"prenom": "Karim", "anniversaire_entreprise_annees": 2}, actif=True
    )
    assert festif["type"] == "anniversaire_entreprise"
    assert festif["annees"] == 2
    assert festif["message"] == "2 ans avec nous, Karim !"


def test_priorite_premier_jour_sur_anniversaire():
    """Un seul festif à la fois, le premier jour prime (il est unique)."""
    festif = festif_du_badge(
        {
            "prenom": "Karim",
            "premier_jour": True,
            "anniversaire": True,
            "anniversaire_entreprise_annees": 3,
        },
        actif=True,
    )
    assert festif["type"] == "premier_jour"


def test_priorite_anniversaire_sur_anniversaire_entreprise():
    festif = festif_du_badge(
        {
            "prenom": "Karim",
            "anniversaire": True,
            "anniversaire_entreprise_annees": 3,
        },
        actif=True,
    )
    assert festif["type"] == "anniversaire"


def test_festif_inactif_ne_produit_rien():
    badge = {"prenom": "Karim", "anniversaire": True}
    assert festif_du_badge(badge, actif=False) is None


def test_premier_jour_desactivable_separement():
    badge = {"prenom": "Karim", "premier_jour": True, "anniversaire": True}
    festif = festif_du_badge(badge, actif=True, premier_jour_actif=False)
    assert festif["type"] == "anniversaire"


def test_aucun_drapeau_aucun_festif():
    assert festif_du_badge({"prenom": "Karim"}, actif=True) is None
    assert festif_du_badge(None, actif=True) is None


def test_gabarit_festif_vide_ne_produit_pas_d_ecran_muet():
    festif = festif_du_badge(
        {"prenom": "Karim", "anniversaire": True},
        {"anniversaire": "   "},
        actif=True,
    )
    # Gabarit blanc → le défaut reprend la main plutôt qu'un écran vide.
    assert festif is not None and festif["message"]


@pytest.mark.parametrize("valeur", [0, -1, None, "", "deux", True, False])
def test_annees_entreprise_refuse_l_inexploitable(valeur):
    assert annees_entreprise(valeur) is None


@pytest.mark.parametrize("valeur, attendu", [(1, 1), (2, 2), ("5", 5), (10.0, 10)])
def test_annees_entreprise_accepte_le_valide(valeur, attendu):
    assert annees_entreprise(valeur) == attendu


def test_anciennete_nulle_ne_declenche_pas_de_festif():
    badge = {"prenom": "Karim", "anniversaire_entreprise_annees": 0}
    assert festif_du_badge(badge, actif=True) is None


# ----------------------------------------------------------------- overlay borné


@pytest.mark.parametrize("valeur", [30, 8.4, 100, "12"])
def test_clamp_overlay_plafonne_a_8_secondes(valeur):
    assert clamp_overlay(valeur) == OVERLAY_MAX_SEC


@pytest.mark.parametrize("valeur", [0, 1, -5, 2.4])
def test_clamp_overlay_plancher_a_3_secondes(valeur):
    assert clamp_overlay(valeur) == OVERLAY_MIN_SEC


@pytest.mark.parametrize("valeur", [None, "abc", "", float("nan")])
def test_clamp_overlay_valeur_illisible_prend_le_defaut(valeur):
    assert clamp_overlay(valeur) == 5


# ------------------------------------------------------------ charge utile badge


def affichage(**surcharges):
    base = {
        "messages": {},
        "plages_moments": PLAGES,
        "motivation_active": True,
        "festif_actif": True,
    }
    base.update(surcharges)
    return base


def test_badge_ok_porte_le_message_du_moment():
    message = construire_badge_ok(
        badge={"prenom": "Karim", "initiale": "B", "salarie_id": 12},
        sens="entree",
        heure_locale="08:12:00",
        affichage=affichage(),
    )
    assert message["type"] == "badge_ok"
    assert message["moment"] == MATIN
    assert message["message"] == "Bonjour, Karim !"
    assert message["festif"] is None


def test_badge_ok_porte_la_phrase_injectee():
    message = construire_badge_ok(
        badge={"prenom": "Karim", "initiale": "B"},
        sens="sortie",
        heure_locale="17:30:00",
        affichage=affichage(),
        phrase_motivation="Chaque geste compte.",
    )
    assert message["moment"] == SOIR
    assert message["phrase_motivation"] == "Chaque geste compte."


def test_badge_ok_phrase_vide_devient_nulle():
    message = construire_badge_ok(
        badge={"prenom": "Karim", "initiale": "B"},
        sens="entree",
        heure_locale="08:00:00",
        affichage=affichage(),
        phrase_motivation="   ",
    )
    assert message["phrase_motivation"] is None


def test_badge_ok_porte_le_festif():
    message = construire_badge_ok(
        badge={"prenom": "Karim", "initiale": "B", "anniversaire": True},
        sens="entree",
        heure_locale="08:00:00",
        affichage=affichage(),
    )
    assert message["festif"]["type"] == "anniversaire"
    # Le message du moment reste présent : l'interface choisit lequel afficher.
    assert message["message"] == "Bonjour, Karim !"


def test_badge_ok_sans_bloc_affichage_reste_fonctionnel():
    """Serveur encore en v1.2 : gabarits par défaut, ni festif ni phrase."""
    message = construire_badge_ok(
        badge={"prenom": "Karim", "initiale": "B", "anniversaire": True},
        sens="entree",
        heure_locale="08:00:00",
        affichage=None,
    )
    assert message["message"] == "Bonjour, Karim !"
    assert message["festif"] is None          # festif_actif absent → désactivé
    assert message["phrase_motivation"] is None


def test_badge_ok_plafonne_l_overlay():
    message = construire_badge_ok(
        badge={"prenom": "Karim", "initiale": "B"},
        sens="entree",
        heure_locale="08:00:00",
        overlay_duree_sec=45,
    )
    assert message["overlay_duree_sec"] == OVERLAY_MAX_SEC


def test_badge_ok_ne_porte_jamais_de_nom_complet():
    """Non-régression A5 / ADR-0004 §1 : prénom + initiale, rien d'autre.

    Même si le cache portait par accident un nom, un statut ou une date de
    naissance, ils ne peuvent pas atteindre l'écran : la charge utile est
    construite champ par champ, jamais recopiée en bloc.
    """
    message = construire_badge_ok(
        badge={
            "prenom": "Karim",
            "initiale": "B",
            "nom": "BENALI",
            "statut": "en_parcours",
            "date_naissance": "1987-04-12",
            "equipe": "Tri",
        },
        sens="entree",
        heure_locale="08:00:00",
        affichage=affichage(),
    )
    serialise = repr(message)
    assert "BENALI" not in serialise
    assert "en_parcours" not in serialise
    assert "1987-04-12" not in serialise
    assert "Tri" not in serialise
    assert message["prenom"] == "Karim"
    assert message["initiale"] == "B"


def test_badge_ok_sans_badge_ne_leve_pas():
    message = construire_badge_ok(badge=None, sens="entree", heure_locale="08:00:00")
    assert message["prenom"] == ""
    assert message["initiale"] == ""


def test_bloc_affichage_tolere_l_absence():
    assert bloc_affichage(None) == {}
    assert bloc_affichage({}) == {}
    assert bloc_affichage({"affichage": "pas un objet"}) == {}
    assert bloc_affichage({"affichage": {"festif_actif": True}}) == {"festif_actif": True}
