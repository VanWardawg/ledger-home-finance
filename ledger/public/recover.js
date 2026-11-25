// A page that can't load its own files reloads itself once, instead of sitting blank.
//
// After an update the app's script and style files have new names. A phone that still holds the page from
// before (a home-screen app brought back from the background, say) asks for the old names, gets nothing, and
// shows an empty white screen. This small file has a name that never changes, so the old page can still load
// it. It reloads the page once when one of the app's own files fails to load, or when nothing has been drawn
// a few seconds after opening. Once only per minute, so a server that is really down doesn't cause a loop.
(function () {
  var KEY = 'ledger-recovered-at';
  function again() {
    try {
      var last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last < 60000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (e) { return; }
    location.reload();
  }
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (!t || t === window) return;
    var src = String((t.tagName === 'LINK' ? t.href : t.src) || '');
    if ((t.tagName === 'SCRIPT' || t.tagName === 'LINK') && src.indexOf('/assets/') >= 0) again();
  }, true);
  setTimeout(function () {
    var root = document.getElementById('root');
    if (root && !root.firstChild) again();
  }, 6000);
})();
