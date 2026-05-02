# RUNBOOK — Roadmap infrastructure & refactor

> Runbook opérationnel pour les actions du plan d'action multi-agents
> qui n'ont pas pu être appliquées via du code (elles requièrent des
> accès serveur ou un séquencement humain). Chaque section donne les
> commandes exactes, les checks et les rollback.
>
> **Statut au 1er mai 2026** — actions P0 et P1 (composants UI + logs HTTP)
> appliquées via code. Reste : actions infra (P0 #6 finalisation, P1 #12-14, P2 #16-21).

---

## 1. P0 #6 — Mise en production des backups S3

Le script `deploy/scripts/backup-s3.sh` est livré. Pour l'activer :

### Pré-requis
1. Ouvrir un compte **Scaleway Object Storage** (région `fr-par`, classe `STANDARD_IA`)
   ou un bucket S3 AWS. Bucket cible : `solidata-backups`.
2. Générer une paire access-key/secret-key dédiée au backup
   (permissions : `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` sur ce bucket uniquement).

### Installation sur le serveur prod
```bash
ssh root@51.159.144.100
apt-get update && apt-get install -y awscli

# Fichier de credentials (lecture seule pour root, jamais en argv)
cat > /etc/solidata-backup.env <<'EOF'
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_BUCKET=solidata-backups
AWS_ACCESS_KEY_ID=SCWxxxxxxxx
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=fr-par
ALERT_WEBHOOK=https://hooks.slack.com/services/xxx
EOF
chmod 600 /etc/solidata-backup.env

# Cron : daily 02h, weekly dimanche 03h, monthly 1er du mois 04h
crontab -e
# Ajouter :
0 2 * * * /opt/solidata.online/deploy/scripts/backup-s3.sh daily   >> /var/log/solidata-backup-cron.log 2>&1
0 3 * * 0 /opt/solidata.online/deploy/scripts/backup-s3.sh weekly  >> /var/log/solidata-backup-cron.log 2>&1
0 4 1 * * /opt/solidata.online/deploy/scripts/backup-s3.sh monthly >> /var/log/solidata-backup-cron.log 2>&1
```

### Tests d'acceptation
```bash
# 1. Lancement manuel
bash /opt/solidata.online/deploy/scripts/backup-s3.sh manual

# 2. Vérifier l'upload
aws --endpoint-url=https://s3.fr-par.scw.cloud s3 ls s3://solidata-backups/manual/ --recursive

# 3. Test restore mensuel obligatoire
docker run --rm -e PGPASSWORD=$DB_PASSWORD postgres:15 \
  pg_restore --list /tmp/db_manual_xxx.dump | head -20
```

### Rétention
- daily : 30 jours locaux + 30 jours S3
- weekly : 12 semaines
- monthly : 12 mois
- manual : 90 jours

**RPO cible** : 24h (réduit à 1h si on ajoute du WAL archiving — voir P1 #14).
**RTO cible** : 30 min (test de restore mensuel obligatoire).

---

## 2. P1 #12 — Refactor module `tours/` (15 → 3 fichiers)

### État actuel
`backend/src/routes/tours/` = 15 fichiers (5.2K lignes), couplages forts.

### Cible
- `tours/planning.js` ← merge `crud.js` + `planning.js` (CRUD + planification)
- `tours/execution.js` ← merge `execution.js` + `events*.js` + `live-summary.js`
- `tours/ai.js` ← merge `predictions.js` + `stats.js` + `smart-tour.js`
- `tours/index.js` reste l'orchestrateur, monte les 3 sous-routers.

### Procédure (sans casse API)
```bash
git checkout -b refactor/tours-consolidation

# 1. Identifier la liste exhaustive des endpoints exposés
grep -nE "^router\.(get|post|put|delete)" backend/src/routes/tours/*.js > /tmp/tours-endpoints.txt

# 2. Créer les 3 nouveaux fichiers en y déplaçant les blocs (commit par sous-router)
# 3. Vérifier que `tours/index.js` re-monte tout le monde
# 4. Smoke test :
node backend/src/scripts/tests/api-smoke.js
# 5. Vérifier qu'aucun endpoint n'est perdu
diff <(sort /tmp/tours-endpoints.txt) <(grep -nE "^router\.(get|post|put|delete)" backend/src/routes/tours/{planning,execution,ai}.js | sort)
```

**Effort** : 8h. **Risque** : moyen — déploiement avec fenêtre 30 min.

---

## 3. P1 #13 — Extraire `BillingService` + fusion facturation

### Contexte
`billing.js` (146 L) et `factures-exutoires.js` (306 L) partagent ~40 % de code (`generateInvoiceNumber`, calcul HT/TVA/TTC, statut enum).

### Cible
```
backend/src/services/BillingService.js        ← logique pure
backend/src/repositories/InvoiceRepository.js ← accès DB
backend/src/routes/invoices.js                ← unifie les 2 routes (/api/invoices?type=internal|exutoire)
```

### Étapes
1. Créer `BillingService` avec `generateInvoiceNumber(type, year)`, `calculateTotals(lines)`, `validateTransition(from, to)`.
2. Créer `InvoiceRepository` (CRUD + filtres).
3. Tests unitaires sur le service (Jest) — cible 80 % de couverture.
4. Réécrire `routes/billing.js` en thin controller.
5. Fusionner `factures-exutoires.js` → routes pointent vers le même service.
6. Garder backward compat : `/api/factures-exutoires` redirige 301 vers `/api/invoices?type=exutoire` pendant 30 jours.

**Effort** : 7h. **Risque** : moyen.

---

## 4. P1 #14 — Réplication PostgreSQL primary + standby

### Cible
1 primary (DEV1-M) + 1 standby (DEV1-S) avec streaming replication async.

### Procédure
```bash
# Sur le standby (nouveau serveur)
docker run --rm -v solidata-pgdata-standby:/var/lib/postgresql/data postgres:15 \
  pg_basebackup -h <PRIMARY_IP> -U replicator -D /var/lib/postgresql/data -P -R

# Activer streaming sur primary
# /var/lib/postgresql/data/postgresql.conf
wal_level = replica
max_wal_senders = 5
wal_keep_size = 2GB
archive_mode = on
archive_command = 'aws s3 cp %p s3://solidata-backups/wal/%f --endpoint-url=https://s3.fr-par.scw.cloud'

# Sur primary, créer le user replicator
docker exec -it solidata-db psql -U solidata_user -d postgres -c \
  "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '...';"

# pg_hba.conf : ajouter
host replication replicator <STANDBY_IP>/32 scram-sha-256
```

### Monitoring lag
```sql
SELECT client_addr, state, sent_lsn, replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes
FROM pg_stat_replication;
```
**SLA** : lag < 10s.

### Failover (manuel)
```bash
docker exec solidata-db-standby pg_ctl promote -D /var/lib/postgresql/data
# Pointer le backend vers le standby
docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

**Effort** : 8h. **Risque** : haut — fenêtre 1-2h.

---

## 5. P2 #16 — Repository layer (5 modules prioritaires)

Modules à abstraire en premier (impact x complexité) :
1. `BillingRepository` (déjà sous P1 #13)
2. `TourRepository` (15 fichiers tours)
3. `StockRepository` (`stock.js` + `stock-original.js`)
4. `EmployeeRepository` (employés + heures + insertion)
5. `BoutiqueRepository` (5 routes boutique-*)

**Pattern de référence** :
```javascript
// repositories/TourRepository.js
const pool = require('../config/database');
class TourRepository {
  async findById(id) { /* ... */ }
  async findByDateRange(from, to) { /* ... */ }
  async create(data) { /* ... */ }
  async updateStatus(id, status) { /* ... */ }
}
module.exports = new TourRepository();
```
**Tests Jest** : mock `pool.query`, valider que la repository ne contient AUCUNE logique métier.

**Effort cumulé** : 10h.

---

## 6. P2 #17 — `ModalForm` + `DataGrid`

### `ModalForm`
Wrapper de `Modal` qui prend une définition déclarative `fields[]` (cf. spec dans le rapport UI). Cible : remplacer 22 modales custom dans `Candidates`, `ExutoiresCommandes`, `ProduitsFinis`, `Tours`, etc. (-1200 lignes).

### `DataGrid`
Extension de `DataTable` avec :
- multi-filtre par colonne (`filterable: true`, `filterOptions`)
- sélection multiple (checkbox bulk actions)
- export CSV/XLSX intégré
- `error` prop branchée sur `ErrorState`

**Effort** : 14h. **Priorité** : faire après que les conventions FormField/ErrorState soient adoptées sur 5+ pages.

---

## 7. P2 #18 — Scheduler dédié + BullMQ workers

### Architecture cible
```
docker-compose.prod.yml :
  - scheduler (Dockerfile.scheduler)  ← cron jobs en process séparé
  - worker-ocr (Dockerfile.worker)    ← OCR/PDF via BullMQ
  - worker-email (Dockerfile.worker)  ← Brevo SMS/email via BullMQ
```

### Étapes
1. Extraire `backend/src/services/scheduler.js` en binaire autonome (`scheduler/index.js`).
2. Créer `Dockerfile.scheduler` (réutilise `node:20-alpine`, lance `node scheduler/index.js`).
3. Définir 3 queues BullMQ : `ocr-processing`, `email-sending`, `pdf-generation`.
4. Implémenter Dead Letter Queue (3 tentatives, backoff exponentiel).
5. Ajouter routes admin `/api/admin/jobs` pour visualiser état des queues.

**Effort** : 8h.

---

## 8. P2 #19 — Secrets manager

### Recommandation
Scaleway Secrets Manager (ou Vault open-source self-hosted).

### Migration
1. Créer secrets dans Scaleway : `JWT_SECRET`, `DB_PASSWORD`, `PCM_ENCRYPTION_KEY`, `BREVO_API_KEY`, `ANTHROPIC_API_KEY`.
2. Modifier `deploy.sh` pour fetch secrets via API au déploiement.
3. Ne plus committer `.env` (déjà ignoré, mais vérifier `.env.example`).
4. Rotation JWT_SECRET tous les 90 jours (manuel pour l'instant).

**Effort** : 4h.

---

## 9. P2 #20 — Vues matérialisées dashboard

```sql
CREATE MATERIALIZED VIEW mv_dashboard_kpis AS
SELECT
  CURRENT_DATE AS as_of,
  (SELECT COUNT(*) FROM cav WHERE status = 'active')                                  AS cav_actifs,
  (SELECT COUNT(*) FROM tours WHERE date = CURRENT_DATE)                              AS tours_aujourdhui,
  (SELECT COALESCE(SUM(total_weight_kg),0) FROM tours
     WHERE date >= DATE_TRUNC('month', CURRENT_DATE) AND status = 'completed')        AS tonnage_mois_kg,
  (SELECT COALESCE(SUM(kg_entree),0) FROM production_daily
     WHERE date >= DATE_TRUNC('month', CURRENT_DATE))                                 AS tri_mois_kg,
  (SELECT COUNT(*) FROM employees WHERE statut = 'actif')                             AS employes_actifs;

CREATE UNIQUE INDEX ON mv_dashboard_kpis (as_of);

-- Refresh CRON toutes les heures
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_kpis;
```
Ajouter dans `backend/src/services/scheduler.js` un job horaire :
```javascript
cron.schedule('0 * * * *', () => pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_kpis'));
```

**Effort** : 4h.

---

## 10. P2 #21 — Pagination & virtualisation

### Pages prioritaires
- `Candidates.jsx` (1237 L, jusqu'à 500+ candidats à terme)
- `Stock.jsx` (mouvements, plusieurs milliers à l'année)
- `Employees.jsx` (~100 employés mais grande table avec colonnes lourdes)

### Pattern
1. Ajouter pagination serveur : `GET /api/candidates?page=1&limit=50`.
2. Côté front, hook `usePagination()` + ajout `pagination` prop sur `DataTable`.
3. Pour les listes > 200 items en mémoire, intégrer `react-window` (4kb gzip).

**Effort** : 6h.

---

## Tableau de synthèse

| ID    | Action                              | Effort | Risque | Pré-requis            |
|-------|-------------------------------------|--------|--------|-----------------------|
| P0 #6 | Backups S3 — activation prod        | 1h     | bas    | Bucket Scaleway      |
| P1 #12| Refactor tours/                     | 8h     | moyen  | Smoke tests          |
| P1 #13| BillingService + fusion facturation | 7h     | moyen  | Tests Jest           |
| P1 #14| Réplication PostgreSQL              | 8h     | haut   | 2e serveur           |
| P2 #16| Repository layer (5 modules)        | 10h    | bas    | P1 #13 done          |
| P2 #17| ModalForm + DataGrid                | 14h    | bas    | FormField adopté     |
| P2 #18| Scheduler dédié + BullMQ            | 8h     | moyen  | Redis 256MB done     |
| P2 #19| Secrets manager                     | 4h     | bas    | Scaleway secrets API |
| P2 #20| Vues matérialisées dashboard        | 4h     | bas    | —                    |
| P2 #21| Pagination & virtualisation         | 6h     | bas    | —                    |

**Total restant** : ~70h sur 4-6 semaines.
