import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { NetflixIcon } from "../Icons";
import type { Tab } from "../../types";
import type { NetflixExtensionSettings } from "../../services/storage";

interface NetflixExtensionProps {
  tabs: Tab[];
  activeTab: Tab | null;
  settings: NetflixExtensionSettings;
  onChange: (patch: Partial<NetflixExtensionSettings>) => void;
}

function buildNetflixScript(cfg: NetflixExtensionSettings): string {
  const cfgJson = JSON.stringify({
    skipRecap: cfg.skipRecap,
    skipIntro: cfg.skipIntro,
    nextEpisode: cfg.nextEpisode,
  });
  return `(function(){
  try{
    window.__aegisNetflixCfg = ${cfgJson};
    if(window.__aegisNetflixInstalled) return;
    window.__aegisNetflixInstalled = true;
    function isVisible(el){
      if(!el) return false;
      const r = el.getBoundingClientRect();
      return r.width>0 && r.height>0 && el.offsetParent!==null;
    }
    function tryClick(){
      try{
        const c = window.__aegisNetflixCfg || {};
        if(c.skipRecap){
          const e = document.querySelector('[data-uia="player-skip-recap"]');
          if(e && isVisible(e)){ e.click(); }
        }
        if(c.skipIntro){
          const e = document.querySelector('[data-uia="player-skip-intro"]');
          if(e && isVisible(e)){ e.click(); }
        }
        if(c.nextEpisode){
          const e = document.querySelector('[data-uia="next-episode-seamless-button"]');
          if(e && isVisible(e)){ e.click(); }
        }
      }catch{}
    }
    const obs = new MutationObserver(function(){ tryClick(); });
    try{ obs.observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:["data-uia","class","style"]}); }catch{ try{ obs.observe(document.body, {childList:true, subtree:true}); }catch{} }
    window.__aegisNetflixTimer = setInterval(tryClick, 800);
    setTimeout(tryClick, 600);
    setTimeout(tryClick, 1500);
    document.addEventListener('visibilitychange', function(){ if(!document.hidden) tryClick(); });
    window.addEventListener('load', function(){ tryClick(); });
  }catch(e){ console.error('[Aegis-Netflix] inject fail', e); }
})();`;
}

function buildConfigUpdateScript(cfg: NetflixExtensionSettings): string {
  return `window.__aegisNetflixCfg = ${JSON.stringify({
    skipRecap: cfg.skipRecap,
    skipIntro: cfg.skipIntro,
    nextEpisode: cfg.nextEpisode,
  })}; try{ var p=document.getElementById('__aegis-netflix-panel'); if(p) p.setAttribute('data-cfg', JSON.stringify(window.__aegisNetflixCfg)); }catch{}`;
}

function isNetflixUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return h === "netflix.com" || h.endsWith(".netflix.com");
  } catch {
    return url.includes("netflix.com");
  }
}

function buildPanelToggleScript(cfg: NetflixExtensionSettings): string {
  const cfgJson = JSON.stringify(cfg);
  return `(function(){
  try{
    const CFG = ${cfgJson};
    window.__aegisNetflixCfg = CFG;
    const existing = document.getElementById('__aegis-netflix-panel');
    if(existing){ existing.remove(); const ov=document.getElementById('__aegis-netflix-overlay'); if(ov) ov.remove(); return; }
    // overlay to capture outside clicks
    const overlay = document.createElement('div');
    overlay.id = '__aegis-netflix-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:transparent;';
    overlay.addEventListener('click', function(){ const p=document.getElementById('__aegis-netflix-panel'); if(p) p.remove(); overlay.remove(); });
    document.documentElement.appendChild(overlay);
    const panel = document.createElement('div');
    panel.id = '__aegis-netflix-panel';
    panel.style.cssText = 'position:fixed;top:12px;right:12px;width:340px;max-width:calc(100vw - 24px);background:#0f111a;border:1px solid #2a2f45;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.04);z-index:2147483647;font-family:Inter, Segoe UI, system-ui, sans-serif;overflow:hidden;animation:aegis-pop 160ms cubic-bezier(0.2,0.9,0.3,1);';
    const style = document.createElement('style');
    style.textContent = '@keyframes aegis-pop{from{opacity:0;transform:translateY(-8px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}';
    panel.appendChild(style);
    const enabledCount = [CFG.skipRecap, CFG.skipIntro, CFG.nextEpisode].filter(Boolean).length;
    const badgeText = enabledCount===3 ? 'All on' : enabledCount===0 ? 'Off' : enabledCount + ' on';
    const badgeBg = enabledCount===3 ? '#E50914' : enabledCount===0 ? '#1e2235' : 'rgba(245,158,11,0.16)';
    const badgeColor = enabledCount===3 ? '#fff' : enabledCount===0 ? '#6b7280' : '#f59e0b';
    const badgeBorder = enabledCount===3 ? '#E50914' : enabledCount===0 ? '#2a2f45' : 'rgba(245,158,11,0.3)';
    panel.innerHTML = ''
      + '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px 12px;border-bottom:1px solid #1e2235;background:linear-gradient(180deg, rgba(229,9,20,0.10), transparent);">'
      + '  <div style="width:36px;height:36px;border-radius:9px;background:#E50914;display:grid;place-items:center;flex-shrink:0;box-shadow:0 4px 12px rgba(229,9,20,0.4);">'
      + '    <span style="color:white;font-weight:900;font-size:18px;letter-spacing:-0.04em;line-height:1;">N</span>'
      + '  </div>'
      + '  <div style="flex:1;min-width:0;">'
      + '    <div style="font-size:13px;font-weight:750;color:#f1f3f9;letter-spacing:-0.01em;">Netflix</div>'
      + '    <div style="font-size:11px;color:#9aa2b8;margin-top:1px;">Auto-skip while watching</div>'
      + '  </div>'
      + '  <div style="padding:4px 9px;border-radius:999px;font-size:11px;font-weight:750;background:'+badgeBg+';color:'+badgeColor+';border:1px solid '+badgeBorder+';">'+badgeText+'</div>'
      + '  <button id="__aegis-netflix-close" style="width:26px;height:26px;border-radius:7px;border:none;background:transparent;color:#9aa2b8;cursor:pointer;display:grid;place-items:center;font-size:16px;line-height:1;">×</button>'
      + '</div>'
      + '<div style="padding:6px 0;">'
      + '  <div class="aegis-row" data-key="skipRecap" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;transition:background 120ms;">'
      + '    <div style="flex:1;min-width:0;text-align:left;">'
      + '      <div style="font-size:13px;font-weight:600;color:#f1f3f9;">Auto skip Recap</div>'
      + '      <div style="font-size:11px;color:#6b7280;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;margin-top:2px;">clicks [data-uia="player-skip-recap"]</div>'
      + '    </div>'
      + '    <div class="aegis-switch" data-key="skipRecap" style="position:relative;width:42px;height:24px;border-radius:999px;background:'+ (CFG.skipRecap ? '#E50914' : '#1e2235') +';border:1px solid '+(CFG.skipRecap ? '#E50914' : '#2a2f45')+';cursor:pointer;flex-shrink:0;transition:all 140ms;">'
      + '      <div style="position:absolute;top:2px;left:'+(CFG.skipRecap ? '18px' : '2px')+';width:18px;height:18px;border-radius:50%;background:'+(CFG.skipRecap ? 'white' : '#6b7280')+';transition:all 140ms;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="aegis-row" data-key="nextEpisode" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-top:1px solid #1a1e2e;">'
      + '    <div style="flex:1;min-width:0;text-align:left;">'
      + '      <div style="font-size:13px;font-weight:600;color:#f1f3f9;">Auto Next Episode</div>'
      + '      <div style="font-size:11px;color:#6b7280;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;margin-top:2px;">clicks [data-uia="next-episode-seamless-button"]</div>'
      + '    </div>'
      + '    <div class="aegis-switch" data-key="nextEpisode" style="position:relative;width:42px;height:24px;border-radius:999px;background:'+ (CFG.nextEpisode ? '#E50914' : '#1e2235') +';border:1px solid '+(CFG.nextEpisode ? '#E50914' : '#2a2f45')+';cursor:pointer;flex-shrink:0;transition:all 140ms;">'
      + '      <div style="position:absolute;top:2px;left:'+(CFG.nextEpisode ? '18px' : '2px')+';width:18px;height:18px;border-radius:50%;background:'+(CFG.nextEpisode ? 'white' : '#6b7280')+';transition:all 140ms;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="aegis-row" data-key="skipIntro" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-top:1px solid #1a1e2e;">'
      + '    <div style="flex:1;min-width:0;text-align:left;">'
      + '      <div style="font-size:13px;font-weight:600;color:#f1f3f9;">Auto Skip Intro</div>'
      + '      <div style="font-size:11px;color:#6b7280;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;margin-top:2px;">clicks [data-uia="player-skip-intro"]</div>'
      + '    </div>'
      + '    <div class="aegis-switch" data-key="skipIntro" style="position:relative;width:42px;height:24px;border-radius:999px;background:'+ (CFG.skipIntro ? '#E50914' : '#1e2235') +';border:1px solid '+(CFG.skipIntro ? '#E50914' : '#2a2f45')+';cursor:pointer;flex-shrink:0;transition:all 140ms;">'
      + '      <div style="position:absolute;top:2px;left:'+(CFG.skipIntro ? '18px' : '2px')+';width:18px;height:18px;border-radius:50%;background:'+(CFG.skipIntro ? 'white' : '#6b7280')+';transition:all 140ms;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>'
      + '    </div>'
      + '  </div>'
      + '</div>'
      + '<div style="padding:10px 16px;background:#0a0c14;border-top:1px solid #1a1e2e;display:flex;align-items:center;gap:6px;font-size:11px;color:#6b7280;">'
      + '  <span style="width:6px;height:6px;border-radius:50%;background:#E50914;box-shadow:0 0 6px rgba(229,9,20,0.6);"></span>'
      + '  Works on netflix.com player. Changes saved instantly.'
      + '</div>';
    document.documentElement.appendChild(panel);
    // events
    const closeBtn = panel.querySelector('#__aegis-netflix-close');
    if(closeBtn) closeBtn.addEventListener('click', function(){ panel.remove(); const ov=document.getElementById('__aegis-netflix-overlay'); if(ov) ov.remove(); });
    panel.querySelectorAll('.aegis-row').forEach(function(row){
      row.addEventListener('click', function(){
        const key = row.getAttribute('data-key');
        if(!key) return;
        const cur = window.__aegisNetflixCfg || CFG;
        const next = !cur[key];
        const newCfg = { ...cur, [key]: next };
        window.__aegisNetflixCfg = newCfg;
        try{
          const a=document.createElement('a');
          a.style.display='none';
          a.href='sx-internal://netflix-toggle?key='+encodeURIComponent(key)+'&value='+ (next ? '1' : '0')+'&t='+Date.now();
          (document.body||document.documentElement).appendChild(a);
          a.click();
          setTimeout(function(){ if(a.parentNode) a.parentNode.removeChild(a); }, 100);
        }catch{}
        // re-create panel with new state
        panel.remove(); const ov=document.getElementById('__aegis-netflix-overlay'); if(ov) ov.remove();
        // re-inject with new cfg after tiny delay so main window persists then we re-open
        setTimeout(function(){
          try{
            const s=document.createElement('script');
            s.textContent="("+arguments.callee.toString()+")()";
          }catch{}
        },0);
        // Instead just reload panel by calling toggle again — we will create new panel via next click, but for immediate feedback recreate
        setTimeout(function(){
          // recreate with new cfg
          const ev = new CustomEvent('__aegis-recreate');
          window.dispatchEvent(ev);
        }, 10);
      });
    });
    // allow ESC to close
    const onKey = function(e){ if(e.key==='Escape'){ panel.remove(); const ov=document.getElementById('__aegis-netflix-overlay'); if(ov) ov.remove(); window.removeEventListener('keydown', onKey); } };
    window.addEventListener('keydown', onKey, {once:true});
    // auto remove on navigation
    const obs2 = new MutationObserver(function(){ /* keep */ });
  }catch(e){ console.error('[Aegis-Netflix] panel fail', e); }
})();`;
}

export function NetflixExtension({ tabs, activeTab, settings, onChange }: NetflixExtensionProps) {
  const enabledCount = [settings.skipRecap, settings.skipIntro, settings.nextEpisode].filter(Boolean).length;

  useEffect(() => {
    let cancelled = false;
    const targets = tabs.filter((t) => t.url && isNetflixUrl(t.url));
    if (activeTab && activeTab.url && isNetflixUrl(activeTab.url) && !targets.some((t) => t.id === activeTab.id)) {
      targets.push(activeTab);
    }
    if (targets.length === 0) return;
    const inject = async () => {
      for (const t of targets) {
        if (cancelled) return;
        const label = t.label;
        try {
          await invoke("eval_in_webview", { label, script: buildNetflixScript(settings) });
          await new Promise((r) => setTimeout(r, 30));
          if (cancelled) return;
          await invoke("eval_in_webview", { label, script: buildConfigUpdateScript(settings) });
        } catch {}
      }
    };
    const timer = window.setTimeout(() => void inject(), 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tabs, activeTab?.id, activeTab?.url, settings.skipRecap, settings.skipIntro, settings.nextEpisode]);

  // Listen for toggle messages from injected panel (via sx-internal) and also handle recreation
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ key: string; value: string }>("Aegis-netflix-toggle", (e) => {
        const { key, value } = e.payload as any;
        const on = value === "1" || value === "true";
        if (key === "skipRecap") onChange({ skipRecap: on });
        else if (key === "skipIntro") onChange({ skipIntro: on });
        else if (key === "nextEpisode") onChange({ nextEpisode: on });
        // after persist, re-inject panel with new state if panel is open — the webview will get new cfg via the normal effect,
        // but we also need to recreate the panel UI to reflect new switch positions.
        // Do it by re-toggling panel: remove and re-create
        if (activeTab) {
          const label = activeTab.label;
          // tiny delay to let settings propagate then re-open panel
          setTimeout(async () => {
            try {
              const cur = { skipRecap: key === "skipRecap" ? on : settings.skipRecap, skipIntro: key === "skipIntro" ? on : settings.skipIntro, nextEpisode: key === "nextEpisode" ? on : settings.nextEpisode };
              await invoke("eval_in_webview", { label, script: buildPanelToggleScript(cur as any) }); // remove
              await new Promise((r) => setTimeout(r, 60));
              await invoke("eval_in_webview", { label, script: buildPanelToggleScript(cur as any) }); // re-create
            } catch {}
          }, 80);
        }
      }).then((fn) => (unlisten = fn));
    });
    return () => unlisten?.();
  }, [activeTab, onChange, settings.skipRecap, settings.skipIntro, settings.nextEpisode]);

  const handleClick = async () => {
    // If active tab is a webview, inject floating panel inside the page (true floating, no push)
    if (activeTab && activeTab.kind === "web" && activeTab.url) {
      const label = activeTab.label;
      try {
        await invoke("eval_in_webview", { label, script: buildPanelToggleScript(settings) });
        return;
      } catch (err) {
        console.error("[NetflixExtension] panel inject failed, fallback to menu", err);
      }
    }
    // Fallback: native menu when not on a web tab (home/settings etc.) or inject failed
    try {
      const mkItem = async (label: string, checked: boolean, patch: Partial<NetflixExtensionSettings>) =>
        await MenuItem.new({
          text: `${checked ? "✓  " : "    "}${label}`,
          action: () => onChange(patch as any),
        });
      const recapItem = await mkItem("Auto skip Recap", settings.skipRecap, { skipRecap: !settings.skipRecap });
      const nextItem = await mkItem("Auto Next Episode", settings.nextEpisode, { nextEpisode: !settings.nextEpisode });
      const introItem = await mkItem("Auto Skip Intro", settings.skipIntro, { skipIntro: !settings.skipIntro });
      const sep = await PredefinedMenuItem.new({ item: "Separator" });
      const hint = await MenuItem.new({
        text: enabledCount === 3 ? "All on  •  floating panel on Netflix" : enabledCount === 0 ? "All off" : `${enabledCount}/3 enabled`,
        enabled: false,
        action: () => {},
      } as any);
      const menu = await Menu.new({ items: [recapItem, nextItem, introItem, sep, hint] });
      await menu.popup();
    } catch (err) {
      console.error("[NetflixExtension] menu failed", err);
    }
  };

  return (
    <div className="netflix-ext-wrap">
      <button
        className={`chrome-action-btn netflix-ext-btn ${enabledCount > 0 ? "has-enabled" : ""}`}
        onClick={() => void handleClick()}
        title={`Netflix tools — ${enabledCount}/3 auto-skip enabled`}
        aria-label="Netflix extension"
      >
        <NetflixIcon size={18} />
        {enabledCount > 0 && enabledCount < 3 && <span className="netflix-ext-dot partial" />}
        {enabledCount === 3 && <span className="netflix-ext-dot on" />}
      </button>
    </div>
  );
}
