// App shell: screen registry + navigation + sidebar (collapse, 2-level)
window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };

// Map each screen to its parent section (for auto-expand)
const SCREEN_TO_SECTION = {
  dashboard: 'pilotage',
  reporting: 'pilotage',
  finances: 'pilotage',
  collecte: 'operations',
  production: 'operations',
  recrutement: 'equipes',
  pcm: 'equipes',
  admin: 'systeme',
};

function navigate(screenId) {
  const reg = window.SOLIDATA_APP.screens[screenId];
  if (!reg) { console.warn('[Solidata] unknown screen:', screenId); return; }
  window.SOLIDATA_APP.current = screenId;

  // Active state on leaf items
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === screenId));

  // Active state on parent + auto-expand parent if collapsed
  const sectionId = SCREEN_TO_SECTION[screenId];
  document.querySelectorAll('.nav-section').forEach(sec => {
    const match = sec.dataset.section === sectionId;
    sec.classList.toggle('has-active', match);
    if (match) sec.classList.add('open'); // auto-expand the active parent
  });

  // Render content
  const host = document.getElementById('screen');
  host.innerHTML = reg.html();
  if (reg.init) reg.init(host);
  host.scrollTop = 0;

  // Close mobile drawer after nav
  document.getElementById('app').classList.remove('mobile-open');

  try { localStorage.setItem('solidata_screen', screenId); } catch(e){}
}

function toggleSection(sectionId) {
  const sec = document.querySelector(`.nav-section[data-section="${sectionId}"]`);
  if (!sec) return;
  sec.classList.toggle('open');
  // Persist collapse state
  try {
    const state = JSON.parse(localStorage.getItem('solidata_sections') || '{}');
    state[sectionId] = sec.classList.contains('open');
    localStorage.setItem('solidata_sections', JSON.stringify(state));
  } catch(e){}
}

function toggleSidebar() {
  const app = document.getElementById('app');
  app.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('solidata_sidebar_collapsed', app.classList.contains('sidebar-collapsed') ? '1' : '0'); } catch(e){}
}

function init() {
  // Restore collapse state
  try {
    if (localStorage.getItem('solidata_sidebar_collapsed') === '1') {
      document.getElementById('app').classList.add('sidebar-collapsed');
    }
  } catch(e){}

  // Restore open sections (default: all open)
  let sectionState = {};
  try { sectionState = JSON.parse(localStorage.getItem('solidata_sections') || '{}'); } catch(e){}
  document.querySelectorAll('.nav-section').forEach(sec => {
    const id = sec.dataset.section;
    const open = sectionState[id] !== undefined ? sectionState[id] : true;
    sec.classList.toggle('open', open);
  });

  // Wire leaf navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); navigate(btn.dataset.screen); });
  });

  // Wire parent toggles
  document.querySelectorAll('.nav-parent').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const app = document.getElementById('app');
      // If sidebar is collapsed, a parent click expands the sidebar first
      if (app.classList.contains('sidebar-collapsed')) {
        app.classList.remove('sidebar-collapsed');
        try { localStorage.setItem('solidata_sidebar_collapsed', '0'); } catch(e){}
        return;
      }
      toggleSection(btn.dataset.toggle);
    });
  });

  // Wire sidebar collapse toggle
  const st = document.getElementById('sidebarToggle');
  if (st) st.addEventListener('click', toggleSidebar);

  // Wire brand-home: cliquer le logo → dashboard
  const bh = document.getElementById('brandHome');
  if (bh) bh.addEventListener('click', (e) => { e.preventDefault(); navigate('dashboard'); });

  // Wire chatbot
  const cb = document.getElementById('chatbotBtn');
  const cp = document.getElementById('chatbotPanel');
  const co = document.getElementById('chatbotOverlay');
  const cc = document.getElementById('chatbotClose');
  const openChat = () => {
    cp.classList.add('open'); co.classList.add('open');
    cp.setAttribute('aria-hidden', 'false');
    setTimeout(() => { const i = document.getElementById('chatInput'); if (i) i.focus(); }, 200);
  };
  const closeChat = () => {
    cp.classList.remove('open'); co.classList.remove('open');
    cp.setAttribute('aria-hidden', 'true');
  };
  if (cb) cb.addEventListener('click', openChat);
  if (cc) cc.addEventListener('click', closeChat);
  if (co) co.addEventListener('click', closeChat);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cp.classList.contains('open')) closeChat(); });

  // Wire mobile toggle
  const mt = document.getElementById('mobileToggle');
  if (mt) mt.addEventListener('click', () => document.getElementById('app').classList.toggle('mobile-open'));

  // Initial screen
  let start = 'dashboard';
  try { start = localStorage.getItem('solidata_screen') || 'dashboard'; } catch(e){}
  if (!window.SOLIDATA_APP.screens[start]) start = 'dashboard';
  navigate(start);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
