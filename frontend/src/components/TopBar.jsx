import { useLocation, Link } from 'react-router-dom';
import { Menu, ChevronRight, PanelLeftClose, PanelLeft } from 'lucide-react';
import UserDropdown from './UserDropdown';
import NotificationBell from './NotificationBell';

export default function TopBar({ menuSections, alerts, sidebarOpen, onToggleSidebar, onMobileMenu }) {
  const location = useLocation();

  // Build breadcrumb from current path
  const breadcrumb = buildBreadcrumb(location.pathname, menuSections);

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 flex-shrink-0 z-20">
      {/* Left: toggle + breadcrumb */}
      <div className="flex items-center gap-2">
        {/* Mobile hamburger */}
        <button
          onClick={onMobileMenu}
          className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
          aria-label="Ouvrir le menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Desktop sidebar toggle */}
        <button
          onClick={onToggleSidebar}
          className="hidden lg:flex p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
          aria-label={sidebarOpen ? 'Masquer le menu' : 'Afficher le menu'}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="w-5 h-5" />
          ) : (
            <PanelLeft className="w-5 h-5" />
          )}
        </button>

        {/* Breadcrumb */}
        <nav className="hidden sm:flex items-center gap-1.5 text-sm">
          {breadcrumb.map((item, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
              {item.path ? (
                <Link to={item.path} className="text-slate-500 hover:text-primary transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span className={i === breadcrumb.length - 1 ? 'text-slate-800 font-medium' : 'text-slate-500'}>
                  {item.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      </div>

      {/* Right: notifications + user */}
      <div className="flex items-center gap-1">
        <NotificationBell alerts={alerts} />
        <UserDropdown />
      </div>
    </header>
  );
}

function buildBreadcrumb(pathname, menuSections) {
  for (const section of menuSections) {
    const item = section.items.find(i => i.path === pathname);
    if (item) {
      const crumbs = [{ label: section.title, path: section.hubPath || null }];
      if (item.path !== section.hubPath) {
        crumbs.push({ label: item.label, path: null });
      }
      return crumbs;
    }
  }
  return [{ label: 'Accueil', path: null }];
}
