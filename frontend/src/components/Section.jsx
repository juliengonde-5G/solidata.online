import { twMerge } from 'tailwind-merge';

/**
 * Section — conteneur standard du nouveau design system.
 * Carte radius 14px, ombre légère, header optionnel avec titre + actions.
 *
 * Props :
 * - title       : string (ou ReactNode) — titre du header
 * - subtitle    : string — sous-titre sous le titre
 * - icon        : Lucide icon component (affiché dans une bulle teal à côté du titre)
 * - actions     : ReactNode — boutons / liens à droite du header
 * - footer      : ReactNode — affiché en bas, séparé par une bordure
 * - padded      : boolean (default true) — applique p-5 au body
 * - className   : classes supplémentaires sur le conteneur
 * - bodyClassName : classes supplémentaires sur le body
 * - children    : contenu du body
 */
export default function Section({
  title,
  subtitle,
  icon: Icon,
  actions,
  footer,
  padded = true,
  className,
  bodyClassName,
  children,
}) {
  const hasHeader = title || actions || subtitle || Icon;
  return (
    <section className={twMerge('section-card', className)}>
      {hasHeader && (
        <header className="section-card-header">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className="grid place-items-center w-9 h-9 rounded-xl bg-primary-surface text-primary-dark flex-shrink-0">
                <Icon className="w-4.5 h-4.5" />
              </div>
            )}
            <div className="min-w-0">
              {title && <h2 className="section-card-title truncate">{title}</h2>}
              {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </header>
      )}
      <div className={twMerge(padded ? 'section-card-body' : '', bodyClassName)}>
        {children}
      </div>
      {footer && (
        <footer className="px-5 py-3 border-t border-slate-100 text-sm text-slate-600">
          {footer}
        </footer>
      )}
    </section>
  );
}
