"""Dérive d'horloge — PST-07 (seuil d'alerte 2 s)."""

import datetime as dt

import pytest

from badgeuse_agent.clock import (
    DRIFT_ALERT_SEC,
    DriftMonitor,
    estimate_drift,
    is_drift_alert,
)


def utc(second, microsecond=0):
    return dt.datetime(2026, 8, 17, 6, 58, second, microsecond, tzinfo=dt.timezone.utc)


def test_seuil_du_contrat():
    assert DRIFT_ALERT_SEC == 2.0


def test_horloges_alignees():
    assert estimate_drift(utc(12), utc(12)) == 0.0


def test_poste_en_avance_derive_positive():
    assert estimate_drift(utc(15), utc(12)) == 3.0


def test_poste_en_retard_derive_negative():
    assert estimate_drift(utc(9), utc(12)) == -3.0


def test_derive_infra_seconde():
    assert estimate_drift(utc(12, 400000), utc(12)) == pytest.approx(0.4)


def test_accepte_les_chaines_iso():
    assert estimate_drift(
        "2026-08-17T06:58:15.000Z", "2026-08-17T06:58:12.000Z"
    ) == 3.0


def test_alerte_au_dela_du_seuil():
    assert is_drift_alert(2.5) is True
    assert is_drift_alert(-2.5) is True
    assert is_drift_alert(2.0) is False
    assert is_drift_alert(0.4) is False


def test_pas_d_alerte_sans_mesure():
    assert is_drift_alert(None) is False


def test_moniteur_sans_reponse_serveur():
    """Tant que le serveur n'a rien renvoyé, la dérive reste inconnue."""
    monitor = DriftMonitor()
    assert monitor.drift_sec is None
    assert monitor.in_alert() is False


def test_moniteur_observe_et_alerte():
    monitor = DriftMonitor()
    assert monitor.observe(utc(12), utc(12)) == 0.0
    assert monitor.in_alert() is False

    monitor.observe(utc(20), utc(12))
    assert monitor.drift_sec == 8.0
    assert monitor.in_alert() is True
    assert monitor.observed_at == utc(20)


def test_moniteur_hors_ligne_conserve_la_derniere_mesure():
    """Sans horodatage serveur, on ne fabrique pas une dérive nulle."""
    monitor = DriftMonitor()
    monitor.observe(utc(20), utc(12))
    assert monitor.observe(utc(30), None) == 8.0
    assert monitor.drift_sec == 8.0


def test_horodatage_serveur_illisible_conserve_la_derniere_mesure():
    monitor = DriftMonitor()
    monitor.observe(utc(20), utc(12))
    assert monitor.observe(utc(30), "pas une date") == 8.0


def test_seuil_personnalise():
    monitor = DriftMonitor(threshold=10.0)
    monitor.observe(utc(20), utc(12))
    assert monitor.in_alert() is False


def test_instant_naif_traite_comme_utc():
    naif = dt.datetime(2026, 8, 17, 6, 58, 15)
    assert estimate_drift(naif, utc(12)) == 3.0


def test_type_invalide_refuse():
    with pytest.raises(TypeError):
        estimate_drift(1234567890, utc(12))
