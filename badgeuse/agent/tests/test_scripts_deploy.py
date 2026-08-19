"""Les scripts de deploiement sont eux aussi couverts par la suite.

Le poste n'est pas seulement du Python : ce qui l'installe et le repare est du
shell, et ce shell n'etait couvert par rien — c'est la que se sont loges les
defauts qui ont immobilise un poste sur le terrain. Ce module branche le
harnais ``deploy/tests/test_deploy.sh`` sur ``pytest`` : une regression dans
l'installation echoue desormais au meme endroit que le reste.

Aucune dependance, aucun privilege, aucun Raspberry : le harnais travaille
dans un repertoire temporaire.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]      # badgeuse/
DEPLOY = RACINE / "deploy"
HARNAIS = DEPLOY / "tests" / "test_deploy.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None, reason="bash absent de cette machine"
)


def _scripts():
    return sorted(DEPLOY.glob("*.sh")) + sorted((DEPLOY / "tests").glob("*.sh"))


def test_tous_les_scripts_sont_syntaxiquement_valides():
    assert _scripts(), "aucun script de deploiement trouve"
    for script in _scripts():
        resultat = subprocess.run(
            ["bash", "-n", str(script)], capture_output=True, text=True
        )
        assert resultat.returncode == 0, f"{script.name} : {resultat.stderr}"


def test_harnais_de_deploiement(capsys):
    """Exécute les tests shell ; leur sortie est jointe en cas d'échec."""
    resultat = subprocess.run(
        ["bash", str(HARNAIS)], capture_output=True, text=True, timeout=300
    )
    if resultat.returncode != 0:
        print(resultat.stdout)
        print(resultat.stderr)
    assert resultat.returncode == 0, "le harnais de deploiement a echoue"
    assert " 0 KO" in resultat.stdout


def test_aucun_secret_dans_les_scripts():
    """Aucune clé, aucun mot de passe ne doit vivre dans le dépôt."""
    interdits = ("BEGIN PRIVATE KEY", "BEGIN RSA", "X-Device-Key: ")
    for script in _scripts():
        contenu = script.read_text(encoding="utf-8")
        for motif in interdits:
            assert motif not in contenu, f"{script.name} contient « {motif} »"
