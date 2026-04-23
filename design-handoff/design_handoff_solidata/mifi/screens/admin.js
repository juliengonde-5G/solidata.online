window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };
// ============== ADMINISTRATION — Hub navigué (v1) ==============
(function(){
  const users = [
    { i:'JG', n:'Julien Gondé', email:'julien@solidarite-textiles.fr', role:'Admin', roleColor:'chip-red', depot:'—', active:true },
    { i:'ML', n:'Marc Leduc', email:'marc.l@solidarite-textiles.fr', role:'Chauffeur', roleColor:'chip-blue', depot:'Rouen · D1', active:true },
    { i:'LM', n:'Léa Moreau', email:'lea.m@solidarite-textiles.fr', role:'Agent tri', roleColor:'chip-teal', depot:'Havre · D2', active:true },
    { i:'SA', n:'Sophie André', email:'sophie.a@solidarite-textiles.fr', role:'Manager', roleColor:'chip-amber', depot:'Rouen · D1', active:false },
    { i:'KB', n:'Karim Bennani', email:'karim.b@solidarite-textiles.fr', role:'Chauffeur', roleColor:'chip-blue', depot:'Elbeuf · D3', active:true },
    { i:'NA', n:'Nora Said', email:'nora.s@solidarite-textiles.fr', role:'Agent tri', roleColor:'chip-teal', depot:'Havre · D2', active:true },
    { i:'PM', n:'Paul Martin', email:'paul.m@solidarite-textiles.fr', role:'Chauffeur', roleColor:'chip-blue', depot:'Rouen · D1', active:true },
    { i:'FD', n:'Fatima Dupont', email:'fatima.d@solidarite-textiles.fr', role:'Manager', roleColor:'chip-amber', depot:'Havre · D2', active:true },
  ];

  window.SOLIDATA_APP.screens.admin = {
    html: () => `
      <div class="page-header">
        <h1 class="page-title">Administration</h1>
        <p class="page-sub">Gestion des utilisateurs, véhicules, dépôts et paramètres système.</p>
      </div>

      <div class="admin-layout">
        <nav class="admin-nav">
          <button class="active">
            <svg class="ic" viewBox="0 0 24 24"><circle cx="9" cy="7" r="4"/><path d="M17 11l2 2 4-4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg>
            Utilisateurs <span class="pill" style="margin-left:auto;">42</span>
          </button>
          <button>
            <svg class="ic" viewBox="0 0 24 24"><rect x="1" y="6" width="15" height="13" rx="2"/><path d="M16 9h3l3 3v5h-6"/><circle cx="5.5" cy="19" r="2.5"/><circle cx="17.5" cy="19" r="2.5"/></svg>
            Flotte <span class="pill" style="margin-left:auto;">12</span>
          </button>
          <button>
            <svg class="ic" viewBox="0 0 24 24"><path d="M21 16V7l-9-4-9 4v9l9 4 9-4z"/></svg>
            Dépôts <span class="pill" style="margin-left:auto;">3</span>
          </button>
          <button>
            <svg class="ic" viewBox="0 0 24 24"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            Rôles & permissions
          </button>
          <button>
            <svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.2 4.2l4.3 4.3m7 7l4.3 4.3M1 12h6m10 0h6M4.2 19.8l4.3-4.3m7-7l4.3-4.3"/></svg>
            Paramètres
          </button>
          <button>
            <svg class="ic" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Sécurité
          </button>
          <button>
            <svg class="ic" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Intégrations
          </button>
        </nav>

        <div>
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
            <h2 style="margin:0; font-size:18px; font-weight:700; color:var(--slate-900);">Utilisateurs</h2>
            <span class="chip chip-slate">42 au total · 38 actifs</span>
            <div style="flex:1"></div>
            <div class="search" style="max-width:260px; flex:none;">
              <svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
              <input placeholder="Rechercher…">
            </div>
            <button class="btn btn-outline btn-sm">Filtrer</button>
            <button class="btn btn-primary btn-sm">+ Ajouter utilisateur</button>
          </div>

          <div class="card" style="overflow:hidden;">
            <table class="users-table">
              <thead>
                <tr><th style="width:30px;"><input type="checkbox" style="accent-color:var(--teal-600);"></th><th>Utilisateur</th><th>Rôle</th><th>Dépôt</th><th>Statut</th><th>Dernière connexion</th><th></th></tr>
              </thead>
              <tbody>
                ${users.map((u,i) => `
                  <tr>
                    <td><input type="checkbox" style="accent-color:var(--teal-600);"></td>
                    <td>
                      <div class="u-name">
                        <div class="avo">${u.i}</div>
                        <div><div class="u-primary">${u.n}</div><div class="u-secondary">${u.email}</div></div>
                      </div>
                    </td>
                    <td><span class="chip ${u.roleColor}">${u.role}</span></td>
                    <td style="color:var(--slate-600);">${u.depot}</td>
                    <td>${u.active?'<span class="chip chip-green"><span class="chip-dot"></span>Actif</span>':'<span class="chip chip-slate">Inactif</span>'}</td>
                    <td class="u-secondary">${['il y a 2 min','il y a 18 min','il y a 1h','il y a 3 jours','il y a 24 min','il y a 2h','hier','il y a 5h'][i]}</td>
                    <td style="text-align:right;">
                      <button class="btn btn-ghost btn-sm" style="padding:4px 8px;">⋯</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div style="display:flex; align-items:center; justify-content:space-between; margin-top:12px; padding: 0 4px;">
            <span style="font-size:12px; color:var(--slate-500);">1-8 sur 42 · page 1/6</span>
            <div style="display:flex; gap:4px;">
              <button class="btn btn-outline btn-sm">← Préc.</button>
              <button class="btn btn-outline btn-sm">Suiv. →</button>
            </div>
          </div>
        </div>
      </div>
    `
  };
})();
