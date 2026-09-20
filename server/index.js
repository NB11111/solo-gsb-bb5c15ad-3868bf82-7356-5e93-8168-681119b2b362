'use strict';

const path = require('path');
const express = require('express');
const core = require('../public/core.js');

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: 0
}));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

/** 内置交叉样例，前端启动时加载 */
app.get('/api/sample', (_req, res) => {
  res.json(core.builtinScene());
});

/**
 * 场景碰撞分析（与前端同一份解析引擎，便于集成/校验）。
 * body: { duration, performers:[{name?,radius,keys:[{t,x,y}]}] }
 */
app.post('/api/analyze', (req, res) => {
  try {
    const scene = req.body || {};
    const duration = Number(scene.duration);
    const performers = Array.isArray(scene.performers) ? scene.performers : [];

    if (!(duration > 0) || !isFinite(duration)) {
      return res.status(400).json({ error: 'duration 必须为正数（秒）' });
    }
    if (performers.length < 2 || performers.length > 8) {
      return res.status(400).json({ error: '表演者人数需为 2～8 人' });
    }

    performers.forEach((p, idx) => {
      if (!Array.isArray(p.keys) || p.keys.length === 0) {
        throw new Error(`第 ${idx + 1} 人至少需要 1 个走位点`);
      }
      if (!(Number(p.radius) >= 0) || !isFinite(Number(p.radius))) {
        throw new Error(`第 ${idx + 1} 人身体半径需为非负数`);
      }
      p.keys.forEach((k) => {
        ['t', 'x', 'y'].forEach((f) => {
          if (!isFinite(Number(k[f]))) {
            throw new Error(`第 ${idx + 1} 人存在非法走位点（${f} 非数字）`);
          }
        });
        if (Number(k.t) < 0 || Number(k.t) > duration) {
          throw new Error(`第 ${idx + 1} 人存在超出 [0, ${duration}] 的时刻`);
        }
      });
    });

    const result = core.analyzeScene({ duration, performers });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 兜底返回首页（仅根路径；其余静态资源缺失正常 404）
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`走位轨迹碰撞排练台已启动: http://localhost:${PORT}`);
  });
}

module.exports = app;
