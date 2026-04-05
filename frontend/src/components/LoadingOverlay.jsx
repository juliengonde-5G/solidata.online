import LoadingSpinner from './LoadingSpinner';

/* ──────────────────────────────────────────────
   LoadingOverlay — overlay semi-transparent
   sur un conteneur parent (position: relative)

   Usage :
     <div className="relative">
       <LoadingOverlay active={saving} message="Enregistrement..." />
       <div>...contenu existant...</div>
     </div>
   ────────────────────────────────────────────── */
export default function LoadingOverlay({ active, message }) {
  if (!active) return null;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/70 backdrop-blur-[1px]">
      <LoadingSpinner size="md" message={message} />
    </div>
  );
}
