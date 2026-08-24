// Throwaway: confirm a fresh session (no localStorage yet) lands on the landing
// page in light mode by default.
const BASE = "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send: (method, params) =>
          new Promise((res, rej) => {
            const i = ++id;
            pending.set(i, { res, rej });
            ws.send(JSON.stringify({ id: i, method, params }));
          }),
        close: () => ws.close(),
      });
  });
}

const check = (name, ok, extra = "") =>
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " :: " + extra : ""}`);

(async () => {
  const tab = await (
    await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })
  ).json();
  const cdp = await connect(tab.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  const ev = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  // ── 1) Fresh session, landing page ("/") ─────────────────────────────────
  await cdp.send("Page.navigate", { url: `${BASE}/` });
  await sleep(3500);
  const state = await ev(
    `(() => JSON.stringify({
       storedMode: localStorage.getItem('satyam-mode'),
       hasLightClass: document.querySelector('.satyam-landing')?.classList.contains('light'),
       bg: getComputedStyle(document.querySelector('.satyam-landing')).getPropertyValue('--bg').trim(),
     }))()`,
  );
  const s = JSON.parse(state);
  check("no stored mode on a fresh session", s.storedMode === null, `stored=${s.storedMode}`);
  check("landing page defaults to the light class", s.hasLightClass === true);
  check("light background variable applied (#eef4ec)", s.bg === "#eef4ec", `bg=${s.bg}`);

  // ── 2) Reload — light must persist as the default, not just first paint ──
  await cdp.send("Page.reload", {});
  await sleep(3000);
  const s2 = JSON.parse(
    await ev(`(() => JSON.stringify({ light: document.querySelector('.satyam-landing')?.classList.contains('light') }))()`),
  );
  check("still light after a reload with no stored mode", s2.light === true);

  // ── 3) User explicitly switches to dark, and it sticks ───────────────────
  await ev(`document.querySelector('#sl-modeBtn')?.click(); 'clicked'`);
  await sleep(500);
  const s3 = JSON.parse(
    await ev(`(() => JSON.stringify({ light: document.querySelector('.satyam-landing')?.classList.contains('light'), stored: localStorage.getItem('satyam-mode') }))()`),
  );
  check("clicking the mode toggle switches to dark", s3.light === false && s3.stored === "dark", JSON.stringify(s3));

  await cdp.send("Page.reload", {});
  await sleep(3000);
  const s4 = JSON.parse(
    await ev(`(() => JSON.stringify({ light: document.querySelector('.satyam-landing')?.classList.contains('light') }))()`),
  );
  check("explicit dark choice persists across reload", s4.light === false);

  // ── 4) Authenticated app: also light by default for a fresh session ─────
  await ev(`localStorage.clear(); 'cleared'`);
  await cdp.send("Page.navigate", { url: `${BASE}/login` });
  await sleep(2500);
  const s5 = JSON.parse(
    await ev(`(() => JSON.stringify({ dark: document.documentElement.classList.contains('dark'), stored: localStorage.getItem('fq-dark') }))()`),
  );
  check("authenticated app also defaults to light for a fresh session", s5.dark === false, JSON.stringify(s5));

  cdp.close();
  process.exit(0);
})().catch((e) => {
  console.error("DRIVER ERROR", e);
  process.exit(2);
});
