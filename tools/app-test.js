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
const bad = (msg) => { throw new Error(msg); };
const show = (v) => JSON.stringify(v);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x) => typeof x === "string";
const isInt = (x) => Number.isInteger(x);
const isBool = (x) => typeof x === "boolean";
const strList = (x) => Array.isArray(x) && x.every(isStr);
const intList = (x) => Array.isArray(x) && x.every(isInt);

const field = (o, key, ctx) => (key in o ? o[key] : bad(`${ctx} 缺键 ${key}`));
const need = (ok, ctx, what, v) => { if (!ok) bad(`${ctx} 应是${what}，实际 ${show(v)}`); };
const str = (o, key, ctx) => { const v = field(o, key, ctx); need(isStr(v), `${ctx}.${key}`, "JSON 字符串", v); return v; };
const bool = (o, key, ctx) => { const v = field(o, key, ctx); need(isBool(v), `${ctx}.${key}`, "JSON 布尔（不是 0/1，也不是带引号的）", v); return v; };
const strArr = (o, key, ctx) => { const v = field(o, key, ctx); need(strList(v), `${ctx}.${key}`, "字符串数组", v); return v; };
const intArr = (o, key, ctx) => { const v = field(o, key, ctx); need(intList(v), `${ctx}.${key}`, "整数数组", v); return v; };
const stateOf = (o, ctx) => { const v = field(o, "state", ctx); need(isObj(v), `${ctx}.state`, "JSON 对象", v); return v; };
const strOrNull = (v, ctx) => need(v === null || isStr(v), ctx, "字符串或 null", v);
const tuple = (r, size, ctx) => { need(Array.isArray(r) && r.length === size, ctx, `${size} 项的数组`, r); return r; };

const EXPECTED_KEYS = ["说明", "fixture", "mode", "wledEffects", "musicEntries", "isCurrent",
                       "paletteChoices", "usesPalette", "vendorWhite", "musicC1", "musicIndex"];
const CATEGORY_CODES = ["B", "S", "M", "V", "D"];

// fixture 惰性读取并校验：坏了只让用到它的用例失败，tableShape 之类仍能报出具体原因
let fixtureCache;
function fixture() {
  if (fixtureCache) return fixtureCache;
  const fx = field(C, "fixture", "表");
  need(isObj(fx), "fixture", "JSON 对象", fx);
  const nova = field(fx, "nova", "fixture");
  need(isObj(nova) && isObj(nova.scene) && isObj(nova.music), "fixture.nova", "含 scene / music 的对象", nova);
  need(isInt(nova.scene.fx) && Array.isArray(nova.scene.names), "fixture.nova.scene", "含整数 fx 与 names 数组的对象", nova.scene);
  need(isInt(nova.music.fx) && strList(nova.music.names), "fixture.nova.music", "含整数 fx 与字符串 names 的对象", nova.music);
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
  const g = field(C, key, "表");
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
    const ctx = rowLabel(key, i, row);
    try { body(row, ctx); } catch (e) { fails.push(e.message.startsWith(ctx) ? e.message : `${ctx}：${e.message}`); }
  });
  if (fails.length) assert.fail(`${key} ${fails.length} 行失败：\n` + fails.map((f) => `- ${f}`).join("\n"));
}
const eachObj = (key, body) => eachRow(key, (row, ctx) => { need(isObj(row), ctx, "JSON 对象", row); body(row, ctx); });
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
    strOrNull(want, `${ctx}.current`);
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
    need(isInt(r[0]), `${ctx}[0]`, "JSON 整数", r[0]);
    strOrNull(r[1], `${ctx}[1]`);
    want.push([r[0], r[1]]);
  });
  same(L.paletteChoices(palettes, umpalnames, nova).map((p) => [p.id, p.zh]), want, "paletteChoices");
});

test("效果用不用调色板", () => {
  eachTuple("usesPalette", 2, (r, ctx) => {
    strOrNull(r[0], `${ctx}[0]`);
    need(isBool(r[1]), `${ctx}[1]`, "JSON 布尔", r[1]);
    same(L.usesPalette(r[0]), r[1], `meta=${show(r[0])}`);
  });
});

test("原厂白光", () => {
  eachTuple("vendorWhite", 2, (r, ctx) => {
    need(isInt(r[0]), `${ctx}[0]`, "JSON 整数", r[0]);
    need(intList(r[1]) && r[1].length === 3, `${ctx}[1]`, "3 个整数的数组", r[1]);
    same(L.vendorWhite(r[0]), r[1], `cw=${r[0]}`);
  });
});

test("讯飞音乐档位", () => {
  const ints = (r, ctx) => { need(r.every(isInt), ctx, "3 个 JSON 整数", r); return r; };
  eachTuple("musicC1", 3, (r, ctx) => {
    const [i, n, c1] = ints(r, ctx);
    same(L.musicC1(i, n), c1, `index=${i} count=${n}`);
  });
  eachTuple("musicIndex", 3, (r, ctx) => {
    const [c1, n, i] = ints(r, ctx);
    same(L.musicIndex(c1, n), i, `c1=${c1} count=${n}`);
  });
});

// ── 只有网页这一端有的（Swift 侧由各自的检查覆盖）──
test("白光反推色温：反推出的色温算回同一个颜色", () => {
  const white = L.vendorWhite(300);
  assert.deepEqual(L.vendorWhite(L.whiteCw(white)), white);
  assert.equal(L.whiteCw([255, 0, 0]), null);
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

test("预设表：跳过空槽与 0 号，按号排序", () => {
  const list = L.presetsFrom({ "0": {}, "3": { n: "晚上" }, "2": { playlist: {} }, "1": {} });
  assert.deepEqual(list.map((p) => [p.id, p.name, p.isPlaylist]), [[2, "播放列表 2", true], [3, "晚上", false]]);
  assert.equal(L.nextFreeSlot(list), 1);
});

test("效果显示名：英文 - 中文；没有中文的原样", () => {
  assert.equal(L.effectDisplay("Rainbow"), "Rainbow - 彩虹");
  assert.equal(L.effectDisplay("讯飞场景"), "讯飞场景");
});
