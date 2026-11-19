// Flip to true when you drop the message on the day.
// For testing before that, open your site with ?test=1 at the end of the URL.
const ALLOCATIONS_OPEN = false;
const CLOSED_MESSAGE = 'Allocations will be provided on 10th December';

export function initAllocation() {
  const overlay = document.createElement('div');
  overlay.id = 'alloc-overlay';
  overlay.innerHTML = `
    <div class="alloc-box" role="dialog" aria-modal="true">
      <button class="alloc-close" aria-label="Close">&times;</button>
      <p class="alloc-eyebrow">Theme Allocation</p>

      <div id="alloc-step1">
        <h2 class="alloc-title">Find your team.</h2>
        <p class="alloc-text">Enter your team name exactly as you registered it.</p>
        <label class="alloc-label" for="alloc-team">Team name</label>
        <input class="alloc-input" id="alloc-team" type="text" placeholder="e.g. Team Alpha" autocomplete="off" />
        <div class="alloc-msg" id="alloc-msg1"></div>
        <button class="alloc-btn" id="alloc-find">Find my team</button>
      </div>

      <div id="alloc-step2" style="display:none">
        <h2 class="alloc-title">Your allocation.</h2>
        <p class="alloc-teamline">Team <strong id="alloc-name"></strong></p>

        <div class="alloc-themebox">
          <span class="alloc-label">Your theme</span>
          <div class="alloc-theme" id="alloc-theme"></div>
        </div>

        <div id="alloc-pick">
          <label class="alloc-label" for="alloc-select">Choose your problem statement</label>
          <select class="alloc-select" id="alloc-select"></select>
          <div class="alloc-msg" id="alloc-msg2"></div>
          <button class="alloc-btn" id="alloc-submit">Submit problem statement</button>

          <div class="alloc-confirm" id="alloc-confirm" style="display:none">
            <p>Lock in this problem statement? This cannot be changed.</p>
            <strong id="alloc-confirm-title"></strong>
            <div class="alloc-row">
              <button class="alloc-btn ghost" id="alloc-back">Go back</button>
              <button class="alloc-btn" id="alloc-yes">Confirm</button>
            </div>
          </div>
        </div>

        <div class="alloc-done" id="alloc-done" style="display:none">
          <span class="alloc-label">Your problem statement</span>
          <strong id="alloc-done-title"></strong>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (s) => overlay.querySelector(s);
  let team = '';
  let busy = false;

  const open = () => { overlay.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const close = () => { overlay.classList.remove('open'); document.body.style.overflow = ''; };
  const msg = (sel, text, ok = false) => {
    const el = $(sel);
    el.textContent = text;
    el.className = 'alloc-msg' + (ok ? ' ok' : '');
  };

  function showPick() {
    $('#alloc-confirm').style.display = 'none';
    $('#alloc-submit').style.display = 'block';
    $('#alloc-select').disabled = false;
  }

  function render(d) {
    team = d.team;
    $('#alloc-step1').style.display = 'none';
    $('#alloc-step2').style.display = 'block';
    $('#alloc-name').textContent = d.team;
    $('#alloc-theme').textContent = d.theme;

    if (d.claimed) {
      $('#alloc-pick').style.display = 'none';
      $('#alloc-done').style.display = 'block';
      $('#alloc-done-title').textContent = d.claimed.title;
      return;
    }

    $('#alloc-pick').style.display = 'block';
    $('#alloc-done').style.display = 'none';
    showPick();

    const sel = $('#alloc-select');
    sel.innerHTML = '';
    if (!d.problems.length) {
      sel.innerHTML = '<option value="">No problem statements left</option>';
      $('#alloc-submit').disabled = true;
      return;
    }
    $('#alloc-submit').disabled = false;
    d.problems.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.title;
      sel.appendChild(o);
    });
  }

  async function fetchTeam(name) {
    const r = await fetch('/api/problems?team=' + encodeURIComponent(name));
    return { ok: r.ok, d: await r.json() };
  }

  // Step 1: find team
  async function findTeam() {
    const name = $('#alloc-team').value.trim();
    if (!name) return msg('#alloc-msg1', 'Please enter your team name.');
    const btn = $('#alloc-find');
    btn.disabled = true;
    msg('#alloc-msg1', '');
    try {
      const { ok, d } = await fetchTeam(name);
      if (!ok) msg('#alloc-msg1', d.error || 'Something went wrong.');
      else render(d);
    } catch {
      msg('#alloc-msg1', 'Network error. Please try again.');
    }
    btn.disabled = false;
  }
  $('#alloc-find').addEventListener('click', findTeam);
  $('#alloc-team').addEventListener('keydown', (e) => { if (e.key === 'Enter') findTeam(); });

  // Step 2: pick, confirm, claim
  $('#alloc-submit').addEventListener('click', () => {
    const sel = $('#alloc-select');
    if (!sel.value) return;
    msg('#alloc-msg2', '');
    $('#alloc-confirm-title').textContent = sel.options[sel.selectedIndex].textContent;
    $('#alloc-submit').style.display = 'none';
    $('#alloc-select').disabled = true;
    $('#alloc-confirm').style.display = 'block';
  });
  $('#alloc-back').addEventListener('click', showPick);

  $('#alloc-yes').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const btn = $('#alloc-yes');
    btn.disabled = true;
    const id = Number($('#alloc-select').value);
    try {
      const r = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team, problemId: id }),
      });
      const d = await r.json();
      if (r.ok) {
        render({ team, theme: $('#alloc-theme').textContent, claimed: { title: d.problem } });
      } else {
        const fresh = await fetchTeam(team);
        if (fresh.ok) render(fresh.d);
        msg('#alloc-msg2', d.error || 'Something went wrong.');
      }
    } catch {
      showPick();
      msg('#alloc-msg2', 'Network error. Please try again.');
    }
    btn.disabled = false;
    busy = false;
  });

  // Keep the dropdown fresh while it's open (taken problems disappear)
  setInterval(async () => {
    if (!overlay.classList.contains('open') || !team || busy || document.hidden) return;
    if ($('#alloc-step2').style.display === 'none') return;
    if ($('#alloc-pick').style.display === 'none') return;
    if ($('#alloc-confirm').style.display === 'block') return;
    const sel = $('#alloc-select');
    const current = sel.value;
    try {
      const { ok, d } = await fetchTeam(team);
      if (!ok) return;
      render(d);
      if ([...sel.options].some((o) => o.value === current)) sel.value = current;
    } catch {}
  }, 20000);

  // Close handlers
  $('.alloc-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // Any element with class "allocation-link" opens the popup
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.allocation-link')) return;
    e.preventDefault();
    const testing = new URLSearchParams(location.search).has('test');
    if (!ALLOCATIONS_OPEN && !testing) return alert(CLOSED_MESSAGE);
    open();
  });
}