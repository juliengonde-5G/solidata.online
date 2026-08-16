"""Phrase de motivation du jour — vivier générique, rotation déterministe.

Module **PUR** (stdlib seule).

Ce que ce module est, et n'est pas (ADR-0004 §2, décision structurante) : la
phrase est tirée d'un **vivier générique paramétrable**, identique pour tout
le monde, qui tourne au fil des jours. Elle n'est **jamais** dérivée du profil
PCM ni d'aucune donnée individuelle — afficher publiquement une phrase déduite
d'un profil psychologique serait un détournement de finalité. Le poste ne
reçoit d'ailleurs aucune donnée de profil : la contrainte est tenue par
construction, pas par bonne volonté.

Rotation : ``jour de l'année % taille du vivier`` (CDC_AFFICHAGE_V2 §1). Donc
**déterministe** — tous les postes d'un site affichent la même phrase le même
jour, et deux badgeages du même jour ne changent pas de phrase en cours de
route (ce qui donnerait l'impression d'un message personnalisé).
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Optional, Sequence

from .moments import tronquer

#: Longueur maximale d'une phrase affichée, en caractères. Elle passe sous le
#: message principal, en plus petit : au-delà, elle déborde de l'overlay.
PHRASE_MAX = 160


def _jour_de_l_annee(date_iso: Any) -> Optional[int]:
    """Quantième (1–366) d'une date ISO, d'un ``date`` ou d'un ``datetime``.

    ``None`` si la valeur est illisible : l'appelant n'affiche alors aucune
    phrase, plutôt qu'une phrase tirée d'une date inventée.
    """
    if isinstance(date_iso, _dt.datetime):
        return date_iso.timetuple().tm_yday
    if isinstance(date_iso, _dt.date):
        return date_iso.timetuple().tm_yday

    texte = str(date_iso or "").strip()
    if not texte:
        return None
    # Une date ISO complète ("2026-08-16T09:12:00") est acceptée : on ne
    # retient que la partie calendaire.
    texte = texte.split("T", 1)[0].split(" ", 1)[0]
    try:
        return _dt.date.fromisoformat(texte).timetuple().tm_yday
    except (ValueError, TypeError):
        return None


def vivier(phrases: Any) -> list:
    """Vivier nettoyé : phrases non vides, espaces recompactés, ordre conservé.

    L'ordre est conservé **volontairement** : c'est lui qui rend la rotation
    reproductible et vérifiable depuis le back-office (« aujourd'hui, c'est la
    troisième de la liste »).
    """
    if not isinstance(phrases, (list, tuple)):
        return []
    nettoyees = []
    for brute in phrases:
        texte = " ".join(str(brute or "").split())
        if texte:
            nettoyees.append(tronquer(texte, PHRASE_MAX))
    return nettoyees


def phrase_du_jour(phrases: Any, date_iso: Any, *, active: bool = True) -> str:
    """Phrase du vivier pour la date donnée, ou ``""``.

    Renvoie une chaîne vide — jamais ``None``, jamais un texte de remplacement
    — dans tous les cas dégradés : interrupteur ``motivation_active`` à faux,
    vivier absent ou vide, date illisible. L'interface n'affiche alors
    simplement pas la ligne.

    :param phrases: vivier ``affichage.phrases_motivation`` du serveur.
    :param date_iso: jour civil local, ``"AAAA-MM-JJ"`` (ou ``date`` /
        ``datetime``). Injecté par l'appelant : ce module ne lit jamais
        l'horloge, il reste donc testable et reproductible.
    :param active: interrupteur ``affichage.motivation_active``.
    """
    if not active:
        return ""

    disponibles: Sequence[str] = vivier(phrases)
    if not disponibles:
        return ""

    jour = _jour_de_l_annee(date_iso)
    if jour is None:
        return ""

    return disponibles[jour % len(disponibles)]
