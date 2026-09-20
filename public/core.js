/**
 * 碰撞解析引擎（浏览器 / Node 通用，零依赖）
 *
 * 模型：每位表演者的运动是由关键帧定义的分段直线函数 p(t)。
 * 相邻关键帧之间位置随时间线性插值；关键帧之外（全局起止之间）保持静止。
 *
 * 对任意两人 A、B，相对位置 r(t) = pA(t) - pB(t) 在两人各自同一段
 * 分段线性区间内是时间 t 的一次函数：r(t) = u + v*t。
 * 碰撞条件 |r(t)| <= RA + RB 是关于 t 的二次不等式：
 *
 *     |v|^2 t^2 + 2(u·v) t + |u|^2 - R^2 <= 0
 *
 * 对每一对相互重叠的活动段用求根公式精确求解区间，再合并跨段相邻区间。
 * 全程没有任何离散帧抽样——解出的就是碰撞发生的精确时间区间。
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
  var MERGE_EPS = 1e-6;    // 区间合并间隙（秒）

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  /**
   * 规整关键帧：按 t 排序、去除重复时刻（保留后者）。
   * 返回 [{t, x, y}, ...]
   */
  function normalizeKeys(keys) {
    var list = (keys || [])
      .map(function (k) {
        return {
          t: Number(k.t),
          x: Number(k.x),
          y: Number(k.y)
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
   * 每段是线性运动 p(t) = (x0 + vx*t, y0 + vy*t)，t ∈ [t0, t1]。
   * 关键帧之外是 v=0 的静止段。
   */
  function buildSegments(keys, duration) {
    var ks = normalizeKeys(keys);
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
      // 以绝对时刻表示 p(t) = x0 + vx*t，故 x0 是 t=0 截距（p0 - v*t0）
      segs.push({
        t0: t0,
        t1: t1,
        x0: p0.x - vx * t0,
        y0: p0.y - vy * t0,
        vx: vx,
        vy: vy
      });
    }

    if (ks.length === 0) {
      addLinear(0, T, { x: 0, y: 0 }, { x: 0, y: 0 });
      return segs;
    }

    var first = ks[0];
    var last = ks[ks.length - 1];

    // 首帧之前：静止在首帧位置
    if (first.t > 0) {
      addLinear(0, Math.min(first.t, T), first, first);
    }
    // 关键帧之间：直线运动
    for (var i = 0; i < ks.length - 1; i++) {
      var a = ks[i];
      var b = ks[i + 1];
      var t0 = Math.max(0, a.t);
      var t1 = Math.min(T, b.t);
      if (t1 > t0) addLinear(t0, t1, a, b);
    }
    // 末帧之后：静止在末帧位置
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
      .filter(function (iv) {
        return iv[1] >= iv[0];
      })
      .sort(function (a, b) {
        return a[0] - b[0];
      });
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
   * 两人在同一时间窗 [lo, hi] 内各自线性运动，精确求碰撞时间区间。
   * 同时更新最小间距追踪对象 {t, dist}。
   */
  function analyzeOverlap(sA, sB, lo, hi, rSum, minRef) {
    // 相对运动 r(t) = u + v t
    var ux = sA.x0 - sB.x0;
    var uy = sA.y0 - sB.y0;
    var vx = sA.vx - sB.vx;
    var vy = sA.vy - sB.vy;

    var v2 = vx * vx + vy * vy;
    var u2 = ux * ux + uy * uy;
    var uv = ux * vx + uy * vy;

    // —— 最小间距（抛物线 |r(t)|^2 的顶点/端点比较）——
    var tDist;
    if (v2 < EPS) {
      tDist = lo; // 相对静止，距离恒定，任取端点
    } else {
      var tv = -uv / v2;
      tDist = clamp(tv, lo, hi);
    }
    var dxm = ux + vx * tDist;
    var dym = uy + vy * tDist;
    var dm = Math.sqrt(dxm * dxm + dym * dym);
    if (dm < minRef.dist) {
      minRef.dist = dm;
      minRef.t = tDist;
    }

    // —— 碰撞区间 |r(t)| <= rSum 的解析解 ——
    var hits = [];
    var rr = rSum * rSum;

    if (v2 < EPS) {
      // 相对静止：要么整段碰撞，要么完全不碰
      if (u2 <= rr + EPS) {
        hits.push([lo, hi]);
      }
      return hits;
    }

    var disc = uv * uv - v2 * (u2 - rr);
    if (disc < -EPS) {
      return hits; // 二次式恒正，距离始终大于半径和
    }
    if (disc < 0) disc = 0;
    var sq = Math.sqrt(disc);
    var tA = (-uv - sq) / v2;
    var tB = (-uv + sq) / v2;
    var lo2 = Math.max(lo, tA);
    var hi2 = Math.min(hi, tB);
    if (hi2 >= lo2 - EPS) {
      hits.push([Math.max(0, lo2), Math.min(hi2, hi)]);
    }
    return hits;
  }

  /**
   * 分析一对表演者。
   * performer: { id?, name?, radius, keys:[{t,x,y}...] }
   * 返回 {
   *   aId,bId,aName,bName, radiusSum,
   *   intervals:[[t0,t1],...],     // 合并后的精确碰撞区间
   *   minDistance, firstContact,   // 首次碰撞时刻（无则 null）
   *   lastRelease
   * }
   */
  function analyzePair(pa, pb, duration) {
    var rA = Math.max(0, Number(pa.radius) || 0);
    var rB = Math.max(0, Number(pb.radius) || 0);
    var rSum = rA + rB;

    var segsA = buildSegments(pa.keys, duration);
    var segsB = buildSegments(pb.keys, duration);

    var raw = [];
    var minRef = { dist: Infinity, t: 0 };

    var i = 0;
    var j = 0;
    while (i < segsA.length && j < segsB.length) {
      var a = segsA[i];
      var b = segsB[j];
      var lo = Math.max(a.t0, b.t0);
      var hi = Math.min(a.t1, b.t1);
      if (hi - lo > EPS) {
        var found = analyzeOverlap(a, b, lo, hi, rSum, minRef);
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

    return {
      aId: pa.id,
      bId: pb.id,
      aName: pa.name || pa.id,
      bName: pb.name || pb.id,
      radiusSum: rSum,
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
   *  - 丁起初与丙分离，约 t=2.6 起追上丙并保持贴近 -> 持续碰撞（相对静止退化段）
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
          name: '丁·跟进',
          color: '#facc15',
          radius: 20,
          keys: [
            { t: 0, x: 160, y: 540 },
            { t: 4, x: 500, y: 90 },
            { t: 8, x: 940, y: 570 }
          ]
        }
      ]
    };
  }

  return {
    EPS: EPS,
    normalizeKeys: normalizeKeys,
    positionAt: positionAt,
    buildSegments: buildSegments,
    analyzePair: analyzePair,
    analyzeScene: analyzeScene,
    isPerformerInCollision: isPerformerInCollision,
    builtinScene: builtinScene
  };
});
