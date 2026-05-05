/**
 * Export PDF visuel — Chaîne de tri SOLIDATA
 * Ouvre une fenêtre A4 paysage pré-formatée pour impression / sauvegarde PDF.
 * Reprend exactement le mapping de DiagrammeFluxTri.jsx (Chaîne Qualité + Recyclage Exclusif).
 */

const COL = {
  green: '#0D9488',      // solidata-green (teal — Tailwind config)
  greenLight: '#5EEAD4',
  dark: '#134E4A',
  blue: '#1D4ED8',
  blueLight: '#DBEAFE',
  blueBorder: '#93C5FD',
  amber: '#B45309',
  amberLight: '#FEF3C7',
  amberBorder: '#FCD34D',
  gray: '#6B7280',
  grayLight: '#F3F4F6',
  grayBorder: '#E5E7EB',
  csr: '#7C3AED',
  effilo: '#DC2626',
  chiffon: '#0EA5E9',
  pf: '#059669',
};

const STYLES = `
  @page { size: A4 landscape; margin: 10mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #1A1A1A; line-height: 1.35; }

  .page { page-break-after: always; padding: 4px; }
  .page:last-child { page-break-after: auto; }

  .header { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; background: ${COL.green}; color: white; border-radius: 6px; margin-bottom: 10px; }
  .header h1 { font-size: 16px; font-weight: 700; letter-spacing: .2px; }
  .header .sub { font-size: 10px; opacity: .9; }
  .header .brand { font-size: 11px; font-weight: 700; letter-spacing: 1px; opacity: .9; }

  .legend { display: flex; gap: 14px; flex-wrap: wrap; padding: 6px 10px; background: #FAFAFA; border: 1px solid ${COL.grayBorder}; border-radius: 6px; margin-bottom: 8px; font-size: 9px; }
  .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }

  /* Vue d'ensemble */
  .overview { display: grid; grid-template-columns: 240px 1fr; gap: 10px; }
  .stock-mp { background: ${COL.green}; color: white; border-radius: 8px; padding: 14px; display: flex; flex-direction: column; justify-content: center; text-align: center; min-height: 460px; }
  .stock-mp .icon { font-size: 36px; margin-bottom: 6px; }
  .stock-mp h2 { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .stock-mp p { font-size: 10px; opacity: .9; line-height: 1.45; }
  .stock-mp .pesee { margin-top: 12px; padding: 6px 10px; background: rgba(255,255,255,.18); border-radius: 4px; font-size: 9px; font-weight: 600; }

  .branches { display: grid; grid-template-rows: 1fr 1fr 1fr; gap: 8px; }
  .branch { border: 2px solid; border-radius: 8px; padding: 10px 14px; position: relative; display: flex; flex-direction: column; justify-content: center; }
  .branch-quality { border-color: ${COL.blue}; background: linear-gradient(90deg, ${COL.blueLight} 0%, #FFFFFF 100%); }
  .branch-recycle { border-color: ${COL.amber}; background: linear-gradient(90deg, ${COL.amberLight} 0%, #FFFFFF 100%); }
  .branch-original { border-color: ${COL.gray}; background: linear-gradient(90deg, ${COL.grayLight} 0%, #FFFFFF 100%); }
  .branch h3 { font-size: 13px; font-weight: 700; margin-bottom: 3px; }
  .branch .desc { font-size: 9px; color: ${COL.gray}; margin-bottom: 6px; }
  .branch-quality h3 { color: ${COL.blue}; }
  .branch-recycle h3 { color: ${COL.amber}; }
  .branch-original h3 { color: ${COL.gray}; }
  .branch-mini { display: flex; gap: 4px; flex-wrap: wrap; }
  .branch-mini .step { background: white; border: 1px solid currentColor; border-radius: 4px; padding: 2px 6px; font-size: 9px; font-weight: 600; }

  /* Pages détaillées */
  .chain-section { padding: 4px; }
  .chain-title { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; margin-bottom: 8px; color: white; font-weight: 700; font-size: 13px; }
  .chain-title.quality { background: ${COL.blue}; }
  .chain-title.recycle { background: ${COL.amber}; }
  .chain-title .badge { background: rgba(255,255,255,.25); padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 600; }

  /* Flow horizontal */
  .flow-horizontal { display: flex; gap: 6px; align-items: stretch; overflow: hidden; }
  .op-card { flex: 1; min-width: 0; border: 2px solid; border-radius: 8px; background: white; padding: 8px; display: flex; flex-direction: column; }
  .op-card.quality { border-color: ${COL.blueBorder}; }
  .op-card.recycle { border-color: ${COL.amberBorder}; }
  .op-card .op-num { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 9px; font-weight: 700; color: white; margin-bottom: 4px; }
  .op-card.quality .op-num { background: ${COL.blue}; }
  .op-card.recycle .op-num { background: ${COL.amber}; }
  .op-card h4 { font-size: 10px; font-weight: 700; margin-bottom: 5px; color: #1F2937; }
  .op-card .postes { background: #F9FAFB; border-radius: 4px; padding: 4px 6px; margin-bottom: 5px; }
  .op-card .postes .lbl { font-size: 7px; text-transform: uppercase; color: ${COL.gray}; font-weight: 700; letter-spacing: .3px; }
  .op-card .poste-pill { display: inline-block; padding: 2px 6px; margin: 2px 2px 0 0; border-radius: 3px; font-size: 9px; font-weight: 700; color: white; }
  .op-card .poste-meta { font-size: 7px; color: ${COL.gray}; display: block; margin-top: 1px; }
  .op-card .entrant { background: #FFFBEB; border-left: 2px solid ${COL.amber}; padding: 3px 5px; margin-bottom: 4px; font-size: 8px; color: #78350F; border-radius: 0 3px 3px 0; }
  .op-card .sorties { flex: 1; }
  .op-card .sorties .lbl { font-size: 7px; text-transform: uppercase; color: ${COL.gray}; font-weight: 700; letter-spacing: .3px; margin-bottom: 3px; }
  .op-card .sortie { display: flex; align-items: baseline; gap: 4px; padding: 1px 0; font-size: 8.5px; line-height: 1.3; }
  .op-card .sortie .arrow { color: ${COL.gray}; font-size: 8px; }
  .op-card .sortie .libelle { color: #1F2937; font-weight: 500; }
  .op-card .sortie .vers { color: ${COL.green}; font-weight: 600; font-size: 8px; }

  .arrow-link { display: flex; align-items: center; color: ${COL.gray}; font-size: 18px; font-weight: 700; padding: 0 2px; }

  .note { margin-top: 6px; padding: 4px 8px; background: #FFF7ED; border: 1px dashed ${COL.amberBorder}; border-radius: 4px; font-size: 8.5px; color: #78350F; }

  /* Sorties / débouchés */
  .outputs-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 4px; }
  .output-box { border: 1.5px solid; border-radius: 6px; padding: 7px 8px; }
  .output-box .ttl { font-size: 9px; font-weight: 700; margin-bottom: 4px; }
  .output-box .item { font-size: 8.5px; color: #374151; padding: 1px 0; line-height: 1.3; }
  .output-box.csr { border-color: ${COL.csr}; background: #F5F3FF; }
  .output-box.csr .ttl { color: ${COL.csr}; }
  .output-box.effilo { border-color: ${COL.effilo}; background: #FEF2F2; }
  .output-box.effilo .ttl { color: ${COL.effilo}; }
  .output-box.chiffon { border-color: ${COL.chiffon}; background: #F0F9FF; }
  .output-box.chiffon .ttl { color: ${COL.chiffon}; }
  .output-box.pf { border-color: ${COL.pf}; background: #ECFDF5; }
  .output-box.pf .ttl { color: ${COL.pf}; }
  .output-box.original { border-color: ${COL.gray}; background: ${COL.grayLight}; }
  .output-box.original .ttl { color: ${COL.gray}; }

  .exutoires-list { margin-top: 8px; padding: 6px 10px; background: ${COL.green}; color: white; border-radius: 6px; font-size: 9px; }
  .exutoires-list h4 { font-size: 10px; font-weight: 700; margin-bottom: 4px; }
  .exutoires-list .ex-pill { display: inline-block; background: rgba(255,255,255,.18); padding: 2px 7px; margin: 2px 3px 0 0; border-radius: 10px; font-size: 8.5px; }

  .footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 6px; border-top: 1px solid ${COL.grayBorder}; font-size: 8px; color: ${COL.gray}; }

  /* KPI stats */
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
  .kpi { padding: 6px 10px; background: white; border: 1px solid ${COL.grayBorder}; border-radius: 6px; }
  .kpi .label { font-size: 8px; text-transform: uppercase; color: ${COL.gray}; font-weight: 700; letter-spacing: .3px; }
  .kpi .value { font-size: 14px; font-weight: 700; color: ${COL.dark}; margin-top: 2px; }
  .kpi .unit { font-size: 9px; color: ${COL.gray}; margin-left: 2px; font-weight: 500; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none; } }
`;

const POSTE_COLORS = {
  'Crack 1': '#3B82F6',
  'Crack 2': '#60A5FA',
  'R1': '#10B981',
  'R2': '#34D399',
  'R3': '#F59E0B',
  'R4': '#FBBF24',
  'Réu': '#A855F7',
  'Triage fin': '#EC4899',
  'Chiffons': '#14B8A6',
};

function pillPoste(p) {
  const color = POSTE_COLORS[p.nom] || COL.gray;
  return `<span class="poste-pill" style="background:${color}">${p.nom}</span>${
    p.obligatoire
      ? '<span class="poste-meta">obligatoire' + (p.doublure ? ' + doublure optionnelle' : '') + '</span>'
      : '<span class="poste-meta">facultatif</span>'
  }`;
}

function blocOperation({ num, titre, postes, sorties, entrant, couleur }) {
  const postesHtml = postes.map(pillPoste).join('');
  const sortiesHtml = sorties
    .map(
      (s) => `<div class="sortie">
        <span class="libelle">${s.libelle}</span>
        <span class="arrow">→</span>
        <span class="vers">${s.vers}</span>
      </div>`,
    )
    .join('');

  return `
    <div class="op-card ${couleur}">
      <span class="op-num">${num}</span>
      <h4>${titre}</h4>
      <div class="postes">
        <div class="lbl">Postes</div>
        ${postesHtml}
      </div>
      ${entrant ? `<div class="entrant"><strong>Entrée :</strong> ${entrant}</div>` : ''}
      <div class="sorties">
        <div class="lbl">Sorties → Débouché</div>
        ${sortiesHtml}
      </div>
    </div>
  `;
}

const QUALITY_OPS = [
  {
    num: 'OP.1',
    titre: 'Crackage 1',
    postes: [{ nom: 'Crack 1', obligatoire: true }],
    sorties: [
      { vers: 'Balle CSR', libelle: 'CSR Chaussures' },
      { vers: 'Exutoire spécifique', libelle: 'Jouets' },
      { vers: 'OP.2', libelle: 'Tout le reste' },
    ],
    couleur: 'quality',
  },
  {
    num: 'OP.2',
    titre: 'Crackage 2',
    postes: [{ nom: 'Crack 2', obligatoire: false }],
    sorties: [
      { vers: 'Stock PF (SaisiesP)', libelle: 'Chaussures pairés' },
      { vers: 'Balle CSR', libelle: 'CSR Chaussures' },
      { vers: 'OP.5 (triage fin)', libelle: 'Accessoires' },
      { vers: 'OP.5 (triage fin)', libelle: 'Linge de maison' },
      { vers: 'OP.3', libelle: 'Tout le reste' },
    ],
    couleur: 'quality',
  },
  {
    num: 'OP.3',
    titre: 'Recyclage',
    postes: [
      { nom: 'R1', obligatoire: true, doublure: true },
      { nom: 'R2', obligatoire: true, doublure: true },
    ],
    sorties: [
      { vers: 'Balle CSR', libelle: 'CSR' },
      { vers: 'Balle Effilochage', libelle: 'Jean' },
      { vers: 'Balle Effilochage', libelle: 'Effilo' },
      { vers: 'Poste Chiffons', libelle: 'Coton Blanc / Couleur' },
      { vers: 'OP.4', libelle: 'Textiles réutilisables' },
    ],
    couleur: 'quality',
  },
  {
    num: 'OP.4',
    titre: 'Réutilisation',
    postes: [{ nom: 'Réu', obligatoire: true, doublure: true }],
    sorties: [
      { vers: 'Balle CSR', libelle: 'CSR' },
      { vers: 'OP.5', libelle: 'Hommes (VAK / Btq)' },
      { vers: 'OP.5', libelle: 'Femmes (VAK / Btq)' },
      { vers: 'OP.5', libelle: 'Layette (VAK / Btq)' },
    ],
    couleur: 'quality',
  },
  {
    num: 'OP.5',
    titre: 'Triage fin',
    postes: [{ nom: 'Triage fin', obligatoire: false }],
    entrant: 'Hommes + Femmes + Layette (OP.4) + Accessoires + Linge (OP.2)',
    sorties: [
      { vers: 'Stock PF (SaisiesP)', libelle: '114 produits finis' },
      { vers: 'BTQ Standard', libelle: 'Boutique' },
      { vers: 'VAK', libelle: 'Export VAK' },
      { vers: 'CHIF / Pvak', libelle: 'Chiffons / Petit VAK' },
    ],
    couleur: 'quality',
  },
];

const RECYCLE_OPS = [
  {
    num: 'UNIQUE',
    titre: 'Recyclage Exclusif',
    postes: [
      { nom: 'R3', obligatoire: true },
      { nom: 'R4', obligatoire: true },
    ],
    entrant: 'Stock matières premières (sans pré-tri qualité)',
    sorties: [
      { vers: 'Balle CSR', libelle: 'CSR' },
      { vers: 'Balle Effilochage', libelle: 'Jean' },
      { vers: 'Balle Effilochage', libelle: 'Effilo' },
      { vers: 'Balle Chiffons Blanc', libelle: 'Coton Blanc' },
      { vers: 'Balle Chiffons Couleur', libelle: 'Coton Couleur' },
    ],
    couleur: 'recycle',
  },
];

function pageHeader(subtitle) {
  return `
    <div class="header">
      <div>
        <h1>Chaîne de tri textile</h1>
        <div class="sub">${subtitle}</div>
      </div>
      <div style="text-align:right">
        <div class="brand">SOLIDATA</div>
        <div class="sub">Solidarité Textiles · Rouen</div>
      </div>
    </div>
  `;
}

function pageFooter(num, total) {
  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  return `
    <div class="footer">
      <span>SOLIDATA ERP — Documentation chaîne de tri</span>
      <span>${today}</span>
      <span>Page ${num} / ${total}</span>
    </div>
  `;
}

function buildOverviewPage(fluxMois) {
  const fluxKpi = fluxMois
    ? `
    <div class="kpi-row">
      <div class="kpi">
        <div class="label">Entrée Chaîne Qualité</div>
        <div class="value">${Number(fluxMois.total_entree_ligne_kg || 0).toLocaleString('fr-FR')}<span class="unit">kg / mois</span></div>
      </div>
      <div class="kpi">
        <div class="label">Entrée Recyclage Exclusif</div>
        <div class="value">${Number(fluxMois.total_entree_r3_kg || 0).toLocaleString('fr-FR')}<span class="unit">kg / mois</span></div>
      </div>
      <div class="kpi">
        <div class="label">Total entrée</div>
        <div class="value">${(Number(fluxMois.total_entree_ligne_kg || 0) + Number(fluxMois.total_entree_r3_kg || 0)).toLocaleString('fr-FR')}<span class="unit">kg / mois</span></div>
      </div>
      <div class="kpi">
        <div class="label">Production sortie</div>
        <div class="value">${Number(fluxMois.total_sortie_t || 0).toLocaleString('fr-FR')}<span class="unit">t / mois</span></div>
      </div>
    </div>`
    : '';

  return `
    <div class="page">
      ${pageHeader('Vue d\'ensemble — Flux entrée / branches / sorties')}
      ${fluxKpi}
      <div class="legend">
        <span><span class="legend-dot" style="background:${COL.blue}"></span>Chaîne Qualité (5 opérations)</span>
        <span><span class="legend-dot" style="background:${COL.amber}"></span>Chaîne Recyclage Exclusif (1 opération)</span>
        <span><span class="legend-dot" style="background:${COL.gray}"></span>Vente Original (sans tri)</span>
        <span><span class="legend-dot" style="background:${COL.green}"></span>Stock matières premières (entrée)</span>
        <span><span class="legend-dot" style="background:${COL.pf}"></span>Stock produits finis (sortie)</span>
      </div>
      <div class="overview">
        <div class="stock-mp">
          <div class="icon">📦</div>
          <h2>Stock matières premières</h2>
          <p>Textiles collectés via les CAV (Conteneurs d'Apport Volontaire) sur la métropole de Rouen.</p>
          <div class="pesee">Pesée systématique en entrée (SaisiesT)</div>
        </div>
        <div class="branches">
          <div class="branch branch-quality">
            <h3>① Chaîne Qualité</h3>
            <div class="desc">Tri valorisé pour réemploi — 5 opérations successives, 114 produits finis.</div>
            <div class="branch-mini" style="color:${COL.blue}">
              <span class="step">OP.1 Crack 1</span>
              <span class="step">OP.2 Crack 2</span>
              <span class="step">OP.3 Recyclage R1+R2</span>
              <span class="step">OP.4 Réutilisation</span>
              <span class="step">OP.5 Triage fin</span>
            </div>
          </div>
          <div class="branch branch-recycle">
            <h3>② Chaîne Recyclage Exclusif</h3>
            <div class="desc">Tri direct vers exutoires recyclage — 1 opération, postes R3 + R4.</div>
            <div class="branch-mini" style="color:${COL.amber}">
              <span class="step">Recyclage R3</span>
              <span class="step">Recyclage R4</span>
              <span class="step">→ CSR / Effilochage / Chiffons</span>
            </div>
          </div>
          <div class="branch branch-original">
            <h3>③ Vente Original</h3>
            <div class="desc">Vente brute, sans tri — flux direct vers exutoires d'export.</div>
            <div class="branch-mini" style="color:${COL.gray}">
              <span class="step">Stock brut</span>
              <span class="step">→ Pesée sortie</span>
              <span class="step">→ Exutoires VAK / Export</span>
            </div>
          </div>
        </div>
      </div>
      ${pageFooter(1, 4)}
    </div>
  `;
}

function buildQualityPage() {
  const cards = QUALITY_OPS.map((op, i) => {
    const card = blocOperation(op);
    if (i < QUALITY_OPS.length - 1) {
      return card + '<div class="arrow-link">▶</div>';
    }
    return card;
  }).join('');

  return `
    <div class="page">
      ${pageHeader('Chaîne Qualité — 5 opérations en cascade')}
      <div class="chain-title quality">
        <span>① CHAÎNE QUALITÉ</span>
        <span class="badge">5 opérations</span>
        <span class="badge">8 postes</span>
        <span class="badge">114 produits finis</span>
      </div>
      <div class="flow-horizontal">
        ${cards}
      </div>
      <div class="note">
        <strong>Poste annexe — Chiffons :</strong> conditionnement Coton Blanc / Coton Couleur en provenance d'OP.3 → Balles Chiffons (exutoires dédiés).
        Les postes R1 et R2 peuvent être doublés en cas de flux entrant élevé. Le poste Réu est doublé en haute saison.
      </div>
      ${pageFooter(2, 4)}
    </div>
  `;
}

function buildRecyclePage() {
  const card = blocOperation(RECYCLE_OPS[0]);
  return `
    <div class="page">
      ${pageHeader('Chaîne Recyclage Exclusif — 1 opération directe')}
      <div class="chain-title recycle">
        <span>② CHAÎNE RECYCLAGE EXCLUSIF</span>
        <span class="badge">1 opération</span>
        <span class="badge">2 postes (R3 + R4)</span>
        <span class="badge">5 sorties</span>
      </div>
      <div style="display:grid;grid-template-columns:280px 1fr;gap:10px;align-items:stretch">
        <div style="background:${COL.amberLight};border:2px solid ${COL.amber};border-radius:8px;padding:12px;display:flex;flex-direction:column;justify-content:center">
          <div style="font-size:11px;font-weight:700;color:${COL.amber};margin-bottom:6px">Pourquoi cette branche ?</div>
          <div style="font-size:9px;color:#78350F;line-height:1.5">
            Lorsque la matière entrante est de qualité insuffisante pour la chaîne Qualité (humidité, contamination, mélange CAV…), elle est dirigée directement vers cette chaîne courte qui ne produit que des sorties recyclage / valorisation matière.
            <br/><br/>
            <strong>Aucune sortie boutique ni VAK</strong> — uniquement CSR, effilochage et chiffons.
          </div>
        </div>
        <div class="flow-horizontal" style="display:block">
          ${card}
        </div>
      </div>
      ${pageFooter(3, 4)}
    </div>
  `;
}

function buildOutputsPage(exutoires) {
  const exHtml =
    exutoires && exutoires.length > 0
      ? exutoires.slice(0, 30).map((e) => `<span class="ex-pill">${e.nom}</span>`).join('') +
        (exutoires.length > 30 ? `<span class="ex-pill">+ ${exutoires.length - 30} autres</span>` : '')
      : ['Alunited', 'Eurofrip', 'Gebetex', 'Ecotri', 'Limbotex', 'So TOWT']
          .map((n) => `<span class="ex-pill">${n}</span>`)
          .join('');

  return `
    <div class="page">
      ${pageHeader('Sorties & débouchés — 37 destinations valorisées')}
      <div class="outputs-grid">
        <div class="output-box pf">
          <div class="ttl">Stock Produits Finis</div>
          <div class="item">114 produits finis</div>
          <div class="item">Catégorie Eco-organisme</div>
          <div class="item">Genre × Saison × Gamme</div>
          <div class="item">→ BTQ Standard / VAK / CHIF / Pvak</div>
        </div>
        <div class="output-box csr">
          <div class="ttl">Balles CSR</div>
          <div class="item">CSR Chaussures (OP.1, OP.2)</div>
          <div class="item">CSR (OP.3, OP.4)</div>
          <div class="item">CSR Recyclage Exclusif (R3/R4)</div>
          <div class="item">→ Combustible Solide de Récupération</div>
        </div>
        <div class="output-box effilo">
          <div class="ttl">Balles Effilochage</div>
          <div class="item">Jean (OP.3 + R3/R4)</div>
          <div class="item">Effilo (OP.3 + R3/R4)</div>
          <div class="item">→ Recyclage matière fibre</div>
        </div>
        <div class="output-box chiffon">
          <div class="ttl">Balles Chiffons</div>
          <div class="item">Coton Blanc (OP.3 → poste Chiffons)</div>
          <div class="item">Coton Couleur (OP.3 → poste Chiffons)</div>
          <div class="item">Chiffons R3/R4 (Recyclage Exclusif)</div>
          <div class="item">→ Industrie / nettoyage</div>
        </div>
        <div class="output-box original">
          <div class="ttl">Vente Original</div>
          <div class="item">Stock brut sans tri</div>
          <div class="item">→ Pesée Sortants</div>
          <div class="item">→ Export VAK direct</div>
        </div>
      </div>

      <div style="margin-top:10px">
        <h3 style="font-size:11px;font-weight:700;color:${COL.dark};margin-bottom:5px">Conteneurs de sortie</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${['Balles', 'Curons', 'Remorque', 'Sacs', 'Cartons']
            .map((c) => `<span style="background:white;border:1px solid ${COL.grayBorder};padding:3px 9px;border-radius:10px;font-size:9px;font-weight:600;color:#374151">${c}</span>`)
            .join('')}
        </div>
      </div>

      <div class="exutoires-list">
        <h4>Exutoires partenaires (extrait)</h4>
        ${exHtml}
      </div>

      <div style="margin-top:10px;padding:8px 10px;background:#F0FDF4;border:1px solid ${COL.greenLight};border-radius:6px;font-size:8.5px;color:#14532D">
        <strong>Reporting Refashion (DPAV trimestriel) :</strong> chaque sortie est tracée, pesée et déclarée à l'éco-organisme Refashion (filière REP textile).
        Les flux Stock PF, CSR, Effilochage et Chiffons alimentent le calcul des subventions de la métropole de Rouen.
      </div>
      ${pageFooter(4, 4)}
    </div>
  `;
}

/**
 * Lance l'export PDF (via fenêtre d'impression).
 * @param {object} ctx - Contexte de données
 * @param {object} ctx.fluxMois - Résumé production mensuel { total_entree_ligne_kg, total_entree_r3_kg, total_sortie_t }
 * @param {Array} ctx.exutoires - Liste des exutoires { nom }
 */
export function exportChaineTriPDF({ fluxMois = null, exutoires = [] } = {}) {
  const w = window.open('', '_blank', 'width=1200,height=900');
  if (!w) {
    alert('Popup bloquée — autorisez les popups pour exporter le PDF.');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <title>SOLIDATA — Chaîne de tri (PDF)</title>
  <style>${STYLES}</style>
</head>
<body>
  ${buildOverviewPage(fluxMois)}
  ${buildQualityPage()}
  ${buildRecyclePage()}
  ${buildOutputsPage(exutoires)}
</body>
</html>`;

  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}
