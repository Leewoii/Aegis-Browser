/// JavaScript injected into child webviews (tabs and panels) on page load.
///
/// Intercepts `target="_blank"` links, `window.open()` calls and blank-target
/// form submissions. Instead of spawning a new window, the webview navigates
/// to the URL; `on_navigation` then catches it and the main window opens a new
/// tab (the navigation itself is denied).
const INTERCEPTION_SCRIPT: &str = r#"
(function(){
  // Never inject into sandboxed iframes or about:blank frames
  try {
    if (window !== window.top || !window.location || !window.location.href || window.location.href.startsWith('about:')) {
      return;
    }
  } catch(_) {
    return;
  }

  if (window.__sxIntercepted) return;
  window.__sxIntercepted = true;

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
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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

  // 5. Forward browser keyboard shortcuts to the main Aegis window.
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
    if (e.key === 'Escape') { removeContextMenu(); return; }

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

  // 6. Notify main window of document title for history / tab title.
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
})();
"#;

pub fn interception_script() -> &'static str {
  INTERCEPTION_SCRIPT
}
