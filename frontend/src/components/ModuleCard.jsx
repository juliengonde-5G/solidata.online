import { useNavigate } from 'react-router-dom';

const colorStyles = {
  teal: {
    iconBg: 'bg-teal-50',
    iconColor: 'text-teal-600',
    border: 'border-l-teal-500',
    hoverBorder: 'hover:border-teal-200',
  },
  blue: {
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    border: 'border-l-blue-500',
    hoverBorder: 'hover:border-blue-200',
  },
  amber: {
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    border: 'border-l-amber-500',
    hoverBorder: 'hover:border-amber-200',
  },
  purple: {
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
    border: 'border-l-purple-500',
    hoverBorder: 'hover:border-purple-200',
  },
  red: {
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    border: 'border-l-red-500',
    hoverBorder: 'hover:border-red-200',
  },
  emerald: {
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    border: 'border-l-emerald-500',
    hoverBorder: 'hover:border-emerald-200',
  },
};

export default function ModuleCard({ title, description, icon: Icon, kpiValue, kpiLabel, path, color = 'teal' }) {
  const navigate = useNavigate();
  const style = colorStyles[color] || colorStyles.teal;

  return (
    <button
      onClick={() => navigate(path)}
      className={`card-modern p-5 text-left w-full group border-l-4 ${style.border} ${style.hoverBorder}
        hover:shadow-md hover:-translate-y-0.5 transition-all duration-200
      `}
    >
      <div className="flex items-start gap-4">
        {/* Icon circle */}
        {Icon && (
          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${style.iconBg} transition-transform duration-200 group-hover:scale-105`}>
            <Icon className={`w-6 h-6 ${style.iconColor}`} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 group-hover:text-teal-600 transition-colors">
            {title}
          </h3>
          {description && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{description}</p>
          )}

          {/* KPI value */}
          {kpiValue !== undefined && (
            <div className="mt-2.5 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-slate-800">{kpiValue}</span>
              {kpiLabel && <span className="text-xs text-slate-400">{kpiLabel}</span>}
            </div>
          )}
        </div>

        {/* Arrow */}
        <svg
          className="w-5 h-5 text-slate-300 group-hover:text-teal-500 transition-colors flex-shrink-0 mt-1"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
