// ============ 01 · LOGIN / ACCUEIL ============

function TabBar({ active = 'tour' }) {
  const tabs = [
    { id: 'tour', l: 'Tournée', icon: '🚚' },
    { id: 'alerts', l: 'Alertes', icon: '🔔' },
    { id: 'profile', l: 'Moi', icon: '👤' },
  ];
  return (
    <div className="mob-tabbar">
      {tabs.map(t => (
        <div key={t.id} className={`mob-tab ${active===t.id?'active':''}`}>
          <span style={{fontSize:24}}>{t.icon}</span>
          <span>{t.l}</span>
        </div>
      ))}
    </div>
  );
}
window.TabBar = TabBar;

// V1 — PIN 4 chiffres (très simple, pas de clavier, gros numpad)
window.LoginPIN = function() {
  const pad = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="mob-screen" style={{background:'var(--teal-700)', color:'white', justifyContent:'space-between', padding:'50px 20px 30px'}}>
      <div style={{textAlign:'center', marginTop:30}}>
        <div style={{width:80,height:80,borderRadius:20,background:'white',color:'var(--teal-700)',margin:'0 auto 20px',display:'grid',placeItems:'center',fontSize:38,fontWeight:800,boxShadow:'0 8px 20px rgba(0,0,0,0.2)'}}>S</div>
        <h1 style={{margin:'0 0 6px',fontSize:24,fontWeight:800}}>Bonjour</h1>
        <p style={{margin:0,opacity:0.8,fontSize:15}}>Entre ton code à 4 chiffres</p>
      </div>
      <div style={{display:'flex',gap:14,justifyContent:'center',margin:'20px 0'}}>
        {[1,1,1,0].map((f,i)=>(
          <div key={i} style={{width:20,height:20,borderRadius:10,background:f?'white':'transparent',border:'2px solid white'}}/>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
        {pad.map((k,i)=>(
          <button key={i} style={{
            minHeight:64, fontSize:28, fontWeight:700,
            background: k==='' ? 'transparent' : 'rgba(255,255,255,0.15)',
            color:'white', border:'none', borderRadius:16,
            pointerEvents: k===''?'none':'auto'
          }}>{k}</button>
        ))}
      </div>
      <button style={{background:'transparent',color:'white',opacity:0.8,fontSize:14,textDecoration:'underline',padding:12,border:'none'}}>J'ai oublié mon code</button>
    </div>
  );
};

// V2 — Photo + nom (chauffeur sélectionne son avatar)
window.LoginPhoto = function() {
  const drivers = [
    { n:'Marc L.', c:'var(--teal-500)', a:'ML' },
    { n:'Karim B.', c:'#F59E0B', a:'KB' },
    { n:'Nora S.', c:'#8B5CF6', a:'NS' },
    { n:'Paul M.', c:'#EC4899', a:'PM' },
    { n:'Rémi T.', c:'#3B82F6', a:'RT' },
    { n:'Julie P.', c:'var(--teal-700)', a:'JP' },
  ];
  return (
    <div className="mob-screen" style={{background:'white'}}>
      <div style={{padding:'50px 24px 24px'}}>
        <h1 style={{margin:'0 0 6px',fontSize:26,fontWeight:800,color:'var(--slate-900)'}}>Qui es-tu ?</h1>
        <p style={{margin:0,color:'var(--slate-500)',fontSize:15}}>Appuie sur ta photo</p>
      </div>
      <div style={{flex:1,padding:'0 20px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,overflowY:'auto'}}>
        {drivers.map((d,i)=>(
          <div key={i} style={{background:'white',border:'2px solid var(--slate-200)',borderRadius:18,padding:'20px 12px',textAlign:'center',minHeight:130}}>
            <div style={{width:72,height:72,borderRadius:'50%',background:d.c,color:'white',margin:'0 auto 10px',display:'grid',placeItems:'center',fontSize:24,fontWeight:800}}>{d.a}</div>
            <div style={{fontSize:15,fontWeight:700,color:'var(--slate-900)'}}>{d.n}</div>
          </div>
        ))}
      </div>
      <div style={{padding:20}}>
        <button className="big-btn ghost" style={{minHeight:52}}>Je ne suis pas là</button>
      </div>
    </div>
  );
};

// V3 — QR badge (carte/badge à scanner, caméra plein écran)
window.LoginQR = function() {
  return (
    <div className="mob-screen" style={{background:'#000', color:'white'}}>
      <div style={{padding:'60px 24px 20px',textAlign:'center'}}>
        <h1 style={{margin:'0 0 6px',fontSize:24,fontWeight:800}}>Scanne ton badge</h1>
        <p style={{margin:0,opacity:0.7,fontSize:14}}>Approche-le de l'écran</p>
      </div>
      <div style={{flex:1,display:'grid',placeItems:'center',padding:'20px'}}>
        <div style={{
          width:260, height:260, borderRadius:28,
          border:'3px solid white',
          position:'relative',
          background:'linear-gradient(135deg, rgba(20,184,166,0.1), rgba(0,0,0,0.3))'
        }}>
          {/* corner brackets */}
          {[{t:-3,l:-3,b:'br',rot:0},{t:-3,r:-3,b:'bl',rot:90},{b:-3,r:-3,b2:'tl',rot:180},{b:-3,l:-3,b2:'tr',rot:270}].map((c,i)=>null)}
          {/* scan line */}
          <div style={{position:'absolute',top:'50%',left:20,right:20,height:2,background:'var(--teal-400)',boxShadow:'0 0 20px var(--teal-400)'}}/>
          <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',color:'rgba(255,255,255,0.3)',fontSize:54}}>⬛</div>
        </div>
      </div>
      <div style={{padding:'20px 24px 40px',textAlign:'center'}}>
        <button style={{background:'rgba(255,255,255,0.15)',color:'white',border:'1px solid rgba(255,255,255,0.3)',borderRadius:14,padding:'14px 28px',fontSize:15,fontWeight:600,minHeight:52}}>Je n'ai pas de badge</button>
      </div>
    </div>
  );
};

// V4 — Un seul bouton énorme (équipe fixe, simple tap)
window.LoginBig = function() {
  return (
    <div className="mob-screen" style={{background:'linear-gradient(180deg, var(--teal-600), var(--teal-800))', color:'white', justifyContent:'space-between', padding:'60px 30px 50px', textAlign:'center'}}>
      <div>
        <div style={{width:90,height:90,borderRadius:22,background:'white',color:'var(--teal-700)',margin:'0 auto 30px',display:'grid',placeItems:'center',fontSize:44,fontWeight:800}}>S</div>
        <h1 style={{margin:'0 0 10px',fontSize:32,fontWeight:800}}>Solidata</h1>
        <p style={{margin:0,opacity:0.9,fontSize:17}}>Camion <b>RN-47</b> · dépôt Rouen</p>
      </div>
      <div style={{fontSize:80}}>🚚</div>
      <div>
        <button style={{
          width:'100%', minHeight:80, borderRadius:24,
          background:'white', color:'var(--teal-700)',
          fontSize:22, fontWeight:800, border:'none',
          boxShadow:'0 10px 30px rgba(0,0,0,0.3)'
        }}>
          ▶ Démarrer ma tournée
        </button>
        <p style={{margin:'20px 0 0',opacity:0.7,fontSize:13}}>Marc Leduc · 14h40 prévu retour</p>
      </div>
    </div>
  );
};
