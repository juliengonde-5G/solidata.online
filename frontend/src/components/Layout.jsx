import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import DockUnifie, { ongletParDefaut } from './messagerie/DockUnifie';
import useNonLusBadge from './messagerie/useNonLusBadge';
import useNotificationsNonLues from './messagerie/useNotificationsNonLues';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { NAV_TREE } from '../navigation/navTree';
import api from '../services/api';

// Filtre récursif par rôle ; un nœud "groupe" disparaît si tous ses enfants disparaissent.
//
// `roles` porte le rôle BRUT et son rôle de BASE, exactement comme le fait
// ProtectedRoute (App.jsx) : un rôle intégré nommé explicitement sur un écran
// doit le voir au menu, même si son rôle de base ne l'a pas. Sans ça, un rôle
// pouvait accéder à une page par son URL sans jamais la trouver dans la barre
// latérale — une incohérence relevée en ajoutant le rôle « Praticien PCM ».
//
// 2.56.0 — `estAccorde` ajoute la troisième voie : un écran dont la SECTION a
// été accordée au rôle dans `/admin/permissions` apparaît, même si son rôle
// n'est pas nommé dessus. C'est ce qui rend de nouveau constructible un profil
// d'exploitation depuis le retrait de MANAGER, sans donner ADMIN. Les modules
// ancêtres sont portés au fil de la descente (une entrée sous « Frip › VAK »
// s'ouvre par un accord sur `frip` OU sur `vak`).
function filterByRole(tree, roles, estAccorde = () => false, modulesAncetres = []) {
  return tree
    .map((node) => {
      const mods = node.id ? [...modulesAncetres, node.id] : modulesAncetres;
      if (node.children) {
        const kids = filterByRole(node.children, roles, estAccorde, mods);
        if (kids.length === 0) return null;
        return { ...node, children: kids };
      }
      if (
        node.roles &&
        !node.roles.some((r) => roles.includes(r)) &&
        !mods.some((m) => estAccorde(m))
      ) return null;
      return node;
    })
    .filter(Boolean);
}

// Filtre récursif par habilitation module. Historiquement seules les sections de
// 1er niveau portaient un `id` (module_key de role_module_access). Depuis le
// regroupement « Frip » (Boutiques + Vente au Kilo), des sous-branches portent
// aussi leur `id` legacy ('boutiques'/'vak') pour rester restreignables
// individuellement — un nœud disparaît si SON id est refusé (le module 'frip'
// masque les deux d'un coup ; 'boutiques' ou 'vak' masque uniquement sa branche)
// ou si tous ses enfants disparaissent.
function filterByModuleAccess(tree, canAccessModule) {
  return tree
    .map((node) => {
      if (node.id && !canAccessModule(node.id)) return null;
      if (node.children) {
        const kids = filterByModuleAccess(node.children, canAccessModule);
        if (kids.length === 0) return null;
        return { ...node, children: kids };
      }
      return node;
    })
    .filter(Boolean);
}

// Persist sidebar collapse state across Layout re-mounts
const persistedState = {
  collapsed: (() => {
    try { return localStorage.getItem('solidata_sidebar_collapsed') === '1'; } catch { return false; }
  })(),
};

export default function Layout({ children }) {
  const { user, canAccessModule, isModuleGranted } = useAuth();

  const [collapsed, setCollapsed] = useState(persistedState.collapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [counts, setCounts] = useState({});

  // ── Point d'entrée unique « communication » (assistant IA + messagerie +
  //    notifications), demande client du 28/08/2026. L'état vit ici parce que
  //    le bouton est dans la barre supérieure et le panneau à côté de la barre
  //    latérale : un seul propriétaire, donc un seul badge, et une seule
  //    connexion temps réel pour le compteur.
  const messagerieActive = canAccessModule('messagerie');
  // L'assistant est une surface d'ACCÈS AUX DONNÉES (stock, planning, heures) :
  // il n'est pas ouvert aux profils dont le périmètre est délibérément borné.
  // Le refus qui fait foi est côté serveur (routes/chat.js,
  // ROLES_SANS_ASSISTANT) ; ceci évite d'afficher un onglet qui répondrait 403.
  // OPERATEUR_STOCK (2.57.0) : même règle, mêmes raisons — le serveur le refuse
  // déjà (403 ASSISTANT_HORS_PERIMETRE), l'onglet ne doit pas l'annoncer.
  const ROLES_SANS_ASSISTANT = ['COMMUNICATION', 'OPERATEUR_STOCK'];
  const assistantActif = !ROLES_SANS_ASSISTANT.includes(user?.base_role || user?.role);
  const { total: messagesNonLus } = useNonLusBadge({ actif: messagerieActive });
  const notifications = useNotificationsNonLues(alerts);

  const [dockOuvert, setDockOuvert] = useState(false);
  const [dockOnglet, setDockOnglet] = useState(null);
  const [dockConversation, setDockConversation] = useState(null);

  const ouvrirDock = useCallback(
    (onglet = null, conversationId = null) => {
      setDockOnglet(
        onglet ||
          ongletParDefaut({
            messagesNonLus,
            notificationsNonLues: notifications.nonLues,
            messagerieActive,
            assistantActif,
          })
      );
      if (conversationId) setDockConversation(conversationId);
      setDockOuvert(true);
    },
    [messagesNonLus, notifications.nonLues, messagerieActive, assistantActif]
  );

  useEffect(() => {
    persistedState.collapsed = collapsed;
    try { localStorage.setItem('solidata_sidebar_collapsed', collapsed ? '1' : '0'); } catch { /* noop */ }
  }, [collapsed]);

  // Arbre filtré par rôle PUIS par habilitation module (un nœud — section de
  // 1er niveau ou sous-branche legacy comme 'boutiques'/'vak' sous 'frip' —
  // refusé au rôle est masqué ; l'ADMIN voit tout).
  // base_role : un rôle personnalisé hérite des accès de son rôle intégré.
  const filteredTree = useMemo(() => {
    const byRole = filterByRole(
      NAV_TREE,
      [user?.base_role, user?.role].filter(Boolean),
      isModuleGranted
    );
    // Le REFUS s'applique APRÈS l'accord, donc il prime : un module retiré reste
    // masqué même si une ligne d'accord traînait. La matrice n'écrit jamais les
    // deux, mais l'ordre rend la règle vraie par construction plutôt que par
    // confiance dans la donnée.
    return filterByModuleAccess(byRole, canAccessModule);
  }, [user?.base_role, user?.role, canAccessModule, isModuleGranted]);

  // Charger alertes + compteurs sidebar (best-effort)
  useEffect(() => {
    api.get('/dashboard/kpis')
      .then((res) => {
        setAlerts(res.data?.alertes || []);
        const k = res.data?.kpis || res.data || {};
        setCounts({
          '/candidates': k.candidates_actifs ?? k.candidats ?? null,
          '/tours': k.tours_today ?? k.tournees_du_jour ?? null,
        });
      })
      .catch(() => { /* silencieux */ });
  }, []);

  const handleMobileNav = useCallback(() => {
    if (window.innerWidth < 1024) setMobileOpen(false);
  }, []);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } fixed lg:relative z-50 lg:z-auto h-full transition-transform duration-300`}
      >
        <Sidebar
          tree={filteredTree}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onNavigate={handleMobileNav}
          counts={counts}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          onMobileMenu={() => setMobileOpen((o) => !o)}
          badgeCommunication={messagesNonLus + notifications.nonLues}
          onOuvrirDock={ouvrirDock}
          dockOuvert={dockOuvert}
          avecMessagerie={messagerieActive}
          avecAssistant={assistantActif}
        />

        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="p-4 sm:p-6 lg:p-6 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* L'onglet « Messages » suit la MÊME habilitation que l'entrée de menu
          (clé `messagerie` du catalogue) : masquer la section sans masquer
          l'accès laisserait une porte d'entrée juste à côté de la porte qu'on
          vient de fermer. L'assistant IA et les notifications, eux, restent
          accessibles à tous — d'où un bouton unique et un onglet conditionnel,
          plutôt qu'un bouton conditionnel. Le périmètre de participation reste
          contrôlé côté serveur ; ceci n'est que la cohérence de l'écran. */}
      <DockUnifie
        ouvert={dockOuvert}
        onglet={dockOnglet || ongletParDefaut({ messagesNonLus, notificationsNonLues: notifications.nonLues, messagerieActive, assistantActif })}
        onChangerOnglet={setDockOnglet}
        onFermer={() => setDockOuvert(false)}
        onOuvrir={ouvrirDock}
        alertes={alerts}
        messagesNonLus={messagesNonLus}
        notifications={notifications}
        messagerieActive={messagerieActive}
        assistantActif={assistantActif}
        conversationDemandee={dockConversation}
        onConversationOuverte={() => setDockConversation(null)}
      />
    </div>
  );
}
