// 灯自带网页的纯逻辑（wled00/data/app_logic.js）与 LampKit（Swift）、Android（Kotlin）跑同一份用例表。
// 用例表在 LampKit 仓库，默认按同级目录找；别处用 LIGHT_MODE_CASES=<路径> 指定。
//   node --test tools/app-test.js
//
// 用例表按严格 JSON 类型读（见表里的「说明」）：键缺失、类型不对、分组为空或出现未知分组一律失败，
// 不悄悄当成默认值；一个分组里每一行都检查，坏行一次全报。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const L = require("../wled00/data/app_logic.js");

const casesPath = process.env.LIGHT_MODE_CASES || path.resolve(__dirname, "../../LampKit/tools/light_mode_cases.json");
let C;
try {
  C = JSON.parse(fs.readFileSync(casesPath, "utf8"));
} catch (e) {
  throw new Error(`用例表读不出来：${casesPath}（${e.message}）。用例表在 LampKit 仓库的 tools/light_mode_cases.json，别处请设环境变量 LIGHT_MODE_CASES=<路径>`);
}

// ── 严格读取：类型不对就失败 ──
// 报错里的路径相对于所在的行（例如 state.seg[0].fx）；eachRow 会在前面加上 group[index] 与能认出这一行的字段。
const bad = (msg) => { throw new Error(msg); };
const show = (v) => JSON.stringify(v);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x) => typeof x === "string";
const isInt = (x) => Number.isInteger(x);
const isBool = (x) => typeof x === "boolean";
const strList = (x) => Array.isArray(x) && x.every(isStr);
const intList = (x) => Array.isArray(x) && x.every(isInt);
const at = (ctx, key) => (ctx ? `${ctx}.${key}` : key);

const field = (o, key, ctx) => (key in o ? o[key] : bad(`缺键 ${at(ctx, key)}`));
const need = (ok, path, what, v) => { if (!ok) bad(`${path} 应是${what}，实际 ${show(v)}`); };
const str = (o, key, ctx) => { const v = field(o, key, ctx); need(isStr(v), at(ctx, key), "JSON 字符串", v); return v; };
const bool = (o, key, ctx) => { const v = field(o, key, ctx); need(isBool(v), at(ctx, key), "JSON 布尔（不是 0/1，也不是带引号的）", v); return v; };
const strArr = (o, key, ctx) => { const v = field(o, key, ctx); need(strList(v), at(ctx, key), "字符串数组", v); return v; };
const intArr = (o, key, ctx) => { const v = field(o, key, ctx); need(intList(v), at(ctx, key), "整数数组", v); return v; };
const strOrNull = (v, path) => need(v === null || isStr(v), path, "字符串或 null", v);
const tuple = (r, size, ctx) => { need(Array.isArray(r) && r.length === size, ctx || "行", `${size} 项的数组`, r); return r; };

// 键存在时才检查类型（Swift 的可选字段：缺了是 nil，在了就得类型对）
const optional = (o, key, ctx, ok, what) => { if (key in o) need(ok(o[key]), at(ctx, key), what, o[key]); };
const optInt = (o, key, ctx) => optional(o, key, ctx, isInt, "JSON 整数");
const optBool = (o, key, ctx) => optional(o, key, ctx, isBool, "JSON 布尔");
const optStr = (o, key, ctx) => optional(o, key, ctx, isStr, "JSON 字符串");

// state：像 Swift 的 Codable 解码那样，嵌套的值也要类型对
function checkState(st, ctx) {
  need(isObj(st), ctx, "JSON 对象", st);
  for (const k of ["bri", "ps", "pl"]) optInt(st, k, ctx);
  optBool(st, "on", ctx);
  if ("seg" in st) {
    need(Array.isArray(st.seg), at(ctx, "seg"), "数组", st.seg);
    st.seg.forEach((sg, i) => {
      const sc = `${at(ctx, "seg")}[${i}]`;
      need(isObj(sg), sc, "JSON 对象", sg);
      for (const k of ["id", "fx", "c1", "sx", "ix", "pal", "start", "stop"]) optInt(sg, k, sc);
      optBool(sg, "on", sc);
      optStr(sg, "n", sc);
      if ("col" in sg) {
        need(Array.isArray(sg.col), at(sc, "col"), "数组", sg.col);
        sg.col.forEach((c, j) => need(intList(c), `${at(sc, "col")}[${j}]`, "整数数组", c));
      }
    });
  }
  if ("nova" in st) {
    need(isObj(st.nova), at(ctx, "nova"), "JSON 对象", st.nova);
    optBool(st.nova, "white", at(ctx, "nova"));
    optInt(st.nova, "cw", at(ctx, "nova"));
  }
  if ("lamp" in st) {
    need(isObj(st.lamp), at(ctx, "lamp"), "JSON 对象", st.lamp);
    optInt(st.lamp, "src", at(ctx, "lamp"));
  }
  return st;
}
const stateOf = (o, ctx) => checkState(field(o, "state", ctx), at(ctx, "state"));

const EXPECTED_KEYS = ["说明", "fixture", "mode", "wledEffects", "musicEntries", "isCurrent",
                       "paletteChoices", "usesPalette", "vendorWhite", "musicC1", "musicIndex"];
const CATEGORY_CODES = ["B", "S", "M", "V", "D"];

// fixture 惰性读取并校验：坏了只让用到它的用例失败，tableShape 之类仍能报出具体原因
let fixtureCache;
function fixture() {
  if (fixtureCache) return fixtureCache;
  const fx = field(C, "fixture", "");
  need(isObj(fx), "fixture", "JSON 对象", fx);
  const nova = field(fx, "nova", "fixture");
  need(isObj(nova), "fixture.nova", "JSON 对象", nova);
  const scene = field(nova, "scene", "fixture.nova"), music = field(nova, "music", "fixture.nova");
  need(isObj(scene), "fixture.nova.scene", "JSON 对象", scene);
  need(isObj(music), "fixture.nova.music", "JSON 对象", music);
  for (const k of ["fx", "custom"]) need(isInt(field(scene, k, "fixture.nova.scene")), `fixture.nova.scene.${k}`, "JSON 整数", scene[k]);
  strArr(scene, "categories", "fixture.nova.scene");
  const names = field(scene, "names", "fixture.nova.scene");
  need(Array.isArray(names), "fixture.nova.scene.names", "数组", names);
  names.forEach((e, i) => need(Array.isArray(e) && e.length === 2 && isStr(e[0]) && isInt(e[1]),
    `fixture.nova.scene.names[${i}]`, "恰好 [字符串, 整数]", e));
  need(isInt(field(music, "fx", "fixture.nova.music")), "fixture.nova.music.fx", "JSON 整数", music.fx);
  strArr(music, "names", "fixture.nova.music");
  fixtureCache = {
    effects: strArr(fx, "effects", "fixture"),
    fxdata: strArr(fx, "fxdata", "fixture"),
    palettes: strArr(fx, "palettes", "fixture"),
    umpalnames: strArr(fx, "umpalnames", "fixture"),
    nova,
  };
  return fixtureCache;
}

// 分组：必须存在、是数组、不为空
function group(key) {
  const g = field(C, key, "");
  need(Array.isArray(g), `分组 ${key}`, "数组", g);
  if (g.length === 0) bad(`分组 ${key} 为空`);
  return g;
}

// 行的标识：group[index] 加上能认出这一行的字段（name / withNova / filter）
function rowLabel(key, i, row) {
  let s = `${key}[${i}]`;
  if (isObj(row)) {
    if (isStr(row.name)) s += `「${row.name}」`;
    if ("withNova" in row) s += ` withNova=${show(row.withNova)}`;
    if ("filter" in row) s += ` filter=${show(row.filter)}`;
  } else {
    s += ` ${show(row)}`;
  }
  return s;
}

// 一行行检查，坏行不停，最后一次报出所有坏行
function eachRow(key, body) {
  const fails = [];
  group(key).forEach((row, i) => {
    try { body(row, ""); } catch (e) { fails.push(`${rowLabel(key, i, row)}：${e.message}`); }
  });
  if (fails.length) assert.fail(`${key} ${fails.length} 行失败：\n` + fails.map((f) => `- ${f}`).join("\n"));
}
const eachObj = (key, body) => eachRow(key, (row, ctx) => { need(isObj(row), "行", "JSON 对象", row); body(row, ctx); });
const eachTuple = (key, size, body) => eachRow(key, (row, ctx) => body(tuple(row, size, ctx), ctx));

function same(got, want, what) {
  if (!util.isDeepStrictEqual(got, want)) bad(`${what}：得 ${show(got)}，应 ${show(want)}`);
}
function catalog(row, ctx) { return bool(row, "withNova", ctx) ? fixture().nova : null; }

// ── 三端共用的用例表 ──

test("tableShape：顶层键恰好是约定的那些", () => {
  const got = Object.keys(C);
  const missing = EXPECTED_KEYS.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !EXPECTED_KEYS.includes(k));
  if (missing.length || extra.length) bad(`用例表顶层键不对：缺 ${show(missing)}，多 ${show(extra)}`);
});

test("大类与固定灯效小类", () => {
  const { effects } = fixture();
  eachObj("mode", (c, ctx) => {
    str(c, "name", ctx);
    const cat = catalog(c, ctx);
    const st = stateOf(c, ctx);
    const wantMode = str(c, "mode", ctx), wantKind = str(c, "fixedKind", ctx);
    const gotMode = L.mode(st, effects), gotKind = L.fixedKind(st, cat);
    if (gotMode !== wantMode || gotKind !== wantKind) bad(`得 ${gotMode} / ${gotKind}，应 ${wantMode} / ${wantKind}`);
  });
});

test("WLED 原生效果列表", () => {
  const { effects, fxdata } = fixture();
  eachObj("wledEffects", (c, ctx) => {
    const cat = catalog(c, ctx);
    const filter = str(c, "filter", ctx);                       // 自由文本，不认识的就是一次搜索
    const want = intArr(c, "indices", ctx);
    same(L.wledEffects(effects, fxdata, cat, filter).map((e) => e.index), want, "indices");
  });
});

test("音乐律动列表", () => {
  const { effects } = fixture();
  eachObj("musicEntries", (c, ctx) => {
    const cat = catalog(c, ctx);
    const filter = field(c, "filter", ctx);
    if (filter !== null && !(isStr(filter) && (filter === "nova" || CATEGORY_CODES.includes(filter)))) {
      bad(`filter 不认识的筛选 ${show(filter)}（只认 null / "nova" / B S M V D）`);
    }
    const want = strArr(c, "ids", ctx);
    same(L.musicEntries(effects, cat, filter).map((e) => e.id), want, "ids");
  });
});

test("当前音乐项", () => {
  const { effects, nova } = fixture();
  eachObj("isCurrent", (c, ctx) => {
    const st = stateOf(c, ctx);
    const want = field(c, "current", ctx);                       // null = 没有哪一项是当前
    strOrNull(want, "current");
    const hits = L.musicEntries(effects, nova, null).filter((e) => L.isCurrentMusic(e, st, nova)).map((e) => e.id);
    if (hits.length > 1) bad(`同时有多项是当前：${show(hits)}`);
    same(hits.length ? hits[0] : null, want, `state=${show(st)} 当前项`);
  });
});

test("调色板选择", () => {
  const { palettes, umpalnames, nova } = fixture();
  const want = [];
  eachRow("paletteChoices", (row, ctx) => {
    const r = tuple(row, 2, ctx);
    need(isInt(r[0]), "[0]", "JSON 整数", r[0]);
    strOrNull(r[1], "[1]");
    want.push([r[0], r[1]]);
  });
  same(L.paletteChoices(palettes, umpalnames, nova).map((p) => [p.id, p.zh]), want, "paletteChoices");
});

test("效果用不用调色板", () => {
  eachTuple("usesPalette", 2, (r, ctx) => {
    strOrNull(r[0], "[0]");
    need(isBool(r[1]), "[1]", "JSON 布尔", r[1]);
    same(L.usesPalette(r[0]), r[1], `meta=${show(r[0])}`);
  });
});

test("原厂白光", () => {
  eachTuple("vendorWhite", 2, (r, ctx) => {
    need(isInt(r[0]), "[0]", "JSON 整数", r[0]);
    need(intList(r[1]) && r[1].length === 3, "[1]", "3 个整数的数组", r[1]);
    same(L.vendorWhite(r[0]), r[1], `cw=${r[0]}`);
  });
});

const threeInts = (r) => { need(r.every(isInt), "行", "3 个 JSON 整数", r); return r; };

test("讯飞音乐档位：档位 → c1", () => {
  eachTuple("musicC1", 3, (r) => {
    const [i, n, c1] = threeInts(r);
    same(L.musicC1(i, n), c1, `index=${i} count=${n}`);
  });
});

test("讯飞音乐档位：c1 → 档位", () => {
  eachTuple("musicIndex", 3, (r) => {
    const [c1, n, i] = threeInts(r);
    same(L.musicIndex(c1, n), i, `c1=${c1} count=${n}`);
  });
});

// ── 只有网页这一端有的（Swift 侧由各自的检查覆盖）──
test("白光反推色温：反推出的色温算回同一个颜色", () => {
  const white = L.vendorWhite(300);
  // 不同色温可能算出同一个颜色，反推取其中最小的
  let first = -1;
  for (let cw = 0; cw <= 1000 && first < 0; cw++) if (util.isDeepStrictEqual(L.vendorWhite(cw), white)) first = cw;
  assert.equal(L.whiteCw(white), first);
  assert.deepEqual(L.vendorWhite(L.whiteCw(white)), white);
  assert.equal(L.whiteCw([...white, 0]), first);   // 带第四通道（RGBW）的颜色照样认得
  assert.equal(L.whiteCw([255, 0, 0]), null);
  assert.equal(L.whiteCw([255, 0]), null);
});

test("分区模板：跑整条效果时各区换纯色，多余的旧段删掉", () => {
  const { effects, nova } = fixture();
  const t = L.templatesFor(96).find((x) => x.id === "stock.tubes.lr");
  const st = { seg: [{ id: 0, fx: 6 }, { id: 1 }, { id: 2 }] };
  assert.deepEqual(L.templatePatch(t, st, effects, nova).seg, [
    { id: 0, n: "左管", start: 0, stop: 48, on: true, fx: 0 },
    { id: 1, n: "右管", start: 48, stop: 96, on: true, fx: 0 },
    { id: 2, start: 0, stop: 0 },
  ]);
  const plain = L.templatePatch(t, { seg: [{ id: 0, fx: 2 }] }, effects, nova).seg;
  assert.equal(plain[0].fx, undefined);
});

test("模板按颗数筛；对不上或不知道颗数时全列", () => {
  assert.deepEqual(L.templatesFor(96).map((t) => t.ledCount), [96, 96, 96]);
  assert.deepEqual(L.templatesFor(97).map((t) => t.ledCount), [97, 97, 97]);
  assert.equal(L.templatesFor(50).length, 6);
  assert.equal(L.templatesFor(undefined).length, 6);
});

test("调色板记号：c1 取段色，r 同编号同色", () => {
  const s = L.paletteStops(["c1", "r"], [[1, 2, 3]], 7);
  assert.deepEqual(s[0], [0, [1, 2, 3]]);
  assert.deepEqual(L.paletteStops(["c1", "r"], [[1, 2, 3]], 7), s);
  assert.deepEqual(L.paletteStops([[0, 9, 8, 7], [255, 1, 2, 3]], null, 0), [[0, [9, 8, 7]], [1, [1, 2, 3]]]);
  assert.deepEqual(L.paletteStops(["c2"], null, 0), [[0, [0, 0, 0]]]);
});

test("调色板随机色：与 Swift 的 64 位 LCG 逐位一致", () => {
  // 期望值来自 LampKit 的 Swift LightModes.paletteStops（同样的入参），不是网页自己算的
  assert.deepEqual(L.paletteStops(["r", "c1", "r"], null, 7), [[0, [0, 255, 208]], [0.5, [255, 160, 0]], [1, [208, 0, 255]]]);
});

test("预设表：跳过空槽与 0 号，按号排序", () => {
  const list = L.presetsFrom({ "0": {}, "3": { n: "晚上" }, "2": { playlist: {} }, "1": {} });
  assert.deepEqual(list.map((p) => [p.id, p.name, p.isPlaylist]), [[2, "播放列表 2", true], [3, "晚上", false]]);
  assert.equal(L.nextFreeSlot(list), 1);
  assert.equal(L.nextFreeSlot([{ id: 1 }, { id: 2 }, { id: 3 }]), 4);
  assert.equal(L.nextFreeSlot(Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }))), 1);   // 1..250 全占满
});

test("预设表：键只认十进制数字；playlist 键在就算（值为 null 也算）；n / ql 非字符串不要", () => {
  const list = L.presetsFrom({
    " 3": { n: "空白" }, "4.0": { n: "小数" }, "0x5": { n: "十六进制" }, "1e1": { n: "指数" }, "-1": { n: "负" },
    "6": { playlist: null }, "7": { n: 5 }, "8": { n: "", playlist: {} }, "9": { n: "有名", ql: "" },
    "10": { n: "数字快捷", ql: 7 }, "11": [1], "12": null,
  });
  assert.deepEqual(list.map((p) => [p.id, p.name, p.isPlaylist, p.quickLabel]), [
    [6, "播放列表 6", true, null],
    [8, "播放列表 8", true, null],
    [9, "有名", false, ""],
    [10, "数字快捷", false, null],
  ]);
});

test("查表只认自己的键：效果名叫 constructor 之类不取到原型上的东西；空字符串的中文也算有", () => {
  for (const n of ["constructor", "__proto__", "toString", "hasOwnProperty"]) assert.equal(L.effectDisplay(n), n);
  assert.equal(L.doc("constructor"), null);
  assert.equal(L.doc("__proto__"), null);
  const nova = { scene: { fx: 3, names: [["Ocean - ", 1], ["constructor - 构造", 2]] }, music: { fx: 4, names: [] } };
  const pals = L.paletteChoices(["constructor", "Default"], ["讯飞: Ocean", "讯飞: constructor", "讯飞: __proto__", "讯飞: NoDash"], nova);
  assert.deepEqual(pals.map((p) => [p.id, p.zh, p.title]), [
    [255, "讯飞 · ", "讯飞 · "],            // 同名场景的中文是空串：照 Swift 算有
    [254, "讯飞 · 构造", "讯飞 · 构造"],
    [253, null, "讯飞: __proto__"],
    [252, null, "讯飞: NoDash"],
    [0, null, "constructor"],
    [1, "默认", "默认"],
  ]);
});

test("取整与 Swift 的 Int 一样向零截断（负数输入）", () => {
  assert.equal(L.musicC1(-1, 3), -43);       // Swift：-1*256/3 = -85，128/3 = 42
  assert.equal(L.musicIndex(-1, 8), 0);
  // 下面两个是 Swift LightModes.hsvFull 在同样入参下的结果（负色相本不会出现，只为逐位一致）
  assert.deepEqual(L.hsvFull(-30), [255, -127, 0]);
  assert.deepEqual(L.hsvFull(-61), [255, 0, 259]);
});

test("效果显示名：英文 - 中文；没有中文的原样", () => {
  assert.equal(L.effectDisplay("Rainbow"), "Rainbow - 彩虹");
  assert.equal(L.effectDisplay("讯飞场景"), "讯飞场景");
});
