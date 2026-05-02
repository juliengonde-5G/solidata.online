# RUNBOOK — Sécurité dépendances (npm audit)

> Audit réalisé le 1er mai 2026 sur la branche `fix/security-quick-wins-2026-05`.

## État après V1

### Frontend — ✅ 0 vulnérabilité

`npm audit fix` (non-force) appliqué. Avant : 7 vuln (3 moderate, 4 high — vite path traversal, socket.io binary attachments). Après : 0.

```bash
cd frontend && npm audit
# found 0 vulnerabilities
```

### Backend — ⚠ 4 vulnérabilités résiduelles (toutes nécessitent breaking change)

| Package | Sévérité | CVE | Fix dispo | Risque pratique | Action recommandée |
|---|---|---|---|---|---|
| `xlsx` (sheetjs) | High | Prototype Pollution + ReDoS | **Aucun fix npm** | **Faible** : utilisé uniquement dans `backend/src/scripts/seed-*.js` et `import-excel.js` — exécutés manuellement par admin sur des fichiers maîtrisés. Pas en chemin requête HTTP. | Migrer scripts vers `exceljs` (déjà installé). Effort : 4-6h. À planifier en V4. |
| `@anthropic-ai/sdk` | Moderate | Memory Tool Path Validation + File Permissions | `0.80 → 0.92` (breaking) | **Très faible** : SolidataBot n'utilise pas le Memory Tool (chat conversationnel simple). | MAJ planifiée en V4 avec smoke test SolidataBot. |
| `exceljs` (via uuid) | Moderate | uuid v3/v5/v6 buffer bounds check | Downgrade `exceljs 4 → 3.4.0` (breaking) | Faible (uuid utilisé pour gen IDs internes) | Attendre exceljs 4.x corrigé upstream, ou downgrade testé en V4. |
| `bullmq` (via uuid) | Moderate | idem | breaking | Faible (idem) | Idem — attendre upstream ou MAJ testée. |

## Procédure de mise à jour testée (à exécuter en V4 après tests Jest)

### Étape 1 — Préparation
```bash
git checkout -b chore/npm-audit-fix-backend
cd backend
cp package.json package.json.backup
cp package-lock.json package-lock.json.backup
```

### Étape 2 — MAJ Anthropic SDK (impact : SolidataBot)
```bash
npm install @anthropic-ai/sdk@latest
# Smoke test :
node -e "const Anthropic = require('@anthropic-ai/sdk'); console.log(Anthropic.VERSION || 'OK');"
```
Tester via UI : ouvrir SolidataBot, poser une question, vérifier la réponse. Si KO : `mv package.json.backup package.json && npm install`.

### Étape 3 — Migration scripts xlsx → exceljs
Fichiers concernés :
- `backend/src/scripts/import-excel.js` (18)
- `backend/src/scripts/seed-data.js` (9)
- `backend/src/scripts/seed-historique.js` (12)
- `backend/src/scripts/seed-production.js` (6)
- `backend/src/scripts/seed-cav.js` (18)

**Pattern de remplacement** (ligne par ligne) :
```javascript
// AVANT (xlsx) :
const XLSX = require('xlsx');
const workbook = XLSX.readFile(path);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet);

// APRÈS (exceljs) :
const ExcelJS = require('exceljs');
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(path);
const sheet = workbook.worksheets[0];
const rows = [];
sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
  if (rowNum === 1) return;  // header
  const obj = {};
  row.eachCell((cell, colNum) => {
    const header = sheet.getRow(1).getCell(colNum).value;
    obj[header] = cell.value;
  });
  rows.push(obj);
});
```

### Étape 4 — Désinstaller xlsx
```bash
npm uninstall xlsx
npm audit
# Doit afficher : found 0 vulnerabilities
```

### Étape 5 — Smoke test scripts
```bash
# Tester chaque script avec un Excel de test :
node src/scripts/import-excel.js --dry-run
node src/scripts/seed-cav.js --check
# (Adapter selon arguments existants)
```

### Étape 6 — Commit
```bash
git add -A && git commit -m "chore: migrate xlsx → exceljs (eliminate xlsx prototype pollution)"
git push -u origin chore/npm-audit-fix-backend
```

## Monitoring continu

- **Dependabot** : à activer sur GitHub repo → auto PR pour mineures, review humaine pour majeures.
- **CI/CD** : ajouter `npm audit --audit-level=high --omit=dev` en pre-build → bloque si nouvelle vuln HIGH.
- **Audit trimestriel** : `npm audit` + `npm outdated` revus tous les 3 mois.

## Verdict V1

✅ **Frontend** : couvert
⚠ **Backend** : risque résiduel HIGH (`xlsx`) **acceptable** car hors chemin HTTP. Plan d'action documenté, application en V4.
