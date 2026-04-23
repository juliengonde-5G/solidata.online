window.SOLIDATA_APP = window.SOLIDATA_APP || { screens: {}, current: null };
// ============== TEST PCM (v1 — pictos + audio, 1 écran) ==============
(function(){
  const steps = 12;
  const current = 3; // question 3 of 12

  const volume = '<svg class="ic" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19 12c0-1.9-.7-3.6-2-5"/><path d="M22 12c0-3.3-1.3-6.3-3.5-8.5"/></svg>';

  window.SOLIDATA_APP.screens.pcm = {
    html: () => `
      <div class="page-header" style="text-align:center;">
        <span class="chip chip-teal" style="margin-bottom:8px;"><span class="chip-dot"></span>Test en cours · Marie Durand</span>
        <h1 class="page-title">Test PCM</h1>
        <p class="page-sub">Réponds comme tu le sens · il n'y a pas de mauvaise réponse.</p>
      </div>

      <div class="pcm-wrap">
        <div class="pcm-progress">
          ${Array.from({length: steps}).map((_,i) => {
            if (i < current-1) return '<span class="pcm-step done"></span>';
            if (i === current-1) return '<span class="pcm-step current"></span>';
            return '<span class="pcm-step"></span>';
          }).join('')}
          <span class="pcm-count">${current} / ${steps}</span>
        </div>

        <div class="pcm-card">
          <button class="pcm-audio">${volume} Écouter la question</button>
          <div class="pcm-question">Au travail, je me sens mieux…</div>

          <div class="pcm-choices">
            <button class="pcm-choice" data-choice="0">
              <div class="pcm-choice-icon">👥</div>
              <div class="pcm-choice-text">avec les autres</div>
            </button>
            <button class="pcm-choice" data-choice="1">
              <div class="pcm-choice-icon">👤</div>
              <div class="pcm-choice-text">tout seul</div>
            </button>
          </div>

          <p class="pcm-help">Tu peux changer ta réponse avant de passer à la question suivante.</p>
        </div>

        <div class="pcm-nav">
          <button class="btn btn-ghost">← Question précédente</button>
          <button class="btn btn-primary" id="pcm-next" disabled style="opacity:.5">Question suivante →</button>
        </div>
      </div>
    `,
    init: (host) => {
      const choices = host.querySelectorAll('.pcm-choice');
      const next = host.querySelector('#pcm-next');
      choices.forEach(c => c.addEventListener('click', () => {
        choices.forEach(x => x.classList.remove('selected'));
        c.classList.add('selected');
        next.disabled = false;
        next.style.opacity = 1;
      }));
    }
  };
})();
