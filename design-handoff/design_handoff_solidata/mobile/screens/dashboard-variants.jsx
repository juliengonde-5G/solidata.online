// ============ 05 · DASHBOARD MANAGER MOBILE ============

// V1 — Cards empilées (lecture rapide)
window.DashCards = function() {
  return (
    <div className="mob-screen">
      <div style={{background:'white',padding:'20px 20px 14px',borderBottom:'1px solid var(--slate-100)'}}>
        <div style={{fontSize:13,color:'var(--slate-500)'}}>Jeudi 22 avril</div>
        <h1 style={{margin:'2px 0 0',fontSize:22,fontWeight:800,color:'var(--slate-900)'}}>Bonjour Julien 👋</h1>
      </div>
      <div className="mob-body" style={{padding:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          <div className="mob-card" style={{marginBottom:0,padding:14}}>
            <div className="simple-label">Tournées</div>
            <div className="huge-num" style={{fontSize:32}}>8</div>
            <div style={{fontSize:12,color:'var(--green-700)',marginTop:4,fontWeight:600}}>▲ +5%</div>
          </div>
          <div className="mob-card" style={{marginBottom:0,padding:14}}>
            <div className="simple-label">Stock MP</div>
            <div className="huge-num" style={{fontSize:32}}>2,3 <span style={{fontSize:16,color:'var(--slate-500)'}}>t</span></div>
            <div style={{fontSize:12,color:'var(--green-700)',marginTop:4,fontWeight:600}}>▲ +18%</div>
          </div>
          <div className="mob-card" style={{marginBottom:0,padding:14,background:'var(--teal-50)',borderColor:'var(--teal-200)'}}>
            <div className="simple-label" style={{color:'var(--teal-700)'}}>Candidats</div>
            <div className="huge-num" style={{fontSize:32,color:'var(--teal-800)'}}>24</div>
            <div style={{fontSize:12,color:'var(--teal-700)',marginTop:4,fontWeight:600}}>▲ +12%</div>
          </div>
          <div className="mob-card" style={{marginBottom:0,padding:14}}>
            <div className="simple-label">Marge</div>
            <div className="huge-num" style={{fontSize:32}}>27<span style={{fontSize:18,color:'var(--slate-500)'}}>%</span></div>
            <div style={{fontSize:12,color:'var(--green-700)',marginTop:4,fontWeight:600}}>▲ +14%</div>
          </div>
        </div>
        <div className="mob-card">
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <span style={{fontSize:20}}>⚠</span>
            <span style={{fontWeight:800,color:'var(--slate-900)'}}>Attention aujourd'hui</span>
          </div>
          <div style={{fontSize:13,color:'var(--slate-600)',marginBottom:12,lineHeight:1.5}}>Stock synthétique D2 à 85 kg · entretien Marie Durand 14h30</div>
          <button className="big-btn" style={{minHeight:48,fontSize:14}}>Voir les 3 priorités →</button>
        </div>
      </div>
      <TabBar active="tour"/>
    </div>
  );
};

// V2 — Story / stories (swipe horizontal)
window.DashStory = function() {
  return (
    <div className="mob-screen" style={{background:'#0F172A',color:'white'}}>
      <div style={{padding:'14px 16px 10px'}}>
        <div style={{display:'flex',gap:3,marginBottom:12}}>
          {Array.from({length:5}).map((_,i)=>(<div key={i} style={{flex:1,height:3,borderRadius:2,background:i===1?'white':i<1?'rgba(255,255,255,0.8)':'rgba(255,255,255,0.2)'}}/>))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div className="avo" style={{width:32,height:32,fontSize:12}}>JG</div>
          <div style={{flex:1,fontSize:13}}><b>Brief du jour</b> · 09:45</div>
          <button style={{background:'none',border:'none',color:'white',fontSize:22}}>×</button>
        </div>
      </div>
      <div className="mob-body" style={{padding:'40px 24px',display:'flex',flexDirection:'column',justifyContent:'center'}}>
        <div style={{fontSize:13,color:'#5EEAD4',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:14}}>Chiffre du jour</div>
        <div style={{fontSize:96,fontWeight:800,lineHeight:0.95,letterSpacing:'-0.03em'}}>94<span style={{fontSize:48,opacity:0.7}}>%</span></div>
        <div style={{fontSize:18,fontWeight:700,marginTop:14,marginBottom:12}}>Efficacité collecte</div>
        <div style={{fontSize:15,opacity:0.85,lineHeight:1.5}}>Meilleur résultat <b>depuis 6 mois</b>. Bravo à Marc L. et à l'équipe Rouen-Nord. 🎉</div>
        <div style={{marginTop:30,fontSize:13,opacity:0.6,display:'flex',alignItems:'center',gap:6}}>Touche pour continuer →</div>
      </div>
    </div>
  );
};

// V3 — 3 priorités max
window.DashPrio = function() {
  return (
    <div className="mob-screen">
      <div style={{background:'white',padding:'22px 20px',borderBottom:'1px solid var(--slate-100)'}}>
        <div style={{fontSize:13,color:'var(--slate-500)'}}>Jeudi 22 avril</div>
        <h1 style={{margin:'2px 0 0',fontSize:22,fontWeight:800,color:'var(--slate-900)'}}>3 choses à gérer</h1>
      </div>
      <div className="mob-body" style={{padding:16}}>
        {[
          { n:1, c:'var(--red-600)', bg:'var(--red-100)', t:'Stock critique', m:'Synthétique D2 · 85 kg', cta:'📞 Fournisseur' },
          { n:2, c:'var(--amber-700)', bg:'#FEF3C7', t:'Entretien Marie', m:'Aujourd\'hui 14h30', cta:'Préparer PCM' },
          { n:3, c:'var(--teal-700)', bg:'var(--teal-100)', t:'Valider retour', m:'Rouen-Nord · 112 kg', cta:'Valider ✓' },
        ].map((p,i)=>(
          <div key={i} style={{background:'white',border:'1px solid var(--slate-200)',borderRadius:18,padding:18,marginBottom:12,display:'flex',gap:14,alignItems:'center'}}>
            <div style={{width:52,height:52,borderRadius:16,background:p.bg,color:p.c,display:'grid',placeItems:'center',fontSize:24,fontWeight:800,flexShrink:0}}>{p.n}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:800,color:'var(--slate-900)'}}>{p.t}</div>
              <div style={{fontSize:13,color:'var(--slate-500)',marginTop:2,marginBottom:8}}>{p.m}</div>
              <button style={{background:p.c,color:'white',border:'none',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:700,minHeight:40}}>{p.cta} →</button>
            </div>
          </div>
        ))}
        <div style={{textAlign:'center',padding:'14px 0',fontSize:13,color:'var(--slate-500)'}}>Tu pourras voir le reste quand tu auras fini celles-ci.</div>
      </div>
      <TabBar active="tour"/>
    </div>
  );
};

// V4 — Graphiques gros (visuel à distance)
window.DashGraph = function() {
  const bars = [60,72,55,80,94,65,88];
  return (
    <div className="mob-screen">
      <div style={{background:'white',padding:'20px',borderBottom:'1px solid var(--slate-100)'}}>
        <h1 style={{margin:0,fontSize:22,fontWeight:800,color:'var(--slate-900)'}}>Performance</h1>
        <div style={{fontSize:13,color:'var(--slate-500)',marginTop:2}}>Semaine 17 · 7 jours</div>
      </div>
      <div className="mob-body" style={{padding:16}}>
        <div className="mob-card" style={{padding:20}}>
          <div style={{fontSize:13,color:'var(--slate-500)',fontWeight:600}}>Efficacité collecte</div>
          <div style={{display:'flex',alignItems:'baseline',gap:10}}>
            <div className="huge-num" style={{fontSize:52}}>94<span style={{fontSize:24,color:'var(--slate-500)'}}>%</span></div>
            <span className="chip chip-green" style={{fontSize:13}}>▲ +8 pts</span>
          </div>
          {/* bar chart */}
          <div style={{display:'flex',alignItems:'flex-end',gap:8,height:120,marginTop:20}}>
            {bars.map((h,i)=>(
              <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                <div style={{width:'100%',height:`${h}%`,background:`linear-gradient(180deg, var(--teal-400), var(--teal-600))`,borderRadius:'8px 8px 0 0'}}/>
                <div style={{fontSize:10,color:'var(--slate-500)',fontWeight:600}}>{['L','M','M','J','V','S','D'][i]}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mob-card" style={{padding:18}}>
          <div style={{fontSize:13,color:'var(--slate-500)',fontWeight:600,marginBottom:10}}>Marge nette · avril</div>
          {/* donut-ish */}
          <div style={{display:'flex',alignItems:'center',gap:18}}>
            <div style={{width:100,height:100,borderRadius:'50%',background:`conic-gradient(var(--teal-600) 0 ${27}%, var(--slate-200) 0)`,display:'grid',placeItems:'center',position:'relative'}}>
              <div style={{width:72,height:72,borderRadius:'50%',background:'white',display:'grid',placeItems:'center',fontSize:20,fontWeight:800,color:'var(--slate-900)'}}>27%</div>
            </div>
            <div>
              <div style={{fontSize:22,fontWeight:800,color:'var(--slate-900)'}}>22 800 €</div>
              <div style={{fontSize:13,color:'var(--green-700)',fontWeight:700}}>▲ +14% vs mars</div>
            </div>
          </div>
        </div>
      </div>
      <TabBar active="tour"/>
    </div>
  );
};
