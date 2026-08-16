"""Cache local des médias de la playlist (``/var/lib/badgeuse/media/``).

Raison d'être (CDC_AFFICHAGE_V2 §2, ADR-0004 §6) : **le poste ne contacte
jamais un domaine externe**. Les images et vidéos de l'écran de veille sont
téléchargées depuis l'API device (clé du poste), stockées ici, puis servies
par le serveur statique local — la CSP du kiosque reste ``'self'`` et
l'affichage survit à une coupure réseau (AFF-07).

Découpage volontaire :

- un **cœur PUR** (nommage, vérification d'empreinte, sniffing de type,
  sélection des purges et des évictions) qui décide sur des listes injectées,
  donc entièrement testable sans disque ni réseau ;
- une classe :class:`MediaCache` qui fait les E/S et n'applique que les
  décisions du cœur.

Deux gardes tiennent tout le reste :

- **empreinte vérifiée avant écriture** : un octet qui ne correspond pas au
  ``media_sha256`` annoncé n'entre jamais dans le cache (ni corrompu, ni
  substitué) ;
- **nom de fichier strictement contraint** : le nom est calculé à partir de
  l'identifiant et de l'empreinte, et re-validé à chaque résolution de chemin
  — aucune traversée de répertoire n'est représentable.
"""

from __future__ import annotations

import hashlib
import os
import re
from typing import Any, Iterable, List, Mapping, NamedTuple, Optional, Sequence, Set

#: Sous-répertoire du cache, sous ``system.data_dir``.
SOUS_REPERTOIRE = "media"

#: Plafond par défaut du cache, en mégaoctets. Le serveur pilote la valeur
#: réelle (CDC_AFFICHAGE_V2 §2) ; la configuration locale n'est qu'un plafond
#: de secours (cf. :func:`plafond_effectif`).
DEFAUT_MAX_MO = 512

#: Longueur d'empreinte conservée dans le nom de fichier. 16 caractères
#: hexadécimaux = 64 bits : largement assez pour distinguer les médias d'un
#: poste, tout en gardant un nom lisible en exploitation.
EMPREINTE_NOM = 16

#: Un nom de cache est **entièrement** calculé par nous : identifiant, tiret,
#: préfixe d'empreinte. Rien d'autre n'est accepté à la résolution — pas de
#: point, donc pas de ``..``, pas de séparateur, pas d'octet nul.
_NOM_VALIDE = re.compile(r"^[A-Za-z0-9_]+-[0-9a-f]{%d}$" % EMPREINTE_NOM)

#: Identifiants de média acceptés (le serveur émet des entiers ; on tolère un
#: identifiant textuel simple sans jamais accepter de séparateur de chemin).
_ID_VALIDE = re.compile(r"^[A-Za-z0-9_]{1,64}$")

_SHA256_VALIDE = re.compile(r"^[0-9a-f]{64}$")

#: Types de média servis par l'écran de veille. Tout autre type est ignoré :
#: le poste ne rend que ce qu'il sait rendre sans dépendance.
TYPES_MEDIA = ("image", "video")

#: Types MIME servis, par famille. Liste blanche : ce qui n'est pas reconnu
#: n'est pas servi (le kiosque n'a aucune raison de recevoir autre chose).
MIME_DEFAUT = {"image": "image/jpeg", "video": "video/mp4"}


class FichierCache(NamedTuple):
    """Fichier présent dans le cache, tel qu'observé sur le disque."""

    nom: str
    taille_octets: int
    #: Horodatage de dernière **référence par une playlist** (mtime), et non
    #: d'accès : les montages ``relatime`` rendent l'atime inexploitable, et
    #: un média affiché en boucle n'est de toute façon lu qu'une fois par le
    #: navigateur. Cf. :meth:`MediaCache.entretenir`.
    horodatage: float


# ------------------------------------------------------------------- cœur PUR


def sha256_hex(donnees: bytes) -> str:
    """Empreinte SHA-256 d'un contenu, en hexadécimal minuscule."""
    return hashlib.sha256(donnees).hexdigest()


def verifier_sha256(donnees: bytes, attendu: Any) -> bool:
    """Vrai si le contenu correspond exactement à l'empreinte annoncée.

    Une empreinte absente ou malformée renvoie **faux** : on ne stocke pas un
    média qu'on ne sait pas vérifier (« pas de vérification » n'est pas
    « vérification réussie »).
    """
    empreinte = str(attendu or "").strip().lower()
    if not _SHA256_VALIDE.match(empreinte):
        return False
    return sha256_hex(donnees) == empreinte


def nom_cache(media_id: Any, media_sha256: Any) -> Optional[str]:
    """Nom de fichier déterministe d'un média, ou ``None`` si non calculable.

    Déterministe **à partir de la seule playlist** : le poste peut donc savoir
    ce qui lui manque sans rien télécharger, et un média modifié côté serveur
    (empreinte différente) prend un nom différent — jamais de contenu périmé
    servi sous un nom recyclé.
    """
    identifiant = str(media_id if media_id is not None else "").strip()
    empreinte = str(media_sha256 or "").strip().lower()
    if not _ID_VALIDE.match(identifiant) or not _SHA256_VALIDE.match(empreinte):
        return None
    return f"{identifiant}-{empreinte[:EMPREINTE_NOM]}"


def nom_sur(nom: Any) -> bool:
    """Vrai si le nom peut être résolu dans le cache sans risque.

    Anti-traversée : seule la forme exacte produite par :func:`nom_cache` est
    acceptée. ``..``, ``/``, ``\\``, chemin absolu, octet nul et nom vide sont
    tous rejetés par construction, pas par filtrage a posteriori.
    """
    return bool(_NOM_VALIDE.match(str(nom or "")))


def deviner_mime(entete: bytes, media_type: Any = None) -> Optional[str]:
    """Type MIME déduit des **octets réels**, sinon du type annoncé.

    Le type est sniffé sur le contenu plutôt que déduit d'une extension : le
    nom de cache n'en porte pas, et l'interface est servie avec
    ``X-Content-Type-Options: nosniff`` — un type erroné empêcherait le rendu.
    Un contenu non reconnu ET un type annoncé inconnu renvoient ``None`` :
    le fichier n'est alors pas servi (liste blanche stricte).
    """
    octets = bytes(entete or b"")

    if octets.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if octets.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if octets.startswith(b"GIF87a") or octets.startswith(b"GIF89a"):
        return "image/gif"
    if octets[:4] == b"RIFF" and octets[8:12] == b"WEBP":
        return "image/webp"
    if octets[4:8] == b"ftyp":
        return "video/mp4"
    if octets.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"

    famille = str(media_type or "").strip().lower()
    return MIME_DEFAUT.get(famille)


def plafond_effectif(
    serveur: Any, local: Any = None, defaut: int = DEFAUT_MAX_MO
) -> int:
    """Plafond de cache retenu, en mégaoctets.

    La valeur **vient du serveur** (paramétrage centralisé, ADR-0002) ; la
    valeur locale, si elle est renseignée, ne peut que la **réduire** — c'est
    un garde-fou de secours pour un poste à petit disque, jamais un moyen de
    s'accorder plus de place que la Direction n'en a décidé.
    """
    valeurs = [v for v in (_entier_positif(serveur), _entier_positif(local)) if v]
    if not valeurs:
        return max(1, int(defaut))
    return min(valeurs)


def porteurs_media(element: Mapping[str, Any]) -> List[Mapping[str, Any]]:
    """Descripteurs de média d'un élément de playlist.

    Un média peut être référencé à **deux niveaux**, selon le type de contenu
    servi par SOLIDATA :

    - sur l'élément lui-même (``media`` / ``lien`` / ``image``) ;
    - sur les objets d'une liste portée par l'élément — c'est le cas du type
      ``social``, dont chaque post a son propre visuel (``posts[]``).

    On parcourt donc les deux, sans coder en dur le nom de la liste : un futur
    type qui nicherait ses médias autrement fonctionnera sans modification du
    poste.
    """
    porteurs: List[Mapping[str, Any]] = []
    if element.get("media_id") is not None:
        porteurs.append(element)
    for valeur in element.values():
        if not isinstance(valeur, (list, tuple)):
            continue
        for item in valeur:
            if isinstance(item, Mapping) and item.get("media_id") is not None:
                porteurs.append(item)
    return porteurs


def references_playlist(elements: Any) -> Set[str]:
    """Noms de cache attendus par la playlist courante.

    Tout descripteur qui ne porte pas un couple identifiant/empreinte
    exploitable est ignoré : il ne référence rien, donc ne protège rien de la
    purge.
    """
    references: Set[str] = set()
    for element in _elements(elements):
        for porteur in porteurs_media(element):
            nom = nom_cache(porteur.get("media_id"), porteur.get("media_sha256"))
            if nom:
                references.add(nom)
    return references


def manquants(elements: Any, presents: Iterable[str]) -> List[dict]:
    """Médias référencés par la playlist et absents du cache.

    Retourne des descripteurs ``{nom, media_id, media_sha256, media_type}``
    dédoublonnés, dans l'ordre de la playlist : le téléchargement suit l'ordre
    d'affichage, donc le premier écran est prêt en premier.
    """
    deja: Set[str] = {str(n) for n in presents}
    vus: Set[str] = set()
    liste: List[dict] = []

    for element in _elements(elements):
        for porteur in porteurs_media(element):
            media_id = porteur.get("media_id")
            empreinte = porteur.get("media_sha256")
            nom = nom_cache(media_id, empreinte)
            if not nom or nom in deja or nom in vus:
                continue
            vus.add(nom)
            liste.append(
                {
                    "nom": nom,
                    "media_id": media_id,
                    "media_sha256": str(empreinte).strip().lower(),
                    "media_type": str(porteur.get("media_type") or "").strip().lower(),
                }
            )
    return liste


def purger_non_references(
    fichiers: Sequence[FichierCache], references: Iterable[str]
) -> List[str]:
    """Fichiers du cache qu'aucun élément de la playlist courante ne réclame.

    Première politique de nettoyage (CDC_AFFICHAGE_V2 §2 : « purge des
    fichiers non référencés ») : un média retiré de la playlist côté serveur
    ne doit pas occuper le disque du poste indéfiniment.
    """
    gardes = {str(n) for n in references}
    return [f.nom for f in fichiers if f.nom not in gardes]


def selectionner_evictions(
    fichiers: Sequence[FichierCache], max_octets: int
) -> List[str]:
    """Fichiers à évincer pour repasser sous le plafond, du plus ancien au plus récent.

    Politique **LRU** sur l'horodatage de dernière référence. Appelée après
    :func:`purger_non_references` : ce qui reste est donc, par construction,
    référencé par la playlist courante. Si la playlist elle-même dépasse le
    plafond, on évince quand même les plus anciens — l'écran dégrade
    proprement (l'élément retombe sur son texte) plutôt que de saturer le
    disque du poste, ce qui mettrait en péril la file des pointages.

    Départage à horodatage égal par le nom, pour un résultat déterministe.
    """
    plafond = max(0, int(max_octets))
    total = sum(max(0, f.taille_octets) for f in fichiers)
    if total <= plafond:
        return []

    ordonnes = sorted(fichiers, key=lambda f: (f.horodatage, f.nom))
    evinces: List[str] = []
    for fichier in ordonnes:
        if total <= plafond:
            break
        evinces.append(fichier.nom)
        total -= max(0, fichier.taille_octets)
    return evinces


def local_media_url(port: int, nom: str) -> str:
    """URL **locale** d'un média servi par l'agent.

    Toujours ``127.0.0.1`` : c'est la garantie que l'interface ne sort jamais
    de la boucle locale, y compris si un élément de playlist portait une URL
    distante.
    """
    return f"http://127.0.0.1:{int(port)}/{SOUS_REPERTOIRE}/{nom}"


def appliquer_urls_locales(
    elements: Any, disponibles: Iterable[str], port: int
) -> List[dict]:
    """Réécrit ``media_url`` vers le cache local, ou l'annule.

    Trois cas, tous explicites :

    - média présent en cache → ``media_url`` pointe sur la boucle locale ;
    - média référencé mais pas encore téléchargé → ``media_url`` à ``None``,
      l'interface dégrade sur le texte au lieu d'afficher une image cassée ;
    - élément sans média → laissé intact.

    Une ``media_url`` distante fournie par le serveur est **toujours** écrasée :
    le poste ne fetch jamais un domaine externe (ADR-0004 §6).

    La réécriture descend dans les **listes d'objets** portées par l'élément
    (les ``posts[]`` du type ``social``, chacun avec son visuel). L'entrée
    n'est jamais modifiée sur place : la playlist mémorisée reste la référence
    telle que reçue du serveur.
    """
    presents = {str(n) for n in disponibles}
    resultat: List[dict] = []

    for element in _elements(elements):
        copie = _reecrire(dict(element), presents, port)
        for cle, valeur in list(copie.items()):
            if not isinstance(valeur, (list, tuple)):
                continue
            if not any(
                isinstance(i, Mapping) and i.get("media_id") is not None for i in valeur
            ):
                continue
            copie[cle] = [
                _reecrire(dict(item), presents, port) if isinstance(item, Mapping) else item
                for item in valeur
            ]
        resultat.append(copie)
    return resultat


def _reecrire(porteur: dict, presents: Set[str], port: int) -> dict:
    """Pointe ``media_url`` sur le cache local, ou l'annule si le média manque."""
    nom = nom_cache(porteur.get("media_id"), porteur.get("media_sha256"))
    if nom is not None:
        porteur["media_url"] = local_media_url(port, nom) if nom in presents else None
        porteur["media_pret"] = nom in presents
    return porteur


def _elements(elements: Any) -> List[Mapping[str, Any]]:
    if not isinstance(elements, (list, tuple)):
        return []
    return [e for e in elements if isinstance(e, Mapping)]


def _entier_positif(valeur: Any) -> Optional[int]:
    if valeur is None or isinstance(valeur, bool):
        return None
    try:
        nombre = int(float(valeur))
    except (TypeError, ValueError):
        return None
    return nombre if nombre > 0 else None


# ----------------------------------------------------------------------- E/S


class MediaCache:
    """Répertoire de cache : lecture, écriture vérifiée, entretien.

    N'implémente **aucune** politique : elle applique celles du cœur pur
    ci-dessus. Toutes les opérations sont tolérantes aux erreurs disque — un
    cache en échec dégrade l'affichage, il n'interrompt jamais le badgeage.
    """

    def __init__(self, repertoire: str, max_mo: int = DEFAUT_MAX_MO) -> None:
        self.repertoire = repertoire
        self.max_mo = max(1, int(max_mo))
        try:
            os.makedirs(self.repertoire, mode=0o750, exist_ok=True)
        except OSError:
            # Disque plein ou droits insuffisants : le cache est inutilisable,
            # l'écran retombera sur les contenus textuels. Jamais bloquant.
            pass

    # ------------------------------------------------------------- résolution

    def chemin(self, nom: Any) -> Optional[str]:
        """Chemin absolu d'un média, ou ``None`` si le nom n'est pas sûr.

        Double garde : le nom doit correspondre à la forme canonique **et** le
        chemin résolu doit rester sous le répertoire de cache (défense en
        profondeur contre un lien symbolique posé dans le répertoire).
        """
        if not nom_sur(nom):
            return None
        racine = os.path.realpath(self.repertoire)
        candidat = os.path.realpath(os.path.join(racine, str(nom)))
        if candidat != racine and not candidat.startswith(racine + os.sep):
            return None
        return candidat

    def existe(self, nom: Any) -> bool:
        chemin = self.chemin(nom)
        return bool(chemin) and os.path.isfile(chemin)

    def noms_presents(self) -> Set[str]:
        return {f.nom for f in self.lister()}

    # ----------------------------------------------------------------- lecture

    def lire(self, nom: Any) -> Optional[bytes]:
        chemin = self.chemin(nom)
        if not chemin:
            return None
        try:
            with open(chemin, "rb") as handle:
                return handle.read()
        except OSError:
            return None

    def lire_entete(self, nom: Any, taille: int = 16) -> bytes:
        chemin = self.chemin(nom)
        if not chemin:
            return b""
        try:
            with open(chemin, "rb") as handle:
                return handle.read(max(1, int(taille)))
        except OSError:
            return b""

    def lister(self) -> List[FichierCache]:
        """Contenu observé du cache. Les fichiers hors forme sont ignorés."""
        fichiers: List[FichierCache] = []
        try:
            noms = os.listdir(self.repertoire)
        except OSError:
            return fichiers

        for nom in noms:
            if not nom_sur(nom):
                continue
            chemin = self.chemin(nom)
            if not chemin:
                continue
            try:
                infos = os.stat(chemin)
            except OSError:
                continue
            fichiers.append(
                FichierCache(
                    nom=nom, taille_octets=infos.st_size, horodatage=infos.st_mtime
                )
            )
        return fichiers

    # ---------------------------------------------------------------- écriture

    def stocker(self, nom: Any, donnees: bytes, media_sha256: Any) -> bool:
        """Écrit un média **après** vérification de son empreinte.

        Écriture atomique (fichier temporaire puis ``os.replace``) : le
        serveur local ne peut jamais servir un fichier à moitié écrit, même si
        le poste est coupé pendant le téléchargement.

        :returns: vrai si le média est désormais en cache.
        """
        chemin = self.chemin(nom)
        if not chemin:
            return False
        if not verifier_sha256(donnees, media_sha256):
            # Empreinte fausse : transfert corrompu ou contenu substitué. On
            # n'écrit rien et on ne réessaie pas dans la foulée — le prochain
            # cycle de playlist retentera.
            return False

        temporaire = chemin + ".tmp"
        try:
            with open(temporaire, "wb") as handle:
                handle.write(donnees)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporaire, chemin)
            return True
        except OSError:
            try:
                os.unlink(temporaire)
            except OSError:
                pass
            return False

    def supprimer(self, nom: Any) -> bool:
        chemin = self.chemin(nom)
        if not chemin:
            return False
        try:
            os.unlink(chemin)
            return True
        except OSError:
            return False

    # ---------------------------------------------------------------- entretien

    def entretenir(self, references: Iterable[str], max_mo: Optional[int] = None) -> dict:
        """Purge les non-référencés puis évince en LRU sous le plafond.

        Horodate d'abord les fichiers **référencés** par la playlist courante :
        c'est cette date que la politique LRU utilise, plutôt qu'un atime que
        les montages ``relatime`` rendent inexploitable.

        :returns: ``{"purges": [...], "evinces": [...]}`` — pour le journal.
        """
        gardes = {str(n) for n in references}
        maintenant = _horloge()

        for nom in gardes:
            chemin = self.chemin(nom)
            if chemin and os.path.isfile(chemin):
                try:
                    os.utime(chemin, (maintenant, maintenant))
                except OSError:
                    pass

        fichiers = self.lister()
        purges = purger_non_references(fichiers, gardes)
        for nom in purges:
            self.supprimer(nom)

        restants = [f for f in fichiers if f.nom not in set(purges)]
        plafond_octets = max(1, int(max_mo or self.max_mo)) * 1024 * 1024
        evinces = selectionner_evictions(restants, plafond_octets)
        for nom in evinces:
            self.supprimer(nom)

        return {"purges": purges, "evinces": evinces}


def _horloge() -> float:
    import time

    return time.time()
