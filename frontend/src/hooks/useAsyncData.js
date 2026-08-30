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
 *  - `loaded` : passe à true après la première tentative — permet de n'afficher
 *    l'écran de chargement plein cadre qu'au PREMIER chargement, et de ne pas
 *    démonter la page (donc les champs de saisie) à chaque rechargement.
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
  // `loaded` distingue le PREMIER chargement d'un rechargement (changement de
  // filtre, bouton Réessayer, polling). Sans lui, une page qui fait
  // `if (loading) return <Spinner/>` se démonte ENTIÈREMENT à chaque refetch —
  // et un champ de recherche dont la frappe déclenche le refetch perd le focus
  // à chaque caractère (défaut constaté sur la page Collaborateurs). Ajout
  // purement additif : aucun consommateur existant n'est modifié.
  const [loaded, setLoaded] = useState(false);
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
      if (mountedRef.current) {
        setLoading(false);
        setLoaded(true);   // une tentative a abouti (succès OU échec)
      }
    }
  }, [fetcher, skip]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!pollMs || skip) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs, skip]);

  return { data, loading, loaded, error, reload: load, setData };
}
