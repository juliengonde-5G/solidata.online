"""Anti-rebond — PST-02 (fenêtre paramétrable par badge, défaut 5 min).

La fenêtre est passée de 8 s à 300 s : 8 s ne couvrait que le rebond MATÉRIEL
du lecteur, alors que le geste qui casse les journées est humain (représenter
son badge par doute une demi-minute plus tard). Ces tests raisonnent donc en
« fenêtre », sans réécrire une constante en dur à chaque assertion.
"""

import pytest

from badgeuse_agent.debounce import DEFAULT_WINDOW_SEC, Debouncer

UID_A = "a" * 64
UID_B = "b" * 64


class FakeClock:
    """Horloge injectée : le temps n'avance que sur demande du test."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_fenetre_par_defaut_a_5_minutes():
    """Repli du poste aligné sur le défaut serveur `badgeuse.anti_rebond_sec`."""
    assert DEFAULT_WINDOW_SEC == 300.0


def test_premiere_presentation_acceptee():
    assert Debouncer(clock=FakeClock()).accept(UID_A) is True


def test_meme_badge_dans_la_fenetre_rejete():
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    assert debouncer.accept(UID_A) is True
    clock.advance(DEFAULT_WINDOW_SEC - 0.1)
    assert debouncer.accept(UID_A) is False


def test_representation_apres_30_secondes_rejetee():
    """Le cas RÉEL du terrain : on doute, on rebadge une demi-minute plus tard.

    À 8 s cette présentation était acceptée en silence et produisait un second
    pointage — sens alterné, journée refermée sur une paire de 30 s.
    """
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    assert debouncer.accept(UID_A) is True
    clock.advance(30.0)
    assert debouncer.accept(UID_A) is False


def test_a_la_borne_exacte_de_la_fenetre_le_pointage_passe():
    """La borne est inclusive : à la seconde près, le pointage repasse."""
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    debouncer.accept(UID_A)
    clock.advance(DEFAULT_WINDOW_SEC)
    assert debouncer.accept(UID_A) is True


def test_badges_differents_independants():
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    assert debouncer.accept(UID_A) is True
    clock.advance(0.2)
    assert debouncer.accept(UID_B) is True


def test_carte_laissee_devant_le_lecteur_ne_prolonge_pas_la_fenetre():
    """Rejeter ne réarme pas le compteur, sinon le badge resterait bloqué."""
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    debouncer.accept(UID_A)
    for _ in range(10):
        clock.advance(DEFAULT_WINDOW_SEC / 20)
        debouncer.accept(UID_A)  # rebonds successifs
    clock.advance(DEFAULT_WINDOW_SEC / 2)  # fenêtre écoulée depuis la présentation retenue
    assert debouncer.accept(UID_A) is True


def test_fenetre_parametrable_depuis_la_config_serveur():
    clock = FakeClock()
    debouncer = Debouncer(window_sec=3.0, clock=clock)
    debouncer.accept(UID_A)
    clock.advance(3.0)
    assert debouncer.accept(UID_A) is True

    debouncer.set_window(20.0)
    clock.advance(10.0)
    assert debouncer.accept(UID_A) is False


def test_temps_restant_expose_pour_le_message_deja_enregistre():
    clock = FakeClock()
    debouncer = Debouncer(window_sec=8.0, clock=clock)
    debouncer.accept(UID_A)
    clock.advance(3.0)
    assert debouncer.remaining(UID_A) == pytest.approx(5.0)
    clock.advance(10.0)
    assert debouncer.remaining(UID_A) == 0.0


def test_anciennete_exposee_pour_dire_depuis_quand_le_badge_est_enregistre():
    """« Déjà enregistré » sans repère n'apprend rien à la personne.

    C'est cette valeur que l'écran transforme en « il y a 3 minutes ».
    """
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    debouncer.accept(UID_A)
    clock.advance(185.0)
    assert debouncer.elapsed(UID_A) == pytest.approx(185.0)


def test_anciennete_inconnue_rendue_none_jamais_zero():
    """Un badge jamais vu n'a pas une ancienneté de 0 s : elle est INCONNUE."""
    assert Debouncer(clock=FakeClock()).elapsed(UID_A) is None


def test_badge_inconnu_du_debounceur_sans_attente():
    assert Debouncer(clock=FakeClock()).remaining(UID_A) == 0.0


def test_memoire_bornee_par_l_oubli_des_anciennes():
    clock = FakeClock()
    debouncer = Debouncer(window_sec=8.0, clock=clock)
    for index in range(500):
        debouncer.accept(f"{index:064x}")
        clock.advance(1.0)
    assert len(debouncer._last_seen) < 100


def test_memoire_bornee_meme_avec_une_fenetre_tres_large():
    """Une fenêtre longue ne doit pas faire dériver la mémoire du poste.

    Avec 300 s, l'horizon d'oubli est de 20 minutes : sur un flux soutenu,
    l'oubli par ancienneté ne retire plus rien. Un plafond dur prend le relais.
    """
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    for index in range(5000):
        debouncer.accept(f"{index:064x}")
        clock.advance(0.05)
    assert len(debouncer._last_seen) <= 512


def test_fenetre_negative_refusee():
    with pytest.raises(ValueError):
        Debouncer(window_sec=-1)
