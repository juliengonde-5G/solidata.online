window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };
// ============== REPORTING — Templates (v1) ==============
(function(){
  const templates = [
    { c:'teal', icon:'📊', title:'Rapport mensuel', desc:'KPI consolidés, tournées, finances, équipes. Auto-généré le 1er du mois.', tag:'Le plus utilisé' },
    { c:'blue', icon:'📜', title:'Bilan subvention', desc:'Format structuré pour renouvellement de subvention. Impact + chiffres.', tag:'Trimestriel' },
    { c:'green', icon:'♻', title:'Rapport d\'impact', desc:'Tonnages collectés, CO₂ évité, textiles refashionés, emplois créés.', tag:'Annuel' },
  ];
  const recent = [
    { t:'Rapport mensuel · mars 2026', type:'Mensuel', size:'1,2 Mo', fmt:'PDF', date:'3 avr.' },
    { t:'Bilan subvention T1 2026', type:'Subvention', size:'840 Ko', fmt:'PDF', date:'1 avr.' },
    { t:'Impact Q1 2026', type:'Impact', size:'2,4 Mo', fmt:'XLSX', date:'29 mars' },
    { t:'Rapport mensuel · février 2026', type:'Mensuel', size:'1,1 Mo', fmt:'PDF', date:'3 mars' },
    { t:'Export candidats T1', type:'Recrutement', size:'92 Ko', fmt:'CSV', date:'28 févr.' },
  ];

  window.SOLIDATA_APP.screens.reporting = {
    html: () => `
      <div class="page-header" style="display:flex; align-items:flex-end; gap:16px;">
        <div>
          <h1 class="page-title">Reporting</h1>
          <p class="page-sub">Templates pré-définis · génère un rapport en un clic.</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-outline">Historique</button>
        <button class="btn btn-primary">+ Nouveau rapport</button>
      </div>

      <h3 style="font-size:13px; font-weight:700; color:var(--slate-500); text-transform:uppercase; letter-spacing:0.06em; margin:0 0 14px;">Templates</h3>
      <div class="tmpl-grid" style="margin-bottom:32px;">
        ${templates.map(t => `
          <div class="tmpl-card">
            <div class="tmpl-icon ${t.c}" style="font-size:24px;">${t.icon}</div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
              <h4 class="tmpl-title">${t.title}</h4>
              <span class="chip chip-slate" style="font-size:10.5px;">${t.tag}</span>
            </div>
            <p class="tmpl-desc">${t.desc}</p>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-primary btn-sm">Générer</button>
              <button class="btn btn-outline btn-sm">Aperçu</button>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="card-head">
          <h3 class="card-title">Derniers rapports</h3>
          <div class="search" style="max-width:240px; flex:none;">
            <svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
            <input placeholder="Filtrer…">
          </div>
        </div>
        <table class="report-table">
          <thead>
            <tr><th>Nom</th><th>Type</th><th>Date</th><th>Taille</th><th>Format</th><th></th></tr>
          </thead>
          <tbody>
            ${recent.map(r => `
              <tr>
                <td><div style="font-weight:600; color:var(--slate-900);">${r.t}</div></td>
                <td><span class="chip chip-slate">${r.type}</span></td>
                <td class="fmt">${r.date}</td>
                <td class="fmt">${r.size}</td>
                <td><span class="chip ${r.fmt==='PDF'?'chip-red':r.fmt==='XLSX'?'chip-green':'chip-blue'}">${r.fmt}</span></td>
                <td style="text-align:right;">
                  <button class="btn btn-ghost btn-sm">Télécharger</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  };
})();
