"""Point d'entrée : ``python -m badgeuse_agent``.

Options :

- ``--config CHEMIN`` : fichier de configuration (défaut
  ``/etc/badgeuse/badgeuse.conf``, ou ``$BADGEUSE_CONFIG``) ;
- ``--check`` : valide la configuration et sort, sans rien démarrer — utile en
  fin d'installation et avant un redémarrage de service ;
- ``--lecteurs`` : liste les interfaces d'entrée vues par le poste et dit
  lesquelles il saisirait, sans rien démarrer ni lire aucune frappe ;
- ``--verbose`` : journalisation de niveau debug.
"""

from __future__ import annotations

import argparse
import logging
import sys

from . import __version__
from .config import ConfigError, load


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="badgeuse-agent",
        description="Agent du poste de pointage SOLIDATA",
    )
    parser.add_argument("--config", default=None, help="chemin du fichier INI")
    parser.add_argument(
        "--check",
        action="store_true",
        help="valider la configuration puis sortir",
    )
    parser.add_argument(
        "--lecteurs",
        action="store_true",
        help="lister les interfaces d'entree et celles que l'agent saisirait",
    )
    parser.add_argument("--verbose", action="store_true", help="journal debug")
    parser.add_argument("--version", action="version", version=__version__)
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s : %(message)s",
        stream=sys.stderr,
    )
    logger = logging.getLogger("badgeuse")

    try:
        config = load(args.config)
    except ConfigError as exc:
        logger.error("configuration invalide : %s", exc)
        return 2

    for avertissement in config.warnings:
        logger.warning(avertissement)

    if not config.verify_tls:
        # Reserve de conformite R3 : ne doit jamais passer inapercu au
        # demarrage, y compris en ``--check``.
        logger.critical(
            "verification TLS DESACTIVEE — poste en configuration de test, "
            "JAMAIS en exploitation"
        )

    if args.lecteurs:
        return _lister_lecteurs(config, logger)

    if args.check:
        logger.info("configuration valide : %s", config.redacted())
        return 0

    from .app import run  # import tardif : les dépendances d'E/S ne sont

    # nécessaires que pour l'exécution réelle (``--check`` reste utilisable
    # sur une machine sans evdev/httpx/websockets).
    return run(config)


def _lister_lecteurs(config, logger) -> int:
    """Affiche les interfaces d'entrée et le verdict de sélection.

    Diagnostic de terrain du symptôme « le lecteur est connecté et rien
    n'arrive » : on voit ici si le lecteur expose plusieurs interfaces, et
    laquelle l'agent saisit. **Aucune frappe n'est lue** — cette commande ne
    peut pas divulguer un UID de badge.
    """
    from .reader import EVDEV_AVAILABLE, inventaire

    if not EVDEV_AVAILABLE:
        logger.error(
            "bibliotheque evdev absente : installer python3-evdev "
            "(aucune capture possible sans elle)"
        )
        return 2

    lignes = inventaire(
        vendor_id=config.vendor_id,
        product_id=config.product_id,
        name_hint=config.reader_name,
    )
    if not lignes:
        print("Aucune interface d'entree (/dev/input/event*) visible.")
        print("Verifier le branchement USB du lecteur, puis : lsusb")
        return 1

    print(f"{'peripherique':<22} {'USB':<15} {'clavier':<9} {'saisi':<7} nom")
    for ligne in lignes:
        usb = f"{ligne['vendor_id']}:{ligne['product_id']}"
        print(
            f"{ligne['path']:<22} "
            f"{usb:<15} "
            f"{'oui' if ligne['clavier'] else 'non':<9} "
            f"{'OUI' if ligne['retenu'] else '-':<7} "
            f"{ligne['nom']}"
        )
    retenus = [ligne for ligne in lignes if ligne["retenu"]]
    print()
    if not retenus:
        print("AUCUNE interface saisie : le poste ne peut recevoir aucun badge.")
        print("  Brancher le lecteur, ou retirer le filtre [reader] de la")
        print("  configuration s'il ne correspond a aucun peripherique.")
        return 1
    print(f"{len(retenus)} interface(s) saisie(s) par l'agent.")
    if len(retenus) > 1:
        print("  Un lecteur expose souvent deux interfaces indiscernables :")
        print("  toutes sont ecoutees, c'est le fonctionnement attendu.")
    print("Verification du flux reel : journalctl -u badgeuse-agent -f")
    print("  puis passer un badge — la ligne « premiere frappe recue » doit")
    print("  apparaitre. Si elle n'apparait pas, le lecteur n'emet rien.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
