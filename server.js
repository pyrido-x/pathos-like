'use strict';

// ═══════════════════════════════════════════════
//  Pathos 在线 — 九宫格地牢 · 战争迷雾 · 回合制
// ═══════════════════════════════════════════════

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// ═══════════ 常量 ═══════════
const TILE   = { WALL:0, FLOOR:1, STAIRS_UP:2, STAIRS_DOWN:3, DOOR:4 };
const MAP_W  = 60, MAP_H = 40;
const SIGHT  = 8;             // 玩家视野半径
const MOVE_CD = 180;
const RESPAWN_MS = 4000;

// ═══════════ 工具函数 ═══════════
const ri  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const rp  = arr => arr[Math.floor(Math.random()*arr.length)];
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const dist = (x1,y1,x2,y2) => Math.abs(x2-x1)+Math.abs(y2-y1);
const roll = d => { let [n,s]=d.split('d'),t=0; for(let i=0;i<+n;i++) t+=ri(1,+s); return t; };
const key2 = (x,y) => x+','+y;

// ═══════════ 职业 ═══════════
const CLASSES = {
  warrior: { name:'战士', desc:'HP高·力量强·新手推荐', str:16, dex:10, hp:38, color:'#FF6B6B', startWep:'shortSword', startArm:'leatherArmor' },
  wizard:  { name:'法师', desc:'HP低·智力高·魔法伤害',   str:8,  dex:12, hp:22, color:'#6B9BFF', startWep:'dagger',     startArm:null },
  rogue:   { name:'盗贼', desc:'敏捷高·暴击率翻倍',       str:12, dex:18, hp:26, color:'#6BFF6B', startWep:'shortSword', startArm:null },
};

// ═══════════ 怪物 ═══════════
const MONSTERS = {
  goblin:   { n:'哥布林',   e:'👺', hp:8,  st:8,  dx:10, xp:10,  ml:1 },
  giantRat: { n:'巨鼠',     e:'🐀', hp:5,  st:6,  dx:14, xp:5,   ml:1 },
  bat:      { n:'巨蝙蝠',   e:'🦇', hp:6,  st:5,  dx:16, xp:7,   ml:1 },
  skeleton: { n:'骷髅兵',   e:'💀', hp:12, st:10, dx:8,  xp:15,  ml:2 },
  orc:      { n:'兽人',     e:'👹', hp:16, st:14, dx:9,  xp:25,  ml:2 },
  slime:    { n:'史莱姆',   e:'🟢', hp:10, st:5,  dx:4,  xp:10,  ml:2 },
  troll:    { n:'巨魔',     e:'🧌', hp:32, st:18, dx:7,  xp:80,  ml:3 },
  wraith:   { n:'幽灵',     e:'👻', hp:22, st:12, dx:14, xp:60,  ml:4 },
  dragon:   { n:'火龙',     e:'🐉', hp:55, st:24, dx:10, xp:350, ml:5 },
  nemesis:  { n:'复仇女神', e:'👁️', hp:90, st:28, dx:17, xp:1200,ml:6 },
};

function spawnPool(lvl) {
  const p = [];
  for (const [k,m] of Object.entries(MONSTERS)) {
    if (m.ml > lvl+1) continue;
    const wt = k==='nemesis'?1 : k==='dragon'?2 : k==='troll'||k==='wraith'?3 : 8;
    for (let i=0;i<wt;i++) p.push(k);
  }
  return p;
}

// ═══════════ 尸体食用效果 ═══════════
const CORPSE_FX = {
  goblin:   [{ t:'heal',v:8,  msg:'味道糟糕，但恢复了一些生命值。' }],
  giantRat: [{ t:'sick',pct:0.3,msg:'你感到恶心……' },{ t:'resist',res:'毒素',pct:0.12,msg:'血液微微发麻——获得了毒素抗性！' }],
  bat:      [{ t:'temp',stat:'dex',v:2,trn:50,msg:'蝙蝠精华让你更加敏捷！' }],
  skeleton: [{ t:'nothing',msg:'嘎嘣脆，没味道。' }],
  orc:      [{ t:'temp',stat:'str',v:2,trn:50,msg:'兽人之力涌入体内！' }],
  slime:    [{ t:'sick',pct:0.35,msg:'史莱姆在你胃里翻腾！' },{ t:'resist',res:'酸',pct:0.12,msg:'皮肤变硬——酸性抗性！' }],
  troll:    [{ t:'regen',trn:40,msg:'你感到伤口正在愈合！' },{ t:'temp',stat:'str',v:3,trn:40,msg:'巨魔之力！' }],
  wraith:   [{ t:'sick',pct:0.3,msg:'暗影精华让你虚弱！' },{ t:'perm',stat:'str',v:1,pct:0.08,msg:'你永久吸收了幽灵之力！' }],
  dragon:   [{ t:'resist',res:'火焰',pct:0.5,msg:'火焰再也伤不到你了！' },{ t:'breath',trn:25,msg:'你可以喷吐火焰了！' }],
  nemesis:  [{ t:'perm',stat:'str',v:2,pct:0.6,msg:'复仇女神的精华永久增强了你！' },{ t:'resist',res:'全',pct:0.5,msg:'获得了终极抗性！' }],
};

// ═══════════ 物品 ═══════════
const ITEMS = {
  dagger:       { cat:'武器', n:'匕首',       e:'🗡️', dmg:'1d4', atk:1 },
  shortSword:   { cat:'武器', n:'短剑',       e:'⚔️', dmg:'1d6', atk:2 },
  longSword:    { cat:'武器', n:'长剑',       e:'⚔️', dmg:'1d8', atk:3 },
  battleAxe:    { cat:'武器', n:'战斧',       e:'🪓', dmg:'1d10',atk:3 },
  magicStaff:   { cat:'武器', n:'魔法杖',     e:'🪄', dmg:'2d6', atk:5 },
  leatherArmor: { cat:'护甲', n:'皮甲',       e:'🛡️', def:2 },
  chainmail:    { cat:'护甲', n:'锁子甲',     e:'🛡️', def:4 },
  plateMail:    { cat:'护甲', n:'板甲',       e:'🛡️', def:6 },
  dragonScale:  { cat:'护甲', n:'龙鳞甲',     e:'🛡️', def:8 },
  healPotion:   { cat:'药水', n:'治疗药水',   e:'🧪', fx:'heal', v:25 },
  fullHeal:     { cat:'药水', n:'完全治疗',   e:'🧪', fx:'heal', v:999 },
  strPotion:    { cat:'药水', n:'力量药水',   e:'💪', fx:'str' },
  dexPotion:    { cat:'药水', n:'敏捷药水',   e:'💨', fx:'dex' },
  teleScroll:   { cat:'卷轴', n:'传送卷轴',   e:'📜', fx:'tele' },
  enchWep:      { cat:'卷轴', n:'附魔武器',   e:'📜', fx:'ewep' },
  enchArm:      { cat:'卷轴', n:'附魔护甲',   e:'📜', fx:'earm' },
  fireScroll:   { cat:'卷轴', n:'火焰卷轴',   e:'🔥', fx:'fire' },
  ration:       { cat:'食物', n:'口粮',       e:'🍞', nut:800 },
  apple:        { cat:'食物', n:'苹果',       e:'🍎', nut:150, heal:8 },
  bread:        { cat:'食物', n:'面包',       e:'🥖', nut:400 },
  ringStr:      { cat:'戒指', n:'力量戒指',   e:'💍', ring:'str', v:2 },
  ringDex:      { cat:'戒指', n:'敏捷戒指',   e:'💍', ring:'dex', v:2 },
  ringProt:     { cat:'戒指', n:'防护戒指',   e:'💍', ring:'def', v:2 },
  ringRegen:    { cat:'戒指', n:'再生戒指',   e:'💍', ring:'regen', v:1 },
};

function mkItem(key, lv, x, y) {
  const t = ITEMS[key]; if (!t) return null;
  return { id:uid(), key, ...JSON.parse(JSON.stringify(t)), lv, x, y };
}

const ITEM_POOL = (()=>{
  const c = ['ration','apple','bread','healPotion','dagger'];
  const u = ['shortSword','leatherArmor','strPotion','dexPotion','teleScroll','ringStr','ringDex'];
  const r = ['longSword','chainmail','enchWep','enchArm','fullHeal','fireScroll','ringProt'];
  const e = ['battleAxe','magicStaff','plateMail','dragonScale','ringRegen'];
  return lvl => {
    let p = [...c];
    if(lvl>=2) p.push(...u);
    if(lvl>=3) p.push(...r);
    if(lvl>=5) p.push(...e);
    return rp(p);
  };
})();

// ═══════════════════════════════════════
//  九宫格地牢生成器
// ═══════════════════════════════════════

function genDungeon(lvl) {
  // 全墙初始化
  const tiles = Array.from({length:MAP_H},()=>Array.from({length:MAP_W},()=>TILE.WALL));

  // 3×3 分区
  const ZW = Math.floor(MAP_W/3);  // 20
  const ZH = Math.floor(MAP_H/3);  // 13

  // ── 第一步：在每个九宫格区域生成一个房间 ──
  const rooms = [];
  for (let gx = 0; gx < 3; gx++) {
    for (let gy = 0; gy < 3; gy++) {
      const zoneX = gx * ZW + 1;
      const zoneY = gy * ZH + 1;
      const zoneW = ZW - 2;
      const zoneH = ZH - 2;

      // 随机房间尺寸和形状
      let rw, rh;
      const shape = Math.random();
      if (shape < 0.35) {
        // 正方形-ish
        rw = ri(5, Math.min(9, zoneW-2));
        rh = ri(5, Math.min(7, zoneH-2));
      } else if (shape < 0.6) {
        // 横向长条形
        rw = ri(7, Math.min(11, zoneW-2));
        rh = ri(3, 5);
      } else if (shape < 0.8) {
        // 纵向长条形
        rw = ri(3, 5);
        rh = ri(5, Math.min(9, zoneH-2));
      } else {
        // 大房间
        rw = ri(6, Math.min(10, zoneW-2));
        rh = ri(5, Math.min(8, zoneH-2));
      }

      // 房间在区域内随机偏移
      const rx = zoneX + ri(0, Math.max(0, zoneW - rw - 2));
      const ry = zoneY + ri(0, Math.max(0, zoneH - rh - 2));

      // 挖出房间
      for (let y = ry; y < ry + rh; y++)
        for (let x = rx; x < rx + rw; x++)
          if (y>=0 && y<MAP_H && x>=0 && x<MAP_W)
            tiles[y][x] = TILE.FLOOR;

      rooms.push({ x:rx, y:ry, w:rw, h:rh, cx:Math.floor(rx+rw/2), cy:Math.floor(ry+rh/2), gx, gy });
    }
  }

  // ── 第二步：用最小生成树(MST)保证全连通，再加额外边 ──
  // 边权重 = 曼哈顿距离
  const edges = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i+1; j < rooms.length; j++) {
      edges.push({ a:i, b:j, w:dist(rooms[i].cx,rooms[i].cy,rooms[j].cx,rooms[j].cy) });
    }
  }
  edges.sort((a,b)=>a.w-b.w);

  // Union-Find
  const parent = Array.from({length:rooms.length},(_,i)=>i);
  const find = x => parent[x]===x ? x : (parent[x]=find(parent[x]));
  const union = (a,b) => { const ra=find(a),rb=find(b); if(ra!==rb){ parent[ra]=rb; return true; } return false; };

  const mstEdges = [];
  for (const e of edges) { if (union(e.a, e.b)) mstEdges.push(e); }

  // 额外随机连接（1~3条）形成环路
  const extraCount = ri(1, 3);
  const mstUsed = new Set(mstEdges.map(e=>`${Math.min(e.a,e.b)}_${Math.max(e.a,e.b)}`));
  const extraEdges = [];
  for (const e of edges) {
    if (extraEdges.length >= extraCount) break;
    const key = `${Math.min(e.a,e.b)}_${Math.max(e.a,e.b)}`;
    if (!mstUsed.has(key)) { extraEdges.push(e); mstUsed.add(key); }
  }

  const allConnections = [...mstEdges, ...extraEdges];

  // ── 第三步：画走廊 ──
  for (const conn of allConnections) {
    const a = rooms[conn.a], b = rooms[conn.b];
    let cx = a.cx, cy = a.cy;
    const tx = b.cx, ty = b.cy;

    // L形走廊，随机先水平还是先垂直
    if (Math.random() < 0.5) {
      // 先水平后垂直
      while (cx !== tx) { cx += cx<tx?1:-1; if(cy>=0&&cy<MAP_H&&cx>=0&&cx<MAP_W) tiles[cy][cx]=TILE.FLOOR; }
      while (cy !== ty) { cy += cy<ty?1:-1; if(cy>=0&&cy<MAP_H&&cx>=0&&cx<MAP_W) tiles[cy][cx]=TILE.FLOOR; }
    } else {
      // 先垂直后水平
      while (cy !== ty) { cy += cy<ty?1:-1; if(cy>=0&&cy<MAP_H&&cx>=0&&cx<MAP_W) tiles[cy][cx]=TILE.FLOOR; }
      while (cx !== tx) { cx += cx<tx?1:-1; if(cy>=0&&cy<MAP_H&&cx>=0&&cx<MAP_W) tiles[cy][cx]=TILE.FLOOR; }
    }
  }

  // ── 第四步：在房间入口放门（标记为特殊地板，视觉上有门） ──
  // 找走廊与房间的交界点
  for (const r of rooms) {
    const doors = [];
    for (let y = r.y-1; y <= r.y+r.h; y++) {
      for (let x = r.x-1; x <= r.x+r.w; x++) {
        if (x<1||x>=MAP_W-1||y<1||y>=MAP_H-1) continue;
        if (tiles[y][x] !== TILE.FLOOR) continue;
        // 检查是否在房间边界上（旁边有墙的房间边缘）
        const inRoom = x>=r.x && x<r.x+r.w && y>=r.y && y<r.y+r.h;
        if (!inRoom) continue;
        // 这个地板格是否紧邻走廊？（检查四邻是否至少有一个在房间外且是地板）
        const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
        let corridorNeighbor = false;
        for (const [nx,ny] of neighbors) {
          if (nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
          const inRoom2 = nx>=r.x && nx<r.x+r.w && ny>=r.y && ny<r.y+r.h;
          if (!inRoom2 && tiles[ny][nx]===TILE.FLOOR) { corridorNeighbor=true; break; }
        }
        // 确保它至少有两边是墙（在房间开口处）
        if (corridorNeighbor) {
          let wallCount=0;
          for (const [nx,ny] of neighbors)
            if (nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&tiles[ny][nx]===TILE.WALL) wallCount++;
          if (wallCount>=2) doors.push({x,y});
        }
      }
    }
    // 标记前几个门
    for (let i=0; i<Math.min(doors.length,3); i++) {
      tiles[doors[i].y][doors[i].x] = TILE.DOOR;
    }
  }

  // ── 第五步：楼梯 ──
  tiles[rooms[0].cy][rooms[0].cx] = TILE.STAIRS_UP;
  tiles[rooms[8].cy][rooms[8].cx] = TILE.STAIRS_DOWN;

  // ── 第六步：生成怪物 ──
  const monsters = [];
  const pool = spawnPool(lvl);
  const nMon = ri(5, 10) + lvl * 2;
  for (let i = 0; i < nMon; i++) {
    const rm = rp(rooms.slice(1)); // 不在出生房间放怪
    const mx = ri(rm.x+1, rm.x+rm.w-2), my = ri(rm.y+1, rm.y+rm.h-2);
    if (tiles[my][mx] === TILE.FLOOR) {
      monsters.push({ id:uid(), key:rp(pool), x:mx, y:my, lvl, hp:0, maxHp:0, st:0, dx:0, xp:0, n:'', e:'', lastAct:0 });
    }
  }
  for (const m of monsters) {
    const t = MONSTERS[m.key];
    m.n=t.n; m.e=t.e;
    m.maxHp=t.hp+ri(-3,5); m.hp=m.maxHp;
    m.st=t.st; m.dx=t.dx; m.xp=t.xp;
  }

  // 复仇女神几率
  if (lvl>=3 && Math.random()<0.12) {
    const rm = rp(rooms.slice(-3));
    const nm = MONSTERS.nemesis;
    monsters.push({ id:uid(), key:'nemesis', x:rm.cx, y:rm.cy, lvl,
      n:nm.n, e:nm.e, hp:nm.hp+ri(0,25), maxHp:nm.hp+25, st:nm.st, dx:nm.dx, xp:nm.xp, lastAct:0 });
  }

  // ── 第七步：生成物品 ──
  const items = [];
  const nIt = ri(12, 22);
  for (let i = 0; i < nIt; i++) {
    const rm = rp(rooms);
    const ix = ri(rm.x+1, rm.x+rm.w-2), iy = ri(rm.y+1, rm.y+rm.h-2);
    if (tiles[iy][ix] === TILE.FLOOR) {
      const it = mkItem(ITEM_POOL(lvl), lvl, ix, iy);
      if (it) items.push(it);
    }
  }

  return { tiles, rooms, monsters, items, lvl, firstRoom:rooms[0], lastRoom:rooms[8] };
}

// ═══════════ 游戏服务器 ═══════════
class Game {
  constructor(io) {
    this.io = io;
    this.players = new Map();
    this.levels = new Map();
    this.sockets = new Map();
    this.nemesisDefeated = 0;
  }

  getLevel(n) {
    if (!this.levels.has(n)) this.levels.set(n, genDungeon(n));
    return this.levels.get(n);
  }

  // ─── 视野计算 ───
  updateSight(p) {
    if (!p.seenTiles) p.seenTiles = new Set();
    const lv = this.getLevel(p.level);
    if (!lv) return;

    for (let dy = -SIGHT; dy <= SIGHT; dy++) {
      for (let dx = -SIGHT; dx <= SIGHT; dx++) {
        if (Math.abs(dx)+Math.abs(dy) > SIGHT) continue; // 菱形视野
        const nx = p.x + dx, ny = p.y + dy;
        if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
        // 简单视线：检查两点间是否有墙
        if (this.hasLineOfSight(p.x, p.y, nx, ny, lv.tiles)) {
          p.seenTiles.add(key2(nx, ny));
        }
      }
    }
  }

  hasLineOfSight(x0, y0, x1, y1, tiles) {
    // Bresenham 视线检测
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0, cy = y0;
    while (true) {
      if (cx === x1 && cy === y1) return true;
      if (cx !== x0 || cy !== y0) {
        if (tiles[cy] && tiles[cy][cx] === TILE.WALL) return false;
      }
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx)  { err += dx; cy += sy; }
    }
    return true;
  }

  // ─── 玩家加入 ───
  addPlayer(socket, data) {
    const name = (data.name || '冒险者').slice(0,12);
    const cls = CLASSES[data.class] ? data.class : 'warrior';
    const tmpl = CLASSES[cls];
    const lv = this.getLevel(1);

    const p = {
      id: socket.id, name, cls, color: tmpl.color,
      str: tmpl.str, dex: tmpl.dex,
      hp: tmpl.hp, maxHp: tmpl.hp,
      lvl: 1, xp: 0, gold: 0, kills: 0, depth: 1,
      level: 1,
      x: lv.firstRoom.cx, y: lv.firstRoom.cy,
      alive: true, deathTime: 0, lastMove: 0,
      inv: [], weapon: null, armor: null, ring: null,
      resists: { 火焰:false, 冰霜:false, 毒素:false, 闪电:false, 酸:false },
      effects: [],
      seenTiles: new Set(),
    };

    // 初始装备
    if (tmpl.startWep) this.giveItem(p, mkItem(tmpl.startWep, 1));
    if (tmpl.startArm) this.giveItem(p, mkItem(tmpl.startArm, 1));
    this.giveItem(p, mkItem('ration', 1));
    this.giveItem(p, mkItem('bread', 1));

    // 初始视野
    this.updateSight(p);

    this.players.set(socket.id, p);
    this.sockets.set(socket.id, socket);

    socket.emit('welcome', { you: this.sanitizePlayer(p, true), map: lv.tiles, level:1 });
    this.sendLevelState(socket, 1, socket.id);
    this.broadcastLevel(1, socket.id);

    this.log(socket.id, `🎉 欢迎，${name}！你是第 ${this.players.size} 位冒险者。`);
    this.log(socket.id, '方向键/WASD 移动 | G 拾取 | E 吃 | I 背包 | > 下楼 | < 上楼');
    this.logToAll(`👋 ${name}（${tmpl.name} Lv1）进入了地牢。`);

    console.log(`[+] ${name} (${cls}) 加入。在线: ${this.players.size}`);
  }

  removePlayer(sid) {
    const p = this.players.get(sid);
    if (!p) return;
    if (p.alive) this.dropAllItems(p);
    const lvl = p.level;
    this.players.delete(sid);
    this.sockets.delete(sid);
    if (lvl) this.broadcastLevel(lvl);
    this.logToAll(`👋 ${p.name} 离开了地牢。`);
    console.log(`[-] ${p.name} 离开。在线: ${this.players.size}`);
  }

  respawn(p) {
    const lv = this.getLevel(p.level);
    p.alive = true;
    p.hp = p.maxHp;
    p.x = lv.firstRoom.cx;
    p.y = lv.firstRoom.cy;
    p.effects = [];
    p.gold = Math.floor(p.gold * 0.75);
    p.seenTiles = new Set();
    this.updateSight(p);
    this.log(p.id, '🔄 你已复活。失去了 25% 的金币。');
    this.broadcastLevel(p.level);
  }

  dropAllItems(p) {
    const lv = this.getLevel(p.level);
    for (const it of p.inv) { it.x = p.x; it.y = p.y; it.lv = p.level; lv.items.push(it); }
    if (p.weapon) { p.weapon.x = p.x; p.weapon.y = p.y; p.weapon.lv = p.level; lv.items.push(p.weapon); }
    if (p.armor)  { p.armor.x = p.x; p.armor.y = p.y; p.armor.lv = p.level; lv.items.push(p.armor); }
    if (p.ring)   { p.ring.x = p.x; p.ring.y = p.y; p.ring.lv = p.level; lv.items.push(p.ring); }
    p.inv = []; p.weapon = null; p.armor = null; p.ring = null;
  }

  giveItem(p, item) {
    if (!item) return;
    delete item.x; delete item.y; delete item.lv;
    if (item.cat === '武器' && !p.weapon) { p.weapon = item; }
    else if (item.cat === '护甲' && !p.armor) { p.armor = item; }
    else if (item.cat === '戒指' && !p.ring) { p.ring = item; }
    else { p.inv.push(item); }
  }

  // ─── 回合制：玩家行动 → 怪物反应 ───
  playerActed(sid) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    this.updateSight(p);
    this.enemyTurn(sid);
    this.syncPlayer(sid);
  }

  enemyTurn(sid) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    const lv = this.getLevel(p.level);
    if (!lv || !lv.monsters) return;
    const now = Date.now();

    for (const mon of lv.monsters) {
      if (mon.hp <= 0) continue;
      if (now - (mon.lastAct||0) < 400) continue;
      const d = dist(mon.x, mon.y, p.x, p.y);
      if (d > SIGHT+2) continue;

      if (d <= 1) {
        this.monsterHits(mon, p);
        mon.lastAct = now;
      } else if (d <= SIGHT+2) {
        this.chaseMonster(mon, p, lv, now);
      }
    }

    lv.monsters = lv.monsters.filter(m => m.hp > 0);

    // 临时效果倒计时
    for (let i = p.effects.length - 1; i >= 0; i--) {
      p.effects[i].trn--;
      if (p.effects[i].trn <= 0) p.effects.splice(i, 1);
    }

    // 再生效果
    if (p.ring && p.ring.ring === 'regen' && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 1);
    const regen = p.effects.find(e=>e.type==='regen');
    if (regen && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 2);

    // 复活
    if (!p.alive && p.deathTime && now - p.deathTime > RESPAWN_MS) this.respawn(p);

    this.broadcastLevel(p.level);
  }

  chaseMonster(mon, target, lv, now) {
    const dx = Math.sign(target.x - mon.x);
    const dy = Math.sign(target.y - mon.y);
    const xFirst = Math.abs(target.x - mon.x) > Math.abs(target.y - mon.y);
    const moves = xFirst ? [{x:dx,y:0},{x:0,y:dy}] : [{x:0,y:dy},{x:dx,y:0}];

    for (const m of moves) {
      const nx = mon.x + m.x, ny = mon.y + m.y;
      if (target.x === nx && target.y === ny) { this.monsterHits(mon, target); mon.lastAct = now; return; }
      if (this.canStand(nx, ny, lv)) { mon.x = nx; mon.y = ny; mon.lastAct = now; return; }
    }
  }

  // ─── 玩家移动 ───
  movePlayer(sid, dx, dy) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    if (Date.now() - p.lastMove < MOVE_CD) return;
    p.lastMove = Date.now();

    const nx = p.x + dx, ny = p.y + dy;
    const lv = this.getLevel(p.level);

    if (nx<0||nx>=MAP_W||ny<0||ny>=MAP_H||lv.tiles[ny][nx]===TILE.WALL) {
      const mon = lv.monsters.find(m=>m.hp>0 && m.x===nx && m.y===ny);
      if (mon) this.playerHits(p, mon, lv);
      this.playerActed(sid);
      return;
    }

    const mon = lv.monsters.find(m=>m.hp>0 && m.x===nx && m.y===ny);
    if (mon) { this.playerHits(p, mon, lv); this.playerActed(sid); return; }

    for (const [oid, op] of this.players) {
      if (oid !== sid && op.alive && op.level === p.level && op.x === nx && op.y === ny) return;
    }

    p.x = nx; p.y = ny;

    const here = lv.items.filter(it=>it.x===nx&&it.y===ny);
    if (here.length) this.log(sid, `📦 地上有：${here.map(i=>i.n).join('、')}。按 G 拾取。`);

    if (lv.tiles[ny][nx] === TILE.STAIRS_DOWN) this.log(sid, '⬇️ 这里有向下的楼梯。按 > 下楼。');
    if (lv.tiles[ny][nx] === TILE.STAIRS_UP) this.log(sid, '⬆️ 这里有向上的楼梯。按 < 上楼。');

    this.playerActed(sid);
  }

  // ─── 战斗 ───
  playerHits(p, mon, lv) {
    const wepDmg = p.weapon ? p.weapon.dmg : '1d2';
    const wepAtk = p.weapon ? (p.weapon.atk||0) : 0;
    const atk = p.str + wepAtk;
    const def = mon.dx;
    const hitChance = atk / (atk + def + 1);
    const crit = p.cls === 'rogue' ? Math.random() < 0.28 : Math.random() < 0.15;

    if (Math.random() < hitChance) {
      let dmg = roll(wepDmg) + Math.floor(p.str/4);
      if (crit) { dmg = Math.floor(dmg * 2); this.log(p.id, '💥 暴击！'); }
      const breath = p.effects.find(e=>e.type==='breath');
      if (breath) { dmg += ri(8,18); this.log(p.id, '🔥 火焰吐息！'); }
      mon.hp -= dmg;
      this.log(p.id, `⚔️ 你对${mon.n}造成了 ${dmg} 点伤害。`);
      if (mon.hp <= 0) this.killMonster(mon, p, lv);
    } else {
      this.log(p.id, `💨 你没能击中${mon.n}。`);
    }
    this.broadcastLevel(p.level);
  }

  killMonster(mon, killer, lv) {
    killer.xp += mon.xp;
    killer.kills++;
    const goldDrop = ri(Math.floor(mon.xp/2), mon.xp*2);
    killer.gold += goldDrop;

    const corpse = { id:uid(), cat:'尸体', key:mon.key, n:`${mon.n}尸体`, e:'🍖', nut:400+ri(0,300), x:mon.x, y:mon.y, lv:mon.lvl };
    lv.items.push(corpse);

    if (Math.random() < 0.45) {
      const loot = mkItem(ITEM_POOL(mon.lvl), mon.lvl, mon.x, mon.y);
      if (loot) lv.items.push(loot);
    }

    this.log(killer.id, `💀 你击杀了${mon.n}！(+${mon.xp} 经验, +${goldDrop} 金币)`);

    const needXp = killer.lvl * 140;
    if (killer.xp >= needXp) {
      killer.lvl++;
      killer.maxHp += ri(3,8);
      killer.hp = killer.maxHp;
      killer.str += Math.random()<0.5?1:0;
      killer.dex += Math.random()<0.5?1:0;
      killer.xp -= needXp;
      this.log(killer.id, `🎆 升 级！你现在是 ${killer.lvl} 级了！生命和属性提升！`);
      this.logToAll(`🎆 ${killer.name} 升到了 ${killer.lvl} 级！`);
    }

    if (mon.key === 'nemesis') {
      this.nemesisDefeated++;
      this.logToAll(`🏆 ${killer.name} 击败了复仇女神！（已被击败 ${this.nemesisDefeated} 次）`);
    }
  }

  monsterHits(mon, p) {
    const atk = mon.st;
    const def = p.dex + (p.armor?(p.armor.def||0):0);
    const hitChance = atk / (atk + def + 1);

    if (Math.random() < hitChance) {
      let dmg = ri(1, mon.st) + Math.floor(mon.st/4);
      if (mon.key==='dragon' && Math.random()<0.3) { dmg+=ri(5,16); this.log(p.id,'🔥 火龙喷出烈焰！'); }
      if (mon.key==='nemesis' && Math.random()<0.2) { dmg+=ri(10,28); this.log(p.id,'💀 复仇女神释放了暗黑能量！'); }
      if (p.armor) dmg = Math.max(1, dmg - (p.armor.def||0));
      if (p.resists && p.resists['火焰'] && (mon.key==='dragon')) dmg = Math.floor(dmg/2);
      p.hp -= dmg;
      this.log(p.id, `👊 ${mon.n}对你造成了 ${dmg} 点伤害！`);
      if (p.hp <= 0) this.killPlayer(p, mon);
    }
  }

  killPlayer(p, killer) {
    p.alive = false;
    p.hp = 0;
    p.deathTime = Date.now();
    this.dropAllItems(p);
    this.log(p.id, `💀 你被${killer?killer.n:'未知力量'}杀死了！${RESPAWN_MS/1000}秒后复活……`);
    this.logToAll(`💀 ${p.name}（Lv${p.lvl}）被${killer?killer.n:'未知力量'}击败。`);
    this.broadcastLevel(p.level);
  }

  // ─── 物品操作 ───
  pickupItem(sid) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    const lv = this.getLevel(p.level);
    const here = lv.items.filter(it=>it.x===p.x&&it.y===p.y);
    if (!here.length) { this.log(sid, '这里什么都没有。'); return; }

    const it = here[0];
    lv.items = lv.items.filter(i=>i.id!==it.id);
    this.giveItem(p, it);
    this.log(sid, `✅ 拾取：${it.n}。`);
    this.playerActed(sid);
  }

  eatItem(sid, invIdx) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    const lv = this.getLevel(p.level);

    if (invIdx === undefined || invIdx === null) {
      const groundFood = lv.items.find(it=>it.x===p.x&&it.y===p.y&&(it.cat==='食物'||it.cat==='尸体'));
      if (groundFood) { lv.items = lv.items.filter(i=>i.id!==groundFood.id); this.applyEat(p, groundFood); this.playerActed(sid); return; }
      const food = p.inv.find(it=>it.cat==='食物'||it.cat==='尸体');
      if (food) { p.inv = p.inv.filter(i=>i.id!==food.id); this.applyEat(p, food); this.playerActed(sid); return; }
      this.log(sid, '地上和背包里都没有可吃的东西。');
      return;
    }

    if (invIdx >= 0 && invIdx < p.inv.length) {
      const it = p.inv[invIdx];
      p.inv.splice(invIdx, 1);
      this.applyEat(p, it);
      this.playerActed(sid);
    }
  }

  applyEat(p, item) {
    if (item.cat === '食物') {
      const heal = item.heal||0;
      if (heal) p.hp = Math.min(p.maxHp, p.hp+heal);
      this.log(p.id, `🍽️ 你吃掉了${item.n}。${heal?'(+'+heal+' HP)':''}`);
    } else if (item.cat === '尸体') {
      p.hp = Math.min(p.maxHp, p.hp+ri(4,12));
      const fx = CORPSE_FX[item.key];
      if (fx) for (const f of fx) {
        if (f.pct && Math.random()>f.pct) continue;
        switch(f.t){
          case 'heal': p.hp=Math.min(p.maxHp,p.hp+f.v); break;
          case 'resist': if(f.res==='全') Object.keys(p.resists).forEach(k=>p.resists[k]=true); else p.resists[f.res]=true; break;
          case 'temp': p.effects.push({stat:f.stat,v:f.v,trn:f.trn}); break;
          case 'perm': p[f.stat]+=f.v; break;
          case 'regen': p.effects.push({type:'regen',trn:f.trn}); break;
          case 'breath': p.effects.push({type:'breath',trn:f.trn}); break;
          case 'sick': p.hp-=ri(3,8); if(p.hp<=0) p.hp=1; break;
        }
        if(f.msg) this.log(p.id, f.msg);
      }
      this.log(p.id, `🍖 你吞下了${item.n}。`);
    } else {
      p.hp -= ri(2,6);
      if (p.hp <= 0) p.hp = 1;
      this.log(p.id, `🤢 你吃了${item.n}……这不是个好主意。（-HP）`);
    }
  }

  useItem(sid, invIdx) {
    const p = this.players.get(sid);
    if (!p||!p.alive||invIdx<0||invIdx>=p.inv.length) return;
    const it = p.inv[invIdx];

    switch(it.cat){
      case '药水':
        p.inv.splice(invIdx,1);
        if(it.fx==='heal'){ p.hp=Math.min(p.maxHp,p.hp+(it.v||25)); this.log(sid,`🧪 喝下${it.n}。+${it.v||25} HP！`); }
        else if(it.fx==='str'){ p.str+=1; this.log(sid,`💪 喝下${it.n}。力量 +1！（${p.str}）`); }
        else if(it.fx==='dex'){ p.dex+=1; this.log(sid,`💨 喝下${it.n}。敏捷 +1！（${p.dex}）`); }
        break;
      case '卷轴':
        p.inv.splice(invIdx,1);
        if(it.fx==='tele'){ const lv=this.getLevel(p.level); const rm=rp(lv.rooms); p.x=rm.cx; p.y=rm.cy; this.log(sid,'✨ 你被传送了！'); }
        else if(it.fx==='ewep'&&p.weapon){ p.weapon.atk=(p.weapon.atk||0)+1; this.log(sid,'⚔️ 武器发出光芒！攻击力 +1'); }
        else if(it.fx==='earm'&&p.armor){ p.armor.def=(p.armor.def||0)+1; this.log(sid,'🛡️ 护甲变得更加坚固！防御 +1'); }
        else if(it.fx==='fire'){ const lv=this.getLevel(p.level); lv.monsters.forEach(m=>{if(dist(m.x,m.y,p.x,p.y)<=3){m.hp-=ri(12,28);this.log(sid,`🔥 火球击中了${m.n}！`);}}); lv.monsters=lv.monsters.filter(m=>m.hp>0); }
        break;
      default: this.log(sid, `无法直接使用${it.n}。`); return;
    }
    this.playerActed(sid);
  }

  equipItem(sid, invIdx) {
    const p = this.players.get(sid);
    if (!p||!p.alive||invIdx<0||invIdx>=p.inv.length) return;
    const it = p.inv[invIdx];
    if (it.cat !== '武器' && it.cat !== '护甲' && it.cat !== '戒指') { this.log(sid, `无法装备${it.n}。`); return; }
    p.inv.splice(invIdx, 1);
    let old = null;
    if (it.cat==='武器') { old=p.weapon; p.weapon=it; }
    else if (it.cat==='护甲') { old=p.armor; p.armor=it; }
    else if (it.cat==='戒指') { old=p.ring; p.ring=it; }
    if (old) p.inv.push(old);
    this.log(sid, `⚔️ 装备了：${it.n}。`);
    this.playerActed(sid);
  }

  dropItem(sid, invIdx) {
    const p = this.players.get(sid);
    if (!p||!p.alive||invIdx<0||invIdx>=p.inv.length) return;
    const it = p.inv.splice(invIdx,1)[0];
    const lv = this.getLevel(p.level);
    it.x=p.x; it.y=p.y; it.lv=p.level;
    lv.items.push(it);
    this.log(sid, `🗑️ 丢弃了：${it.n}。`);
    this.playerActed(sid);
  }

  unequip(sid, slot) {
    const p = this.players.get(sid);
    if (!p||!p.alive) return;
    let item = null;
    if (slot==='weapon'){ item=p.weapon; p.weapon=null; }
    else if(slot==='armor'){ item=p.armor; p.armor=null; }
    else if(slot==='ring'){ item=p.ring; p.ring=null; }
    if(item){ p.inv.push(item); this.log(sid,`卸下了：${item.n}。`); }
    this.playerActed(sid);
  }

  // ─── 楼层切换 ───
  changeLevel(sid, dir) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    const lv = this.getLevel(p.level);
    const tile = lv.tiles[p.y][p.x];

    if (dir==='down' && tile===TILE.STAIRS_DOWN) {
      p.level++; p.depth=Math.max(p.depth,p.level);
      const nl = this.getLevel(p.level);
      p.x=nl.firstRoom.cx; p.y=nl.firstRoom.cy;
      p.seenTiles = new Set();
      this.updateSight(p);
      this.log(sid, `⬇️ 你下到了第 ${p.level} 层。`);
      this.broadcastLevel(p.level-1);
      const sock = this.sockets.get(sid);
      if(sock) sock.emit('newLevel', { map:nl.tiles, level:p.level, seenTiles:[] });
      this.broadcastLevel(p.level);
      this.logToAll(`⬇️ ${p.name} 下到了第 ${p.level} 层。`);
    } else if (dir==='up' && tile===TILE.STAIRS_UP && p.level>1) {
      p.level--;
      const nl = this.getLevel(p.level);
      p.x=nl.lastRoom.cx; p.y=nl.lastRoom.cy;
      p.seenTiles = new Set();
      this.updateSight(p);
      this.log(sid, `⬆️ 你上到了第 ${p.level} 层。`);
      this.broadcastLevel(p.level+1);
      const sock = this.sockets.get(sid);
      if(sock) sock.emit('newLevel', { map:nl.tiles, level:p.level, seenTiles:[] });
      this.broadcastLevel(p.level);
      this.logToAll(`⬆️ ${p.name} 上到了第 ${p.level} 层。`);
    } else {
      this.log(sid, '这里没有楼梯。');
      return;
    }
    this.playerActed(sid);
  }

  // ─── 聊天 ───
  chat(sid, msg) {
    const p = this.players.get(sid);
    if (!p || !msg.trim()) return;
    this.io.emit('chat', { from:p.name, cls:p.cls, color:p.color, msg:msg.trim().slice(0,150) });
  }

  // ─── 网络通信 ───
  sendLevelState(sock, lvlNum) {
    if (!sock || !lvlNum) return;
    const lv = this.getLevel(lvlNum);
    if (!lv) return;
    const playersOnLevel = [...this.players.values()]
      .filter(p=>p.alive&&p.level===lvlNum)
      .map(p=>this.sanitizePlayer(p, false));
    sock.emit('gameState', {
      players: playersOnLevel,
      monsters: lv.monsters.filter(m=>m.hp>0).map(m=>({id:m.id,key:m.key,n:m.n,e:m.e,hp:m.hp,maxHp:m.maxHp,x:m.x,y:m.y})),
      items: lv.items.map(i=>({id:i.id,key:i.key||'',cat:i.cat,n:i.n,e:i.e||'📦',x:i.x,y:i.y})),
      level: lvlNum,
    });
  }

  syncPlayer(sid) {
    const p = this.players.get(sid);
    const sock = this.sockets.get(sid);
    if (p && sock) sock.emit('syncPlayer', this.sanitizePlayer(p, true));
  }

  broadcastLevel(lvlNum, excludeSid) {
    if (!lvlNum) return;
    const lv = this.getLevel(lvlNum);
    if (!lv) return;
    const playersOnLevel = [...this.players.values()]
      .filter(p=>p.alive&&p.level===lvlNum)
      .map(p=>this.sanitizePlayer(p, false));

    const state = {
      players: playersOnLevel,
      monsters: lv.monsters.filter(m=>m.hp>0).map(m=>({id:m.id,key:m.key,n:m.n,e:m.e,hp:m.hp,maxHp:m.maxHp,x:m.x,y:m.y})),
      items: lv.items.map(i=>({id:i.id,key:i.key||'',cat:i.cat,n:i.n,e:i.e||'📦',x:i.x,y:i.y})),
      level: lvlNum,
    };

    for (const [sid, p] of this.players) {
      if (p.level !== lvlNum) continue;
      if (sid === excludeSid) continue;
      const sock = this.sockets.get(sid);
      if (sock) sock.emit('gameState', state);
    }
  }

  sanitizePlayer(p, full) {
    const base = {
      id:p.id, name:p.name, cls:p.cls, color:p.color,
      lvl:p.lvl, hp:p.hp, maxHp:p.maxHp,
      str:p.str, dex:p.dex, gold:p.gold,
      x:p.x, y:p.y, alive:p.alive, kills:p.kills, depth:p.depth,
      wpn:p.weapon?{n:p.weapon.n,e:p.weapon.e,atk:p.weapon.atk||0,dmg:p.weapon.dmg}:null,
      arm:p.armor?{n:p.armor.n,e:p.armor.e,def:p.armor.def||0}:null,
      rng:p.ring?{n:p.ring.n,e:p.ring.e,ring:p.ring.ring,v:p.ring.v}:null,
    };
    if (full) {
      base.inv = p.inv.map(i=>({id:i.id,key:i.key,cat:i.cat,n:i.n,e:i.e||'📦',dmg:i.dmg,atk:i.atk,def:i.def,fx:i.fx,ring:i.ring,nut:i.nut,heal:i.heal}));
      base.effects = p.effects;
      base.resists = p.resists;
      base.xp = p.xp;
      base.weapon = p.weapon;
      base.armor = p.armor;
      base.ring = p.ring;
      base.seenTiles = p.seenTiles ? [...p.seenTiles] : [];
    }
    return base;
  }

  log(sid, msg) {
    const sock = this.sockets.get(sid);
    if (sock) sock.emit('log', { msg, time: Date.now() });
  }

  logToAll(msg) {
    this.io.emit('log', { msg, time: Date.now(), global: true });
  }

  heartbeat() {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.alive && p.deathTime && now - p.deathTime > RESPAWN_MS) this.respawn(p);
      const regen = p.effects.find(e=>e.type==='regen');
      if (regen && p.alive && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 2);
    }
    const activeLevels = new Set();
    for (const p of this.players.values()) { if (p.alive) activeLevels.add(p.level); }
    for (const lvl of activeLevels) this.broadcastLevel(lvl);
  }
}

// ═══════════ 服务器启动 ═══════════
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  pingTimeout: 30000, pingInterval: 12000,
  maxHttpBufferSize: 1e6, allowEIO3: true,
});

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health', (req, res) => res.status(200).send('ok'));

const game = new Game(io);

function safe(sid, fn) {
  try { fn(); } catch(e) { console.error(`[ERROR] ${sid}:`, e.message); try { game.log(sid, '⚠️ 服务器出错，请重试。'); } catch(_){} }
}

io.on('connection', socket => {
  const sid = socket.id;
  console.log(`[~] 连接: ${sid}`);

  socket.on('join',   data       => safe(sid, () => game.addPlayer(socket, data)));
  socket.on('move',   data       => safe(sid, () => game.movePlayer(sid, (data&&data.dx)||0, (data&&data.dy)||0)));
  socket.on('pickup', ()         => safe(sid, () => game.pickupItem(sid)));
  socket.on('use',    data       => safe(sid, () => game.useItem(sid, data&&data.idx)));
  socket.on('equip',  data       => safe(sid, () => game.equipItem(sid, data&&data.idx)));
  socket.on('drop',   data       => safe(sid, () => game.dropItem(sid, data&&data.idx)));
  socket.on('eat',    data       => safe(sid, () => game.eatItem(sid, data&&data.idx)));
  socket.on('unequip',data       => safe(sid, () => game.unequip(sid, data&&data.slot)));
  socket.on('descend',()         => safe(sid, () => game.changeLevel(sid, 'down')));
  socket.on('ascend', ()         => safe(sid, () => game.changeLevel(sid, 'up')));
  socket.on('chat',   data       => safe(sid, () => game.chat(sid, data&&data.msg)));
  socket.on('disconnect',()      => safe(sid, () => game.removePlayer(sid)));
  socket.on('error', err => console.error(`[SOCKET] ${sid}:`, err.message));
});

setInterval(() => { try { game.heartbeat(); } catch(e) { console.error('[HEARTBEAT]', e.message); } }, 2000);

process.on('uncaughtException', err => console.error('[FATAL]', err.message, err.stack));
process.on('unhandledRejection', reason => console.error('[FATAL] Promise:', reason));
process.on('SIGTERM', () => { console.log('[SHUTDOWN]'); server.close(() => process.exit(0)); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════');
  console.log('  🏰 Pathos 在线 — 九宫格地牢 · 战争迷雾');
  console.log(`  监听: 0.0.0.0:${PORT}`);
  console.log('═══════════════════════════════════════');
});
