'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/core.js');

const T = 12;

function approx(actual, expected, tol = 1e-6, label) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label || '值'} 期望 ${expected}，实际 ${actual}`
  );
}

test('正面相撞：两人相向匀速，在 t=6 接触', () => {
  const a = { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 120, y: 0 }] };
  const b = { id: 'b', radius: 0, keys: [{ t: 0, x: 120, y: 0 }, { t: 12, x: 0, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 6, 1e-7, '进入碰撞');
  approx(r.intervals[0][1], 6, 1e-7, '离开碰撞');
  approx(r.firstContact, 6, 1e-7);
  approx(r.minDistance, 0, 1e-7);
  approx(r.minDistanceT, 6, 1e-7);
});

test('半径产生有限宽度的碰撞区间（非点接触）', () => {
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  // 相对速度 20/s，半径和 20 -> |100-20t|<=20 -> t∈[4,6]
  approx(r.intervals[0][0], 4, 1e-7);
  approx(r.intervals[0][1], 6, 1e-7);
});

test('相切：最近距离恰好等于半径和，区间退化为单点也算碰撞', () => {
  // A 水平经过 y=10，B 静止原点；rSum=10 -> 恰在 t=5 相切
  const a = { id: 'a', radius: 0, keys: [{ t: 0, x: 0, y: 10 }, { t: 10, x: 100, y: 10 }] };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 50, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  approx(r.intervals[0][0], 5, 1e-6);
  approx(r.intervals[0][1], 5, 1e-6);
  approx(r.minDistance, 10, 1e-6);
});

test('错峰交叉：路径相交但不同时到达，不得误报', () => {
  // A 水平匀速，t=5 经过交点 (50,0)；B 竖直疾行，t≈1 经过交点后远离
  const a = { id: 'a', radius: 2, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const b = { id: 'b', radius: 2, keys: [{ t: 0, x: 50, y: -100 }, { t: 2, x: 50, y: 100 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, false);
  assert.deepEqual(r.intervals, []);
  assert.equal(r.firstContact, null);
  // 几何路径交点距离为 0 但时刻错开，全程最近距离仍远大于半径和 4
  assert.ok(r.minDistance > 30, `最近距离应 >30，实际 ${r.minDistance}`);
});

test('相对静止持续重叠：v=0 退化解覆盖整段', () => {
  const a = { id: 'a', radius: 30, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 120, y: 0 }] };
  // B 同速平行，间距恒为 40 <= 半径和 50
  const b = { id: 'b', radius: 20, keys: [{ t: 0, x: 0, y: 40 }, { t: 12, x: 120, y: 40 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 0, 1e-7);
  approx(r.intervals[0][1], 12, 1e-7);
  approx(r.minDistance, 40, 1e-7);
});

test('跨关键帧的碰撞区间在边界处正确合并', () => {
  // A 匀速直线（单段），B 用两个共线关键帧人为切成两段，结果应一致
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const b1 = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 5, x: 50, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const b2 = { id: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] };
  const r1 = core.analyzePair(a, b1, T);
  const r2 = core.analyzePair(a, b2, T);
  assert.equal(r1.intervals.length, r2.intervals.length);
  approx(r1.intervals[0][0], r2.intervals[0][0]);
  approx(r1.intervals[0][1], r2.intervals[0][1]);
});

test('关键帧之外保持静止（开场即贴近静止者）', () => {
  const a = { id: 'a', radius: 15, keys: [{ t: 3, x: 0, y: 0 }, { t: 9, x: 100, y: 0 }] };
  const b = { id: 'b', radius: 15, keys: [{ t: 0, x: 5, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  // 0..3 期间 A 静止在 (0,0)，与 B 相距 5 <= 30，必然碰撞
  assert.equal(r.collision, true);
  approx(r.intervals[0][0], 0, 1e-7);
});

test('analyzeScene：4 人产生 6 对，首次碰撞与全局最小间距正确', () => {
  const scene = core.builtinScene();
  const r = core.analyzeScene(scene);
  assert.equal(r.pairCount, 6);
  const colliding = r.pairs.filter((p) => p.collision);
  const names = colliding.map((p) => `${p.aId}-${p.bId}`).sort();
  assert.deepEqual(names, ['p1-p2', 'p3-p4']);

  const p12 = r.pairs.find((p) => p.aId === 'p1' && p.bId === 'p2');
  approx(p12.firstContact, 5.53, 0.02, '甲乙首碰时刻');
  approx(p12.minDistance, 0, 1e-6, '甲乙最小间距');
  approx(p12.minDistanceT, 6, 1e-6, '甲乙最小间距时刻');
  approx(p12.intervals[0][0], 5.53, 0.02);
  approx(p12.intervals[0][1], 6.47, 0.02);

  const p34 = r.pairs.find((p) => p.aId === 'p3' && p.bId === 'p4');
  assert.equal(p34.collision, true);
  approx(p34.firstContact, 2.60, 0.02, '丙丁首碰时刻');
  approx(p34.lastRelease, 12, 1e-6, '丙丁持续到收场');
  assert.ok(p34.minDistance < 40, '丙丁最近间距应小于半径和 40');

  // 几何相交但错峰的组合不得误报
  for (const id of ['p1-p3', 'p2-p3', 'p1-p4', 'p2-p4']) {
    const [x, y] = id.split('-');
    const p = r.pairs.find((q) => q.aId === x && q.bId === y);
    assert.equal(p.collision, false, `${id} 不应碰撞`);
  }

  approx(r.firstContact, p34.firstContact, 1e-6);
  approx(r.minDistance, 0, 1e-6);
});

test('positionAt 线性插值与端点静止', () => {
  const keys = core.normalizeKeys([{ t: 2, x: 0, y: 0 }, { t: 6, x: 40, y: 20 }]);
  assert.deepEqual(core.positionAt(keys, 0), { x: 0, y: 0 });
  const mid = core.positionAt(keys, 4);
  approx(mid.x, 20, 1e-9);
  approx(mid.y, 10, 1e-9);
  assert.deepEqual(core.positionAt(keys, 9), { x: 40, y: 20 });
});

// ---------- 关键帧可选安全半径 ----------

test('关键帧半径：缺省继承表演者半径，段间线性插值，首尾之外保持端点值', () => {
  const keys = [
    { t: 2, x: 0, y: 0, r: 10 },
    { t: 6, x: 0, y: 0 }              // 未设置 r
  ];
  approx(core.radiusAt(keys, 0, 20), 10, 1e-9, '首帧之前保持首帧值');
  approx(core.radiusAt(keys, 2, 20), 10, 1e-9);
  approx(core.radiusAt(keys, 4, 20), 15, 1e-9, '10 与继承值 20 的中点');
  approx(core.radiusAt(keys, 6, 20), 20, 1e-9, '未设置则继承 20');
  approx(core.radiusAt(keys, 9, 20), 20, 1e-9, '末帧之后保持末帧值');
  // 无关键帧时恒为基础半径
  approx(core.radiusAt([], 3, 25), 25, 1e-9);
  // parseKeyRadius：非法/空 -> null
  assert.equal(core.parseKeyRadius(undefined), null);
  assert.equal(core.parseKeyRadius(''), null);
  assert.equal(core.parseKeyRadius('abc'), null);
  approx(core.parseKeyRadius('30'), 30, 1e-9);
  approx(core.parseKeyRadius(-5), 0, 1e-9, '负值钳为 0');
});

test('相对静止 + 仅半径展开：在精确接触时刻进入并持续到收场', () => {
  // 两人间距恒为 30；半径和 20 -> 60 随 t 线性，接触于 R=30 即 t=3
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 0, y: 0 }] };
  const b = {
    id: 'b', radius: 10,
    keys: [{ t: 0, x: 30, y: 0, r: 10 }, { t: 12, x: 30, y: 0, r: 50 }]
  };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  assert.equal(r.variableRadius, true);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 3, 1e-7, '展开接触时刻');
  approx(r.intervals[0][1], 12, 1e-7, '展开后持续重叠到收场');
  approx(r.radiusSumMin, 20, 1e-9);
  approx(r.radiusSumMax, 60, 1e-9);
  approx(r.minDistance, 30, 1e-9, '几何最小间距与半径无关');
});

test('相对静止 + 仅半径收起：整段重叠恰好在精确释放时刻结束（A<0 开口向下分支）', () => {
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 0, y: 0 }] };
  const b = {
    id: 'b', radius: 10,
    keys: [{ t: 0, x: 30, y: 0, r: 50 }, { t: 12, x: 30, y: 0, r: 10 }]
  };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 0, 1e-7);
  approx(r.intervals[0][1], 9, 1e-7, 'R 从 60 降到 30 的时刻恰好释放');
});

test('静止相切：半径和恰在某一瞬间等于间距，记为零长度区间', () => {
  // 间距恒 30，半径和 20->30，t=12 时 R=30 恰好相切（区间退化为端点单点）
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 0, y: 0 }] };
  const b = {
    id: 'b', radius: 10,
    keys: [{ t: 0, x: 30, y: 0, r: 10 }, { t: 12, x: 30, y: 0, r: 20 }]
  };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 12, 1e-6);
  approx(r.intervals[0][1], 12, 1e-6);
});

test('运动与展开同时发生：一般二次式 (|v|²-s²) 的解析区间', () => {
  // A: (0,0)->(100,0) over 10s, r: 0 -> 40；B 静止 (50,30), r=10
  // d(t)² = (10t-50)²+900；R(t) = 4t+10；手算接触于 t=5，离开 t=55/7
  const a = {
    id: 'a', radius: 0,
    keys: [{ t: 0, x: 0, y: 0, r: 0 }, { t: 10, x: 100, y: 0, r: 40 }]
  };
  const b = { id: 'b', radius: 10, keys: [{ t: 0, x: 50, y: 30 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  approx(r.intervals[0][0], 5, 1e-6);
  approx(r.intervals[0][1], 55 / 7, 1e-6);
});

test('跨关键帧的可变半径区间在边界连续合并（不产生碎片）', () => {
  // 两人相向运动；B 半径 10->30->10，在 t=5 达到最大
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] };
  const b = {
    id: 'b', radius: 10,
    keys: [
      { t: 0, x: 100, y: 0, r: 10 },
      { t: 5, x: 50, y: 0, r: 30 },
      { t: 10, x: 0, y: 0, r: 10 }
    ]
  };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.collision, true);
  // 区间跨过 t=5 的关键帧边界，必须合并为一段（10±|100-20t|<=40 -> t∈[10/3,20/3]）
  assert.equal(r.intervals.length, 1);
  approx(r.intervals[0][0], 10 / 3, 1e-6);
  approx(r.intervals[0][1], 20 / 3, 1e-6);
});

test('固定半径旧数据完全兼容：标记不可变，半径和统计等于固定和', () => {
  const a = { id: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 12, x: 0, y: 0 }] };
  const b = { id: 'b', radius: 15, keys: [{ t: 0, x: 20, y: 0 }] };
  const r = core.analyzePair(a, b, T);
  assert.equal(r.variableRadius, false);
  approx(r.radiusSum, 25, 1e-9);
  approx(r.radiusSumMin, 25, 1e-9);
  approx(r.radiusSumMax, 25, 1e-9);
  assert.equal(r.collision, true);

  // 显式 r 与基础半径相同，也视为不可变（斜率为 0）
  const c = {
    id: 'c', radius: 20,
    keys: [{ t: 0, x: 0, y: 0, r: 20 }, { t: 12, x: 0, y: 0, r: 20 }]
  };
  const r2 = core.analyzePair(a, c, T);
  assert.equal(r2.variableRadius, false);
});

test('可变半径解析与密采样一致（随机属性，非帧抽样的回归守卫）', () => {
  function rnd(seedObj) {
    seedObj.s = (seedObj.s * 1664525 + 1013904223) % 4294967296;
    return seedObj.s / 4294967296;
  }
  const seed = { s: 20260920 };
  function mkPerformer(id) {
    const n = 2 + Math.floor(rnd(seed) * 3);
    const keys = [];
    for (let i = 0; i < n; i++) {
      const k = {
        t: (T * i) / (n - 1),
        x: Math.round(rnd(seed) * 1000),
        y: Math.round(rnd(seed) * 600)
      };
      if (rnd(seed) < 0.5) k.r = Math.round(rnd(seed) * 80);
      keys.push(k);
    }
    return { id, radius: 10 + rnd(seed) * 30, keys };
  }
  // 密采样参考实现（仅测试用：引擎本身绝不采样）
  function sampledIntervals(pa, pb) {
    const dt = 0.002;
    const out = [];
    let inside = false;
    let start = 0;
    for (let t = 0; t <= T + 1e-9; t += dt) {
      const paP = core.positionAt(core.normalizeKeys(pa.keys), t);
      const pbP = core.positionAt(core.normalizeKeys(pb.keys), t);
      const d = Math.hypot(paP.x - pbP.x, paP.y - pbP.y);
      const R = core.radiusAt(pa.keys, t, pa.radius) + core.radiusAt(pb.keys, t, pb.radius);
      const hit = d <= R + 1e-9;
      if (hit && !inside) { start = t; inside = true; }
      if (!hit && inside) { out.push([start, t]); inside = false; }
    }
    if (inside) out.push([start, T]);
    return out;
  }

  for (let trial = 0; trial < 400; trial++) {
    const pa = mkPerformer('a');
    const pb = mkPerformer('b');
    const exact = core.analyzePair(pa, pb, T).intervals;
    const ref = sampledIntervals(pa, pb);
    assert.equal(exact.length, ref.length, `trial ${trial} 区间段数应一致`);
    for (let i = 0; i < exact.length; i++) {
      assert.ok(Math.abs(exact[i][0] - ref[i][0]) <= 2 * 0.002 + 1e-6,
        `trial ${trial} 区间 ${i} 起点偏差过大`);
      assert.ok(Math.abs(exact[i][1] - ref[i][1]) <= 2 * 0.002 + 1e-6,
        `trial ${trial} 区间 ${i} 终点偏差过大`);
    }
  }
});
