# Runbook — Test de restauration de sauvegarde

> Audit Direction (D7 + RPO/RTO) — la qualité d'une sauvegarde n'est
> connue qu'après un test de restauration. Ce runbook décrit la procédure
> mensuelle obligatoire à exécuter pour valider que les backups S3
> (V1 #6) sont effectivement restaurables.

## Pourquoi

Une sauvegarde non testée n'est **pas** une sauvegarde — c'est une
hypothèse. Sans test régulier, on découvre les défauts uniquement
quand on en a besoin (catastrophe). Cible :
- **RTO** (Recovery Time Objective) : ≤ 30 min
- **RPO** (Recovery Point Objective) : ≤ 1h (avec backups 6h-incremental)

## Fréquence

| Type | Fréquence | Responsable |
|---|---|---|
| Test rapide (intégrité fichier) | hebdomadaire — automatique | script `verify-backup.sh` |
| Test complet (restore + smoke) | mensuel — manuel | Ops (1 personne) |
| Test DR complet (instance jetable) | trimestriel | Ops + RSSI |

## Procédure — test mensuel

### Pré-requis

- Accès SSH au serveur prod (`51.159.144.100`)
- Credentials Scaleway Object Storage (`/etc/solidata-backup.env`)
- Une instance Postgres jetable (Docker local, RAM only)

### 1. Récupérer le backup le plus récent depuis S3

```bash
ssh root@51.159.144.100
source /etc/solidata-backup.env

# Lister les backups daily récents
aws --endpoint-url="$S3_ENDPOINT" s3 ls "s3://${S3_BUCKET}/daily/" --recursive | tail -5

# Télécharger le plus récent dans /tmp/restore-test
mkdir -p /tmp/restore-test
LATEST=$(aws --endpoint-url="$S3_ENDPOINT" s3 ls "s3://${S3_BUCKET}/daily/" \
  | tail -1 | awk '{print $4}')
aws --endpoint-url="$S3_ENDPOINT" s3 cp \
  "s3://${S3_BUCKET}/daily/${LATEST}/db_daily_${LATEST}.dump" \
  /tmp/restore-test/db_test.dump
```

### 2. Vérifier l'intégrité (checksum SHA-256)

```bash
aws --endpoint-url="$S3_ENDPOINT" s3 cp \
  "s3://${S3_BUCKET}/daily/${LATEST}/checksums_daily_${LATEST}.sha256" \
  /tmp/restore-test/checksums.sha256

cd /tmp/restore-test
sha256sum -c checksums.sha256
# Doit afficher : OK
```

### 3. Restaurer dans une instance Postgres jetable

```bash
# Démarrer un Postgres temporaire en mémoire (Docker)
docker run --rm -d --name pg-restore-test \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=solidata_test \
  -p 15432:5432 \
  postgis/postgis:15-3.4

# Attendre que ce soit prêt
sleep 8

# Restaurer
docker cp /tmp/restore-test/db_test.dump pg-restore-test:/tmp/

START=$(date +%s)
docker exec pg-restore-test pg_restore \
  -U postgres -d solidata_test \
  --no-owner --no-acl \
  /tmp/db_test.dump
END=$(date +%s)
echo "Restore terminé en $((END - START)) secondes"
```

### 4. Smoke test post-restore

```bash
# Vérifier les volumes critiques (le nombre attendu doit matcher)
docker exec pg-restore-test psql -U postgres -d solidata_test -c "
  SELECT 'cav' AS table, COUNT(*) FROM cav
  UNION ALL SELECT 'tours', COUNT(*) FROM tours
  UNION ALL SELECT 'employees', COUNT(*) FROM employees
  UNION ALL SELECT 'candidates', COUNT(*) FROM candidates
  UNION ALL SELECT 'production_daily', COUNT(*) FROM production_daily
  UNION ALL SELECT 'expeditions', COUNT(*) FROM expeditions
  UNION ALL SELECT 'partners', COUNT(*) FROM partners;
"

# Vérifier l'intégrité référentielle (échantillon)
docker exec pg-restore-test psql -U postgres -d solidata_test -c "
  SELECT COUNT(*) AS orphan_tour_cav
  FROM tour_cav tc
  LEFT JOIN tours t ON t.id = tc.tour_id
  WHERE t.id IS NULL;
"
# Doit retourner 0

# Vérifier qu'un user admin existe
docker exec pg-restore-test psql -U postgres -d solidata_test -c "
  SELECT id, username, role FROM users WHERE role = 'ADMIN' LIMIT 3;
"
```

### 5. Documenter le résultat

Remplir dans `rapports/restore-tests.md` :

```markdown
## YYYY-MM-DD

- Backup testé : `db_daily_YYYYMMDD_HHMMSS.dump`
- Taille : XX MB
- Checksum : OK
- Durée restore : XX secondes
- Volumes :
  - cav : XXX
  - tours : XXXX
  - employees : XXX
  - …
- Orphelins : 0
- Verdict : ✅ OK / ❌ KO (raison)
- Opérateur : <nom>
```

### 6. Cleanup

```bash
docker stop pg-restore-test
rm -rf /tmp/restore-test
```

## Procédure — test DR complet (trimestriel)

Étendre la procédure mensuelle avec :

1. Restaurer **aussi** le tar uploads (`uploads_daily_YYYYMMDD.tar.gz`)
2. Lancer une instance complète SOLIDATA pointant sur la base restaurée
3. Faire un parcours utilisateur : login → dashboard → créer tournée
4. Mesurer le **RTO total** : du moment où l'on déclare l'incident jusqu'à
   l'application opérationnelle avec données cohérentes

## Critères de réussite

| Critère | Cible | KO si |
|---|---|---|
| Checksum SHA-256 | OK | mismatch |
| Restore termine | < 5 min | erreur ou > 15 min |
| Volumes restaurés | ≥ 95 % du prod | < 90 % |
| Orphelins FK | 0 | > 0 |
| Smoke test login | OK | KO |
| RTO complet | < 30 min | > 60 min |

## Alertes

Si le test échoue :
1. **Bloquer** les déploiements jusqu'à correction
2. Identifier la cause (script backup, format pg_dump, S3, …)
3. Re-tester avec un backup antérieur pour isoler la régression
4. Notifier la Direction si la fenêtre RPO 24h est dépassée

## Automatisation future (V5 backlog)

- Script `verify-backup.sh` : test rapide hebdomadaire automatique
  (download + checksum + count rows critiques) → notification Slack
- CI cron : test mensuel sans intervention humaine, rapport auto
- Failover DR depuis backup automatique (si réplication PG en place,
  cf. runbook §4)
