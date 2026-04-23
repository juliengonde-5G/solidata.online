window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };
// ============== PRODUCTION — Flux interactif (v2) ==============
(function(){
  window.SOLIDATA_APP.screens.production = {
    html: () => `
      <div class="page-header" style="display:flex; align-items:flex-end; gap:16px;">
        <div>
          <h1 class="page-title">Production — chaîne de tri</h1>
          <p class="page-sub">Stock MP · 2 340 kg · 3 chaînes actives · 8 agents</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-outline">Stock détaillé</button>
        <button class="btn btn-primary">+ Saisie entrée</button>
      </div>

      <div class="flow-wrap">
        <div class="chain-status">
          <span class="chain-live">LIVE</span>
          <div>
            <div style="font-size:13px; font-weight:700; color: var(--slate-900);">Chaîne de tri #3 · active</div>
            <div style="font-size:12px; color: var(--slate-500);">Démarrage 08:12 · 290 kg en cours · rythme 45 kg/h</div>
          </div>
          <div style="flex:1"></div>
          <span class="chip chip-green">En avance · +8%</span>
          <button class="btn btn-outline btn-sm">Mettre en pause</button>
        </div>

        <div class="flow-kpis">
          <div class="kpi"><div class="kpi-lbl">Entrée jour</div><div class="kpi-val">340<span class="kpi-unit">kg</span></div></div>
          <div class="kpi"><div class="kpi-lbl">En cours de tri</div><div class="kpi-val">290<span class="kpi-unit">kg</span></div></div>
          <div class="kpi"><div class="kpi-lbl">Traité</div><div class="kpi-val">265<span class="kpi-unit">kg</span></div></div>
          <div class="kpi"><div class="kpi-lbl">Taux conformité</div><div class="kpi-val">94<span class="kpi-unit">%</span></div></div>
        </div>

        <div class="flow-diagram">
          <div class="flow-row">
            <div class="flow-node" data-node="0">
              <div class="flow-node-icon">
                <svg class="ic" viewBox="0 0 24 24"><path d="M21 16V7l-9-4-9 4v9l9 4 9-4z"/><path d="M3 7l9 4 9-4"/></svg>
              </div>
              <div class="flow-node-title">Entrée dépôt</div>
              <div class="flow-node-meta">Pesée initiale</div>
              <div class="flow-node-kpi">340kg</div>
            </div>
            <div class="flow-arrow">
              <svg class="ic" viewBox="0 0 24 24" style="width:22px;height:22px"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
            </div>
            <div class="flow-node active" data-node="1">
              <div class="flow-node-icon">
                <svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/></svg>
              </div>
              <div class="flow-node-title">Tri qualité</div>
              <div class="flow-node-meta">3 agents · visuel</div>
              <div class="flow-node-kpi">290kg</div>
            </div>
            <div class="flow-arrow">
              <svg class="ic" viewBox="0 0 24 24" style="width:22px;height:22px"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
            </div>
            <div class="flow-node" data-node="2">
              <div class="flow-node-icon">
                <svg class="ic" viewBox="0 0 24 24"><path d="M12 2v20"/><path d="M5 12l7-7 7 7"/></svg>
              </div>
              <div class="flow-node-title">Pesée + catégo.</div>
              <div class="flow-node-meta">Coton / Laine / Synth.</div>
              <div class="flow-node-kpi">265kg</div>
            </div>
            <div class="flow-arrow">
              <svg class="ic" viewBox="0 0 24 24" style="width:22px;height:22px"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
            </div>
            <div class="flow-node" data-node="3">
              <div class="flow-node-icon">
                <svg class="ic" viewBox="0 0 24 24"><path d="M20.59 13.41l-8.17-8.17A2 2 0 0 0 11 4.59H4v7l8.17 8.17a2 2 0 0 0 2.83 0l5.59-5.59a2 2 0 0 0 0-2.83z"/><circle cx="8" cy="8" r="1"/></svg>
              </div>
              <div class="flow-node-title">Destination</div>
              <div class="flow-node-meta">3 sorties</div>
              <div class="flow-node-kpi">3 flux</div>
            </div>
          </div>

          <div class="flow-outputs">
            <div class="flow-output">
              <div class="flow-out-ic g">
                <svg class="ic" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              </div>
              <div>
                <div class="flow-out-l">→ Revente boutiques</div>
                <div class="flow-out-v">180 kg · 68%</div>
              </div>
            </div>
            <div class="flow-output">
              <div class="flow-out-ic b">
                <svg class="ic" viewBox="0 0 24 24"><path d="M20 7l-8-4-8 4 8 4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 17l8 4 8-4"/></svg>
              </div>
              <div>
                <div class="flow-out-l">→ Refashion (atelier)</div>
                <div class="flow-out-v">60 kg · 23%</div>
              </div>
            </div>
            <div class="flow-output">
              <div class="flow-out-ic s">
                <svg class="ic" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </div>
              <div>
                <div class="flow-out-l">→ Rebut / recyclage</div>
                <div class="flow-out-v">25 kg · 9%</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `,
    init: (host) => {
      host.querySelectorAll('.flow-node').forEach(n => {
        n.addEventListener('click', () => {
          host.querySelectorAll('.flow-node').forEach(x => x.classList.remove('active'));
          n.classList.add('active');
        });
      });
    }
  };
})();
