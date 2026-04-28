window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };
// ============== RECRUTEMENT — Kanban (v1) ==============
(function(){
  const columns = [
    { id:'a-contacter', title:'À contacter', color:'#94A3B8', body:'',
      candidates: [
        { n:'Sarah Martin', p:'Responsable collecte', l:'Senior', s:8.5, i:'SM' },
        { n:'Thomas Lefevre', p:'Chauffeur', l:'Confirmé', s:7.2, i:'TL' },
        { n:'Maria Garcia', p:'Agent tri', l:'Débutant', s:6.8, i:'MG' },
        { n:'Pierre Dubois', p:'Manager', l:'Expert', s:9.1, i:'PD' },
      ]},
    { id:'en-cours', title:'En cours', color:'#3B82F6', body:'blue',
      candidates: [
        { n:'Léa Moreau', p:'Agent tri', l:'Confirmé', s:7.8, i:'LM', days:3 },
        { n:'Jules Petit', p:'Collecte', l:'Débutant', s:6.5, i:'JP', days:5 },
        { n:'Amandine Roy', p:'Logistique', l:'Senior', s:8.9, i:'AR', days:2 },
      ]},
    { id:'entretien-ok', title:'Entretien OK', color:'#10B981', body:'green',
      candidates: [
        { n:'Marc Bernard', p:'Responsable collecte', l:'Expert', s:9.0, i:'MB', check:'Relancer' },
        { n:'Sophie André', p:'Manager tri', l:'Senior', s:8.7, i:'SA', check:'Relancer' },
      ]},
    { id:'acceptes', title:'Intégrés', color:'#0D9488', body:'teal',
      candidates: [
        { n:'Jean-Paul Leroy', p:'Agent collecte', l:'Confirmé', s:7.9, i:'JL', date:'28 avr.' },
        { n:'Martine Blanc', p:'Agent tri', l:'Senior', s:8.2, i:'MB', date:'21 avr.' },
        { n:'David Rousseau', p:'Chauffeur', l:'Confirmé', s:8.1, i:'DR', date:'5 mai' },
      ]},
  ];

  const zap = '<svg class="ic" viewBox="0 0 24 24" style="width:13px;height:13px"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
  const mail = '<svg class="ic" viewBox="0 0 24 24" style="width:13px;height:13px"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/></svg>';
  const file = '<svg class="ic" viewBox="0 0 24 24" style="width:13px;height:13px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  const clock = '<svg class="ic" viewBox="0 0 24 24" style="width:12px;height:12px"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  window.SOLIDATA_APP.screens.recrutement = {
    html: () => `
      <div class="page-header" style="display:flex; align-items:flex-end; gap:16px;">
        <div>
          <h1 class="page-title">Recrutement</h1>
          <p class="page-sub">Pipeline de candidats · 68 en cours · ${columns.reduce((a,c)=>a+c.candidates.length,0)} affichés</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-outline">Importer CV</button>
        <button class="btn btn-primary">+ Nouveau candidat</button>
      </div>

      <div class="kanban-topbar">
        <div class="search" style="max-width:320px; flex:none;">
          <svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
          <input placeholder="Rechercher un candidat…">
        </div>
        <div class="filter-group">
          <button class="filter-pill active">Tous</button>
          <button class="filter-pill">Collecte</button>
          <button class="filter-pill">Tri</button>
          <button class="filter-pill">Chauffeur</button>
          <button class="filter-pill">Manager</button>
        </div>
        <div style="margin-left:auto; display:flex; gap:6px;">
          <button class="btn btn-outline btn-sm">Trier ▾</button>
          <button class="btn btn-outline btn-sm">Vue Kanban ▾</button>
        </div>
      </div>

      <div class="kanban-board">
        ${columns.map(col => `
          <div>
            <div class="kcol-head">
              <span class="kcol-dot" style="background:${col.color}"></span>
              <span class="kcol-title">${col.title}</span>
              <span class="kcol-count">${col.candidates.length}</span>
            </div>
            <div class="kcol-body ${col.body}">
              ${col.candidates.map(c => `
                <div class="kcard">
                  <div class="kcard-head">
                    <div class="kavo">${c.i}</div>
                    <div style="flex:1; min-width:0;">
                      <div class="kcard-name">${c.n}</div>
                      <div class="kcard-pos">${c.p}</div>
                    </div>
                  </div>
                  <div class="kcard-body">
                    <span class="chip chip-teal">${c.l}</span>
                    <span class="kcard-score">${zap} ${c.s}/10</span>
                  </div>
                  ${c.days ? `<div class="kcard-meta">${clock} <span>${c.days}j en cours</span></div>` : ''}
                  ${c.check ? `<div class="kcard-meta" style="color:var(--green-700);"><span class="chip-dot" style="background:var(--green-600);width:6px;height:6px;border-radius:50%"></span> <span>${c.check}</span></div>` : ''}
                  ${c.date ? `<div class="kcard-meta" style="color:var(--teal-700);">${clock} <span>Départ ${c.date}</span></div>` : ''}
                  <div class="kcard-actions">
                    <button class="btn">${mail} Contact</button>
                    <button class="btn">${file} CV</button>
                  </div>
                </div>
              `).join('')}
              <button class="add-card">+ Ajouter un candidat</button>
            </div>
          </div>
        `).join('')}
      </div>
    `
  };
})();
