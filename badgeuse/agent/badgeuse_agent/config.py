"""Configuration du poste : ``/etc/badgeuse/badgeuse.conf`` (INI).

Module PUR (``configparser`` seul). Le fichier est en ``0600``, propriété de
l'utilisateur système ``badgeuse``, **hors dépôt Git** (SPEC §7.1).

Règle absolue : **aucun secret n'a de valeur par défaut**. Une clé de site ou
une clé d'appareil manquante fait échouer le démarrage avec un message explicite
— jamais de repli silencieux qui produirait des condensats faux et des pointages
inexploitables.
"""

from __future__ import annotations

import configparser
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

DEFAULT_CONFIG_PATH = "/etc/badgeuse/badgeuse.conf"
DEFAULT_DATA_DIR = "/var/lib/badgeuse"
DEFAULT_API_PATH = "/api/badgeuse/device/v1"
DEFAULT_WS_PORT = 8765
DEFAULT_HTTP_PORT = 8766

TARGETS = ("pi5", "pi3")

#: Clés de site attendues en hexadécimal de 64 caractères (256 bits).
SITE_KEY_HEX_LENGTH = 64

#: Longueur minimale d'une clé d'appareil (256 bits hex attendus).
DEVICE_KEY_MIN_LENGTH = 32

#: Double geste explicite requis pour accepter ``verify_tls = false``
#: (note juridique §4, SPEC §7.1 : « certificat vérifié » ; réserve de
#: conformité R3). Sans cette variable d'environnement AUSSI posée, la
#: configuration est refusée au démarrage — jamais de repli silencieux.
ENV_ALLOW_INSECURE_TLS = "BADGEUSE_ALLOW_INSECURE_TLS"

#: Message d'alerte heartbeat permanent tant que le poste tourne en TLS non
#: vérifié (réserve R3) — concaténé aux alertes ponctuelles par sync.py.
TLS_INSECURE_ALERT = "TLS non verifie — poste en configuration de test"


class ConfigError(RuntimeError):
    """Configuration absente, incomplète ou invalide — démarrage impossible."""


@dataclass(frozen=True)
class Config:
    """Configuration validée du poste."""

    server_url: str
    device_code: str
    device_key: str
    hmac_key: str
    data_dir: str
    target: str
    api_path: str = DEFAULT_API_PATH
    vendor_id: Optional[int] = None
    product_id: Optional[int] = None
    reader_name: Optional[str] = None
    ws_port: int = DEFAULT_WS_PORT
    http_port: int = DEFAULT_HTTP_PORT
    ui_dir: Optional[str] = None
    verify_tls: bool = True
    ca_bundle: Optional[str] = None
    dpms_allumage: Optional[str] = None
    dpms_extinction: Optional[str] = None
    source_path: Optional[str] = None
    warnings: List[str] = field(default_factory=list)

    @property
    def api_base(self) -> str:
        """Racine de l'API device (CONTRAT_API_DEVICE §1)."""
        return self.server_url.rstrip("/") + self.api_path

    def device_url(self, suffix: str) -> str:
        """URL d'un endpoint du poste, ex. ``device_url("pointages")``."""
        return f"{self.api_base}/devices/{self.device_code}/{suffix.lstrip('/')}"

    def redacted(self) -> Dict[str, Any]:
        """Vue journalisable : aucun secret, même tronqué."""
        return {
            "server_url": self.server_url,
            "device_code": self.device_code,
            "target": self.target,
            "data_dir": self.data_dir,
            "reader": {
                "vendor_id": _hex_or_none(self.vendor_id),
                "product_id": _hex_or_none(self.product_id),
                "name": self.reader_name,
            },
            "ws_port": self.ws_port,
            "http_port": self.http_port,
            "device_key": "<defini>" if self.device_key else "<absent>",
            "hmac_key": "<defini>" if self.hmac_key else "<absent>",
        }


def load(path: Optional[str] = None) -> Config:
    """Lit et valide la configuration.

    :raises ConfigError: fichier absent/illisible, section ou clé manquante,
        secret vide, URL non HTTPS, cible inconnue.
    """
    config_path = path or os.environ.get("BADGEUSE_CONFIG") or DEFAULT_CONFIG_PATH

    if not os.path.isfile(config_path):
        raise ConfigError(
            f"fichier de configuration introuvable : {config_path}. "
            "Copier badgeuse.conf.example, renseigner les cles fournies par le "
            "back-office (Supervision -> Appairage), puis chmod 0600."
        )

    parser = configparser.ConfigParser()
    try:
        with open(config_path, "r", encoding="utf-8") as handle:
            parser.read_file(handle)
    except (OSError, configparser.Error) as exc:
        raise ConfigError(f"configuration illisible ({config_path}) : {exc}") from exc

    warnings: List[str] = []
    _warn_if_world_readable(config_path, warnings)

    server_url = _require(parser, "server", "url").rstrip("/")
    if not server_url.lower().startswith("https://"):
        raise ConfigError(
            "server.url doit etre en HTTPS (TLS 1.2 minimum, SPEC §7.1) : "
            f"valeur lue '{server_url}'"
        )

    device_code = _require(parser, "server", "device_code")
    if "|" in device_code:
        # Le séparateur de la charge utile canonique (CONTRAT_INTEGRITE §2).
        raise ConfigError("server.device_code ne peut pas contenir le caractere '|'")

    device_key = _require_secret(parser, "server", "device_key")
    if len(device_key) < DEVICE_KEY_MIN_LENGTH:
        raise ConfigError(
            "server.device_key trop courte "
            f"({len(device_key)} caracteres, {DEVICE_KEY_MIN_LENGTH} minimum)"
        )

    hmac_key = _require_secret(parser, "site", "hmac_key").lower()
    if len(hmac_key) != SITE_KEY_HEX_LENGTH or not _is_hex(hmac_key):
        raise ConfigError(
            "site.hmac_key doit etre une cle de 256 bits en hexadecimal "
            f"({SITE_KEY_HEX_LENGTH} caracteres) — valeur de "
            f"{len(hmac_key)} caractere(s) lue"
        )

    target = parser.get("system", "target", fallback="pi5").strip().lower()
    if target not in TARGETS:
        raise ConfigError(
            f"system.target inconnu : '{target}' (attendu : {' ou '.join(TARGETS)})"
        )

    data_dir = parser.get("system", "data_dir", fallback=DEFAULT_DATA_DIR).strip()
    if not data_dir:
        raise ConfigError("system.data_dir vide")

    verify_tls = parser.getboolean("server", "verify_tls", fallback=True)
    if not verify_tls:
        # Reserve de conformite R3 : verify_tls=false ne doit jamais partir
        # en exploitation par erreur. Double geste explicite obligatoire :
        # le fichier ET la variable d'environnement, jamais l'un sans l'autre.
        if os.environ.get(ENV_ALLOW_INSECURE_TLS) != "1":
            raise ConfigError(
                "server.verify_tls = false est refuse : poser AUSSI la "
                f"variable d'environnement {ENV_ALLOW_INSECURE_TLS}=1 (double "
                "geste explicite, reserve au banc de test — jamais en "
                "exploitation, note juridique §4 / SPEC §7.1)."
            )
        warnings.append(
            "verification TLS DESACTIVEE — reservee a un banc de test, "
            "jamais en exploitation"
        )

    return Config(
        server_url=server_url,
        device_code=device_code,
        device_key=device_key,
        hmac_key=hmac_key,
        data_dir=data_dir,
        target=target,
        api_path=parser.get("server", "api_path", fallback=DEFAULT_API_PATH).strip()
        or DEFAULT_API_PATH,
        vendor_id=_parse_id(parser, "reader", "vendor_id"),
        product_id=_parse_id(parser, "reader", "product_id"),
        reader_name=_clean(parser.get("reader", "name", fallback="")),
        ws_port=parser.getint("ui", "ws_port", fallback=DEFAULT_WS_PORT),
        http_port=parser.getint("ui", "http_port", fallback=DEFAULT_HTTP_PORT),
        ui_dir=_clean(parser.get("ui", "dir", fallback="")),
        verify_tls=verify_tls,
        ca_bundle=_clean(parser.get("server", "ca_bundle", fallback="")),
        dpms_allumage=_clean(parser.get("dpms", "allumage", fallback="")),
        dpms_extinction=_clean(parser.get("dpms", "extinction", fallback="")),
        source_path=config_path,
        warnings=warnings,
    )


# --------------------------------------------------------------------- helpers


def _require(parser: configparser.ConfigParser, section: str, option: str) -> str:
    if not parser.has_section(section):
        raise ConfigError(f"section [{section}] manquante dans la configuration")
    value = _clean(parser.get(section, option, fallback=""))
    if not value:
        raise ConfigError(f"{section}.{option} manquant ou vide")
    return value


def _require_secret(
    parser: configparser.ConfigParser, section: str, option: str
) -> str:
    """Comme :func:`_require`, mais sans jamais citer la valeur lue."""
    value = _require(parser, section, option)
    if value.upper().startswith("CHANGE_ME") or value.upper().startswith("A_REMPLACER"):
        raise ConfigError(
            f"{section}.{option} est resté sur la valeur d'exemple : "
            "coller la cle reelle fournie a l'appairage"
        )
    return value


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip().strip('"').strip("'")
    return cleaned or None


def _is_hex(value: str) -> bool:
    return all(c in "0123456789abcdefABCDEF" for c in value)


def _parse_id(
    parser: configparser.ConfigParser, section: str, option: str
) -> Optional[int]:
    """Lit un identifiant USB en hexadécimal (``0x1234``) ou en décimal."""
    raw = _clean(parser.get(section, option, fallback="")) if parser.has_section(
        section
    ) else None
    if not raw:
        return None
    try:
        return int(raw, 16) if raw.lower().startswith("0x") else int(raw, 10)
    except ValueError:
        raise ConfigError(
            f"{section}.{option} invalide : '{raw}' (attendu 0x1234 ou un entier)"
        ) from None


def _hex_or_none(value: Optional[int]) -> Optional[str]:
    return None if value is None else f"0x{value:04x}"


def _warn_if_world_readable(path: str, warnings: List[str]) -> None:
    try:
        mode = os.stat(path).st_mode & 0o777
    except OSError:
        return
    if mode & 0o077:
        warnings.append(
            f"permissions trop larges sur {path} ({mode:o}) — attendu 0600 "
            "(chmod 0600, chown badgeuse:badgeuse)"
        )
