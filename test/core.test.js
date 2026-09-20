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
