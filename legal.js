(function(){
  "use strict";
  /* ============================================================
     The three legal documents — Impressum, Datenschutz, Child Safety.

     They are separate pages on purpose: App Review follows the privacy
     URL on a device that may be offline, a link somebody sends has to
     open something, and crema-app.com/privacy/ has to keep working
     whether or not the app is installed. So this is not the app; it is
     three documents that borrow the app's design tokens.

     What this file does is make them feel like they belong to it
     anyway — the same language, the same theme, and a way back that
     lands where the reader came from. Everything here degrades to a
     perfectly readable document if it fails.
     ============================================================ */

  /* ---------- 1. which language ----------
     `crema.lang` is the app's own key (src/i18n.js) — deliberately
     unscoped and outside the store, because the app has to know the
     language before a session resolves. These pages are same-origin
     with it in every build, including the Capacitor shell, where both
     come off the local server. Somebody who has switched Crema to
     German should not have to switch this too. */
  function preferredLang(){
    try{
      var saved = localStorage.getItem('crema.lang');
      if(saved === 'de' || saved === 'en') return saved;
    }catch(e){}
    return (navigator.language || '').toLowerCase().indexOf('de') === 0 ? 'de' : 'en';
  }

  var blocks = document.querySelectorAll('[data-lang-block]');
  var tabs = document.querySelectorAll('.legal-lang [data-lang]');
  function show(lang){
    blocks.forEach(function(b){ b.hidden = b.getAttribute('data-lang-block') !== lang; });
    tabs.forEach(function(t){
      var on = t.getAttribute('data-lang') === lang;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.documentElement.lang = lang;
    /* Remembered, so the choice survives a jump between Impressum and
       Datenschutz — and so switching here switches the app too, which
       is the least surprising thing this could do. */
    try{ localStorage.setItem('crema.lang', lang); }catch(e){}
    paintBar(lang);
  }
  tabs.forEach(function(t){
    t.addEventListener('click', function(){ show(t.getAttribute('data-lang')); });
  });

  /* ---------- 2. the app's theme, not the system's ----------
     styles.css follows prefers-color-scheme, which is right for a page
     opened cold and wrong for one opened from inside an app whose theme
     the reader has already chosen. applyTheme() in ui/actions.js mirrors
     the RESOLVED theme to `crema.theme` for exactly this. Absent — a
     visitor who has never opened the app — leaves the system preference
     in charge, which is the correct default. */
  try{
    var th = localStorage.getItem('crema.theme');
    if(th === 'dark' || th === 'light') document.documentElement.setAttribute('data-theme', th);
  }catch(e){}

  /* ---------- 3. the way back ----------
     Three ways in, and they need different ways out. From Settings or
     from the landing page's footer there is history to go back to, and
     going back is what keeps the app where it was — a href to "../"
     would reload Crema from scratch and lose the sheet that was open.
     From a link somebody sent there is no history, and the honest exit
     is the app's front door.

     document.referrer is the test rather than history.length, which
     counts entries this tab made before it ever reached Crema. */
  var LABEL = {
    de: { back:'Zurück', home:'Zu Crema' },
    en: { back:'Back',   home:'To Crema' }
  };
  var cameFromCrema = (function(){
    try{ return !!document.referrer && new URL(document.referrer).origin === location.origin; }
    catch(e){ return false; }
  })();

  var bar = null;
  function paintBar(lang){
    var L = LABEL[lang] || LABEL.en;
    var title = (document.querySelector('article:not([hidden]) h1') || {}).textContent || 'Crema';
    if(!bar){
      bar = document.createElement('div');
      bar.className = 'legal-bar';
      var page = document.querySelector('.legal-page');
      if(!page || !page.parentNode) return;
      page.parentNode.insertBefore(bar, page);
      document.body.classList.add('has-bar');
    }
    bar.innerHTML = '';
    var b = document.createElement('b');
    b.textContent = title;
    var x = document.createElement(cameFromCrema ? 'button' : 'a');
    x.className = 'legal-x';
    x.textContent = '← ' + (cameFromCrema ? L.back : L.home);
    if(cameFromCrema) x.addEventListener('click', function(){ history.back(); });
    else x.setAttribute('href', '../');
    bar.appendChild(b);
    bar.appendChild(x);
  }

  show(preferredLang());
})();
