"""Plage d'activation de l'ecran : ce que le serveur decide arrive au poste.

Le defaut que ces cas verrouillent est un defaut de CHAINE, pas de calcul :
le serveur envoyait les horaires depuis la v1 (bloc ``dpms`` de GET /config),
et personne ne les lisait — le minuteur d'extinction ne connait que des
fichiers. Regler les horaires dans SOLIDATA n'avait donc aucun effet visible.
"""

from __future__ import annotations

import pytest

from badgeuse_agent.ecran import (
    NOM_FICHIER,
    ecrire_plage,
    heure_valide,
    plage_depuis_config,
    rendu_conf,
)


@pytest.mark.parametrize("valeur", ["05:30", "00:00", "23:59", " 21:30 "])
def test_heures_lisibles(valeur):
    assert heure_valide(valeur) == valeur.strip()


@pytest.mark.parametrize("valeur", [None, "", "7:5", "24:00", "05:60", "cinq heures", "05h30", 530])
def test_heures_refusees(valeur):
    """Strict par choix : mieux vaut garder la plage precedente qu'en deduire une."""
    assert heure_valide(valeur) is None


def test_plage_exige_les_deux_bornes():
    """Une plage a moitie definie n'a pas de sens : a quelle heure rallumer ?"""
    assert plage_depuis_config({"dpms": {"allumage": "05:30", "extinction": "21:30"}}) == ("05:30", "21:30")
    assert plage_depuis_config({"dpms": {"allumage": "05:30"}}) is None
    assert plage_depuis_config({"dpms": {"allumage": "05:30", "extinction": "?"}}) is None
    assert plage_depuis_config({}) is None
    assert plage_depuis_config({"dpms": None}) is None


def test_conf_relue_par_le_lecteur_ini_du_poste():
    """Le fichier ecrit doit etre lisible par deploy/lib.sh (section [dpms])."""
    contenu = rendu_conf("04:45", "22:15")
    assert "[dpms]" in contenu
    assert "allumage = 04:45" in contenu
    assert "extinction = 22:15" in contenu
    # L'exploitant qui l'ouvre doit comprendre qu'il ne sert a rien de l'editer.
    assert "NE PAS EDITER" in contenu


def test_ecriture_puis_idempotence(tmp_path):
    config = {"dpms": {"allumage": "05:30", "extinction": "21:30"}}
    chemin = ecrire_plage(str(tmp_path), config)
    assert chemin == str(tmp_path / NOM_FICHIER)
    assert "allumage = 05:30" in (tmp_path / NOM_FICHIER).read_text(encoding="utf-8")

    # Rien n'a change : on ne reecrit pas (la date du fichier reste celle du
    # dernier changement REEL de plage).
    assert ecrire_plage(str(tmp_path), config) is None

    # La plage bouge : le fichier suit.
    assert ecrire_plage(str(tmp_path), {"dpms": {"allumage": "06:00", "extinction": "20:00"}})
    assert "allumage = 06:00" in (tmp_path / NOM_FICHIER).read_text(encoding="utf-8")


def test_config_illisible_n_ecrase_jamais_la_plage_connue(tmp_path):
    """Un serveur qui bafouille ne doit pas eteindre l'ecran a une heure au hasard."""
    ecrire_plage(str(tmp_path), {"dpms": {"allumage": "05:30", "extinction": "21:30"}})
    for mauvaise in ({}, {"dpms": {}}, {"dpms": {"allumage": "nawak", "extinction": "21:30"}}):
        assert ecrire_plage(str(tmp_path), mauvaise) is None
    assert "allumage = 05:30" in (tmp_path / NOM_FICHIER).read_text(encoding="utf-8")


def test_echec_d_ecriture_ne_leve_pas(tmp_path):
    """L'ecran n'est pas la fonction vitale du poste : le badgeage l'est.

    Le repertoire de donnees est ici un FICHIER ordinaire : l'ecriture est donc
    impossible quel que soit l'utilisateur qui joue le test (un test fonde sur
    des permissions passerait a cote sous root, qui les ignore).
    """
    faux_repertoire = tmp_path / "pas-un-repertoire"
    faux_repertoire.write_text("", encoding="utf-8")
    assert ecrire_plage(str(faux_repertoire), {"dpms": {"allumage": "05:30", "extinction": "21:30"}}) is None


def test_aucun_fichier_temporaire_laisse_derriere(tmp_path):
    ecrire_plage(str(tmp_path), {"dpms": {"allumage": "05:30", "extinction": "21:30"}})
    assert [p.name for p in tmp_path.iterdir()] == [NOM_FICHIER]
