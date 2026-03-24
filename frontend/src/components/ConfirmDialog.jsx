import Modal from './Modal';

const variantStyles = {
  danger: {
    button: 'bg-red-600 hover:bg-red-700 text-white',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
  },
  primary: {
    button: 'bg-teal-600 hover:bg-teal-700 text-white',
    iconBg: 'bg-teal-100',
    iconColor: 'text-teal-600',
  },
};

export default function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Confirmation',
  message,
  confirmLabel = 'Confirmer',
  confirmVariant = 'danger',
  loading = false,
}) {
  const style = variantStyles[confirmVariant] || variantStyles.primary;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-[10px] transition disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium rounded-[10px] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${style.button}`}
          >
            {loading && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-4">
        {/* Warning icon for danger variant */}
        {confirmVariant === 'danger' && (
          <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${style.iconBg}`}>
            <svg className={`w-5 h-5 ${style.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        )}
        <p className="text-sm text-slate-600">{message}</p>
      </div>
    </Modal>
  );
}
