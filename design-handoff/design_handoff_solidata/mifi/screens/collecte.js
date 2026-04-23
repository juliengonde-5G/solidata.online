window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };
// ============== COLLECTE (v1 + map + IA) ==============
(function(){
  const propositions = [
    { t:'Rouen-Sud + Elbeuf · 14 pts · ~320kg · 4h30' },
    { t:'Le Havre côte · 9 pts · ~180kg · 3h' },
    { t:'Dieppe urgente · 6 pts CAV pleins' },
  ];
  const tours = [
    { id:'T1', name:'Rouen-Nord', meta:'Marc L. · 5/8 points · en route', cav:87, status:'chip-teal', label:'En route', cls:'active', px:28, py:42, pinCls:'' },
    { id:'T2', name:'Le Havre côte', meta:'Julie P. · retour dépôt', cav:64, status:'chip-teal', label:'Retour', px:12, py:30, pinCls:'' },
    { id:'T3', name:'Elbeuf centre', meta:'Karim B. · en chargement', cav:92, status:'chip-teal', label:'Chargt.', px:38, py:58, pinCls:'' },
    { id:'T4', name:'Dieppe', meta:'Nora S. · planifiée 11h', cav:45, status:'chip-slate', label:'Planif.', px:32, py:18, pinCls:'muted' },
    { id:'T5', name:'Évreux', meta:'Rémi T. · retard estimé 20min', cav:0, status:'chip-red', label:'Retard', px:55, py:68, pinCls:'red' },
    { id:'T6', name:'Caen ouest', meta:'Paul M. · 3/6 points', cav:71, status:'chip-teal', label:'En route', px:70, py:45, pinCls:'' },
    { id:'T7', name:'Lisieux', meta:'Fatima D. · chargé 4/5', cav:78, status:'chip-teal', label:'En route', px:60, py:30, pinCls:'' },
    { id:'T8', name:'Vernon', meta:'Issa K. · retour', cav:52, status:'chip-amber', label:'Lent', px:78, py:62, pinCls:'amber' },
  ];

  window.SOLIDATA_APP.screens.collecte = {
    html: () => `
      <div class="page-header" style="display:flex; align-items:flex-end; gap:16px;">
        <div>
          <h1 class="page-title">Collecte — live</h1>
          <p class="page-sub">Jeudi 22 avril · 8 tournées actives · 340kg collectés aujourd'hui</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-outline">Planning</button>
        <button class="btn btn-primary">+ Nouvelle tournée</button>
      </div>

      <div class="collecte-layout">
        <!-- IA banner -->
        <div class="ia-banner">
          <span class="ia-badge">★ IA</span>
          <div>
            <h3>3 tournées proposées pour demain</h3>
            <p>Basé sur saturation CAV, proximité dépôts, historique jeudi · +12% CAV estimé</p>
          </div>
          <div class="ia-propos">
            ${propositions.map(p=>`<span class="ia-pill">${p.t}</span>`).join('')}
          </div>
          <button class="btn btn-primary btn-sm" style="margin-left:8px;">Voir & valider →</button>
        </div>

        <!-- split carte + liste -->
        <div class="collecte-split">
          <div class="collecte-list">
            <div class="list-head">
              <h3>Tournées actives</h3>
              <p>Trier par statut ▾</p>
            </div>
            <div class="tour-list">
              ${tours.map((t,i) => `
                <div class="tour-item ${i===0?'active':''}" data-tour="${t.id}">
                  <div class="tour-cav" style="--cav: ${t.cav}%;"><span>${t.cav}%</span></div>
                  <div class="tour-body">
                    <div class="tour-name">${t.id} · ${t.name}</div>
                    <div class="tour-meta">${t.meta}</div>
                  </div>
                  <span class="chip ${t.status}">${t.label}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="collecte-map">
            <!-- callout -->
            <div class="map-callout">
              <h4>T1 · Rouen-Nord</h4>
              <div class="row"><span>Chauffeur · <b>Marc L.</b></span></div>
              <div class="row"><span>Points · <b>5/8</b></span><span>CAV · <b>87%</b></span></div>
              <div class="row"><span>Collecté · <b>112 kg</b></span><span>ETA retour · <b>14h40</b></span></div>
              <div style="margin-top:10px; display:flex; gap:6px;">
                <button class="btn btn-primary btn-sm">Voir détail</button>
                <button class="btn btn-ghost btn-sm">Contacter</button>
              </div>
            </div>
            <div class="map-controls">
              <button class="map-ctl">+</button>
              <button class="map-ctl">−</button>
              <button class="map-ctl" title="Centrer">⌖</button>
            </div>
            ${tours.map(t => `
              <div class="map-pin ${t.pinCls}" style="left:${t.px}%; top:${t.py}%;" data-tour="${t.id}">
                <div class="map-pin-marker">🚚 ${t.id}${t.cav?`<span class="cav">${t.cav}%</span>`:''}</div>
                <div class="map-pin-tail"></div>
              </div>
            `).join('')}
            <div class="map-legend">
              <span><i style="background:#0D9488"></i> En route</span>
              <span><i style="background:#B45309"></i> Lent</span>
              <span><i style="background:#DC2626"></i> Retard</span>
              <span><i style="background:#64748B"></i> Planifiée</span>
            </div>
          </div>
        </div>
      </div>
    `,
    init: (host) => {
      host.querySelectorAll('.tour-item').forEach(el => {
        el.addEventListener('click', () => {
          host.querySelectorAll('.tour-item').forEach(x=>x.classList.remove('active'));
          el.classList.add('active');
        });
      });
    }
  };
})();
