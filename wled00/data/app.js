"use strict";
// 灯自带的首页：与 Android / iOS App 同一布局（Light 仓库 docs/28-网页界面改版.md）。
// 底部三个灯效大类；设置（预设、分区、经典界面、WLED 设置、信息）收在左上角。
// 纯逻辑在 app_logic.js（有 Node 测试），这里只管 DOM 与收发。
//
// 标签跟着灯走：灯的大类在别处（讯飞 App、按键、Matter、另一个浏览器）变了才跟着切；
// 点标签只换显示，不改灯。状态走 /ws 实时推送；/ws 通着时每 3 秒发一次 "p"（灯回 "pong"），
// 超过 7 秒没收到任何消息就当它断了，改走每 3 秒轮询 /json/state，同时重连 /ws。

const L = LampLogic;
const S = {
  state: null, info: null, effects: [], palettes: [], fxdata: [], nova: null, palx: {}, presets: null, presetsError: false, cw: null,
  tab: "fixed", lampMode: null, kind: "solid", lampKind: null, palShown: false,
  novaCat: null, wledFilter: "", musicFilter: null,
  page: null,                       // 设置页：null 关闭；"root" / "presets" / "segments" / "info"
  ws: null, wsTimer: null, lastMsg: 0, lastTick: 0, saving: false, online: true, lastOk: 0,
};
const $ = (id) => document.getElementById(id);

// ── DOM 小工具 ──

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

// Material Icons（Apache 2.0）的路径
const ICON = {
  fixed: "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  lighting: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z",
  music: "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
  gear: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
};
function icon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "ic");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", ICON[name]);
  s.append(p);
  return s;
}
const rgbCss = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// 灯上来的说明文字可能带 HTML：用惰性文档取纯文本，不执行、不加载任何东西
// 并去掉私有区字符（U+E000–U+F8FF）：usermod 的按钮用图标字体字形，这里没有那套字体，只会显示成一个怪符号
const plain = (s) => new DOMParser().parseFromString(String(s), "text/html").body.textContent.replace(/[\uE000-\uF8FF]/g, "");

// ── 收发 ──

// 请求带超时（含读完响应体）：灯半死不活时别让请求一直挂着；超时按失败算。
// /json 与 /presets.json 体积大，给 10 秒，其余 4 秒。
async function fetchJson(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw Object.assign(new Error(`${url} ${r.status}`), { status: r.status });
    return await r.json();
  } finally { clearTimeout(t); }
}
const getJson = (url, ms = 4000) => fetchJson(url, { cache: "no-store" }, ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 灯内存吃紧时会回 503（原厂板常驻可用堆只有 ~55 KB），网络抖动与超时也常见：重试，间隔 300、600 ms。
// 404 是确定的回答（如自制板没有 /nova），不重试。
async function getJsonRetry(url, ms, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await getJson(url, ms); }
    catch (e) {
      if (e.status === 404 || i >= tries) throw e;
      await sleep(300 * i);
    }
  }
}

const wsLive = () => S.ws && S.ws.readyState === WebSocket.OPEN;

function send(patch) {
  if (wsLive()) { S.ws.send(JSON.stringify(patch)); return; }
  fetchJson("/json/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...patch, v: true }) }, 4000)
    .then((st) => { if (st && "on" in st) applyState(st); markOk(); })
    .catch(markFail);
}

function scheduleWs() {
  if (S.wsTimer) return;
  S.wsTimer = setTimeout(() => { S.wsTimer = null; connectWs(); }, 3000);
}
function connectWs() {
  if (S.ws) return;
  let ws;
  try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`); }
  catch (e) { scheduleWs(); return; }
  S.ws = ws;
  // 5 秒还没连上（半开、被代理吞掉）就放弃这条，稍后重来
  setTimeout(() => { if (S.ws === ws && ws.readyState === WebSocket.CONNECTING) dropWs(false); }, 5000);
  ws.onopen = () => { S.lastMsg = Date.now(); markOk(); };
  ws.onmessage = (e) => {
    S.lastMsg = Date.now();
    markOk();                                   // "pong" 与二进制帧也算活着
    if (typeof e.data !== "string" || e.data === "pong") return;
    let j;
    try { j = JSON.parse(e.data); } catch (_) { return; }
    if (j.info) S.info = j.info;
    if (j.state) applyState(j.state);
  };
  ws.onclose = () => { if (S.ws === ws) { S.ws = null; scheduleWs(); } };
}
// 半开的连接（灯断电、Wi-Fi 切换）不会触发 onclose：自己判死，摘掉回调、直接换路
function dropWs(immediate) {
  const ws = S.ws;
  S.ws = null;
  if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; try { ws.close(); } catch (_) { /* 已经死了 */ } }
  if (immediate) connectWs(); else scheduleWs();
}

async function poll() {
  const now = Date.now();
  // 与上一拍隔了 6 秒以上：浏览器把定时器挂起过（手机解锁等），这段「无声」不是连接的错
  const suspended = S.lastTick > 0 && now - S.lastTick > 6000;
  S.lastTick = now;
  if (wsLive()) {
    if (suspended) S.lastMsg = now;
    else if (now - S.lastMsg > 7000) { markFail(); dropWs(true); return; }
    try { S.ws.send("p"); } catch (_) { /* 下一拍再判 */ }
    return;
  }
  try { applyState(await getJson("/json/state")); markOk(); } catch (_) { if (!suspended) markFail(); }
}
// 回到前台时立即对一次：后台期间定时器和 /ws 都可能被系统挂起
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.state) return;
  if (wsLive()) { S.lastMsg = Date.now(); try { S.ws.send("p"); } catch (_) { /* 下一拍再判 */ } }
  else connectWs();
  getJson("/json/state").then((st) => { applyState(st); markOk(); }).catch(markFail);
});
function markOk() { S.lastOk = Date.now(); setOnline(true); }
function markFail() { if (Date.now() - S.lastOk > 6000) setOnline(false); }
function setOnline(on) {
  if (S.online === on) return;
  S.online = on;
  document.querySelectorAll(".banner").forEach((el) => { el.hidden = on; });
  document.body.classList.toggle("offline", !on);
}

async function loadPalx() {
  for (let page = 0, last = 0; page <= last; page++) {
    let p;
    try { p = await getJsonRetry(`/json/palx?page=${page}`, 4000); } catch (_) { break; }   // 404 或重试用尽：留下已读到的
    last = p.m;
    Object.assign(S.palx, p.p);
  }
  if (S.palShown) renderMain();
}

// 读失败（presets = null）与「确实没有预设」（[]）必须分开：把失败当空列表会让「存当前状态」去覆盖 1 号预设
async function loadPresets() {
  try { S.presets = L.presetsFrom(await getJsonRetry("/presets.json", 10000)); S.presetsError = false; }
  catch (_) { S.presets = null; S.presetsError = true; }
}

// ── 状态 ──

const segId = () => (L.primary(S.state) || {}).id ?? 0;
function usesPal() {
  const fx = (L.primary(S.state) || {}).fx;
  return fx != null && L.usesPalette(fx < S.fxdata.length ? S.fxdata[fx] : null);
}
function palVisible() {
  if (!usesPal()) return false;
  return (S.tab === "fixed" && S.kind === "wled" && S.lampKind === "wled") || (S.tab === "music" && S.lampMode === "music");
}

function applyState(st) {
  S.state = st;
  let rerender = false;
  const m = L.mode(st, S.effects);
  if (m !== S.lampMode) { S.lampMode = m; if (S.tab !== m) { S.tab = m; rerender = true; } }
  const k = L.fixedKind(st, S.nova);
  if (k !== S.lampKind) {
    S.lampKind = k;
    if (S.kind !== k) { S.kind = k; rerender = rerender || S.tab === "fixed"; }
  }
  if (palVisible() !== S.palShown) rerender = true;
  if (rerender) renderMain(); else update();
  if (S.page === "segments") renderSettings();
  else if (S.page === "presets") syncPresetMarks();
}

// 只同步数值与选中项，不重建 DOM（拖动中的滑块、列表滚动位置都不动）
function update() {
  if (!S.state) return;
  $("power").checked = !!S.state.on;
  $("lampname").textContent = (S.info && S.info.name) || "WLED";
  $("lampip").textContent = (S.info && S.info.ip) || location.host;
  document.querySelectorAll("[data-bind]").forEach(syncBind);
  document.querySelectorAll("[data-list]").forEach(syncList);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  const src = (S.state.lamp || {}).src ?? 0;
  document.querySelectorAll("[data-bind-src] button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === src));
  const pt = $("paltitle");
  if (pt) {
    const id = (L.primary(S.state) || {}).pal ?? 0;
    const c = L.paletteChoices(S.palettes, (S.info && S.info.umpalnames) || [], S.nova).find((p) => p.id === id);
    pt.textContent = `调色板 · ${c ? c.title : id}`;
  }
  updateNightlight();
}

// ── 滑块 ──

const BIND = {
  bri: { get: () => S.state.bri ?? 128, set: (v) => send({ bri: v }) },
  sx: { get: () => (L.primary(S.state) || {}).sx ?? 128, set: (v) => send({ seg: [{ id: segId(), sx: v }] }) },
  ix: { get: () => (L.primary(S.state) || {}).ix ?? 128, set: (v) => send({ seg: [{ id: segId(), ix: v }] }) },
  cw: {
    get: () => (S.state.nova && S.state.nova.cw != null ? S.state.nova.cw
      : L.whiteCw(((L.primary(S.state) || {}).col || [])[0]) ?? S.cw ?? 500),
    set: (v) => setWhite(v),
  },
};

// 拖动中每 120 ms 最多发一次，松手再发最终值（与 App 的 ThrottledSlider 同一节奏）
function slider(key, label, min = 0, max = 255) {
  const out = h("span", { class: "val" });
  const inp = h("input", { type: "range", min, max, dataset: { bind: key } });
  let last = 0, timer = null;
  const push = () => { timer = null; last = Date.now(); BIND[key].set(Number(inp.value)); };
  // 松手有好几种收法（鼠标、触摸、被系统打断、失焦），任一发生都清拖动标记并把最终值发出去
  const end = () => {
    if (!inp.dataset.drag) return;
    delete inp.dataset.drag;
    if (timer) clearTimeout(timer);
    push();
  };
  // 鼠标拖出滑块再松手时 pointerup 落在别处：在文档上补一个一次性的
  inp.addEventListener("pointerdown", () => document.addEventListener("pointerup", end, { once: true }));
  inp.addEventListener("input", () => {
    inp.dataset.drag = "1";
    out.textContent = inp.value;
    if (key === "cw") previewWhite(Number(inp.value));
    const wait = 120 - (Date.now() - last);
    if (wait <= 0) push(); else if (!timer) timer = setTimeout(push, wait);
  });
  for (const ev of ["change", "pointerup", "pointercancel", "touchend", "touchcancel", "blur"]) inp.addEventListener(ev, end);
  return h("div", { class: "slider act" }, h("label", null, label), inp, out);
}
function syncBind(inp) {
  if (inp.dataset.drag) return;
  const v = BIND[inp.dataset.bind].get();
  inp.value = v;
  inp.parentElement.querySelector(".val").textContent = v;
  if (inp.dataset.bind === "cw") previewWhite(v);
}

// ── 列表与选中项 ──

const CURRENT = {
  solid: () => { const seg = L.primary(S.state); return seg && seg.fx === 0 && seg.col && seg.col[0] ? seg.col[0].slice(0, 3).join(",") : null; },
  nova: () => { const seg = L.primary(S.state); return S.nova && seg && seg.fx === S.nova.scene.fx ? String(seg.c1) : null; },
  wled: () => { const seg = L.primary(S.state); return seg ? String(seg.fx) : null; },
  music: () => { const e = L.musicEntries(S.effects, S.nova, null).find((x) => L.isCurrentMusic(x, S.state, S.nova)); return e ? e.id : null; },
  pal: () => String((L.primary(S.state) || {}).pal ?? 0),
};

function syncList(box) {
  const k = CURRENT[box.dataset.list]();
  let hit = null;
  for (const el of box.querySelectorAll("[data-k]")) {
    const on = el.dataset.k === k;
    el.classList.toggle("on", on);
    if (on) hit = el;
  }
  if ((box.dataset.cur ?? "") === (k ?? "")) return;
  box.dataset.cur = k ?? "";
  if (box.dataset.list === "music") {
    box.querySelectorAll(".doc").forEach((d) => d.remove());
    const d = hit && hit.dataset.name ? L.doc(hit.dataset.name) : null;
    if (d) hit.after(docBlock(d));     // 选中且有说明的 ♪ 效果就地展开
  }
  if (hit) scrollInto(box, hit);
}
// 选中行已经完整在框内就不动，免得每次状态推送都把列表拽一下
function scrollInto(box, el) {
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (box.classList.contains("strip")) {
    if (r.left >= b.left && r.right <= b.right) return;
    box.scrollLeft += (r.left - b.left) - box.clientWidth / 2 + r.width / 2;
  } else {
    if (r.top >= b.top && r.bottom <= b.bottom) return;
    box.scrollTop += (r.top - b.top) - box.clientHeight / 2 + r.height / 2;
  }
}

function row({ k, title, onclick, extra, name }) {
  return h("button", { class: "row act", dataset: name ? { k, name } : { k }, onclick },
    h("span", { class: "t" }, title), extra || null, h("span", { class: "ck" }, "✓"));
}
function chipRow(opts, cur, pick) {
  return h("div", { class: "chips" }, opts.map(([v, t]) =>
    h("button", { class: v === cur ? "chip on" : "chip", onclick: () => pick(v === cur && v != null ? null : v) }, t)));
}
function docBlock(d) {
  const labels = ["是什么", "怎么动", "参数", "配色", "场合"];
  return h("div", { class: "doc" },
    h("div", { class: "tags" }, [...d.c].map((c) => h("span", null, L.CATEGORY_TITLE[c] || c))),
    d.l.map((line, i) => h("div", { class: "dl" }, h("b", null, labels[i]), h("span", null, line))));
}

// ── 页面骨架 ──

function shell() {
  document.body.append(
    h("div", { class: "head" },
      h("header", { class: "top" },
        h("button", { class: "icon", "aria-label": "设置", onclick: () => openSettings("root") }, icon("gear")),
        h("div", { class: "title" }, h("b", { id: "lampname" }, "WLED"), h("small", { id: "lampip" })),
        h("label", { class: "switch act", "aria-label": "电源" },
          h("input", { type: "checkbox", id: "power", onchange: (e) => send({ on: e.target.checked }) }), h("span"))),
      h("div", { id: "banner", class: "banner", hidden: true }, "已断开，正在重连…")),
    h("main", { id: "main" }),
    h("nav", { id: "tabs" }, [["fixed", "固定灯效"], ["lighting", "照明"], ["music", "音乐律动"]].map(([t, title]) =>
      h("button", { dataset: { tab: t }, onclick: () => { S.tab = t; renderMain(); } }, icon(t), h("span", null, title)))),
    h("section", { id: "settings", hidden: true }));
}

function renderMain() {
  const body = { fixed: fixedTab, lighting: lightingTab, music: musicTab }[S.tab]();
  S.palShown = palVisible();
  $("main").replaceChildren(h("div", { class: "card" }, slider("bri", "亮度", 1, 255)), ...[body].flat(Infinity).filter(Boolean), nightlight());
  update();
  if (S.tab === "music") startMeters();
}

// ── 固定灯效 ──

function fixedTab() {
  const kinds = [["solid", "静态"]].concat(S.nova ? [["nova", "讯飞"]] : [], [["wled", "WLED"]]);
  if (S.kind === "nova" && !S.nova) S.kind = "solid";
  const seg = h("div", { class: "seg" }, kinds.map(([k, t]) =>
    h("button", { class: k === S.kind ? "on" : "", onclick: () => { S.kind = k; renderMain(); } }, t)));
  const body = S.kind === "solid" ? solidPicker() : S.kind === "nova" ? novaList() : wledPanel();
  return [seg, body];
}

function setSolid(rgb) { send({ seg: [{ id: segId(), fx: 0, col: [rgb] }] }); }

// 常用色按原厂取色方式（HSV 满饱和满亮度），与讯飞灯效一样饱满
function solidPicker() {
  const pick = h("input", { type: "color", value: "#ffffff" });
  return h("div", { class: "card" },
    h("div", { class: "swatches act", dataset: { list: "solid" } }, L.SOLID_SWATCHES.map((s) =>
      h("button", { class: "sw", dataset: { k: s.rgb.join(",") }, onclick: () => setSolid(s.rgb) },
        h("i", { style: `background:${rgbCss(s.rgb)}` }), h("span", null, s.name)))),
    h("div", { class: "line act" }, h("label", null, "自选颜色"), pick,
      h("button", { class: "btn", onclick: () => setSolid(hexRgb(pick.value)) }, "应用")));
}

// 讯飞灯效：效果「讯飞场景」+ 场景号（c1），速度回到原厂节奏
function novaList() {
  const chips = chipRow([[null, "全部"]].concat(S.nova.scene.categories.map((c, i) => [i, L.novaCategoryTitle(c)])),
    S.novaCat, (v) => { S.novaCat = v; renderMain(); });
  const rows = S.nova.scene.names
    .map(([name, cat], i) => ({ name, cat, i }))
    .filter((e) => S.novaCat == null || e.cat === S.novaCat)
    .map((e) => row({ k: String(e.i), title: e.name, onclick: () => send({ seg: [{ id: segId(), fx: S.nova.scene.fx, sx: 128, c1: e.i }] }) }));
  return [chips, h("div", { class: "list", dataset: { list: "nova" } }, rows)];
}

function wledPanel() {
  const input = h("input", { type: "search", class: "filter", placeholder: "筛选效果（中英文均可）", value: S.wledFilter });
  const box = h("div", { class: "list", dataset: { list: "wled" } });
  let first = true;
  const fill = () => {
    const list = L.wledEffects(S.effects, S.fxdata, S.nova, S.wledFilter);
    box.replaceChildren(...list.map((e) => row({ k: String(e.index), title: L.effectDisplay(e.name), onclick: () => send({ seg: [{ id: segId(), fx: e.index }] }) })));
    if (!list.length) box.append(h("div", { class: "empty" }, "没有匹配的效果"));
    // 首次填充时盒子还没挂上页面，滚不动；交给挂载后的 update() 去定位。之后（筛选）才重新对一次
    if (!first) { delete box.dataset.cur; syncList(box); }
    first = false;
  };
  input.addEventListener("input", () => { S.wledFilter = input.value; fill(); });
  fill();
  return [input, box, palVisible() ? paletteStrip() : null, params("强度"),
    h("p", { class: "note" }, "WLED 原生效果的「强度」含义各不相同（密度、数量、宽度等）。")];
}

// 速度与强度 / 灵敏度：♪ 效果把 ix 当灵敏度用，WLED 原生效果里它各有各的含义
function params(ixLabel) { return h("div", { class: "card" }, slider("sx", "速度"), slider("ix", ixLabel)); }

// 调色板：两行横滑卡片，每张画出调色板本身的渐变；讯飞的在前
function paletteStrip() {
  const choices = L.paletteChoices(S.palettes, (S.info && S.info.umpalnames) || [], S.nova);
  const segColors = (L.primary(S.state) || {}).col;
  const strip = h("div", { class: "strip", dataset: { list: "pal" } }, choices.map((p) => {
    const raw = S.palx[p.id];
    const stops = raw ? L.paletteStops(raw, segColors, p.id) : [];
    return h("button", { class: "pal act", dataset: { k: String(p.id) }, onclick: () => send({ seg: [{ id: segId(), pal: p.id }] }) },
      h("i", { style: `background:${gradient(stops)}` }),
      h("b", null, p.title),
      h("small", null, p.zh ? p.name.replace(/^讯飞: /, "") : " "));   // 英文原名，与经典界面、WLED 文档对得上
  }));
  return h("div", { class: "palbox" }, h("div", { class: "note", id: "paltitle" }), strip);
}
function gradient(stops) {
  if (!stops.length) return "var(--sv)";
  if (stops.length === 1) return rgbCss(stops[0][1]);
  const s = [...stops].sort((a, b) => a[0] - b[0]).map(([p, c]) => `${rgbCss(c)} ${(p * 100).toFixed(1)}%`);
  return `linear-gradient(90deg,${s.join(",")})`;
}

// ── 照明 ──

function setWhite(cw) {
  S.cw = cw;
  send({ seg: [{ id: segId(), fx: 0, col: [L.vendorWhite(cw)] }], nova: { cw } });
}
function previewWhite(cw) { const el = $("wprev"); if (el) el.style.background = rgbCss(L.vendorWhite(cw)); }

function lightingTab() {
  return h("div", { class: "card" },
    h("div", { id: "wprev", class: "wprev" }),
    slider("cw", "色温", 0, 1000),
    h("div", { class: "line act" }, [["暖光", 0], ["自然", 500], ["冷光", 1000]].map(([t, cw]) =>
      h("button", { class: "btn", onclick: () => setWhite(cw) }, t))),
    h("p", { class: "note" }, "0 暖 … 1000 冷，按原厂白光曲线取色，与讯飞 App、Matter 调出的白光相同。"));
}

// ── 音乐律动 ──

function pickMusic(e) {
  if (e.kind === "nova") send({ seg: [{ id: segId(), fx: S.nova.music.fx, c1: L.musicC1(e.index, S.nova.music.names.length) }] });
  else send({ seg: [{ id: segId(), fx: e.index }] });
}

function musicTab() {
  const filters = [[null, "全部"]].concat(L.MUSIC_FILTERS.filter((f) => f.id !== "nova" || S.nova).map((f) => [f.id, f.title]));
  const chips = chipRow(filters, S.musicFilter, (v) => { S.musicFilter = v; renderMain(); });
  const list = L.musicEntries(S.effects, S.nova, S.musicFilter);
  const box = h("div", { class: "list", dataset: { list: "music" } }, list.map((e) => row({
    k: e.id,
    title: e.kind === "nova" ? `讯飞 · ${e.name}` : L.effectDisplay(e.name),
    onclick: () => pickMusic(e),
    name: e.kind === "effect" ? e.name : null,
    extra: e.kind === "effect" && L.doc(e.name) ? h("span", { class: "info" }, "ⓘ") : null,   // 有说明的标出来
  })));
  if (!list.length) box.append(h("div", { class: "empty" }, "没有匹配的效果"));
  return [chips, box, palVisible() ? paletteStrip() : null, params("灵敏度"), sourcePicker(), meters()];
}

function sourcePicker() {
  return h("div", { class: "card" },
    h("div", { class: "seg act", dataset: { bindSrc: "1" } }, [["Auto", 0], ["Local", 1], ["LAMP1", 2]].map(([t, v]) =>
      h("button", { dataset: { v: String(v) }, onclick: () => send({ lamp: { src: v } }) }, t))),
    h("p", { class: "note" }, "Local 用板载麦克风或 3.5mm 线路输入；LAMP1 用 Mac 送来的分析结果，只有它带语义情绪。"));
}

// 实时仪表：只在音乐律动页、设置没打开时轮询 /lampdata，5 Hz
function meters() {
  return h("div", { class: "card", id: "meters" },
    h("div", { class: "bars" }, Array.from({ length: 16 }, () => h("i"))),
    h("div", { class: "note", id: "meterline" }, "正在读取分析数据…"));
}
let meterTimer = null;
function startMeters() {
  if (meterTimer) return;
  const tick = async () => {
    if (S.tab !== "music" || S.page || !$("meters")) { meterTimer = null; return; }
    try { drawMeters(await getJson("/lampdata")); } catch (_) { /* 下一拍再试 */ }
    meterTimer = setTimeout(tick, 200);
  };
  meterTimer = setTimeout(tick, 0);
}
function drawMeters(t) {
  const box = $("meters");
  if (!box) return;
  box.querySelectorAll(".bars i").forEach((b, i) => { b.style.height = `${Math.round(Math.min(1, (t.bands && t.bands[i]) || 0) * 100)}%`; });
  $("meterline").textContent = `RMS ${(t.rms || 0).toFixed(2)} · BPM ${Math.round(t.bpm || 0)} · 节拍置信 ${(t.conf || 0).toFixed(2)}`;
}

// ── 夜灯 ──

function nightlight() {
  return h("div", { class: "card act" },
    h("label", { class: "line" }, h("span", { style: "flex:1" }, "夜灯定时关灯"),
      h("input", { type: "checkbox", id: "nlon", onchange: (e) => send({ nl: { on: e.target.checked } }) })),
    h("div", { class: "line" },
      h("button", { class: "btn", onclick: () => nlStep(-5) }, "−5"),
      h("span", { id: "nldur", style: "flex:1;text-align:center" }),
      h("button", { class: "btn", onclick: () => nlStep(5) }, "+5")),
    h("div", { class: "note", id: "nlrem" }));
}
function nlStep(d) {
  const cur = (S.state.nl || {}).dur ?? 60;
  send({ nl: { dur: Math.max(1, Math.min(255, cur + d)) } });
}
function updateNightlight() {
  if (!$("nlon")) return;
  const nl = S.state.nl || {};
  $("nlon").checked = !!nl.on;
  $("nldur").textContent = `${nl.dur ?? 60} 分钟后关`;
  $("nlrem").textContent = nl.on && nl.rem > 0 ? `剩余 ${Math.floor(nl.rem / 60)} 分 ${nl.rem % 60} 秒` : "";
}

// ── 设置 ──

const LOADING = () => h("div", { class: "empty" }, "正在读取…");

function openSettings(page) {
  S.page = page;
  renderSettings();
  if (page === "presets") loadPresets().then(() => { if (S.page === "presets") renderSettings(); });
}

function renderSettings() {
  const box = $("settings");
  if (!S.page) {
    box.hidden = true;
    box.replaceChildren();
    if (S.tab === "music") startMeters();
    return;
  }
  box.hidden = false;
  const back = () => openSettings(S.page === "root" ? null : "root");
  const titles = { root: "设置", presets: "预设", segments: "分区", info: "设备信息" };
  const body = { root: settingsRoot, presets: presetsPage, segments: segmentsPage, info: infoPage }[S.page]();
  box.replaceChildren(
    h("div", { class: "head" },
      h("header", { class: "top" }, h("button", { class: "icon", "aria-label": "返回", onclick: back }, icon("back")),
        h("div", { class: "title" }, h("b", null, titles[S.page])), h("span", { class: "icon" })),
      h("div", { class: "banner", hidden: S.online }, "已断开，正在重连…")),
    h("div", { class: "page" }, body));
}

function settingsRoot() {
  const nav = (t, sub, page) => h("button", { class: "row", onclick: () => openSettings(page) },
    h("span", { class: "t" }, t), h("small", null, sub), h("span", { class: "go" }, "›"));
  const link = (t, href) => h("a", { class: "row", href }, h("span", { class: "t" }, t), h("span", { class: "go" }, "›"));
  return [
    h("h3", null, "灯效"),
    h("div", { class: "group" }, nav("预设", "存下当前状态，一键切回", "presets"), nav("分区", "把灯柱分成几段", "segments")),
    h("h3", null, "高级"),
    h("div", { class: "group" },
      link("经典 WLED 界面", "/classic"),
      link("WLED 设置 · Wi-Fi", "/settings/wifi"), link("WLED 设置 · LED", "/settings/leds"),
      link("WLED 设置 · 界面", "/settings/ui"), link("WLED 设置 · 同步", "/settings/sync"),
      link("WLED 设置 · 时间与宏", "/settings/time"), link("WLED 设置 · 安全与更新", "/settings/sec"),
      link("WLED 设置 · Usermod", "/settings/um"), link("固件更新", "/update")),
    h("p", { class: "note", style: "margin:8px 4px" }, "播放列表、逐段参数、自定义调色板、实时预览、多灯节点在经典界面里。"),
    h("h3", null, "信息"),
    h("div", { class: "group" }, nav("设备信息", "版本、联网、内存", "info")),
  ];
}

// 灯上切了预设，设置页里的 ✓ 跟着走；只改 class，不重建，名称框里写到一半的字不丢
function syncPresetMarks() {
  const ps = S.state && S.state.ps;
  document.querySelectorAll("#settings [data-pid]").forEach((el) => el.classList.toggle("on", Number(el.dataset.pid) === ps));
}

function presetsPage() {
  const name = h("input", { type: "text", class: "filter", placeholder: "预设名称" });
  const btn = h("button", { class: "btn", disabled: S.saving, onclick: () => save() }, "存当前状态");
  // 存的过程中按钮置灰（到重读完为止），连点两下不会两次选到同一个槽位
  const save = async () => {
    if (S.saving) return;
    S.saving = true;
    btn.disabled = true;
    try {
      await loadPresets();                    // 选槽位前现读一遍，读不出来就不存，免得盖掉已有预设
      if (S.presets) {
        const id = L.nextFreeSlot(S.presets);
        send({ psave: id, n: name.value.trim() || `预设 ${id}`, ib: true, sb: true });   // 与经典界面默认一致：带亮度与分区边界
        name.value = "";
        await settlePresets((ps) => ps.some((p) => p.id === id));
      }
    } finally { S.saving = false; }
    if (S.page === "presets") renderSettings();
  };
  const del = (p) => { if (confirm(`删除预设「${p.name}」？`)) { send({ pdel: p.id }); reloadPresets((ps) => !ps.some((q) => q.id === p.id)); } };
  const cur = S.state && S.state.ps;
  let list;
  if (S.presets) {
    list = S.presets.length
      ? S.presets.map((p) => h("div", { class: p.id === cur ? "row on" : "row", dataset: { pid: String(p.id) } },
          h("button", { class: "t act", style: "text-align:left", onclick: () => send({ ps: p.id }) }, `${p.id}. ${p.name}`),
          p.isPlaylist ? h("small", null, "播放列表") : null,
          h("span", { class: "ck" }, "✓"),
          h("button", { class: "btn danger act", onclick: () => del(p) }, "删除")))
      : h("div", { class: "empty" }, "还没有预设");
  } else {
    list = S.presetsError ? h("div", { class: "empty" }, "预设列表读不出来，稍后再试") : LOADING();
  }
  return [
    h("div", { class: "line act", style: "margin-top:12px" }, name, btn),
    h("p", { class: "note", style: "margin:8px 4px" }, "存下灯现在的效果、颜色、亮度与分区。播放列表请在经典界面编辑。"),
    h("div", { class: "group" }, list),
  ];
}
// 等灯写完 presets.json：600 ms 后读一次；读不出来或结果还没体现这次改动（存的槽位还没有 / 删的还在），1.5 s 后再读一次
async function settlePresets(done) {
  await sleep(600);
  await loadPresets();
  if (!S.presets || !done(S.presets)) { await sleep(1500); await loadPresets(); }
}
async function reloadPresets(done) {
  await settlePresets(done);
  if (S.page === "presets") renderSettings();
}

const segFx = (s) => (S.effects[s.fx] ? L.effectDisplay(S.effects[s.fx]) : "");

function segmentsPage() {
  if (!S.state) return LOADING();
  const segs = S.state.seg || [];
  const apply = (t) => { if (confirm(`按「${t.name}」重新分区？现有分段会被替换。`)) send(L.templatePatch(t, S.state, S.effects, S.nova)); };
  return [
    h("h3", null, "模板"),
    h("div", { class: "group" }, L.templatesFor(S.info && S.info.leds && S.info.leds.count).map((t) => h("div", { class: "row col" },
      h("div", { class: "t" }, h("b", null, t.name), h("small", null, `${t.zones.length} 段 · ${t.note}`)),
      h("button", { class: "btn act", onclick: () => apply(t) }, "应用")))),
    h("p", { class: "note", style: "margin:8px 4px" }, "讯飞灯效与 ♪ 效果按整条设计；原厂板固件切到它们时会自动合并回整条。逐段的效果、颜色、镜像请在经典界面调整。"),
    h("h3", null, "当前分段"),
    h("div", { class: "group" }, segs.map((s) => h("div", { class: "row" },
      h("span", { class: "t" }, s.n || `段 ${s.id}`),
      h("small", null, `${s.start}–${s.stop}${segFx(s) ? ` · ${segFx(s)}` : ""}`)))),
  ];
}

function fmtUptime(s) {
  if (s == null) return null;
  const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d ? `${d} 天 ` : ""}${hr} 小时 ${m} 分`;
}
function infoPage() {
  if (!S.info) return LOADING();
  const i = S.info;
  const w = i.wifi || {};
  const rows = [
    ["名称", i.name], ["版本", i.ver], ["IP", i.ip],
    ["MAC", i.mac ? i.mac.match(/../g).join(":").toUpperCase() : null],
    ["运行时间", fmtUptime(i.uptime)],
    ["可用内存", i.freeheap != null ? `${Math.round(i.freeheap / 1024)} KB` : null],
    ["Wi-Fi 信号", w.rssi != null ? `${w.rssi} dBm（${w.signal}%）· 信道 ${w.channel}` : null],
    ["灯珠", i.leds && i.leds.count],
  ];
  // usermod 报的条目（含原厂板的「Wi-Fi 诊断」「讯飞云」），值可能带 HTML
  const um = Object.entries(i.u || {}).map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).map((x) => plain(x).replace(/\s+/g, " ").trim()).filter(Boolean).join(" ")]);
  return h("div", { class: "group", style: "margin-top:12px" }, rows.concat(um)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => h("div", { class: "row kv" }, h("span", null, k), h("b", null, String(v)))));
}

// ── 启动 ──

// /nova 缺字段（版本不匹配、被别的服务顶替）时当作没有，免得讯飞入口渲染到一半抛错
function novaOrNull(n) {
  const ok = n && n.scene && n.music && Array.isArray(n.scene.names) && Array.isArray(n.scene.categories) && Array.isArray(n.music.names)
    && typeof n.scene.fx === "number" && typeof n.music.fx === "number";
  if (n && !ok) console.warn("/nova 缺少 scene / music 数组，忽略讯飞入口", n);
  return ok ? n : null;
}

// 逐个取（并发请求会同时吃堆，原厂板上容易 503），各自带重试。
// /json 必须取到：失败由 boot 退避重来。/json/fxdata 与 /nova 是可选的：404 / 返回的不是 JSON = 这台灯没有该接口（自制板没有 /nova），
// 算已解决；其余失败重试用尽就先降级（fxdata [] / nova null）让页面能用，由 retryOptional 在后台每 10 秒再取，直到成功。
const absent = (e) => e.status === 404 || e instanceof SyntaxError;
async function fetchOptional(url, parse, none) {
  try { return { done: true, value: parse(await getJsonRetry(url, 10000)) }; }
  catch (e) {
    if (absent(e)) return { done: true, value: none };
    console.warn(`${url} 暂时取不到，先降级，稍后重试`, e);
    return { done: false, value: none };
  }
}
const fetchFxdata = () => fetchOptional("/json/fxdata", (j) => (Array.isArray(j) ? j : []), []);
const fetchNova = () => fetchOptional("/nova", novaOrNull, null);

async function loadBase() {
  const b = await getJsonRetry("/json", 10000);
  const fx = await fetchFxdata();
  const nova = await fetchNova();
  return { b, fx, nova };
}

// 后台补取降级掉的 fxdata / nova；到手后重算大类并重画，两个都解决就停
function retryOptional(fx, nova) {
  const todo = { fx: !fx.done, nova: !nova.done };
  if (!todo.fx && !todo.nova) return;
  const tick = async () => {
    let changed = false;
    if (todo.fx) {
      const r = await fetchFxdata();
      if (r.done) { todo.fx = false; S.fxdata = r.value; changed = true; }
    }
    if (todo.nova) {
      const r = await fetchNova();
      if (r.done) { todo.nova = false; S.nova = r.value; changed = true; }
    }
    if (changed) {
      const k = L.fixedKind(S.state, S.nova);
      if (S.kind === S.lampKind) S.kind = k;
      S.lampKind = k;
      try { renderMain(); } catch (e) { console.error(e); }
      if (S.page) renderSettings();
    }
    if (todo.fx || todo.nova) setTimeout(tick, 10000);
  };
  setTimeout(tick, 10000);
}

async function boot() {
  shell();
  let base;
  for (let wait = 2000; ; wait = Math.min(wait * 2, 10000)) {
    try { base = await loadBase(); break; }
    catch (_) { setOnline(false); await new Promise((r) => setTimeout(r, wait)); }
  }
  const { b, fx, nova } = base;
  Object.assign(S, { info: b.info, effects: b.effects || [], palettes: b.palettes || [], fxdata: fx.value, nova: nova.value });
  S.state = b.state;
  S.lampMode = S.tab = L.mode(b.state, S.effects);
  S.lampKind = S.kind = L.fixedKind(b.state, S.nova);
  markOk();
  try { renderMain(); }
  catch (e) {                                  // 渲染出错不是「离线」：留一行可见的提示和控制台堆栈，不重载
    console.error(e);
    $("main").replaceChildren(h("div", { class: "empty" }, "页面渲染出错，详情见浏览器控制台"));
  }
  if (S.page) renderSettings();
  connectWs();
  setInterval(poll, 3000);
  loadPalx();
  loadPresets();
  retryOptional(fx, nova);
}
document.addEventListener("DOMContentLoaded", boot);
