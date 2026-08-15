"""Sens entrée / sortie — PST-03 (alternance sur le jour civil Europe/Paris)."""

import datetime as dt

from badgeuse_agent.sens import ENTREE, INCONNU, SORTIE, civil_day, determine_sens


def utc(year, month, day, hour, minute=0):
    return dt.datetime(year, month, day, hour, minute, tzinfo=dt.timezone.utc)


def test_premier_pointage_de_la_journee_est_une_entree():
    assert determine_sens([], utc(2026, 8, 17, 6, 58)) == ENTREE


def test_alternance_apres_une_entree():
    events = [(utc(2026, 8, 17, 6, 58), ENTREE)]
    assert determine_sens(events, utc(2026, 8, 17, 15, 2)) == SORTIE


def test_alternance_apres_une_sortie():
    events = [
        (utc(2026, 8, 17, 6, 58), ENTREE),
        (utc(2026, 8, 17, 11, 30), SORTIE),
    ]
    assert determine_sens(events, utc(2026, 8, 17, 12, 15)) == ENTREE


def test_quatre_pointages_dans_la_journee():
    """Cas nominal NOTE_RH : entrée, sortie pause, retour, sortie."""
    moments = [utc(2026, 8, 17, 6, 0), utc(2026, 8, 17, 10, 0),
               utc(2026, 8, 17, 11, 0), utc(2026, 8, 17, 15, 0)]
    events = []
    attendus = [ENTREE, SORTIE, ENTREE, SORTIE]
    for moment, attendu in zip(moments, attendus):
        calcule = determine_sens(events, moment)
        assert calcule == attendu
        events.append((moment, calcule))


def test_le_dernier_pointage_fait_foi_quel_que_soit_l_ordre_recu():
    events = [
        (utc(2026, 8, 17, 11, 30), SORTIE),
        (utc(2026, 8, 17, 6, 58), ENTREE),
    ]
    assert determine_sens(events, utc(2026, 8, 17, 12, 15)) == ENTREE


def test_pointage_de_la_veille_ignore():
    """Nouvelle journée civile : le compteur repart sur une entrée."""
    events = [(utc(2026, 8, 16, 15, 0), ENTREE)]
    assert determine_sens(events, utc(2026, 8, 17, 6, 58)) == ENTREE


def test_pointage_orphelin_ne_porte_pas_l_alternance():
    events = [
        (utc(2026, 8, 17, 6, 58), ENTREE),
        (utc(2026, 8, 17, 7, 5), INCONNU),
    ]
    assert determine_sens(events, utc(2026, 8, 17, 15, 0)) == SORTIE


def test_evenement_posterieur_ignore():
    events = [(utc(2026, 8, 17, 20, 0), ENTREE)]
    assert determine_sens(events, utc(2026, 8, 17, 6, 58)) == ENTREE


# --------------------------------------------------------- jour civil de Paris


def test_jour_civil_ete_decalage_deux_heures():
    """22h30 UTC le 17 août = 00h30 à Paris le 18 : journée du 18."""
    assert civil_day(utc(2026, 8, 17, 22, 30)) == dt.date(2026, 8, 18)


def test_jour_civil_hiver_decalage_une_heure():
    """23h30 UTC le 17 janvier = 00h30 à Paris le 18."""
    assert civil_day(utc(2026, 1, 17, 23, 30)) == dt.date(2026, 1, 18)


def test_equipe_de_nuit_franchit_minuit_a_paris():
    """Un pointage à 00h30 heure de Paris ouvre une nouvelle journée."""
    veille = utc(2026, 8, 17, 20, 0)  # 22h00 à Paris, le 17
    apres_minuit = utc(2026, 8, 17, 22, 30)  # 00h30 à Paris, le 18
    assert determine_sens([(veille, ENTREE)], apres_minuit) == ENTREE


def test_meme_journee_de_paris_malgre_changement_de_jour_utc():
    """23h00 puis 23h50 UTC en hiver : même journée locale (le 18)."""
    premier = utc(2026, 1, 17, 23, 5)  # 00h05 Paris le 18
    second = utc(2026, 1, 17, 23, 50)  # 00h50 Paris le 18
    assert determine_sens([(premier, ENTREE)], second) == SORTIE


def test_bascule_heure_ete_derniere_dimanche_de_mars():
    """29/03/2026 01h00 UTC : Paris passe de +1 à +2."""
    assert civil_day(utc(2026, 3, 29, 0, 30)) == dt.date(2026, 3, 29)
    assert civil_day(utc(2026, 3, 29, 1, 30)) == dt.date(2026, 3, 29)


def test_bascule_heure_hiver_dernier_dimanche_d_octobre():
    """25/10/2026 01h00 UTC : Paris repasse de +2 à +1."""
    assert civil_day(utc(2026, 10, 24, 22, 30)) == dt.date(2026, 10, 25)
    assert civil_day(utc(2026, 10, 25, 23, 30)) == dt.date(2026, 10, 26)


# --------------------------------------------------------- formes d'entrée


def test_accepte_les_mappings():
    events = [{"horodatage_utc": utc(2026, 8, 17, 6, 58), "sens": ENTREE}]
    assert determine_sens(events, utc(2026, 8, 17, 15, 0)) == SORTIE


def test_accepte_les_horodatages_iso():
    events = [{"horodatage_utc": "2026-08-17T06:58:12.031Z", "sens": ENTREE}]
    assert determine_sens(events, utc(2026, 8, 17, 15, 0)) == SORTIE


def test_entrees_illisibles_ignorees_sans_planter():
    events = [None, "n'importe quoi", {"sens": ENTREE}, 42]
    assert determine_sens(events, utc(2026, 8, 17, 6, 58)) == ENTREE


def test_horodatage_naif_traite_comme_utc():
    events = [(dt.datetime(2026, 8, 17, 6, 58), ENTREE)]
    assert determine_sens(events, utc(2026, 8, 17, 15, 0)) == SORTIE
