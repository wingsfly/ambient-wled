// 灯效三大类与各列表的纯逻辑，逐条照 LampKit 的 LightModes.swift / EffectCatalog.swift / SegmentTemplate.swift。
// Swift、Kotlin、这里三份实现由 LampKit 的 tools/light_mode_cases.json 约束（tools/app-test.js 跑）：改分类先改用例表。
// 浏览器里挂 window.LampLogic；Node 下 module.exports。中文名与 ♪ 说明来自生成的 app_names.js。
(function (root, NAMES) {
  "use strict";
  const f = Math.fround;

  // ── 原厂白光：与固件 nova_light.h 同一公式。每次乘、除、加减都舍入到 Float（Math.fround），与 Swift 的 Float 逐步一致；
  //    最后的 +0.5 再取整，在夹紧后的取值范围里是安全的（0..1000 逐个与 Swift 对过）──
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
    switch (Math.trunc(h / 60)) {
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
  // 除法取整用 Math.trunc：Swift 的 Int 除法向零截断（负数输入时与 Math.floor 不同）
  function musicIndex(c1, count) { return count > 0 ? Math.max(0, Math.min(count - 1, Math.trunc((c1 * count) / 256))) : 0; }
  function musicC1(index, count) { return count > 0 ? Math.trunc((index * 256) / count) + Math.trunc(128 / count) : 0; }

  // 查表一律只认自己的键（hasOwnProperty，ES5 就有）：名字叫 constructor / __proto__ 时不能取到原型上的东西
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const own = (table, key) => (hasOwn(table, key) ? table[key] : null);
  const NOVA_CATEGORY = { basic: "基础", natural: "自然", festival: "节日", life: "生活", funny: "趣味", emotion: "情绪", ambient: "氛围" };
  function novaCategoryTitle(code) { const t = own(NOVA_CATEGORY, code); return t != null ? t : code; }
  const CATEGORY_TITLE = { B: "节奏", S: "频谱", M: "旋律", V: "人声", D: "氛围" };
  const MUSIC_FILTERS = [{ id: "nova", title: "讯飞" }].concat(Object.keys(CATEGORY_TITLE).map((c) => ({ id: c, title: CATEGORY_TITLE[c] })));

  function isMusic(name) { return typeof name === "string" && name.startsWith("♪"); }
  function doc(name) { return name ? own(NAMES.docs, name.trim()) : null; }
  function docCategories(name) { const d = doc(name); return d ? d.c : ""; }
  // 「Rainbow - 彩虹」；没有中文的（讯飞的两个效果本身就是中文）原样
  function effectDisplay(name) { const zh = own(NAMES.effects, name); return zh != null ? `${name} - ${zh}` : name; }

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

  // 搜索用 toLowerCase().includes：与 Swift 的 localizedCaseInsensitiveContains 只在非 ASCII 的大小写折叠 / 规范化上不同
  // （Swift 的结果本身随区域设置变），接受这个差别。
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
  // custom：灯上的自定义调色板 [{id, index, name}]（name 取文件的 "n"，没有为 null）。
  // 顺序 usermod → custom → builtin；每项带种类 kind 与自定义文件号 index（其余为 null）
  function paletteChoices(palettes, umpalnames, nova, custom) {
    const sceneZh = Object.create(null);
    for (const [name] of nova ? nova.scene.names : []) {
      const parts = name.split(" - ");
      if (parts.length >= 2) sceneZh[parts[0]] = parts.slice(1).join(" - ");
    }
    const um = (umpalnames || []).map((n, j) => {
      const scene = n.startsWith(NOVA_PAL) ? sceneZh[n.slice(NOVA_PAL.length)] : undefined;
      const zh = scene != null ? `讯飞 · ${scene}` : null;
      return { id: 255 - j, name: n, zh, title: zh != null ? zh : n, kind: "usermod", index: null };
    });
    const cu = (custom || []).map((c) => {
      const zh = typeof c.name === "string" && c.name !== "" ? c.name : `自定义 ${c.index}`;
      return { id: c.id, name: `Custom ${c.index}`, zh, title: zh, kind: "custom", index: c.index };
    });
    const builtin = palettes.map((n, i) => {
      const zh = own(NAMES.palettes, n);
      return { id: i, name: n, zh, title: zh != null ? zh : n, kind: "builtin", index: null };
    });
    return um.concat(cu, builtin);
  }

  // 预览色标 [位置 0–1, RGB]。/json/palx 给色标就照搬；给记号就均匀铺开：c1–c3 取段当前颜色，
  // r 是随机色，按编号取固定一组（与 Swift 同一个 64 位 LCG），免得每次重绘都变
  const DEFAULT_SEG_COLORS = [[255, 160, 0], [0, 0, 0], [0, 0, 0]];
  // 需要 ES2020 的 BigInt（Safari 14+、Chrome 67+），打开灯网页的手机和电脑都满足
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

  // ── 自定义调色板（WLED /paletteN.json）──
  const CUSTOM_ID_BASE = 200, MAX_STOPS = 18;

  // 自定义槽位：编号 200 − N；palx 里恰好 16 个色标且全是 (128,128,128) 的是删除留下的灰色占位
  function customPaletteSlots(cpalcount, palx) {
    const out = [];
    for (let i = 0; i < (cpalcount || 0); i++) {
      const id = CUSTOM_ID_BASE - i;
      const raw = palx && hasOwn(palx, String(id)) ? palx[String(id)] : null;
      const placeholder = Array.isArray(raw) && raw.length === 16 &&
        raw.every((s) => Array.isArray(s) && s[1] === 128 && s[2] === 128 && s[3] === 128);
      out.push({ index: i, id, placeholder });
    }
    return out;
  }

  // 新建时写哪个槽：第一个占位；没有就接在末尾；满了返回 null
  function nextCustomSlot(slots, max) {
    const hole = slots.find((s) => s.placeholder);
    if (hole) return hole.index;
    return slots.length < max ? slots.length : null;
  }

  function hexToRgb(s) {
    return typeof s === "string" && /^[0-9a-fA-F]{6}$/.test(s) ? [0, 2, 4].map((k) => parseInt(s.slice(k, k + 2), 16)) : null;
  }

  // 校验色标：返回 null（合格）或 "count" / "range" / "order" / "ends"。requireEnds=false 时不要求首尾是 0 与 255
  function validateStops(stops, requireEnds = true) {
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > MAX_STOPS) return "count";
    for (const s of stops) {
      if (!Array.isArray(s) || !Number.isInteger(s[0]) || s[0] < 0 || s[0] > 255 || !Array.isArray(s[1]) || s[1].length !== 3 ||
          !s[1].every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) return "range";
    }
    for (let i = 1; i < stops.length; i++) if (stops[i][0] < stops[i - 1][0]) return "order";
    if (requireEnds && (stops[0][0] !== 0 || stops[stops.length - 1][0] !== 255)) return "ends";
    return null;
  }

  // 解 /paletteN.json：palette 是 [位置, "rrggbb"] 摊平，或 [位置, r, g, b] 摊平；解不出的色标给 null
  function decodePaletteFile(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { name: null, stops: null };
    const name = typeof obj.n === "string" && obj.n.trim() ? obj.n.trim() : null;
    const p = obj.palette;
    let stops = null;
    if (Array.isArray(p) && p.length >= 4) {
      const hex = typeof p[1] === "string";
      const step = hex ? 2 : 4;
      if (p.length % step === 0) {
        stops = [];
        for (let i = 0; i < p.length; i += step) {
          const pos = p[i];
          const rgb = hex ? hexToRgb(p[i + 1]) : p.slice(i + 1, i + 4);
          if (!Number.isInteger(pos) || !rgb || !rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) { stops = null; break; }
          stops.push([pos, rgb]);
        }
        if (stops && validateStops(stops, false)) stops = null;
      }
    }
    return { name, stops };
  }

  // 编成 /paletteN.json 的内容：色标按位置升序，十六进制写法；名字去空白后非空才写 "n"
  function encodePaletteFile(stops, name) {
    const sorted = [...stops].sort((a, b) => a[0] - b[0]);
    const file = { palette: sorted.flatMap(([pos, c]) => [pos, c.map((v) => v.toString(16).padStart(2, "0")).join("")]) };
    const n = (name || "").trim();
    if (n) file.n = n;
    return file;
  }

  // 从现有调色板取编辑用的色标（位置 0–255）：补齐 0 与 255 两端，超过 18 个时留最后一个
  function stopsFromPalette(raw, segColors, id) {
    let stops = paletteStops(raw, segColors, id).map(([p, c]) => [Math.round(p * 255), c.slice(0, 3)]);
    stops.sort((a, b) => a[0] - b[0]);
    if (!stops.length) return stops;
    if (stops[0][0] > 0) stops.unshift([0, stops[0][1].slice()]);
    if (stops[stops.length - 1][0] < 255) stops.push([255, stops[stops.length - 1][1].slice()]);
    if (stops.length > MAX_STOPS) stops = stops.slice(0, MAX_STOPS - 1).concat([stops[stops.length - 1]]);
    return stops;
  }

  // 在间隔最大的一对色标（并列取靠前的）中间插一个，位置与颜色各取中点（向下取整）；满了或不足两个原样返回
  function insertStop(stops) {
    if (stops.length >= MAX_STOPS || stops.length < 2) return stops;
    let at = 1;
    for (let i = 2; i < stops.length; i++) if (stops[i][0] - stops[i - 1][0] > stops[at][0] - stops[at - 1][0]) at = i;
    const [p0, c0] = stops[at - 1], [p1, c1] = stops[at];
    const mid = [Math.floor((p0 + p1) / 2), c0.map((v, k) => Math.floor((v + c1[k]) / 2))];
    return stops.slice(0, at).concat([mid], stops.slice(at));
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
      // 与 Swift 的 Int(key) 一样只认十进制数字（可带 +），不认空白、小数点、指数、0x
      if (!/^\+?[0-9]+$/.test(key)) continue;
      const id = Number(key);
      if (!Number.isSafeInteger(id) || id <= 0 || !v || typeof v !== "object" || Array.isArray(v)) continue;
      const isPlaylist = hasOwn(v, "playlist");   // 值是 null 也算（Swift 里 NSNull 不是 nil）
      const name = typeof v.n === "string" && v.n !== "" ? v.n : null;
      if (name == null && !isPlaylist) continue;
      out.push({ id, name: name != null ? name : `播放列表 ${id}`, isPlaylist, quickLabel: typeof v.ql === "string" ? v.ql : null });
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
    paletteChoices, paletteStops, CUSTOM_ID_BASE, MAX_STOPS, customPaletteSlots, nextCustomSlot, decodePaletteFile, encodePaletteFile,
    validateStops, stopsFromPalette, insertStop, usesPalette, presetsFrom, nextFreeSlot, TEMPLATES, templatesFor, templatePatch,
  };
  root.LampLogic = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis,
   (function () {
     if (typeof APP_NAMES !== "undefined") return APP_NAMES;
     if (typeof require === "function") return require("./app_names.js");
     throw new Error("app_names.js 须在 app_logic.js 之前加载");
   })());
