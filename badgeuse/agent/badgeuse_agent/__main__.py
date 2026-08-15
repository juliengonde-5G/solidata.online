"""Point d'entrée : ``python -m badgeuse_agent``.

Options :

- ``--config CHEMIN`` : fichier de configuration (défaut
  ``/etc/badgeuse/badgeuse.conf``, ou ``$BADGEUSE_CONFIG``) ;
- ``--check`` : valide la configuration et sort, sans rien démarrer — utile en
  fin d'installation et avant un redémarrage de service ;
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

    if args.check:
        logger.info("configuration valide : %s", config.redacted())
        return 0

    from .app import run  # import tardif : les dépendances d'E/S ne sont

    # nécessaires que pour l'exécution réelle (``--check`` reste utilisable
    # sur une machine sans evdev/httpx/websockets).
    return run(config)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
