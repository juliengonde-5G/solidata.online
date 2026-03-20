const sizeMap = {
  sm: { spinner: 'h-5 w-5 border-2', wrapper: 'py-2' },
  md: { spinner: 'h-10 w-10 border-2', wrapper: 'py-12' },
  lg: { spinner: 'h-16 w-16 border-[3px]', wrapper: 'py-20' },
};

export default function LoadingSpinner({ size = 'md', message }) {
  const config = sizeMap[size] || sizeMap.md;

  // Inline variant for sm: no wrapper padding, no message
  if (size === 'sm') {
    return (
      <div className="inline-flex items-center gap-2">
        <div
          className={`animate-spin rounded-full border-teal-600 border-t-transparent ${config.spinner}`}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${config.wrapper}`}>
      <div
        className={`animate-spin rounded-full border-teal-600 border-t-transparent ${config.spinner}`}
      />
      {message && (
        <span className="text-sm text-slate-500">{message}</span>
      )}
    </div>
  );
}
