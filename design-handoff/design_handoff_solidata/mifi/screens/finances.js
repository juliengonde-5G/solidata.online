window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };
// ============== FINANCES — Narratif (v2) ==============
(function(){
  window.SOLIDATA_APP.screens.finances = {
    html: () => `
      <div class="page-header" style="display:flex; align-items:flex-end; gap:16px;">
        <div>
          <h1 class="page-title">Finances — avril 2026</h1>
          <p class="page-sub">Vue synthétique · mise à jour il y a 5 minutes</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-outline">Comparer ▾</button>
        <button class="btn btn-outline">Exporter</button>
        <button class="btn btn-primary">Période ▾</button>
      </div>

      <div class="fin-wrap">
        <!-- IA insight principal -->
        <div class="insight-card">
          <span class="insight-tag">
            <span class="chip chip-teal"><span class="chip-dot"></span>★ Insight IA</span>
            <span class="chip chip-slate" style="margin-left:6px;">mis à jour 09:45</span>
          </span>
          <h2 class="insight-h">Ce mois, la marge est en hausse de <mark>+14%</mark>, portée par refashion et Rouen-Nord.</h2>
          <p class="insight-body">
            Les charges logistiques baissent de <b>-8%</b> grâce à l'optimisation des tournées, et les ventes refashion progressent de <b>+22%</b> sur le trimestre. La tournée <b>Rouen-Nord</b> atteint <b>87% de CAV</b>, un record historique. À surveiller : le poste carburant dépasse le budget de +6%.
          </p>
          <div style="display:flex; gap:10px; margin-top:16px;">
            <button class="btn btn-primary btn-sm">Voir le détail →</button>
            <button class="btn btn-ghost btn-sm">Exporter en PDF</button>
          </div>
        </div>

        <!-- KPIs -->
        <div class="fin-kpis">
          <div class="kpi">
            <div class="kpi-row">
              <div><div class="kpi-lbl">Chiffre d'affaires</div><div class="kpi-val">84 200<span class="kpi-unit">€</span></div></div>
              <span class="chip chip-green">+8%</span>
            </div>
            <div style="font-size:11.5px; color:var(--slate-500); margin-top:6px;">vs mars · 78 000€</div>
          </div>
          <div class="kpi">
            <div class="kpi-row">
              <div><div class="kpi-lbl">Charges</div><div class="kpi-val">61 400<span class="kpi-unit">€</span></div></div>
              <span class="chip chip-green">-2%</span>
            </div>
            <div style="font-size:11.5px; color:var(--slate-500); margin-top:6px;">vs mars · 62 700€</div>
          </div>
          <div class="kpi" style="background: linear-gradient(135deg, var(--teal-50), white); border-color: var(--teal-200);">
            <div class="kpi-row">
              <div><div class="kpi-lbl">Marge nette</div><div class="kpi-val" style="color:var(--teal-700);">22 800<span class="kpi-unit">€</span></div></div>
              <span class="chip chip-green">+14%</span>
            </div>
            <div style="font-size:11.5px; color:var(--slate-500); margin-top:6px;">27% du CA</div>
          </div>
          <div class="kpi">
            <div class="kpi-row">
              <div><div class="kpi-lbl">Trésorerie</div><div class="kpi-val">147<span class="kpi-unit">k€</span></div></div>
              <span class="chip chip-slate">stable</span>
            </div>
            <div style="font-size:11.5px; color:var(--slate-500); margin-top:6px;">3,8 mois de charges</div>
          </div>
        </div>

        <!-- secondary insights -->
        <div class="fin-grid">
          <div class="card alert-card" style="align-items:flex-start;">
            <div class="activity-icon amber" style="width:40px;height:40px;">⚠</div>
            <div style="flex:1">
              <h4>Carburant au-dessus du budget</h4>
              <p>Poste « carburant » à <b>4 820€</b>, soit <b>+6% vs budget</b>. Les tournées Dieppe et Évreux pourraient être fusionnées deux fois par semaine.</p>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-primary btn-sm">Simuler fusion</button>
                <button class="btn btn-outline btn-sm">Voir tournées</button>
              </div>
            </div>
          </div>

          <div class="card" style="padding:20px;">
            <h4 style="margin:0 0 4px; font-size:13.5px; font-weight:700; color:var(--slate-900);">Cashflow 90 jours</h4>
            <p style="margin:0 0 14px; font-size:12px; color:var(--slate-500);">Entrées et sorties prévues</p>
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${[
                {d:'15 mai', l:'Subvention T2', v:'+24 000€', pos:1},
                {d:'20 mai', l:'Paie équipes', v:'-38 400€', pos:0},
                {d:'28 mai', l:'Loyer dépôts', v:'-5 200€', pos:0},
                {d:'5 juin', l:'Contrat Paris', v:'+18 000€', pos:1},
              ].map(e => `
                <div style="display:flex; align-items:center; gap:12px; padding:10px 12px; background:var(--slate-50); border-radius:var(--r-md);">
                  <span style="font-size:11px; color:var(--slate-500); font-weight:600; min-width:50px;">${e.d}</span>
                  <span style="flex:1; font-size:13px; color:var(--slate-800); font-weight:500;">${e.l}</span>
                  <span class="chip ${e.pos?'chip-green':'chip-red'}" style="font-variant-numeric: tabular-nums;">${e.v}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Breakdown chart -->
        <div class="card">
          <div class="card-head">
            <h3 class="card-title">Répartition des charges — avril</h3>
            <a class="link">Voir par poste →</a>
          </div>
          <div class="card-pad">
            <div style="display:flex; gap:12px; margin-bottom:12px;">
              ${[
                {l:'Salaires', v:42, c:'var(--teal-600)'},
                {l:'Logistique', v:22, c:'var(--teal-500)'},
                {l:'Dépôts', v:14, c:'var(--teal-400)'},
                {l:'Carburant', v:8, c:'var(--amber-700)'},
                {l:'Admin', v:9, c:'var(--slate-400)'},
                {l:'Autres', v:5, c:'var(--slate-300)'},
              ].map(s=>`<div style="flex:${s.v}; background:${s.c}; height:26px; border-radius:4px; display:flex; align-items:center; justify-content:center; color:white; font-size:11px; font-weight:700;">${s.v}%</div>`).join('')}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:12px; color:var(--slate-600);">
              ${[
                {l:'Salaires', v:'25 788€', c:'var(--teal-600)'},
                {l:'Logistique', v:'13 508€', c:'var(--teal-500)'},
                {l:'Dépôts', v:'8 596€', c:'var(--teal-400)'},
                {l:'Carburant', v:'4 912€ ⚠', c:'var(--amber-700)'},
                {l:'Admin', v:'5 526€', c:'var(--slate-400)'},
                {l:'Autres', v:'3 070€', c:'var(--slate-300)'},
              ].map(s=>`<span style="display:inline-flex; align-items:center; gap:6px;"><i style="width:10px; height:10px; border-radius:2px; background:${s.c};"></i><b style="color:var(--slate-900); font-weight:600;">${s.l}</b> ${s.v}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `
  };
})();
