import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Satyam — Crime Intelligence, On the Data" },
      { name: "description", content: "Satyam turns scattered case records, statements and signals into one bilingual, voice-driven, explainable intelligence picture for the Karnataka State Police — with a hands-free copilot, AI investigation board, and a tamper-evident audit trail." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" },
    ],
  }),
  component: LandingPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Scoped styles — every rule is prefixed with .satyam-landing so they cannot
// bleed into the authenticated app's Tailwind tokens.
// ─────────────────────────────────────────────────────────────────────────────
const LANDING_CSS = `
.satyam-landing {
  --bg:#050805; --bg2:#0a0f0a; --panel:#0c120c;
  --green:#39d02a; --green-bright:#6dff52; --green-deep:#155a0e;
  --text:#f2fff0; --muted:rgba(214,245,208,0.55); --line:rgba(120,220,110,0.14);
  --accent-rgb:57,208,42; --bright-rgb:109,255,82;
  --lf:'Space Grotesk',system-ui,sans-serif; --lb:'Inter',system-ui,sans-serif;
  background:var(--bg); color:var(--text); font-family:var(--lb);
  overflow-x:hidden; cursor:none; -webkit-font-smoothing:antialiased;
  min-height:100vh; position:relative;
}
.satyam-landing a { color:inherit; text-decoration:none; }
.satyam-landing #sl-scene { position:fixed; inset:0; z-index:0; pointer-events:none; }
.satyam-landing .sl-godray { position:fixed;left:50%;top:-25vh;transform:translateX(-50%);width:120vw;height:90vh;
  background:radial-gradient(ellipse 40% 60% at 50% 0%,rgba(var(--accent-rgb),.45),rgba(var(--accent-rgb),.08) 45%,transparent 70%);
  filter:blur(20px);z-index:0;pointer-events:none;mix-blend-mode:screen; }
.satyam-landing .sl-vignette { position:fixed;inset:0;z-index:1;pointer-events:none;
  background:radial-gradient(ellipse 80% 80% at 50% 40%,transparent 50%,rgba(0,0,0,.55) 100%); }
.satyam-landing #sl-cursor { position:fixed;top:0;left:0;width:16px;height:16px;z-index:9999;pointer-events:none;
  transform:translate(-2px,-2px);transition:transform .08s ease-out,opacity .2s; }
.satyam-landing #sl-cursor svg { filter:drop-shadow(0 0 4px rgba(var(--bright-rgb),.8)); }
.satyam-landing header { position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:22px 40px; }
.satyam-landing .sl-logo { display:flex;align-items:center;gap:10px;font-family:var(--lf);font-weight:700;letter-spacing:.06em;font-size:18px; }
.satyam-landing .sl-logo .mark { width:30px;height:24px; }
.satyam-landing .sl-logo b { color:#fff; }
.satyam-landing .sl-logo span { color:var(--green-bright); }
.satyam-landing .sl-logo .logo-sub { display:block;font-family:var(--lf);font-weight:600;font-size:9.5px;letter-spacing:.04em;color:var(--muted);margin-top:1px; }
.satyam-landing .btn-pill { display:inline-flex;align-items:center;gap:10px;background:#f4fff1;color:#06140a;font-family:var(--lf);
  font-weight:600;font-size:14px;padding:7px 8px 7px 18px;border-radius:999px;cursor:pointer;
  box-shadow:0 0 30px rgba(var(--accent-rgb),.35);transition:transform .2s,box-shadow .2s; }
.satyam-landing .btn-pill:hover { transform:translateY(-1px);box-shadow:0 0 44px rgba(var(--accent-rgb),.6); }
.satyam-landing .btn-pill .dot { width:26px;height:26px;border-radius:50%;background:var(--green);display:grid;place-items:center;color:#03150a; }
.satyam-landing .btn-ghost { display:inline-flex;align-items:center;gap:10px;font-family:var(--lf);font-weight:600;font-size:14px;color:var(--text);
  border:1px solid var(--line);background:rgba(12,20,12,.5);backdrop-filter:blur(10px);padding:9px 20px;border-radius:999px;cursor:pointer;transition:.2s; }
.satyam-landing .btn-ghost:hover { border-color:rgba(var(--bright-rgb),.5);box-shadow:0 0 24px rgba(var(--accent-rgb),.25);transform:translateY(-1px); }
.satyam-landing .btn-ghost .play { width:22px;height:22px;border-radius:50%;background:var(--green);color:#03150a;display:grid;place-items:center;font-size:9px; }
.satyam-landing nav.floating { position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:50;
  display:flex;align-items:center;gap:4px;padding:6px;border-radius:999px;
  background:rgba(12,20,12,.6);border:1px solid var(--line);backdrop-filter:blur(14px);box-shadow:0 8px 40px rgba(0,0,0,.5); }
.satyam-landing nav.floating a { font-family:var(--lf);font-weight:500;font-size:14px;padding:8px 16px;border-radius:999px;color:var(--muted);
  display:flex;align-items:center;gap:6px;cursor:pointer;transition:.2s; }
.satyam-landing nav.floating a.active { background:rgba(var(--accent-rgb),.12);color:var(--text); }
.satyam-landing nav.floating a:hover { color:var(--text); }
.satyam-landing nav.floating a .led { width:6px;height:6px;border-radius:50%;background:var(--green-bright);box-shadow:0 0 8px var(--green-bright); }
.satyam-landing nav.floating a .plus { color:var(--green-bright);font-weight:700; }
.satyam-landing main { position:relative;z-index:10; }
.satyam-landing section { position:relative;min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:120px 40px; }
.satyam-landing .wrap { max-width:1200px;margin:0 auto;width:100%; }
.satyam-landing .eyebrow { display:inline-flex;align-items:center;gap:8px;font-family:var(--lf);font-size:12px;letter-spacing:.28em;
  color:var(--green-bright);text-transform:uppercase;margin-bottom:22px; }
.satyam-landing .eyebrow::before { content:'[';color:var(--muted); }
.satyam-landing .eyebrow::after { content:']';color:var(--muted); }
.satyam-landing h1 { font-family:var(--lf);font-weight:600;font-size:clamp(48px,8.5vw,128px);line-height:.92;letter-spacing:-.02em; }
.satyam-landing h1 .thin { font-weight:400;color:var(--text); }
.satyam-landing.light h1 .thin { color:#0a160a; }
.satyam-landing h1 .accent,.satyam-landing h2 .accent { color:var(--green-bright); }
.satyam-landing .hero-sub { max-width:420px;margin-top:26px;color:var(--muted);font-size:16px;line-height:1.6; }
.satyam-landing .hero-cta { margin-top:34px;display:flex;align-items:center;gap:14px;flex-wrap:wrap; }
.satyam-landing h2 { font-family:var(--lf);font-weight:600;font-size:clamp(34px,5vw,72px);line-height:1;letter-spacing:-.02em; }
.satyam-landing .lead { color:var(--muted);font-size:18px;line-height:1.6;max-width:560px;margin-top:20px; }
.satyam-landing .reveal { opacity:0;transform:translateY(36px);transition:opacity .9s cubic-bezier(.2,.7,.2,1),transform .9s cubic-bezier(.2,.7,.2,1); }
.satyam-landing .reveal.in { opacity:1;transform:none; }
.satyam-landing .reveal.d1 { transition-delay:.08s; }
.satyam-landing .reveal.d2 { transition-delay:.16s; }
.satyam-landing .reveal.d3 { transition-delay:.24s; }
.satyam-landing .center { text-align:center;align-items:center; }
.satyam-landing .center .wrap { display:flex;flex-direction:column;align-items:center; }
.satyam-landing .grid { display:grid;grid-template-columns:repeat(12,1fr);gap:18px;margin-top:50px; }
.satyam-landing .card { background:linear-gradient(180deg,rgba(18,30,18,.7),rgba(8,14,8,.6));border:1px solid var(--line);
  border-radius:18px;padding:26px;backdrop-filter:blur(6px);position:relative;overflow:hidden; }
.satyam-landing .card h3 { font-family:var(--lf);font-weight:600;font-size:20px;margin-bottom:10px; }
.satyam-landing .card p { color:var(--muted);font-size:14px;line-height:1.6; }
.satyam-landing .card .ico { width:42px;height:42px;border-radius:12px;display:grid;place-items:center;margin-bottom:16px;
  background:rgba(var(--accent-rgb),.12);color:var(--green-bright);border:1px solid var(--line); }
.satyam-landing .card .glow { position:absolute;width:200px;height:200px;border-radius:50%;right:-60px;bottom:-60px;
  background:radial-gradient(circle,rgba(var(--accent-rgb),.35),transparent 65%);filter:blur(10px); }
.satyam-landing .span7 { grid-column:span 7; } .satyam-landing .span5 { grid-column:span 5; }
.satyam-landing .span4 { grid-column:span 4; } .satyam-landing .span6 { grid-column:span 6; }
.satyam-landing .span12 { grid-column:span 12; }
.satyam-landing .stat { font-family:var(--lf);font-weight:700;font-size:54px;color:var(--green-bright);line-height:1; }
.satyam-landing .stat-label { color:var(--muted);font-size:13px;margin-top:8px; }
.satyam-landing footer { position:relative;z-index:10;padding:90px 40px 40px;border-top:1px solid var(--line);background:linear-gradient(180deg,transparent,rgba(5,12,5,.8)); }
.satyam-landing .foot-grid { max-width:1200px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:30px; }
.satyam-landing .foot-brand { font-family:var(--lf);font-weight:600;font-size:30px;line-height:1.1; }
.satyam-landing .foot-brand .muted { color:var(--muted); }
.satyam-landing .fcol h4 { font-family:var(--lf);font-size:11px;letter-spacing:.24em;color:var(--green-bright);text-transform:uppercase;margin-bottom:16px; }
.satyam-landing .fcol a { display:block;color:var(--muted);font-size:14px;margin-bottom:12px;cursor:pointer;transition:.2s; }
.satyam-landing .fcol a:hover { color:var(--text); }
.satyam-landing .foot-bottom { max-width:1200px;margin:50px auto 0;display:flex;justify-content:space-between;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:24px; }
.satyam-landing .tag-chip { font-family:var(--lf);font-size:11px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase;
  border:1px solid var(--line);border-radius:999px;padding:6px 12px;display:inline-block; }
.satyam-landing .nav-link { font-family:var(--lf);font-weight:500;font-size:14px;color:var(--muted);cursor:pointer;transition:.2s;padding:6px 4px; }
.satyam-landing .nav-link:hover { color:var(--text); }
/* theme switcher */
.satyam-landing .header-right { display:flex;align-items:center;gap:14px; }
.satyam-landing .theme-switch { position:relative; }
.satyam-landing .theme-btn { width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:rgba(12,20,12,.6);
  backdrop-filter:blur(10px);cursor:pointer;display:grid;place-items:center;transition:transform .2s,box-shadow .2s; }
.satyam-landing .theme-btn:hover { transform:translateY(-1px);box-shadow:0 0 22px rgba(var(--bright-rgb),.4); }
.satyam-landing .theme-ring { width:20px;height:20px;border-radius:50%;
  background:conic-gradient(#ff3b3b,#ffb33b,#f2ff3b,#3bff5a,#3bd9ff,#7d3bff,#ff3bd1,#ff3b3b);box-shadow:0 0 12px rgba(var(--bright-rgb),.5); }
.satyam-landing .theme-menu { position:absolute;top:52px;right:0;width:210px;padding:16px;border-radius:16px;
  background:rgba(10,16,10,.92);border:1px solid var(--line);backdrop-filter:blur(16px);
  box-shadow:0 16px 50px rgba(0,0,0,.6);opacity:0;transform:translateY(-8px) scale(.96);
  pointer-events:none;transition:.18s;z-index:60; }
.satyam-landing .theme-menu.open { opacity:1;transform:none;pointer-events:auto; }
.satyam-landing .tm-title { font-family:var(--lf);font-size:11px;letter-spacing:.22em;text-transform:uppercase;
  color:var(--muted);display:block;margin-bottom:12px; }
.satyam-landing .tm-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:11px; }
.satyam-landing .sw { width:36px;height:36px;border-radius:50%;border:2px solid rgba(255,255,255,.14);cursor:pointer;
  background:var(--sw,#39d02a);transition:.15s;padding:0; }
.satyam-landing .sw:hover { transform:scale(1.12);border-color:rgba(255,255,255,.55); }
.satyam-landing .sw.active { border-color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.22); }
.satyam-landing .sw.rainbow { background:conic-gradient(#ff3b3b,#ffb33b,#f2ff3b,#3bff5a,#3bd9ff,#7d3bff,#ff3bd1,#ff3b3b); }
.satyam-landing .mode-btn { width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:rgba(12,20,12,.6);
  backdrop-filter:blur(10px);cursor:pointer;display:grid;place-items:center;font-size:16px;line-height:1;transition:transform .2s,box-shadow .2s; }
.satyam-landing .mode-btn:hover { transform:translateY(-1px);box-shadow:0 0 22px rgba(var(--bright-rgb),.4); }
.satyam-landing .mode-btn .ic-sun { display:none; }
.satyam-landing.light .mode-btn .ic-sun { display:inline; }
.satyam-landing.light .mode-btn .ic-moon { display:none; }
/* light mode overrides scoped to .satyam-landing.light */
.satyam-landing.light { --bg:#eef4ec;--bg2:#e3ede1;--panel:#ffffff;--text:#0a160a;--muted:rgba(18,46,14,.62);cursor:auto; }
.satyam-landing.light #sl-cursor { display:none; }
.satyam-landing.light .sl-logo b { color:#0a160a; }
.satyam-landing.light .btn-pill { background:#0a160a;color:#eafff0;box-shadow:0 0 26px rgba(var(--accent-rgb),.3); }
.satyam-landing.light .theme-btn,.satyam-landing.light .mode-btn { background:rgba(255,255,255,.72);border-color:rgba(0,0,0,.08); }
.satyam-landing.light .theme-menu { background:rgba(255,255,255,.96);border-color:rgba(0,0,0,.08);box-shadow:0 16px 50px rgba(0,0,0,.18); }
.satyam-landing.light nav.floating { background:rgba(255,255,255,.74);border-color:rgba(0,0,0,.08); }
.satyam-landing.light nav.floating a { color:rgba(18,46,14,.6); }
.satyam-landing.light nav.floating a:hover { color:#0a160a; }
.satyam-landing.light nav.floating a.active { background:rgba(var(--accent-rgb),.16);color:#0a160a; }
.satyam-landing.light .card { background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(238,246,236,.85));border-color:rgba(0,0,0,.06); }
.satyam-landing.light footer { background:linear-gradient(180deg,transparent,rgba(227,237,225,.8)); }
.satyam-landing.light .hero-sub { color:#04120a;font-weight:700; }
.satyam-landing.light .nav-link { color:rgba(18,46,14,.6); }
.satyam-landing.light .nav-link:hover { color:#0a160a; }
.satyam-landing.light .btn-ghost { background:rgba(255,255,255,.6);border-color:rgba(0,0,0,.08);color:#0a160a; }
.satyam-landing.light .sl-vignette { background:radial-gradient(ellipse 80% 80% at 50% 40%,transparent 55%,rgba(238,244,236,.65) 100%); }
.satyam-landing.light .sl-godray { mix-blend-mode:normal;opacity:.45; }
@media(max-width:860px){
  .satyam-landing header { padding:16px 20px; }
  .satyam-landing nav.floating { bottom:14px; }
  .satyam-landing section { padding:90px 20px; }
  .satyam-landing .grid { grid-template-columns:repeat(6,1fr); }
  .satyam-landing .span7,.satyam-landing .span5,.satyam-landing .span4,.satyam-landing .span6 { grid-column:span 6; }
  .satyam-landing .foot-grid { grid-template-columns:1fr 1fr; }
  .satyam-landing .nav-link { display:none; }
  .satyam-landing { cursor:auto; }
  .satyam-landing #sl-cursor { display:none; }
}
`;

// ── Theme / mode logic (mirrors the IIFE from landing.html, React-ified) ─────

function hsl2rgb(h: number, s: number, l: number): [number,number,number] {
  if (s === 0) { const v = Math.round(l*255); return [v,v,v]; }
  const q = l < .5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
  const tc: [number,number,number] = [h+1/3,h,h-1/3].map(x => {
    x = (x+1)%1;
    if (x < 1/6) return p+(q-p)*6*x;
    if (x < 1/2) return q;
    if (x < 2/3) return p+(q-p)*(2/3-x)*6;
    return p;
  }) as [number,number,number];
  return tc.map(v => Math.round(v*255)) as [number,number,number];
}

function setAccentHue(root: HTMLElement, h: number) {
  const main = hsl2rgb(h,0.78,0.49), bright = hsl2rgb(h,1,0.66), deep = hsl2rgb(h,0.62,0.2);
  root.style.setProperty('--green',`rgb(${main.join(',')})`);
  root.style.setProperty('--green-bright',`rgb(${bright.join(',')})`);
  root.style.setProperty('--green-deep',`rgb(${deep.join(',')})`);
  root.style.setProperty('--accent-rgb',main.join(','));
  root.style.setProperty('--bright-rgb',bright.join(','));
  root.style.setProperty('--line',`rgba(${bright.join(',')},0.16)`);
}

function applyMode(root: HTMLElement, light: boolean) {
  if (light) root.classList.add('light'); else root.classList.remove('light');
  const dark = {'--bg':'#050805','--bg2':'#0a0f0a','--panel':'#0c120c','--text':'#f2fff0','--muted':'rgba(214,245,208,0.55)'};
  const lite = {'--bg':'#eef4ec','--bg2':'#e3ede1','--panel':'#ffffff','--text':'#0a160a','--muted':'rgba(18,46,14,0.62)'};
  Object.entries(light ? lite : dark).forEach(([k,v]) => root.style.setProperty(k,v));
  localStorage.setItem('satyam-mode', light ? 'light' : 'dark');
}

// ── Main component ────────────────────────────────────────────────────────────

function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Theme / mode UI + Three.js — all client-only ────────────────────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Inject scoped styles once
    const styleEl = document.createElement('style');
    styleEl.id = 'satyam-landing-styles';
    if (!document.getElementById('satyam-landing-styles')) {
      styleEl.textContent = LANDING_CSS;
      document.head.appendChild(styleEl);
    }

    // Shared state
    const S = (window as any).satyamState || ((window as any).satyamState = {hue:0.33,sat:0.92,rainbow:false,light:false});

    // Apply persisted mode/theme
    const savedMode = localStorage.getItem('satyam-mode') === 'light';
    S.light = savedMode;
    applyMode(root, savedMode);
    const savedTheme = localStorage.getItem('satyam-theme');
    if (savedTheme === 'rainbow') { S.rainbow = true; }
    else if (savedTheme !== null) { S.hue = parseFloat(savedTheme); setAccentHue(root, S.hue); }
    else { setAccentHue(root, S.hue); }
    // sync active swatch
    root.querySelectorAll<HTMLButtonElement>('.sw').forEach(sw => {
      sw.classList.remove('active');
      if (S.rainbow && sw.dataset.theme === 'rainbow') sw.classList.add('active');
      else if (!S.rainbow && sw.dataset.hue && parseFloat(sw.dataset.hue) === S.hue) sw.classList.add('active');
    });

    // Theme switcher
    const themeBtn = root.querySelector<HTMLButtonElement>('#sl-themeBtn');
    const themeMenu = root.querySelector<HTMLElement>('#sl-themeMenu');
    const onThemeBtn = (e: Event) => { e.stopPropagation(); themeMenu?.classList.toggle('open'); };
    const onThemeMenuClick = (e: Event) => e.stopPropagation();
    const onDocClick = () => themeMenu?.classList.remove('open');
    themeBtn?.addEventListener('click', onThemeBtn);
    themeMenu?.addEventListener('click', onThemeMenuClick);
    document.addEventListener('click', onDocClick);

    root.querySelectorAll<HTMLButtonElement>('.sw').forEach(sw => {
      sw.addEventListener('click', () => {
        root.querySelectorAll('.sw').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        if (sw.dataset.theme === 'rainbow') { S.rainbow = true; localStorage.setItem('satyam-theme','rainbow'); }
        else { S.rainbow = false; S.hue = parseFloat(sw.dataset.hue!); setAccentHue(root, S.hue); localStorage.setItem('satyam-theme', sw.dataset.hue!); }
      });
    });

    // Mode toggle
    const modeBtn = root.querySelector<HTMLButtonElement>('#sl-modeBtn');
    const onModeBtn = () => { S.light = !S.light; applyMode(root, S.light); };
    modeBtn?.addEventListener('click', onModeBtn);

    // Custom cursor + pointer tracking for particle physics
    const cur = root.querySelector<HTMLElement>('#sl-cursor');
    let cx = innerWidth/2, cy = innerHeight/2, tx = cx, ty = cy;
    let curRaf = 0;
    // NDC pointer for Three.js raycaster + energy for velocity physics
    const pointer = { x: 0, y: 0, has: false };
    let pEnergy = 0, pLastX = 0, pLastY = 0;
    const onMouseMove = (e: MouseEvent) => {
      tx = e.clientX; ty = e.clientY;
      pointer.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.y = -(e.clientY / innerHeight) * 2 + 1;
      const ddx = e.clientX - pLastX, ddy = e.clientY - pLastY;
      pLastX = e.clientX; pLastY = e.clientY;
      if (pointer.has) pEnergy = Math.min(1, pEnergy + Math.sqrt(ddx*ddx + ddy*ddy) * 0.012);
      pointer.has = true;
    };
    const onMouseOut = () => { pEnergy = 0; };
    const curLoop = () => { cx += (tx-cx)*.25; cy += (ty-cy)*.25; if (cur) cur.style.transform = `translate(${cx-2}px,${cy-2}px)`; curRaf = requestAnimationFrame(curLoop); };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseout', onMouseOut);
    curRaf = requestAnimationFrame(curLoop);

    // Reveal on scroll
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); }), {threshold:.18});
    root.querySelectorAll('.reveal').forEach(el => io.observe(el));

    // Active nav
    const navLinks = [...root.querySelectorAll<HTMLAnchorElement>('nav.floating a[data-nav]')];
    const navSecs = ['hero','capabilities','platform','about'].map(id => root.querySelector('#sl-'+id));
    const navIo = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) {
        navLinks.forEach(a => a.classList.remove('active'));
        const m = navLinks.find(a => a.getAttribute('href') === '#sl-'+e.target.id.replace('sl-',''));
        if (m) m.classList.add('active');
      }
    }), {threshold:.5});
    navSecs.forEach(s => s && navIo.observe(s));

    // ── Three.js particle brain ─────────────────────────────────────────
    let renderer: import('three').WebGLRenderer | null = null;
    let rafId = 0;

    (async () => {
      try {
        const THREE = await import('three');
        const canvas = canvasRef.current;
        if (!canvas || !rootRef.current) return;

        renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
        renderer.setPixelRatio(Math.min(devicePixelRatio,2));
        renderer.setSize(innerWidth, innerHeight);
        const threeScene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, .1, 100);
        camera.position.z = 14;

        const N = 9000;
        function makeSprite() {
          const c = document.createElement('canvas'); c.width = c.height = 64;
          const g = c.getContext('2d')!;
          const grd = g.createRadialGradient(32,32,0,32,32,32);
          grd.addColorStop(0,'rgba(255,255,255,1)'); grd.addColorStop(.3,'rgba(255,255,255,.65)'); grd.addColorStop(1,'rgba(255,255,255,0)');
          g.fillStyle = grd; g.fillRect(0,0,64,64);
          return new THREE.CanvasTexture(c);
        }
        function hash(n: number) { return (Math.sin(n)*43758.5453)%1; }

        const A = new Float32Array(N*3), B = new Float32Array(N*3), C = new Float32Array(N*3);
        const gold = Math.PI*(3-Math.sqrt(5));
        for (let i=0; i<N; i++) {
          const t=i/N, inc=Math.acos(1-2*t), az=gold*i;
          const r=5.2+(hash(i*12.9898)*1.4)+Math.sin(inc*5)*.35;
          const x=Math.sin(inc)*Math.cos(az), y=Math.cos(inc), z=Math.sin(inc)*Math.sin(az);
          A[i*3]=x*r; A[i*3+1]=y*r*0.92; A[i*3+2]=z*r;
          B[i*3]=(Math.random()*2-1)*16; B[i*3+1]=(Math.random()*2-1)*7; B[i*3+2]=(Math.random()*2-1)*9;
          const seg=i/N, turns=6, ang=seg*Math.PI*2*turns, strand=i%2===0?0:Math.PI;
          const hr=2.4, hy=(seg-.5)*16;
          C[i*3]=Math.cos(ang+strand)*hr; C[i*3+1]=hy; C[i*3+2]=Math.sin(ang+strand)*hr;
        }
        const pos = new Float32Array(A);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
        const colors = new Float32Array(N*3);
        geo.setAttribute('color', new THREE.BufferAttribute(colors,3));

        const mat = new THREE.PointsMaterial({size:.13, map:makeSprite(), transparent:true,
          depthWrite:false, blending:THREE.AdditiveBlending, color:new THREE.Color('#5cff45'),
          sizeAttenuation:true, opacity:.95});
        mat.blending = S.light ? THREE.NormalBlending : THREE.AdditiveBlending;
        mat.vertexColors = !!S.rainbow; mat.opacity = S.light ? 1 : 0.95; mat.needsUpdate = true;
        const pts = new THREE.Points(geo, mat);
        threeScene.add(pts);

        let scrollP = 0;
        const onScroll = () => { const h = document.body.scrollHeight-innerHeight; scrollP = h>0 ? scrollY/h : 0; };
        window.addEventListener('scroll', onScroll, {passive:true}); onScroll();

        const lerp = (a: number, b: number, t: number) => a+(b-a)*t;

        // ── v2 velocity-based physics: inertia + trailing filaments + wake ──
        const vel = new Float32Array(N*3);
        const SPRING = 0.05, DAMP = 0.87, R = 4.8, R2 = R*R;

        // Raycaster to project the cursor onto the z=0 plane in local space
        const _ray  = new THREE.Raycaster();
        const _ndc  = new THREE.Vector2();
        const _plane = new THREE.Plane(new THREE.Vector3(0,0,1), 0);
        const _hit   = new THREE.Vector3();
        const _localCur = new THREE.Vector3();
        let pcx = 0, pcy = 0, pcz = 0, havePrev = false;
        let rotX = 0, rotY = 0;

        let pr = 0, _ml = S.light, _mr = S.rainbow;
        const _c = new THREE.Color();

        const frame = (t: number) => {
          rafId = requestAnimationFrame(frame);
          pr += (scrollP-pr)*.06;
          const s = pr;
          pEnergy *= 0.93;

          // Whole-cloud parallax tilt toward cursor
          const tgtRotY = pointer.x * 0.6, tgtRotX = -pointer.y * 0.4;
          rotY += (tgtRotY-rotY)*0.05; rotX += (tgtRotX-rotX)*0.05;
          pts.rotation.y = t*0.00006 + pr*1.2 + rotY;
          pts.rotation.x = Math.sin(t*0.0002)*0.1 + rotX;

          // Project cursor into local particle space
          pts.updateMatrixWorld();
          _ndc.set(pointer.x, pointer.y);
          _ray.setFromCamera(_ndc, camera);
          let curActive = false, cvx = 0, cvy = 0, cvz = 0, lcx = 0, lcy = 0, lcz = 0;
          if (pointer.has && _ray.ray.intersectPlane(_plane, _hit)) {
            _localCur.copy(_hit); pts.worldToLocal(_localCur);
            lcx = _localCur.x; lcy = _localCur.y; lcz = _localCur.z; curActive = true;
            if (havePrev) { cvx = lcx-pcx; cvy = lcy-pcy; cvz = lcz-pcz; }
            pcx = lcx; pcy = lcy; pcz = lcz; havePrev = true;
          } else { havePrev = false; }
          // Clamp so fast jumps don't explode the field
          cvx = Math.max(-0.6, Math.min(0.6, cvx));
          cvy = Math.max(-0.6, Math.min(0.6, cvy));
          cvz = Math.max(-0.6, Math.min(0.6, cvz));

          const wob = t*0.0006;
          for (let i = 0; i < N; i++) {
            // Moving "home" = morph target + living wobble
            let hx: number, hy: number, hz: number;
            if (s<0.5) { const k=s/0.5; hx=lerp(A[i*3],B[i*3],k); hy=lerp(A[i*3+1],B[i*3+1],k); hz=lerp(A[i*3+2],B[i*3+2],k); }
            else        { const k=(s-0.5)/0.5; hx=lerp(B[i*3],C[i*3],k); hy=lerp(B[i*3+1],C[i*3+1],k); hz=lerp(B[i*3+2],C[i*3+2],k); }
            hx += Math.sin(wob+i)*0.05; hy += Math.cos((wob+i)*1.1)*0.05;

            let px = pos[i*3], py = pos[i*3+1], pz = pos[i*3+2];
            let vx = vel[i*3], vy = vel[i*3+1], vz = vel[i*3+2];

            // 1) Spring back toward home (slow spring => trails, then re-coalesce)
            vx += (hx-px)*SPRING; vy += (hy-py)*SPRING; vz += (hz-pz)*SPRING;

            // 2) Cursor disturbance = radial lift + tangential swirl + drag/wake
            if (curActive) {
              const dx = px-lcx, dy = py-lcy, dz = pz-lcz, d2 = dx*dx+dy*dy+dz*dz;
              if (d2 < R2) {
                const dist = Math.sqrt(d2)+1e-4, w = 1-dist/R, inv = 1/dist, en = 0.4+pEnergy;
                const fr = w*0.10*en;                               // radial lift
                vx += dx*inv*fr; vy += dy*inv*fr; vz += dz*inv*fr;
                const tl = Math.sqrt(dz*dz+dx*dx)+1e-4, ft = w*0.18*en; // tangential swirl
                vx += (-dz/tl)*ft; vz += (dx/tl)*ft;
                const fd = w*1.0;                                   // wake/drag along cursor
                vx += cvx*fd; vy += cvy*fd; vz += cvz*fd;
              }
            }

            // 3) Damping + integrate
            vx *= DAMP; vy *= DAMP; vz *= DAMP;
            px += vx; py += vy; pz += vz;
            vel[i*3] = vx; vel[i*3+1] = vy; vel[i*3+2] = vz;
            pos[i*3] = px; pos[i*3+1] = py; pos[i*3+2] = pz;
          }
          geo.attributes.position.needsUpdate = true;
          if (S.light!==_ml||S.rainbow!==_mr) {
            _ml=S.light; _mr=S.rainbow;
            mat.blending = S.light ? THREE.NormalBlending : THREE.AdditiveBlending;
            mat.vertexColors = S.rainbow; mat.opacity = S.light?1:.95; mat.needsUpdate=true;
          }
          if (S.rainbow) {
            const off=t*.00006, L=S.light?.46:.62;
            for (let i=0;i<N;i++) { _c.setHSL((i/N+off)%1,.95,L); colors[i*3]=_c.r; colors[i*3+1]=_c.g; colors[i*3+2]=_c.b; }
            geo.attributes.color.needsUpdate=true;
            if ((window as any).satyamSetAccentHue) (window as any).satyamSetAccentHue((off*2)%1);
          } else if (S.light) {
            mat.color.setRGB(.05,.05,.05);
          } else {
            mat.color.setHSL(S.hue, S.sat, .45+Math.sin(pr*Math.PI)*.12);
          }
          camera.position.x = Math.sin(t*.0001)*.6; camera.lookAt(0,0,0);
          renderer!.render(threeScene, camera);
        };
        rafId = requestAnimationFrame(frame);

        const onResize = () => { camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer!.setSize(innerWidth,innerHeight); };
        window.addEventListener('resize', onResize);

        // store cleanup refs
        return () => {
          cancelAnimationFrame(rafId);
          window.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onResize);
          geo.dispose(); mat.dispose(); renderer!.dispose();
        };
      } catch (e) {
        console.warn('Three.js failed to load, particle brain unavailable:', e);
      }
    })();

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(curRaf);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('click', onDocClick);
      themeBtn?.removeEventListener('click', onThemeBtn);
      themeMenu?.removeEventListener('click', onThemeMenuClick);
      modeBtn?.removeEventListener('click', onModeBtn);
      io.disconnect(); navIo.disconnect();
      renderer?.dispose();
      // Remove scoped style on unmount so no bleed if someone re-mounts
      document.getElementById('satyam-landing-styles')?.remove();
    };
  }, []);

  // ── JSX ─────────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="satyam-landing">
      <div className="sl-godray" />
      <canvas ref={canvasRef} id="sl-scene" />
      <div className="sl-vignette" />
      <div id="sl-cursor"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M0 0 L0 14 L4 10 L8 16 L10 15 L6 9 L12 9 Z" fill="#eafff0"/></svg></div>

      <header>
        <div className="sl-logo">
          <svg className="mark" viewBox="0 0 40 30" fill="none"><path d="M4 4 L16 15 L4 26" stroke="#6dff52" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 4 L10 15 L22 26" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".85"/></svg>
          <span style={{fontFamily:'var(--lf)',fontWeight:700,letterSpacing:'.06em',lineHeight:'1.05'}}><b>SAT</b><span>YAM</span><span className="logo-sub">build by Teen Titans</span></span>
        </div>
        <div className="header-right">
          <a className="nav-link" href="#sl-features">Features</a>
          <Link className="nav-link" to="/login">Login</Link>
          <button className="mode-btn" id="sl-modeBtn" aria-label="Toggle light or dark"><span className="ic-moon">🌙</span><span className="ic-sun">☀️</span></button>
          <div className="theme-switch">
            <button className="theme-btn" id="sl-themeBtn" aria-label="Change theme"><span className="theme-ring" /></button>
            <div className="theme-menu" id="sl-themeMenu">
              <span className="tm-title">Particle Theme</span>
              <div className="tm-grid">
                <button className="sw active" data-hue="0.33" style={{'--sw':'#39d02a'} as React.CSSProperties} title="Emerald" />
                <button className="sw" data-hue="0.47" style={{'--sw':'#22d0b8'} as React.CSSProperties} title="Teal" />
                <button className="sw" data-hue="0.57" style={{'--sw':'#2a8cff'} as React.CSSProperties} title="Azure" />
                <button className="sw" data-hue="0.72" style={{'--sw':'#8c5cff'} as React.CSSProperties} title="Violet" />
                <button className="sw" data-hue="0.85" style={{'--sw':'#ff5ce0'} as React.CSSProperties} title="Magenta" />
                <button className="sw" data-hue="0" style={{'--sw':'#ff4d3a'} as React.CSSProperties} title="Crimson" />
                <button className="sw" data-hue="0.09" style={{'--sw':'#ff9a3a'} as React.CSSProperties} title="Amber" />
                <button className="sw rainbow" data-theme="rainbow" title="Rainbow" />
              </div>
            </div>
          </div>
          <Link className="btn-pill" to="/about">About <span className="dot">↗</span></Link>
        </div>
      </header>

      <nav className="floating">
        <a href="#sl-hero" className="active" data-nav><span className="led" />Home</a>
        <a href="#sl-capabilities" data-nav>Capabilities <span className="plus">+</span></a>
        <a href="#sl-platform" data-nav>Platform</a>
        <Link to="/about" data-nav>About us</Link>
      </nav>

      <main>
        <section id="sl-hero">
          <div className="wrap">
            <span className="eyebrow reveal">Crime Intelligence</span>
            <h1 className="reveal d1">Defending<br />Karnataka <span className="thin">on</span><br /><span className="thin">the</span> <span className="accent">Data.</span></h1>
            <p className="hero-sub reveal d2">Satyam turns scattered case records, statements and signals into one bilingual, explainable intelligence picture for the Karnataka State Police.</p>
            <div className="hero-cta reveal d3">
              <Link className="btn-pill" to="/login">Login <span className="dot">↗</span></Link>
              <a className="btn-ghost" href="#sl-features"><span className="play">▶</span> Watch Demo</a>
            </div>
          </div>
        </section>

        <section id="sl-tagline" className="center">
          <div className="wrap">
            <h2 className="reveal">Tailored crime <span className="accent">⊗</span> intelligence solutions</h2>
            <p className="lead reveal d1" style={{textAlign:'center'}}>From first FIR to courtroom-ready reasoning — grounded Q&amp;A, networks, money-trails, forecasting, and a hands-free voice &amp; gesture copilot, all in one place.</p>
          </div>
        </section>

        <section id="sl-capabilities">
          <div className="wrap">
            <span className="eyebrow reveal">Capabilities</span>
            <h2 className="reveal d1">We provide intelligence for<br />your toughest cases</h2>
            <div className="grid">
              <div className="card span7 reveal"><div className="glow" /><div className="ico">◈</div><h3>Investigation Console</h3><p>Ask in Kannada or English. Satyam runs grounded Text-to-SQL and RAG over case narratives, cites every source, and streams a spoken summary back to you.</p></div>
              <div className="card span5 reveal d1"><div className="glow" /><div className="ico">◉</div><h3>Network &amp; Rings</h3><p>Surface hidden links between people, places and cases, expand ego-networks, and auto-detect criminal rings on an interactive graph.</p></div>
              <div className="card span4 reveal"><div className="glow" /><div className="ico">₹</div><h3>Financial Money-Trail</h3><p>Trace funds across accounts and transactions with a flagged BFS money-trail — never via raw LLM SQL.</p></div>
              <div className="card span4 reveal d1"><div className="glow" /><div className="ico">◆</div><h3>Forecast &amp; Trends</h3><p>Anticipate hotspots and risk windows, and cluster modus-operandi patterns from historical data.</p></div>
              <div className="card span4 reveal d2"><div className="glow" /><div className="ico">◉</div><h3>Voice &amp; Gesture Copilot</h3><p>Hands-free, bilingual control — speak a command or use webcam gestures to navigate and run any screen.</p></div>
            </div>
          </div>
        </section>

        <section id="sl-platform">
          <div className="wrap">
            <span className="eyebrow reveal">Platform</span>
            <h2 className="reveal d1">Built to stay ahead<br />of the curve</h2>
            <p className="lead reveal d1">Private by design, fully auditable, and powered by state-of-the-art retrieval and reasoning — on synthetic data, with role-based access at every layer.</p>
            <div className="grid">
              <div className="card span4 reveal"><div className="stat">100%</div><div className="stat-label">Synthetic, privacy-safe data</div></div>
              <div className="card span4 reveal d1"><div className="stat">2×</div><div className="stat-label">Bilingual — Kannada &amp; English</div></div>
              <div className="card span4 reveal d2"><div className="stat">14</div><div className="stat-label">Screens in one voice-driven workspace</div></div>
            </div>
          </div>
        </section>

        <section id="sl-features">
          <div className="wrap">
            <div style={{textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center'}}>
              <span className="tag-chip reveal">AI Functions</span>
              <h2 className="reveal d1" style={{marginTop:18}}>State-of-the-art AI,<br />built for the beat</h2>
              <p className="lead reveal d2" style={{textAlign:'center',maxWidth:620}}>A bilingual voice agent, hands-free gesture control, an AI investigation canvas, and grounded reasoning — all behind row-level security and a tamper-evident audit trail.</p>
            </div>
            <div className="grid">
              <div className="card span4 reveal"><div className="glow" /><div className="ico">◉</div><h3>Voice Screen Agent</h3><p>Speak in English or Kannada — the copilot navigates to the right screen and runs the task for you: set filters, search a network, generate a report. It answers data questions aloud, grounded in your records.</p></div>
              <div className="card span4 reveal d1"><div className="glow" /><div className="ico">⚇</div><h3>Hands-free Gesture Control</h3><p>Drive the cursor, click and navigate with webcam hand gestures. Say “Satyam” to wake the copilot, and the session auto-locks &amp; blurs PII the moment you step away.</p></div>
              <div className="card span4 reveal d2"><div className="glow" /><div className="ico">◈</div><h3>AI Investigation Board</h3><p>Describe a crime scene in plain language and the AI lays out suspects, victims, locations and links on an infinite canvas — auto-arranged with production-grade graph layouts.</p></div>
              <div className="card span4 reveal"><div className="glow" /><div className="ico">◎</div><h3>Grounded Text-to-SQL</h3><p>Natural-language questions become safe, read-only SQL — validated by a sqlglot guard, scoped by Row-Level Security, and pointed only at masked views, never raw PII.</p></div>
              <div className="card span4 reveal d1"><div className="glow" /><div className="ico">⛨</div><h3>Tamper-Evident Audit</h3><p>Every query is written to a SHA-256 hash-chained audit log, with four-tier PII masking and L1–L4 clearance enforced at every layer.</p></div>
              <div className="card span4 reveal d2"><div className="glow" /><div className="ico">▤</div><h3>Court-Ready Reports</h3><p>Build cited intelligence briefs from cases and FIRs, then export print-ready PDFs — with on-demand Kannada translation across the whole workspace.</p></div>
            </div>
          </div>
        </section>

        <section id="sl-contact" className="center">
          <div className="wrap">
            <span className="tag-chip reveal">2026 · KSP × SATYAM</span>
            <h2 className="reveal d1" style={{marginTop:20,fontSize:'clamp(44px,7vw,96px)'}}>Contact us<br />Today <span className="accent">✎</span></h2>
            <p className="lead reveal d2" style={{textAlign:'center'}}>Whenever you have queries, require a walkthrough, or need prompt support — we are just a click away.</p>
            <div className="reveal d3" style={{marginTop:30}}>
              <Link className="btn-pill" to="/console">Open Console <span className="dot">↗</span></Link>
            </div>
          </div>
        </section>
      </main>

      <footer id="sl-about">
        <div className="foot-grid">
          <div className="foot-brand">SATYAM —<br /><span className="muted">tailored crime <span style={{color:'var(--green-bright)'}}>⊗</span> intelligence</span></div>
          <div className="fcol"><h4>Capabilities</h4>
            <Link to="/console">Investigation Console</Link>
            <Link to="/network">Network Analysis</Link>
            <Link to="/forecast">Forecasting</Link>
            <Link to="/operations">Response Ops</Link>
          </div>
          <div className="fcol"><h4>Explore</h4>
            <Link to="/about">About us</Link>
            <a href="#sl-contact">Contact</a>
          </div>
          <div className="fcol"><h4>Connect</h4><a href="#">LinkedIn</a><a href="#">hack2skill</a></div>
        </div>
        <div className="foot-bottom"><span>© 2026 Satyam. All rights reserved.</span><span>build by Teen Titans</span></div>
      </footer>
    </div>
  );
}
