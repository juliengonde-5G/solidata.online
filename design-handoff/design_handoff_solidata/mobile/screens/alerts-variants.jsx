// ============ 03 · ALERTES & VALIDATIONS ============

// V1 — Chronologie simple
window.AlertsChrono = function() {
  const items = [
    { icon:'⚠', c:'var(--red-600)', bg:'#FEE2E2', t:'Stock synthétique critique', m:'Dépôt 2 · 85 kg · sous seuil', time:'il y a 12 min', urgent:true },
    { icon:'📦', c:'var(--amber-700)', bg:'#FEF3C7', t:'Valider retour tournée', m:'Rouen-Nord · 112 kg · Marc L.', time:'il y a 34 min' },
    { icon:'👤', c:'var(--teal-700)', bg:'var(--teal-100)', t:'Marie a fini son test PCM', m:'Candidate · score 8.2 / 10', time:'il y a 1h' },
    { icon:'📞', c:'var(--blue-700)', bg:'var(--blue-100)', t:'Thomas Lefevre à rappeler', m:'Candidat · relance prévue', time:'ce matin' },
    { icon:'✓', c:'var(--green-700)', bg:'#D1FAE5', t:'Paie équipe validée', m:'Avril · 38 400 €', time:'hier' },
  ];
  return (
    <div className="mob-screen">
      <div style={{background:'white',padding:'16px 20px',borderBottom:'1px solid var(--slate-200)'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:10}}>
          <h1 style={{margin:0,fontSize:22,fontWeight:800,color:'var(--slate-900)'}}>Alertes</h1>
          <span style={{fontSize:13,color:'var(--slate-500)'}}>12 nouvelles</span>
        </div>
      </div>
      <div className="mob-body" style={{padding:12}}>
        {items.map((it,i)=>(
          <div key={i} style={{display:'flex',gap:14,padding:14,background:'white',border:'1px solid var(--slate-200)',borderRadius:14,marginBottom:8,minHeight:64,borderLeft:it.urgent?`4px solid ${it.c}`:'1px solid var(--slate-200)'}}>
            <div style={{width:44,height:44,borderRadius:12,background:it.bg,color:it.c,display:'grid',placeItems:'center',fontSize:22,flexShrink:0}}>{it.icon}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:15,fontWeight:700,color:'var(--slate-900)'}}>{it.t}</div>
              <div style={{fontSize:13,color:'var(--slate-600)',margin:'2px 0 4px'}}>{it.m}</div>
              <div style={{fontSize:11.5,color:'var(--slate-400)'}}>{it.time}</div>
            </div>
          </div>
        ))}
      </div>
      <TabBar active="alerts"/>
    </div>
  );
};

// V2 — Triées par urgence avec sections
window.AlertsUrgency = function() {
  return (
    <div className="mob-screen">
      <div style={{background:'white',padding:'16px 20px',borderBottom:'1px solid var(--slate-200)'}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:'var(--slate-900)'}}>Alertes</h1>
      </div>
      <div className="mob-body" style={{padding:12}}>
        <div style={{background:'var(--red-100)',color:'var(--red-700)',padding:'8px 14px',borderRadius:99,fontSize:12,fontWeight:800,display:'inline-flex',alignItems:'center',gap:6,margin:'4px 0 10px'}}>🔴 URGENT · 1</div>
        <div style={{background:'white',border:'2px solid var(--red-600)',borderRadius:16,padding:16,marginBottom:14}}>
          <div style={{fontSize:16,fontWeight:800,color:'var(--slate-900)'}}>Stock synthétique critique</div>
          <div style={{fontSize:13,color:'var(--slate-600)',margin:'4px 0 12px'}}>Dépôt 2 · 85 kg · sous seuil 100 kg</div>
          <button className="big-btn danger" style={{minHeight:52,fontSize:15}}>Traiter maintenant</button>
        </div>

        <div style={{background:'#FEF3C7',color:'var(--amber-700)',padding:'8px 14px',borderRadius:99,fontSize:12,fontWeight:800,display:'inline-flex',alignItems:'center',gap:6,margin:'14px 0 10px'}}>🟡 À VALIDER · 2</div>
        {[
          { t:'Retour tournée Rouen-Nord', m:'112 kg · Marc L. · 14h40' },
          { t:'Facture #2204', m:'12 400 € · Contrat Rouen' },
        ].map((it,i)=>(
          <div key={i} style={{background:'white',border:'1px solid var(--slate-200)',borderRadius:14,padding:14,marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:'var(--slate-900)'}}>{it.t}</div>
              <div style={{fontSize:12,color:'var(--slate-500)'}}>{it.m}</div>
            </div>
            <button style={{background:'var(--amber-700)',color:'white',padding:'10px 16px',borderRadius:10,fontSize:13,fontWeight:700,border:'none',minHeight:44}}>✓</button>
          </div>
        ))}

        <div style={{background:'var(--slate-100)',color:'var(--slate-600)',padding:'8px 14px',borderRadius:99,fontSize:12,fontWeight:800,display:'inline-flex',alignItems:'center',gap:6,margin:'14px 0 10px'}}>ℹ INFO · 4</div>
        {['Marie a fini son test PCM','Thomas à rappeler','Paie équipe validée'].map((t,i)=>(
          <div key={i} style={{background:'white',border:'1px solid var(--slate-200)',borderRadius:12,padding:12,marginBottom:6,fontSize:13,color:'var(--slate-700)'}}>{t}</div>
        ))}
      </div>
      <TabBar active="alerts"/>
    </div>
  );
};

// V3 — Swipe valider / rejeter
window.AlertsSwipe = function() {
  return (
    <div className="mob-screen">
      <div style={{background:'white',padding:'16px 20px',borderBottom:'1px solid var(--slate-200)'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:10}}>
          <h1 style={{margin:0,fontSize:22,fontWeight:800,color:'var(--slate-900)'}}>À valider</h1>
          <span style={{fontSize:13,color:'var(--slate-500)'}}>3 en attente</span>
        </div>
      </div>
      <div className="mob-body" style={{padding:14}}>
        {[
          { t:'Retour tournée Rouen-Nord', m:'Marc L. · 112 kg · 14h40', s:true },
          { t:'Facture fournisseur #2204', m:'12 400 € · Textiles Paris', s:false },
          { t:'Embauche Marie Durand', m:'CDI · Responsable collecte', s:false },
        ].map((it,i)=>(
          <div key={i} style={{position:'relative',marginBottom:14,borderRadius:16,overflow:'hidden'}}>
            {/* swipe hint backgrounds */}
            <div style={{position:'absolute',inset:0,display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0 20px',background:'linear-gradient(90deg, var(--red-600) 0%, var(--red-600) 30%, transparent 40%, transparent 60%, var(--green-600) 70%, var(--green-600))',color:'white',fontWeight:800}}>
              <span>✕ Rejeter</span>
              <span>Valider ✓</span>
            </div>
            <div style={{position:'relative',background:'white',border:'1px solid var(--slate-200)',borderRadius:16,padding:18,transform:i===0?'translateX(-8px)':'none',boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
              <div style={{fontSize:16,fontWeight:800,color:'var(--slate-900)'}}>{it.t}</div>
              <div style={{fontSize:13,color:'var(--slate-500)',marginTop:4}}>{it.m}</div>
              <div style={{fontSize:12,color:'var(--slate-400)',marginTop:10,display:'flex',alignItems:'center',gap:6}}>
                <span>←</span> Glisse pour rejeter · valider <span>→</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <TabBar active="alerts"/>
    </div>
  );
};

// V4 — Une seule alerte à la fois (focus max)
window.AlertsFocus = function() {
  return (
    <div className="mob-screen" style={{background:'var(--red-100)'}}>
      <div className="mob-body" style={{padding:24,display:'flex',flexDirection:'column'}}>
        <div style={{background:'var(--red-600)',color:'white',padding:'6px 14px',borderRadius:99,fontSize:12,fontWeight:800,display:'inline-flex',alignSelf:'flex-start',marginBottom:20}}>🔴 URGENT · 1 sur 1</div>
        <div style={{fontSize:100,textAlign:'center',margin:'20px 0'}}>⚠</div>
        <div style={{textAlign:'center'}}>
          <h1 style={{margin:'0 0 14px',fontSize:28,fontWeight:800,color:'var(--slate-900)',lineHeight:1.2}}>Stock synthétique<br/>critique</h1>
          <div style={{background:'white',borderRadius:18,padding:18,margin:'20px 0'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10}}>
              <span style={{fontSize:13,color:'var(--slate-500)',fontWeight:600}}>Stock actuel</span>
              <span style={{fontSize:32,fontWeight:800,color:'var(--red-700)'}}>85 kg</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
              <span style={{fontSize:13,color:'var(--slate-500)',fontWeight:600}}>Seuil minimum</span>
              <span style={{fontSize:22,fontWeight:800,color:'var(--slate-700)'}}>100 kg</span>
            </div>
            <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--slate-100)',fontSize:13,color:'var(--slate-600)',textAlign:'left'}}>📍 Dépôt 2 · depuis 2h · fournisseur : Textiles Paris</div>
          </div>
        </div>
      </div>
      <div style={{padding:18,background:'white',display:'flex',flexDirection:'column',gap:10}}>
        <button className="big-btn danger" style={{fontSize:17}}>📞 Appeler fournisseur</button>
        <button className="big-btn ghost">Voir toutes les alertes (11)</button>
      </div>
    </div>
  );
};
