"""Message affiché au badgeage : moment de la journée, gabarits, festif.

Module **PUR** (stdlib seule) : aucune E/S, aucune horloge implicite, aucune
dépendance réseau. Tout ce qui décide de ce qui s'affiche sur l'écran au
moment du badge se calcule ici, donc se teste sans matériel.

Périmètre exact (CDC_AFFICHAGE_V2 §1, ADR-0004) :

- le **moment** (``matin`` / ``pause`` / ``retour`` / ``soir``) se déduit du
  sens du pointage et de l'heure murale locale, dans des plages **entièrement
  paramétrées par le serveur** (ADR-0002 : aucune règle en dur — les valeurs
  de :data:`PLAGES_DEFAUT` ne sont qu'un repli affiché tant que la Direction
  n'a rien arbitré) ;
- le **message** est un gabarit à variables ``{prenom}`` / ``{annees}``,
  tronqué : un gabarit mal saisi ne doit jamais casser la mise en page d'un
  écran lu à 5 m ;
- le **festif** (anniversaire, anniversaire d'entreprise, premier jour) se
  décide sur les **drapeaux booléens** du cache badges — jamais sur une date
  de naissance, qui ne transite pas (CONTRAT_API_DEVICE §3bis, ADR-0004 §4).

Ce que ce module ne fait PAS, par conception : il ne connaît ni le nom de
famille (seuls prénom + initiale existent côté poste, ADR-0004 §1), ni le
profil PCM (ADR-0004 §2), ni aucun statut de parcours (ADR-0004 §3).
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

# --------------------------------------------------------------------- moments

MATIN = "matin"
PAUSE = "pause"
RETOUR = "retour"
SOIR = "soir"

#: Les quatre moments de la journée (CDC_AFFICHAGE_V2 §1).
MOMENTS = (MATIN, PAUSE, RETOUR, SOIR)

#: Sens d'un pointage qui bascule sur la branche « départ ». Toute autre
#: valeur (``entree``, mais aussi ``inconnu`` ou une valeur future) est
#: traitée comme une ARRIVÉE : en cas de doute, on salue plutôt qu'on ne
#: souhaite une bonne fin de journée à quelqu'un qui arrive.
SENS_SORTIE = "sortie"

#: Plages par défaut (CDC_AFFICHAGE_V2 §1). Repli seulement : le serveur
#: envoie ``plages_moments`` dans le bloc ``affichage`` de la config.
PLAGES_DEFAUT = {
    "moment_matin_fin": "11:30",
    "pause_debut": "11:00",
    "pause_fin": "14:00",
    "retour_fin": "15:00",
    "soir_debut": "14:00",
}

#: Bascule du repli « avant / après midi » quand aucune plage n'est exploitable.
MIDI_MINUTES = 12 * 60

# -------------------------------------------------------------------- messages

#: Longueur maximale d'un message d'overlay, en caractères. Au-delà, le texte
#: est tronqué (cf. :func:`tronquer`) : sur un écran lu à 5 m, un gabarit
#: bavard déborde et rend l'information principale illisible.
MESSAGE_MAX = 120

#: Gabarits par défaut (CDC_AFFICHAGE_V2 §1). Le serveur les surcharge via
#: ``affichage.messages`` ; ceux-ci ne servent que tant que rien n'est
#: paramétré, pour que l'écran ne soit jamais muet.
MESSAGES_DEFAUT = {
    MATIN: "Bonjour, {prenom} !",
    PAUSE: "Bon appétit, {prenom} !",
    RETOUR: "Bon après-midi, {prenom} !",
    SOIR: "Bonne fin de journée, {prenom} !",
    "premier_jour": "Bienvenue chez Solidarité Textiles, {prenom} !",
    "anniversaire": "Joyeux anniversaire, {prenom} !",
    "anniversaire_entreprise": "{annees} ans avec nous, {prenom} !",
}

# ---------------------------------------------------------------------- festif

FESTIF_PREMIER_JOUR = "premier_jour"
FESTIF_ANNIVERSAIRE = "anniversaire"
FESTIF_ANNIVERSAIRE_ENTREPRISE = "anniversaire_entreprise"

#: Ordre de priorité des écrans festifs : **un seul** s'affiche à la fois
#: (CDC_AFFICHAGE_V2 §1 — l'overlay est plafonné à 8 s, on ne les empile pas).
#: Le premier jour prime : c'est le seul qui ne se reproduira jamais.
FESTIF_PRIORITE = (
    FESTIF_PREMIER_JOUR,
    FESTIF_ANNIVERSAIRE,
    FESTIF_ANNIVERSAIRE_ENTREPRISE,
)

# --------------------------------------------------------------------- overlay

#: Plafond juridique de l'affichage nominatif, en secondes (AFF-01,
#: NOTE_JURIDIQUE §3.5). Triple verrou : le serveur borne, **le poste re-borne
#: ici**, l'interface re-borne une troisième fois. Défini dans ce module PUR
#: pour que le plafond soit prouvable par un test sans dépendance ;
#: ``ws_server`` le ré-exporte pour ses appelants historiques.
OVERLAY_MIN_SEC = 3
OVERLAY_MAX_SEC = 8


def clamp_overlay(duree: Any, defaut: int = 5) -> int:
    """Borne la durée d'overlay entre 3 et 8 secondes.

    Une valeur illisible (``None``, texte, NaN) retombe sur ``defaut`` : jamais
    d'affichage nominatif prolongé par un accident de configuration.
    """
    try:
        valeur = float(duree)
    except (TypeError, ValueError):
        return defaut
    if valeur != valeur:  # NaN — jamais égal à lui-même
        return defaut
    return max(OVERLAY_MIN_SEC, min(OVERLAY_MAX_SEC, int(round(valeur))))


# ------------------------------------------------------------------- horaires


def parse_hhmm(valeur: Any) -> Optional[int]:
    """Convertit ``"HH:MM"`` (ou ``"HH:MM:SS"``) en minutes depuis minuit.

    Tolérante à la forme (``"8:05"`` accepté, secondes ignorées) mais stricte
    sur le fond : hors bornes ou illisible → ``None``, jamais une valeur
    approchée. L'appelant applique alors son repli documenté.
    """
    if valeur is None:
        return None
    texte = str(valeur).strip()
    if not texte or ":" not in texte:
        return None

    morceaux = texte.split(":")
    try:
        heures = int(morceaux[0])
        minutes = int(morceaux[1])
    except (ValueError, IndexError):
        return None

    if not (0 <= heures <= 23) or not (0 <= minutes <= 59):
        return None
    return heures * 60 + minutes


def _bornes(plages: Optional[Mapping[str, Any]]) -> dict:
    """Plages effectives, en minutes : valeur serveur si lisible, sinon défaut."""
    source: Mapping[str, Any] = plages if isinstance(plages, Mapping) else {}
    bornes = {}
    for cle, defaut in PLAGES_DEFAUT.items():
        bornes[cle] = parse_hhmm(source.get(cle, defaut))
        if bornes[cle] is None:
            # Valeur serveur illisible : on retombe sur le défaut documenté
            # plutôt que de désactiver silencieusement la plage.
            bornes[cle] = parse_hhmm(defaut)
    return bornes


def determine_moment(
    sens: Any,
    heure_locale_hhmm: Any,
    plages: Optional[Mapping[str, Any]] = None,
) -> str:
    """Moment de la journée d'un pointage (CDC_AFFICHAGE_V2 §1).

    Règles, dans cet ordre :

    - **entrée** avant ``moment_matin_fin`` → ``matin`` ;
    - **sortie** dans ``[pause_debut, pause_fin[`` → ``pause`` ;
    - **entrée** dans ``[moment_matin_fin, retour_fin[`` → ``retour`` ;
    - **sortie** à partir de ``soir_debut`` → ``soir``.

    Les intervalles sont **semi-ouverts** (borne de début incluse, borne de fin
    exclue) : une heure pile ne peut jamais appartenir à deux moments, quel que
    soit le paramétrage.

    **Repli, quand l'heure ne tombe dans aucune plage** (paramétrage partiel,
    pointage nocturne, heure illisible) — jamais d'erreur affichée à l'écran :

    - une **entrée** donne ``matin`` avant 12:00, ``retour`` ensuite ;
    - une **sortie** donne toujours ``soir`` (c'est un départ : lui souhaiter
      une bonne fin de journée reste juste à toute heure).

    :param sens: ``entree`` / ``sortie``. Toute valeur autre que ``sortie``
        est traitée comme une arrivée (cf. :data:`SENS_SORTIE`).
    :param heure_locale_hhmm: heure **murale locale** (Europe/Paris),
        ``"HH:MM"`` ou ``"HH:MM:SS"``.
    :param plages: bloc ``affichage.plages_moments`` du serveur ; les clés
        absentes ou illisibles retombent sur :data:`PLAGES_DEFAUT`.
    """
    bornes = _bornes(plages)
    minutes = parse_hhmm(heure_locale_hhmm)
    depart = str(sens or "").strip().lower() == SENS_SORTIE

    if minutes is None:
        # Sans horloge lisible, on ne devine pas : repli par sens.
        return SOIR if depart else MATIN

    if depart:
        debut, fin = bornes["pause_debut"], bornes["pause_fin"]
        if debut is not None and fin is not None and debut <= minutes < fin:
            return PAUSE
        return SOIR

    matin_fin = bornes["moment_matin_fin"]
    if matin_fin is not None and minutes < matin_fin:
        return MATIN

    retour_fin = bornes["retour_fin"]
    if (
        matin_fin is not None
        and retour_fin is not None
        and matin_fin <= minutes < retour_fin
    ):
        return RETOUR

    return MATIN if minutes < MIDI_MINUTES else RETOUR


# -------------------------------------------------------------------- messages


def tronquer(texte: str, maximum: int = MESSAGE_MAX) -> str:
    """Tronque en signalant la coupe, sans jamais dépasser ``maximum``.

    Le caractère de fin est un point de suspension : un texte coupé se voit,
    plutôt que de laisser croire à un message complet mais absurde.
    """
    if maximum <= 0:
        return ""
    if len(texte) <= maximum:
        return texte
    return texte[: maximum - 1].rstrip() + "…"


def render_message(gabarit: Any, prenom: Any, annees: Any = None) -> str:
    """Rend un gabarit d'affichage : ``{prenom}`` et ``{annees}`` substitués.

    - un gabarit vide ou absent renvoie ``""`` (l'appelant décide du repli —
      on n'invente pas un message à la place de la Direction) ;
    - ``annees`` à ``None`` remplace ``{annees}`` par du vide ;
    - les espaces laissés par une variable vide sont recompactés, pour qu'un
      prénom manquant ne produise pas « Bonjour,  ! » à l'écran ;
    - le résultat est tronqué à :data:`MESSAGE_MAX` caractères.

    Aucune autre variable n'est interprétée : ce n'est pas un moteur de
    gabarits, et ``str.format`` n'est délibérément pas utilisé (une accolade
    saisie par erreur dans le back-office ne doit jamais lever d'exception ni
    donner accès à des attributs).
    """
    texte = str(gabarit or "").strip()
    if not texte:
        return ""

    remplacements = {
        "{prenom}": str(prenom or "").strip(),
        "{annees}": "" if annees is None else str(annees),
    }
    for jeton, valeur in remplacements.items():
        texte = texte.replace(jeton, valeur)

    texte = " ".join(texte.split())
    return tronquer(texte)


def gabarit_pour(messages: Optional[Mapping[str, Any]], cle: str) -> str:
    """Gabarit paramétré pour une clé, sinon gabarit par défaut."""
    source: Mapping[str, Any] = messages if isinstance(messages, Mapping) else {}
    valeur = source.get(cle)
    if valeur is not None and str(valeur).strip():
        return str(valeur)
    return MESSAGES_DEFAUT.get(cle, "")


def message_du_moment(
    moment: str,
    prenom: Any,
    messages: Optional[Mapping[str, Any]] = None,
) -> str:
    """Message rendu pour un moment donné (gabarit serveur ou défaut)."""
    return render_message(gabarit_pour(messages, moment), prenom)


# ---------------------------------------------------------------------- festif


def annees_entreprise(valeur: Any) -> Optional[int]:
    """Ancienneté exploitable pour un écran festif, sinon ``None``.

    Garde d'honnêteté : une valeur absente, illisible ou inférieure à 1 an ne
    produit **aucun** affichage (« 0 ans avec nous ! » n'a pas de sens, et la
    première année relève du premier jour, pas de l'anniversaire d'entrée).
    """
    if valeur is None or isinstance(valeur, bool):
        return None
    try:
        annees = int(valeur)
    except (TypeError, ValueError):
        return None
    return annees if annees >= 1 else None


def festif_du_badge(
    badge: Optional[Mapping[str, Any]],
    messages: Optional[Mapping[str, Any]] = None,
    *,
    actif: bool = True,
    premier_jour_actif: bool = True,
) -> Optional[dict]:
    """Écran festif à afficher pour ce badge, ou ``None``.

    **Un seul** festif à la fois, dans l'ordre de :data:`FESTIF_PRIORITE`
    (premier jour > anniversaire > anniversaire d'entreprise).

    Les drapeaux viennent du cache badges (CONTRAT_API_DEVICE §3bis) : ils ne
    sont posés par le serveur que si le salarié a donné son **accord
    individuel** (ADR-0004 §4). Le poste ne recalcule rien et ne connaît
    aucune date : si le drapeau est absent, il n'y a pas de festif, point.

    :param actif: interrupteur ``affichage.festif_actif``.
    :param premier_jour_actif: interrupteur distinct du message de bienvenue
        (CDC_AFFICHAGE_V2 §4 : trois interrupteurs indépendants).
    """
    if not actif or not isinstance(badge, Mapping):
        return None

    prenom = badge.get("prenom")
    type_festif: Optional[str] = None
    annees: Optional[int] = None

    if premier_jour_actif and badge.get(FESTIF_PREMIER_JOUR):
        type_festif = FESTIF_PREMIER_JOUR
    elif badge.get(FESTIF_ANNIVERSAIRE):
        type_festif = FESTIF_ANNIVERSAIRE
    else:
        annees = annees_entreprise(badge.get("anniversaire_entreprise_annees"))
        if annees is not None:
            type_festif = FESTIF_ANNIVERSAIRE_ENTREPRISE

    if type_festif is None:
        return None

    message = render_message(gabarit_pour(messages, type_festif), prenom, annees)
    if not message:
        # Gabarit vidé volontairement dans le back-office : pas d'écran festif
        # muet, on retombe simplement sur l'overlay ordinaire.
        return None

    festif = {"type": type_festif, "message": message}
    if annees is not None:
        festif["annees"] = annees
    return festif


# ------------------------------------------------------- assemblage du message


def bloc_affichage(config: Optional[Mapping[str, Any]]) -> Mapping[str, Any]:
    """Bloc ``affichage`` de la config serveur (CONTRAT_API_DEVICE §3bis).

    Absent (serveur encore en v1.2) → dictionnaire vide : l'écran retombe sur
    les gabarits par défaut, sans festif ni phrase. Rétro-compatible.
    """
    if not isinstance(config, Mapping):
        return {}
    bloc = config.get("affichage")
    return bloc if isinstance(bloc, Mapping) else {}


def construire_badge_ok(
    *,
    badge: Optional[Mapping[str, Any]],
    sens: str,
    heure_locale: str,
    affichage: Optional[Mapping[str, Any]] = None,
    phrase_motivation: Optional[str] = None,
    overlay_duree_sec: Any = 5,
    cumul_hebdo: Optional[str] = None,
) -> dict:
    """Message WebSocket ``badge_ok`` complet (CDC_AFFICHAGE_V2 §1).

    Fonction **PURE** : c'est le point d'assemblage unique de ce qui s'affiche
    au badgeage, donc le point où la conformité se vérifie par un test —
    prénom + initiale seulement, overlay plafonné, un seul festif.

    ``phrase_motivation`` est injectée par l'appelant (elle dépend de la date
    du jour, cf. :mod:`badgeuse_agent.motivation`) ; ``None`` ou vide devient
    ``None`` dans la charge utile : l'interface n'affiche alors aucune ligne.
    """
    source: Mapping[str, Any] = badge if isinstance(badge, Mapping) else {}
    bloc = affichage if isinstance(affichage, Mapping) else {}
    messages = bloc.get("messages") if isinstance(bloc.get("messages"), Mapping) else {}

    moment = determine_moment(sens, heure_locale, bloc.get("plages_moments"))
    prenom = str(source.get("prenom") or "")

    festif = festif_du_badge(
        source,
        messages,
        actif=bool(bloc.get("festif_actif", False)),
        premier_jour_actif=bool(bloc.get("premier_jour_actif", True)),
    )

    phrase = str(phrase_motivation or "").strip() or None

    return {
        "type": "badge_ok",
        # Identité : prénom + initiale, jamais davantage (ADR-0004 §1).
        "prenom": prenom,
        "initiale": str(source.get("initiale") or ""),
        "sens": sens,
        "heure_locale": heure_locale,
        "moment": moment,
        "message": message_du_moment(moment, prenom, messages),
        "phrase_motivation": phrase,
        "festif": festif,
        "cumul_hebdo": cumul_hebdo,
        "overlay_duree_sec": clamp_overlay(overlay_duree_sec),
    }
