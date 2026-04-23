// ============ 02 · MA TOURNÉE DU JOUR ============

// V1 — Liste verticale des points
window.TourneeList = function() {
  const pts = [
    { n:'Containerx 14 · Place Foch', s:'done', kg:'42 kg' },
    { n:'Resto social · Rue Verte', s:'done', kg:'28 kg' },
    { n:'Parking Carrefour', s:'current', kg:'~35 kg' },
    { n:'École St-Exupéry', s:'todo' },
    { n:'Containerx 22 · Av. République', s:'todo' },
    { n:'Retour dépôt Rouen', s:'todo' },
  ];
  return (
    <div className="mob-screen">
      <div style={{background:'var(--teal-600)',color:'white',padding:'18px 20px'}}>
        <div style={{fontSize:13,opacity:0.85}}>Tournée Rouen-Nord · 2/6 faits</div>
        <div style={{display:'flex',alignItems:'center',gap:10,marginTop:8}}>
          <div style={{flex:1,height:8,background:'rgba(255,255,255,0.25)',borderRadius:4,overflow:'hidden'}}>
            <div style={{width:'33%',height:'100%',background:'white',borderRadius:4}}/>
          </div>
          <span style={{fontWeight:800,fontSize:15}}>70 kg</span>
        </div>
      </div>
      <div className="mob-body" style={{padding:14}}>
        {pts.map((p,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:14,padding:'14px 12px',background:p.s==='current'?'var(--teal-50)':'white',border:p.s==='current'?'2px solid var(--teal-500)':'1px solid var(--slate-200)',borderRadius:14,marginBottom:8,minHeight:64}}>
            <div className={`step-circle ${p.s==='done'?'done':p.s==='current'?'current':''}`} style={{width:36,height:36,fontSize:14}}>
              {p.s==='done'?'✓':i+1}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:700,color:'var(--slate-900)',textDecoration:p.s==='done'?'line-through':'none',opacity:p.s==='done'?0.5:1}}>{p.n}</div>
              {p.kg && <div style={{fontSize:13,color:'var(--slate-500)'}}>{p.kg}</div>}
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:'12px 16px',background:'white',borderTop:'1px solid var(--slate-200)'}}>
        <button className="big-btn">✓ J'ai fini ce point</button>
      </div>
      <TabBar active="tour"/>
    </div>
  );
};

// V2 — Carte plein écran + sheet bas
window.TourneeMap = function() {
  return (
    <div className="mob-screen" style={{background:'#F5F5F4',position:'relative'}}>
      <div style={{flex:1,position:'relative',
        backgroundImage:'linear-gradient(var(--slate-200) 1px, transparent 1px), linear-gradient(90deg, var(--slate-200) 1px, transparent 1px), radial-gradient(circle at 40% 40%, rgba(204,251,241,0.5), transparent 50%)',
        backgroundSize:'32px 32px, 32px 32px, 100%'}}>
        {/* pins */}
        <div className="map-truck" style={{top:'40%',left:'35%'}}>🚚 Toi</div>
        <div style={{position:'absolute',top:'22%',left:'55%',background:'var(--green-600)',color:'white',padding:'5px 9px',borderRadius:99,fontSize:11,fontWeight:700}}>✓ 1</div>
        <div style={{position:'absolute',top:'30%',left:'25%',background:'var(--green-600)',color:'white',padding:'5px 9px',borderRadius:99,fontSize:11,fontWeight:700}}>✓ 2</div>
        <div style={{position:'absolute',top:'55%',left:'60%',background:'var(--amber-700)',color:'white',padding:'5px 9px',borderRadius:99,fontSize:11,fontWeight:700}}>4</div>
        <div style={{position:'absolute',top:'70%',left:'30%',background:'var(--slate-500)',color:'white',padding:'5px 9px',borderRadius:99,fontSize:11,fontWeight:700}}>5</div>
        {/* locate button */}
        <button style={{position:'absolute',right:14,top:14,width:48,height:48,borderRadius:12,background:'white',border:'1px solid var(--slate-200)',boxShadow:'0 2px 8px rgba(0,0,0,0.1)',fontSize:20}}>⌖</button>
      </div>
      {/* bottom sheet */}
      <div style={{background:'white',borderRadius:'20px 20px 0 0',padding:'16px 18px 8px',boxShadow:'0 -10px 30px rgba(0,0,0,0.1)'}}>
        <div style={{width:40,height:4,background:'var(--slate-300)',borderRadius:2,margin:'0 auto 12px'}}/>
        <div style={{fontSize:12,color:'var(--slate-500)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em'}}>Prochain point · 3/6</div>
        <div style={{fontSize:18,fontWeight:800,color:'var(--slate-900)',margin:'4px 0'}}>Parking Carrefour</div>
        <div style={{fontSize:13,color:'var(--slate-600)',marginBottom:14}}>📍 Av. de la Libération · 1,2 km · ~4 min</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <button className="big-btn ghost" style={{minHeight:56}}>📞 Appeler</button>
          <button className="big-btn" style={{minHeight:56}}>🧭 GPS</button>
        </div>
      </div>
      <TabBar active="tour"/>
    </div>
  );
};

// V3 — Une étape XXL à la fois (usage conduite)
window.TourneeStep = function() {
  return (
    <div className="mob-screen">
      <div style={{background:'var(--slate-900)',color:'white',padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:13,opacity:0.7}}>Point 3 / 8</span>
        <span style={{display:'flex',gap:4}}>{Array.from({length:8}).map((_,i)=>(<span key={i} style={{width:20,height:4,borderRadius:2,background:i<2?'var(--green-500)':i===2?'var(--teal-400)':'rgba(255,255,255,0.2)'}}/>))}</span>
      </div>
      <div className="mob-body" style={{padding:'30px 24px',textAlign:'center'}}>
        <div style={{fontSize:13,color:'var(--slate-500)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:10}}>Prochain arrêt</div>
        <div style={{fontSize:32,fontWeight:800,color:'var(--slate-900)',lineHeight:1.15,marginBottom:8,letterSpacing:'-0.02em'}}>Parking Carrefour</div>
        <div style={{fontSize:16,color:'var(--slate-600)',marginBottom:30}}>Av. de la Libération</div>
        <div style={{background:'var(--teal-50)',border:'2px solid var(--teal-200)',borderRadius:20,padding:24,marginBottom:20}}>
          <div style={{fontSize:13,color:'var(--teal-700)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>Distance</div>
          <div style={{fontSize:56,fontWeight:800,color:'var(--teal-800)',lineHeight:1,margin:'4px 0'}}>1,2 km</div>
          <div style={{fontSize:15,color:'var(--slate-600)'}}>≈ 4 minutes</div>
        </div>
        <div style={{fontSize:80,margin:'10px 0'}}>📦</div>
        <div style={{fontSize:15,color:'var(--slate-600)'}}>Conteneur <b>vert</b> · code d'accès <b>4287</b></div>
      </div>
      <div style={{padding:'14px 16px',background:'white',borderTop:'1px solid var(--slate-200)',display:'flex',gap:10}}>
        <button className="big-btn ghost" style={{flex:1,minHeight:64,fontSize:16}}>🧭 GPS</button>
        <button className="big-btn" style={{flex:2,minHeight:64,fontSize:18}}>Je suis arrivé ✓</button>
      </div>
    </div>
  );
};

// V4 — Voix + photo (arrivée au point, saisie minimale)
window.TourneeVoice = function() {
  return (
    <div className="mob-screen">
      <div style={{background:'var(--teal-700)',color:'white',padding:'16px 20px'}}>
        <div style={{fontSize:13,opacity:0.85}}>Arrivée au point</div>
        <div style={{fontSize:20,fontWeight:800,marginTop:2}}>Parking Carrefour</div>
      </div>
      <div className="mob-body" style={{padding:20}}>
        <div style={{fontSize:14,color:'var(--slate-500)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>1 · Prends une photo</div>
        <div style={{height:160,background:'var(--slate-100)',border:'2px dashed var(--slate-300)',borderRadius:16,display:'grid',placeItems:'center',marginBottom:20}}>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:48}}>📷</div>
            <div style={{fontSize:14,fontWeight:600,color:'var(--slate-600)',marginTop:6}}>Appuie pour photo du conteneur</div>
          </div>
        </div>

        <div style={{fontSize:14,color:'var(--slate-500)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>2 · Quel poids ?</div>
        <div style={{background:'white',border:'1px solid var(--slate-200)',borderRadius:16,padding:18,marginBottom:16,textAlign:'center'}}>
          <div style={{fontSize:56,fontWeight:800,color:'var(--slate-900)',lineHeight:1}}>42 <span style={{fontSize:24,color:'var(--slate-500)'}}>kg</span></div>
          <div style={{display:'flex',gap:8,marginTop:14,justifyContent:'center'}}>
            <button style={{minHeight:48,minWidth:72,borderRadius:12,background:'var(--slate-100)',fontSize:18,fontWeight:700}}>−</button>
            <button style={{minHeight:48,padding:'0 24px',borderRadius:12,background:'var(--teal-600)',color:'white',fontSize:16,fontWeight:700,display:'flex',alignItems:'center',gap:8}}>🎙 Dicter</button>
            <button style={{minHeight:48,minWidth:72,borderRadius:12,background:'var(--slate-100)',fontSize:18,fontWeight:700}}>+</button>
          </div>
        </div>

        <div className="note">💡 Tu peux dire « quarante-deux kilos » au micro</div>
      </div>
      <div style={{padding:14,background:'white',borderTop:'1px solid var(--slate-200)'}}>
        <button className="big-btn">✓ Valider ce point</button>
      </div>
    </div>
  );
};
