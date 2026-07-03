'use strict';

// ═══════════════════════════════════════
//  Pathos 在线 — 虚空地牢 · 门视野 · 回合制
// ═══════════════════════════════════════

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// ═══════ 常量 ═══════
const VOID = 0, WALL = 1, FLOOR = 2, DOOR = 3, STAIRS_UP = 4, STAIRS_DOWN = 5;
const MAP_W = 80, MAP_H = 56;
const SIGHT = 10;
const MOVE_CD = 200;
const RESPAWN_MS = 4000;

const ri = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const rp = arr => arr[Math.floor(Math.random()*arr.length)];
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const dist = (x1,y1,x2,y2) => Math.abs(x2-x1)+Math.abs(y2-y1);
const roll = d => { const [n,s]=d.split('d'); let t=0; for(let i=0;i<+n;i++) t+=ri(1,+s); return t; };

// ═══════ 职业 ═══════
const CLASSES = {
  warrior:{name:'战士',str:16,dex:10,hp:38,color:'#FF6B6B',wep:'shortSword',arm:'leatherArmor'},
  wizard:{name:'法师',str:8,dex:12,hp:22,color:'#6B9BFF',wep:'dagger',arm:null},
  rogue:{name:'盗贼',str:12,dex:18,hp:26,color:'#6BFF6B',wep:'shortSword',arm:null},
};

// ═══════ 怪物 ═══════
const MON = {
  goblin:{n:'哥布林',e:'👺',hp:8,st:8,dx:10,xp:10,ml:1},
  giantRat:{n:'巨鼠',e:'🐀',hp:5,st:6,dx:14,xp:5,ml:1},
  bat:{n:'巨蝙蝠',e:'🦇',hp:6,st:5,dx:16,xp:7,ml:1},
  skeleton:{n:'骷髅兵',e:'💀',hp:12,st:10,dx:8,xp:15,ml:2},
  orc:{n:'兽人',e:'👹',hp:16,st:14,dx:9,xp:25,ml:2},
  slime:{n:'史莱姆',e:'🟢',hp:10,st:5,dx:4,xp:10,ml:2},
  troll:{n:'巨魔',e:'🧌',hp:32,st:18,dx:7,xp:80,ml:3},
  wraith:{n:'幽灵',e:'👻',hp:22,st:12,dx:14,xp:60,ml:4},
  dragon:{n:'火龙',e:'🐉',hp:55,st:24,dx:10,xp:350,ml:5},
  nemesis:{n:'复仇女神',e:'👁️',hp:90,st:28,dx:17,xp:1200,ml:6},
};

function spawnPool(lvl){
  const p=[];
  for(const[k,m]of Object.entries(MON)){
    if(m.ml>lvl+1) continue;
    const wt=k==='nemesis'?1:k==='dragon'?2:k==='troll'||k==='wraith'?3:8;
    for(let i=0;i<wt;i++) p.push(k);
  }
  return p;
}

// ═══════ 尸体效果 ═══════
const CORPSE = {
  goblin:[{t:'heal',v:8,msg:'味道糟糕，但恢复了一些生命值。'}],
  giantRat:[{t:'sick',pct:0.3,msg:'你感到恶心……'},{t:'resist',res:'毒素',pct:0.12,msg:'获得了毒素抗性！'}],
  bat:[{t:'temp',stat:'dex',v:2,trn:50,msg:'蝙蝠精华让你更加敏捷！'}],
  skeleton:[{t:'nothing',msg:'嘎嘣脆，没味道。'}],
  orc:[{t:'temp',stat:'str',v:2,trn:50,msg:'兽人之力涌入体内！'}],
  slime:[{t:'sick',pct:0.35,msg:'史莱姆在你胃里翻腾！'},{t:'resist',res:'酸',pct:0.12,msg:'酸性抗性！'}],
  troll:[{t:'regen',trn:40,msg:'伤口正在愈合！'},{t:'temp',stat:'str',v:3,trn:40,msg:'巨魔之力！'}],
  wraith:[{t:'sick',pct:0.3,msg:'暗影让你虚弱！'},{t:'perm',stat:'str',v:1,pct:0.08,msg:'永久吸收了幽灵之力！'}],
  dragon:[{t:'resist',res:'火焰',pct:0.5,msg:'火焰伤不到你了！'},{t:'breath',trn:25,msg:'你可以喷吐火焰！'}],
  nemesis:[{t:'perm',stat:'str',v:2,pct:0.6,msg:'复仇女神永久增强了你！'},{t:'resist',res:'全',pct:0.5,msg:'终极抗性！'}],
};

// ═══════ 物品 ═══════
const ITEMS = {
  dagger:{cat:'武器',n:'匕首',e:'🗡️',dmg:'1d4',atk:1},
  shortSword:{cat:'武器',n:'短剑',e:'⚔️',dmg:'1d6',atk:2},
  longSword:{cat:'武器',n:'长剑',e:'⚔️',dmg:'1d8',atk:3},
  battleAxe:{cat:'武器',n:'战斧',e:'🪓',dmg:'1d10',atk:3},
  magicStaff:{cat:'武器',n:'魔法杖',e:'🪄',dmg:'2d6',atk:5},
  leatherArmor:{cat:'护甲',n:'皮甲',e:'🛡️',def:2},
  chainmail:{cat:'护甲',n:'锁子甲',e:'🛡️',def:4},
  plateMail:{cat:'护甲',n:'板甲',e:'🛡️',def:6},
  dragonScale:{cat:'护甲',n:'龙鳞甲',e:'🛡️',def:8},
  healPotion:{cat:'药水',n:'治疗药水',e:'🧪',fx:'heal',v:25},
  fullHeal:{cat:'药水',n:'完全治疗',e:'🧪',fx:'heal',v:999},
  strPotion:{cat:'药水',n:'力量药水',e:'💪',fx:'str'},
  dexPotion:{cat:'药水',n:'敏捷药水',e:'💨',fx:'dex'},
  teleScroll:{cat:'卷轴',n:'传送卷轴',e:'📜',fx:'tele'},
  enchWep:{cat:'卷轴',n:'附魔武器',e:'📜',fx:'ewep'},
  enchArm:{cat:'卷轴',n:'附魔护甲',e:'📜',fx:'earm'},
  fireScroll:{cat:'卷轴',n:'火焰卷轴',e:'🔥',fx:'fire'},
  ration:{cat:'食物',n:'口粮',e:'🍞',nut:800},
  apple:{cat:'食物',n:'苹果',e:'🍎',nut:150,heal:8},
  bread:{cat:'食物',n:'面包',e:'🥖',nut:400},
  ringStr:{cat:'戒指',n:'力量戒指',e:'💍',ring:'str',v:2},
  ringDex:{cat:'戒指',n:'敏捷戒指',e:'💍',ring:'dex',v:2},
  ringProt:{cat:'戒指',n:'防护戒指',e:'💍',ring:'def',v:2},
  ringRegen:{cat:'戒指',n:'再生戒指',e:'💍',ring:'regen',v:1},
};

function mkItem(key,lv,x,y){
  const t=ITEMS[key]; if(!t) return null;
  return {id:uid(),key,...JSON.parse(JSON.stringify(t)),lv,x,y};
}
const ITEM_POOL = (()=>{
  const c=['ration','apple','bread','healPotion','dagger'];
  const u=['shortSword','leatherArmor','strPotion','dexPotion','teleScroll','ringStr','ringDex'];
  const r=['longSword','chainmail','enchWep','enchArm','fullHeal','fireScroll','ringProt'];
  const e=['battleAxe','magicStaff','plateMail','dragonScale','ringRegen'];
  return lvl=>{let p=[...c];if(lvl>=2)p.push(...u);if(lvl>=3)p.push(...r);if(lvl>=5)p.push(...e);return rp(p);};
})();

// ═══════════════════════════════════
//  虚空地牢生成器
//  结构：房间（围墙+地板+门）+ 走廊 + 虚空
// ═══════════════════════════════════

function genDungeon(lvl){
  const tiles = Array.from({length:MAP_H},()=>Array.from({length:MAP_W},()=>VOID));

  // 3×3 网格分区
  const GW = Math.floor(MAP_W/3); // ~26
  const GH = Math.floor(MAP_H/3); // ~18

  // ── 在每格挖出房间 ──
  const rooms = [];
  const doors = []; // {x, y, roomIdx}

  for(let gy=0;gy<3;gy++){
    for(let gx=0;gx<3;gx++){
      const zoneX=gx*GW, zoneY=gy*GH;
      const margin=3;
      const zw=GW-margin*2, zh=GH-margin*2;

      // 随机房间大小
      const w=ri(6,Math.min(14,zw-2));
      const h=ri(5,Math.min(10,zh-2));
      const rx=zoneX+margin+ri(0,zw-w);
      const ry=zoneY+margin+ri(0,zh-h);

      // 先画围墙
      for(let y=ry-1;y<=ry+h;y++)
        for(let x=rx-1;x<=rx+w;x++)
          if(y>=0&&y<MAP_H&&x>=0&&x<MAP_W)
            tiles[y][x]=WALL;

      // 挖出内部
      for(let y=ry;y<ry+h;y++)
        for(let x=rx;x<rx+w;x++)
          tiles[y][x]=FLOOR;

      const idx=rooms.length;
      rooms.push({x:rx,y:ry,w:h,h, cx:Math.floor(rx+w/2),cy:Math.floor(ry+h/2), idx, gx,gy});

      // 在墙壁上开1-3个门（不在角落）
      const wallCells=[];
      // 上下墙
      for(let x=rx+1;x<rx+w-1;x++){ wallCells.push({x,y:ry-1,dir:'v'}); wallCells.push({x,y:ry+h,dir:'v'}); }
      // 左右墙
      for(let y=ry+1;y<ry+h-1;y++){ wallCells.push({x:rx-1,y,dir:'h'}); wallCells.push({x:rx+w,y,dir:'h'}); }

      // 排除角落（距角至少2格）
      const valid=wallCells.filter(wc=>{
        const dx1=wc.x-rx, dx2=(rx+w-1)-wc.x;
        const dy1=wc.y-ry, dy2=(ry+h-1)-wc.y;
        return Math.min(dx1,dx2)>=1 && Math.min(dy1,dy2)>=1;
      });

      if(valid.length===0) continue;
      const nDoors=Math.min(ri(1,3),valid.length);
      const chosen=new Set();
      const step=Math.max(1,Math.floor(valid.length/nDoors));
      for(let i=0;i<nDoors;i++){
        const idx2=Math.min(i*step+ri(0,Math.max(0,step-1)),valid.length-1);
        if(idx2>=0&&idx2<valid.length) chosen.add(idx2);
      }
      for(const ci of chosen){
        const wc=valid[ci];
        if(wc.x>=0&&wc.x<MAP_W&&wc.y>=0&&wc.y<MAP_H){
          tiles[wc.y][wc.x]=DOOR;doors.push({x:wc.x,y:wc.y,roomIdx:idx});
        }
      }
    }
  }

  // ── MST 连通所有房间的门 ──
  // 先把门按房间分组
  const roomDoors=Array.from({length:rooms.length},()=>[]);
  for(const d of doors) roomDoors[d.roomIdx].push(d);

  // 边：每对房间之间所有门对的距离
  const edges=[];
  for(let i=0;i<rooms.length;i++){
    if(!roomDoors[i].length) continue;
    for(let j=i+1;j<rooms.length;j++){
      if(!roomDoors[j].length) continue;
      for(const da of roomDoors[i]){
        for(const db of roomDoors[j]){
          edges.push({a:i,b:j,da,db,w:dist(da.x,da.y,db.x,db.y)});
        }
      }
    }
  }
  edges.sort((a,b)=>a.w-b.w);

  // Union-Find
  const uf=Array.from({length:rooms.length},(_,i)=>i);
  const find=x=>uf[x]===x?x:(uf[x]=find(uf[x]));
  const union=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb){uf[ra]=rb;return true;}return false;};

  const mst=[];
  for(const e of edges){if(union(e.a,e.b)) mst.push(e);}

  // 额外1-2条连接
  const mstKeys=new Set(mst.map(e=>`${Math.min(e.a,e.b)}_${Math.max(e.a,e.b)}`));
  const extra=[];
  for(const e of edges){
    if(extra.length>=2) break;
    if(!mstKeys.has(`${Math.min(e.a,e.b)}_${Math.max(e.a,e.b)}`)){extra.push(e);mstKeys.add(`${Math.min(e.a,e.b)}_${Math.max(e.a,e.b)}`);}
  }

  const allConns=[...mst,...extra];

  // ── 挖走廊（L形），周围用墙包边 ──
  for(const conn of allConns){
    const {da,db}=conn;
    let cx=da.x, cy=da.y;
    const tx=db.x, ty=db.y;

    const path=[];
    // L形走廊
    if(Math.random()<0.5){
      while(cx!==tx){cx+=cx<tx?1:-1;path.push({x:cx,y:cy});}
      while(cy!==ty){cy+=cy<ty?1:-1;path.push({x:cx,y:cy});}
    }else{
      while(cy!==ty){cy+=cy<ty?1:-1;path.push({x:cx,y:cy});}
      while(cx!==tx){cx+=cx<tx?1:-1;path.push({x:cx,y:cy});}
    }

    // 先挖地板
    for(const p of path){
      if(p.x>=0&&p.x<MAP_W&&p.y>=0&&p.y<MAP_H)
        tiles[p.y][p.x]=FLOOR;
    }

    // 走廊两边加墙（不覆盖已有的门/地板）
    for(const p of path){
      for(const [nx,ny] of [[p.x-1,p.y],[p.x+1,p.y],[p.x,p.y-1],[p.x,p.y+1]]){
        if(nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&tiles[ny][nx]===VOID)
          tiles[ny][nx]=WALL;
      }
    }
  }

  // ── 确保每个房间至少有门通往外部 ──
  for(let i=0;i<rooms.length;i++){
    if(roomDoors[i].length===0){
      const r=rooms[i];
      // 在右边墙开个门
      const dx=r.x+r.w, dy=r.cy;
      if(dx<MAP_W&&dy>=0&&dy<MAP_H){
        tiles[dy][dx]=DOOR;
        doors.push({x:dx,y:dy,roomIdx:i});
        // 挖一条短走廊到虚空边缘…算了，至少有个门
        roomDoors[i].push({x:dx,y:dy,roomIdx:i});
      }
    }
  }

  // ── 楼梯 ──
  tiles[rooms[0].cy][rooms[0].cx]=STAIRS_UP;
  tiles[rooms[8].cy][rooms[8].cx]=STAIRS_DOWN;

  // ── 怪物 ──
  const monsters=[];
  const pool=spawnPool(lvl);
  const nMon=ri(4,9)+lvl*2;
  for(let i=0;i<nMon;i++){
    const rm=rp(rooms.slice(1));
    const mx=ri(rm.x+1,rm.x+rm.w-2), my=ri(rm.y+1,rm.y+rm.h-2);
    if(tiles[my]&&tiles[my][mx]===FLOOR){
      monsters.push({id:uid(),key:rp(pool),x:mx,y:my,lvl,hp:0,maxHp:0,st:0,dx:0,xp:0,n:'',e:'',lastAct:0});
    }
  }
  for(const m of monsters){
    const t=MON[m.key]; if(!t) continue;
    m.n=t.n;m.e=t.e;m.maxHp=t.hp+ri(-3,5);m.hp=m.maxHp;m.st=t.st;m.dx=t.dx;m.xp=t.xp;
  }

  if(lvl>=3&&Math.random()<0.12){
    const rm=rp(rooms.slice(-3));
    const nm=MON.nemesis;
    monsters.push({id:uid(),key:'nemesis',x:rm.cx,y:rm.cy,lvl,n:nm.n,e:nm.e,hp:nm.hp+ri(0,25),maxHp:nm.hp+25,st:nm.st,dx:nm.dx,xp:nm.xp,lastAct:0});
  }

  // ── 物品 ──
  const items=[];
  for(let i=0;i<ri(12,22);i++){
    const rm=rp(rooms);
    const ix=ri(rm.x+1,rm.x+rm.w-2), iy=ri(rm.y+1,rm.y+rm.h-2);
    if(tiles[iy]&&tiles[iy][ix]===FLOOR){
      const it=mkItem(ITEM_POOL(lvl),lvl,ix,iy);
      if(it) items.push(it);
    }
  }

  // ── 构建连通性信息：每个门通过走廊能看到的其他门 ──
  const doorMap={}; // key → [{x,y}]
  for(const d of doors){
    const k=`${d.x},${d.y}`;
    doorMap[k]=[];
  }
  // 用 BFS 从每个门出发沿走廊走，找其他门
  for(const d of doors){
    const sk=`${d.x},${d.y}`;
    const visited=new Set([sk]);
    const q=[d];
    const found=[];
    // BFS 限制步数（走廊最多走40步）
    for(let step=0;step<40&&q.length;step++){
      const cur=q.shift();
      for(const [nx,ny] of [[cur.x-1,cur.y],[cur.x+1,cur.y],[cur.x,cur.y-1],[cur.x,cur.y+1]]){
        if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
        const nk=`${nx},${ny}`;
        if(visited.has(nk)) continue;
        const t=tiles[ny][nx];
        if(t===DOOR){found.push({x:nx,y:ny});visited.add(nk);continue;}
        if(t===FLOOR){visited.add(nk);q.push({x:nx,y:ny});}
      }
    }
    doorMap[sk]=found;
  }

  return {tiles,rooms,monsters,items,lvl,firstRoom:rooms[0],lastRoom:rooms[8],doors,doorMap};
}

// ═══════════════════════════════════
//  游戏服务器
// ═══════════════════════════════════

class Game {
  constructor(io){
    this.io=io;
    this.players=new Map();
    this.levels=new Map();
    this.sockets=new Map();
    this.nemesisDefeated=0;
  }

  getLevel(n){
    if(!this.levels.has(n)) this.levels.set(n,genDungeon(n));
    return this.levels.get(n);
  }

  // ─── 视野：玩家可见区域 ───
  getVisibleTiles(p){
    if(!p||!p.alive) return new Set();
    const lv=this.getLevel(p.level);
    if(!lv) return new Set();
    const seen=new Set();
    const px=p.x, py=p.y;

    // 光线投射：向360度发射射线
    const NUM_RAYS=48;
    for(let i=0;i<NUM_RAYS;i++){
      const angle=(i/NUM_RAYS)*Math.PI*2;
      this.castRay(px,py,angle,SIGHT,lv.tiles,lv,seen);
    }

    // 确保玩家周围2格总是可见
    for(let dy=-2;dy<=2;dy++){
      for(let dx=-2;dx<=2;dx++){
        const nx=px+dx, ny=py+dy;
        if(nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H){
          const t=lv.tiles[ny][nx];
          if(t!==VOID) seen.add(`${nx},${ny}`);
        }
      }
    }

    return seen;
  }

  castRay(x0,y0,angle,maxDist,tiles,level,seen){
    const px=x0, py=y0;
    let x=x0, y=y0;
    const cos=Math.cos(angle), sin=Math.sin(angle);

    for(let step=0;step<maxDist*2;step++){
      const nx=Math.round(px+cos*step*0.5);
      const ny=Math.round(py+sin*step*0.5);
      if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) break;
      if(x===nx&&y===ny) continue;
      x=nx;y=ny;
      if(dist(x0,y0,x,y)>maxDist) break;

      const t=tiles[ny][nx];
      if(t===VOID&&step<2) continue; // 虚空在起点附近跳过
      if(t===VOID) break; // 遇到虚空停止（但会标记之前经过的地板）

      seen.add(`${x},${y}`);

      if(t===WALL) break; // 墙阻挡视线

      // 遇到门：透视走廊看到连接的门
      if(t===DOOR){
        const dk=`${x},${y}`;
        const linked=level.doorMap?.[dk];
        if(linked){
          for(const ld of linked){
            seen.add(`${ld.x},${ld.y}`);
          }
        }
        // 门本身不阻挡，继续往走廊看
      }
    }
  }

  // ─── 玩家加入 ───
  addPlayer(socket,data){
    const name=(data.name||'冒险者').slice(0,12);
    const cls=CLASSES[data.class]?data.class:'warrior';
    const tmpl=CLASSES[cls];
    const lv=this.getLevel(1);

    const p={
      id:socket.id,name,cls,color:tmpl.color,
      str:tmpl.str,dex:tmpl.dex,hp:tmpl.hp,maxHp:tmpl.hp,
      lvl:1,xp:0,gold:0,kills:0,depth:1,level:1,
      x:lv.firstRoom.cx,y:lv.firstRoom.cy,
      alive:true,deathTime:0,lastMove:0,
      inv:[],weapon:null,armor:null,ring:null,
      resists:{火焰:false,冰霜:false,毒素:false,闪电:false,酸:false},
      effects:[],seenTiles:new Set(),
    };

    if(tmpl.wep) this.giveItem(p,mkItem(tmpl.wep,1));
    if(tmpl.arm) this.giveItem(p,mkItem(tmpl.arm,1));
    this.giveItem(p,mkItem('ration',1));
    this.giveItem(p,mkItem('bread',1));

    p.seenTiles=this.getVisibleTiles(p);

    this.players.set(socket.id,p);
    this.sockets.set(socket.id,socket);

    socket.emit('welcome',{you:this.sanitize(p,true),map:lv.tiles,level:1,doors:lv.doors||[],doorMap:lv.doorMap||{}});
    this.sendState(socket,1);
    this.bcast(1,socket.id);
    this.log(socket.id,`🎉 欢迎，${name}！`);
    this.log(socket.id,'方向键/WASD 移动 | G 拾取 | E 吃 | I 背包 | > 下楼 | < 上楼');
    this.logAll(`👋 ${name}（${tmpl.name}）进入了地牢。`);
    console.log(`[+] ${name} 在线:${this.players.size}`);
  }

  removePlayer(sid){
    const p=this.players.get(sid);if(!p)return;
    if(p.alive) this.dropAll(p);
    const lvl=p.level;
    this.players.delete(sid);this.sockets.delete(sid);
    if(lvl) this.bcast(lvl);
    this.logAll(`👋 ${p.name} 离开了。`);
  }

  respawn(p){
    const lv=this.getLevel(p.level);
    p.alive=true;p.hp=p.maxHp;
    p.x=lv.firstRoom.cx;p.y=lv.firstRoom.cy;
    p.effects=[];p.gold=Math.floor(p.gold*0.75);
    p.seenTiles=this.getVisibleTiles(p);
    this.log(p.id,'🔄 已复活。');this.bcast(p.level);
  }

  dropAll(p){
    const lv=this.getLevel(p.level);
    for(const it of p.inv){it.x=p.x;it.y=p.y;it.lv=p.level;lv.items.push(it);}
    if(p.weapon){p.weapon.x=p.x;p.weapon.y=p.y;p.weapon.lv=p.level;lv.items.push(p.weapon);}
    if(p.armor){p.armor.x=p.x;p.armor.y=p.y;p.armor.lv=p.level;lv.items.push(p.armor);}
    if(p.ring){p.ring.x=p.x;p.ring.y=p.y;p.ring.lv=p.level;lv.items.push(p.ring);}
    p.inv=[];p.weapon=null;p.armor=null;p.ring=null;
  }

  giveItem(p,item){
    if(!item)return;
    delete item.x;delete item.y;delete item.lv;
    if(item.cat==='武器'&&!p.weapon){p.weapon=item;}
    else if(item.cat==='护甲'&&!p.armor){p.armor=item;}
    else if(item.cat==='戒指'&&!p.ring){p.ring=item;}
    else{p.inv.push(item);}
  }

  // ─── 回合制 ───
  acted(sid){
    const p=this.players.get(sid);
    if(!p||!p.alive)return;
    p.seenTiles=this.getVisibleTiles(p);
    this.enemyTurn(sid);
    this.sync(sid);
  }

  enemyTurn(sid){
    const p=this.players.get(sid);
    if(!p||!p.alive)return;
    const lv=this.getLevel(p.level);
    if(!lv||!lv.monsters)return;
    const now=Date.now();

    for(const mon of lv.monsters){
      if(mon.hp<=0)continue;
      if(now-(mon.lastAct||0)<450)continue;
      const d=dist(mon.x,mon.y,p.x,p.y);
      if(d>SIGHT+2)continue;

      if(d<=1){this.mHit(mon,p);mon.lastAct=now;}
      else if(d<=SIGHT+2){this.chase(mon,p,lv,now);}
    }

    lv.monsters=lv.monsters.filter(m=>m.hp>0);

    for(let i=p.effects.length-1;i>=0;i--){
      p.effects[i].trn--;
      if(p.effects[i].trn<=0)p.effects.splice(i,1);
    }

    if(p.ring&&p.ring.ring==='regen'&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+1);
    if(p.effects.find(e=>e.type==='regen')&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+2);

    if(!p.alive&&p.deathTime&&now-p.deathTime>RESPAWN_MS)this.respawn(p);

    this.bcast(p.level);
  }

  chase(mon,target,lv,now){
    const dx=Math.sign(target.x-mon.x),dy=Math.sign(target.y-mon.y);
    const moves=Math.abs(target.x-mon.x)>Math.abs(target.y-mon.y)
      ?[{x:dx,y:0},{x:0,y:dy}]:[{x:0,y:dy},{x:dx,y:0}];
    for(const m of moves){
      const nx=mon.x+m.x,ny=mon.y+m.y;
      if(target.x===nx&&target.y===ny){this.mHit(mon,target);mon.lastAct=now;return;}
      if(this.canStand(nx,ny,lv)){mon.x=nx;mon.y=ny;mon.lastAct=now;return;}
    }
  }

  canStand(x,y,lv){
    if(x<0||x>=MAP_W||y<0||y>=MAP_H)return false;
    if(lv.tiles[y][x]===VOID||lv.tiles[y][x]===WALL)return false;
    for(const p of this.players.values())if(p.alive&&p.level===lv.lvl&&p.x===x&&p.y===y)return false;
    for(const m of lv.monsters)if(m.hp>0&&m.x===x&&m.y===y)return false;
    return true;
  }

  // ─── 移动 ───
  move(sid,dx,dy){
    const p=this.players.get(sid);
    if(!p||!p.alive)return;
    if(Date.now()-p.lastMove<MOVE_CD)return;
    p.lastMove=Date.now();

    const nx=p.x+dx,ny=p.y+dy;
    const lv=this.getLevel(p.level);
    if(!lv)return;

    // 不能走进虚空
    if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H||lv.tiles[ny][nx]===VOID){return;}
    if(lv.tiles[ny][nx]===WALL){
      const mon=lv.monsters.find(m=>m.hp>0&&m.x===nx&&m.y===ny);
      if(mon)this.pHit(p,mon,lv);
      this.acted(sid);return;
    }

    const mon=lv.monsters.find(m=>m.hp>0&&m.x===nx&&m.y===ny);
    if(mon){this.pHit(p,mon,lv);this.acted(sid);return;}

    for(const[oid,op]of this.players)
      if(oid!==sid&&op.alive&&op.level===p.level&&op.x===nx&&op.y===ny)return;

    p.x=nx;p.y=ny;

    const here=lv.items.filter(it=>it.x===nx&&it.y===ny);
    if(here.length)this.log(sid,`📦 地上：${here.map(i=>i.n).join('、')}。按 G 拾取。`);
    if(lv.tiles[ny][nx]===STAIRS_DOWN)this.log(sid,'⬇️ 下楼按 >');
    if(lv.tiles[ny][nx]===STAIRS_UP)this.log(sid,'⬆️ 上楼按 <');

    this.acted(sid);
  }

  // ─── 战斗 ───
  pHit(p,mon,lv){
    const wepDmg=p.weapon?p.weapon.dmg:'1d2';
    const wepAtk=p.weapon?(p.weapon.atk||0):0;
    const atk=p.str+wepAtk, def=mon.dx;
    const hit=atk/(atk+def+1);
    const crit=p.cls==='rogue'?Math.random()<0.28:Math.random()<0.15;

    if(Math.random()<hit){
      let dmg=roll(wepDmg)+Math.floor(p.str/4);
      if(crit){dmg=Math.floor(dmg*2);this.log(p.id,'💥 暴击！');}
      if(p.effects.find(e=>e.type==='breath')){dmg+=ri(8,18);this.log(p.id,'🔥 火焰吐息！');}
      mon.hp-=dmg;
      this.log(p.id,`⚔️ 对${mon.n}造成 ${dmg} 伤害。`);
      if(mon.hp<=0)this.killMon(mon,p,lv);
    }else{this.log(p.id,`💨 没有击中${mon.n}。`);}
    this.bcast(p.level);
  }

  killMon(mon,killer,lv){
    killer.xp+=mon.xp;killer.kills++;
    const g=ri(Math.floor(mon.xp/2),mon.xp*2);killer.gold+=g;

    const corpse={id:uid(),cat:'尸体',key:mon.key,n:`${mon.n}尸体`,e:'🍖',nut:400+ri(0,300),x:mon.x,y:mon.y,lv:mon.lvl};
    lv.items.push(corpse);
    if(Math.random()<0.45){const it=mkItem(ITEM_POOL(mon.lvl),mon.lvl,mon.x,mon.y);if(it)lv.items.push(it);}

    this.log(killer.id,`💀 击杀${mon.n}！+${mon.xp}XP +${g}金币`);
    const need=killer.lvl*140;
    if(killer.xp>=need){
      killer.lvl++;killer.maxHp+=ri(3,8);killer.hp=killer.maxHp;
      killer.str+=Math.random()<0.5?1:0;killer.dex+=Math.random()<0.5?1:0;
      killer.xp-=need;this.log(killer.id,`🎆 升级！${killer.lvl}级！`);this.logAll(`🎆 ${killer.name} 升到${killer.lvl}级！`);
    }
    if(mon.key==='nemesis'){this.nemesisDefeated++;this.logAll(`🏆 ${killer.name} 击败复仇女神！（${this.nemesisDefeated}次）`);}
  }

  mHit(mon,p){
    const atk=mon.st,def=p.dex+(p.armor?(p.armor.def||0):0);
    if(Math.random()<atk/(atk+def+1)){
      let dmg=ri(1,mon.st)+Math.floor(mon.st/4);
      if(mon.key==='dragon'&&Math.random()<0.3){dmg+=ri(5,16);this.log(p.id,'🔥 火龙喷出烈焰！');}
      if(mon.key==='nemesis'&&Math.random()<0.2){dmg+=ri(10,28);this.log(p.id,'💀 复仇女神释放暗黑能量！');}
      if(p.armor)dmg=Math.max(1,dmg-(p.armor.def||0));
      if(p.resists&&p.resists['火焰']&&mon.key==='dragon')dmg=Math.floor(dmg/2);
      p.hp-=dmg;
      this.log(p.id,`👊 ${mon.n}对你造成 ${dmg} 伤害！`);
      if(p.hp<=0){p.alive=false;p.hp=0;p.deathTime=Date.now();this.dropAll(p);this.log(p.id,`💀 你被${mon.n}杀死了！`);this.logAll(`💀 ${p.name}被${mon.n}击败。`);}
    }
  }

  // ─── 物品操作 ───
  pickup(sid){
    const p=this.players.get(sid);if(!p||!p.alive)return;
    const lv=this.getLevel(p.level);
    const here=lv.items.filter(it=>it.x===p.x&&it.y===p.y);
    if(!here.length){this.log(sid,'这里什么都没有。');return;}
    const it=here[0];lv.items=lv.items.filter(i=>i.id!==it.id);
    this.giveItem(p,it);this.log(sid,`✅ 拾取：${it.n}。`);this.acted(sid);
  }

  eat(sid,idx){
    const p=this.players.get(sid);if(!p||!p.alive)return;
    const lv=this.getLevel(p.level);

    if(idx===undefined||idx===null){
      const gf=lv.items.find(it=>it.x===p.x&&it.y===p.y&&(it.cat==='食物'||it.cat==='尸体'));
      if(gf){lv.items=lv.items.filter(i=>i.id!==gf.id);this.applyEat(p,gf);this.acted(sid);return;}
      const f=p.inv.find(it=>it.cat==='食物'||it.cat==='尸体');
      if(f){p.inv=p.inv.filter(i=>i.id!==f.id);this.applyEat(p,f);this.acted(sid);return;}
      this.log(sid,'没有可吃的东西。');return;
    }
    if(idx>=0&&idx<p.inv.length){const it=p.inv[idx];p.inv.splice(idx,1);this.applyEat(p,it);this.acted(sid);}
  }

  applyEat(p,it){
    if(it.cat==='食物'){const h=it.heal||0;if(h)p.hp=Math.min(p.maxHp,p.hp+h);this.log(p.id,`🍽️ 吃了${it.n}。${h?'+'+h+'HP':''}`);}
    else if(it.cat==='尸体'){
      p.hp=Math.min(p.maxHp,p.hp+ri(4,12));
      const fx=CORPSE[it.key];
      if(fx)for(const f of fx){if(f.pct&&Math.random()>f.pct)continue;
        switch(f.t){case'heal':p.hp=Math.min(p.maxHp,p.hp+f.v);break;case'resist':if(f.res==='全')Object.keys(p.resists).forEach(k=>p.resists[k]=true);else p.resists[f.res]=true;break;case'temp':p.effects.push({stat:f.stat,v:f.v,trn:f.trn});break;case'perm':p[f.stat]+=f.v;break;case'regen':p.effects.push({type:'regen',trn:f.trn});break;case'breath':p.effects.push({type:'breath',trn:f.trn});break;case'sick':p.hp-=ri(3,8);if(p.hp<=0)p.hp=1;break;}
        if(f.msg)this.log(p.id,f.msg);}
      this.log(p.id,`🍖 吞下了${it.n}。`);
    }else{p.hp-=ri(2,6);if(p.hp<=0)p.hp=1;this.log(p.id,`🤢 吃了${it.n}……坏事。（-HP）`);}
  }

  use(sid,idx){
    const p=this.players.get(sid);if(!p||!p.alive||idx<0||idx>=p.inv.length)return;
    const it=p.inv[idx];
    if(it.cat==='药水'){p.inv.splice(idx,1);if(it.fx==='heal'){p.hp=Math.min(p.maxHp,p.hp+(it.v||25));this.log(sid,`🧪 +${it.v||25}HP！`);}else if(it.fx==='str'){p.str+=1;this.log(sid,`💪 力量+1！(${p.str})`);}else if(it.fx==='dex'){p.dex+=1;this.log(sid,`💨 敏捷+1！(${p.dex})`);}}
    else if(it.cat==='卷轴'){p.inv.splice(idx,1);if(it.fx==='tele'){const lv=this.getLevel(p.level);const rm=rp(lv.rooms);p.x=rm.cx;p.y=rm.cy;this.log(sid,'✨ 传送！');}else if(it.fx==='ewep'&&p.weapon){p.weapon.atk=(p.weapon.atk||0)+1;this.log(sid,'⚔️ 武器+1');}else if(it.fx==='earm'&&p.armor){p.armor.def=(p.armor.def||0)+1;this.log(sid,'🛡️ 护甲+1');}else if(it.fx==='fire'){const lv=this.getLevel(p.level);lv.monsters.forEach(m=>{if(dist(m.x,m.y,p.x,p.y)<=3){m.hp-=ri(12,28);this.log(sid,`🔥 ${m.n}！`);}});lv.monsters=lv.monsters.filter(m=>m.hp>0);}}
    else{this.log(sid,'无法使用。');return;}
    this.acted(sid);
  }

  equip(sid,idx){
    const p=this.players.get(sid);if(!p||!p.alive||idx<0||idx>=p.inv.length)return;
    const it=p.inv[idx];
    if(it.cat!=='武器'&&it.cat!=='护甲'&&it.cat!=='戒指'){this.log(sid,'无法装备。');return;}
    p.inv.splice(idx,1);
    let old=null;
    if(it.cat==='武器'){old=p.weapon;p.weapon=it;}else if(it.cat==='护甲'){old=p.armor;p.armor=it;}else{old=p.ring;p.ring=it;}
    if(old)p.inv.push(old);
    this.log(sid,`⚔️ 装备：${it.n}。`);this.acted(sid);
  }

  drop(sid,idx){
    const p=this.players.get(sid);if(!p||!p.alive||idx<0||idx>=p.inv.length)return;
    const it=p.inv.splice(idx,1)[0];
    const lv=this.getLevel(p.level);it.x=p.x;it.y=p.y;it.lv=p.level;lv.items.push(it);
    this.log(sid,`🗑️ 丢弃：${it.n}。`);this.acted(sid);
  }

  unequip(sid,slot){
    const p=this.players.get(sid);if(!p||!p.alive)return;
    let item=null;
    if(slot==='weapon'){item=p.weapon;p.weapon=null;}else if(slot==='armor'){item=p.armor;p.armor=null;}else{item=p.ring;p.ring=null;}
    if(item){p.inv.push(item);this.log(sid,`卸下：${item.n}。`);}this.acted(sid);
  }

  // ─── 楼层 ───
  changeLevel(sid,dir){
    const p=this.players.get(sid);if(!p||!p.alive)return;
    const lv=this.getLevel(p.level);
    const tile=lv.tiles[p.y][p.x];

    if(dir==='down'&&tile===STAIRS_DOWN){
      p.level++;p.depth=Math.max(p.depth,p.level);
      const nl=this.getLevel(p.level);
      p.x=nl.firstRoom.cx;p.y=nl.firstRoom.cy;
      p.seenTiles=this.getVisibleTiles(p);
      this.log(sid,`⬇️ 下到第${p.level}层。`);
      this.bcast(p.level-1);
      this.sockets.get(sid)?.emit('newLevel',{map:nl.tiles,level:p.level,doors:nl.doors||[],doorMap:nl.doorMap||{}});
      this.bcast(p.level);this.logAll(`⬇️ ${p.name} 下到第${p.level}层。`);
    }else if(dir==='up'&&tile===STAIRS_UP&&p.level>1){
      p.level--;
      const nl=this.getLevel(p.level);
      p.x=nl.lastRoom.cx;p.y=nl.lastRoom.cy;
      p.seenTiles=this.getVisibleTiles(p);
      this.log(sid,`⬆️ 上到第${p.level}层。`);
      this.bcast(p.level+1);
      this.sockets.get(sid)?.emit('newLevel',{map:nl.tiles,level:p.level,doors:nl.doors||[],doorMap:nl.doorMap||{}});
      this.bcast(p.level);this.logAll(`⬆️ ${p.name} 上到第${p.level}层。`);
    }else{this.log(sid,'这里没有楼梯。');return;}
    this.acted(sid);
  }

  chat(sid,msg){
    const p=this.players.get(sid);if(!p||!msg.trim())return;
    this.io.emit('chat',{from:p.name,cls:p.cls,color:p.color,msg:msg.trim().slice(0,150)});
  }

  // ─── 网络 ───
  sendState(sock,lvl){if(!sock||!lvl)return;const lv=this.getLevel(lvl);if(!lv)return;
    sock.emit('gameState',{players:[...this.players.values()].filter(p=>p.alive&&p.level===lvl).map(p=>this.sanitize(p,false)),monsters:lv.monsters.filter(m=>m.hp>0).map(m=>({id:m.id,key:m.key,n:m.n,e:m.e,hp:m.hp,maxHp:m.maxHp,x:m.x,y:m.y})),items:lv.items.map(i=>({id:i.id,key:i.key||'',cat:i.cat,n:i.n,e:i.e||'📦',x:i.x,y:i.y})),level:lvl});}
  sync(sid){const p=this.players.get(sid);const s=this.sockets.get(sid);if(p&&s)s.emit('syncPlayer',this.sanitize(p,true));}
  bcast(lvl,exclude){if(!lvl)return;const lv=this.getLevel(lvl);if(!lv)return;
    const state={players:[...this.players.values()].filter(p=>p.alive&&p.level===lvl).map(p=>this.sanitize(p,false)),monsters:lv.monsters.filter(m=>m.hp>0).map(m=>({id:m.id,key:m.key,n:m.n,e:m.e,hp:m.hp,maxHp:m.maxHp,x:m.x,y:m.y})),items:lv.items.map(i=>({id:i.id,key:i.key||'',cat:i.cat,n:i.n,e:i.e||'📦',x:i.x,y:i.y})),level:lvl};
    for(const[sid,p]of this.players){if(p.level!==lvl)continue;if(sid===exclude)continue;this.sockets.get(sid)?.emit('gameState',state);}}
  sanitize(p,full){const b={id:p.id,name:p.name,cls:p.cls,color:p.color,lvl:p.lvl,hp:p.hp,maxHp:p.maxHp,str:p.str,dex:p.dex,gold:p.gold,x:p.x,y:p.y,alive:p.alive,kills:p.kills,depth:p.depth,wpn:p.weapon?{n:p.weapon.n,e:p.weapon.e,atk:p.weapon.atk||0,dmg:p.weapon.dmg}:null,arm:p.armor?{n:p.armor.n,e:p.armor.e,def:p.armor.def||0}:null,rng:p.ring?{n:p.ring.n,e:p.ring.e,ring:p.ring.ring,v:p.ring.v}:null};
    if(full){b.inv=p.inv.map(i=>({id:i.id,key:i.key,cat:i.cat,n:i.n,e:i.e||'📦',dmg:i.dmg,atk:i.atk,def:i.def,fx:i.fx,ring:i.ring,nut:i.nut,heal:i.heal}));b.effects=p.effects;b.resists=p.resists;b.xp=p.xp;b.weapon=p.weapon;b.armor=p.armor;b.ring=p.ring;b.seenTiles=p.seenTiles?[...p.seenTiles]:[];}return b;}
  log(sid,msg){this.sockets.get(sid)?.emit('log',{msg,time:Date.now()});}
  logAll(msg){this.io.emit('log',{msg,time:Date.now(),global:true});}

  hb(){
    const now=Date.now();
    for(const p of this.players.values()){
      if(!p.alive&&p.deathTime&&now-p.deathTime>RESPAWN_MS)this.respawn(p);
      if(p.effects.find(e=>e.type==='regen')&&p.alive&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+2);
    }
    const al=new Set();for(const p of this.players.values())if(p.alive)al.add(p.level);for(const l of al)this.bcast(l);
  }
}

// ═══════════════════════════════════
//  服务器启动
// ═══════════════════════════════════

const app=express();
const server=http.createServer(app);
const io=new Server(server,{transports:['websocket','polling'],pingTimeout:30000,pingInterval:12000,maxHttpBufferSize:1e6,allowEIO3:true});

app.use(express.static(__dirname));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/health',(req,res)=>res.status(200).send('ok'));

const game=new Game(io);

function wrap(sid,fn){try{fn();}catch(e){console.error(`[ERR] ${sid}:`,e.message);try{game.log(sid,'⚠️ 出错，请重试。');}catch(_){}}}

io.on('connection',socket=>{
  const sid=socket.id;
  console.log(`[~] ${sid}`);
  socket.on('join',d=>wrap(sid,()=>game.addPlayer(socket,d)));
  socket.on('move',d=>wrap(sid,()=>game.move(sid,(d&&d.dx)||0,(d&&d.dy)||0)));
  socket.on('pickup',()=>wrap(sid,()=>game.pickup(sid)));
  socket.on('use',d=>wrap(sid,()=>game.use(sid,d&&d.idx)));
  socket.on('equip',d=>wrap(sid,()=>game.equip(sid,d&&d.idx)));
  socket.on('drop',d=>wrap(sid,()=>game.drop(sid,d&&d.idx)));
  socket.on('eat',d=>wrap(sid,()=>game.eat(sid,d&&d.idx)));
  socket.on('unequip',d=>wrap(sid,()=>game.unequip(sid,d&&d.slot)));
  socket.on('descend',()=>wrap(sid,()=>game.changeLevel(sid,'down')));
  socket.on('ascend',()=>wrap(sid,()=>game.changeLevel(sid,'up')));
  socket.on('chat',d=>wrap(sid,()=>game.chat(sid,d&&d.msg)));
  socket.on('disconnect',()=>wrap(sid,()=>game.removePlayer(sid)));
  socket.on('error',e=>console.error(`[SOCK] ${sid}:`,e.message));
});

setInterval(()=>{try{game.hb();}catch(e){console.error('[HB]',e.message);}},2000);

process.on('uncaughtException',e=>console.error('[FATAL]',e.message,e.stack));
process.on('unhandledRejection',r=>console.error('[FATAL] Promise:',r));
process.on('SIGTERM',()=>{console.log('[EXIT]');server.close(()=>process.exit(0));});

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`🏰 Pathos 虚空地牢 监听 0.0.0.0:${PORT}`));
