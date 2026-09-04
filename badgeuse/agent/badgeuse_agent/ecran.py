"""Plage d'activation de l'ecran : ce que le SERVEUR decide, ecrit sur le poste.

Pourquoi ce module existe
-------------------------
Les heures d'allumage et d'extinction de l'ecran (AFF-08) vivaient dans le
fichier d'installation du poste, section ``[dpms]`` : pour les changer, il
fallait ouvrir un terminal sur le Raspberry. Le serveur les envoyait pourtant
deja (``GET /config`` -> bloc ``dpms``), mais **personne ne les lisait** : le
minuteur ``badgeuse-dpms.timer`` ne connait que le fichier local.

L'agent ecrit donc ce que le serveur decide dans un petit fichier que le
minuteur lit EN PRIORITE. C'est la doctrine ADR-0002 appliquee a l'ecran :
aucune regle d'affichage ne se decide sur le poste.

Trois garde-fous, tous testes :

* une heure illisible n'ecrase JAMAIS la derniere plage connue (un serveur qui
  bafouille ne doit pas eteindre un ecran d'atelier a une heure au hasard) ;
* l'ecriture est ATOMIQUE (fichier temporaire puis ``os.replace``) : le
  minuteur, qui passe toutes les 5 minutes, ne peut pas lire un fichier a
  moitie ecrit ;
* rien n'est reecrit quand rien n'a change — le fichier garde alors sa date,
  ce qui permet de voir d'un coup d'oeil quand la plage a bouge pour la
  derniere fois.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Mapping, Optional, Tuple

LOGGER = logging.getLogger(__name__)

#: Nom du fichier ecrit dans le repertoire de donnees de l'agent.
NOM_FICHIER = "dpms.conf"

_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

_ENTETE = (
    "; Genere par badgeuse-agent — NE PAS EDITER A LA MAIN.\n"
    "; Plage d'activation de l'ecran decidee dans SOLIDATA\n"
    "; (Temps & Presence -> Parametres). Ce fichier est reecrit a chaque\n"
    "; rafraichissement de configuration ; dpms.sh le lit en priorite sur la\n"
    "; section [dpms] de /etc/badgeuse/badgeuse.conf.\n"
)


def heure_valide(valeur: Any) -> Optional[str]:
    """Rend l'heure ``HH:MM`` si elle est lisible, ``None`` sinon.

    Volontairement STRICTE : « 7:5 », « 25:00 » ou une chaine vide ne sont pas
    des heures. Mieux vaut conserver la plage precedente que d'en deduire une.
    """
    if valeur is None:
        return None
    texte = str(valeur).strip()
    return texte if _HHMM.match(texte) else None


def plage_depuis_config(config: Mapping[str, Any]) -> Optional[Tuple[str, str]]:
    """Extrait ``(allumage, extinction)`` du bloc ``dpms`` de la config serveur.

    Les DEUX heures sont exigees : une plage a moitie definie n'a pas de sens
    (a quelle heure rallumer un ecran qu'on vient d'eteindre ?).
    """
    if not isinstance(config, Mapping):
        return None
    bloc = config.get("dpms")
    if not isinstance(bloc, Mapping):
        return None
    allumage = heure_valide(bloc.get("allumage"))
    extinction = heure_valide(bloc.get("extinction"))
    if not allumage or not extinction:
        return None
    return allumage, extinction


def rendu_conf(allumage: str, extinction: str) -> str:
    """Contenu INI lu par ``deploy/dpms.sh`` (meme lecteur que la conf du poste)."""
    return f"{_ENTETE}[dpms]\nallumage = {allumage}\nextinction = {extinction}\n"


def ecrire_plage(data_dir: str, config: Mapping[str, Any]) -> Optional[str]:
    """Ecrit la plage serveur dans ``<data_dir>/dpms.conf``.

    :returns: le chemin ecrit, ``None`` si rien n'etait exploitable ou si le
        contenu etait deja a jour (aucune erreur : c'est le cas courant).
    """
    plage = plage_depuis_config(config)
    if plage is None:
        return None
    contenu = rendu_conf(*plage)
    chemin = os.path.join(data_dir, NOM_FICHIER)

    try:
        if os.path.exists(chemin):
            with open(chemin, "r", encoding="utf-8") as fichier:
                if fichier.read() == contenu:
                    return None
    except OSError:
        pass  # illisible : on reecrit, c'est precisement le but

    temporaire = f"{chemin}.tmp"
    try:
        os.makedirs(data_dir, exist_ok=True)
        with open(temporaire, "w", encoding="utf-8") as fichier:
            fichier.write(contenu)
        os.replace(temporaire, chemin)
    except OSError:
        # Disque plein, repertoire en lecture seule : le poste continue de
        # pointer et garde sa plage precedente. L'ecran n'est pas la fonction
        # vitale du poste — le badgeage l'est.
        LOGGER.exception("ecriture de la plage d'ecran impossible (%s)", chemin)
        try:
            os.unlink(temporaire)
        except OSError:
            pass
        return None

    LOGGER.info("plage d'ecran mise a jour : %s -> %s", plage[0], plage[1])
    return chemin
