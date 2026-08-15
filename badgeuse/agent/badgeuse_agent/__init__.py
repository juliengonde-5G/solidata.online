"""Agent embarqué du poste de pointage SOLIDATA.

Le poste est un **capteur** : il lit un badge, l'horodate, le chaîne et le
transmet. Toute règle de gestion RH (arrondis, pauses, seuils, sens définitif)
est appliquée côté serveur (SPEC §4.1).

Modules purs (testables sans aucune dépendance externe) :
``normalize``, ``hmac_uid``, ``chain``, ``debounce``, ``sens``, ``store``,
``clock``, ``config``.

Modules d'entrées-sorties : ``reader`` (evdev), ``sync`` (httpx),
``ws_server`` (websockets), ``app`` (orchestration).
"""

__version__ = "1.0.0"

__all__ = ["__version__"]
