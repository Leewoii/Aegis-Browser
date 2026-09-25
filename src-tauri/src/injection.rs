/// JavaScript injected into child webviews (tabs and panels) on page load.
/// Split into two scripts:
///
/// - `NAV_SCRIPT`: link / popup / window.open interception. Replaces native
///   popup behaviour, so it stays OFF on streaming hosts that rely on native
///   popups, media and DRM flows (Netflix, Crunchyroll).
/// - `PLAYER_SCRIPT`: everything a video player needs regardless of site —
///   fake element-fullscreen (all Fullscreen API variants), keyboard
///   shortcuts, title reporting, activity pings, webview error forwarding.
///   This MUST run on every site including Netflix/Crunchyroll, otherwise
///   their fullscreen buttons hit unhandled native fullscreen and appear
///   to do nothing (or cover the taskbar with a stuck window).

const NAV_SCRIPT: &str = r#"
(function(){
  // Never inject into sandboxed iframes or about:blank frames
  try {
    if (window !== window.top || !window.location || !window.location.href || window.location.href.startsWith('about:')) {
      return;
    }
  } catch(_) {
    return;
  }

  if (window.__sxNavIntercepted) return;
  window.__sxNavIntercepted = true;

  function sxResolveUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    var trimmed = rawUrl.trim();
    if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      return null;
    }
    try {
      return new URL(trimmed, window.location.href).href;
    } catch(_) {
      return trimmed;
    }
  }

  function sxOpenNewTab(url) {
    var fullUrl = sxResolveUrl(url);
    if (!fullUrl) return;
    try {
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = 'sx-internal://open-new-tab?url=' + encodeURIComponent(fullUrl) + '&t=' + Date.now();
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(function() {
        if (a && a.parentNode) a.parentNode.removeChild(a);
      }, 100);
    } catch(e) {
      console.error('[sx-intercept] Failed to open new tab:', e);
    }
  }

  function sxTriggerDownload(url) {
    var fullUrl = sxResolveUrl(url);
    if (!fullUrl) return;
    try {
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = 'sx-internal://download?url=' + encodeURIComponent(fullUrl) + '&t=' + Date.now();
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(function() {
        if (a && a.parentNode) a.parentNode.removeChild(a);
      }, 100);
    } catch(e) {
      console.error('[sx-intercept] Failed to trigger download:', e);
    }
  }

  function isDownloadUrl(url) {
    if (!url) return false;
    var lower = url.toLowerCase();
    if (lower.indexOf('response-content-disposition=attachment') !== -1 || lower.indexOf('rscd=attachment') !== -1) return true;
    var withoutQuery = lower.split('?')[0].split('#')[0];
    return /\.(exe|msi|zip|7z|rar|tar\.gz|tgz|dmg|pkg|deb|rpm|appimage|iso|pdf|msix|apk)(\?.*)?$/i.test(withoutQuery);
  }

  // 1. Intercept window.open
  window.open = function(url) {
    if (url) {
      sxOpenNewTab(url);
    }
    return window;
  };

  // 2. Intercept link clicks:
  // - download attribute or download-like URL -> trigger download
  // - Ctrl + Left Click (Windows/Linux) or Cmd + Left Click (Mac)
  // - Middle Click (auxclick / button === 1)
  // - target="_blank" or target="_new"
  function handleLinkClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) return;

    // Download handling takes priority
    if (a.hasAttribute('download') || isDownloadUrl(a.href)) {
      // Only intercept normal left clicks for downloads (not ctrl/middle which is new tab)
      var isPlainLeftClick = e.button === 0 && !e.ctrlKey && !e.metaKey;
      if (isPlainLeftClick && e.type === 'click') {
        e.preventDefault();
        e.stopPropagation();
        sxTriggerDownload(a.href);
        return;
      }
    }

    var isCtrlOrCmd = e.ctrlKey || e.metaKey;
    var isMiddleClick = e.button === 1 || e.which === 2;
    var target = (a.getAttribute('target') || a.target || '').toLowerCase();
    var isBlank = target === '_blank' || target === '_new';

    if (isCtrlOrCmd || isMiddleClick || isBlank) {
      e.preventDefault();
      e.stopPropagation();
      sxOpenNewTab(a.href);
    }
  }

  document.addEventListener('click', handleLinkClick, true);
  document.addEventListener('auxclick', handleLinkClick, true);

  // 3. Form submissions with target="_blank"
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form && form.tagName === 'FORM') {
      var t = (form.getAttribute('target') || form.target || '').toLowerCase();
      if (t === '_blank' || t === '_new') {
        e.preventDefault();
        e.stopPropagation();
        try {
          var formData = new FormData(form);
          var params = [];
          for (var pair of formData.entries()) {
            params.push(encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]));
          }
          var actionUrl = form.action || window.location.href;
          var sep = actionUrl.indexOf('?') >= 0 ? '&' : '?';
          sxOpenNewTab(actionUrl + sep + params.join('&'));
        } catch(_) {
          sxOpenNewTab(form.action || window.location.href);
        }
      }
    }
  }, true);

  // 4. Custom context menu for links (Right-click "Open in New Tab", "Copy Link Address", etc.)
  var activeMenu = null;

  function removeContextMenu() {
    if (activeMenu && activeMenu.parentNode) {
      activeMenu.parentNode.removeChild(activeMenu);
    }
    activeMenu = null;
  }

  document.addEventListener('contextmenu', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) {
      removeContextMenu();
      return;
    }

    var fullUrl = sxResolveUrl(a.href);
    if (!fullUrl) return;

    e.preventDefault();
    e.stopPropagation();
    removeContextMenu();

    var menu = document.createElement('div');
    menu.id = '__sx_ctx_menu';
    menu.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'background: #11131c',
      'border: 1px solid #2d3142',
      'border-radius: 8px',
      'box-shadow: 0 10px 28px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
      'padding: 5px',
      'min-width: 190px',
      'font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
      'font-size: 13px',
      'color: #e2e8f0',
      'user-select: none',
      'backdrop-filter: blur(16px)',
    ].join(';');

    var x = e.clientX;
    var y = e.clientY;

    function createItem(label, shortcut, onClick) {
      var item = document.createElement('div');
      item.style.cssText = [
        'display: flex',
        'align-items: center',
        'justify-content: space-between',
        'padding: 7px 10px',
        'border-radius: 5px',
        'cursor: pointer',
        'transition: background 0.1s ease',
        'gap: 12px',
        'line-height: 1.2',
      ].join(';');

      var labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      item.appendChild(labelSpan);

      if (shortcut) {
        var scSpan = document.createElement('span');
        scSpan.style.cssText = 'color: #717b99; font-size: 11px;';
        scSpan.textContent = shortcut;
        item.appendChild(scSpan);
      }

      item.addEventListener('mouseenter', function() {
        item.style.background = '#222638';
      });
      item.addEventListener('mouseleave', function() {
        item.style.background = 'transparent';
      });
      item.addEventListener('click', function(ev) {
        ev.stopPropagation();
        removeContextMenu();
        onClick();
      });
      return item;
    }

    menu.appendChild(createItem('Open Link in New Tab', 'Ctrl+Click', function() {
      sxOpenNewTab(fullUrl);
    }));

    var sep = document.createElement('div');
    sep.style.cssText = 'height: 1px; background: #1e2235; margin: 4px 0;';
    menu.appendChild(sep);

    menu.appendChild(createItem('Copy Link Address', '', function() {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(fullUrl);
        } else {
          var input = document.createElement('textarea');
          input.value = fullUrl;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          document.body.removeChild(input);
        }
      } catch(_) {}
    }));

    (document.body || document.documentElement).appendChild(menu);

    // Reposition if overflowing viewport
    var rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
      x = Math.max(10, window.innerWidth - rect.width - 10);
    }
    if (y + rect.height > window.innerHeight) {
      y = Math.max(10, window.innerHeight - rect.height - 10);
    }
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    activeMenu = menu;
  }, true);

  // Close context menu on any outside click, scroll, resize or blur
  window.addEventListener('pointerdown', function(e) {
    if (activeMenu && !activeMenu.contains(e.target)) {
      removeContextMenu();
    }
  }, true);
  window.addEventListener('scroll', removeContextMenu, true);
  window.addEventListener('resize', removeContextMenu, true);
  window.addEventListener('blur', removeContextMenu, true);
  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { removeContextMenu(); return; }
  }, true);
})();
"#;

const PLAYER_SCRIPT: &str = r#"
(function(){
  // Top-level documents only (never sandboxed iframes / about:blank)
  try {
    if (window !== window.top || !window.location || !window.location.href || window.location.href.startsWith('about:')) {
      return;
    }
  } catch(_) {
    return;
  }

  // Re-eval guard: prototype overrides are idempotent, but adopt any
  // in-progress fake fullscreen into the fresh closure state.
  if (window.__sxPlayerReady) {
    try { if (window.__aegisAdoptFs) window.__aegisAdoptFs(); } catch(_) {}
    return;
  }
  window.__sxPlayerReady = true;

  // 1. Activity notification to parent window (click/pointerdown in webview) — auto-hide unpinned sidepanel/sidebar
  var sxLastNotify = 0;
  function sxNotifyActivity() {
    var now = Date.now();
    if (now - sxLastNotify < 150) return;
    sxLastNotify = now;
    try {
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = 'sx-internal://user-click?' + now;
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(function() {
        if (a && a.parentNode) a.parentNode.removeChild(a);
      }, 50);
    } catch(_) {}
  }

  window.addEventListener('pointerdown', sxNotifyActivity, true);
  window.addEventListener('mousedown', sxNotifyActivity, true);
  window.addEventListener('click', sxNotifyActivity, true);
  window.addEventListener('touchstart', sxNotifyActivity, true);
  document.addEventListener('pointerdown', sxNotifyActivity, true);
  document.addEventListener('mousedown', sxNotifyActivity, true);
  document.addEventListener('click', sxNotifyActivity, true);
  document.addEventListener('touchstart', sxNotifyActivity, true);

  // 2. Forward browsed-website JS errors / console to Dev Console (webview category) — filtered for YouTube noise
  function isIgnorableWebviewMsg(msg){
    if(!msg) return false;
    var s=String(msg).toLowerCase();
    if (s.includes('googleads.g.doubleclick.net') || s.includes('was preloaded using link preload') || s.includes('preloaded using link preload but not used') || (s.includes('access to fetch') && s.includes('blocked by cors')) || s.includes('net::err_failed 302') || s.includes('viewthroughconversion')) return true;
    // OneTrust consent-banner SDK noise (Netflix etc.) — third-party consent
    // scripts fighting their own sandboxed iframes / unexposed CORS headers.
    // Benign: it never affects playback, it just spams the console.
    if (s.includes('onetrust') || s.includes('otsdkstub') || s.includes('otbannersdk') || s.includes('allow-scripts') || s.includes('optanon') || s.includes('cookie-banner') || s.includes('truste')) return true;
    return false;
  }
  function sxReportWebviewLog(level, title, message, stack, filename) {
    try {
      if(isIgnorableWebviewMsg(message) || isIgnorableWebviewMsg(title) || isIgnorableWebviewMsg(stack)) return;
      var url = window.location.href || '';
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = 'sx-internal://webview-log?level=' + encodeURIComponent(level || 'error')
        + '&title=' + encodeURIComponent(title || 'WebView Error')
        + '&message=' + encodeURIComponent(message || '')
        + '&stack=' + encodeURIComponent(stack || '')
        + '&url=' + encodeURIComponent(url)
        + '&filename=' + encodeURIComponent(filename || '')
        + '&t=' + Date.now();
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(function(){ if(a && a.parentNode) a.parentNode.removeChild(a); }, 80);
    } catch(_) {}
  }

  window.addEventListener('error', function(e) {
    try {
      var msg = e.message || 'Unhandled WebView exception';
      if(isIgnorableWebviewMsg(msg) || isIgnorableWebviewMsg(e.filename)) return;
      var stk = e.error && e.error.stack ? e.error.stack : '';
      if(isIgnorableWebviewMsg(stk)) return;
      sxReportWebviewLog('error', 'Unhandled WebView Exception', msg, stk, e.filename || '');
    } catch(_) {}
  });

  window.addEventListener('unhandledrejection', function(e) {
    try {
      var reason = e.reason;
      var msg = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : (function(){ try{ return JSON.stringify(reason); }catch(_){ return String(reason); } })();
      if(isIgnorableWebviewMsg(msg)) return;
      var stk = reason instanceof Error ? (reason.stack || '') : '';
      if(isIgnorableWebviewMsg(stk)) return;
      sxReportWebviewLog('error', 'Unhandled Promise Rejection', msg || 'rejection', stk, '');
    } catch(_) {}
  }, true);

  (function(){
    try {
      var origConsoleError = console.error;
      console.error = function() {
        try { origConsoleError.apply(console, arguments); } catch(_) {}
        try {
          var msg = Array.prototype.slice.call(arguments).map(function(a){
            try { return a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(_) { return String(a); }
          }).join(' ');
          if(isIgnorableWebviewMsg(msg)) return;
          var stk = arguments[0] instanceof Error ? (arguments[0].stack || '') : '';
          if(isIgnorableWebviewMsg(stk)) return;
          sxReportWebviewLog('error', 'Console Error', msg.slice(0,1200), stk, '');
        } catch(_) {}
      };
      var origConsoleWarn = console.warn;
      console.warn = function() {
        try { origConsoleWarn.apply(console, arguments); } catch(_) {}
        try {
          var msg = Array.prototype.slice.call(arguments).map(function(a){
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(_) { return String(a); }
          }).join(' ');
          if(isIgnorableWebviewMsg(msg)) return;
          sxReportWebviewLog('warn', 'Console Warning', msg.slice(0,1200), '', '');
        } catch(_) {}
      };
      // Patch fetch for YouTube googleads — use no-cors to avoid CORS block noise
      try{
        var origFetch = window.fetch;
        window.fetch = function(input, init){
          try{
            var url = typeof input==='string' ? input : (input && input.url ? input.url : '');
            if(url && url.includes('googleads.g.doubleclick.net')){
              init = init || {};
              // Force no-cors + omit credentials so browser won't require ACAO header
              try{ init.mode='no-cors'; init.credentials='omit'; }catch(_){}
              // Also strip custom headers that trigger preflight
              try{ if(init.headers) delete init.headers; }catch(_){}
            }
          }catch(_){}
          return origFetch.apply(this, arguments);
        };
      }catch(_){}
      // Remove unused preload links that trigger "was preloaded but not used" warnings on YouTube
      try{
        var sel='link[rel="preload"][href*="generate_204"], link[rel="preload"][href*="kevlar_base"], link[rel="preload"][href*="ytmainappweb"]';
        var fix = function(){
          try{
            document.querySelectorAll(sel).forEach(function(l){
              // Instead of removing, change to prefetch + correct as to mark as used
              try{ l.setAttribute('rel','prefetch'); }catch(e){ try{ l.remove(); }catch(e2){} }
            });
          }catch(e){}
        };
        if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fix);
        else fix();
        // Also observe future added preloads
        try{
          new MutationObserver(function(muts){
            muts.forEach(function(m){
              m.addedNodes.forEach(function(n){
                if(n.tagName==='LINK' && n.getAttribute('rel')==='preload' && (n.href.includes('generate_204')||n.href.includes('kevlar_base'))){
                  try{ n.setAttribute('rel','prefetch'); }catch(e){}
                }
              });
            });
          }).observe(document.head, {childList:true});
        }catch(e){}
      }catch(e){}
    } catch(_) {}
  })();

  // 3. Fake element-fullscreen for video players — runs on EVERY site
  // (YouTube, Netflix, Crunchyroll, Twitch, generic HTML5 video, ...).
  // Intercepts all Fullscreen API entry points so the VIDEO element fills
  // the webview viewport instead of hitting unhandled native fullscreen
  // (which Tauri/WRY ignores — the button then appears to do nothing).
  // State lives on window so re-evals adopt in-progress fullscreen.
  (function(){
    var st = window.__aegisFs = window.__aegisFs || { el: null, video: null };

    function fsNotify(enter){
      try{
        var a=document.createElement('a');
        a.style.display='none';
        a.href='sx-internal://fullscreen?enter='+(enter?'1':'0')+'&t='+Date.now();
        (document.body||document.documentElement).appendChild(a);
        a.click();
        setTimeout(function(){ if(a&&a.parentNode) a.parentNode.removeChild(a); },80);
      }catch(_){}
    }

    function fsFindVideo(el){
      try{
        if(!el) return null;
        if(el.tagName==='VIDEO') return el;
        var vids = el.querySelectorAll ? el.querySelectorAll('video') : [];
        if(!vids || !vids.length) return null;
        var best=vids[0], bestArea=-1;
        for(var i=0;i<vids.length;i++){
          var area=0;
          try{ var r=vids[i].getBoundingClientRect(); area=r.width*r.height; }catch(_){}
          if(area>bestArea){ bestArea=area; best=vids[i]; }
        }
        return best;
      }catch(_){ return null; }
    }

    function fsDispatch(){
      try{
        var names=['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange'];
        for(var i=0;i<names.length;i++){ try{ document.dispatchEvent(new Event(names[i])); }catch(_){} }
      }catch(_){}
    }

    function fsEnsureStyle(){
      try{
        if(document.getElementById('__aegis_fs_style')) return;
        var css=document.createElement('style');
        css.id='__aegis_fs_style';
        css.textContent='html.aegis-video-fullscreen body{overflow:hidden!important;background:#000!important;margin:0!important}'
          + '#__aegis_fs_backdrop{position:fixed!important;inset:0!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;background:#000!important;z-index:2147483646!important;margin:0!important;padding:0!important;border:0!important}'
          + 'html.aegis-video-fullscreen .aegis-native-fullscreen{position:fixed!important;inset:0!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;max-width:100vw!important;max-height:100vh!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;z-index:2147483647!important;background:#000!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-direction:column!important;overflow:hidden!important}'
          + 'html.aegis-video-fullscreen .aegis-native-fullscreen video,html.aegis-video-fullscreen video.aegis-native-fullscreen-inner{width:100%!important;height:100%!important;max-width:100vw!important;max-height:100vh!important;object-fit:contain!important;background:#000!important;margin:0!important}'
          + 'html.aegis-video-fullscreen video:fullscreen,html.aegis-video-fullscreen video:-webkit-full-screen{width:100vw!important;height:100vh!important;object-fit:contain!important;background:#000!important}';
        (document.head||document.documentElement).appendChild(css);
      }catch(_){}
    }

    function fsExitSilent(){
      try{
        if(st.el){ try{ st.el.classList.remove('aegis-native-fullscreen'); }catch(_){} }
        try{
          var inn=document.querySelectorAll('.aegis-native-fullscreen-inner');
          for(var i=0;i<inn.length;i++){ try{ inn[i].classList.remove('aegis-native-fullscreen-inner'); }catch(_){} }
        }catch(_){}
        try{ document.documentElement.classList.remove('aegis-video-fullscreen'); }catch(_){}
        try{ var bd=document.getElementById('__aegis_fs_backdrop'); if(bd&&bd.parentNode) bd.parentNode.removeChild(bd); }catch(_){}
        st.el=null; st.video=null;
      }catch(_){}
    }

    function fsEnter(el){
      try{
        fsEnsureStyle();
        if(!el || !(el instanceof Element)) el=document.documentElement;
        if(st.el===el) return Promise.resolve();
        if(st.el) fsExitSilent();
        var video=fsFindVideo(el);
        st.el=el; st.video=video;
        el.classList.add('aegis-native-fullscreen');
        document.documentElement.classList.add('aegis-video-fullscreen');
        try{
          var all=el.querySelectorAll ? el.querySelectorAll('video') : [];
          for(var i=0;i<all.length;i++){ try{ all[i].classList.add('aegis-native-fullscreen-inner'); }catch(_){} }
        }catch(_){}
        try{
          var old=document.getElementById('__aegis_fs_backdrop');
          if(old&&old.parentNode) old.parentNode.removeChild(old);
          var bd=document.createElement('div');
          bd.id='__aegis_fs_backdrop';
          (document.body||document.documentElement).appendChild(bd);
        }catch(_){}
        fsNotify(true);
        setTimeout(fsDispatch, 0);
        return Promise.resolve();
      }catch(_){ return Promise.resolve(); }
    }

    function fsExit(){
      try{
        if(!st.el) return Promise.resolve();
        fsExitSilent();
        fsNotify(false);
        setTimeout(fsDispatch, 0);
        return Promise.resolve();
      }catch(_){ return Promise.resolve(); }
    }

    // Adopt native fullscreen that engaged before this script ran
    // (page called requestFullscreen during initial parse).
    function fsAdoptReal(){
      try{
        if(st.el) return;
        var r=null;
        try{ r=document.querySelector(':fullscreen'); }catch(_){}
        if(r) fsEnter(r);
      }catch(_){}
    }

    try{
      var reqFn=function(){ return fsEnter(this); };
      Element.prototype.requestFullscreen=reqFn;
      try{ Element.prototype.webkitRequestFullscreen=reqFn; }catch(_){}
      try{ Element.prototype.webkitRequestFullScreen=reqFn; }catch(_){}
      try{ Element.prototype.mozRequestFullScreen=reqFn; }catch(_){}
      try{ Element.prototype.msRequestFullscreen=reqFn; }catch(_){}
      // Legacy video-only entry points (WebKit fallbacks some players use)
      try{
        if(window.HTMLVideoElement){
          var vEnter=function(){ return fsEnter(this); };
          try{ HTMLVideoElement.prototype.webkitEnterFullscreen=vEnter; }catch(_){}
          try{ HTMLVideoElement.prototype.webkitEnterFullScreen=vEnter; }catch(_){}
        }
      }catch(_){}
      var origExit=Document.prototype.exitFullscreen;
      var exitFn=function(){
        try{ if(window.__aegisFs && window.__aegisFs.el) return fsExit(); }catch(_){}
        try{ return origExit ? origExit.apply(this,arguments) : Promise.resolve(); }catch(_){ return Promise.resolve(); }
      };
      Document.prototype.exitFullscreen=exitFn;
      try{ Document.prototype.webkitExitFullscreen=exitFn; }catch(_){}
      try{ Document.prototype.webkitCancelFullScreen=exitFn; }catch(_){}
      try{ Document.prototype.mozCancelFullScreen=exitFn; }catch(_){}
      try{ Document.prototype.msExitFullscreen=exitFn; }catch(_){}
      // State getters players poll (Netflix-style capability checks)
      var fsElGet=function(){ try{ return (window.__aegisFs && window.__aegisFs.el) || null; }catch(_){ return null; } };
      var fsBoolGet=function(){ try{ return !!(window.__aegisFs && window.__aegisFs.el); }catch(_){ return false; } };
      try{ Object.defineProperty(Document.prototype,'fullscreenElement',{get:fsElGet,configurable:true}); }catch(_){}
      try{ Object.defineProperty(Document.prototype,'webkitFullscreenElement',{get:fsElGet,configurable:true}); }catch(_){}
      try{ Object.defineProperty(Document.prototype,'mozFullScreenElement',{get:fsElGet,configurable:true}); }catch(_){}
      try{ Object.defineProperty(Document.prototype,'msFullscreenElement',{get:fsElGet,configurable:true}); }catch(_){}
      try{ Object.defineProperty(Document.prototype,'fullscreen',{get:fsBoolGet,configurable:true}); }catch(_){}
      try{ Object.defineProperty(Document.prototype,'webkitIsFullScreen',{get:fsBoolGet,configurable:true}); }catch(_){}
      window.__aegisEnterFs=fsEnter;
      window.__aegisExitFs=fsExit;
      window.__aegisAdoptFs=function(){
        try{
          if(!st.el){
            var e=document.querySelector('.aegis-native-fullscreen');
            if(e){ st.el=e; st.video=fsFindVideo(e); }
          }
        }catch(_){}
      };
      document.addEventListener('fullscreenchange', fsAdoptReal, true);
      setTimeout(fsAdoptReal, 1500);
    }catch(_){}
  })();

  // 4. Forward browser keyboard shortcuts to the main Aegis window.
  //    When the child webview has focus, key events never reach the React layer.
  //    We intercept them here and signal Aegis via sx-internal://.
  function sxSignal(action) {
    try {
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = 'sx-internal://shortcut?action=' + action + '&t=' + Date.now();
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(function() { if (a && a.parentNode) a.parentNode.removeChild(a); }, 100);
    } catch(_) {}
  }

  window.addEventListener('keydown', function(e) {
    // Esc exits fake video fullscreen in-page (main window never sees the
    // keypress while the webview is focused). Idempotent with players that
    // call document.exitFullscreen() themselves on Esc.
    if (e.key === 'Escape') {
      try { if (window.__aegisFs && window.__aegisFs.el && window.__aegisExitFs) window.__aegisExitFs(); } catch(_) {}
      return;
    }

    var ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      e.stopPropagation();
      sxSignal('close-tab');
      return;
    }
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      e.stopPropagation();
      sxSignal('new-tab');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      sxSignal(e.shiftKey ? 'prev-tab' : 'next-tab');
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      e.stopPropagation();
      sxSignal('reload');
      return;
    }
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      e.stopPropagation();
      sxSignal('focus-url');
      return;
    }
  }, true);

  // 5. Notify main window of document title for history / tab title.
  function sxNotifyTitle() {
    try {
      var t = (document.title || '').trim();
      if (!t) return;
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = 'sx-internal://page-title?title=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(window.location.href) + '&t=' + Date.now();
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(function(){ if(a && a.parentNode) a.parentNode.removeChild(a); }, 100);
    } catch(_){}
  }
  if (document.readyState === 'complete') sxNotifyTitle();
  else window.addEventListener('load', sxNotifyTitle, {once:true});
  // Observe title element changes (SPA navigations update document.title without reload)
  try {
    var titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(sxNotifyTitle).observe(titleEl, {childList:true, subtree:true, characterData:true});
    } else if (document.head) {
      new MutationObserver(function(){ var el=document.querySelector('title'); if(el) sxNotifyTitle(); }).observe(document.head, {childList:true, subtree:true});
    }
    document.addEventListener('DOMContentLoaded', sxNotifyTitle, {once:true});
  } catch(_){}
  setTimeout(sxNotifyTitle, 800);
  setTimeout(sxNotifyTitle, 2000);

  // 6. Fix YouTube service worker navigation preload cancelled + preload unused warnings (skeleton)
  (function(){
    // Disable navigation preload which causes "preloadResponse was cancelled" when service worker doesn't use waitUntil
    try{
      if('serviceWorker' in navigator){
        navigator.serviceWorker.ready.then(function(reg){
          try{ if(reg.navigationPreload) reg.navigationPreload.disable().catch(function(){}); }catch(e){}
        }).catch(function(){});
        // Patch future registrations
        try{
          var origReg = navigator.serviceWorker.register;
          if(origReg){
            navigator.serviceWorker.register = function(){
              var p = origReg.apply(this, arguments);
              p.then(function(reg){ try{ if(reg.navigationPreload) reg.navigationPreload.disable().catch(function(){}); }catch(e){} }).catch(function(){});
              return p;
            };
          }
        }catch(e){}
      }
    }catch(e){}
    // Remove the two YouTube preload links that are never used in WebView2 (generate_204 + kevlar_base) to silence warnings
    // The HAR shows they are fetched but not used due to service worker cache, causing "was preloaded but not used"
    try{
      var sel='link[rel="preload"][href*="generate_204"], link[rel="preload"][href*="kevlar_base"], link[rel="preload"][href*="ytmainappweb"]';
      var fix = function(){
        try{
          document.querySelectorAll(sel).forEach(function(l){
            // Instead of removing, change to prefetch + correct as to mark as used
            try{ l.setAttribute('rel','prefetch'); }catch(e){ try{ l.remove(); }catch(e2){} }
          });
        }catch(e){}
      };
      if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fix);
      else fix();
      // Also observe future added preloads
      try{
        new MutationObserver(function(muts){
          muts.forEach(function(m){
            m.addedNodes.forEach(function(n){
              if(n.tagName==='LINK' && n.getAttribute('rel')==='preload' && (n.href.includes('generate_204')||n.href.includes('kevlar_base'))){
                try{ n.setAttribute('rel','prefetch'); }catch(e){}
              }
            });
          });
        }).observe(document.head, {childList:true});
      }catch(e){}
    }catch(e){}
  })();
})();
"#;

pub fn nav_interception_script() -> &'static str {
  NAV_SCRIPT
}

pub fn player_script() -> &'static str {
  PLAYER_SCRIPT
}
