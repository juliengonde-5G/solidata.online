// Sections configuration — each screen has multiple variations rendered side-by-side.
// Wireframe bodies are returned as HTML strings and injected into `.wf-body`.

(function(){
  const ICON = (cls='') => `<span class="ico ${cls}"></span>`;
  const DOT = `<span class="ico circle"></span>`;

  // shared fragments -----------------------------------------------------------
  const sidebar = (active='Tableau') => {
    const items = ['Tableau','Recrut.','Collecte','Prod.','Finance','Report.','Admin'];
    return `<div class="side">
      <div class="bx hd" style="text-align:center;font-family:'Caveat';font-size:18px;background:var(--accent);color:white;border-color:var(--accent)">S</div>
      ${items.map(i=>`<div class="nav ${i===active?'active':''}">${ICON(i===active?'ok':'')}<span>${i}</span></div>`).join('')}
    </div>`;
  };
  const sidebarIcons = (activeIdx=0) => {
    return `<div class="side icons-only">
      <div class="bx hd" style="width:26px;height:26px;text-align:center;line-height:14px;font-family:'Caveat';font-size:16px;background:var(--accent);color:white;border-color:var(--accent);padding:4px">S</div>
      ${[0,1,2,3,4,5,6].map(i=>`<div class="nav ${i===activeIdx?'active':''}">${ICON(i===activeIdx?'ok':'')}</div>`).join('')}
    </div>`;
  };
  const topnav = (active='Tableau') => {
    const items = ['Tableau','Recrutement','Collecte','Production','Finance','Report.','Admin'];
    return `<div class="topnav">
      <div class="brandy">SOLIDATA</div>
      ${items.map(i=>`<div class="nav ${i===active?'active':''}">${i}</div>`).join('')}
      <div style="flex:1"></div>
      <div class="bx" style="padding:2px 8px;font-size:10px">🔍 ⌘K</div>
      <span class="avo"></span>
    </div>`;
  };

  // ----- DASHBOARD VARIATIONS ------------------------------------------------
  const dashboard = {
    id: 'dashboard',
    num: '01',
    title: 'Dashboard',
    sub: "Vue d'ensemble quotidienne. On teste : densité, hiérarchie, et comment l'IA surface les priorités.",
    cols: 'cols-4',
    items: [
      {
        v:'v1', name:'Fidèle — KPI + activité',
        badge:'proche de l\'existant',
        note:'Le pattern ERP classique. Sûr, lisible, pas surprenant. Baseline pour comparer les autres.',
        body: `<div class="frame"><div class="frame-chrome"><span>/dashboard</span></div><div class="frame-body">
          ${sidebar('Tableau')}
          <div class="cont">
            <div class="pagehdr"><h3>Bonjour Julien</h3><div class="spacer"></div><div class="bx accent-solid">+ Nouveau</div></div>
            <div class="row gap-2">
              <div class="bx flex-1"><div class="lbl">Candidats</div><div class="title">24</div><div class="chip a">+12%</div></div>
              <div class="bx flex-1"><div class="lbl">Tournées</div><div class="title">8</div><div class="chip a">+5%</div></div>
              <div class="bx flex-1"><div class="lbl">Stock MP</div><div class="title">2340kg</div><div class="chip a">+18%</div></div>
              <div class="bx flex-1"><div class="lbl">Boutiques</div><div class="title">12</div><div class="chip">→</div></div>
            </div>
            <div class="row gap-2 flex-1" style="min-height:0">
              <div class="bx flex-2 col gap-1"><div class="lbl">Activité récente</div>
                <div class="row gap-1"><span class="avo"></span><div class="line long"></div></div>
                <div class="row gap-1"><span class="avo"></span><div class="line"></div></div>
                <div class="row gap-1"><span class="avo"></span><div class="line long"></div></div>
                <div class="row gap-1"><span class="avo"></span><div class="line short"></div></div>
              </div>
              <div class="bx flex-1 ph">graphe 7j</div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v2', name:'Priorités d\'abord',
        badge:'action-first',
        note:'Au lieu de KPI, on met d\'abord « Ce qui demande ton attention aujourd\'hui ». Les chiffres sont en bas, comme référence.',
        body: `<div class="frame"><div class="frame-chrome"><span>/today</span></div><div class="frame-body">
          ${sidebar('Tableau')}
          <div class="cont">
            <div class="pagehdr"><h3>À traiter aujourd'hui — 6</h3></div>
            <div class="bx col gap-2" style="background:var(--accent-wash);border-color:var(--accent)">
              <div class="row gap-2"><span class="chip d">urgent</span><div class="flex-1"><div class="title">Stock MP critique — Dépôt 2</div><div class="lbl">depuis 2h · relance fournisseur</div></div><div class="bx accent-solid" style="padding:3px 10px">traiter</div></div>
              <div class="divider"></div>
              <div class="row gap-2"><span class="chip w">entretien</span><div class="flex-1"><div class="title">Marie Durand · 14h30</div><div class="lbl">préparer questions PCM</div></div><div class="bx" style="padding:3px 10px">ouvrir</div></div>
              <div class="divider"></div>
              <div class="row gap-2"><span class="chip a">valider</span><div class="flex-1"><div class="title">Tournée Rouen-Nord · retour</div><div class="lbl">112 kg · CAV 87%</div></div><div class="bx" style="padding:3px 10px">ouvrir</div></div>
            </div>
            <div class="row gap-2">
              <div class="bx flex-1"><div class="lbl">Candidats</div><div class="title">24</div></div>
              <div class="bx flex-1"><div class="lbl">Tournées</div><div class="title">8</div></div>
              <div class="bx flex-1"><div class="lbl">Stock MP</div><div class="title">2340kg</div></div>
              <div class="bx flex-1"><div class="lbl">Boutiques</div><div class="title">12</div></div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v3', name:'Split — équipes / flux',
        badge:'split-view',
        note:'Deux colonnes : équipe à gauche (humains), flux à droite (opérations). Force à penser les deux dimensions en parallèle.',
        body: `<div class="frame"><div class="frame-chrome"><span>/dashboard</span></div><div class="frame-body">
          ${sidebarIcons(0)}
          <div class="cont row gap-2">
            <div class="flex-1 col gap-2">
              <div class="lbl">👥 ÉQUIPES</div>
              <div class="bx col gap-1"><div class="title">Recrutement</div><div class="row gap-1"><span class="avo"></span><span class="avo"></span><span class="avo"></span><div class="lbl">+21 pipeline</div></div></div>
              <div class="bx col gap-1"><div class="title">Collecte</div><div class="row gap-1"><span class="avo"></span><span class="avo"></span><div class="lbl">8 tournées</div></div></div>
              <div class="bx col gap-1"><div class="title">Tri</div><div class="row gap-1"><span class="avo"></span><span class="avo"></span><span class="avo"></span><span class="avo"></span><div class="lbl">3 chaînes actives</div></div></div>
            </div>
            <div class="flex-2 col gap-2">
              <div class="lbl">⚙️ FLUX OPÉRATIONNELS</div>
              <div class="bx ph" style="min-height:80px">Sankey : Collecte → Tri → Revente / Refashion</div>
              <div class="row gap-2">
                <div class="bx flex-1"><div class="lbl">entrée j</div><div class="title">340 kg</div></div>
                <div class="bx flex-1"><div class="lbl">traité j</div><div class="title">290 kg</div></div>
                <div class="bx flex-1"><div class="lbl">sortie j</div><div class="title">265 kg</div></div>
              </div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v4', name:'Command-bar + feed',
        badge:'novel',
        note:'Pas de sidebar. Une grosse barre de commandes en haut (⌘K) + feed chronologique en dessous. Pour power-users.',
        body: `<div class="frame"><div class="frame-chrome"><span>/</span></div><div class="frame-body col">
          <div class="p-2" style="border-bottom:1.5px solid var(--rule-soft)">
            <div class="bx" style="padding:10px;font-family:'JetBrains Mono',monospace;font-size:11px">🔍 tapez une action, un nom, une tournée...&nbsp;&nbsp;<span style="color:var(--accent)">⌘K</span></div>
          </div>
          <div class="row gap-2 p-2" style="flex:1">
            <div class="flex-3 col gap-2">
              <div class="bx col gap-1"><div class="row gap-2"><span class="lbl">09:12</span><span class="chip a">recrut</span><div class="flex-1">Marie Durand a postulé · Responsable collecte</div></div></div>
              <div class="bx col gap-1"><div class="row gap-2"><span class="lbl">08:55</span><span class="chip">collecte</span><div class="flex-1">Tournée Rouen-Nord démarrée · 8 points</div></div></div>
              <div class="bx col gap-1"><div class="row gap-2"><span class="lbl">08:40</span><span class="chip d">alerte</span><div class="flex-1">Stock MP sous seuil · Dépôt 2</div></div></div>
              <div class="bx col gap-1"><div class="row gap-2"><span class="lbl">08:12</span><span class="chip">prod</span><div class="flex-1">Chaîne Tri #3 en route</div></div></div>
              <div class="bx col gap-1"><div class="row gap-2"><span class="lbl">hier</span><span class="chip">finance</span><div class="flex-1">Facture #2204 validée · 12 400€</div></div></div>
            </div>
            <div class="flex-1 col gap-2">
              <div class="lbl">RACCOURCIS</div>
              <div class="bx soft">+ candidat</div>
              <div class="bx soft">+ tournée</div>
              <div class="bx soft">voir stock</div>
              <div class="bx soft">rapport</div>
            </div>
          </div>
        </div></div>`
      }
    ]
  };

  // ----- RECRUTEMENT / KANBAN ------------------------------------------------
  const recrutement = {
    id: 'recrutement',
    num: '02',
    title: 'Recrutement',
    sub: 'Pipeline candidats. Kanban est l\'attendu — mais d\'autres vues peuvent mieux servir selon l\'usage.',
    cols: 'cols-4',
    items: [
      {
        v:'v1', name:'Kanban classique',
        badge:'existant',
        note:'Colonnes par statut, cartes verticales. Connu, lisible. Limite : on voit peu de candidats à la fois.',
        body: `<div class="frame"><div class="frame-chrome"><span>/recrutement</span></div><div class="frame-body">
          ${sidebarIcons(1)}
          <div class="cont">
            <div class="pagehdr"><h3>Pipeline · 68</h3><div class="spacer"></div><div class="bx">filtre</div><div class="bx accent-solid">+ candidat</div></div>
            <div class="row gap-2" style="flex:1;min-height:0">
              ${['À contacter 8','En cours 5','Entretien OK 3','Intégrés 12'].map((t,i)=>`
                <div class="flex-1 col gap-1">
                  <div class="lbl">${t}</div>
                  <div class="bx soft col gap-1" style="flex:1">
                    <div class="bx col gap-1"><div class="title">${['Sarah M.','Léa M.','Marc B.','Jean-Paul L.'][i]}</div><div class="lbl">${['Resp. collecte','Agent tri','Resp. collecte','Agent'][i]}</div><div class="chip a">★ ${[8.5,7.8,9.0,7.9][i]}</div></div>
                    <div class="bx col gap-1"><div class="title">${['Thomas L.','Jules P.','Sophie A.','Martine B.'][i]}</div><div class="lbl">${['Chauffeur','Collecte','Manager','Tri'][i]}</div><div class="chip a">★ ${[7.2,6.5,8.7,8.2][i]}</div></div>
                    ${i===0?`<div class="bx col gap-1"><div class="title">Maria G.</div><div class="lbl">Agent tri</div><div class="chip">★ 6.8</div></div>`:''}
                  </div>
                </div>`).join('')}
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v2', name:'Split — liste + fiche',
        badge:'parcours',
        note:'Liste à gauche, fiche détail à droite toujours visible. Meilleur pour recruteurs qui font surtout de la qualification.',
        body: `<div class="frame"><div class="frame-chrome"><span>/recrutement</span></div><div class="frame-body">
          ${sidebarIcons(1)}
          <div class="cont row gap-2" style="padding:8px">
            <div class="flex-1 col gap-1" style="max-width:40%">
              <div class="bx soft" style="padding:4px 6px"><span class="chip a">tous</span> <span class="chip">à contacter</span> <span class="chip">en cours</span></div>
              ${['Sarah Martin · Resp. collecte','Thomas Lefevre · Chauffeur','Maria Garcia · Agent tri','Pierre Dubois · Manager','Léa Moreau · Agent tri','Jules Petit · Collecte'].map((n,i)=>`
                <div class="bx ${i===0?'accent':''} col gap-1" style="padding:5px"><div class="row gap-1"><span class="avo"></span><div class="flex-1"><div class="title" style="font-size:12px">${n.split(' · ')[0]}</div><div class="lbl">${n.split(' · ')[1]}</div></div><span class="chip a" style="font-size:10px">★${(8.5-i*0.3).toFixed(1)}</span></div></div>`).join('')}
            </div>
            <div class="flex-2 bx col gap-2" style="background:var(--paper)">
              <div class="row gap-2"><span class="avo lg"></span><div class="flex-1"><div class="title">Sarah Martin</div><div class="lbl">Responsable collecte · Senior</div></div><span class="chip a">★ 8.5/10</span></div>
              <div class="row gap-1"><span class="chip">Leadership</span><span class="chip">Logistique</span><span class="chip">Équipe</span></div>
              <div class="divider"></div>
              <div class="lbl">PARCOURS</div>
              <div class="col gap-1">
                <div class="row gap-1">${ICON('ok')}<div class="flex-1">Entretien initial · 15 avril</div></div>
                <div class="row gap-1">${ICON('ok')}<div class="flex-1">Visite site · 18 avril</div></div>
                <div class="row gap-1">${ICON()}<div class="flex-1 lbl">En attente réponse</div></div>
              </div>
              <div class="row gap-1"><div class="bx accent-solid flex-1" style="text-align:center">Étape suivante →</div><div class="bx flex-1" style="text-align:center">Archiver</div></div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v3', name:'Funnel + actions IA',
        badge:'IA-assistée',
        note:'Visualisation entonnoir de conversion en haut. L\'IA suggère qui relancer, qui planifier. Les cartes kanban sont plus petites, plus denses.',
        body: `<div class="frame"><div class="frame-chrome"><span>/recrutement/funnel</span></div><div class="frame-body">
          ${sidebarIcons(1)}
          <div class="cont">
            <div class="pagehdr"><h3>Funnel recrutement</h3><div class="spacer"></div><div class="chip a">IA: 4 suggestions</div></div>
            <div class="bx ph" style="min-height:60px;font-size:9px">entonnoir : Contacter 8 → Cours 5 → Entretien 3 → Intégrés 12</div>
            <div class="bx col gap-1" style="background:var(--accent-wash);border-color:var(--accent)">
              <div class="row gap-1"><span class="chip a">★ IA</span><div class="flex-1 title">3 candidats à relancer cette semaine</div><div class="bx" style="padding:2px 8px">voir</div></div>
              <div class="row gap-1"><span class="chip a">★ IA</span><div class="flex-1 title">Sarah M. correspond à « Resp. Lille »</div><div class="bx" style="padding:2px 8px">voir</div></div>
            </div>
            <div class="row gap-1" style="flex:1;min-height:0">
              ${['Contacter','Cours','OK','Intégrés'].map((t,i)=>`
                <div class="flex-1 col gap-1"><div class="lbl">${t}</div>
                  ${[0,1,2].map(j=>`<div class="bx" style="padding:4px;font-size:10px"><div class="title" style="font-size:10px">${['Sarah','Thomas','Maria','Léa','Jules','Amandine','Marc','Sophie','JP L.','J-P L.','Martine','David'][i*3+j]||'-'}</div></div>`).join('')}
                </div>`).join('')}
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v4', name:'Carte territoriale',
        badge:'novel',
        note:'Candidats positionnés sur carte (bassins d\'emploi, proximité dépôts). Utile parce que recrutement est fortement local.',
        body: `<div class="frame"><div class="frame-chrome"><span>/recrutement/carte</span></div><div class="frame-body">
          ${sidebarIcons(1)}
          <div class="cont row gap-2" style="padding:8px">
            <div class="flex-2 bx ph" style="position:relative">
              <span style="font-size:9px">Carte Normandie</span>
              <span class="chip a" style="position:absolute;top:30%;left:20%">●8</span>
              <span class="chip a" style="position:absolute;top:50%;left:45%">●12</span>
              <span class="chip a" style="position:absolute;top:35%;left:65%">●5</span>
              <span class="chip" style="position:absolute;top:65%;left:30%">●3</span>
            </div>
            <div class="flex-1 col gap-1">
              <div class="lbl">ROUEN · 8 candidats</div>
              <div class="bx" style="padding:4px"><div class="title" style="font-size:11px">Sarah Martin</div><div class="lbl">4km du dépôt</div></div>
              <div class="bx" style="padding:4px"><div class="title" style="font-size:11px">Thomas Lef.</div><div class="lbl">12km</div></div>
              <div class="bx" style="padding:4px"><div class="title" style="font-size:11px">Maria G.</div><div class="lbl">3km</div></div>
              <div class="divider"></div>
              <div class="lbl">LE HAVRE · 3 candidats</div>
              <div class="bx" style="padding:4px"><div class="title" style="font-size:11px">Pierre D.</div></div>
            </div>
          </div>
        </div></div>`
      }
    ]
  };

  // ----- PCM TEST (accessibility-first, 1 écran) -----------------------------
  const pcm = {
    id: 'pcm',
    num: '03',
    title: 'Test PCM — candidat',
    sub: "Lecture/langue difficiles : 1 écran, peu de texte, pictos, audio. CRUCIAL : pas de scroll, hit-targets larges.",
    cols: 'cols-3',
    items: [
      {
        v:'v1', name:'Pictos + audio',
        badge:'accessible',
        note:'Grande question + 2 à 4 grosses cartes illustrées. Bouton écouter 🔊 toujours visible. Barre de progression simple.',
        body: `<div class="frame"><div class="frame-chrome"><span>/pcm · question 3/12</span></div><div class="frame-body col">
          <div style="padding:8px;border-bottom:1.5px solid var(--rule-soft);display:flex;gap:8px;align-items:center">
            <div class="row gap-1" style="flex:1">${[1,2,3,4,5,6,7,8,9,10,11,12].map(n=>`<div class="line t ${n<=3?'':'short'}" style="flex:1;background:${n<=3?'var(--accent)':'var(--rule-soft)'};height:6px"></div>`).join('')}</div>
            <div class="chip">3/12</div>
          </div>
          <div class="cont" style="justify-content:center;align-items:center;gap:16px;text-align:center">
            <div class="bx accent" style="padding:10px 14px;font-size:16px;font-weight:700">🔊 ÉCOUTER</div>
            <div class="title" style="font-size:18px">Tu travailles mieux...</div>
            <div class="row gap-2" style="width:100%">
              <div class="bx flex-1" style="padding:16px;text-align:center;min-height:80px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px"><div style="font-size:26px">👥</div><div class="title">avec des gens</div></div>
              <div class="bx flex-1" style="padding:16px;text-align:center;min-height:80px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px"><div style="font-size:26px">👤</div><div class="title">tout seul</div></div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v2', name:'Icônes seulement',
        badge:'zéro texte',
        note:'Variante radicale : aucun texte lisible. Pictos + icônes. Maximise l\'accessibilité mais risque d\'être ambigu.',
        body: `<div class="frame"><div class="frame-chrome"><span>/pcm · 3/12</span></div><div class="frame-body col" style="background:var(--paper-2)">
          <div style="padding:12px;display:flex;gap:12px;align-items:center;justify-content:center;background:var(--paper)">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(n=>`<div style="width:18px;height:18px;border-radius:50%;border:2px solid ${n<=3?'var(--accent)':'var(--rule)'};background:${n<3?'var(--accent)':n===3?'var(--accent-wash)':'transparent'}"></div>`).join('')}
          </div>
          <div class="cont" style="justify-content:center;align-items:center;gap:24px;text-align:center">
            <div class="bx accent" style="padding:14px 20px;font-size:22px;border-radius:40px">🔊</div>
            <div class="row gap-3" style="width:100%">
              <div class="bx flex-1" style="padding:24px;text-align:center;min-height:120px;display:flex;align-items:center;justify-content:center;font-size:48px">👥</div>
              <div class="bx flex-1" style="padding:24px;text-align:center;min-height:120px;display:flex;align-items:center;justify-content:center;font-size:48px">👤</div>
            </div>
            <div class="row gap-2"><div class="bx soft" style="padding:8px 16px;font-size:14px">← retour</div></div>
          </div>
        </div></div>`
      },
      {
        v:'v3', name:'Accompagné — avatar guide',
        badge:'rassurant',
        note:'Un personnage-guide lit la question. Bulle de dialogue. Pour les personnes intimidées par un test. Le ton est conversationnel.',
        body: `<div class="frame"><div class="frame-chrome"><span>/pcm · étape 3</span></div><div class="frame-body col" style="background:var(--accent-wash)">
          <div style="padding:8px 12px;background:var(--paper);border-bottom:1.5px solid var(--rule-soft);display:flex;gap:8px;align-items:center">
            <div class="title">Léa t'accompagne</div>
            <div class="spacer" style="flex:1"></div>
            <div class="chip">étape 3 sur 12</div>
          </div>
          <div class="cont row gap-3" style="padding:20px;align-items:center">
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
              <div class="avo xl" style="background:var(--accent);border-color:var(--accent)"></div>
              <div class="lbl">Léa</div>
              <div class="bx accent" style="padding:4px 10px;font-size:12px">🔊 re-écouter</div>
            </div>
            <div class="flex-1 col gap-2">
              <div class="bx" style="position:relative;padding:14px;font-size:15px;background:var(--paper)">
                <div class="title">« Pour toi, c'est mieux de travailler... »</div>
                <div style="position:absolute;left:-8px;top:20px;width:14px;height:14px;background:var(--paper);border-left:1.5px solid var(--rule);border-bottom:1.5px solid var(--rule);transform:rotate(45deg)"></div>
              </div>
              <div class="row gap-2">
                <div class="bx flex-1 accent-solid" style="padding:12px;text-align:center">👥 avec d'autres</div>
                <div class="bx flex-1" style="padding:12px;text-align:center">👤 tout seul</div>
              </div>
              <div class="lbl" style="text-align:center">pas de bonne réponse · choisis ce que tu préfères</div>
            </div>
          </div>
        </div></div>`
      }
    ]
  };

  // ----- COLLECTE ------------------------------------------------------------
  const collecte = {
    id: 'collecte',
    num: '04',
    title: 'Collecte — tournées & carte',
    sub: 'Supervision des tournées en cours. Carte vs liste vs timeline — l\'info spatiale est-elle centrale ?',
    cols: 'cols-4',
    items: [
      {
        v:'v1', name:'Liste + mini-map',
        badge:'classique',
        note:'Liste des tournées à gauche, mini-carte contextuelle à droite. Sûr mais pas très vivant.',
        body: `<div class="frame"><div class="frame-chrome"><span>/collecte</span></div><div class="frame-body">
          ${sidebarIcons(2)}
          <div class="cont">
            <div class="pagehdr"><h3>Tournées · 8 actives</h3><div class="spacer"></div><div class="bx accent-solid">+ tournée</div></div>
            <div class="row gap-2" style="flex:1;min-height:0">
              <div class="flex-2 col gap-1">
                ${['Rouen-Nord','Le Havre','Elbeuf','Dieppe','Évreux'].map((t,i)=>`
                  <div class="bx row gap-2" style="padding:6px"><div style="width:30px;text-align:center"><div class="title">${[87,64,92,45,0][i]}%</div><div class="lbl">CAV</div></div><div class="flex-1"><div class="title">${t}</div><div class="lbl">${[8,6,10,5,7][i]} points · ${['en route','retour','chargement','planifiée','retard'][i]}</div></div><span class="chip ${['a','a','a','','d'][i]}">${['en route','retour','chargt.','plan.','retard'][i]}</span></div>`).join('')}
              </div>
              <div class="flex-1 bx ph">mini-carte</div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v2', name:'Carte plein écran',
        badge:'spatial-first',
        note:'La carte occupe tout. Les tournées sont des pastilles cliquables. Pour dispatch / opérations en live.',
        body: `<div class="frame"><div class="frame-chrome"><span>/collecte/live</span></div><div class="frame-body">
          ${sidebarIcons(2)}
          <div class="cont" style="padding:0;position:relative">
            <div class="bx ph" style="flex:1;border:none;border-radius:0;position:relative">
              <span class="chip a" style="position:absolute;top:20%;left:25%">🚚 T1 87%</span>
              <span class="chip a" style="position:absolute;top:40%;left:55%">🚚 T2 64%</span>
              <span class="chip d" style="position:absolute;top:60%;left:35%">🚚 T5 retard</span>
              <span class="chip" style="position:absolute;top:30%;left:75%">🚚 T3 92%</span>
              <span class="chip" style="position:absolute;top:70%;left:70%">🚚 T4</span>
            </div>
            <div class="bx" style="position:absolute;top:12px;left:12px;max-width:180px;background:var(--paper)">
              <div class="title">T1 · Rouen-Nord</div><div class="lbl">Chauffeur: Marc L.</div><div class="lbl">5/8 points · 87% CAV</div><div class="chip a" style="margin-top:4px">voir détail →</div>
            </div>
            <div class="row gap-2" style="position:absolute;bottom:12px;left:12px;right:12px;background:var(--paper);padding:6px;border:1.5px solid var(--rule);border-radius:4px">
              <div class="flex-1 lbl">8 tournées actives · 340kg collecté · 2 retards</div>
              <div class="chip a">filtre: toutes</div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v3', name:'Timeline horaire',
        badge:'temporel',
        note:'Axe horizontal = heure. Chaque tournée = barre. On voit les chevauchements, les retards visuellement. Excellent pour planification.',
        body: `<div class="frame"><div class="frame-chrome"><span>/collecte/planning</span></div><div class="frame-body">
          ${sidebarIcons(2)}
          <div class="cont">
            <div class="pagehdr"><h3>Planning · jeudi 23</h3><div class="spacer"></div><div class="bx">◀ ▶</div></div>
            <div class="bx col gap-2" style="padding:8px">
              <div class="row gap-1" style="font-size:10px;color:var(--ink-soft);padding-left:70px">${['6h','8h','10h','12h','14h','16h','18h'].map(h=>`<div style="flex:1;text-align:center">${h}</div>`).join('')}</div>
              ${[
                {n:'Rouen-Nord', start:5, w:35, cl:'a'},
                {n:'Le Havre', start:15, w:30, cl:'a'},
                {n:'Elbeuf', start:25, w:25, cl:'a'},
                {n:'Dieppe', start:45, w:20, cl:''},
                {n:'Évreux', start:10, w:40, cl:'d'},
              ].map(r=>`<div class="row gap-1" style="align-items:center"><div style="width:70px;font-size:11px">${r.n}</div><div style="flex:1;height:18px;position:relative;background:var(--paper-2);border-radius:3px"><div class="bx ${r.cl?'accent-solid':''}" style="position:absolute;left:${r.start}%;width:${r.w}%;height:100%;padding:2px 6px;font-size:10px;display:flex;align-items:center;${r.cl==='d'?'background:#c2410c;border-color:#c2410c;color:white':''}">🚚</div></div></div>`).join('')}
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v4', name:'IA — propositions',
        badge:'IA-assistée',
        note:'L\'IA propose des tournées optimisées (saturation CAV, proximité, urgence). Tu valides ou ajustes. Gros gain d\'efficacité potentiel.',
        body: `<div class="frame"><div class="frame-chrome"><span>/collecte/suggestions</span></div><div class="frame-body">
          ${sidebarIcons(2)}
          <div class="cont">
            <div class="pagehdr"><h3>Propositions IA · demain</h3><div class="spacer"></div><div class="chip a">★ 4 propos.</div></div>
            <div class="bx col gap-2" style="background:var(--accent-wash);border-color:var(--accent)">
              <div class="row gap-2"><span class="chip a">★</span><div class="flex-1"><div class="title">Tournée A · Rouen-Sud + Elbeuf</div><div class="lbl">14 points · ~320kg estimés · 4h30 · +12% CAV vs hier</div></div><div class="bx accent-solid" style="padding:3px 10px">valider</div><div class="bx" style="padding:3px 10px">ajuster</div></div>
              <div class="divider"></div>
              <div class="row gap-2"><span class="chip a">★</span><div class="flex-1"><div class="title">Tournée B · Le Havre côte</div><div class="lbl">9 points · ~180kg · 3h</div></div><div class="bx accent-solid" style="padding:3px 10px">valider</div><div class="bx" style="padding:3px 10px">ajuster</div></div>
              <div class="divider"></div>
              <div class="row gap-2"><span class="chip a">★</span><div class="flex-1"><div class="title">Tournée C · Dieppe urgente</div><div class="lbl">6 points · CAV pleins signalés</div></div><div class="bx accent-solid" style="padding:3px 10px">valider</div><div class="bx" style="padding:3px 10px">ajuster</div></div>
            </div>
            <div class="bx" style="background:var(--paper-2)"><div class="lbl">Pourquoi ces propositions ?</div><div style="font-size:11px">Capteurs CAV > 80% · distances dépôts · historique jeudi · météo OK</div></div>
          </div>
        </div></div>`
      }
    ]
  };

  // ----- PRODUCTION ----------------------------------------------------------
  const production = {
    id: 'production',
    num: '05',
    title: 'Production — stock & tri',
    sub: "Stock matières premières + chaîne de tri. Dense ou visuel ? Tableau ou flux ?",
    cols: 'cols-3',
    items: [
      {
        v:'v1', name:'Table + filtres',
        badge:'dense',
        note:'Tableau classique avec filtres en haut. Très dense, très précis — pour les gestionnaires de stock.',
        body: `<div class="frame"><div class="frame-chrome"><span>/production/stock</span></div><div class="frame-body">
          ${sidebarIcons(3)}
          <div class="cont">
            <div class="pagehdr"><h3>Stock MP · 2 340 kg</h3><div class="spacer"></div><div class="bx">export</div></div>
            <div class="row gap-1"><div class="bx" style="padding:2px 8px">Catégorie ▾</div><div class="bx" style="padding:2px 8px">Dépôt ▾</div><div class="bx" style="padding:2px 8px">Qualité ▾</div><div class="bx accent" style="padding:2px 8px">alerte seuil</div></div>
            <div class="bx col" style="padding:0;flex:1;min-height:0">
              <div class="row" style="background:var(--paper-2);padding:6px 8px;font-size:10px;font-weight:700;border-bottom:1.5px solid var(--rule-soft)"><div style="flex:2">Catégorie</div><div style="flex:1">Dépôt</div><div style="flex:1">Poids</div><div style="flex:1">Qualité</div><div style="flex:1">Statut</div></div>
              ${[['Coton blanc','D1','420kg','A','OK'],['Coton couleur','D1','310kg','A','OK'],['Laine','D2','180kg','B','bas'],['Synthétique','D2','85kg','C','critique'],['Mélangé','D3','620kg','B','OK'],['Denim','D1','225kg','A','OK'],['Lin','D3','95kg','B','bas']].map((r,i)=>`<div class="row" style="padding:4px 8px;font-size:11px;border-bottom:1px dashed var(--rule-soft)"><div style="flex:2">${r[0]}</div><div style="flex:1">${r[1]}</div><div style="flex:1">${r[2]}</div><div style="flex:1">${r[3]}</div><div style="flex:1"><span class="chip ${r[4]==='critique'?'d':r[4]==='bas'?'w':'a'}" style="font-size:9px">${r[4]}</span></div></div>`).join('')}
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v2', name:'Flux de tri interactif',
        badge:'visuel',
        note:'Le process de tri représenté comme un diagramme. On clique sur une étape pour voir les détails. Excellent pour former, piloter.',
        body: `<div class="frame"><div class="frame-chrome"><span>/production/flux</span></div><div class="frame-body">
          ${sidebarIcons(3)}
          <div class="cont">
            <div class="pagehdr"><h3>Chaîne de tri</h3><div class="spacer"></div><div class="chip a">live</div></div>
            <div class="row gap-1" style="align-items:center;flex:1">
              <div class="bx col gap-1" style="flex:1;text-align:center"><div style="font-size:22px">📦</div><div class="title">Entrée</div><div class="chip a">340kg</div></div>
              <div class="arrow"></div>
              <div class="bx col gap-1" style="flex:1;text-align:center;background:var(--accent-wash);border-color:var(--accent)"><div style="font-size:22px">👁</div><div class="title">Tri qualité</div><div class="chip a">290kg · 3 agents</div></div>
              <div class="arrow"></div>
              <div class="bx col gap-1" style="flex:1;text-align:center"><div style="font-size:22px">⚖️</div><div class="title">Pesée + cat.</div><div class="chip">265kg</div></div>
              <div class="arrow"></div>
              <div class="bx col gap-1" style="flex:1;text-align:center"><div style="font-size:22px">🏷</div><div class="title">Destination</div><div class="lbl">3 sorties</div></div>
            </div>
            <div class="row gap-2">
              <div class="bx flex-1"><div class="lbl">→ revente</div><div class="title">180kg</div></div>
              <div class="bx flex-1"><div class="lbl">→ refashion</div><div class="title">60kg</div></div>
              <div class="bx flex-1"><div class="lbl">→ rebut</div><div class="title">25kg</div></div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v3', name:'Dépôts en miniature',
        badge:'spatial',
        note:'Chaque dépôt = un bloc avec jauges. Pour multi-site. Identifier d\'un coup d\'œil où ça coince.',
        body: `<div class="frame"><div class="frame-chrome"><span>/production</span></div><div class="frame-body">
          ${sidebarIcons(3)}
          <div class="cont">
            <div class="pagehdr"><h3>Dépôts · 3</h3></div>
            <div class="row gap-2" style="flex:1">
              ${[
                {n:'Dépôt 1 · Rouen', fill:72, cat:[['coton',420],['denim',225],['couleur',310]], status:'a'},
                {n:'Dépôt 2 · Havre', fill:94, cat:[['laine',180],['synth',85]], status:'d'},
                {n:'Dépôt 3 · Elbeuf', fill:55, cat:[['mélangé',620],['lin',95]], status:''},
              ].map(d=>`
                <div class="bx flex-1 col gap-2" style="${d.status==='d'?'border-color:var(--danger);background:#fdf4ef':''}">
                  <div class="row gap-1"><div class="title flex-1">${d.n}</div>${d.status==='d'?'<span class="chip d">saturé</span>':d.status==='a'?'<span class="chip a">OK</span>':'<span class="chip">bas</span>'}</div>
                  <div style="height:14px;background:var(--paper-2);border-radius:2px;border:1px solid var(--rule-soft);position:relative"><div style="position:absolute;left:0;top:0;bottom:0;width:${d.fill}%;background:${d.status==='d'?'var(--danger)':'var(--accent)'};border-radius:2px"></div></div>
                  <div class="lbl">${d.fill}% de capacité</div>
                  <div class="divider"></div>
                  ${d.cat.map(c=>`<div class="row gap-1"><div class="flex-1">${c[0]}</div><div class="lbl">${c[1]}kg</div></div>`).join('')}
                </div>`).join('')}
            </div>
          </div>
        </div></div>`
      }
    ]
  };

  // ----- FINANCES ------------------------------------------------------------
  const finances = {
    id: 'finances',
    num: '06',
    title: 'Finances',
    sub: 'P&L, trésorerie, dépenses. Niveau de détail et comment l\'insight émerge.',
    cols: 'cols-3',
    items: [
      {
        v:'v1', name:'Dashboard P&L',
        badge:'classique',
        note:'KPI financiers + graphe cashflow + pie dépenses. Tout tient sur un écran.',
        body: `<div class="frame"><div class="frame-chrome"><span>/finances</span></div><div class="frame-body">
          ${sidebarIcons(4)}
          <div class="cont">
            <div class="pagehdr"><h3>Finances · avril 2026</h3><div class="spacer"></div><div class="bx">trim ▾</div></div>
            <div class="row gap-2">
              <div class="bx flex-1"><div class="lbl">CA mois</div><div class="title">84 200 €</div><div class="chip a">+8%</div></div>
              <div class="bx flex-1"><div class="lbl">Charges</div><div class="title">61 400 €</div><div class="chip">-2%</div></div>
              <div class="bx flex-1"><div class="lbl">Marge</div><div class="title">22 800 €</div><div class="chip a">+14%</div></div>
              <div class="bx flex-1"><div class="lbl">Tréso.</div><div class="title">147k €</div></div>
            </div>
            <div class="row gap-2" style="flex:1">
              <div class="bx flex-2 ph">graphe cashflow 12 mois</div>
              <div class="bx flex-1 ph">donut dépenses</div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v2', name:'Narratif — « histoire »',
        badge:'explicatif',
        note:'Phrases complètes : « Ce mois, la marge est en hausse de 14% grâce à... ». L\'IA rédige. Chiffres en support, pas en vedette.',
        body: `<div class="frame"><div class="frame-chrome"><span>/finances/insights</span></div><div class="frame-body">
          ${sidebarIcons(4)}
          <div class="cont">
            <div class="pagehdr"><h3>Insights financiers</h3><div class="spacer"></div><div class="chip a">★ IA</div></div>
            <div class="bx col gap-2" style="background:var(--accent-wash);border-color:var(--accent)">
              <div class="title" style="font-size:15px">Ce mois, la marge est en hausse de <span style="background:var(--highlight);padding:0 3px">+14%</span>.</div>
              <div style="font-size:12px">Principalement grâce à la baisse des charges logistiques (-8%) et à la hausse des ventes refashion (+22%). La tournée Rouen-Nord atteint 87% de CAV, un record.</div>
            </div>
            <div class="bx col gap-2"><div class="lbl">⚠ Attention</div><div style="font-size:12px">Le poste « carburant » dépasse de 6% le budget. 2 tournées pourraient être fusionnées.</div><div class="chip a" style="align-self:flex-start">voir détails</div></div>
            <div class="row gap-2" style="flex:1">
              <div class="bx flex-1"><div class="lbl">CA</div><div class="title">84k€</div></div>
              <div class="bx flex-1"><div class="lbl">Charges</div><div class="title">61k€</div></div>
              <div class="bx flex-1"><div class="lbl">Marge</div><div class="title">22k€</div></div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v3', name:'Timeline trésorerie',
        badge:'temporel',
        note:'Ligne temporelle avec entrées/sorties prévues. Idéal pour anticiper un trou de trésorerie.',
        body: `<div class="frame"><div class="frame-chrome"><span>/finances/tresorerie</span></div><div class="frame-body">
          ${sidebarIcons(4)}
          <div class="cont">
            <div class="pagehdr"><h3>Trésorerie 90 jours</h3><div class="spacer"></div><div class="bx">sim. scénario</div></div>
            <div class="bx ph" style="flex:1;min-height:100px">courbe trésorerie + prévisions</div>
            <div class="bx col gap-1">
              <div class="lbl">ÉVÉNEMENTS</div>
              <div class="row gap-2"><span class="chip a">+</span><span class="lbl">15 mai</span><div class="flex-1">Subvention trimestre · +24 000€</div></div>
              <div class="row gap-2"><span class="chip d">-</span><span class="lbl">20 mai</span><div class="flex-1">Paie équipes · -38 400€</div></div>
              <div class="row gap-2"><span class="chip d">-</span><span class="lbl">28 mai</span><div class="flex-1">Loyer dépôts · -5 200€</div></div>
              <div class="row gap-2"><span class="chip a">+</span><span class="lbl">5 juin</span><div class="flex-1">Contrat revente Paris · +18 000€</div></div>
            </div>
          </div>
        </div></div>`
      }
    ]
  };

  // ----- REPORTING -----------------------------------------------------------
  const reporting = {
    id: 'reporting',
    num: '07',
    title: 'Reporting',
    sub: 'Construction de rapports. Builder drag-drop vs templates vs conversationnel.',
    cols: 'cols-3',
    items: [
      {
        v:'v1', name:'Templates + export',
        badge:'simple',
        note:'Liste de templates pré-faits (mensuel, subvention, etc.). Un clic pour générer/exporter.',
        body: `<div class="frame"><div class="frame-chrome"><span>/reporting</span></div><div class="frame-body">
          ${sidebarIcons(5)}
          <div class="cont">
            <div class="pagehdr"><h3>Rapports</h3><div class="spacer"></div><div class="bx accent-solid">+ rapport</div></div>
            <div class="lbl">TEMPLATES</div>
            <div class="row gap-2">
              <div class="bx flex-1 col gap-1"><div class="title">📊 Mensuel</div><div class="lbl">KPI + tournées + finance</div><div class="chip a">générer</div></div>
              <div class="bx flex-1 col gap-1"><div class="title">📜 Subvention</div><div class="lbl">Impact social + chiffres</div><div class="chip a">générer</div></div>
              <div class="bx flex-1 col gap-1"><div class="title">♻ Impact</div><div class="lbl">Tonnage · CO₂ · refashion</div><div class="chip a">générer</div></div>
            </div>
            <div class="divider"></div>
            <div class="lbl">DERNIERS RAPPORTS</div>
            <div class="bx col gap-1">
              <div class="row gap-2"><div class="flex-1">Mensuel mars 2026</div><div class="lbl">3 avr.</div><div class="chip">pdf</div></div>
              <div class="row gap-2"><div class="flex-1">Subvention T1</div><div class="lbl">1 avr.</div><div class="chip">pdf</div></div>
              <div class="row gap-2"><div class="flex-1">Impact Q1 2026</div><div class="lbl">29 mars</div><div class="chip">xlsx</div></div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v2', name:'Builder drag-drop',
        badge:'power',
        note:'Palette de blocs à gauche, canvas rapport à droite. Tu construis comme dans Notion/Looker.',
        body: `<div class="frame"><div class="frame-chrome"><span>/reporting/builder</span></div><div class="frame-body">
          ${sidebarIcons(5)}
          <div class="cont row gap-2" style="padding:8px">
            <div class="flex-1 col gap-1" style="max-width:35%">
              <div class="lbl">BLOCS</div>
              <div class="bx soft" style="padding:4px 8px">📊 KPI card</div>
              <div class="bx soft" style="padding:4px 8px">📈 Ligne</div>
              <div class="bx soft" style="padding:4px 8px">🥧 Donut</div>
              <div class="bx soft" style="padding:4px 8px">🗺 Carte</div>
              <div class="bx soft" style="padding:4px 8px">📋 Table</div>
              <div class="bx soft" style="padding:4px 8px">💬 Texte</div>
              <div class="bx soft" style="padding:4px 8px">— Séparateur</div>
            </div>
            <div class="flex-2 bx dashed col gap-1" style="background:var(--paper-2)">
              <div class="bx" style="padding:4px 8px"><div class="title" style="font-size:12px">Rapport mars 2026</div></div>
              <div class="row gap-1"><div class="bx flex-1 ph" style="min-height:24px">KPI</div><div class="bx flex-1 ph" style="min-height:24px">KPI</div></div>
              <div class="bx ph" style="min-height:40px">graphe ligne</div>
              <div class="bx dashed" style="text-align:center;color:var(--ink-soft)">+ glisser un bloc</div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v3', name:'Demande en langage naturel',
        badge:'novel',
        note:'Tu tapes « Impact carbone trimestre 1 par dépôt ». L\'IA compose le rapport. Tu éditables ensuite.',
        body: `<div class="frame"><div class="frame-chrome"><span>/reporting/ask</span></div><div class="frame-body">
          ${sidebarIcons(5)}
          <div class="cont">
            <div class="pagehdr"><h3>Demande un rapport</h3></div>
            <div class="bx" style="padding:12px;font-family:'JetBrains Mono',monospace;font-size:11px;background:var(--accent-wash);border-color:var(--accent)">
              « Combien de kg collectés par tournée au T1, et quel impact CO₂ évité ? »
            </div>
            <div class="row gap-1">
              <span class="chip">exemples :</span>
              <span class="chip a">ventes par catégorie</span>
              <span class="chip a">candidats retenus / poste</span>
              <span class="chip a">charges vs budget</span>
            </div>
            <div class="divider"></div>
            <div class="lbl">APERÇU GÉNÉRÉ</div>
            <div class="bx col gap-1" style="flex:1">
              <div class="title">T1 2026 · Collecte & impact</div>
              <div class="row gap-1"><div class="bx flex-1 ph" style="min-height:30px">barres par tournée</div></div>
              <div class="row gap-1"><div class="bx flex-1"><div class="lbl">Total</div><div class="title">4,2t</div></div><div class="bx flex-1"><div class="lbl">CO₂ évité</div><div class="title">12t eq</div></div></div>
            </div>
            <div class="row gap-2"><div class="bx accent-solid flex-1" style="text-align:center">Publier</div><div class="bx flex-1" style="text-align:center">Éditer</div></div>
          </div>
        </div></div>`
      }
    ]
  };

  // ----- ADMINISTRATION ------------------------------------------------------
  const admin = {
    id: 'admin',
    num: '08',
    title: 'Administration',
    sub: 'Utilisateurs, flotte, paramètres. Tout dans un hub, ou éclaté en sous-pages ?',
    cols: 'cols-3',
    items: [
      {
        v:'v1', name:'Hub navigué',
        badge:'classique',
        note:'Sous-menu gauche (users, véhicules, rôles, paramètres). Chaque section est une table/form.',
        body: `<div class="frame"><div class="frame-chrome"><span>/admin/users</span></div><div class="frame-body">
          ${sidebarIcons(6)}
          <div class="cont row gap-2" style="padding:8px">
            <div class="flex-1 col gap-1" style="max-width:32%">
              <div class="lbl">ADMIN</div>
              <div class="bx accent" style="padding:4px 8px">👥 Utilisateurs</div>
              <div class="bx soft" style="padding:4px 8px">🚚 Véhicules</div>
              <div class="bx soft" style="padding:4px 8px">🔑 Rôles</div>
              <div class="bx soft" style="padding:4px 8px">🏢 Dépôts</div>
              <div class="bx soft" style="padding:4px 8px">⚙ Paramètres</div>
              <div class="bx soft" style="padding:4px 8px">🔌 Intégrations</div>
            </div>
            <div class="flex-2 col gap-2">
              <div class="pagehdr"><h3>Utilisateurs · 42</h3><div class="spacer"></div><div class="bx accent-solid">+ user</div></div>
              <div class="bx col" style="padding:0;flex:1">
                <div class="row" style="background:var(--paper-2);padding:6px 8px;font-size:10px;font-weight:700"><div style="flex:2">Nom</div><div style="flex:1">Rôle</div><div style="flex:1">Dépôt</div><div style="flex:1">Actif</div></div>
                ${['Julien G.·admin·—·oui','Marc L.·chauffeur·D1·oui','Léa M.·tri·D2·oui','Sophie A.·manager·D1·non'].map(r=>{const p=r.split('·');return`<div class="row" style="padding:5px 8px;font-size:11px;border-top:1px dashed var(--rule-soft)"><div style="flex:2">${p[0]}</div><div style="flex:1"><span class="chip">${p[1]}</span></div><div style="flex:1">${p[2]}</div><div style="flex:1">${p[3]==='oui'?'✓':'—'}</div></div>`}).join('')}
              </div>
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v2', name:'Carte d\'entités',
        badge:'visuel',
        note:'Tout sur une grille, par type d\'entité (carte user, carte véhicule, carte dépôt). On clique pour éditer.',
        body: `<div class="frame"><div class="frame-chrome"><span>/admin</span></div><div class="frame-body">
          ${sidebarIcons(6)}
          <div class="cont">
            <div class="pagehdr"><h3>Administration</h3><div class="spacer"></div><div class="bx">filtre ▾</div></div>
            <div class="lbl">👥 UTILISATEURS · 42</div>
            <div class="row gap-1" style="flex-wrap:wrap">
              ${[1,2,3,4,5,6].map(i=>`<div class="bx" style="width:calc(16.6% - 4px);text-align:center;padding:5px"><span class="avo" style="margin:auto"></span><div class="title" style="font-size:10px">User ${i}</div></div>`).join('')}
            </div>
            <div class="lbl">🚚 FLOTTE · 12</div>
            <div class="row gap-1">
              ${[1,2,3,4].map(i=>`<div class="bx flex-1" style="padding:5px"><div class="title" style="font-size:11px">IV-${i}0${i}-VX</div><div class="lbl">Renault · Rouen</div><div class="chip ${i===2?'d':'a'}">${i===2?'révision':'OK'}</div></div>`).join('')}
            </div>
            <div class="lbl">🏢 DÉPÔTS · 3</div>
            <div class="row gap-1">
              ${['D1 Rouen','D2 Havre','D3 Elbeuf'].map(d=>`<div class="bx flex-1" style="padding:5px"><div class="title" style="font-size:11px">${d}</div><div class="lbl">editer ▸</div></div>`).join('')}
            </div>
          </div>
        </div></div>`
      },
      {
        v:'v3', name:'Matrice rôles/perms',
        badge:'opérationnel',
        note:'Matrice rôles × permissions cochables. Spécifiquement pour les orgs qui gèrent finement les droits.',
        body: `<div class="frame"><div class="frame-chrome"><span>/admin/roles</span></div><div class="frame-body">
          ${sidebarIcons(6)}
          <div class="cont">
            <div class="pagehdr"><h3>Rôles & permissions</h3></div>
            <div class="bx col" style="padding:0;flex:1;overflow:hidden">
              <div class="row" style="background:var(--paper-2);font-size:10px;font-weight:700;padding:6px 8px"><div style="flex:2">Permission</div><div style="flex:1;text-align:center">Admin</div><div style="flex:1;text-align:center">Manager</div><div style="flex:1;text-align:center">Chauffeur</div><div style="flex:1;text-align:center">Tri</div></div>
              ${[['Voir dashboard',1,1,1,1],['Modifier users',1,0,0,0],['Valider tournée',1,1,0,0],['Saisir collecte',1,1,1,0],['Voir finance',1,1,0,0],['Export rapport',1,1,0,0],['Config. système',1,0,0,0]].map(row=>`<div class="row" style="padding:5px 8px;font-size:11px;border-top:1px dashed var(--rule-soft)"><div style="flex:2">${row[0]}</div>${[1,2,3,4].map(k=>`<div style="flex:1;text-align:center">${row[k]?ICON('ok'):'—'}</div>`).join('')}</div>`).join('')}
            </div>
            <div class="row gap-2"><div class="bx accent-solid flex-1" style="text-align:center">Enregistrer</div><div class="bx flex-1" style="text-align:center">+ rôle</div></div>
          </div>
        </div></div>`
      }
    ]
  };

  window.SOLIDATA_SECTIONS = [dashboard, recrutement, pcm, collecte, production, finances, reporting, admin];
})();
