'use strict';

/**
 * HTTP 接口测试：/api/analyze 接受含关键帧半径 r 的场景并返回规整后的场景；
 * /api/sample 返回的样例携带关键帧半径。使用 server 导出的 express app，零额外依赖。
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server/index.js');

const server = app.listen(0);
after(() => server.close());
const PORT = server.address().port;

function postAnalyze(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/analyze',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }));
    }).on('error', reject);
  });
}

const baseScene = (aKeys) => ({
  duration: 10,
  performers: [
    {
      id: 'a', name: '甲', radius: 10,
      keys: aKeys || [{ t: 0, x: 70, y: 0, r: 10 }, { t: 4, x: 70, y: 0, r: 50 }]
    },
    {
      id: 'b', name: '乙', radius: 10,
      keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }]
    }
  ]
});

test('POST /api/analyze：接受关键帧 r 并按可变半径解析（首碰 t=2.5）', async () => {
  const r = await postAnalyze(baseScene());
  assert.equal(r.status, 200);
  assert.equal(r.json.pairCount, 1);
  const pair = r.json.pairs[0];
  assert.equal(pair.collision, true);
  assert.ok(Math.abs(pair.firstContact - 2.5) < 1e-6);
  assert.ok(Math.abs(pair.radiusSumMin - 20) < 1e-9);
  assert.ok(Math.abs(pair.radiusSumMax - 60) < 1e-9);
});

test('POST /api/analyze：返回的 scene 中缺省 r 被解析为继承值，显式 r 原样保留', async () => {
  const r = await postAnalyze(baseScene());
  assert.equal(r.status, 200);
  assert.ok(r.json.scene, '响应包含规整后的 scene');
  const [a, b] = r.json.scene.performers;
  assert.equal(a.keys[0].r, 10);
  assert.equal(a.keys[1].r, 50);
  // 乙的关键帧未设置 r -> 全部解析为其当前半径 10
  assert.deepEqual(b.keys.map((k) => k.r), [10, 10]);
});

test('POST /api/analyze：固定半径旧数据（无 r 字段）继续兼容', async () => {
  const old = {
    duration: 10,
    performers: [
      { name: 'a', radius: 10, keys: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 100, y: 0 }] },
      { name: 'b', radius: 10, keys: [{ t: 0, x: 100, y: 0 }, { t: 10, x: 0, y: 0 }] }
    ]
  };
  const r = await postAnalyze(old);
  assert.equal(r.status, 200);
  const pair = r.json.pairs[0];
  assert.ok(Math.abs(pair.intervals[0][0] - 4) < 1e-7);
  assert.ok(Math.abs(pair.intervals[0][1] - 6) < 1e-7);
});

test('POST /api/analyze：非法关键帧半径被拒绝', async () => {
  const bad = baseScene([{ t: 0, x: 70, y: 0, r: -5 }]);
  const r = await postAnalyze(bad);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /安全半径/);
});

test('GET /api/sample：样例含关键帧半径且可直接回传分析', async () => {
  const s = await getJson('/api/sample');
  assert.equal(s.status, 200);
  const p3 = s.json.performers.find((p) => p.id === 'p3');
  assert.equal(p3.keys[2].r, 60);
  const r = await postAnalyze({ duration: s.json.duration, performers: s.json.performers });
  assert.equal(r.status, 200);
  assert.equal(r.json.pairCount, 6);
});

test('GET /healthz 正常', async () => {
  const r = await getJson('/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});
