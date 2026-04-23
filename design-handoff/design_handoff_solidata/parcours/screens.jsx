// ============ PARCOURS CHAUFFEUR — 6 étapes ============
// 1. Login → 2. Tournée du jour → 3. Navigation → 4. Scan QR CAV
// 5. Remplissage CAV → 6. Pesée centre de tri

// ============ ÉTAPE 7 — DÉCLARATION D'INCIDENT ============
window.StepIncident = function({ onBack, onSubmit, context = 'tournée' }) {
  const [type, setType] = React.useState(null);
  const [severity, setSeverity] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [sent, setSent] = React.useState(false);

  const types = [
    { id:'cav-degradee', emoji:'🗑', label:'CAV dégradée', sub:'cassée, tag, dépôt sauvage' },
    { id:'cav-inaccessible', emoji:'🚧', label:'CAV inaccessible', sub:'bloquée, fermée, travaux' },
    { id:'cav-pleine', emoji:'⚠', label:'Débordement', sub:'sacs autour, dépôt extérieur' },
    { id:'vehicule', emoji:'🚚', label:'Problème véhicule', sub:'panne, accident, hayon' },
    { id:'securite', emoji:'🛡', label:'Sécurité', sub:'agression, menace, tension' },
    { id:'autre', emoji:'💬', label:'Autre', sub:'à préciser' },
  ];
  const sevs = [
    { id:'low',  label:'Peu grave',  color:'#10B981', desc:'signalement simple' },
    { id:'med',  label:'Gênant',     color:'#F59E0B', desc:'à traiter aujourd\'hui' },
    { id:'high', label:'Urgent',     color:'#DC2626', desc:'intervention immédiate' },
  ];

  const canSend = type && severity;

  if (sent) {
    return (
      <div className="mob-screen" style={{background:'linear-gradient(180deg, var(--teal-50), white)',justifyContent:'center',alignItems:'center',padding:30,textAlign:'center'}}>
        <div style={{width:110,height:110,borderRadius:'50%',background:'var(--teal-600)',color:'white',display:'grid',placeItems:'center',fontSize:56,marginBottom:24,boxShadow:'0 10px 30px rgba(13,148,136,0.3)'}}>✓</div>
        <h1 style={{margin:'0 0 10px',fontSize:26,fontWeight:800,color:'var(--slate-900)'}}>Incident envoyé</h1>
        <p style={{margin:'0 0 6px',fontSize:15,color:'var(--slate-600)',lineHeight:1.4}}>Ton manager a reçu l'alerte.<br/>Quelqu'un va te rappeler si besoin.</p>
        <div style={{background:'white',border:'1px solid var(--slate-200)',borderRadius:14,padding:'12px 16px',margin:'24px 0',fontSize:13,color:'var(--slate-600)'}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span>Numéro</span><b style={{color:'var(--slate-900)'}}>#INC-2042</b></div>
          <div style={{display:'flex',justifyContent:'space-between'}}><span>Envoyé</span><b style={{color:'var(--slate-900)'}}>à l'instant</b></div>
        </div>
        <button onClick={onBack} className="big-btn" style={{marginTop:10}}>Reprendre la tournée</button>
      </div>
    );
  }

  return (
    <div className="mob-screen" style={{background:'var(--slate-50)'}}>
      <div style={{background:'var(--red-600)',color:'white',padding:'52px 18px 14px',display:'flex',alignItems:'center',gap:10}}>
        <button onClick={onBack} style={{width:40,height:40,borderRadius:12,background:'rgba(255,255,255,0.2)',color:'white',border:'none',fontSize:20,cursor:'pointer'}}>←</button>
        <div style={{flex:1}}>
          <div style={{fontSize:11,opacity:0.85,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>⚠ Nouvel incident</div>
          <div style={{fontSize:17,fontWeight:800}}>Qu'est-ce qui se passe ?</div>
        </div>
      </div>

      <div className="mob-body" style={{padding:18}}>
        {/* context */}
        <div style={{background:'white',border:'1px solid var(--slate-200)',borderRadius:12,padding:'10px 12px',marginBottom:18,fontSize:12,color:'var(--slate-600)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>📍 Place Foch · CAV-014</span>
          <span style={{fontWeight:700,color:'var(--slate-900)'}}>09:14</span>
        </div>

        {/* type selection */}
        <div style={{fontSize:12,color:'var(--slate-500)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>1 · Type d'incident</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:24}}>
          {types.map(t=>{
            const sel = type?.id === t.id;
            return (
              <button key={t.id} onClick={()=>setType(t)} style={{
                minHeight:96,padding:'14px 10px',
                background: sel ? 'var(--slate-900)' : 'white',
                color: sel ? 'white' : 'var(--slate-800)',
                border: sel ? '2px solid var(--slate-900)' : '2px solid var(--slate-200)',
                borderRadius:14,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                gap:4,cursor:'pointer',fontFamily:'inherit',textAlign:'center'
              }}>
                <span style={{fontSize:30,lineHeight:1}}>{t.emoji}</span>
                <span style={{fontSize:14,fontWeight:800}}>{t.label}</span>
                <span style={{fontSize:10,opacity:sel?0.75:0.6,fontWeight:500,lineHeight:1.3}}>{t.sub}</span>
              </button>
            );
          })}
        </div>

        {/* severity */}
        <div style={{fontSize:12,color:'var(--slate-500)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>2 · Gravité</div>
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:24}}>
          {sevs.map(s=>{
            const sel = severity?.id === s.id;
            return (
              <button key={s.id} onClick={()=>setSeverity(s)} style={{
                minHeight:60,padding:'12px 14px',
                background: sel ? s.color : 'white',
                color: sel ? 'white' : 'var(--slate-800)',
                border: sel ? `2px solid ${s.color}` : '2px solid var(--slate-200)',
                borderRadius:14,display:'flex',alignItems:'center',gap:12,cursor:'pointer',fontFamily:'inherit',
                boxShadow: sel ? `0 4px 12px ${s.color}40` : 'none'
              }}>
                <div style={{width:14,height:14,borderRadius:'50%',background:sel?'white':s.color,flexShrink:0}}/>
                <div style={{flex:1,textAlign:'left'}}>
                  <div style={{fontSize:15,fontWeight:800}}>{s.label}</div>
                  <div style={{fontSize:12,opacity:sel?0.9:0.6,fontWeight:500}}>{s.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* photo + note */}
        <div style={{fontSize:12,color:'var(--slate-500)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>3 · Ajouter (optionnel)</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          <button style={{minHeight:80,background:'white',border:'2px dashed var(--slate-300)',borderRadius:14,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,cursor:'pointer',fontFamily:'inherit'}}>
            <span style={{fontSize:26}}>📷</span>
            <span style={{fontSize:13,fontWeight:700,color:'var(--slate-600)'}}>Photo</span>
          </button>
          <button style={{minHeight:80,background:'white',border:'2px dashed var(--slate-300)',borderRadius:14,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,cursor:'pointer',fontFamily:'inherit'}}>
            <span style={{fontSize:26}}>🎙</span>
            <span style={{fontSize:13,fontWeight:700,color:'var(--slate-600)'}}>Message vocal</span>
          </button>
        </div>
        <textarea
          value={note}
          onChange={e=>setNote(e.target.value)}
          placeholder="Écrire une note (facultatif)…"
          style={{
            width:'100%',minHeight:72,padding:14,
            background:'white',border:'2px solid var(--slate-200)',borderRadius:14,
            fontSize:14,fontFamily:'inherit',resize:'none',boxSizing:'border-box'
          }}
        />
      </div>

      <div style={{padding:14,background:'white',borderTop:'1px solid var(--slate-100)',display:'flex',gap:10}}>
        <button onClick={onBack} className="big-btn ghost" style={{flex:1,minHeight:60,fontSize:15}}>Annuler</button>
        <button
          onClick={()=>{setSent(true); onSubmit && onSubmit({type, severity, note});}}
          disabled={!canSend}
          className="big-btn danger"
          style={{flex:2,minHeight:60,fontSize:16,opacity:canSend?1:0.4,cursor:canSend?'pointer':'not-allowed'}}>
          🚨 Envoyer l'incident
        </button>
      </div>
    </div>
  );
};

// ============ ÉTAPE 2bis — CHECK-LIST DE DÉPART ============
window.StepChecklist = function({ onNext, onBack }) {
  const [checks, setChecks] = React.useState({});
  const items = [
    { id:'carburant', emoji:'⛽', label:'Carburant > 1/4', sub:'vérifier la jauge' },
    { id:'hayon', emoji:'🛗', label:'Hayon opérationnel', sub:'monte / descend sans à-coup' },
    { id:'pneus', emoji:'🛞', label:'Pneus & pression', sub:'visuel autour du camion' },
    { id:'feux', emoji:'💡', label:'Feux & clignotants', sub:'test rapide avant / arrière' },
    { id:'proprete', emoji:'🧽', label:'Benne propre', sub:'vide, sans résidu' },
    { id:'edp', emoji:'🦺', label:'Gilet + gants', sub:'EPI à portée' },
    { id:'tel', emoji:'📱', label:'Téléphone chargé', sub:'> 50% batterie' },
    { id:'badge', emoji:'🆔', label:'Badge & clés CAV', sub:'présents dans la cabine' },
  ];
  const toggle = (id) => setChecks(c => ({...c, [id]: !c[id]}));
  const doneCount = Object.values(checks).filter(Boolean).length;
  const allDone = doneCount === items.length;

  return (
    <div className="mob-screen" style={{background:'var(--slate-50)'}}>
      <div style={{background:'var(--teal-700)',color:'white',padding:'52px 18px 16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
          <button onClick={onBack} style={{width:40,height:40,borderRadius:12,background:'rgba(255,255,255,0.2)',color:'white',border:'none',fontSize:20,cursor:'pointer'}}>←</button>
          <div style={{flex:1}}>
            <div style={{fontSize:11,opacity:0.85,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Avant le départ</div>
            <div style={{fontSize:18,fontWeight:800}}>Vérifications camion</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,marginTop:6}}>
          <div style={{flex:1,height:8,background:'rgba(255,255,255,0.25)',borderRadius:4,overflow:'hidden'}}>
            <div style={{width:`${(doneCount/items.length)*100}%`,height:'100%',background:'white',borderRadius:4,transition:'width .25s'}}/>
          </div>
          <span style={{fontSize:14,fontWeight:800}}>{doneCount}/{items.length}</span>
        </div>
      </div>

      <div className="mob-body" style={{padding:14}}>
        {items.map((it,i)=>{
          const ok = !!checks[it.id];
          return (
            <button key={it.id} onClick={()=>toggle(it.id)} style={{
              width:'100%',display:'flex',alignItems:'center',gap:14,
              padding:'14px 14px',minHeight:72,
              background: ok ? 'white' : 'white',
              border: ok ? '2px solid var(--teal-500)' : '1px solid var(--slate-200)',
              borderRadius:14,marginBottom:10,cursor:'pointer',fontFamily:'inherit',textAlign:'left'
            }}>
              <div style={{width:36,height:36,borderRadius:10,background:ok?'var(--teal-50)':'var(--slate-100)',display:'grid',placeItems:'center',fontSize:20,flexShrink:0}}>{it.emoji}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:15,fontWeight:700,color:'var(--slate-900)'}}>{it.label}</div>
                <div style={{fontSize:12,color:'var(--slate-500)',marginTop:2}}>{it.sub}</div>
              </div>
              <div style={{
                width:36,height:36,borderRadius:10,flexShrink:0,
                background: ok ? 'var(--teal-600)' : 'white',
                border: ok ? '2px solid var(--teal-600)' : '2px solid var(--slate-300)',
                display:'grid',placeItems:'center',color:'white',fontSize:20,fontWeight:800
              }}>{ok ? '✓' : ''}</div>
            </button>
          );
        })}
        <button style={{width:'100%',minHeight:52,background:'white',border:'2px dashed var(--slate-300)',borderRadius:12,padding:'12px 14px',fontSize:13,fontWeight:700,color:'var(--slate-600)',cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:6}}>
          <span style={{fontSize:18}}>📷</span> Photo du camion (optionnel)
        </button>
      </div>

      <div style={{padding:14,background:'white',borderTop:'1px solid var(--slate-100)'}}>
        <button onClick={onNext} disabled={!allDone} className="big-btn" style={{opacity:allDone?1:0.4,cursor:allDone?'pointer':'not-allowed'}}>
          {allDone ? '▶ Démarrer la navigation' : `Coche les ${items.length - doneCount} derniers points`}
        </button>
      </div>
    </div>
  );
};

// ============ ÉTAPE 1 — CONNEXION ============
window.StepLogin = function({ onNext }) {
  return (
    <div className="mob-screen" style={{background:'linear-gradient(180deg, var(--teal-600), var(--teal-800))', color:'white', justifyContent:'space-between', padding:'60px 30px 50px', textAlign:'center'}}>
      <div>
        <div style={{width:90,height:90,borderRadius:22,background:'white',color:'var(--teal-700)',margin:'0 auto 30px',display:'grid',placeItems:'center',fontSize:44,fontWeight:800}}>S</div>
        <h1 style={{margin:'0 0 10px',fontSize:32,fontWeight:800}}>Solidata</h1>
        <p style={{margin:0,opacity:0.9,fontSize:17}}>Camion <b>RN-47</b> · dépôt Rouen</p>
      </div>
      <div style={{fontSize:90}}>🚚</div>
      <div>
        <button onClick={onNext} style={{
          width:'100%', minHeight:84, borderRadius:24,
          background:'white', color:'var(--teal-700)',
          fontSize:22, fontWeight:800, border:'none',
          boxShadow:'0 10px 30px rgba(0,0,0,0.3)',
          cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',gap:12
        }}>
          ▶ Démarrer ma tournée
        </button>
        <p style={{margin:'20px 0 0',opacity:0.75,fontSize:13}}>Marc Leduc · retour prévu 14h40</p>
      </div>
    </div>
  );
};

// ============ ÉTAPE 2 — JOURNÉE DE COLLECTE ============
window.StepJournee = function({ onNext, onBack }) {
  const points = [
    { n:1, title:'Place Foch', sub:'CAV-014 · 1,2 km', state:'todo' },
    { n:2, title:'Parking Carrefour', sub:'CAV-022 · 3,4 km', state:'todo' },
    { n:3, title:'École St-Exupéry', sub:'CAV-031 · 5,1 km', state:'todo' },
    { n:4, title:'Av. République', sub:'CAV-022 · 7,8 km', state:'todo' },
    { n:5, title:'Gare SNCF', sub:'CAV-045 · 9,2 km', state:'todo' },
    { n:6, title:'Retour dépôt Rouen', sub:'centre de tri · 14 km', state:'todo', depot:true },
  ];
  return (
    <div className="mob-screen" style={{background:'#F5F5F4',position:'relative'}}>
      {/* top bar on map */}
      <div style={{position:'absolute',top:0,left:0,right:0,zIndex:10,padding:'50px 16px 14px',display:'flex',alignItems:'center',gap:10,background:'linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0))'}}>
        <button onClick={onBack} className="mob-top-back" style={{background:'white',boxShadow:'0 2px 8px rgba(0,0,0,0.08)'}}>←</button>
        <div style={{flex:1,background:'white',borderRadius:14,padding:'8px 14px',boxShadow:'0 2px 8px rgba(0,0,0,0.08)'}}>
          <div style={{fontSize:11,color:'var(--slate-500)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Tournée Rouen-Nord</div>
          <div style={{fontSize:14,fontWeight:700,color:'var(--slate-900)'}}>6 points · 14 km · ~3h20</div>
        </div>
      </div>

      {/* map */}
      <div style={{flex:1,position:'relative',
        backgroundImage:'linear-gradient(var(--slate-200) 1px, transparent 1px), linear-gradient(90deg, var(--slate-200) 1px, transparent 1px), radial-gradient(circle at 40% 40%, rgba(204,251,241,0.5), transparent 50%)',
        backgroundSize:'32px 32px, 32px 32px, 100%'}}>
        {/* route polyline (fake) */}
        <svg viewBox="0 0 380 600" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
          <path d="M 130 500 Q 180 440, 220 400 T 260 300 Q 280 250, 230 200 T 280 120" stroke="var(--teal-500)" strokeWidth="4" fill="none" strokeDasharray="8 6" strokeLinecap="round"/>
        </svg>
        <div style={{position:'absolute',top:'72%',left:'30%',background:'var(--teal-600)',color:'white',padding:'6px 10px',borderRadius:99,fontSize:12,fontWeight:700,display:'flex',alignItems:'center',gap:6,boxShadow:'0 4px 10px rgba(0,0,0,0.25)'}}>🚚 Départ</div>
        {[{t:'55%',l:'52%',n:1},{t:'45%',l:'58%',n:2},{t:'33%',l:'47%',n:3},{t:'25%',l:'60%',n:4},{t:'15%',l:'67%',n:5}].map(p=>(
          <div key={p.n} style={{position:'absolute',top:p.t,left:p.l,background:'white',border:'2px solid var(--slate-900)',color:'var(--slate-900)',width:28,height:28,borderRadius:'50%',display:'grid',placeItems:'center',fontSize:12,fontWeight:800,boxShadow:'0 2px 6px rgba(0,0,0,0.15)'}}>{p.n}</div>
        ))}
        <div style={{position:'absolute',top:'8%',left:'75%',background:'var(--amber-700)',color:'white',padding:'6px 10px',borderRadius:8,fontSize:11,fontWeight:700,display:'flex',alignItems:'center',gap:4}}>🏭 Tri</div>
      </div>

      {/* bottom sheet */}
      <div style={{background:'white',borderRadius:'22px 22px 0 0',padding:'16px 16px 12px',boxShadow:'0 -10px 30px rgba(0,0,0,0.1)',maxHeight:'48%',display:'flex',flexDirection:'column'}}>
        <div style={{width:40,height:4,background:'var(--slate-300)',borderRadius:2,margin:'0 auto 12px'}}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10}}>
          <div style={{fontSize:15,fontWeight:800,color:'var(--slate-900)'}}>Aujourd'hui · 6 points</div>
          <div style={{fontSize:12,color:'var(--slate-500)'}}>0 / 6 faits</div>
        </div>
        <div style={{flex:1,overflowY:'auto',marginBottom:10}}>
          {points.map((p,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 2px',borderBottom:i<points.length-1?'1px solid var(--slate-100)':'none'}}>
              <div style={{width:28,height:28,borderRadius:'50%',background:p.depot?'var(--amber-100)':'var(--slate-100)',color:p.depot?'var(--amber-700)':'var(--slate-700)',display:'grid',placeItems:'center',fontSize:13,fontWeight:800,flexShrink:0}}>{p.depot?'🏭':p.n}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:700,color:'var(--slate-900)'}}>{p.title}</div>
                <div style={{fontSize:12,color:'var(--slate-500)'}}>{p.sub}</div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onNext} className="big-btn">▶ Commencer la tournée</button>
      </div>
    </div>
  );
};

// ============ ÉTAPE 3 — NAVIGATION LIVE ============
window.StepNavigation = function({ onNext, onBack, onIncident, rerouted, toTri = false }) {
  return (
    <div className="mob-screen" style={{background:'#E8F0F7',position:'relative'}}>
      {/* map background with route */}
      <div style={{position:'absolute',inset:0,
        backgroundImage:'linear-gradient(rgba(148,163,184,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.15) 1px, transparent 1px), radial-gradient(circle at 50% 40%, #D6E9F5, #C5DDEE)',
        backgroundSize:'40px 40px, 40px 40px, 100%'}}>
        <svg viewBox="0 0 380 800" style={{position:'absolute',inset:0,width:'100%',height:'100%'}}>
          {/* active route */}
          <path d="M 190 700 L 190 500 Q 190 420, 240 380 T 250 200" stroke="var(--teal-600)" strokeWidth="10" fill="none" strokeLinecap="round"/>
          <path d="M 190 700 L 190 500 Q 190 420, 240 380 T 250 200" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="0 14"/>
          {/* alt route dimmed */}
          <path d="M 190 700 L 120 600 Q 80 500, 150 400 T 250 200" stroke="rgba(148,163,184,0.5)" strokeWidth="6" fill="none" strokeLinecap="round"/>
          {/* traffic segments */}
          <path d="M 220 430 Q 240 400, 250 360" stroke="#F59E0B" strokeWidth="10" fill="none" strokeLinecap="round"/>
          <path d="M 250 300 Q 250 240, 250 200" stroke="#DC2626" strokeWidth="10" fill="none" strokeLinecap="round"/>
        </svg>
        {/* destination pin */}
        <div style={{position:'absolute',top:'22%',left:'62%',background: toTri ? 'var(--amber-700)' : 'var(--slate-900)',color:'white',padding:'8px 14px',borderRadius:12,fontSize:12,fontWeight:700,boxShadow:'0 4px 12px rgba(0,0,0,0.25)'}}>
          <div style={{fontSize:10,opacity:0.8}}>{toTri ? '🏭 CENTRE DE TRI' : 'POINT 1'}</div>
          {toTri ? 'Rouen-Quevilly' : 'Place Foch'}
        </div>
        {/* user dot */}
        <div style={{position:'absolute',top:'84%',left:'48%',width:24,height:24,borderRadius:'50%',background:'var(--teal-500)',border:'3px solid white',boxShadow:'0 0 0 6px rgba(20,184,166,0.3), 0 4px 12px rgba(0,0,0,0.25)'}}/>
      </div>

      {/* top: back + current instruction */}
      <div style={{position:'relative',zIndex:10,padding:'52px 14px 0'}}>
        <div style={{display:'flex',alignItems:'stretch',gap:10}}>
          <button onClick={onBack} className="mob-top-back" style={{background:'white',boxShadow:'0 4px 12px rgba(0,0,0,0.1)',height:64,width:56}}>←</button>
          <div style={{flex:1,background: toTri ? 'var(--amber-700)' : 'var(--slate-900)',color:'white',borderRadius:16,padding:'12px 16px',boxShadow:'0 4px 16px rgba(0,0,0,0.2)',display:'flex',alignItems:'center',gap:14}}>
            <div style={{fontSize:42,lineHeight:1,fontWeight:800}}>{toTri ? '↱' : '↰'}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:22,fontWeight:800,letterSpacing:'-0.01em',lineHeight:1.1}}>{toTri ? 'Dans 800 m' : 'Dans 300 m'}</div>
              <div style={{fontSize:13,opacity:0.85,marginTop:2}}>{toTri ? 'Prends la D18 vers Quevilly' : "Tourne à gauche · rue Jeanne d'Arc"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* reroute notification */}
      {rerouted && (
        <div style={{position:'relative',zIndex:10,padding:'10px 14px 0'}}>
          <div style={{background:'#FEF3C7',border:'1px solid #FCD34D',borderRadius:14,padding:'10px 14px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 4px 12px rgba(245,158,11,0.2)',animation:'fadeIn 0.3s ease'}}>
            <div style={{fontSize:22}}>🔄</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:800,color:'#78350F'}}>Itinéraire recalculé</div>
              <div style={{fontSize:12,color:'#92400E'}}>Bouchon rue de la République · +4 min</div>
            </div>
          </div>
        </div>
      )}

      {/* bottom: ETA + actions */}
      <div style={{marginTop:'auto',position:'relative',zIndex:10,padding:14,display:'flex',flexDirection:'column',gap:10}}>
        {/* incident bar */}
        <button onClick={onIncident} style={{
          background:'white',border:'2px solid var(--red-200)',color:'var(--red-700)',
          borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',gap:12,
          fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:60,
          boxShadow:'0 4px 12px rgba(0,0,0,0.06)'
        }}>
          <span style={{fontSize:24}}>⚠</span>
          <span style={{flex:1,textAlign:'left'}}>Déclarer un incident</span>
          <span>→</span>
        </button>

        {/* eta card */}
        <div style={{background:'white',borderRadius:18,padding:16,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',display:'flex',alignItems:'center',gap:14}}>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:4}}>
              <div style={{fontSize:28,fontWeight:800,color:'var(--slate-900)',letterSpacing:'-0.02em'}}>{toTri ? '12 min' : '4 min'}</div>
              <div style={{fontSize:14,color:'var(--slate-500)'}}>· {toTri ? '7,4 km' : '1,2 km'}</div>
            </div>
            <div style={{fontSize:13,color:'var(--slate-600)'}}>Arrivée <b>{toTri ? '11:42' : '09:18'}</b> · {toTri ? 'Centre de tri' : 'Place Foch'}</div>
          </div>
          <button onClick={onNext} style={{
            background: toTri ? 'var(--amber-700)' : 'var(--teal-600)',color:'white',border:'none',
            borderRadius:14,padding:'14px 18px',fontSize:14,fontWeight:800,
            cursor:'pointer',minHeight:56,fontFamily:'inherit',
            display:'flex',flexDirection:'column',alignItems:'center',gap:2
          }}>
            <span style={{fontSize:11,opacity:0.9,fontWeight:600}}>arrivé</span>
            <span>{toTri ? 'Au centre ✓' : 'Je suis là ✓'}</span>
          </button>
        </div>
      </div>
      <style>{`@keyframes fadeIn { from {opacity:0; transform: translateY(-8px);} to {opacity:1; transform: translateY(0);}}`}</style>
    </div>
  );
};

// ============ ÉTAPE 4 — SCAN QR CAV ============
window.StepScan = function({ onNext, onBack }) {
  const [scanned, setScanned] = React.useState(false);
  React.useEffect(()=>{
    const t = setTimeout(()=>setScanned(true), 2200);
    return ()=>clearTimeout(t);
  },[]);
  return (
    <div className="mob-screen" style={{background:'#000', color:'white'}}>
      <div style={{padding:'50px 14px 14px',display:'flex',alignItems:'center',gap:10,position:'relative',zIndex:10}}>
        <button onClick={onBack} className="mob-top-back" style={{background:'rgba(255,255,255,0.15)',color:'white',border:'1px solid rgba(255,255,255,0.25)'}}>←</button>
        <div style={{flex:1}}>
          <div style={{fontSize:11,opacity:0.7,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em'}}>Point 1 / 6</div>
          <div style={{fontSize:16,fontWeight:700}}>Place Foch</div>
        </div>
      </div>
      <div style={{padding:'20px 24px 10px',textAlign:'center'}}>
        <h1 style={{margin:'0 0 4px',fontSize:22,fontWeight:800}}>Scanne la CAV</h1>
        <p style={{margin:0,opacity:0.7,fontSize:13}}>Approche le QR code du conteneur</p>
      </div>
      <div style={{flex:1,display:'grid',placeItems:'center',padding:'10px 20px'}}>
        <div style={{
          width:250, height:250, borderRadius:28,
          position:'relative',
          background: scanned ? 'rgba(20,184,166,0.15)' : 'rgba(255,255,255,0.04)',
          border: scanned ? '3px solid var(--teal-400)' : '3px solid rgba(255,255,255,0.4)',
          transition:'all .3s'
        }}>
          {/* corner brackets */}
          {[[0,0,'0 0 0 3px','0 0 0 3px'],[0,'auto','auto 0 0 3px','auto 0 0 3px']].map(()=>null)}
          {['tl','tr','bl','br'].map(pos=>{
            const s = { position:'absolute', width:30, height:30, borderColor:scanned?'var(--teal-400)':'white', borderStyle:'solid', borderWidth:0 };
            if (pos==='tl') { s.top=-3; s.left=-3; s.borderTopWidth=5; s.borderLeftWidth=5; s.borderTopLeftRadius=16; }
            if (pos==='tr') { s.top=-3; s.right=-3; s.borderTopWidth=5; s.borderRightWidth=5; s.borderTopRightRadius=16; }
            if (pos==='bl') { s.bottom=-3; s.left=-3; s.borderBottomWidth=5; s.borderLeftWidth=5; s.borderBottomLeftRadius=16; }
            if (pos==='br') { s.bottom=-3; s.right=-3; s.borderBottomWidth=5; s.borderRightWidth=5; s.borderBottomRightRadius=16; }
            return <div key={pos} style={s}/>;
          })}
          {!scanned && <div style={{position:'absolute',top:'50%',left:20,right:20,height:2,background:'var(--teal-400)',boxShadow:'0 0 20px var(--teal-400)',animation:'scanLine 2s ease-in-out infinite'}}/>}
          {/* QR icon */}
          <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',fontSize:70,opacity:scanned?1:0.25,transition:'opacity .3s'}}>
            {scanned ? '✓' : '⬛'}
          </div>
        </div>
        <div style={{marginTop:24,textAlign:'center',minHeight:60}}>
          {scanned ? (
            <>
              <div style={{fontSize:12,color:'var(--teal-300)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em'}}>CAV détectée</div>
              <div style={{fontSize:20,fontWeight:800,marginTop:4}}>CAV-014 · Place Foch</div>
              <div style={{fontSize:13,opacity:0.7,marginTop:4}}>Contrat Rouen-Nord · textile</div>
            </>
          ) : (
            <div style={{fontSize:14,opacity:0.6}}>Recherche du QR code…</div>
          )}
        </div>
      </div>
      <div style={{padding:'14px 16px 20px',display:'flex',flexDirection:'column',gap:10}}>
        <button
          onClick={onNext}
          disabled={!scanned}
          style={{
            background: scanned ? 'white' : 'rgba(255,255,255,0.15)',
            color: scanned ? 'var(--slate-900)' : 'rgba(255,255,255,0.5)',
            border:'none',borderRadius:16,padding:'18px 22px',fontSize:18,fontWeight:800,
            minHeight:64,cursor:scanned?'pointer':'not-allowed',fontFamily:'inherit',
            transition:'all .2s'
          }}>
          Continuer →
        </button>
        <div style={{display:'flex',gap:10}}>
          <button style={{flex:1,background:'rgba(255,255,255,0.1)',color:'white',border:'1px solid rgba(255,255,255,0.25)',borderRadius:14,padding:'12px 14px',fontSize:13,fontWeight:600,minHeight:52,cursor:'pointer',fontFamily:'inherit'}}>⌨ Saisir le code</button>
          <button onClick={onNext} style={{flex:1,background:'rgba(220,38,38,0.2)',color:'#FCA5A5',border:'1px solid rgba(220,38,38,0.4)',borderRadius:14,padding:'12px 14px',fontSize:13,fontWeight:700,minHeight:52,cursor:'pointer',fontFamily:'inherit'}}>⚠ QR indisponible</button>
        </div>
      </div>
      <style>{`@keyframes scanLine { 0%,100% { transform: translateY(-80px); } 50% { transform: translateY(80px); }}`}</style>
    </div>
  );
};

// ============ ÉTAPE 5 — REMPLISSAGE CAV ============
window.StepRemplissage = function({ onNext, onBack, onIncident, onTruckFull }) {
  const [fill, setFill] = React.useState(null);
  const levels = [
    { v:0,    label:'vide',      emoji:'🟦', color:'#E2E8F0', text:'var(--slate-700)' },
    { v:25,   label:'un peu',    emoji:'🟩', color:'#BBF7D0', text:'#166534' },
    { v:50,   label:'à moitié',  emoji:'🟨', color:'#FEF08A', text:'#854D0E' },
    { v:75,   label:'presque plein', emoji:'🟧', color:'#FED7AA', text:'#9A3412' },
    { v:100,  label:'plein',     emoji:'🟥', color:'#FECACA', text:'#991B1B' },
    { v:'++', label:'au-delà',   emoji:'⚠',  color:'#450A0A', text:'white' },
  ];

  return (
    <div className="mob-screen" style={{background:'white'}}>
      <div className="mob-top" style={{paddingTop:50}}>
        <button onClick={onBack} className="mob-top-back">←</button>
        <div style={{flex:1}}>
          <div style={{fontSize:11,color:'var(--slate-500)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>CAV-014 · Point 1/6</div>
          <h2 style={{fontSize:16,margin:0,fontWeight:800,color:'var(--slate-900)'}}>Place Foch</h2>
        </div>
        <div style={{background:'var(--teal-50)',color:'var(--teal-700)',padding:'4px 10px',borderRadius:99,fontSize:11,fontWeight:700}}>✓ scannée</div>
      </div>

      <div className="mob-body" style={{padding:20}}>
        {/* fill level */}
        <div style={{fontSize:12,color:'var(--slate-500)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Niveau de remplissage</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
          {levels.map((l)=>{
            const sel = fill?.v === l.v;
            const isPlus = l.v === '++';
            // visual container icon: a box with fill from bottom
            const pct = isPlus ? 100 : l.v;
            const fillColor = isPlus ? '#7F1D1D' : (l.v===0 ? 'var(--slate-200)' : l.v<=25 ? '#86EFAC' : l.v<=50 ? '#FDE047' : l.v<=75 ? '#FB923C' : '#EF4444');
            return (
              <button key={l.v}
                onClick={()=>setFill(l)}
                style={{
                  minHeight:120,padding:'12px 6px',
                  background: sel ? (isPlus?'#450A0A':l.color) : 'white',
                  color: sel ? l.text : 'var(--slate-800)',
                  border: sel ? `3px solid ${isPlus?'#450A0A':'var(--slate-900)'}` : '2px solid var(--slate-200)',
                  borderRadius:14,
                  fontFamily:'inherit',cursor:'pointer',
                  display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,
                  boxShadow: sel ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
                  transition:'all .15s'
                }}>
                {/* container icon */}
                <svg width="40" height="46" viewBox="0 0 40 46" style={{flexShrink:0}}>
                  {/* lid */}
                  <rect x="4" y="2" width="32" height="5" rx="1.5" fill={sel && !isPlus ? 'currentColor' : 'var(--slate-400)'} opacity={isPlus?0.4:1}/>
                  {/* body outline */}
                  <rect x="6" y="8" width="28" height="36" rx="2" fill="none" stroke={sel ? 'currentColor' : 'var(--slate-400)'} strokeWidth="2"/>
                  {/* fill */}
                  {pct > 0 && (
                    <rect
                      x="8" y={10 + (32 * (100-pct)/100)}
                      width="24" height={32 * pct/100}
                      fill={fillColor}
                      opacity={isPlus?1:0.9}
                    />
                  )}
                  {/* overflow markers when ++ */}
                  {isPlus && (
                    <>
                      <path d="M 12 6 L 10 1 M 20 6 L 20 0 M 28 6 L 30 1" stroke="#7F1D1D" strokeWidth="2" strokeLinecap="round"/>
                    </>
                  )}
                </svg>
                <span style={{fontSize:16,fontWeight:800,lineHeight:1}}>{l.v === '++' ? 'Au-delà' : `${l.v}%`}</span>
                <span style={{fontSize:11,fontWeight:600,opacity:0.75}}>{l.label}</span>
              </button>
            );
          })}
        </div>

        {fill && (
          <div style={{background:'var(--teal-50)',border:'1px solid var(--teal-200)',borderRadius:12,padding:'12px 14px',fontSize:13,color:'var(--teal-800)',fontWeight:600,marginBottom:16}}>
            ✓ Niveau enregistré : <b>{fill.label}</b> ({fill.v === '++' ? 'dépassement' : `${fill.v}%`})
          </div>
        )}

        {/* secondary actions */}
        <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:20}}>
          <button onClick={onIncident} style={{
            background:'white',border:'2px solid var(--red-200)',color:'var(--red-700)',
            borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',gap:12,
            fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:56
          }}>
            <span style={{fontSize:22}}>⚠</span>
            <span style={{flex:1,textAlign:'left'}}>Déclarer un incident</span>
            <span style={{color:'var(--slate-400)'}}>→</span>
          </button>
          <button onClick={onTruckFull} style={{
            background:'white',border:'2px solid var(--amber-200)',color:'var(--amber-700)',
            borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',gap:12,
            fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'inherit',minHeight:56
          }}>
            <span style={{fontSize:22}}>🚚</span>
            <span style={{flex:1,textAlign:'left'}}>Camion plein → centre de tri</span>
            <span style={{color:'var(--slate-400)'}}>→</span>
          </button>
        </div>
      </div>

      <div style={{padding:14,background:'white',borderTop:'1px solid var(--slate-100)'}}>
        <button onClick={onNext} disabled={!fill} className="big-btn" style={{opacity:fill?1:0.4,cursor:fill?'pointer':'not-allowed'}}>✓ Valider · point suivant</button>
      </div>
    </div>
  );
};

// ============ ÉTAPE 6 — PESÉE CENTRE DE TRI ============
window.StepPesee = function({ onNext, onBack }) {
  const [weight, setWeight] = React.useState(112);
  const step = (d) => setWeight(w => Math.max(0, w + d));
  return (
    <div className="mob-screen" style={{background:'var(--slate-50)'}}>
      <div style={{background:'var(--amber-700)',color:'white',padding:'52px 18px 14px',display:'flex',alignItems:'center',gap:10}}>
        <button onClick={onBack} style={{width:40,height:40,borderRadius:12,background:'rgba(255,255,255,0.2)',color:'white',border:'none',fontSize:20,cursor:'pointer'}}>←</button>
        <div style={{flex:1}}>
          <div style={{fontSize:11,opacity:0.85,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>🏭 Centre de tri Rouen</div>
          <div style={{fontSize:17,fontWeight:800}}>Pesée du chargement</div>
        </div>
      </div>

      <div className="mob-body" style={{padding:20}}>
        <div style={{fontSize:12,color:'var(--slate-500)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10}}>Poids net sur bascule</div>
        <div style={{background:'white',border:'1px solid var(--slate-200)',borderRadius:20,padding:'26px 20px',textAlign:'center',boxShadow:'0 2px 8px rgba(0,0,0,0.04)'}}>
          <div style={{fontSize:72,fontWeight:800,color:'var(--slate-900)',lineHeight:1,letterSpacing:'-0.03em'}}>{weight}<span style={{fontSize:28,color:'var(--slate-500)',marginLeft:6}}>kg</span></div>
          <div style={{display:'flex',gap:10,marginTop:20,justifyContent:'center'}}>
            <button onClick={()=>step(-5)} style={{width:56,height:56,borderRadius:14,background:'var(--slate-100)',border:'none',fontSize:22,fontWeight:800,cursor:'pointer'}}>−5</button>
            <button onClick={()=>step(-1)} style={{width:56,height:56,borderRadius:14,background:'var(--slate-100)',border:'none',fontSize:22,fontWeight:800,cursor:'pointer'}}>−1</button>
            <button onClick={()=>step(+1)} style={{width:56,height:56,borderRadius:14,background:'var(--slate-100)',border:'none',fontSize:22,fontWeight:800,cursor:'pointer'}}>+1</button>
            <button onClick={()=>step(+5)} style={{width:56,height:56,borderRadius:14,background:'var(--slate-100)',border:'none',fontSize:22,fontWeight:800,cursor:'pointer'}}>+5</button>
          </div>
          <div style={{marginTop:14,padding:'10px 14px',background:'var(--teal-50)',borderRadius:10,fontSize:13,color:'var(--teal-800)',fontWeight:600,display:'inline-flex',alignItems:'center',gap:8}}>
            🔗 Bascule connectée · auto-lecture
          </div>
        </div>

        <div style={{marginTop:20,background:'white',border:'1px solid var(--slate-200)',borderRadius:14,padding:14}}>
          <div style={{fontSize:12,color:'var(--slate-500)',fontWeight:600,marginBottom:8}}>Récap déchargement</div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4,fontSize:14}}><span style={{color:'var(--slate-600)'}}>Tournée</span><b>Rouen-Nord</b></div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4,fontSize:14}}><span style={{color:'var(--slate-600)'}}>Points collectés</span><b>4 / 6</b></div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',fontSize:14}}><span style={{color:'var(--slate-600)'}}>Heure</span><b>11:42</b></div>
        </div>
      </div>

      <div style={{padding:14,background:'white',borderTop:'1px solid var(--slate-100)',display:'flex',flexDirection:'column',gap:8}}>
        <button onClick={onNext} className="big-btn">✓ Valider et reprendre la tournée</button>
        <button style={{background:'transparent',border:'none',color:'var(--slate-500)',fontSize:13,fontWeight:600,padding:8,cursor:'pointer',fontFamily:'inherit'}}>Fin de journée (retour dépôt)</button>
      </div>
    </div>
  );
};
