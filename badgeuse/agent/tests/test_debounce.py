"""Anti-rebond — PST-02 (fenêtre 8 s par badge)."""

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


def test_fenetre_par_defaut_a_8_secondes():
    assert DEFAULT_WINDOW_SEC == 8.0


def test_premiere_presentation_acceptee():
    assert Debouncer(clock=FakeClock()).accept(UID_A) is True


def test_meme_badge_sous_8_secondes_rejete():
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    assert debouncer.accept(UID_A) is True
    clock.advance(7.9)
    assert debouncer.accept(UID_A) is False


def test_meme_badge_a_8_secondes_accepte():
    """La borne est inclusive : à 8 s exactement, le pointage passe."""
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    debouncer.accept(UID_A)
    clock.advance(8.0)
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
    for _ in range(7):
        clock.advance(1.0)
        debouncer.accept(UID_A)  # rebonds successifs
    clock.advance(1.0)  # 8 s après la présentation retenue
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
    debouncer = Debouncer(clock=clock)
    debouncer.accept(UID_A)
    clock.advance(3.0)
    assert debouncer.remaining(UID_A) == pytest.approx(5.0)
    clock.advance(10.0)
    assert debouncer.remaining(UID_A) == 0.0


def test_badge_inconnu_du_debounceur_sans_attente():
    assert Debouncer(clock=FakeClock()).remaining(UID_A) == 0.0


def test_memoire_bornee():
    clock = FakeClock()
    debouncer = Debouncer(clock=clock)
    for index in range(500):
        debouncer.accept(f"{index:064x}")
        clock.advance(1.0)
    assert len(debouncer._last_seen) < 100


def test_fenetre_negative_refusee():
    with pytest.raises(ValueError):
        Debouncer(window_sec=-1)
