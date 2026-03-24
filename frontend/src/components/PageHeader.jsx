import { Link } from 'react-router-dom';

export default function PageHeader({ title, subtitle, icon: Icon, actions, breadcrumb }) {
  return (
    <div className="mb-6">
      {/* Breadcrumb */}
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1.5 text-sm text-slate-500 mb-2">
          {breadcrumb.map((item, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
              {item.path ? (
                <Link to={item.path} className="hover:text-teal-600 transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span className={i === breadcrumb.length - 1 ? 'text-slate-800 font-medium' : ''}>
                  {item.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Title row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="p-2.5 rounded-xl bg-teal-50">
              <Icon className="w-6 h-6 text-teal-600" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{title}</h1>
            {subtitle && <p className="text-slate-500 mt-0.5 text-sm">{subtitle}</p>}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-3 flex-wrap">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
