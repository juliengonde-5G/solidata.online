// Renders sections from SOLIDATA_SECTIONS, wires tweaks + focus/zoom.

(function(){
  const TWEAKS = /*EDITMODE-BEGIN*/{
    "sketchy": true,
    "annotations": true,
    "accent": "teal",
    "lang": "fr"
  }/*EDITMODE-END*/;

  const root = document.documentElement;

  function applyTweaks(){
    root.classList.toggle('clean', !TWEAKS.sketchy);
    root.classList.toggle('no-annot', !TWEAKS.annotations);
    root.classList.remove('accent-none','accent-indigo','accent-amber');
    if (TWEAKS.accent !== 'teal') root.classList.add('accent-' + TWEAKS.accent);
    // lang
    document.querySelectorAll('[data-fr]').forEach(el=>{
      el.textContent = TWEAKS.lang === 'en' && el.dataset.en ? el.dataset.en : el.dataset.fr;
    });
    // swatches
    document.querySelectorAll('.accent-swatch').forEach(s=>{
      s.classList.toggle('active', s.dataset.accent === TWEAKS.accent);
    });
    // toggles
    const t = id => document.getElementById(id);
    if (t('tw-sketchy')) t('tw-sketchy').classList.toggle('on', TWEAKS.sketchy);
    if (t('tw-annot')) t('tw-annot').classList.toggle('on', TWEAKS.annotations);
    if (t('tw-lang')) t('tw-lang').textContent = TWEAKS.lang === 'fr' ? 'FR / EN' : 'EN / FR';
  }

  function persist(){
    try {
      window.parent.postMessage({type: '__edit_mode_set_keys', edits: {...TWEAKS}}, '*');
    } catch(e){}
  }

  // Render sections ----------------------------------------------------------
  function render(){
    const host = document.getElementById('sections');
    if (!host || !window.SOLIDATA_SECTIONS) return;
    host.innerHTML = window.SOLIDATA_SECTIONS.map(s => `
      <section class="section" id="${s.id}">
        <div class="section-head">
          <div class="num">${s.num}</div>
          <h2>${s.title}</h2>
          <div class="sub">${s.sub}</div>
        </div>
        <div class="canvas ${s.cols}">
          ${s.items.map((it, idx) => `
            <div class="wf" data-focus-id="${s.id}-${idx}">
              <div class="wf-head">
                <span class="ver">${it.v}</span>
                <span class="ttl">${it.name}</span>
                ${it.badge ? `<span class="badge">${it.badge}</span>` : ''}
              </div>
              <div class="wf-body">${it.body}</div>
              <div class="wf-note">${it.note}</div>
            </div>
          `).join('')}
        </div>
      </section>
    `).join('');
    wireFocus();
  }

  // Focus/zoom on click -------------------------------------------------------
  function wireFocus(){
    const backdrop = document.getElementById('backdrop');
    document.querySelectorAll('.wf').forEach(el => {
      el.addEventListener('click', () => {
        const alreadyFocused = el.classList.contains('focused');
        document.querySelectorAll('.wf.focused').forEach(x=>x.classList.remove('focused'));
        if (!alreadyFocused) {
          el.classList.add('focused');
          backdrop.classList.add('on');
        } else {
          backdrop.classList.remove('on');
        }
      });
    });
    backdrop.onclick = () => {
      document.querySelectorAll('.wf.focused').forEach(x=>x.classList.remove('focused'));
      backdrop.classList.remove('on');
    };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.wf.focused').forEach(x=>x.classList.remove('focused'));
        backdrop.classList.remove('on');
      }
    });
  }

  // Tweak buttons -------------------------------------------------------------
  function wireTweaks(){
    document.getElementById('tw-sketchy').onclick = () => { TWEAKS.sketchy = !TWEAKS.sketchy; applyTweaks(); persist(); };
    document.getElementById('tw-annot').onclick = () => { TWEAKS.annotations = !TWEAKS.annotations; applyTweaks(); persist(); };
    document.getElementById('tw-lang').onclick = () => { TWEAKS.lang = TWEAKS.lang === 'fr' ? 'en' : 'fr'; applyTweaks(); persist(); };
    document.querySelectorAll('.accent-swatch').forEach(s => {
      s.onclick = () => { TWEAKS.accent = s.dataset.accent; applyTweaks(); persist(); };
    });
  }

  // Edit-mode protocol --------------------------------------------------------
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === '__activate_edit_mode') {
      // no-op: tweaks are always visible in top bar in this design
    }
  });
  try { window.parent.postMessage({type: '__edit_mode_available'}, '*'); } catch(e){}

  // Init ----------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    render();
    wireTweaks();
    applyTweaks();
  });
})();
