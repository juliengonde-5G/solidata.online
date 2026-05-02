# State machines métier — référentiel

> Source unique des transitions d'état autorisées (Enterprise Architect Ch2).
> Toute logique de statut métier doit consommer ce moteur, jamais
> ré-implémenter ses propres règles localement.

## Pourquoi

L'audit transverse a relevé **20+ enums statuts disjoints** (commandes 9,
préparations 5, contrôles 4, factures 4, boutique 5, …) avec :

- pas de cohérence des transitions inter-modules (ex : commande passe à
  `expediee` sans que la préparation passe à `pesee_interne`)
- aucun audit trail : impossible de répondre à "qui a passé la commande
  X de chargee à expediee, quand, et pourquoi ?"
- duplication de la logique de validation dans chaque route
- mismatch silencieux frontend/backend (cf. bug `chargée` vs `chargee`
  documenté dans CLAUDE.md le 4/4)

## Architecture

```
backend/src/services/
  ├── state-machines.js   ← définitions déclaratives (5 machines)
  └── state-machine.js    ← moteur générique : canTransition + transition

backend/src/routes/
  └── state-machines.js   ← API d'introspection (UI dropdown, audit)

backend/src/scripts/init-db.js
  └── state_transitions_audit (table) — log de toutes les transitions
```

## Machines définies

| Machine | États (initial → terminal) | Utilisée par |
|---|---|---|
| `commande_exutoire` | brouillon → confirmee → en_preparation → chargee → expediee → pesee_recue → facturee → cloturee (+ annulee) | `commandes_exutoires` |
| `preparation_expedition` | planifiee → en_chargement → pesee_interne → en_controle → finalisee (+ annulee) | `preparations_expedition` |
| `controle_pesee` | ouvert → conforme \| ecart_acceptable \| litige → litige_clos | `controles_pesee` |
| `facture_exutoire` | recue → conforme \| ecart → validee \| rejetee | `factures_exutoires` |
| `boutique_commande` | brouillon → envoyee → ajustee → en_preparation → expediee (+ annulee) | `boutique_commandes` |

## Conventions

- Tous les noms d'état en **snake_case ASCII** (pas d'accent). Les anciens
  libellés accentués (ex: `chargée`) sont gérés en lecture via `aliases`,
  jamais en écriture.
- États terminaux = liste explicite. Aucune transition sortante.
- Permissions par rôle : chaque transition déclare `roles: [...]` (vide
  ou absent = tous rôles autorisés).

## Pattern d'adoption dans une route

```javascript
const sm = require('../services/state-machine');

router.put('/:id/statut', async (req, res) => {
  const { statut } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lire l'état actuel
    const current = await client.query(
      'SELECT statut FROM commandes_exutoires WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Introuvable' });
    }

    // 2. Valider + journaliser via state machine
    const result = await sm.transition({
      machine: 'commande_exutoire',
      entityType: 'commandes_exutoires',
      entityId: parseInt(req.params.id),
      fromState: current.rows[0].statut,
      toState: statut,
      userId: req.user.id,
      userRole: req.user.role,
      reason: req.body.reason || null,
      dbClient: client,
    });
    if (!result.ok) {
      await client.query('ROLLBACK');
      return res.status(409).json(result);
    }

    // 3. Appliquer la transition (UPDATE métier)
    await client.query(
      'UPDATE commandes_exutoires SET statut = $1, updated_at = NOW() WHERE id = $2',
      [result.to, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, from: result.from, to: result.to });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[COMMANDES] transition error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});
```

## Endpoints d'introspection

- `GET /api/state-machines` — liste toutes les machines (UI)
- `GET /api/state-machines/:name` — détail (states, transitions, terminal)
- `GET /api/state-machines/:name/transitions?from=etat` — transitions
  disponibles depuis un état pour le user courant (UI dropdown filtré)
- `POST /api/state-machines/:name/check` `{from, to}` — pré-validation sans appliquer
- `GET /api/state-machines/:name/audit?entity_type=&entity_id=` — historique

## Audit trail

Table `state_transitions_audit` (machine, entity_type, entity_id,
from_state, to_state, user_id, user_role, reason, created_at). Indexée par
entity, machine, user. **Rétention recommandée 90 jours minimum** (RGPD +
audit interne SIAE/Refashion).

## Roadmap d'adoption

| Étape | Adoption | Effort |
|---|---|---|
| ✅ Phase 1 | Moteur + définitions + table audit + route introspection | Fait (V2.3) |
| Phase 2 | Migration `boutique-commandes.js` (TRANSITIONS local → moteur) | 1h |
| Phase 3 | Migration `commandes-exutoires.js` | 2h |
| Phase 4 | Migration `preparations.js` + `controles-pesee.js` + `factures-exutoires.js` | 3h |
| Phase 5 | Frontend : composant `<StatusBadge>` consommant `/api/state-machines/:name/transitions` pour menu déroulant | 2h |
| Phase 6 | Drop des transitions hardcodées dans les routes (clean up) | 1h |

## Tests à écrire (V4)

- `state-machine.test.js` :
  - canTransition refuse les transitions invalides
  - canTransition accepte les transitions valides selon rôle
  - alias accentués sont normalisés
  - état initial uniquement si fromState absent
  - audit trail écrit même si transaction métier rollback (best effort)

## Migration des données existantes

Le user a confirmé "coupure nette pas d'historique". Donc :

1. Les valeurs accentuées (`chargée`, `expédiée`, `annulée`) si présentes
   en prod sont normalisées par `aliases[]` côté lecture.
2. Aucune migration UPDATE des anciennes lignes — la normalisation se
   fait à la prochaine modification.
3. Si nécessaire, exécuter manuellement :
   ```sql
   UPDATE commandes_exutoires SET statut = 'chargee'  WHERE statut = 'chargée';
   UPDATE commandes_exutoires SET statut = 'expediee' WHERE statut = 'expédiée';
   ```
