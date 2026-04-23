// ============ 04 · PCM MOBILE ============

// V1 — Pictos + audio (adaptation mobile du desktop)
window.PCMBasic = function() {
  return (
    <div className="mob-screen" style={{background:'white'}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid var(--slate-100)'}}>
        <div style={{display:'flex',gap:4,marginBottom:8}}>
          {Array.from({length:12}).map((_,i)=>(<div key={i} style={{flex:1,height:6,borderRadius:3,background:i<2?'var(--teal-500)':i===2?'var(--teal-400)':'var(--slate-200)'}}/>))}
        </div>
        <div style={{fontSize:12,color:'var(--slate-500)',textAlign:'center',fontWeight:600}}>Question 3 sur 12</div>
      </div>
      <div className="mob-body" style={{padding:'30px 20px',textAlign:'center',display:'flex',flexDirection:'column'}}>
        <button style={{alignSelf:'center',background:'var(--teal-50)',color:'var(--teal-700)',border:'2px solid var(--teal-200)',borderRadius:99,padding:'12px 22px',fontSize:15,fontWeight:700,minHeight:52,display:'inline-flex',alignItems:'center',gap:10,marginBottom:24}}>🔊 Écouter</button>
        <p className="pcm-m-question">Au travail,<br/>je me sens mieux…</p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
          <div className="pcm-m-choice">
            <span className="emoji">👥</span>
            <span className="lbl">avec les autres</span>
          </div>
          <div className="pcm-m-choice" style={{borderColor:'var(--teal-600)',background:'var(--teal-50)',boxShadow:'0 0 0 4px var(--teal-100)'}}>
            <span className="emoji">👤</span>
            <span className="lbl">tout seul</span>
          </div>
        </div>
        <p style={{fontSize:13,color:'var(--slate-500)'}}>Tu peux changer avant de passer</p>
      </div>
      <div style={{padding:16,display:'flex',gap:10,background:'white',borderTop:'1px solid var(--slate-100)'}}>
        <button className="big-btn ghost" style={{flex:1,minHeight:60,fontSize:15}}>← Retour</button>
        <button className="big-btn" style={{flex:2,minHeight:60,fontSize:16}}>Suivant →</button>
      </div>
    </div>
  );
};

// V2 — Slider d'intensité (de "tout seul" à "avec les autres")
window.PCMSlider = function() {
  return (
    <div className="mob-screen" style={{background:'white'}}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid var(--slate-100)'}}>
        <div style={{fontSize:12,color:'var(--slate-500)',textAlign:'center',fontWeight:600}}>Question 3 / 12</div>
      </div>
      <div className="mob-body" style={{padding:'30px 20px',textAlign:'center'}}>
        <button style={{background:'var(--teal-50)',color:'var(--teal-700)',border:'2px solid var(--teal-200)',borderRadius:99,padding:'10px 20px',fontSize:14,fontWeight:700,minHeight:48,display:'inline-flex',alignItems:'center',gap:8,marginBottom:20}}>🔊 Écouter</button>
        <p className="pcm-m-question">Au travail,<br/>je me sens mieux…</p>
        <div style={{display:'flex',justifyContent:'space-between',margin:'40px 0 14px'}}>
          <div style={{textAlign:'center'}}><div style={{fontSize:44}}>👤</div><div style={{fontSize:13,fontWeight:700,color:'var(--slate-700)'}}>tout seul</div></div>
          <div style={{textAlign:'center'}}><div style={{fontSize:44}}>👥</div><div style={{fontSize:13,fontWeight:700,color:'var(--slate-700)'}}>avec les autres</div></div>
        </div>
        <div style={{position:'relative',height:60,padding:'20px 0'}}>
          <div style={{height:8,background:'linear-gradient(90deg, #DBEAFE, var(--teal-300))',borderRadius:4}}/>
          <div style={{position:'absolute',top:8,left:'72%',transform:'translateX(-50%)',width:32,height:32,borderRadius:'50%',background:'white',border:'4px solid var(--teal-600)',boxShadow:'0 4px 10px rgba(0,0,0,0.15)'}}/>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--slate-400)',marginTop:4,padding:'0 4px'}}>
          <span>jamais</span><span>un peu</span><span>beaucoup</span><span>toujours</span>
        </div>
        <div style={{marginTop:30,background:'var(--teal-50)',padding:14,borderRadius:12,fontSize:14,color:'var(--teal-800)',fontWeight:600}}>Ta réponse : <b>plutôt avec les autres</b></div>
      </div>
      <div style={{padding:16,background:'white',borderTop:'1px solid var(--slate-100)'}}>
        <button className="big-btn">Suivant →</button>
      </div>
    </div>
  );
};

// V3 — Tout en audio (lecture + dictée)
window.PCMVoice = function() {
  return (
    <div className="mob-screen" style={{background:'linear-gradient(180deg, var(--teal-700), var(--teal-900))',color:'white'}}>
      <div style={{padding:'16px 20px'}}>
        <div style={{display:'flex',gap:4,marginBottom:8}}>
          {Array.from({length:12}).map((_,i)=>(<div key={i} style={{flex:1,height:4,borderRadius:2,background:i<2?'white':i===2?'rgba(255,255,255,0.6)':'rgba(255,255,255,0.2)'}}/>))}
        </div>
        <div style={{fontSize:12,opacity:0.8,textAlign:'center'}}>Question 3 sur 12 · test parlé</div>
      </div>
      <div className="mob-body" style={{padding:'20px',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
        <div style={{fontSize:14,opacity:0.85,marginBottom:14}}>Écoute la question puis parle</div>
        {/* waveform */}
        <div style={{display:'flex',gap:4,alignItems:'center',height:60,margin:'20px 0 30px'}}>
          {[14,28,42,56,38,22,44,60,48,20,32,46,30,18,26].map((h,i)=>(
            <div key={i} style={{width:5,height:h,background:'white',borderRadius:3,opacity:0.9}}/>
          ))}
        </div>
        <button style={{width:120,height:120,borderRadius:'50%',background:'white',color:'var(--teal-700)',border:'none',fontSize:52,boxShadow:'0 10px 30px rgba(0,0,0,0.25)',marginBottom:16}}>🎙</button>
        <div style={{fontSize:17,fontWeight:700,marginBottom:6}}>Appuie pour parler</div>
        <div style={{fontSize:13,opacity:0.7}}>Tu peux répondre en français ou dans ta langue</div>
      </div>
      <div style={{padding:16}}>
        <button style={{width:'100%',background:'rgba(255,255,255,0.15)',color:'white',border:'1px solid rgba(255,255,255,0.3)',borderRadius:14,padding:16,fontSize:15,fontWeight:700,minHeight:56}}>🔊 Réécouter la question</button>
      </div>
    </div>
  );
};

// V4 — Cartes swipe (Tinder-like)
window.PCMSwipe = function() {
  return (
    <div className="mob-screen" style={{background:'var(--slate-100)'}}>
      <div style={{padding:'16px 20px',background:'white',borderBottom:'1px solid var(--slate-200)'}}>
        <div style={{fontSize:12,color:'var(--slate-500)',fontWeight:600,textAlign:'center'}}>3 / 12</div>
      </div>
      <div className="mob-body" style={{padding:'24px 16px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
        {/* stacked cards */}
        <div style={{position:'relative',width:'100%',height:380}}>
          <div style={{position:'absolute',inset:0,top:12,left:12,right:12,background:'white',borderRadius:20,opacity:0.4,transform:'scale(0.95)'}}/>
          <div style={{position:'absolute',inset:0,top:6,left:6,right:6,background:'white',borderRadius:20,opacity:0.7,transform:'scale(0.97)'}}/>
          <div style={{position:'absolute',inset:0,background:'white',borderRadius:20,padding:24,boxShadow:'0 10px 30px rgba(0,0,0,0.1)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',transform:'rotate(-2deg)'}}>
            <div style={{fontSize:80,marginBottom:20}}>👥</div>
            <div style={{fontSize:20,fontWeight:800,color:'var(--slate-900)',marginBottom:14}}>Au travail, je me sens mieux avec les autres.</div>
            <button style={{background:'var(--teal-50)',color:'var(--teal-700)',border:'2px solid var(--teal-200)',borderRadius:99,padding:'8px 16px',fontSize:13,fontWeight:700}}>🔊 Écouter</button>
          </div>
        </div>
        <div style={{display:'flex',gap:20,marginTop:28}}>
          <button style={{width:68,height:68,borderRadius:'50%',background:'white',border:'2px solid var(--red-600)',color:'var(--red-600)',fontSize:28,fontWeight:800,boxShadow:'0 4px 12px rgba(0,0,0,0.08)'}}>✕</button>
          <button style={{width:68,height:68,borderRadius:'50%',background:'white',border:'2px solid var(--amber-700)',color:'var(--amber-700)',fontSize:22,boxShadow:'0 4px 12px rgba(0,0,0,0.08)'}}>~</button>
          <button style={{width:68,height:68,borderRadius:'50%',background:'var(--green-600)',border:'none',color:'white',fontSize:28,fontWeight:800,boxShadow:'0 4px 12px rgba(0,0,0,0.15)'}}>✓</button>
        </div>
        <div style={{display:'flex',gap:26,marginTop:10,fontSize:11,color:'var(--slate-500)',fontWeight:600}}>
          <span>non</span><span style={{marginLeft:8}}>parfois</span><span style={{marginLeft:14}}>oui</span>
        </div>
      </div>
    </div>
  );
};
