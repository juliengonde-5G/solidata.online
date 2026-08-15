"""Rend le paquet ``badgeuse_agent`` importable sans installation.

Les tests ne couvrent que des modules **purs** (stdlib uniquement) : ils
s'exécutent sans ``evdev``, ``httpx`` ni ``websockets``, donc sur un poste de
développement comme en intégration continue.
"""

import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))
