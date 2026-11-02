// 灯效三大类与各列表的纯逻辑，逐条照 LampKit 的 LightModes.swift / EffectCatalog.swift / SegmentTemplate.swift。
// Swift、Kotlin、这里三份实现由 LampKit 的 tools/light_mode_cases.json 约束（tools/app-test.js 跑）：改分类先改用例表。
// 浏览器里挂 window.LampLogic；Node 下 module.exports。中文名与 ♪ 说明来自生成的 app_names.js。
(function (root, NAMES) {
  "use strict";
  const f = Math.fround;

  // ── 原厂白光：与固件 nova_light.h 同一公式。每步 fround 模拟 Swift 的 Float，边界上的舍入才一致 ──
  function vendorWhite(cw) {
    const t = f(Math.max(0, Math.min(1000, cw)));
    let s = f(f(f(655 - f(f(877 * t) / 1e3)) + f(f(f(502 * t) * t) / 1e6)) - f(f(f(f(165 * t) * t) * t) / 1e9));
    s = f(Math.max(0, Math.min(1000, s)) / 1000);
    const h = f(28 / 60);
    const g = f(1 - f(s * f(1 - h)));
    const b = f(1 - s);
    return [255, Math.floor(f(g * 255) + 0.5), Math.floor(f(b * 255) + 0.5)];
  }
  const WHITES = Array.from({ length: 1001 }, (_, cw) => vendorWhite(cw).join(","));
  // 颜色正是某个色温的原厂白光时返回那个色温（自制板上靠它认出照明模式）
  function whiteCw(rgb) {
    if (!rgb || rgb.length < 3) return null;
    const i = WHITES.indexOf(rgb.slice(0, 3).join(","));
    return i < 0 ? null : i;
  }

  // 原厂 HSVtoRGB(h, 1000, 1000)：总有一个通道是 255
  function hsvFull(h) {
    const fr = (h % 60) / 60;
    const q = Math.trunc(255 * (1 - fr) + 0.5), t = Math.trunc(255 * fr + 0.5);
    switch (Math.floor(h / 60)) {
      case 0: return [255, t, 0];
      case 1: return [q, 255, 0];
      case 2: return [0, 255, t];
      case 3: return [0, q, 255];
      case 4: return [t, 0, 255];
      default: return [255, 0, q];
    }
  }
  const SOLID_SWATCHES = [["红", 0], ["橙", 30], ["黄", 60], ["绿", 120], ["青", 180], ["蓝", 240], ["紫", 280], ["粉", 320]]
    .map(([name, h]) => ({ name, rgb: hsvFull(h) }));

  // ── ♪ 讯飞音乐：固件把 c1 的 0–255 均分成 N 档 ──
  function musicIndex(c1, count) { return count > 0 ? Math.max(0, Math.min(count - 1, Math.floor((c1 * count) / 256))) : 0; }
  function musicC1(index, count) { return count > 0 ? Math.floor((index * 256) / count) + Math.floor(128 / count) : 0; }

  const NOVA_CATEGORY = { basic: "基础", natural: "自然", festival: "节日", life: "生活", funny: "趣味", emotion: "情绪", ambient: "氛围" };
  function novaCategoryTitle(code) { return NOVA_CATEGORY[code] || code; }
  const CATEGORY_TITLE = { B: "节奏", S: "频谱", M: "旋律", V: "人声", D: "氛围" };
  const MUSIC_FILTERS = [{ id: "nova", title: "讯飞" }].concat(Object.keys(CATEGORY_TITLE).map((c) => ({ id: c, title: CATEGORY_TITLE[c] })));

  function isMusic(name) { return typeof name === "string" && name.startsWith("♪"); }
  function doc(name) { return (name && NAMES.docs[name.trim()]) || null; }
  function docCategories(name) { const d = doc(name); return d ? d.c : ""; }
  // 「Rainbow - 彩虹」；没有中文的（讯飞的两个效果本身就是中文）原样
  function effectDisplay(name) { const zh = NAMES.effects[name]; return zh ? `${name} - ${zh}` : name; }

  // ── 当前模式 ──
  function primary(state) { return (state && state.seg && state.seg[0]) || null; }

  // 纯色且颜色正是原厂白光 → 照明；♪ 效果 → 音乐律动；其余 → 固定灯效。原厂板以固件报的 nova.white 为准
  function mode(state, effects) {
    const seg = primary(state);
    if (!seg || seg.fx == null) return "fixed";
    if (seg.fx === 0) {
      const white = state.nova ? state.nova.white : undefined;
      if (white != null) return white ? "lighting" : "fixed";
      return whiteCw(seg.col && seg.col[0]) != null ? "lighting" : "fixed";
    }
    return seg.fx < effects.length && isMusic(effects[seg.fx]) ? "music" : "fixed";
  }

  function fixedKind(state, nova) {
    const seg = primary(state);
    if (!seg || seg.fx == null || seg.fx === 0) return "solid";
    if (nova && seg.fx === nova.scene.fx) return "nova";
    return "wled";
  }

  // ── 列表 ──

  // 效果元数据的标记段（0 / 1 / 2 维，v 音量，f 频率）。/json/fxdata 去掉了名字，源码里是 "名字@…"，两种都认
  function flags(meta) {
    const at = meta.indexOf("@");
    const parts = (at < 0 ? meta : meta.slice(at + 1)).split(";");
    return parts.length > 3 ? parts[3] : "";
  }

  // 固定灯效里的 WLED 原生效果：去掉纯色、♪ 效果、讯飞的两个效果、依赖音频的（v / f）和只有 2D 的
  function wledEffects(effects, fxData, nova, filter) {
    const skip = new Set([0, nova ? nova.scene.fx : -1, nova ? nova.music.fx : -1]);
    const needle = (filter || "").trim().toLowerCase();
    const out = [];
    effects.forEach((name, i) => {
      if (skip.has(i) || name === "RSVD" || isMusic(name)) return;
      if (i < fxData.length) {
        const fl = flags(fxData[i]);
        if (fl.includes("v") || fl.includes("f")) return;
        const dims = fl.replace(/[^0-9]/g, "");
        if (dims && !dims.includes("1")) return;
      }
      if (needle && !effectDisplay(name).toLowerCase().includes(needle)) return;   // 中英文都能搜
      out.push({ index: i, name });
    });
    return out;
  }

  // 音乐律动列表。不筛时原厂 8 个在前、♪ 效果在后；♪ 讯飞音乐本身不单列（它就是那 8 个）
  function musicEntries(effects, nova, filter) {
    const novaList = nova ? nova.music.names.map((name, i) => ({ id: `nova-${i}`, kind: "nova", index: i, name })) : [];
    const lamp = [];
    effects.forEach((name, i) => {
      if (!isMusic(name) || (nova && i === nova.music.fx)) return;
      if (filter && filter !== "nova" && !docCategories(name).includes(filter)) return;
      lamp.push({ id: `fx-${i}`, kind: "effect", index: i, name });
    });
    if (filter == null) return novaList.concat(lamp);
    return filter === "nova" ? novaList : lamp;
  }

  function isCurrentMusic(e, state, nova) {
    const seg = primary(state);
    if (!seg || seg.fx == null) return false;
    if (e.kind === "effect") return seg.fx === e.index;
    if (!nova || seg.fx !== nova.music.fx) return false;
    return musicIndex(seg.c1 || 0, nova.music.names.length) === e.index;
  }

  // ── 调色板 ──

  // usermod 注册的在前（原厂板的「讯飞: …」），编号 255 起往下；然后是内置的，编号即下标。
  // 讯飞调色板的中文取 /nova 里同名场景（「英文 - 中文」）的中文
  const NOVA_PAL = "讯飞: ";
  function paletteChoices(palettes, umpalnames, nova) {
    const sceneZh = {};
    for (const [name] of nova ? nova.scene.names : []) {
      const parts = name.split(" - ");
      if (parts.length >= 2) sceneZh[parts[0]] = parts.slice(1).join(" - ");
    }
    const um = (umpalnames || []).map((n, j) => {
      const zh = n.startsWith(NOVA_PAL) && sceneZh[n.slice(NOVA_PAL.length)] ? `讯飞 · ${sceneZh[n.slice(NOVA_PAL.length)]}` : null;
      return { id: 255 - j, name: n, zh, title: zh || n };
    });
    const builtin = palettes.map((n, i) => {
      const zh = NAMES.palettes[n] || null;
      return { id: i, name: n, zh, title: zh || n };
    });
    return um.concat(builtin);
  }

  // 预览色标 [位置 0–1, RGB]。/json/palx 给色标就照搬；给记号就均匀铺开：c1–c3 取段当前颜色，
  // r 是随机色，按编号取固定一组（与 Swift 同一个 64 位 LCG），免得每次重绘都变
  const DEFAULT_SEG_COLORS = [[255, 160, 0], [0, 0, 0], [0, 0, 0]];
  const M64 = (1n << 64n) - 1n;
  function paletteStops(raw, segColors, id) {
    let rng = ((BigInt.asUintN(64, BigInt(id)) * 0x9e3779b97f4a7c15n) & M64) | 1n;
    const n = raw.length;
    const out = [];
    raw.forEach((item, i) => {
      if (Array.isArray(item)) {
        if (item.length >= 4) out.push([item[0] / 255, item.slice(1, 4)]);
        return;
      }
      let rgb;
      const k = /^c[1-3]$/.test(item) ? Number(item[1]) : 0;
      if (k) {
        const c = segColors && segColors[k - 1] ? segColors[k - 1].slice(0, 3) : null;
        rgb = c && c.length === 3 ? c : DEFAULT_SEG_COLORS[k - 1];
      } else {
        rng = (rng * 6364136223846793005n + 1442695040888963407n) & M64;
        rgb = hsvFull(Number((rng >> 33n) % 360n));
      }
      out.push([n > 1 ? i / (n - 1) : 0, rgb]);
    });
    return out;
  }

  // 效果用不用调色板：元数据第 3 段非空且不是固定编号，照 WLED 经典界面的判断。没拿到元数据时当用
  function usesPalette(meta) {
    if (meta == null) return true;
    const at = meta.indexOf("@");
    const parts = (at < 0 ? meta : meta.slice(at + 1)).split(";");
    if (parts.length <= 2) return false;
    const pal = parts[2].split(",")[0];
    return pal !== "" && !/^[+-]?\d+$/.test(pal);
  }

  // ── 预设 ──

  // /presets.json 的槽位表：空槽（没有名字又不是播放列表）跳过，按号升序
  function presetsFrom(obj) {
    const out = [];
    for (const [key, v] of Object.entries(obj || {})) {
      const id = Number(key);
      if (!Number.isInteger(id) || id <= 0 || !v || typeof v !== "object") continue;
      const isPlaylist = v.playlist != null;
      const name = v.n ? v.n : null;
      if (name == null && !isPlaylist) continue;
      out.push({ id, name: name || `播放列表 ${id}`, isPlaylist, quickLabel: v.ql || null });
    }
    return out.sort((a, b) => a.id - b.id);
  }
  function nextFreeSlot(presets) {
    const used = new Set(presets.map((p) => p.id));
    for (let i = 1; i <= 250; i++) if (!used.has(i)) return i;
    return 1;
  }

  // ── 分区模板（与 SegmentTemplate.swift 的内置模板一致）──
  const TEMPLATES = [
    { id: "ambient.tubes.detailed", name: "氛围灯 · 双管六区 + 状态灯", ledCount: 97,
      zones: [["左·底座环", 0, 12], ["左·底柱", 12, 18], ["左·主柱", 18, 48], ["右·底座环", 48, 60], ["右·底柱", 60, 66], ["右·主柱", 66, 96], ["状态灯", 96, 97]],
      note: "按固件 lamp_geometry.h 的实测布局；最后一颗是扩展板状态灯，单独成段。" },
    { id: "ambient.tubes.lr", name: "氛围灯 · 左右两管 + 状态灯", ledCount: 97,
      zones: [["左管", 0, 48], ["右管", 48, 96], ["状态灯", 96, 97]],
      note: "每管一段，效果在整根管上连续；扩展板状态灯单独成段。" },
    { id: "ambient.whole", name: "整条不分段", ledCount: 97, zones: [["全部", 0, 97]],
      note: "回到 WLED 默认：一个分段覆盖整条，状态灯也跟着一起亮。" },
    { id: "stock.tubes.detailed", name: "原厂板 · 双管六区", ledCount: 96,
      zones: [["左·底座环", 0, 12], ["左·底柱", 12, 18], ["左·主柱", 18, 48], ["右·底座环", 48, 60], ["右·底柱", 60, 66], ["右·主柱", 66, 96]],
      note: "按固件 lamp_geometry.h 的实测布局。适合给各区配不同的 WLED 原生效果。" },
    { id: "stock.tubes.lr", name: "原厂板 · 左右两管", ledCount: 96, zones: [["左管", 0, 48], ["右管", 48, 96]],
      note: "每管一段，WLED 原生效果在整根管上连续。" },
    { id: "stock.whole", name: "整条不分段", ledCount: 96, zones: [["全部", 0, 96]],
      note: "讯飞灯效与 ♪ 效果按整条设计，用它们时灯会自动合并回这一种。" },
  ].map((t) => ({ ...t, zones: t.zones.map(([name, start, stop]) => ({ name, start, stop })) }));

  // 这台灯能用的内置模板：颗数对得上的；还不知道颗数、或一个都对不上时全列
  function templatesFor(ledCount) {
    const fit = TEMPLATES.filter((t) => ledCount == null || t.ledCount === ledCount);
    return fit.length ? fit : TEMPLATES;
  }

  // 主段在跑讯飞灯效或 ♪ 效果：它们按整条设计，分区后会被缩进每一段画乱
  function wholeStripRunning(state, effects, nova) {
    const seg = primary(state);
    if (!seg || seg.fx == null) return false;
    if (nova && (seg.fx === nova.scene.fx || seg.fx === nova.music.fx)) return true;
    return isMusic(seg.fx < effects.length ? effects[seg.fx] : "");
  }

  // 一次切成模板的若干区；模板用不到的旧段 stop = 0 删掉，否则会继续亮着。
  // 正在跑整条设计的效果时多区：各区先换纯色
  function templatePatch(t, state, effects, nova) {
    const existing = state && state.seg ? state.seg.length : 0;
    const solid = t.zones.length > 1 && wholeStripRunning(state, effects, nova);
    const seg = t.zones.map((z, i) => {
      const p = { id: i, n: z.name, start: z.start, stop: z.stop, on: true };
      if (solid) p.fx = 0;
      return p;
    });
    for (let i = t.zones.length; i < existing; i++) seg.push({ id: i, start: 0, stop: 0 });
    return { seg };
  }

  const api = {
    vendorWhite, whiteCw, hsvFull, SOLID_SWATCHES, musicIndex, musicC1, novaCategoryTitle, CATEGORY_TITLE, MUSIC_FILTERS,
    isMusic, doc, effectDisplay, primary, mode, fixedKind, flags, wledEffects, musicEntries, isCurrentMusic,
    paletteChoices, paletteStops, usesPalette, presetsFrom, nextFreeSlot, TEMPLATES, templatesFor, templatePatch,
  };
  root.LampLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis,
   typeof APP_NAMES !== "undefined" ? APP_NAMES : require("./app_names.js"));
