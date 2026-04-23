window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };
// ============== DASHBOARD (v2 — priorités d'abord) ==============
(function(){
  const spark = (vals, color='#0D9488') => {
    const max = Math.max(...vals), min = Math.min(...vals);
    const w = 100, h = 30, step = w / (vals.length - 1);
    const pts = vals.map((v,i) => `${i*step},${h - ((v-min)/(max-min||1))*(h-4) - 2}`).join(' ');
    const area = `M0,${h} L${pts.split(' ').join(' L')} L${w},${h} Z`;
    return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%">
      <path class="spark-area" d="${area}"/>
      <polyline class="spark-line" points="${pts}"/>
    </svg>`;
  };

  const kpis = [
    { lbl: 'Candidats en cours', val: '24', trend: '+12%', vals: [12,14,13,18,17,22,24] },
    { lbl: 'Tournées actives', val: '8', trend: '+5%', vals: [5,6,7,6,7,8,8] },
    { lbl: 'Stock MP', val: '2 340', unit: 'kg', trend: '+18%', vals: [1800,1900,2000,2100,2150,2300,2340] },
    { lbl: 'Boutiques', val: '12', trend: '→', vals: [12,12,12,12,12,12,12] },
  ];

  const priorities = [
    { chip: 'chip-red', label: 'Urgent', title: 'Stock MP critique — Dépôt 2', meta: 'Synthétique 85kg · sous seuil depuis 2h · contacter fournisseur', cta: 'Traiter' },
    { chip: 'chip-amber', label: 'Entretien', title: 'Marie Durand · aujourd\'hui 14h30', meta: 'Responsable collecte · préparer questions PCM', cta: 'Ouvrir' },
    { chip: 'chip-teal', label: 'À valider', title: 'Tournée Rouen-Nord · retour dépôt', meta: 'Marc L. · 112 kg collectés · CAV moyen 87%', cta: 'Valider' },
    { chip: 'chip-blue', label: 'Relance', title: '3 candidats sans réponse depuis 5j', meta: 'Thomas Lefevre · Maria Garcia · Pierre Dubois', cta: 'Relancer' },
  ];

  const activities = [
    { icon: '👤', c: 'blue', title: 'Marie Durand a complété son test PCM', meta: 'Recrutement · score 8.2', time: 'il y a 12 min' },
    { icon: '🚚', c: 'teal', title: 'Tournée Rouen-Nord démarrée', meta: 'Collecte · 8 points prévus · 320kg estimés', time: 'il y a 34 min' },
    { icon: '⚙', c: 'teal', title: 'Chaîne Tri #3 reprend après pause', meta: 'Production · 3 agents · 290kg en cours', time: 'il y a 1h' },
    { icon: '⚠', c: 'red', title: 'Alerte stock — Synthétique D2', meta: 'Production · 85kg restants · sous seuil 100kg', time: 'il y a 2h' },
    { icon: '📄', c: 'amber', title: 'Facture #2204 validée', meta: 'Finances · 12 400 € · Contrat Rouen', time: 'hier' },
  ];

  window.SOLIDATA_APP.screens.dashboard = {
    html: () => `
      <div class="page-header">
        <h1 class="page-title">Bonjour Julien 👋</h1>
        <p class="page-sub">Jeudi 22 avril · voici ce qui demande ton attention aujourd'hui.</p>
      </div>

      <section class="priorities">
        <div class="prio-card">
          <div class="prio-head">
            <h2>À traiter aujourd'hui</h2>
            <span class="prio-count">${priorities.length}</span>
            <button class="btn btn-ghost btn-sm">Tout voir</button>
          </div>
          <div class="prio-list">
            ${priorities.map(p => `
              <div class="prio-item">
                <div class="prio-chip-col"><span class="chip ${p.chip}"><span class="chip-dot"></span>${p.label}</span></div>
                <div class="prio-body">
                  <div class="prio-title">${p.title}</div>
                  <div class="prio-meta">${p.meta}</div>
                </div>
                <button class="btn btn-primary btn-sm">${p.cta} →</button>
              </div>
            `).join('')}
          </div>
        </div>
      </section>

      <section class="kpi-grid" style="margin-bottom: 24px;">
        ${kpis.map(k => `
          <div class="kpi">
            <div class="kpi-row">
              <div>
                <div class="kpi-lbl">${k.lbl}</div>
                <div class="kpi-val">${k.val}${k.unit?`<span class="kpi-unit">${k.unit}</span>`:''}</div>
              </div>
              <span class="chip ${k.trend.startsWith('+')?'chip-green':'chip-slate'}">${k.trend}</span>
            </div>
            ${spark(k.vals)}
          </div>
        `).join('')}
      </section>

      <div class="dash-grid">
        <div class="card">
          <div class="card-head">
            <h3 class="card-title">Activité récente</h3>
            <a class="link">Voir tout →</a>
          </div>
          <div>
            ${activities.map(a => `
              <div class="activity-item">
                <div class="activity-icon ${a.c}">${a.icon}</div>
                <div class="activity-body">
                  <div class="activity-title">${a.title}</div>
                  <div class="activity-meta">${a.meta}</div>
                </div>
                <div class="activity-time">${a.time}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3 class="card-title">Performance semaine</h3></div>
          <div class="card-pad">
            <div style="background: linear-gradient(135deg, var(--teal-600), var(--teal-800)); color: white; margin: -20px -20px 16px; padding: 22px 20px; border-radius: 12px 12px 0 0;">
              <div style="display:flex; justify-content:space-between; margin-bottom: 14px;">
                <span style="font-size: 13px; opacity: .85;">Efficacité collecte</span>
                <span style="font-weight: 800; font-size: 15px;">94%</span>
              </div>
              <div style="height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden;"><div style="width: 94%; height:100%; background: white; border-radius: 3px;"></div></div>
              <div style="display:flex; justify-content:space-between; margin: 14px 0 6px;">
                <span style="font-size: 13px; opacity: .85;">Satisfaction équipe</span>
                <span style="font-weight: 800; font-size: 15px;">4.8/5</span>
              </div>
              <div style="height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden;"><div style="width: 96%; height:100%; background: white; border-radius: 3px;"></div></div>
            </div>
            <div style="display:flex; flex-direction:column; gap: 8px;">
              <button class="btn btn-outline" style="justify-content:flex-start; width: 100%;">+ Nouveau candidat</button>
              <button class="btn btn-outline" style="justify-content:flex-start; width: 100%;">+ Nouvelle tournée</button>
              <button class="btn btn-outline" style="justify-content:flex-start; width: 100%;">+ Saisie stock</button>
              <button class="btn btn-outline" style="justify-content:flex-start; width: 100%;">+ Générer rapport</button>
            </div>
          </div>
        </div>
      </div>
    `
  };
})();
