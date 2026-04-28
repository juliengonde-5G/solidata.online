/**
 * CAVContainerIcon — icône SVG d'un conteneur d'apport volontaire avec
 * un niveau de remplissage animé. Utilisé dans FillLevel pour donner un
 * feedback visuel fort (utile en extérieur / avec gants).
 *
 * Props :
 *   - level : 'empty' | 'quarter' | 'half' | 'three_quarter' | 'full' | 'overflow'
 *   - size  : taille en px (défaut 44)
 *   - active : variation visuelle quand le bouton parent est sélectionné
 *
 * Palette calée sur les tokens Tailwind du mobile (teal, green, yellow,
 * orange, red). Pas de dépendance externe : tout en SVG inline.
 */
const LEVEL_MAP = {
  empty:         { pct: 0,   fill: '#E2E8F0', stroke: '#94A3B8' },
  quarter:       { pct: 25,  fill: '#86EFAC', stroke: '#16A34A' },
  half:          { pct: 50,  fill: '#FDE047', stroke: '#CA8A04' },
  three_quarter: { pct: 75,  fill: '#FB923C', stroke: '#EA580C' },
  full:          { pct: 100, fill: '#EF4444', stroke: '#B91C1C' },
  overflow:      { pct: 100, fill: '#7F1D1D', stroke: '#450A0A', overflow: true },
};

export default function CAVContainerIcon({ level = 'empty', size = 44, active = false }) {
  const cfg = LEVEL_MAP[level] || LEVEL_MAP.empty;
  const strokeColor = active ? 'currentColor' : cfg.stroke;
  const lidColor = active ? 'currentColor' : cfg.stroke;

  const bodyTop = 10;
  const bodyHeight = 32;
  const fillHeight = (bodyHeight * cfg.pct) / 100;
  const fillY = bodyTop + (bodyHeight - fillHeight);

  return (
    <svg
      width={size}
      height={(size / 40) * 46}
      viewBox="0 0 40 46"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {/* Lid */}
      <rect
        x="4"
        y="2"
        width="32"
        height="5"
        rx="1.5"
        fill={lidColor}
        opacity={cfg.overflow ? 0.5 : 1}
      />
      {/* Body outline */}
      <rect
        x="6"
        y={bodyTop - 2}
        width="28"
        height={bodyHeight + 4}
        rx="2"
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
      />
      {/* Fill */}
      {cfg.pct > 0 && (
        <rect
          x="8"
          y={fillY}
          width="24"
          height={fillHeight}
          rx="1"
          fill={cfg.fill}
          opacity="0.92"
        />
      )}
      {/* Overflow markers */}
      {cfg.overflow && (
        <g stroke="#7F1D1D" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M 12 6 L 10 1" />
          <path d="M 20 6 L 20 0" />
          <path d="M 28 6 L 30 1" />
        </g>
      )}
    </svg>
  );
}
