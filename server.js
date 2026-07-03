'use strict';

// ═══════════════════════════════════════════════
//  Pathos Online — Multiplayer Roguelike Server
// ═══════════════════════════════════════════════

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ═══════════ CONSTANTS ═══════════
const TILE   = { WALL:0, FLOOR:1, STAIRS_UP:2, STAIRS_DOWN:3 };
const MAP_W  = 80,  MAP_H = 50;
const TICK   = 300;           // ms per game tick
const MOVE_CD = 100;           // move cooldown (ms)
const SIGHT  = 10;            // monster sight range
const RESPAWN_MS = 3500;      // respawn delay

// ═══════════ HELPERS ═══════════
const ri  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const rp  = arr => arr[Math.floor(Math.random()*arr.length)];
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const dist = (x1,y1,x2,y2) => Math.abs(x2-x1)+Math.abs(y2-y1);
const roll = d => { let [n,s]=d.split('d'),t=0; for(let i=0;i<+n;i++) t+=ri(1,+s); return t; };

// ═══════════ CLASSES ═══════════
const CLASSES = {
  warrior: { name:'Warrior', str:16, dex:10, hp:35, color:'#FF6B6B', startWep:'shortSword', startArm:'leatherArmor' },
  wizard:  { name:'Wizard',  str:8,  dex:12, hp:20, color:'#6B9BFF', startWep:'dagger',     startArm:null },
  rogue:   { name:'Rogue',   str:12, dex:17, hp:25, color:'#6BFF6B', startWep:'shortSword', startArm:null },
};

// ═══════════ MONSTERS ═══════════
const MONSTERS = {
  goblin:   { n:'Goblin',    c:'g', col:'#CD853F', hp:8,  st:8,  dx:10, xp:10,  ml:1 },
  giantRat: { n:'Giant Rat', c:'r', col:'#A0522D', hp:5,  st:6,  dx:14, xp:5,   ml:1 },
  bat:      { n:'Giant Bat', c:'b', col:'#9370DB', hp:6,  st:5,  dx:16, xp:7,   ml:1 },
  skeleton: { n:'Skeleton',  c:'s', col:'#F5F5DC', hp:12, st:10, dx:8,  xp:15,  ml:2 },
  orc:      { n:'Orc',       c:'o', col:'#556B2F', hp:16, st:14, dx:9,  xp:25,  ml:2 },
  slime:    { n:'Slime',     c:'j', col:'#32CD32', hp:10, st:5,  dx:4,  xp:10,  ml:2 },
  troll:    { n:'Troll',     c:'T', col:'#006400', hp:30, st:17, dx:7,  xp:80,  ml:3 },
  wraith:   { n:'Wraith',    c:'W', col:'#4B0082', hp:20, st:12, dx:14, xp:60,  ml:3 },
  dragon:   { n:'Dragon',    c:'D', col:'#FF4500', hp:50, st:22, dx:10, xp:300, ml:5 },
  nemesis:  { n:'Nemesis',   c:'N', col:'#FF00FF', hp:80, st:26, dx:16, xp:1000,ml:6 },
};

function spawnPool(lvl) {
  const p = [];
  for (const [k,m] of Object.entries(MONSTERS)) {
    if (m.ml > lvl) continue;
    const wt = k==='nemesis'?1 : k==='dragon'?2 : k==='troll'||k==='wraith'?4 : 8;
    for (let i=0;i<wt;i++) p.push(k);
  }
  return p;
}

// Corpse eating effects (signature Pathos mechanic)
const CORPSE_FX = {
  goblin:   [{ t:'heal',v:6,  msg:'Tastes foul, but restores a few HP.' }],
  giantRat: [{ t:'sick',pct:0.3,msg:'You feel nauseous...' },{ t:'resist',res:'poison',pct:0.12,msg:'Your blood tingles — poison resistance gained!' }],
  bat:      [{ t:'temp',stat:'dex',v:2,trn:40,msg:'Bat essence makes you quicker!' }],
  skeleton: [{ t:'nothing',msg:'Crunchy dust. Tasteless.' }],
  orc:      [{ t:'temp',stat:'str',v:2,trn:40,msg:'Orcish might flows through you!' }],
  slime:    [{ t:'sick',pct:0.4,msg:'Slime churns your stomach!' },{ t:'resist',res:'acid',pct:0.12,msg:'Your skin hardens — acid resistance!' }],
  troll:    [{ t:'regen',trn:35,msg:'You feel your wounds knitting!' }],
  wraith:   [{ t:'sick',pct:0.3,msg:'Dark essence sickens you!' },{ t:'perm',stat:'str',v:1,pct:0.08,msg:'You permanently absorb wraith power!' }],
  dragon:   [{ t:'resist',res:'fire',pct:0.45,msg:'Fire cannot harm you now!' },{ t:'breath',trn:20,msg:'You can breathe fire!' }],
  nemesis:  [{ t:'perm',stat:'str',v:2,pct:0.6,msg:'Nemesis essence empowers you forever!' },{ t:'resist',res:'all',pct:0.5,msg:'Ultimate resistance!' }],
};

// ═══════════ ITEMS ═══════════
const ITEMS = {
  dagger:       { cat:'WEAPON', n:'Dagger',        c:')',col:'#C0C0C0',dmg:'1d4', atk:1 },
  shortSword:   { cat:'WEAPON', n:'Short Sword',   c:')',col:'#C0C0C0',dmg:'1d6', atk:2 },
  longSword:    { cat:'WEAPON', n:'Long Sword',    c:')',col:'#FFD700',dmg:'1d8', atk:3 },
  battleAxe:    { cat:'WEAPON', n:'Battle Axe',    c:')',col:'#FFD700',dmg:'1d10',atk:3 },
  magicStaff:   { cat:'WEAPON', n:'Magic Staff',   c:')',col:'#9370DB',dmg:'2d6', atk:5 },
  leatherArmor: { cat:'ARMOR',  n:'Leather Armor', c:'[',col:'#8B4513',def:2 },
  chainmail:    { cat:'ARMOR',  n:'Chainmail',     c:'[',col:'#C0C0C0',def:4 },
  plateMail:    { cat:'ARMOR',  n:'Plate Mail',    c:'[',col:'#FFD700',def:6 },
  dragonScale:  { cat:'ARMOR',  n:'Dragon Scale',  c:'[',col:'#FF6347',def:8 },
  healPotion:   { cat:'POTION', n:'Healing Potion',  c:'!',col:'#FF69B4',fx:'heal',v:20 },
  fullHeal:     { cat:'POTION', n:'Full Healing',    c:'!',col:'#FF1493',fx:'heal',v:999 },
  strPotion:    { cat:'POTION', n:'Str Potion',      c:'!',col:'#FF0000',fx:'str' },
  dexPotion:    { cat:'POTION', n:'Dex Potion',      c:'!',col:'#00FF00',fx:'dex' },
  teleScroll:   { cat:'SCROLL', n:'Teleport Scroll', c:'?',col:'#87CEEB',fx:'tele' },
  enchWep:      { cat:'SCROLL', n:'Enchant Weapon',  c:'?',col:'#FFD700',fx:'ewep' },
  enchArm:      { cat:'SCROLL', n:'Enchant Armor',   c:'?',col:'#FFD700',fx:'earm' },
  fireScroll:   { cat:'SCROLL', n:'Fire Scroll',     c:'?',col:'#FF4500',fx:'fire' },
  ration:       { cat:'FOOD',   n:'Ration',        c:'%',col:'#DEB887',nut:800 },
  apple:        { cat:'FOOD',   n:'Apple',         c:'%',col:'#FF0000',nut:150,heal:5 },
  bread:        { cat:'FOOD',   n:'Bread',         c:'%',col:'#F4A460',nut:400 },
  ringStr:      { cat:'RING',   n:'Ring of Strength',  c:'=',col:'#FF4444',ring:'str',v:2 },
  ringDex:      { cat:'RING',   n:'Ring of Dexterity', c:'=',col:'#44FF44',ring:'dex',v:2 },
  ringProt:     { cat:'RING',   n:'Ring of Protection',c:'=',col:'#FFD700',ring:'def',v:2 },
  ringRegen:    { cat:'RING',   n:'Ring of Regen',     c:'=',col:'#FF69B4',ring:'regen',v:1 },
};

function mkItem(key, lv, x, y) {
  const t = ITEMS[key]; if (!t) return null;
  return { id:uid(), key, ...JSON.parse(JSON.stringify(t)), lv, x, y };
}

// Item quality by dungeon level
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

// ═══════════ DUNGEON GENERATOR ═══════════
function genDungeon(lvl) {
  const tiles = Array.from({length:MAP_H},()=>Array.from({length:MAP_W},()=>TILE.WALL));
  const rooms = [];
  const goal = ri(15,24);

  for(let t=0; t<500 && rooms.length<goal; t++){
    const w=ri(4,9), h=ri(4,7);
    const x=ri(2,MAP_W-w-2), y=ri(2,MAP_H-h-2);
    let bad=false;
    for(let ry=y-1;ry<=y+h && !bad;ry++)
      for(let rx=x-1;rx<=x+w && !bad;rx++)
        if(tiles[ry]&&tiles[ry][rx]===TILE.FLOOR) bad=true;
    if(bad) continue;
    for(let ry=y;ry<y+h;ry++)
      for(let rx=x;rx<x+w;rx++)
        tiles[ry][rx]=TILE.FLOOR;
    rooms.push({x,y,w,h,cx:Math.floor(x+w/2),cy:Math.floor(y+h/2)});
  }

  for(let i=1;i<rooms.length;i++){
    let cx=rooms[i-1].cx, cy=rooms[i-1].cy;
    const tx=rooms[i].cx, ty=rooms[i].cy;
    if(Math.random()<0.5){
      while(cx!==tx){ cx+=cx<tx?1:-1; if(tiles[cy]) tiles[cy][cx]=TILE.FLOOR; }
      while(cy!==ty){ cy+=cy<ty?1:-1; if(tiles[cy]) tiles[cy][cx]=TILE.FLOOR; }
    }else{
      while(cy!==ty){ cy+=cy<ty?1:-1; if(tiles[cy]) tiles[cy][cx]=TILE.FLOOR; }
      while(cx!==tx){ cx+=cx<tx?1:-1; if(tiles[cy]) tiles[cy][cx]=TILE.FLOOR; }
    }
  }

  tiles[rooms[0].cy][rooms[0].cx] = TILE.STAIRS_UP;
  tiles[rooms[rooms.length-1].cy][rooms[rooms.length-1].cx] = TILE.STAIRS_DOWN;

  // Place monsters
  const monsters = [];
  const pool = spawnPool(lvl);
  const nMon = ri(8,14)+lvl*2;
  for(let i=0;i<nMon;i++){
    const rm = rp(rooms.slice(1));
    monsters.push({ id:uid(), key:rp(pool), x:ri(rm.x,rm.x+rm.w-1), y:ri(rm.y,rm.y+rm.h-1), lvl,
      hp:0, maxHp:0, st:0, dx:0, xp:0, n:'', c:'', col:'' });
  }
  // Init monster stats from template
  for(const m of monsters){
    const t = MONSTERS[m.key];
    m.n=t.n; m.c=t.c; m.col=t.col;
    m.maxHp=t.hp+ri(-3,5); m.hp=m.maxHp;
    m.st=t.st; m.dx=t.dx; m.xp=t.xp;
  }

  // Nemesis chance
  if(lvl>=3 && Math.random()<0.15){
    const rm = rp(rooms.slice(-3));
    const nm = MONSTERS.nemesis;
    monsters.push({ id:uid(), key:'nemesis', x:rm.cx, y:rm.cy, lvl,
      n:nm.n, c:nm.c, col:nm.col, hp:nm.hp+ri(0,20), maxHp:nm.hp+20, st:nm.st, dx:nm.dx, xp:nm.xp });
  }

  // Place items
  const items = [];
  const nIt = ri(10,20);
  for(let i=0;i<nIt;i++){
    const rm = rp(rooms);
    const it = mkItem(ITEM_POOL(lvl), lvl, ri(rm.x,rm.x+rm.w-1), ri(rm.y,rm.y+rm.h-1));
    if(it) items.push(it);
  }

  return { tiles, rooms, monsters, items, lvl, firstRoom:rooms[0], lastRoom:rooms[rooms.length-1] };
}

// ═══════════ GAME SERVER ═══════════
class Game {
  constructor(io) {
    this.io = io;
    this.players = new Map();     // socketId → Player
    this.levels = new Map();      // levelNum → LevelState
    this.sockets = new Map();     // socketId → Socket
    this.logQueue = [];           // messages to broadcast this tick
    this.nemesisDefeated = 0;     // times nemesis killed (grows stronger)
  }

  getLevel(n) {
    if (!this.levels.has(n)) this.levels.set(n, genDungeon(n));
    return this.levels.get(n);
  }

  // ─── Player lifecycle ───
  addPlayer(socket, data) {
    const name = (data.name || 'Adventurer').slice(0,16);
    const cls = CLASSES[data.class] ? data.class : 'warrior';
    const tmpl = CLASSES[cls];
    const lv = this.getLevel(1);

    const p = {
      id: socket.id, name, cls, color: tmpl.color,
      str: tmpl.str, dex: tmpl.dex,
      hp: tmpl.hp, maxHp: tmpl.hp,
      lvl: 1, xp: 0, gold: 0, kills: 0, depth: 1,
      level: 1, // current dungeon level
      x: lv.firstRoom.cx, y: lv.firstRoom.cy,
      alive: true, deathTime: 0, lastMove: 0,
      inv: [], weapon: null, armor: null, ring: null,
      resists: { fire:false, cold:false, poison:false, lightning:false, acid:false },
      effects: [], // temporary effects [{type,stat,val,trn}...]
    };

    // Starting equipment
    if (tmpl.startWep) this.giveItem(p, mkItem(tmpl.startWep, 1));
    if (tmpl.startArm) this.giveItem(p, mkItem(tmpl.startArm, 1));
    // Always give some food
    this.giveItem(p, mkItem('ration', 1));
    this.giveItem(p, mkItem('apple', 1));

    this.players.set(socket.id, p);
    this.sockets.set(socket.id, socket);

    socket.emit('welcome', { you: this.sanitizePlayer(p, true), map: lv.tiles, level:1 });
    // Send current game state to the new player too
    this.sendLevelState(socket, 1, socket.id);
    this.broadcastLevel(1, socket.id);
    this.log(socket.id, `Welcome, ${name} the ${tmpl.name}! (Arrows/WASD move, G=pickup, E=eat, I=inventory, >=stairs)`);
    this.logToAll(`${name} the ${tmpl.name} entered the dungeon.`);

    console.log(`[+] ${name} (${cls}) joined. ${this.players.size} players online.`);
  }

  removePlayer(sid) {
    const p = this.players.get(sid);
    if (!p) return;
    // Drop inventory
    if (p.alive) this.dropAllItems(p);
    const lvl = p.level;
    this.players.delete(sid);
    this.sockets.delete(sid);
    if (lvl) this.broadcastLevel(lvl);
    this.logToAll(`${p.name} left the dungeon.`);
    console.log(`[-] ${p.name} left. ${this.players.size} players online.`);
  }

  respawn(p) {
    const lv = this.getLevel(p.level);
    p.alive = true;
    p.hp = p.maxHp;
    p.x = lv.firstRoom.cx;
    p.y = lv.firstRoom.cy;
    p.effects = [];
    p.gold = Math.floor(p.gold * 0.8);
    this.log(p.id, 'You have respawned. Lost 20% gold.');
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
    if (item.cat === 'WEAPON' && !p.weapon) { p.weapon = item; }
    else if (item.cat === 'ARMOR' && !p.armor) { p.armor = item; }
    else if (item.cat === 'RING' && !p.ring) { p.ring = item; }
    else { p.inv.push(item); }
  }

  // ─── Movement ───
  movePlayer(sid, dx, dy) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    if (Date.now() - p.lastMove < MOVE_CD) return;
    p.lastMove = Date.now();

    const nx = p.x + dx, ny = p.y + dy;
    const lv = this.getLevel(p.level);

    // Out of bounds or wall — try attacking instead
    if (nx<0||nx>=MAP_W||ny<0||ny>=MAP_H||lv.tiles[ny][nx]===TILE.WALL) {
      // Find monster in that direction to attack
      const mon = lv.monsters.find(m=>m.hp>0 && m.x===nx && m.y===ny);
      if (mon) this.playerHits(p, mon, lv);
      return;
    }

    // Check for monster at destination → bump-attack
    const mon = lv.monsters.find(m=>m.hp>0 && m.x===nx && m.y===ny);
    if (mon) { this.playerHits(p, mon, lv); return; }

    // Check for other player at destination
    for (const [oid, op] of this.players) {
      if (oid !== sid && op.alive && op.level === p.level && op.x === nx && op.y === ny) return;
    }

    // Move!
    p.x = nx; p.y = ny;

    // Auto-detect items on ground
    const here = lv.items.filter(it=>it.x===nx&&it.y===ny);
    if (here.length) {
      this.log(sid, `You see here: ${here.map(i=>i.n).join(', ')}. Press G to pick up.`);
    }

    // Stairs
    if (lv.tiles[ny][nx] === TILE.STAIRS_DOWN) this.log(sid, 'There are stairs down here. Press > to descend.');
    if (lv.tiles[ny][nx] === TILE.STAIRS_UP) this.log(sid, 'There are stairs up here. Press < to ascend.');

    this.broadcastLevel(p.level);
  }

  // ─── Combat ───
  playerHits(p, mon, lv) {
    const wepDmg = p.weapon ? p.weapon.dmg : '1d2';
    const wepAtk = p.weapon ? (p.weapon.atk||0) : 0;
    const atk = p.str + wepAtk;
    const def = mon.dx;
    const hitChance = atk / (atk + def + 1);
    const crit = Math.random() < 0.15;

    if (Math.random() < hitChance) {
      let dmg = roll(wepDmg) + Math.floor(p.str/4);
      if (crit) { dmg = Math.floor(dmg * 2); this.log(p.id, 'Critical hit!'); }
      mon.hp -= dmg;
      this.log(p.id, `You hit the ${mon.n} for ${dmg} damage.`);
      if (mon.hp <= 0) this.killMonster(mon, p, lv);
    } else {
      this.log(p.id, `You miss the ${mon.n}.`);
    }
    this.broadcastLevel(p.level);
  }

  killMonster(mon, killer, lv) {
    killer.xp += mon.xp;
    killer.kills++;
    const goldDrop = ri(mon.xp/2, mon.xp*2);
    killer.gold += goldDrop;

    // Drop corpse (Pathos-style: eat everything!)
    const corpse = {
      id: uid(), cat:'CORPSE', key:mon.key,
      n:`${mon.n} Corpse`, c:'%', col:'#8B0000',
      nut:400+ri(0,300), x:mon.x, y:mon.y, lv:mon.lvl
    };
    lv.items.push(corpse);

    // Drop loot
    if (Math.random() < 0.4) {
      const loot = mkItem(ITEM_POOL(mon.lvl), mon.lvl, mon.x, mon.y);
      if (loot) lv.items.push(loot);
    }

    this.log(killer.id, `You killed the ${mon.n}! (+${mon.xp} XP, +${goldDrop} gold)`);

    // Level up?
    const needXp = killer.lvl * 120;
    if (killer.xp >= needXp) {
      killer.lvl++;
      killer.maxHp += ri(3,8);
      killer.hp = killer.maxHp;
      killer.str += Math.random()<0.5?1:0;
      killer.dex += Math.random()<0.5?1:0;
      killer.xp -= needXp;
      this.log(killer.id, `⬆ LEVEL UP! You are now level ${killer.lvl}. HP and stats increased!`);
    }

    // Track nemesis defeats
    if (mon.key === 'nemesis') {
      this.nemesisDefeated++;
      this.logToAll(`${killer.name} has slain the Nemesis! (Defeated ${this.nemesisDefeated} times)`);
    }
  }

  monsterHits(mon, p) {
    const atk = mon.st;
    const def = p.dex + (p.armor?(p.armor.def||0):0);
    const hitChance = atk / (atk + def + 1);

    if (Math.random() < hitChance) {
      let dmg = ri(1, mon.st) + Math.floor(mon.st/4);
      // Dragon breath
      if (mon.key==='dragon' && Math.random()<0.3) { dmg+=ri(5,15); this.log(p.id,'The Dragon breathes fire!'); }
      // Nemesis abilities
      if (mon.key==='nemesis' && Math.random()<0.2) { dmg+=ri(10,25); this.log(p.id,'The Nemesis unleashes dark energy!'); }
      // Apply armor
      if (p.armor) dmg = Math.max(1, dmg - (p.armor.def||0));
      p.hp -= dmg;
      this.log(p.id, `The ${mon.n} hits you for ${dmg} damage!`);
      if (p.hp <= 0) this.killPlayer(p, mon);
    } else {
      if (Math.random()<0.3) this.log(p.id, `The ${mon.n} misses you.`);
    }
  }

  killPlayer(p, killer) {
    p.alive = false;
    p.hp = 0;
    p.deathTime = Date.now();
    this.dropAllItems(p);
    this.log(p.id, `💀 You were killed by ${killer?killer.n:'unknown forces'}! Respawning in ${RESPAWN_MS/1000}s...`);
    this.logToAll(`${p.name} (Lv${p.lvl}) was killed by ${killer?killer.n:'unknown'}.`);
    this.broadcastLevel(p.level);
  }

  // ─── Items ───
  pickupItem(sid) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    const lv = this.getLevel(p.level);
    const here = lv.items.filter(it=>it.x===p.x&&it.y===p.y);
    if (!here.length) { this.log(sid, 'Nothing here to pick up.'); return; }

    const it = here[0];
    lv.items = lv.items.filter(i=>i.id!==it.id);

    if (it.cat === 'GOLD') {
      p.gold += it.v||ri(5,50);
      this.log(sid, `Picked up ${it.v||'some'} gold. (Total: ${p.gold})`);
    } else {
      this.giveItem(p, it);
      this.log(sid, `Picked up: ${it.n}.`);
    }
    this.syncPlayer(sid);
    this.broadcastLevel(p.level);
  }

  eatItem(sid, invIdx) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    const lv = this.getLevel(p.level);

    // If invIdx is undefined, try to eat from ground first
    if (invIdx === undefined || invIdx === null) {
      const groundFood = lv.items.find(it=>it.x===p.x&&it.y===p.y&&(it.cat==='FOOD'||it.cat==='CORPSE'));
      if (groundFood) {
        lv.items = lv.items.filter(i=>i.id!==groundFood.id);
        this.applyEat(p, groundFood);
        this.syncPlayer(sid);
        this.broadcastLevel(p.level);
        return;
      }
      // Eat from inventory
      const food = p.inv.find(it=>it.cat==='FOOD'||it.cat==='CORPSE');
      if (food) {
        p.inv = p.inv.filter(i=>i.id!==food.id);
        this.applyEat(p, food);
        this.syncPlayer(sid);
        this.broadcastLevel(p.level);
        return;
      }
      this.log(sid, 'Nothing edible here or in inventory.');
      return;
    }

    // Eat specific inventory item
    if (invIdx >= 0 && invIdx < p.inv.length) {
      const it = p.inv[invIdx];
      p.inv.splice(invIdx, 1);
      this.applyEat(p, it);
      this.syncPlayer(sid);
      this.broadcastLevel(p.level);
    }
  }

  applyEat(p, item) {
    if (item.cat === 'FOOD') {
      const heal = item.heal||0;
      if (heal) { p.hp = Math.min(p.maxHp, p.hp+heal); }
      this.log(p.id, `You eat the ${item.n}.${heal?' (+'+heal+' HP)':''}`);
    } else if (item.cat === 'CORPSE') {
      p.hp = Math.min(p.maxHp, p.hp+ri(3,10));
      const fx = CORPSE_FX[item.key];
      if (fx) {
        for (const f of fx) {
          if (f.pct && Math.random()>f.pct) continue;
          switch(f.t){
            case 'heal': p.hp=Math.min(p.maxHp,p.hp+f.v); break;
            case 'resist':
              if(f.res==='all') Object.keys(p.resists).forEach(k=>p.resists[k]=true);
              else p.resists[f.res]=true;
              break;
            case 'temp': p.effects.push({stat:f.stat,v:f.v,trn:f.trn}); break;
            case 'perm': p[f.stat]+=f.v; break;
            case 'regen': p.effects.push({type:'regen',trn:f.trn}); break;
            case 'breath': p.effects.push({type:'breath',trn:f.trn}); break;
            case 'sick': p.hp-=ri(3,8); if(p.hp<=0) p.hp=1; break;
          }
          if(f.msg) this.log(p.id, f.msg);
        }
      }
      this.log(p.id, `You devour the ${item.n}.`);
    } else {
      // Eating non-food items (Pathos humor)
      p.hp -= ri(1,5);
      if (p.hp <= 0) p.hp = 1;
      this.log(p.id, `You eat the ${item.n}... That was a bad idea. (-HP)`);
    }
  }

  useItem(sid, invIdx) {
    const p = this.players.get(sid);
    if (!p||!p.alive||invIdx<0||invIdx>=p.inv.length) return;
    const it = p.inv[invIdx];

    switch(it.cat){
      case 'POTION':
        p.inv.splice(invIdx,1);
        if(it.fx==='heal'){ p.hp=Math.min(p.maxHp,p.hp+(it.v||20)); this.log(sid,`Drunk ${it.n}. +${it.v||20} HP!`); }
        else if(it.fx==='str'){ p.str+=1; this.log(sid,`Drunk ${it.n}. +1 STR! (${p.str})`); }
        else if(it.fx==='dex'){ p.dex+=1; this.log(sid,`Drunk ${it.n}. +1 DEX! (${p.dex})`); }
        break;
      case 'SCROLL':
        p.inv.splice(invIdx,1);
        if(it.fx==='tele'){ const lv=this.getLevel(p.level); const rm=rp(lv.rooms); p.x=rm.cx; p.y=rm.cy; this.log(sid,'You teleport!'); }
        else if(it.fx==='ewep'&&p.weapon){ p.weapon.atk=(p.weapon.atk||0)+1; this.log(sid,'Weapon glows brighter! +1 ATK'); }
        else if(it.fx==='earm'&&p.armor){ p.armor.def=(p.armor.def||0)+1; this.log(sid,'Armor hardens! +1 DEF'); }
        else if(it.fx==='fire'){ const lv=this.getLevel(p.level); lv.monsters.forEach(m=>{if(dist(m.x,m.y,p.x,p.y)<=3){m.hp-=ri(10,25);this.log(sid,`Fireball hits ${m.n}!`);}}); lv.monsters=lv.monsters.filter(m=>m.hp>0); }
        break;
      default: this.log(sid, `Cannot use ${it.n} directly.`); return;
    }
    this.syncPlayer(sid);
    this.broadcastLevel(p.level);
  }

  equipItem(sid, invIdx) {
    const p = this.players.get(sid);
    if (!p||!p.alive||invIdx<0||invIdx>=p.inv.length) return;
    const it = p.inv[invIdx];
    if (it.cat !== 'WEAPON' && it.cat !== 'ARMOR' && it.cat !== 'RING') {
      this.log(sid, `Cannot equip ${it.n}.`); return;
    }

    p.inv.splice(invIdx, 1);
    let old = null;
    if (it.cat==='WEAPON') { old=p.weapon; p.weapon=it; }
    else if (it.cat==='ARMOR') { old=p.armor; p.armor=it; }
    else if (it.cat==='RING') { old=p.ring; p.ring=it; }
    if (old) p.inv.push(old);

    this.log(sid, `Equipped: ${it.n}.`);
    this.syncPlayer(sid);
    this.broadcastLevel(p.level);
  }

  dropItem(sid, invIdx) {
    const p = this.players.get(sid);
    if (!p||!p.alive||invIdx<0||invIdx>=p.inv.length) return;
    const it = p.inv.splice(invIdx,1)[0];
    const lv = this.getLevel(p.level);
    it.x=p.x; it.y=p.y; it.lv=p.level;
    lv.items.push(it);
    this.log(sid, `Dropped: ${it.n}.`);
    this.syncPlayer(sid);
    this.broadcastLevel(p.level);
  }

  unequip(sid, slot) {
    const p = this.players.get(sid);
    if (!p||!p.alive) return;
    let item = null;
    if (slot==='weapon'){ item=p.weapon; p.weapon=null; }
    else if(slot==='armor'){ item=p.armor; p.armor=null; }
    else if(slot==='ring'){ item=p.ring; p.ring=null; }
    if(item){ p.inv.push(item); this.log(sid,`Unequipped: ${item.n}.`); }
    this.syncPlayer(sid);
    this.broadcastLevel(p.level);
  }

  // ─── Level change ───
  changeLevel(sid, dir) {
    const p = this.players.get(sid);
    if (!p || !p.alive) return;
    const lv = this.getLevel(p.level);
    const tile = lv.tiles[p.y][p.x];

    if (dir==='down' && tile===TILE.STAIRS_DOWN) {
      p.level++; p.depth=Math.max(p.depth,p.level);
      const nl = this.getLevel(p.level);
      p.x=nl.firstRoom.cx; p.y=nl.firstRoom.cy;
      this.log(sid, `⬇ You descend to level ${p.level}.`);
      this.broadcastLevel(p.level-1);
      // Send map to the descending player
      const sock = this.sockets.get(sid);
      if(sock) sock.emit('newLevel', { map:nl.tiles, level:p.level });
      this.broadcastLevel(p.level);
      this.logToAll(`${p.name} descended to level ${p.level}.`);
    } else if (dir==='up' && tile===TILE.STAIRS_UP && p.level>1) {
      p.level--;
      const nl = this.getLevel(p.level);
      p.x=nl.lastRoom.cx; p.y=nl.lastRoom.cy;
      this.log(sid, `⬆ You ascend to level ${p.level}.`);
      this.broadcastLevel(p.level+1);
      const sock = this.sockets.get(sid);
      if(sock) sock.emit('newLevel', { map:nl.tiles, level:p.level });
      this.broadcastLevel(p.level);
      this.logToAll(`${p.name} ascended to level ${p.level}.`);
    } else {
      this.log(sid, 'No stairs here.');
      return;
    }
  }

  // ─── Chat ───
  chat(sid, msg) {
    const p = this.players.get(sid);
    if (!p || !msg.trim()) return;
    const text = msg.trim().slice(0,200);
    this.io.emit('chat', { from:p.name, cls:p.cls, color:p.color, msg:text });
  }

  // ─── Game tick (monster AI) ───
  tick() {
    const now = Date.now();
    const active = new Set();
    for (const p of this.players.values()) {
      if (p.alive) active.add(p.level);
      // Check respawn
      if (!p.alive && p.deathTime && now - p.deathTime > RESPAWN_MS) {
        this.respawn(p);
        active.add(p.level);
      }
    }

    for (const lvlNum of active) {
      const lv = this.getLevel(lvlNum);
      const playersHere = [...this.players.values()].filter(p=>p.alive&&p.level===lvlNum);
      if (!playersHere.length) continue;

      // Process monster AI
      for (const mon of lv.monsters) {
        if (mon.hp <= 0) continue;
        // Regen for trolls
        if (mon.key==='troll' && mon.hp<mon.maxHp && Math.random()<0.3) mon.hp=Math.min(mon.maxHp,mon.hp+3);

        // Find nearest player
        let nearest=null, nearDist=SIGHT;
        for (const pl of playersHere) {
          const d=dist(mon.x,mon.y,pl.x,pl.y);
          if(d<nearDist){ nearest=pl; nearDist=d; }
        }

        if (nearest && nearDist<=1) {
          this.monsterHits(mon, nearest);
        } else if (nearest) {
          this.moveMonster(mon, nearest, lv, playersHere);
        } else if (Math.random()<0.25) {
          this.wanderMonster(mon, lv, playersHere);
        }
      }

      // Clean dead monsters
      lv.monsters = lv.monsters.filter(m=>m.hp>0);

      // Process player temp effects
      for (const pl of playersHere) {
        for (let i=pl.effects.length-1;i>=0;i--) {
          const ef=pl.effects[i];
          ef.trn--;
          if(ef.trn<=0) pl.effects.splice(i,1);
        }
        // Ring of regen
        if (pl.ring && pl.ring.ring==='regen' && pl.hp<pl.maxHp) {
          pl.hp=Math.min(pl.maxHp,pl.hp+1);
        }
      }

      this.broadcastLevel(lvlNum);
    }
  }

  moveMonster(mon, target, lv, players) {
    const dx=Math.sign(target.x-mon.x), dy=Math.sign(target.y-mon.y);
    const xFirst=Math.abs(target.x-mon.x)>Math.abs(target.y-mon.y);
    const moves=xFirst?[{x:dx,y:0},{x:0,y:dy}]:[{x:0,y:dy},{x:dx,y:0}];
    for(const m of moves){
      const nx=mon.x+m.x, ny=mon.y+m.y;
      if(target.x===nx&&target.y===ny){ this.monsterHits(mon,target); return; }
      if(this.canStand(nx,ny,lv,players)){ mon.x=nx; mon.y=ny; return; }
    }
  }

  wanderMonster(mon, lv, players) {
    const dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];
    const d=rp(dirs);
    const nx=mon.x+d.x, ny=mon.y+d.y;
    if(this.canStand(nx,ny,lv,players)){ mon.x=nx; mon.y=ny; }
  }

  canStand(x,y,lv,players) {
    if(x<0||x>=MAP_W||y<0||y>=MAP_H) return false;
    if(lv.tiles[y][x]===TILE.WALL) return false;
    for(const p of players) if(p.x===x&&p.y===y) return false;
    for(const m of lv.monsters) if(m.hp>0&&m.x===x&&m.y===y) return false;
    return true;
  }

  // ─── Broadcast ───
  sendLevelState(sock, lvlNum) {
    const lv = this.getLevel(lvlNum);
    const playersOnLevel = [...this.players.values()]
      .filter(p=>p.alive&&p.level===lvlNum)
      .map(p=>this.sanitizePlayer(p, false));
    sock.emit('gameState', {
      players: playersOnLevel,
      monsters: lv.monsters.filter(m=>m.hp>0).map(m=>({id:m.id,key:m.key,n:m.n,c:m.c,col:m.col,hp:m.hp,maxHp:m.maxHp,x:m.x,y:m.y})),
      items: lv.items.map(i=>({id:i.id,key:i.key||'',cat:i.cat,n:i.n,c:i.c||'?',col:i.col||'#FFF',x:i.x,y:i.y})),
      level: lvlNum,
    });
  }

  syncPlayer(sid) {
    const p = this.players.get(sid);
    const sock = this.sockets.get(sid);
    if (p && sock) sock.emit('syncPlayer', this.sanitizePlayer(p, true));
  }

  broadcastLevel(lvlNum, excludeSid) {
    const lv = this.getLevel(lvlNum);
    const playersOnLevel = [...this.players.values()]
      .filter(p=>p.alive&&p.level===lvlNum)
      .map(p=>this.sanitizePlayer(p, false));

    const state = {
      players: playersOnLevel,
      monsters: lv.monsters.filter(m=>m.hp>0).map(m=>({id:m.id,key:m.key,n:m.n,c:m.c,col:m.col,hp:m.hp,maxHp:m.maxHp,x:m.x,y:m.y})),
      items: lv.items.map(i=>({id:i.id,key:i.key||'',cat:i.cat,n:i.n,c:i.c||'?',col:i.col||'#FFF',x:i.x,y:i.y})),
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
      wpn:p.weapon?{n:p.weapon.n,atk:p.weapon.atk||0,dmg:p.weapon.dmg}:null,
      arm:p.armor?{n:p.armor.n,def:p.armor.def||0}:null,
    };
    if (full) {
      base.inv = p.inv.map(i=>({id:i.id,key:i.key,cat:i.cat,n:i.n,c:i.c||'?',col:i.col||'#FFF',dmg:i.dmg,atk:i.atk,def:i.def,fx:i.fx,ring:i.ring,nut:i.nut,heal:i.heal}));
      base.effects = p.effects;
      base.resists = p.resists;
      base.xp = p.xp;
      base.weapon = p.weapon;
      base.armor = p.armor;
      base.ring = p.ring;
    }
    return base;
  }

  // ─── Personal log ───
  log(sid, msg) {
    const sock = this.sockets.get(sid);
    if (sock) sock.emit('log', { msg, time: Date.now() });
  }

  logToAll(msg) {
    this.io.emit('log', { msg, time: Date.now(), global: true });
  }
}

// ═══════════ SERVER SETUP ═══════════
const app = express();
const server = http.createServer(app);
const io = new Server(server, { connectionStateRecovery: {} });

app.use(express.static('./'));

const game = new Game(io);

io.on('connection', socket => {
  console.log(`[~] Connected: ${socket.id}`);

  socket.on('join', data => game.addPlayer(socket, data));

  socket.on('move', data => {
    const dx = data.dx || 0, dy = data.dy || 0;
    game.movePlayer(socket.id, dx, dy);
  });

  socket.on('pickup', () => game.pickupItem(socket.id));
  socket.on('use',   data => game.useItem(socket.id, data.idx));
  socket.on('equip', data => game.equipItem(socket.id, data.idx));
  socket.on('drop',  data => game.dropItem(socket.id, data.idx));
  socket.on('eat',   data => game.eatItem(socket.id, data.idx));
  socket.on('unequip', data => game.unequip(socket.id, data.slot));
  socket.on('descend', () => game.changeLevel(socket.id, 'down'));
  socket.on('ascend',  () => game.changeLevel(socket.id, 'up'));
  socket.on('chat',  data => game.chat(socket.id, data.msg));

  socket.on('disconnect', () => game.removePlayer(socket.id));
});

// Game loop
setInterval(() => game.tick(), TICK);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log('  🏰 Pathos Online — Dungeon Server');
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log('  Press Ctrl+C to stop');
  console.log('═══════════════════════════════════════');
});
