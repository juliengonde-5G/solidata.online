"""Persistance locale du poste (PST-05).

SQLite, stdlib uniquement — donc testable sans aucune dépendance externe.

Contenu, et rien d'autre :

- ``chain_state`` : séquence du poste et dernier hash de la chaîne d'intégrité ;
- ``queue`` : file d'attente des pointages à transmettre, **purgée uniquement
  sur accusé de réception serveur** (``ok`` / ``duplicate`` / ``orphan`` /
  ``invalid`` — CONTRAT_API_DEVICE §2.1, amendement v1.1 : ``invalid`` est un
  accusé TERMINAL, l'élément est purgé et compté, jamais retransmis en
  boucle et jamais un rejet silencieux) ;
- ``badges`` : cache des badges actifs — ``uid_hmac``, identifiant technique,
  prénom, initiale. Ni nom complet, ni statut, ni équipe (exigence A5) ;
- ``pointages_locaux`` : les pointages récents, pour l'alternance entrée/sortie ;
- ``cache`` : dernières config / playlist reçues et leurs ETag ;
- ``compteurs`` : compteurs persistants d'exploitation (ex. pointages
  ``invalid`` purgés depuis l'appairage), survivent aux redémarrages.

Frontière de casse : un ``uid_hmac`` est toujours un hexadécimal **minuscule**
(``hashlib``/``hmac`` produisent des ``hexdigest()`` en minuscules). Ce module
normalise systématiquement en minuscules à l'écriture et à la lecture du
cache badges, par défense en profondeur contre une source externe (serveur,
import) qui enverrait une casse différente — cf. CONTRAT_HMAC, QA-12.

L'UID brut n'apparaît dans aucune de ces tables : seul le condensat y entre.

Garanties : mode WAL, ``synchronous=FULL`` (une coupure de courant ne perd pas
le pointage validé), séquence réservée et chaîne avancée **dans la même
transaction** que l'insertion en file — la séquence est donc strictement
monotone et jamais réutilisée, y compris après un arrêt brutal.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sqlite3
import uuid as _uuid
from typing import Any, Dict, Iterable, List, Mapping, Optional

from . import chain as chain_mod
from .hmac_uid import NO_BADGE
from .sens import PARIS, PointageLocal

#: Statuts serveur valant accusé de réception TERMINAL (CONTRAT_API_DEVICE
#: §2.1, amendement v1.1). ``invalid`` en fait partie depuis l'amendement :
#: un élément malformé ne sera jamais réparé par une retransmission, donc le
#: poste le purge comme les autres — mais le compte et alerte (cf. ``ack``).
#: Tout statut hors de cet ensemble (y compris inconnu/futur) laisse
#: l'élément en file : aucune heure ne se perd, quitte à être retransmise.
#:
#: ``retry`` (amendement v1.2, QA-13) est **délibérément exclu** de cet
#: ensemble : ce n'est PAS un accusé, c'est une cause TRANSITOIRE côté
#: serveur (timeout, ressource, sérialisation...). L'élément reste en file
#: et sera représenté au prochain lot, sans compter comme ``invalid`` — ce
#: n'est ni une réparation impossible, ni un simple statut inconnu muet :
#: cf. ``sync._log_resultats`` pour son traitement (log INFO dédié).
ACK_STATUSES = frozenset({"ok", "duplicate", "orphan", "invalid"})

#: Clé du compteur persistant de pointages ``invalid`` purgés (table
#: ``compteurs``), exposé par :meth:`Store.invalid_count`.
COMPTEUR_INVALIDES = "invalides"

#: Seuil au-delà duquel le plus ancien élément non purgé de la file
#: déclenche l'alerte heartbeat « file en attente » (CONTRAT_API_DEVICE
#: v1.2) — distingue un ``retry`` isolé (silencieux côté heartbeat) d'une
#: file qui ne s'écoule vraiment pas (mêmes éléments en retry depuis
#: longtemps, ou tout autre blocage de transmission).
SEUIL_FILE_ANCIENNE_SEC = 3600.0

#: Message d'alerte heartbeat pour une file qui ne s'écoule pas depuis plus
#: de :data:`SEUIL_FILE_ANCIENNE_SEC`.
ALERTE_FILE_ANCIENNE = "file en attente depuis plus d'1 h — verifier le serveur"

#: Taille maximale d'un lot déposé (CONTRAT_API_DEVICE §2.1).
MAX_BATCH = 100

#: Rétention des pointages locaux servant à l'alternance.
LOCAL_EVENTS_RETENTION_DAYS = 30

DB_FILENAME = "badgeuse.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS chain_state (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    device_code  TEXT    NOT NULL,
    sequence     INTEGER NOT NULL DEFAULT 0,
    last_hash    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
    uuid            TEXT    PRIMARY KEY,
    sequence_device INTEGER NOT NULL UNIQUE,
    payload_json    TEXT    NOT NULL,
    created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_sequence ON queue (sequence_device);

CREATE TABLE IF NOT EXISTS badges (
    uid_hmac   TEXT PRIMARY KEY,
    salarie_id INTEGER NOT NULL,
    prenom     TEXT    NOT NULL,
    initiale   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS pointages_locaux (
    uuid           TEXT PRIMARY KEY,
    salarie_id     INTEGER,
    horodatage_utc TEXT NOT NULL,
    sens           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_locaux_salarie
    ON pointages_locaux (salarie_id, horodatage_utc);

CREATE TABLE IF NOT EXISTS cache (
    cle        TEXT PRIMARY KEY,
    valeur_json TEXT NOT NULL,
    etag       TEXT,
    maj_le     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compteurs (
    cle    TEXT PRIMARY KEY,
    valeur INTEGER NOT NULL DEFAULT 0
);
"""


def alerte_invalides(nombre: int) -> str:
    """Message d'alerte heartbeat pour un lot de pointages ``invalid`` purgés.

    Fonction PURE (aucune E/S) : gabarit partagé, utilisé par ``sync.py`` pour
    peupler le champ ``alerte`` du heartbeat (CONTRAT_API_DEVICE §2.5) sans
    dupliquer le texte. Extraite ici — plutôt que dans ``sync.py``, qui
    dépend de ``httpx`` — pour rester testable sans dépendance HTTP.
    """
    return f"{nombre} pointage(s) invalide(s) purge(s) — verifier le poste"


def message_retries(nombre: int) -> str:
    """Message de journal (INFO, sobre) pour un lot différé par le serveur.

    Statut ``retry`` (CONTRAT_API_DEVICE §2.1, amendement v1.2) : cause
    TRANSITOIRE, pas un accusé — l'élément reste en file. Fonction PURE,
    dédiée pour ne pas tomber dans un traitement générique « statut inconnu »
    potentiellement plus bruyant.
    """
    return (
        f"{nombre} pointage(s) differe(s) par le serveur — "
        "nouvelle tentative au prochain envoi"
    )


def lot_entierement_differe(resultats: list) -> bool:
    """Vrai si le serveur a répondu ``retry`` pour TOUS les éléments du lot.

    QA-14 : ce cas (incident transitoire dès le premier élément) ne doit pas
    lever l'alerte générique « réponse sans accusé exploitable » — c'est un
    différé assumé par le contrat v1.2, silencieux tant que la file ne
    stagne pas (cf. ``file_ancienne``). Fonction PURE.
    """
    if not resultats:
        return False
    return all((r or {}).get("status") == "retry" for r in resultats)


def file_ancienne(
    oldest_created_at: Optional[str],
    maintenant: _dt.datetime,
    seuil_sec: float = SEUIL_FILE_ANCIENNE_SEC,
) -> bool:
    """Vrai si le plus ancien élément non purgé de la file dépasse le seuil.

    Fonction PURE (horloge injectée) : distingue un ``retry`` isolé (pas
    d'alerte) d'une file qui ne s'écoule vraiment pas (mêmes éléments
    en attente depuis plus d'1 h — CONTRAT_API_DEVICE v1.2). ``oldest_created_at``
    est le retour de :meth:`Store.oldest_queued_at` — ``None`` (file vide)
    n'est jamais « ancien ».
    """
    if not oldest_created_at:
        return False
    age_sec = (maintenant - chain_mod.parse_utc_iso(oldest_created_at)).total_seconds()
    return age_sec > seuil_sec


class StoreError(RuntimeError):
    """Incohérence bloquante de la base locale."""


class Store:
    """Base locale du poste. Une instance par processus."""

    def __init__(self, data_dir: str, device_code: str) -> None:
        if not device_code:
            raise ValueError("device_code requis")
        self.device_code = device_code
        self.data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)
        self.path = os.path.join(data_dir, DB_FILENAME)

        self._conn = sqlite3.connect(self.path, timeout=10.0, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        # Des heures de travail font foi : on privilégie la durabilité à la vitesse.
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)
        self._init_chain_state()

    # ------------------------------------------------------------------ chaîne

    def _init_chain_state(self) -> None:
        row = self._conn.execute(
            "SELECT device_code, sequence, last_hash FROM chain_state WHERE id = 1"
        ).fetchone()

        if row is None:
            self._conn.execute(
                "INSERT INTO chain_state (id, device_code, sequence, last_hash)"
                " VALUES (1, ?, 0, ?)",
                (self.device_code, chain_mod.genesis_hash(self.device_code)),
            )
            return

        if row["device_code"] != self.device_code:
            # La chaîne appartient à un poste : on ne la poursuit jamais sous un
            # autre code, cela invaliderait la vérification serveur.
            raise StoreError(
                "base locale appartenant au poste "
                f"'{row['device_code']}', configuration '{self.device_code}'"
            )

    def chain_state(self) -> Dict[str, Any]:
        """Séquence courante et dernier hash de la chaîne."""
        row = self._conn.execute(
            "SELECT sequence, last_hash FROM chain_state WHERE id = 1"
        ).fetchone()
        return {"sequence": row["sequence"], "last_hash": row["last_hash"]}

    # -------------------------------------------------------------- pointages

    def enqueue_pointage(
        self,
        *,
        uid_hmac: str = NO_BADGE,
        horodatage_utc: Optional[_dt.datetime] = None,
        sens: str,
        source: str = "badge",
        salarie_id: Optional[int] = None,
        pointage_uuid: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Enregistre un pointage et le met en file, en une seule transaction.

        Réserve la séquence, calcule le chaînage et écrit la file de manière
        atomique : un arrêt brutal laisse la base cohérente (le pointage est
        présent avec sa séquence, ou absent — jamais à moitié).

        :returns: la charge utile prête à transmettre (CONTRAT_API_DEVICE §2.1).
        """
        moment = horodatage_utc or _dt.datetime.now(_dt.timezone.utc)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=_dt.timezone.utc)
        record_uuid = pointage_uuid or str(_uuid.uuid4())
        # Frontière de casse (QA-12) : un uid_hmac est toujours un hexadécimal
        # minuscule (hexdigest) ; "-" (NO_BADGE) est inchangé par .lower().
        uid_hmac_normalise = (uid_hmac or NO_BADGE).lower()

        conn = self._conn
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT sequence, last_hash FROM chain_state WHERE id = 1"
            ).fetchone()
            sequence = int(row["sequence"]) + 1
            previous_hash = row["last_hash"]

            payload = {
                "uuid": record_uuid,
                "sequence_device": sequence,
                "uid_hmac": uid_hmac_normalise,
                "horodatage_utc": chain_mod.utc_iso_ms(moment),
                "horodatage_local": moment.astimezone(PARIS).strftime(
                    "%Y-%m-%dT%H:%M:%S"
                ),
                "fuseau": "Europe/Paris",
                "sens": sens,
                "source": source,
                "hash_precedent": previous_hash,
            }
            canonical = chain_mod.canonical(
                {**payload, "device_code": self.device_code}
            )
            payload["hash_courant"] = chain_mod.chain_hash(previous_hash, canonical)

            conn.execute(
                "INSERT INTO queue (uuid, sequence_device, payload_json, created_at)"
                " VALUES (?, ?, ?, ?)",
                (
                    record_uuid,
                    sequence,
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    chain_mod.utc_iso_ms(_dt.datetime.now(_dt.timezone.utc)),
                ),
            )
            conn.execute(
                "UPDATE chain_state SET sequence = ?, last_hash = ? WHERE id = 1",
                (sequence, payload["hash_courant"]),
            )
            conn.execute(
                "INSERT OR REPLACE INTO pointages_locaux"
                " (uuid, salarie_id, horodatage_utc, sens) VALUES (?, ?, ?, ?)",
                (record_uuid, salarie_id, payload["horodatage_utc"], sens),
            )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

        return payload

    def pending_batch(self, limit: int = MAX_BATCH) -> List[Dict[str, Any]]:
        """Prochain lot à transmettre, ordonné par séquence croissante."""
        size = max(1, min(int(limit), MAX_BATCH))
        rows = self._conn.execute(
            "SELECT payload_json FROM queue ORDER BY sequence_device ASC LIMIT ?",
            (size,),
        ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def ack(self, resultats: Iterable[Mapping[str, Any]]) -> int:
        """Purge les pointages **accusés** par le serveur.

        ``ok``, ``duplicate``, ``orphan`` et ``invalid`` valent tous accusé de
        réception TERMINAL (PST-05, CONTRAT_API_DEVICE §2.1 amendement v1.1) :
        un élément ``invalid`` est malformé au point de ne jamais pouvoir être
        réparé par une retransmission, donc il est purgé comme les autres —
        mais son passage est tracé (compteur persistant ``invalides`` +
        journal WARNING côté appelant, cf. ``sync.py``) pour que la perte
        reste visible en exploitation au lieu de disparaître. Tout autre
        statut (y compris un statut inconnu, ex. futur défaut serveur) laisse
        l'élément en file : aucune heure ne se perd, quitte à être
        retransmise.
        """
        purgeables: List[str] = []
        invalides = 0
        for item in resultats:
            if not isinstance(item, Mapping):
                continue
            uuid = item.get("uuid")
            statut = str(item.get("status"))
            if not uuid or statut not in ACK_STATUSES:
                continue
            purgeables.append(str(uuid))
            if statut == "invalid":
                invalides += 1

        if not purgeables:
            return 0

        conn = self._conn
        conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = conn.executemany(
                "DELETE FROM queue WHERE uuid = ?", [(u,) for u in purgeables]
            )
            deleted = cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
            if invalides:
                conn.execute(
                    "INSERT INTO compteurs (cle, valeur) VALUES (?, ?)"
                    " ON CONFLICT(cle) DO UPDATE SET valeur = valeur + excluded.valeur",
                    (COMPTEUR_INVALIDES, invalides),
                )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        return deleted

    def invalid_count(self) -> int:
        """Nombre total de pointages ``invalid`` purgés depuis l'appairage.

        Persistant (table ``compteurs``) : survit à un redémarrage du poste,
        contrairement à la file elle-même qui, elle, se vide sur purge.
        """
        row = self._conn.execute(
            "SELECT valeur FROM compteurs WHERE cle = ?", (COMPTEUR_INVALIDES,)
        ).fetchone()
        return int(row["valeur"]) if row else 0

    def queue_size(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) AS n FROM queue").fetchone()
        return int(row["n"])

    def oldest_queued_at(self) -> Optional[str]:
        row = self._conn.execute(
            "SELECT created_at FROM queue ORDER BY sequence_device ASC LIMIT 1"
        ).fetchone()
        return row["created_at"] if row else None

    # ----------------------------------------------------------------- badges

    def replace_badges(self, badges: Iterable[Mapping[str, Any]]) -> int:
        """Remplace le cache des badges actifs (transaction atomique).

        Ne conserve que les quatre champs du contrat : tout autre champ envoyé
        par le serveur est ignoré, par construction.
        """
        rows = []
        for badge in badges:
            uid_hmac = badge.get("uid_hmac")
            salarie_id = badge.get("salarie_id")
            if not uid_hmac or salarie_id is None:
                continue
            rows.append(
                (
                    # Frontière de casse (QA-12) : le serveur normalise déjà en
                    # minuscules, mais on ne fait pas confiance à la source —
                    # un condensat local (toujours minuscule, hexdigest) doit
                    # retrouver ce badge quelle que soit la casse transmise.
                    str(uid_hmac).lower(),
                    int(salarie_id),
                    str(badge.get("prenom") or ""),
                    str(badge.get("initiale_nom") or badge.get("initiale") or ""),
                )
            )

        conn = self._conn
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("DELETE FROM badges")
            conn.executemany(
                "INSERT OR REPLACE INTO badges (uid_hmac, salarie_id, prenom, initiale)"
                " VALUES (?, ?, ?, ?)",
                rows,
            )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        return len(rows)

    def find_badge(self, uid_hmac: str) -> Optional[Dict[str, Any]]:
        # Frontière de casse (QA-12) : normalise en miroir de replace_badges.
        row = self._conn.execute(
            "SELECT uid_hmac, salarie_id, prenom, initiale FROM badges"
            " WHERE uid_hmac = ?",
            ((uid_hmac or "").lower(),),
        ).fetchone()
        return dict(row) if row else None

    def badges_count(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) AS n FROM badges").fetchone()
        return int(row["n"])

    # ------------------------------------------------------- alternance E / S

    def events_for_salarie(
        self, salarie_id: int, reference_utc: Optional[_dt.datetime] = None
    ) -> List[PointageLocal]:
        """Pointages récents d'un salarié, pour le calcul du sens.

        Fenêtre volontairement large (48 h) : le filtrage sur le jour civil
        Europe/Paris est fait par :func:`sens.determine_sens`, qui est la source
        unique de cette règle.
        """
        moment = reference_utc or _dt.datetime.now(_dt.timezone.utc)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=_dt.timezone.utc)
        floor = chain_mod.utc_iso_ms(moment - _dt.timedelta(hours=48))

        rows = self._conn.execute(
            "SELECT horodatage_utc, sens FROM pointages_locaux"
            " WHERE salarie_id = ? AND horodatage_utc >= ?"
            " ORDER BY horodatage_utc ASC",
            (int(salarie_id), floor),
        ).fetchall()
        return [
            PointageLocal(
                horodatage_utc=chain_mod.parse_utc_iso(row["horodatage_utc"]),
                sens=row["sens"],
            )
            for row in rows
        ]

    def count_events_since(self, salarie_id: int, since_utc: _dt.datetime) -> int:
        """Nombre de pointages d'un salarié depuis un instant (cumul indicatif)."""
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM pointages_locaux"
            " WHERE salarie_id = ? AND horodatage_utc >= ?",
            (int(salarie_id), chain_mod.utc_iso_ms(since_utc)),
        ).fetchone()
        return int(row["n"])

    def events_between(
        self, salarie_id: int, debut_utc: _dt.datetime, fin_utc: _dt.datetime
    ) -> List[PointageLocal]:
        """Pointages d'un salarié sur une fenêtre (cumul hebdomadaire local)."""
        rows = self._conn.execute(
            "SELECT horodatage_utc, sens FROM pointages_locaux"
            " WHERE salarie_id = ? AND horodatage_utc >= ? AND horodatage_utc <= ?"
            " ORDER BY horodatage_utc ASC",
            (
                int(salarie_id),
                chain_mod.utc_iso_ms(debut_utc),
                chain_mod.utc_iso_ms(fin_utc),
            ),
        ).fetchall()
        return [
            PointageLocal(
                horodatage_utc=chain_mod.parse_utc_iso(row["horodatage_utc"]),
                sens=row["sens"],
            )
            for row in rows
        ]

    def purge_old_events(self, days: int = LOCAL_EVENTS_RETENTION_DAYS) -> int:
        """Supprime les pointages locaux hors fenêtre d'alternance.

        Ne touche jamais à la file : un pointage non accusé reste, même ancien.
        """
        floor = chain_mod.utc_iso_ms(
            _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=max(1, days))
        )
        conn = self._conn
        conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = conn.execute(
                "DELETE FROM pointages_locaux WHERE horodatage_utc < ?"
                " AND uuid NOT IN (SELECT uuid FROM queue)",
                (floor,),
            )
            deleted = cursor.rowcount or 0
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        return deleted

    # ------------------------------------------------------ cache config / etc

    def set_cache(self, key: str, value: Any, etag: Optional[str] = None) -> None:
        """Mémorise une réponse serveur (config, playlist, drapeaux internes)."""
        self._conn.execute(
            "INSERT INTO cache (cle, valeur_json, etag, maj_le) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(cle) DO UPDATE SET"
            " valeur_json = excluded.valeur_json,"
            " etag = excluded.etag, maj_le = excluded.maj_le",
            (
                key,
                json.dumps(value, ensure_ascii=False),
                etag,
                chain_mod.utc_iso_ms(_dt.datetime.now(_dt.timezone.utc)),
            ),
        )

    def get_cache(self, key: str, default: Any = None) -> Any:
        row = self._conn.execute(
            "SELECT valeur_json FROM cache WHERE cle = ?", (key,)
        ).fetchone()
        if row is None:
            return default
        try:
            return json.loads(row["valeur_json"])
        except (ValueError, TypeError):
            return default

    def get_etag(self, key: str) -> Optional[str]:
        row = self._conn.execute(
            "SELECT etag FROM cache WHERE cle = ?", (key,)
        ).fetchone()
        return row["etag"] if row else None

    def touch_etag(self, key: str, etag: Optional[str]) -> None:
        """Rafraîchit l'ETag sans toucher à la valeur (réponse ``304``)."""
        self._conn.execute(
            "UPDATE cache SET etag = ?, maj_le = ? WHERE cle = ?",
            (
                etag,
                chain_mod.utc_iso_ms(_dt.datetime.now(_dt.timezone.utc)),
                key,
            ),
        )

    # ---------------------------------------------------------------- cycle de vie

    def flush(self) -> None:
        """Force l'écriture du WAL (arrêt propre, PST-09)."""
        try:
            self._conn.execute("PRAGMA wal_checkpoint(FULL)")
        except sqlite3.Error:
            pass

    def close(self) -> None:
        self.flush()
        self._conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
