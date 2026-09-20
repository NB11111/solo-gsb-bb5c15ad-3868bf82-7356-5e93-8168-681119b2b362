/**
 * 碰撞解析引擎（浏览器 / Node 通用，零依赖）
 *
 * 模型：每位表演者的运动是由关键帧定义的分段直线函数 p(t)。
 * 相邻关键帧之间位置随时间线性插值；关键帧之外（全局起止之间）保持静止。
 *
 * 关键帧可携带可选安全半径 r（世界单位，用于表现开伞、展开道具等占用
 * 范围变化）：未设置（null/undefined/非有限数）时继承表演者当前的固定
 * 半径 radius。相邻关键帧之间有效半径与位置同步线性插值；首尾关键帧
 * 之外（含静止段）保持端点值不变。
 *
 * 对任意两人 A、B，在两人各自同一段分段线性区间内：
 *
 *   相对位置  r(t) = pA(t) - pB(t) = u + v*t
 *   半径之和  R(t) = RA(t) + RB(t) = R0 + s*t
 *
 * 碰撞条件 |r(t)| <= R(t)（R(t) 在段内恒非负）平方后是关于 t 的一般
 * 二次不等式：
 *
 *     (|v|^2 - s^2) t^2 + 2(u·v - R0*s) t + |u|^2 - R0^2 <= 0
 *
 * 对每一对相互重叠的活动段按二次项系数符号（>0 / =0 / <0）用求根
 * 公式精确求解区间，再合并跨段相邻区间。相对静止但半径变化（s≠0）
 * 同样由该一般式覆盖，没有任何离散帧抽样——解出的就是碰撞发生的
 * 精确时间区间。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CollisionCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;          // 数值零容差
  var EPS_M = 1e-11;       // 求根/判别式的机器精度相对容差
  var MERGE_EPS = 1e-6;    // 区间合并间隙（秒）

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  /**
   * 规整关键帧：按 t 排序、去除重复时刻（保留后者）。
   * 返回 [{t, x, y, r}, ...]，其中 r 为显式关键帧半径（非负有限数），
   * 未设置时为 null（查询时继承表演者固定半径）。
   */
  function normalizeKeys(keys) {
    var list = (keys || [])
      .map(function (k) {
        return {
          t: Number(k.t),
          x: Number(k.x),
          y: Number(k.y),
          r: parseKeyRadius(k.r)
        };
      })
      .filter(function (k) {
        return isFinite(k.t) && isFinite(k.x) && isFinite(k.y);
      })
      .sort(function (a, b) {
        return a.t - b.t;
      });

    var out = [];
    list.forEach(function (k) {
      if (out.length && Math.abs(out[out.length - 1].t - k.t) < EPS) {
        out[out.length - 1] = k;
      } else {
        out.push(k);
      }
    });
    return out;
  }

  /** 解析关键帧可选半径：未提供/非法 -> null（继承表演者半径），否则取非负值。 */
  function parseKeyRadius(r) {
    if (r === null || r === undefined || r === '') return null;
    var n = Number(r);
    if (!isFinite(n)) return null;
    return Math.max(0, n);
  }

  /** 关键帧的有效半径：显式 r 优先，否则继承表演者基础半径 baseRadius。 */
  function keyRadius(k, baseRadius) {
    var b = Math.max(0, Number(baseRadius) || 0);
    if (k && k.r !== null && k.r !== undefined && isFinite(k.r)) return k.r;
    return b;
  }

  /**
   * 时刻 t 的有效安全半径（已规整或原始关键帧均可）：
   * 相邻关键帧之间与位置同步线性插值；首尾之外保持端点值；
   * 无关键帧时恒为表演者基础半径。
   */
  function radiusAt(keys, t, baseRadius) {
    // normalizeKeys 幂等，已规整或原始关键帧均可传入
    var ks = normalizeKeys(keys);
    if (!ks.length) return Math.max(0, Number(baseRadius) || 0);
    if (t <= ks[0].t) return keyRadius(ks[0], baseRadius);
    var last = ks[ks.length - 1];
    if (t >= last.t) return keyRadius(last, baseRadius);
    for (var i = 0; i < ks.length - 1; i++) {
      var a = ks[i];
      var b = ks[i + 1];
      if (t >= a.t && t <= b.t) {
        var f = (t - a.t) / (b.t - a.t);
        var ra = keyRadius(a, baseRadius);
        var rb = keyRadius(b, baseRadius);
        return ra + (rb - ra) * f;
      }
    }
    return keyRadius(last, baseRadius);
  }

  /** 时刻 t 在已规整关键帧上的精确位置（段外保持静止）。 */
  function positionAt(keys, t) {
    if (!keys.length) return { x: 0, y: 0 };
    if (t <= keys[0].t) return { x: keys[0].x, y: keys[0].y };
    var last = keys[keys.length - 1];
    if (t >= last.t) return { x: last.x, y: last.y };
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i];
      var b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        var f = (t - a.t) / (b.t - a.t);
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f
        };
      }
    }
    return { x: last.x, y: last.y };
  }

  /**
   * 把表演者在 [0, duration] 上展开为活动段。
   * 每段位置是线性运动 p(t) = (x0 + vx*t, y0 + vy*t)，
   * 有效半径同样是时间的一次函数 r(t) = r0 + sr*t，t ∈ [t0, t1]。
   * 关键帧之外位置静止（v=0），半径保持端点值（sr=0）。
   *
   * keys 可为原始关键帧；baseRadius 为表演者固定半径，未显式给 r
   * 的关键帧继承它。
   */
  function buildSegments(keys, duration, baseRadius) {
    var ks = normalizeKeys(keys);
    var rBase = Math.max(0, Number(baseRadius) || 0);
    var durationNum = Number(duration);
    if (!(durationNum > 0)) {
      throw new Error('duration 必须为正数');
    }
    var T = durationNum;
    var segs = [];

    function addLinear(t0, t1, p0, p1) {
      if (t1 - t0 < EPS) return;
      var dt = t1 - t0;
      var vx = (p1.x - p0.x) / dt;
      var vy = (p1.y - p0.y) / dt;
      var r0v = keyRadius(p0, rBase);
      var r1v = keyRadius(p1, rBase);
      var sr = (r1v - r0v) / dt;
      // 以绝对时刻表示 p(t) = x0 + vx*t，故 x0 是 t=0 截距（p0 - v*t0）
      segs.push({
        t0: t0,
        t1: t1,
        x0: p0.x - vx * t0,
        y0: p0.y - vy * t0,
        vx: vx,
        vy: vy,
        r0: r0v - sr * t0,
        sr: sr
      });
    }

    if (ks.length === 0) {
      var p00 = { t: 0, x: 0, y: 0, r: rBase };
      addLinear(0, T, p00, p00);
      return segs;
    }

    var first = ks[0];
    var last = ks[ks.length - 1];

    // 首帧之前：静止在首帧位置，半径保持首帧值
    if (first.t > 0) {
      addLinear(0, Math.min(first.t, T), first, first);
    }
    // 关键帧之间：位置与半径同步线性变化
    for (var i = 0; i < ks.length - 1; i++) {
      var a = ks[i];
      var b = ks[i + 1];
      var t0 = Math.max(0, a.t);
      var t1 = Math.min(T, b.t);
      if (t1 > t0) addLinear(t0, t1, a, b);
    }
    // 末帧之后：静止在末帧位置，半径保持末帧值
    if (last.t < T) {
      addLinear(Math.max(0, last.t), T, last, last);
    }
    if (!segs.length) {
      // 只有一个关键帧且恰好在边界等退化情况
      addLinear(0, T, first, first);
    }
    return segs;
  }

  function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    var sorted = intervals
      .map(function (iv) {
        // 数值舍入可能让零长度相切区间端点轻微倒置（如 12.000000000000002, 12）
        if (iv[0] > iv[1] && iv[0] - iv[1] <= EPS) return [iv[1], iv[0]];
        return iv;
      })
      .filter(function (iv) {
        return iv[1] >= iv[0] - EPS;
      })
      .sort(function (a, b) {
        return a[0] - b[0];
      });
    if (!sorted.length) return [];
    var out = [sorted[0].slice()];
    for (var i = 1; i < sorted.length; i++) {
      var cur = sorted[i];
      var top = out[out.length - 1];
      if (cur[0] <= top[1] + MERGE_EPS) {
        top[1] = Math.max(top[1], cur[1]);
      } else {
        out.push(cur.slice());
      }
    }
    return out;
  }

  /**
   * 两人在同一时间窗 [lo, hi] 内各自线性运动且半径线性变化，
   * 精确求 |r(t)| <= RA(t)+RB(t) 的碰撞时间区间。
   * 同时更新（几何）最小间距追踪对象 {t, dist}——该间距只与
   * 相对位置有关，与可变半径无关。
   */
  function analyzeOverlap(sA, sB, lo, hi, minRef) {
    var L = hi - lo;
    // 局部时间 τ = t - lo ∈ [0, L] 上：
    //   相对位置 r(t) = u + v t；半径和 R(t) = R0 + s t
    var ux = sA.x0 - sB.x0;
    var uy = sA.y0 - sB.y0;
    var vx = sA.vx - sB.vx;
    var vy = sA.vy - sB.vy;
    var R0 = sA.r0 + sB.r0;
    var s = sA.sr + sB.sr;

    // 局部系数：|u+v t|^2 - (R0+s t)^2 = A τ^2 + B τ + C
    var Ax = ux + vx * lo;
    var Ay = uy + vy * lo;
    var Rl = R0 + s * lo;
    var A = vx * vx + vy * vy - s * s;
    var B = 2 * (Ax * vx + Ay * vy - Rl * s);
    var C = Ax * Ax + Ay * Ay - Rl * Rl;

    // —— 几何最小间距（抛物线 |r(t)|^2 的顶点/端点比较，与半径无关）——
    var v2 = vx * vx + vy * vy;
    var tDist;
    if (v2 < EPS) {
      tDist = lo; // 相对静止，距离恒定，任取端点
    } else {
      var tv = -(ux * vx + uy * vy) / v2;
      tDist = clamp(tv, lo, hi);
    }
    var dxm = ux + vx * tDist;
    var dym = uy + vy * tDist;
    var dm = Math.sqrt(dxm * dxm + dym * dym);
    if (dm < minRef.dist) {
      minRef.dist = dm;
      minRef.t = tDist;
    }

    // 系数判零采用机器精度相对容差（大坐标下求根/判别式有舍入相消）
    var tolA = EPS_M * (v2 + s * s) + EPS_M;
    var tolB = EPS_M * (Math.hypot(Ax, Ay) * Math.sqrt(v2 || 0) + Rl * Math.abs(s)) + EPS_M;
    var hits = [];

    function pushLocal(x0, x1) {
      // 区间完全在窗外：忽略
      if (x1 < -EPS || x0 > L + EPS) return;
      // 与 [0, L] 求交后换回绝对时刻；含相切零长度区间（根恰好落在端点）
      var a0 = x0 < 0 ? 0 : x0;
      var a1 = x1 > L ? L : x1;
      if (a0 - a1 <= EPS && a0 - a1 > 0) { var tmp = a0; a0 = a1; a1 = tmp; }
      if (a1 >= a0 - EPS) hits.push([lo + a0, lo + a1]);
    }

    if (Math.abs(A) <= tolA) {
      // —— 一次（含常数）情形：Bτ + C <= 0 ——
      if (Math.abs(B) <= tolB) {
        if (C <= EPS) hits.push([lo, hi]); // 恒定：全程重叠（相切也算）
        return hits;
      }
      var root = -C / B;
      if (B > 0) pushLocal(root, L);   // f 递增：根点之后在区间内（含端点相切）
      else pushLocal(0, root);         // f 递减：根点之前在区间内（含端点相切）
      return hits;
    }

    // —— 真二次情形 Aτ² + Bτ + C <= 0 ——
    var tolD = EPS_M * Math.max(B * B, 4 * Math.abs(A * C)) + EPS_M;
    var disc = B * B - 4 * A * C;
    if (disc < -tolD) {
      // 无实根：符号与 A 一致。A<0 时恒在区间内（扩张速度始终快于远离）
      if (A < 0) hits.push([lo, hi]);
      return hits;
    }
    if (disc < 0) disc = 0;
    var sq = Math.sqrt(disc);
    var ra_ = (-B - sq) / (2 * A);
    var rb_ = (-B + sq) / (2 * A);
    var rootMin = Math.min(ra_, rb_);   // A<0 时除法会颠倒两根本序
    var rootMax = Math.max(ra_, rb_);

    if (A > 0) {
      pushLocal(rootMin, rootMax);       // 开口向上：两根之间
    } else {
      pushLocal(-Infinity, rootMin);     // 开口向下：两根之外
      pushLocal(rootMax, Infinity);
    }
    return hits;
  }

  /**
   * 分析一对表演者。
   * performer: { id?, name?, radius, keys:[{t,x,y,r?}...] }
   *   关键帧可带可选 r（安全半径）；未设置的关键帧继承 radius。
   * 返回 {
   *   aId,bId,aName,bName, radiusSum,
   *   radiusSumMin, radiusSumMax, variableRadius,
   *   intervals:[[t0,t1],...],     // 合并后的精确碰撞区间
   *   minDistance, firstContact,   // 首次碰撞时刻（无则 null）
   *   lastRelease
   * }
   */
  function analyzePair(pa, pb, duration) {
    var rA = Math.max(0, Number(pa.radius) || 0);
    var rB = Math.max(0, Number(pb.radius) || 0);
    var rSum = rA + rB;

    var segsA = buildSegments(pa.keys, duration, rA);
    var segsB = buildSegments(pb.keys, duration, rB);

    var raw = [];
    var minRef = { dist: Infinity, t: 0 };
    var rMin = Infinity;
    var rMax = -Infinity;
    var variable = false;

    var i = 0;
    var j = 0;
    while (i < segsA.length && j < segsB.length) {
      var a = segsA[i];
      var b = segsB[j];
      var lo = Math.max(a.t0, b.t0);
      var hi = Math.min(a.t1, b.t1);
      if (hi - lo > EPS) {
        // 该重叠窗内半径和 R(t)=R0+s t 的端点值
        var rlo = (a.r0 + b.r0) + (a.sr + b.sr) * lo;
        var rhi = (a.r0 + b.r0) + (a.sr + b.sr) * hi;
        rMin = Math.min(rMin, rlo, rhi);
        rMax = Math.max(rMax, rlo, rhi);
        if (Math.abs(a.sr) > EPS_M || Math.abs(b.sr) > EPS_M) variable = true;
        var found = analyzeOverlap(a, b, lo, hi, minRef);
        for (var k = 0; k < found.length; k++) raw.push(found[k]);
      }
      if (a.t1 < b.t1 - EPS) i++;
      else if (b.t1 < a.t1 - EPS) j++;
      else { i++; j++; }
    }

    var intervals = mergeIntervals(raw);
    if (!isFinite(minRef.dist)) {
      minRef = { dist: 0, t: 0 };
    }
    if (!isFinite(rMin)) { rMin = rSum; rMax = rSum; }

    return {
      aId: pa.id,
      bId: pb.id,
      aName: pa.name || pa.id,
      bName: pb.name || pb.id,
      radiusSum: rSum,
      radiusSumMin: rMin,
      radiusSumMax: rMax,
      variableRadius: variable,
      intervals: intervals,
      minDistance: minRef.dist,
      minDistanceT: minRef.t,
      firstContact: intervals.length ? intervals[0][0] : null,
      lastRelease: intervals.length ? intervals[intervals.length - 1][1] : null,
      collision: intervals.length > 0
    };
  }

  /**
   * 分析整个场景：枚举全部 C(n,2) 双人组合。
   * scene: { duration, performers:[performer...] }
   */
  function analyzeScene(scene) {
    var duration = Number(scene.duration);
    if (!(duration > 0)) throw new Error('duration 必须为正数');
    var ps = scene.performers || [];
    var pairs = [];
    for (var i = 0; i < ps.length; i++) {
      for (var j = i + 1; j < ps.length; j++) {
        pairs.push(analyzePair(ps[i], ps[j], duration));
      }
    }

    var collisions = pairs.filter(function (p) {
      return p.collision;
    });
    var firstPair = null;
    collisions.forEach(function (p) {
      if (!firstPair || p.firstContact < firstPair.firstContact) firstPair = p;
    });
    var closestPair = null;
    pairs.forEach(function (p) {
      if (!closestPair || p.minDistance < closestPair.minDistance) closestPair = p;
    });

    return {
      duration: duration,
      pairCount: pairs.length,
      pairs: pairs,
      firstContact: firstPair ? firstPair.firstContact : null,
      firstContactPair: firstPair
        ? [firstPair.aId, firstPair.bId]
        : null,
      minDistance: closestPair ? closestPair.minDistance : null,
      minDistanceT: closestPair ? closestPair.minDistanceT : null,
      minDistancePair: closestPair
        ? [closestPair.aId, closestPair.bId]
        : null
    };
  }

  /** 查询某表演者在时刻 t 是否处于某碰撞区间内（供画布高亮）。 */
  function isPerformerInCollision(pair, performerId, t) {
    if (!pair || !pair.collision) return false;
    if (pair.aId !== performerId && pair.bId !== performerId) return false;
    for (var i = 0; i < pair.intervals.length; i++) {
      var iv = pair.intervals[i];
      if (t + EPS >= iv[0] && t - EPS <= iv[1]) return true;
    }
    return false;
  }

  /**
   * 内置交叉样例（4 人，时长 12s，世界 1000×600）：
   *  - 甲（水平横穿）与乙（竖直纵穿）路径十字交叉，在 t=6 同时到达交点 -> 相撞
   *  - 丙为错峰折线，几何路径与甲/乙相交但到达时刻错开 -> 不撞
   *  - 丁起初与丙分离，约 t=2.6 起追上丙并保持贴近 -> 持续碰撞（相对静止退化段）；
   *    丁在 t=4～8 把安全半径从 20 展开到 55（开伞/展开道具），
   *    碰撞引擎对线性变化的半径和连续解析，碰撞带随之扩大
   */
  function builtinScene() {
    return {
      duration: 12,
      world: { width: 1000, height: 600 },
      performers: [
        {
          id: 'p1',
          name: '甲·横贯',
          color: '#ef4444',
          radius: 20,
          keys: [
            { t: 0, x: 60, y: 300 },
            { t: 12, x: 940, y: 300 }
          ]
        },
        {
          id: 'p2',
          name: '乙·纵穿',
          color: '#38bdf8',
          radius: 20,
          keys: [
            { t: 0, x: 500, y: 40 },
            { t: 12, x: 500, y: 560 }
          ]
        },
        {
          id: 'p3',
          name: '丙·错峰折线',
          color: '#22c55e',
          radius: 20,
          keys: [
            { t: 0, x: 60, y: 540 },
            { t: 4, x: 500, y: 60 },
            { t: 8, x: 940, y: 540 }
          ]
        },
        {
          id: 'p4',
          name: '丁·跟进展伞',
          color: '#facc15',
          radius: 20,
          keys: [
            { t: 0, x: 160, y: 540 },
            { t: 4, x: 500, y: 90, r: 20 },
            { t: 8, x: 940, y: 570, r: 55 }
          ]
        }
      ]
    };
  }

  return {
    EPS: EPS,
    normalizeKeys: normalizeKeys,
    parseKeyRadius: parseKeyRadius,
    keyRadius: keyRadius,
    positionAt: positionAt,
    radiusAt: radiusAt,
    buildSegments: buildSegments,
    analyzePair: analyzePair,
    analyzeScene: analyzeScene,
    isPerformerInCollision: isPerformerInCollision,
    builtinScene: builtinScene
  };
});
