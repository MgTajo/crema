(function(){
  "use strict";
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
  }
  tabs.forEach(function(t){
    t.addEventListener('click', function(){ show(t.getAttribute('data-lang')); });
  });
  var preferred = (navigator.language || '').toLowerCase().indexOf('de') === 0 ? 'de' : 'en';
  if (preferred !== 'de') show(preferred);
})();
