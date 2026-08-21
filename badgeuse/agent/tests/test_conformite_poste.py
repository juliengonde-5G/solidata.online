"""Invariants de securite et de confidentialite du poste, verifies par test.

Ce que ce module protege ne se voit pas a l'oeil nu dans une revue : une CSP
elargie « le temps d'essayer », une ressource externe glissee dans l'interface,
un secret commis par megarde. Chacun de ces points est une promesse ecrite
(SPEC §7.1, ADR-0004 §6, NOTE_JURIDIQUE) : ils sont donc testes, pas relus.

Aucune dependance : lecture de fichiers et expressions rationnelles.
"""

from __future__ import annotations

import re
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]      # badgeuse/
UI = RACINE / "ui"
AGENT = RACINE / "agent" / "badgeuse_agent"


def _csp() -> str:
    html = (UI / "index.html").read_text(encoding="utf-8")
    trouve = re.search(
        r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', html
    )
    assert trouve, "aucune CSP dans l'interface kiosque"
    return trouve.group(1)


def test_csp_du_kiosque_reste_fermee():
    """La CSP de l'ecran ne s'elargit pas en douce (ADR-0004 §6)."""
    csp = _csp()
    assert "default-src 'none'" in csp
    for directive in ("img-src", "media-src", "style-src", "script-src"):
        assert f"{directive} 'self'" in csp, f"{directive} n'est plus 'self'"
    assert "unsafe-inline" not in csp
    assert "unsafe-eval" not in csp
    assert "base-uri 'none'" in csp and "form-action 'none'" in csp


def test_csp_ne_permet_que_la_boucle_locale():
    """Le seul canal sortant autorise est le WebSocket local de l'agent."""
    csp = _csp()
    connect = re.search(r"connect-src ([^;]+)", csp)
    assert connect, "connect-src absent"
    for origine in connect.group(1).split():
        assert origine.startswith("ws://127.0.0.1") or origine.startswith(
            "ws://localhost"
        ), f"origine sortante inattendue : {origine}"


#: Fichiers de ressource (logo, polices) : binaires, donc illisibles en texte.
#: Ils sont exclus du balayage, jamais le contraire — un .js ou un .css glisse
#: dans un sous-repertoire doit rester inspecte.
_BINAIRES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".mp4", ".webm"}


#: Espaces de noms XML : ce sont des IDENTIFIANTS, pas des adresses. Le
#: navigateur ne les telecharge JAMAIS — ``createElementNS`` exige la chaine
#: exacte pour produire un element SVG (la carte des tournees en dessine).
#: L'exception est nominative et close : toute autre adresse reste refusee, y
#: compris un autre domaine w3.org. La garde protege les REQUETES SORTANTES ;
#: elle n'a jamais eu vocation a interdire un nom d'espace de noms.
_NAMESPACES_XML = {
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xlink",
}


def test_interface_sans_ressource_externe():
    """Le poste ne contacte jamais un domaine tiers, meme pour une police.

    Le balayage est RECURSIF : depuis l'ajout de ``ui/assets/`` (logo de
    l'association servi en local), un fichier place dans un sous-repertoire
    echappait au controle.
    """
    inspectes = 0
    for fichier in sorted(UI.rglob("*")):
        if not fichier.is_file() or fichier.suffix.lower() in _BINAIRES:
            continue
        contenu = fichier.read_text(encoding="utf-8")
        inspectes += 1
        for url in re.findall(r"https?://[^\s\"'()]+", contenu):
            if url in _NAMESPACES_XML:
                continue
            assert "127.0.0.1" in url, f"{fichier.relative_to(UI)} reference {url}"
    assert inspectes >= 3, "index.html, style.css et app.js doivent etre inspectes"


def test_seuls_les_namespaces_xml_echappent_a_la_garde():
    """Contre-epreuve : la tolerance ci-dessus ne doit pas etre une porte.

    Un domaine tiers glisse dans l'interface — meme chez w3.org, meme en
    https — doit continuer d'echouer. Sans ce test, elargir ``_NAMESPACES_XML``
    par confort passerait inapercu.
    """
    for adresse in (
        "https://fonts.googleapis.com/css",
        "http://www.w3.org/2000/svg/evil.js",
        "https://www.w3.org/2000/svg",
        "https://solidata.online/api",
    ):
        assert adresse not in _NAMESPACES_XML


def test_ressources_locales_reellement_presentes():
    """Une image referencee mais absente laisserait un bandeau casse en prod.

    Le kiosque n'a pas de repli reseau : ce qui n'est pas sur le disque du
    poste n'existe pas.
    """
    html = (UI / "index.html").read_text(encoding="utf-8")
    sources = re.findall(r'<img[^>]*\ssrc="([^"]+)"', html)
    assert sources, "aucune image dans l'interface"
    for source in sources:
        assert not source.startswith(("http://", "https://", "//")), (
            f"ressource distante interdite : {source}"
        )
        assert (UI / source).is_file(), f"fichier absent du poste : {source}"


def test_interface_sans_style_en_ligne_ni_innerhtml():
    """Pas de style en ligne (la CSP tient sans 'unsafe-inline'), pas d'innerHTML."""
    script = (UI / "app.js").read_text(encoding="utf-8")
    assert ".style." not in script
    assert "innerHTML" not in script
    assert "eval(" not in script
    assert "document.write" not in script


def test_logo_present_sur_la_veille_ET_sur_le_badgeage():
    """Le logo doit tenir sur TOUS les ecrans, pas seulement celui de veille.

    L'ecran de badgeage est un overlay plein ecran : sans marque de son cote,
    le poste perdait l'identite de l'association pendant les 8 secondes les
    plus regardees de la journee.
    """
    html = (UI / "index.html").read_text(encoding="utf-8")
    veille = html.split('id="overlay"')[0]
    overlay = html.split('id="overlay"')[1]
    assert "logo-marque" in veille, "logo absent du bandeau de veille"
    assert "logo-overlay" in overlay, "logo absent de l'ecran de badgeage"


def test_logo_de_badgeage_derriere_la_carte():
    """Garantie MECANIQUE que la marque ne masque jamais le prenom (AFF-03).

    Le logo est en z-index inferieur a la carte : un message long passe
    au-dessus de lui, jamais l'inverse.
    """
    css = (UI / "style.css").read_text(encoding="utf-8")
    bloc = lambda nom: css.split(nom + " {")[1].split("}")[0]  # noqa: E731
    z_logo = int(re.search(r"z-index:\s*(\d+)", bloc(".logo-overlay")).group(1))
    z_carte = int(re.search(r"z-index:\s*(\d+)", bloc(".overlay-carte")).group(1))
    assert z_logo < z_carte, "le logo passerait devant le message de badgeage"


def test_aucun_secret_dans_le_depot():
    """Ni cle de site, ni cle de poste : elles n'existent que sur le poste."""
    suspects = re.compile(
        r"^\s*(device_key|hmac_key)\s*=\s*(?!CHANGE_ME|A_REMPLACER|\$|;)(\S+)",
        re.IGNORECASE | re.MULTILINE,
    )
    for fichier in RACINE.rglob("*"):
        if not fichier.is_file() or "__pycache__" in str(fichier):
            continue
        if fichier.suffix not in (".conf", ".example", ".md", ".sh", ".json"):
            continue
        contenu = fichier.read_text(encoding="utf-8", errors="ignore")
        for correspondance in suspects.finditer(contenu):
            valeur = correspondance.group(2)
            # Les gabarits (${...}, $VAR, …) ne sont pas des valeurs.
            assert not re.fullmatch(r"[0-9a-fA-F]{32,}", valeur), (
                f"{fichier.relative_to(RACINE)} porte une cle en clair"
            )


def test_uid_brut_jamais_journalise_dans_le_code():
    """Aucune trace n'imprime le tampon de frappes ni l'UID normalise."""
    reader = (AGENT / "reader.py").read_text(encoding="utf-8")
    for trace in re.findall(r"LOGGER\.\w+\((.{0,200}?)\)", reader, re.DOTALL):
        assert "raw" not in trace, f"trace suspecte : {trace[:80]}"
        assert "buffer" not in trace, f"trace suspecte : {trace[:80]}"
        assert "char" not in trace, f"trace suspecte : {trace[:80]}"

    app = (AGENT / "app.py").read_text(encoding="utf-8")
    for trace in re.findall(r"LOGGER\.\w+\((.{0,200}?)\)", app, re.DOTALL):
        assert "raw" not in trace
        assert "normalise" not in trace


def test_condensats_tronques_dans_les_journaux():
    """Le condensat lui-meme n'est jamais journalise en entier."""
    app = (AGENT / "app.py").read_text(encoding="utf-8")
    # Chaque journalisation d'un condensat passe par short().
    for ligne in app.splitlines():
        if "condensat" in ligne and "LOGGER" not in ligne:
            continue
        if "condensat" in ligne and "%s" in ligne:
            assert "short(" in ligne or "short(condensat)" in app
