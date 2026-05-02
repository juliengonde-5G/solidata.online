import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook standardisant le pattern fetch + loading + error + retry.
 * Remplace le boilerplate ~10 lignes répété dans 75 pages :
 *
 *   const { data, loading, error, reload } = useAsyncData(
 *     useCallback(() => api.get('/cav').then(r => r.data), []),
 *     { initialData: [] }
 *   );
 *   if (loading) return <LoadingSpinner />;
 *   if (error) return <ErrorState onRetry={reload} />;
 *   return <DataTable data={data} />;
 *
 * Avantages vs useState/useEffect manuel :
 *  - state propre (data/loading/error) toujours cohérent
 *  - bouton "Réessayer" branché sans callback supplémentaire
 *  - cleanup automatique : si le composant est démonté pendant le fetch,
 *    le state n'est pas mis à jour (évite les warnings React)
 *  - support du polling via { pollMs }
 *
 * @param {() => Promise<T>} fetcher  Fonction asynchrone qui retourne data
 * @param {object} options
 * @param {T} [options.initialData]   Valeur initiale (par ex. [])
 * @param {boolean} [options.skip]    Si true, ne lance pas le fetch
 * @param {number} [options.pollMs]   Si défini, refetch périodique
 */
export default function useAsyncData(fetcher, options = {}) {
  const { initialData = null, skip = false, pollMs = 0 } = options;
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (skip) return;
    try {
      setError(null);
      setLoading(true);
      const result = await fetcher();
      if (mountedRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current) setError(err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetcher, skip]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!pollMs || skip) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs, skip]);

  return { data, loading, error, reload: load, setData };
}
