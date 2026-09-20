'use strict';

/**
 * 前端冒烟测试：jsdom + Canvas 2D 桩加载 core.js / app.js，
 * 模拟拖动画布走位点、增删表演者、改半径、时间轴跳转，
 * 断言重算结果与 DOM 同步。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('../public/core.js');

const PUBLIC = path.join(__dirname, '..', 'public');

function makeCtx() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      switch (prop) {
        case 'createLinearGradient': return () => gradient;
        case 'measureText': return () => ({ width: 10 });
        default:
          if (prop in t) return t[prop];
          return typeof prop === 'string' ? noop : undefined;
      }
    },
    set(t, prop, val) { t[prop] = val; return true; }
  });
}

async function boot() {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  window.HTMLCanvasElement.prototype.getContext = () => makeCtx();
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0
  });
  window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.setPointerCapture = () => {};

  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve(core.builtinScene()) });

  const origGet = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'timeline-lanes') {
      return { left: 14, top: 40, width: 972, height: 88, right: 986, bottom: 128, x: 14, y: 40 };
    }
    if (this.id === 'timeline') {
      return { left: 0, top: 0, width: 1000, height: 140, right: 1000, bottom: 140, x: 0, y: 0 };
    }
    if (this.tagName === 'CANVAS') {
      return { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0 };
    }
    return origGet.call(this);
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return this.id === 'timeline-lanes' ? 972 : 100; }
  });

  window.eval(fs.readFileSync(path.join(PUBLIC, 'core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 40));
  return dom;
}

test('启动：载入 4 人样例，摘要与 6 对结果正确渲染', async () => {
  const dom = await boot();
  const doc = dom.window.document;

  assert.equal(doc.querySelectorAll('.performer-item').length, 4);
  assert.equal(doc.querySelectorAll('.pair-row').length, 6);
  assert.match(doc.getElementById('sum-first').textContent, /2\.60\s*s/);
  assert.match(doc.getElementById('sum-min').textContent, /0\.00/);
  assert.match(doc.getElementById('sum-first-who').textContent, /丙[\s\S]*丁/);
  assert.ok(doc.querySelectorAll('.tl-danger').length >= 2, '时间轴应渲染危险区间条');
  assert.equal(doc.querySelectorAll('.tl-key').length, 10, '4 人共 10 个关键帧时刻柄');

  // 碰撞对排在前、安全对在后
  assert.ok(doc.querySelectorAll('.pair-row.danger').length >= 2);
  dom.window.close();
});

test('拖动画布走位点后立即重算：把乙两帧移到 x=300，错峰消除甲乙碰撞', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;
  const canvas = doc.getElementById('stage');

  function pointer(type, x, y) {
    const ev = new window.MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
    });
    canvas.dispatchEvent(ev);
  }
  // p2 初始选中者是 p1；先点中 p2 首帧 (500,40) 并拖到 (300,40)
  pointer('pointerdown', 500, 40);
  pointer('pointermove', 300, 40);
  pointer('pointerup', 300, 40);
  // 末帧 (500,560) -> (300,560)
  pointer('pointerdown', 500, 560);
  pointer('pointermove', 300, 560);
  pointer('pointerup', 300, 560);
  await new Promise((r) => setTimeout(r, 10));

  // 乙沿 x=300 纵走：路径仍几何交叉，但到达 (300,300) 时 t≈3.98，
  // 甲此时只走到 x≈329，错峰约 101.75 单位 —— 解析判定安全
  const rows = [...doc.querySelectorAll('.pair-row')].map((r) => r.textContent);
  const jiaYi = rows.find((t) => t.includes('甲') && t.includes('乙'));
  assert.match(jiaYi, /安全/);
  assert.match(jiaYi, /101\.75/);
  dom.window.close();
});

test('增加表演者与修改半径：8 人上限、C(n,2) 对实时更新', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;

  doc.getElementById('btn-add').click();
  assert.equal(doc.querySelectorAll('.performer-item').length, 5);
  assert.equal(doc.querySelectorAll('.pair-row').length, 10);

  for (let i = 0; i < 3; i++) doc.getElementById('btn-add').click();
  assert.equal(doc.querySelectorAll('.performer-item').length, 8);
  assert.equal(doc.getElementById('btn-add').disabled, true);
  assert.equal(doc.querySelectorAll('.pair-row').length, 28);

  // 改半径（当前选中的是新加的第 8 人）
  const rInput = doc.querySelector('.performer-item.selected .performer-radius');
  rInput.value = '100';
  rInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(doc.querySelectorAll('.pair-row').length, 28);
  // 半径 100 与最近路径几乎必然碰撞：危险对数量增加
  assert.ok(doc.querySelectorAll('.pair-row.danger').length >= 3);
  dom.window.close();
});

test('时间轴点击跳转 & 人数下限 2', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;

  const tl = doc.getElementById('timeline');
  const rect = doc.getElementById('timeline-lanes').getBoundingClientRect();
  tl.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, clientX: rect.left + 972 * 0.5, clientY: rect.top + 5
  }));
  const tv = Number(doc.getElementById('time-input').value);
  assert.ok(Math.abs(tv - 6) < 0.15, `播放时刻应≈6，实际 ${tv}`);

  const dels = doc.querySelectorAll('.performer-del');
  dels[3].click();
  dels[2].click();
  assert.equal(doc.querySelectorAll('.performer-item').length, 2);
  assert.equal(doc.querySelectorAll('.pair-row').length, 1);

  doc.querySelector('.performer-del').click();
  assert.equal(doc.querySelectorAll('.performer-item').length, 2, '必须保留至少 2 人');
  dom.window.close();
});

test('修改总时长后关键帧截断并重算', async () => {
  const dom = await boot();
  const { window } = dom;
  const doc = window.document;

  const dInput = doc.getElementById('duration-input');
  dInput.value = '5';
  dInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(doc.getElementById('duration-readout').textContent, '5.0');
  // 原样例 t>5 的帧被截断：p1 剩 1 帧(0)，p2 剩 1 帧(0)，p3 剩 2 帧(0,4)，p4 剩 2 帧(0,4)
  assert.equal(doc.querySelectorAll('.tl-key').length, 6);
  // 仍有结果输出
  assert.equal(doc.querySelectorAll('.pair-row').length, 6);
  dom.window.close();
});
