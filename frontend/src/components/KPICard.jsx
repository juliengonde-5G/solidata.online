const accentStyles = {
  primary: {
    iconBg: 'bg-teal-50',
    iconColor: 'text-teal-600',
    valueColor: 'text-teal-700',
  },
  emerald: {
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    valueColor: 'text-emerald-700',
  },
  amber: {
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    valueColor: 'text-amber-700',
  },
  red: {
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    valueColor: 'text-red-700',
  },
  slate: {
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-600',
    valueColor: 'text-slate-700',
  },
};

function SkeletonLoader() {
  return (
    <div className="card-modern p-5 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-3 flex-1">
          <div className="h-3 bg-slate-200 rounded w-24" />
          <div className="h-8 bg-slate-200 rounded w-20" />
          <div className="h-3 bg-slate-200 rounded w-16" />
        </div>
        <div className="w-10 h-10 bg-slate-200 rounded-xl" />
      </div>
    </div>
  );
}

export default function KPICard({ title, value, unit, icon: Icon, trend, accent = 'primary', loading }) {
  if (loading) return <SkeletonLoader />;

  const style = accentStyles[accent] || accentStyles.primary;

  return (
    <div className="card-modern p-5 hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tracking-tight ${style.valueColor}`}>
              {value}
            </span>
            {unit && (
              <span className="text-sm font-medium text-slate-400">{unit}</span>
            )}
          </div>
          {trend && (
            <div className="flex items-center gap-1 mt-1">
              {trend.direction === 'up' ? (
                <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              )}
              <span className={`text-xs font-semibold ${trend.direction === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
                {trend.value}%
              </span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={`p-2.5 rounded-xl ${style.iconBg}`}>
            <Icon className={`w-5 h-5 ${style.iconColor}`} />
          </div>
        )}
      </div>
    </div>
  );
}
