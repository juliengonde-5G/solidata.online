# Patterns UX standardisés — adoption progressive

> Ce document recense les hooks et composants partagés pour les pages
> SOLIDATA et le pattern d'adoption à appliquer aux 75 pages existantes.
> Issu de l'audit Persona 3 (Product Designer) — runbook V3.

---

## 1. Hooks disponibles

### `useConfirm` — remplace `window.confirm`

```jsx
import useConfirm from '../hooks/useConfirm';

function MaPage() {
  const { confirm, ConfirmDialogElement } = useConfirm();

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Supprimer cet élément ?',
      message: 'Cette action est définitive.',
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',  // 'danger' | 'primary'
    });
    if (!ok) return;
    await api.delete(`/items/${id}`);
  };

  return (
    <Layout>
      {ConfirmDialogElement}
      {/* ...page... */}
    </Layout>
  );
}
```

**État** : ✅ adopté sur 13 fichiers (sprint complet livré V3.1).

### `useAsyncData` — remplace useState + useEffect + try/catch

```jsx
import { useCallback } from 'react';
import useAsyncData from '../hooks/useAsyncData';
import { LoadingSpinner, ErrorState } from '../components';
import api from '../services/api';

function MaPage() {
  // useCallback obligatoire : sinon le fetcher change à chaque render
  // et déclenche une boucle de refetch.
  const fetcher = useCallback(() => api.get('/cav').then(r => r.data), []);
  const { data: cav, loading, error, reload } = useAsyncData(fetcher, {
    initialData: [],
    // pollMs: 30000,   // optionnel : refresh auto toutes les 30s
  });

  if (loading) return <LoadingSpinner size="lg" message="Chargement..." />;
  if (error) return <ErrorState onRetry={reload} />;

  return <DataTable data={cav} />;
}
```

**Avantages mesurables** :
- Supprime ~10 lignes de boilerplate par page
- Erreur API silencieuse → message + bouton "Réessayer" visible
- Cleanup automatique au démontage (zéro warning React 18)
- Support du polling natif via `pollMs`

---

## 2. Composants partagés

### `<ErrorState>` — affichage standardisé d'erreur de chargement

```jsx
<ErrorState
  title="Impossible de charger"        // optionnel
  message="Vérifiez votre connexion."  // optionnel
  onRetry={reload}                     // optionnel
  variant="card"                        // 'inline' (par défaut) | 'card'
/>
```

### `<ConfirmDialog>` — utilisé par useConfirm, accessible directement si besoin

### `<FormField>` — champ de formulaire avec label + error + a11y

```jsx
<FormField
  label="Nom du CAV"
  name="cav_name"
  type="text"
  value={form.cav_name}
  onChange={(e) => setForm({ ...form, cav_name: e.target.value })}
  required
  error={errors.cav_name}
  hint="Format : CAV_RUE_VILLE"
/>
```

Types supportés : `text`, `email`, `password`, `number`, `date`, `tel`, `url`, `textarea`, `select`. Pour `select`, passer `options={[{value, label}]}`.

---

## 3. Pages à migrer (audit V3)

### État au 1er mai 2026

| Page | useConfirm | useAsyncData | FormField | ErrorState |
|---|:---:|:---:|:---:|:---:|
| AdminAssociations | ✅ | ❌ | ❌ | ❌ |
| AdminCAV | ✅ | ❌ | ❌ | ❌ |
| AdminCollaboratorsImport | ✅ | n/a | ❌ | ❌ |
| AdminDB | ✅ | ❌ | n/a | ❌ |
| BoutiquesImport | ✅ | ❌ | ❌ | ❌ |
| Candidates | ✅ | ❌ | ❌ | ❌ |
| ExutoiresClients | ✅ | ❌ | ❌ | ❌ |
| ExutoiresCommandes | ✅ | ❌ | ❌ | ❌ |
| ExutoiresPreparation | ✅ | ❌ | ❌ | ❌ |
| ExutoiresTarifs | ✅ | ❌ | ❌ | ❌ |
| RGPD | ✅ | ❌ | ❌ | ❌ |
| VehicleMaintenance | ✅ | ❌ | ❌ | ❌ |
| ProduitsFinis | n/a | ❌ | ✅ (partiel) | ✅ (partiel) |
| DashboardExecutif | n/a | n/a | n/a | ✅ |
| AdminAlertThresholds | n/a | n/a | n/a | ✅ |
| Stock | ❌ | ❌ | ❌ | ❌ |
| Tours | ❌ | ❌ | ❌ | ❌ |
| Employees | ❌ | ❌ | ❌ | ❌ |
| BoutiquesDashboard | ❌ | ❌ | ❌ | ❌ |
| ... (60+ autres) | ❌ | ❌ | ❌ | ❌ |

### Pages prioritaires pour la prochaine vague d'adoption

Ordre par fréquence d'utilisation × risque de bug silencieux :

1. **Tours.jsx** (Manager Collecte, vu plusieurs fois par jour)
2. **Stock.jsx** (Manager Tri, vu quotidiennement)
3. **Employees.jsx** (RH, modifications fréquentes)
4. **BoutiquesDashboard.jsx** (RESP_BTQ, vu quotidiennement)
5. **InsertionParcours.jsx** (CIP, modifications)
6. **LiveVehicles.jsx** (Manager, monitoring temps réel)
7. **FillRateMap.jsx** (Manager, monitoring)
8. **Production.jsx** (Manager Tri)

### Pattern d'adoption page par page

Pour chaque page :

1. **Import** : ajouter `useAsyncData`, `ErrorState` dans les imports
2. **Remplacer le bloc `useState + useEffect + try/catch`** :
   ```jsx
   // AVANT (à supprimer)
   const [data, setData] = useState([]);
   const [loading, setLoading] = useState(true);
   useEffect(() => {
     api.get('/items')
       .then(r => setData(r.data))
       .catch(err => console.error(err))
       .finally(() => setLoading(false));
   }, []);

   // APRÈS
   const fetcher = useCallback(() => api.get('/items').then(r => r.data), []);
   const { data, loading, error, reload } = useAsyncData(fetcher, { initialData: [] });
   ```
3. **Remplacer le rendu d'erreur** :
   ```jsx
   if (error) return <Layout><ErrorState onRetry={reload} variant="card" /></Layout>;
   ```
4. **Si la page a plusieurs fetchers en parallèle** :
   ```jsx
   const fetchAll = useCallback(async () => {
     const [a, b, c] = await Promise.all([
       api.get('/a').then(r => r.data),
       api.get('/b').then(r => r.data),
       api.get('/c').then(r => r.data),
     ]);
     return { a, b, c };
   }, []);
   const { data, loading, error, reload } = useAsyncData(fetchAll);
   const { a = [], b = [], c = [] } = data || {};
   ```

### Effort estimé par page

- Page simple (1 fetcher, 1 page de code) : **15-20 min**
- Page complexe (Kanban, multiple states) : **30-45 min**
- Total 60+ pages restantes : **20-30h** d'adoption progressive

---

## 4. Tests recommandés (V4)

```javascript
// hooks/useAsyncData.test.js
import { renderHook, waitFor } from '@testing-library/react';
import useAsyncData from './useAsyncData';

test('charge les données', async () => {
  const fetcher = jest.fn().mockResolvedValue([{ id: 1 }]);
  const { result } = renderHook(() => useAsyncData(fetcher, { initialData: [] }));
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toEqual([{ id: 1 }]);
  expect(result.current.error).toBeNull();
});

test('expose error + reload', async () => {
  const fetcher = jest.fn().mockRejectedValueOnce(new Error('Boom'));
  const { result } = renderHook(() => useAsyncData(fetcher));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  fetcher.mockResolvedValueOnce({ ok: true });
  await result.current.reload();
  expect(result.current.error).toBeNull();
  expect(result.current.data).toEqual({ ok: true });
});
```

---

## 5. Roadmap consolidée

| Phase | Périmètre | Effort | Statut |
|---|---|---|---|
| ✅ V3.1 | useConfirm + 13 fichiers | 4h | Livré |
| ✅ V3.2 | Dashboard exécutif + AdminAlertThresholds | 8h | Livré |
| ✅ V3.3a | Hook useAsyncData + doc | 1h | Livré |
| 🔜 V3.3b | Adoption pilote 8 pages prioritaires | 6h | À planifier |
| 🔜 V3.4 | Adoption sur 60+ pages restantes | 20h | Backlog |
| 🔜 V3.5 | FormField adoption sur 40+ formulaires | 12h | Backlog |
| 🔜 V3.6 | Onglets InsertionParcours (UX RH) | 6h | Backlog |
