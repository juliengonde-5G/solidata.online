import { useCallback, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * Hook qui remplace window.confirm() de façon accessible.
 *
 * Usage :
 *   const { confirm, ConfirmDialogElement } = useConfirm();
 *   ...
 *   const handleDelete = async () => {
 *     const ok = await confirm({
 *       title: 'Supprimer ce CAV ?',
 *       message: 'Cette action est définitive.',
 *       confirmLabel: 'Supprimer',
 *       confirmVariant: 'danger',
 *     });
 *     if (!ok) return;
 *     await api.delete(`/cav/${id}`);
 *   };
 *   ...
 *   return (<><MyPage /> {ConfirmDialogElement}</>);
 *
 * Pourquoi pas window.confirm :
 *   - non-accessible (lecteurs d'écran lisent mal le système natif),
 *   - pas de focus trap,
 *   - différent visuel selon OS, casse l'expérience.
 */
export default function useConfirm() {
  const [state, setState] = useState({
    isOpen: false,
    options: {},
    resolver: null,
  });

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        options: {
          title: 'Confirmation',
          message: 'Êtes-vous sûr ?',
          confirmLabel: 'Confirmer',
          confirmVariant: 'danger',
          ...options,
        },
        resolver: resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolver?.(true);
    setState((s) => ({ ...s, isOpen: false }));
  }, [state]);

  const handleCancel = useCallback(() => {
    state.resolver?.(false);
    setState((s) => ({ ...s, isOpen: false }));
  }, [state]);

  const ConfirmDialogElement = (
    <ConfirmDialog
      isOpen={state.isOpen}
      title={state.options.title}
      message={state.options.message}
      confirmLabel={state.options.confirmLabel}
      confirmVariant={state.options.confirmVariant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, ConfirmDialogElement };
}
