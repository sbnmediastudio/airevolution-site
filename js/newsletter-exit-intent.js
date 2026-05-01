/**
 * Exit-intent newsletter popup — The Tech Room.
 *
 * Triggers ONCE per visitor (localStorage suppression) when:
 *   - the cursor leaves through the top of the viewport on desktop, OR
 *   - the user has been on a page for 25+ seconds AND has scrolled past 60%
 *     (mobile fallback — exit-intent doesn't work without a mouse).
 *
 * Honours a 30-day cool-down: dismissal or successful signup both write to
 * localStorage so the popup stays out of the user's way.
 *
 * Self-contained — no framework dependency. Append <script defer src="...">
 * to the bottom of every page.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'sbn_newsletter_exit_intent_dismissed_until';
  var COOLDOWN_DAYS = 30;
  var MOBILE_DWELL_MS = 25000;
  var MOBILE_SCROLL_THRESHOLD = 0.6;

  function suppressed() {
    try {
      var until = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      return until && Date.now() < until;
    } catch (e) { return false; }
  }
  function suppress(days) {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now() + days * 86400 * 1000));
    } catch (e) { /* private mode — fine, popup will fire again next visit */ }
  }

  if (suppressed()) return;
  if (window.location.pathname === '/subscribe.html') return;

  function buildPopup() {
    var wrap = document.createElement('div');
    wrap.id = 'sbn-exit-intent';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'sbn-exit-intent-title');
    wrap.innerHTML = ''
      + '<div class="sbn-ei__backdrop" aria-hidden="true"></div>'
      + '<div class="sbn-ei__card">'
      + '  <button class="sbn-ei__close" aria-label="Dismiss">&times;</button>'
      + '  <h2 class="sbn-ei__title" id="sbn-exit-intent-title">Before you go &mdash; the briefing.</h2>'
      + '  <p class="sbn-ei__body">One free email a week. The semiconductor stories that actually moved the industry, written like a colleague would explain them to you. No fluff, no PR copy.</p>'
      + '  <form class="sbn-ei__form" action="/subscribe.html" method="get">'
      + '    <input class="sbn-ei__input" type="email" name="email" required placeholder="your@email.com" autocomplete="email">'
      + '    <button class="sbn-ei__submit" type="submit">Subscribe free</button>'
      + '  </form>'
      + '  <p class="sbn-ei__note">Unsubscribe in one click. We never share your address.</p>'
      + '</div>';
    return wrap;
  }

  var styleEl = document.createElement('style');
  styleEl.textContent = ''
    + '#sbn-exit-intent{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;font-family:inherit}'
    + '#sbn-exit-intent.sbn-ei--visible{display:flex}'
    + '.sbn-ei__backdrop{position:absolute;inset:0;background:rgba(8,12,20,.78);backdrop-filter:blur(2px)}'
    + '.sbn-ei__card{position:relative;max-width:460px;width:calc(100% - 32px);background:#0f1320;color:#fff;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:1.75rem 1.75rem 1.5rem;box-shadow:0 24px 64px rgba(0,0,0,.5)}'
    + '.sbn-ei__close{position:absolute;top:.5rem;right:.75rem;background:transparent;border:0;color:#9aa4b3;font-size:1.6rem;line-height:1;cursor:pointer;padding:.25rem .6rem;border-radius:8px}'
    + '.sbn-ei__close:hover{color:#fff;background:rgba(255,255,255,.06)}'
    + '.sbn-ei__title{font-size:1.35rem;line-height:1.25;margin:.25rem 0 .75rem;font-weight:700}'
    + '.sbn-ei__body{font-size:.95rem;line-height:1.55;color:#c5cdd9;margin:0 0 1.25rem}'
    + '.sbn-ei__form{display:flex;gap:.5rem;flex-wrap:wrap}'
    + '.sbn-ei__input{flex:1 1 200px;min-width:0;padding:.7rem .85rem;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);color:#fff;font:inherit}'
    + '.sbn-ei__input:focus{outline:0;border-color:#06b6d4;box-shadow:0 0 0 3px rgba(6,182,212,.18)}'
    + '.sbn-ei__submit{padding:.7rem 1.1rem;border-radius:8px;border:0;background:#06b6d4;color:#001018;font-weight:700;cursor:pointer;font:inherit}'
    + '.sbn-ei__submit:hover{background:#22cce6}'
    + '.sbn-ei__note{font-size:.78rem;color:#7c8593;margin:.85rem 0 0}';
  document.head.appendChild(styleEl);

  var popup = null;
  function show() {
    if (popup) return;
    popup = buildPopup();
    document.body.appendChild(popup);
    requestAnimationFrame(function () { popup.classList.add('sbn-ei--visible'); });
    popup.querySelector('.sbn-ei__close').addEventListener('click', dismiss);
    popup.querySelector('.sbn-ei__backdrop').addEventListener('click', dismiss);
    popup.querySelector('.sbn-ei__form').addEventListener('submit', function () {
      suppress(COOLDOWN_DAYS * 12); /* successful intent: 360-day cool-down */
    });
    document.addEventListener('keydown', escClose);
  }
  function dismiss() {
    suppress(COOLDOWN_DAYS);
    if (popup) { popup.remove(); popup = null; }
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') dismiss(); }

  // Desktop: fire when the cursor leaves through the top edge.
  document.addEventListener('mouseout', function (e) {
    if (e.relatedTarget === null && e.clientY <= 0) show();
  });

  // Mobile fallback: dwell + scroll-depth.
  var landedAt = Date.now();
  function maybeShowOnScroll() {
    if (popup) return;
    if (Date.now() - landedAt < MOBILE_DWELL_MS) return;
    var doc = document.documentElement;
    var scrolled = (doc.scrollTop + window.innerHeight) / doc.scrollHeight;
    if (scrolled >= MOBILE_SCROLL_THRESHOLD) show();
  }
  window.addEventListener('scroll', maybeShowOnScroll, { passive: true });
})();
