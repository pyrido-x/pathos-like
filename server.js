'use strict';

// ═══════════════════════════════════════
//  Pathos 在线 — 种子地牢 · 假门 · 50层
// ═══════════════════════════════════════

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const VOID=0,WALL=1,FLOOR=2,CLOSED_DOOR=3,OPEN_DOOR=4,STAIRS_UP=5,STAIRS_DOWN=6;
const MW=80,MH=64,S=11,MCD=200,RSP=4000,MAX_DEPTH=50;
const ri=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const rp=a=>a[Math.floor(Math.random()*a.length)];
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const dist=(x1,y1,x2,y2)=>Math.abs(x2-x1)+Math.abs(y2-y1);
const roll=d=>{const[n,s]=d.split('d');let t=0;for(let i=0;i<+n;i++)t+=ri(1,+s);return t;};

// ═══════ 简单种子随机 ═══════
let _seed=0;
function srand(s){_seed=s;}
function sri(a,b){
  _seed=(_seed*1103515245+12345)&0x7fffffff;
  return a+(_seed%(b-a+1));
}
function srp(a){return a[sri(0,a.length-1)];}

// ═══════ 职业 ═══════
const CLS={warrior:{n:'战士',st:16,dx:10,hp:38,c:'#FF6B6B',w:'shortSword',a:'leatherArmor'},wizard:{n:'法师',st:8,dx:12,hp:22,c:'#6B9BFF',w:'dagger',a:null},rogue:{n:'盗贼',st:12,dx:18,hp:26,c:'#6BFF6B',w:'shortSword',a:null}};

// ═══════ 怪物 ═══════
const M={goblin:{n:'哥布林',e:'👺',hp:8,st:8,dx:10,xp:10,ml:1},giantRat:{n:'巨鼠',e:'🐀',hp:5,st:6,dx:14,xp:5,ml:1},bat:{n:'巨蝙蝠',e:'🦇',hp:6,st:5,dx:16,xp:7,ml:1},skeleton:{n:'骷髅兵',e:'💀',hp:12,st:10,dx:8,xp:15,ml:2},orc:{n:'兽人',e:'👹',hp:16,st:14,dx:9,xp:25,ml:2},slime:{n:'史莱姆',e:'🟢',hp:10,st:5,dx:4,xp:10,ml:2},troll:{n:'巨魔',e:'🧌',hp:32,st:18,dx:7,xp:80,ml:3},wraith:{n:'幽灵',e:'👻',hp:22,st:12,dx:14,xp:60,ml:4},dragon:{n:'火龙',e:'🐉',hp:55,st:24,dx:10,xp:350,ml:5},nemesis:{n:'复仇女神',e:'👁️',hp:90,st:28,dx:17,xp:1200,ml:6}};
function spawnP(lv){let p=[];for(const[k,m]of Object.entries(M)){if(m.ml>lv+1)continue;const w=k==='nemesis'?1:k==='dragon'?2:k==='troll'||k==='wraith'?3:8;for(let i=0;i<w;i++)p.push(k);}return p;}

const CORPSE={goblin:[{t:'heal',v:8,msg:'味道糟糕，但恢复了一些生命值。'}],giantRat:[{t:'sick',pc:0.3,msg:'你感到恶心……'},{t:'resist',r:'毒素',pc:0.12,msg:'获得了毒素抗性！'}],bat:[{t:'temp',st:'dex',v:2,trn:50,msg:'蝙蝠精华让你更加敏捷！'}],skeleton:[{t:'none',msg:'嘎嘣脆，没味道。'}],orc:[{t:'temp',st:'str',v:2,trn:50,msg:'兽人之力涌入体内！'}],slime:[{t:'sick',pc:0.35,msg:'史莱姆在你胃里翻腾！'},{t:'resist',r:'酸',pc:0.12,msg:'酸性抗性！'}],troll:[{t:'regen',trn:40,msg:'伤口正在愈合！'},{t:'temp',st:'str',v:3,trn:40,msg:'巨魔之力！'}],wraith:[{t:'sick',pc:0.3,msg:'暗影让你虚弱！'},{t:'perm',st:'str',v:1,pc:0.08,msg:'永久吸收了幽灵之力！'}],dragon:[{t:'resist',r:'火焰',pc:0.5,msg:'火焰伤不到你了！'},{t:'breath',trn:25,msg:'你可以喷吐火焰！'}],nemesis:[{t:'perm',st:'str',v:2,pc:0.6,msg:'复仇女神永久增强了你！'},{t:'resist',r:'全',pc:0.5,msg:'终极抗性！'}]};

const IT={dagger:{cat:'武器',n:'匕首',e:'🗡️',dmg:'1d4',atk:1},shortSword:{cat:'武器',n:'短剑',e:'⚔️',dmg:'1d6',atk:2},longSword:{cat:'武器',n:'长剑',e:'⚔️',dmg:'1d8',atk:3},battleAxe:{cat:'武器',n:'战斧',e:'🪓',dmg:'1d10',atk:3},magicStaff:{cat:'武器',n:'魔法杖',e:'🪄',dmg:'2d6',atk:5},leatherArmor:{cat:'护甲',n:'皮甲',e:'🛡️',def:2},chainmail:{cat:'护甲',n:'锁子甲',e:'🛡️',def:4},plateMail:{cat:'护甲',n:'板甲',e:'🛡️',def:6},dragonScale:{cat:'护甲',n:'龙鳞甲',e:'🛡️',def:8},healPotion:{cat:'药水',n:'治疗药水',e:'🧪',fx:'heal',v:25},fullHeal:{cat:'药水',n:'完全治疗',e:'🧪',fx:'heal',v:999},strPotion:{cat:'药水',n:'力量药水',e:'💪',fx:'str'},dexPotion:{cat:'药水',n:'敏捷药水',e:'💨',fx:'dex'},teleScroll:{cat:'卷轴',n:'传送卷轴',e:'📜',fx:'tele'},enchWep:{cat:'卷轴',n:'附魔武器',e:'📜',fx:'ewep'},enchArm:{cat:'卷轴',n:'附魔护甲',e:'📜',fx:'earm'},fireScroll:{cat:'卷轴',n:'火焰卷轴',e:'🔥',fx:'fire'},ration:{cat:'食物',n:'口粮',e:'🍞',nut:800},apple:{cat:'食物',n:'苹果',e:'🍎',nut:150,heal:8},bread:{cat:'食物',n:'面包',e:'🥖',nut:400},ringStr:{cat:'戒指',n:'力量戒指',e:'💍',ring:'str',v:2},ringDex:{cat:'戒指',n:'敏捷戒指',e:'💍',ring:'dex',v:2},ringProt:{cat:'戒指',n:'防护戒指',e:'💍',ring:'def',v:2},ringRegen:{cat:'戒指',n:'再生戒指',e:'💍',ring:'regen',v:1}};
function mkIt(k,lv,x,y){const t=IT[k];if(!t)return null;return{id:uid(),key:k,...JSON.parse(JSON.stringify(t)),lv,x,y};}
const IP=(()=>{const c=['ration','apple','bread','healPotion','dagger'],u=['shortSword','leatherArmor','strPotion','dexPotion','teleScroll','ringStr','ringDex'],r=['longSword','chainmail','enchWep','enchArm','fullHeal','fireScroll','ringProt'],e=['battleAxe','magicStaff','plateMail','dragonScale','ringRegen'];return lv=>{let p=[...c];if(lv>=2)p.push(...u);if(lv>=3)p.push(...r);if(lv>=5)p.push(...e);return rp(p);};})();

// ═════════════════════════════════════════════
//  种子地牢生成器
//  1. 在3×3九宫格生成四面封闭房间
//  2. 房间之间加横竖走廊
//  3. 走廊与房间交点替换为门
//  4. 随机假门 (fake door)
// ═════════════════════════════════════════════

function genDungeon(lv){
  const seed=lv*7919+lv*lv*6271; // 每层不同的种子
  srand(seed);

  const T=Array.from({length:MH},()=>Array.from({length:MW},()=>VOID));

  // ── 第一步：3×3 分区生成房间 ──
  const GW=Math.floor(MW/3), GH=Math.floor(MH/3);
  const rooms=[], rDoors=[]; // roomDoors index→[]
  const allDoors=[]; // {x,y,roomIdx,isFake}

  for(let gy=0;gy<3;gy++){
    for(let gx=0;gx<3;gx++){
      const zx=gx*GW+2, zy=gy*GH+2;
      const zw=GW-4, zh=GH-4;
      const rw=sri(7,Math.min(16,zw-2)), rh=sri(5,Math.min(12,zh-2));
      const rx=zx+sri(0,Math.max(0,zw-rw)), ry=zy+sri(0,Math.max(0,zh-rh));

      // 画围墙
      for(let y=ry-1;y<=ry+rh;y++)for(let x=rx-1;x<=rx+rw;x++)
        if(y>=0&&y<MH&&x>=0&&x<MW)T[y][x]=WALL;
      // 挖空内部
      for(let y=ry;y<ry+rh;y++)for(let x=rx;x<rx+rw;x++)T[y][x]=FLOOR;

      const idx=rooms.length;
      rooms.push({x:rx,y:ry,w:rw,h:rh,cx:Math.floor(rx+rw/2),cy:Math.floor(ry+rh/2),idx,gx,gy});
    }
  }

  // ── 第二步：添加走廊（先在墙上打洞形成门，然后铺地板连接）──
  // 走廊方向：水平 (y固定) 从房间A的右边墙到房间B的左边墙
  // 或垂直 (x固定) 从房间A的下边墙到房间B的上边墙

  // 收集每对房间之间可能的连接
  const connections=[];
  for(let i=0;i<rooms.length;i++){
    for(let j=i+1;j<rooms.length;j++){
      const ri2=rooms[i], rj=rooms[j];
      // 水平走廊：如果它们在相邻列且有垂直重叠
      if(Math.abs(ri2.gx-rj.gx)>=1){
        // 找到垂直重叠区域
        const top=Math.max(ri2.y, rj.y)+1;
        const bot=Math.min(ri2.y+ri2.h, rj.y+rj.h)-1;
        if(top<=bot){
          const cy=sri(top,bot);
          connections.push({a:i,b:j,type:'h', cy});
        }
      }
      // 垂直走廊：如果它们在相邻行且有水平重叠
      if(Math.abs(ri2.gy-rj.gy)>=1){
        const left=Math.max(ri2.x, rj.x)+1;
        const right=Math.min(ri2.x+ri2.w, rj.x+rj.w)-1;
        if(left<=right){
          const cx=sri(left,right);
          connections.push({a:i,b:j,type:'v', cx});
        }
      }
    }
  }

  // MST连通
  const uf=Array.from({length:rooms.length},(_,i)=>i);
  const find=x=>uf[x]===x?x:(uf[x]=find(uf[x]));
  const uni=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb){uf[ra]=rb;return true;}return false;};
  const mst=[];
  // 随机排序
  for(let i=connections.length-1;i>0;i--){const j=sri(0,i);[connections[i],connections[j]]=[connections[j],connections[i]];}
  for(const c of connections) if(uni(c.a,c.b)) mst.push(c);

  // ── 挖走廊 + 打门 ──
  const corridors=[]; // {path:[], doorA:{x,y}, doorB:{x,y}, roomA, roomB}
  const usedRoomPairs=new Set();

  for(const conn of mst){
    const rA=rooms[conn.a], rB=rooms[conn.b];
    const pk=`${Math.min(conn.a,conn.b)}_${Math.max(conn.a,conn.b)}`;
    if(usedRoomPairs.has(pk)) continue;
    usedRoomPairs.add(pk);

    let doorA, doorB;
    const path=[];
    const isH=conn.type==='h';

    if(isH){
      // 水平走廊
      const cy=conn.cy;
      const leftRoom=rA.cx<rB.cx?rA:rB;
      const rightRoom=rA.cx<rB.cx?rA:rB;
      // 左边房间的右墙
      doorA={x:leftRoom.x+leftRoom.w, y:cy, roomIdx:leftRoom.idx};
      // 右边房间的左墙
      doorB={x:rightRoom.x-1, y:cy, roomIdx:rightRoom.idx};
      // 走廊地板
      for(let x=doorA.x+1;x<doorB.x;x++) path.push({x,y:cy});
    }else{
      // 垂直走廊
      const cx=conn.cx;
      const topRoom=rA.cy<rB.cy?rA:rB;
      const botRoom=rA.cy<rB.cy?rA:rB;
      doorA={x:cx, y:topRoom.y+topRoom.h, roomIdx:topRoom.idx};
      doorB={x:cx, y:botRoom.y-1, roomIdx:botRoom.idx};
      for(let y=doorA.y+1;y<doorB.y;y++) path.push({x:cx,y});
    }

    // 检查门是否在墙上
    if(doorA.x>0&&doorA.x<MW-1&&doorA.y>0&&doorA.y<MH-1&&
       doorB.x>0&&doorB.x<MW-1&&doorB.y>0&&doorB.y<MH-1){
      T[doorA.y][doorA.x]=CLOSED_DOOR;
      T[doorB.y][doorB.x]=CLOSED_DOOR;
      allDoors.push({...doorA,isFake:false});
      allDoors.push({...doorB,isFake:false});
      // 挖走廊
      for(const p of path) if(T[p.y][p.x]===VOID) T[p.y][p.x]=FLOOR;
      corridors.push({path, doorA, doorB, roomA:conn.a, roomB:conn.b});
    }
  }

  // ── 为每个房间建门列表 ──
  const roomDoors=Array.from({length:rooms.length},()=>[]);
  for(const d of allDoors) if(!d.isFake) roomDoors[d.roomIdx].push(d);

  // ── 第三步：假门 ──
  // 每个房间有1~3面假门：墙变成门，后面挖一格地板
  const fakeTraps=[]; // [{x,y, type:'empty'|'loot'|'monster'|'trap'}]
  for(const r of rooms){
    const nFake=sri(1,3);
    // 收集候选墙壁（排除已有真门、角落）
    const candidates=[];
    for(let x=r.x;x<r.x+r.w;x++){
      if(T[r.y-1][x]===WALL && !allDoors.some(d=>d.x===x&&d.y===r.y-1)) candidates.push({x,y:r.y-1,side:'top'});
      if(T[r.y+r.h][x]===WALL && !allDoors.some(d=>d.x===x&&d.y===r.y+r.h)) candidates.push({x,y:r.y+r.h,side:'bot'});
    }
    for(let y=r.y;y<r.y+r.h;y++){
      if(T[y][r.x-1]===WALL && !allDoors.some(d=>d.x===r.x-1&&d.y===y)) candidates.push({x:r.x-1,y,side:'left'});
      if(T[y][r.x+r.w]===WALL && !allDoors.some(d=>d.x===r.x+r.w&&d.y===y)) candidates.push({x:r.x+r.w,y,side:'right'});
    }
    // 选nFake个
    for(let fi=0;fi<nFake&&candidates.length>0;fi++){
      const ci=sri(0,candidates.length-1);
      const w=candidates.splice(ci,1)[0];
      // 标记为假门
      T[w.y][w.x]=CLOSED_DOOR;
      allDoors.push({x:w.x,y:w.y,roomIdx:r.idx,isFake:true});
      roomDoors[r.idx].push({x:w.x,y:w.y,roomIdx:r.idx,isFake:true});

      // 后面挖一个格子
      let bx=w.x, by=w.y;
      if(w.side==='top') by--;
      else if(w.side==='bot') by++;
      else if(w.side==='left') bx--;
      else bx++;
      if(bx>0&&bx<MW-1&&by>0&&by<MH-1 && T[by][bx]===VOID){
        T[by][bx]=FLOOR;
        // 决定内容物
        const roll2=Math.random();
        if(roll2<0.25) fakeTraps.push({x:bx,y:by,type:'loot'});
        else if(roll2<0.50) fakeTraps.push({x:bx,y:by,type:'monster'});
        else if(roll2<0.60) fakeTraps.push({x:bx,y:by,type:'trap'});
        else fakeTraps.push({x:bx,y:by,type:'empty'});
      }
    }
  }

  // ── doorMap：每扇真门连到哪里 ──
  const doorMap={};
  for(const d of allDoors) doorMap[`${d.x},${d.y}`]=[];
  for(const c of corridors){
    const ka=`${c.doorA.x},${c.doorA.y}`, kb=`${c.doorB.x},${c.doorB.y}`;
    if(doorMap[ka]) doorMap[ka].push({door:{x:c.doorB.x,y:c.doorB.y},path:c.path});
    if(doorMap[kb]) doorMap[kb].push({door:{x:c.doorA.x,y:c.doorA.y},path:c.path});
  }

  // ── 楼梯 ──
  const upIdx=srp([...Array(9).keys()]);
  const dnIdx=srp([...Array(9).keys()].filter(i=>i!==upIdx));
  T[rooms[upIdx].cy][rooms[upIdx].cx]=STAIRS_UP;
  T[rooms[dnIdx].cy][rooms[dnIdx].cx]=STAIRS_DOWN;

  // ── 怪物（在房间内） ──
  const mons=[], pool=spawnP(lv);
  for(let i=0;i<sri(5,10)+lv*2;i++){
    const rm=rp(rooms);
    const mx=sri(rm.x+1,rm.x+rm.w-2), my=sri(rm.y+1,rm.y+rm.h-2);
    if(T[my]&&T[my][mx]===FLOOR)mons.push({id:uid(),key:rp(pool),x:mx,y:my,lv,hp:0,mhp:0,st:0,dx:0,xp:0,n:'',e:'',la:0});
  }
  for(const m of mons){const t=M[m.key];if(!t)continue;m.n=t.n;m.e=t.e;m.mhp=t.hp+sri(-3,5);m.hp=m.mhp;m.st=t.st;m.dx=t.dx;m.xp=t.xp;}

  // 假门陷阱里的怪物
  for(const ft of fakeTraps){
    if(ft.type==='monster'){
      const key=srp(pool);
      const t=M[key]; if(!t)continue;
      mons.push({id:uid(),key,x:ft.x,y:ft.y,lv,n:t.n,e:t.e,hp:t.hp+sri(-2,4),mhp:t.hp,st:t.st,dx:t.dx,xp:t.xp,la:0});
    }else if(ft.type==='trap'){
      mons.push({id:uid(),key:'slime',x:ft.x,y:ft.y,lv,n:'陷阱',e:'🕳️',hp:1,mhp:1,st:5,dx:0,xp:3,la:0,isTrap:true});
    }
  }

  // ── 物品 ──
  const items=[];
  for(let i=0;i<sri(14,24);i++){
    const rm=rp(rooms);
    const ix=sri(rm.x+1,rm.x+rm.w-2), iy=sri(rm.y+1,rm.y+rm.h-2);
    if(T[iy]&&T[iy][ix]===FLOOR){const it=mkIt(IP(lv),lv,ix,iy);if(it)items.push(it);}
  }
  // 假门里的战利品
  for(const ft of fakeTraps){
    if(ft.type==='loot'){
      const it=mkIt(IP(lv),lv,ft.x,ft.y); if(it) items.push(it);
    }else if(ft.type==='trap'){
      // 陷阱里有金币
      items.push({id:uid(),cat:'食物',n:'金币堆',e:'💰',nut:0,heal:0,x:ft.x,y:ft.y,lv});
    }
  }

  // ── if a room has no doors at all, force one ──
  for(let i=0;i<rooms.length;i++){
    if(!roomDoors[i].length){
      const r=rooms[i];
      // put a door on the right wall
      const dx=r.x+r.w, dy=r.cy;
      T[dy][dx]=CLOSED_DOOR;
      allDoors.push({x:dx,y:dy,roomIdx:i,isFake:false});
      roomDoors[i].push({x:dx,y:dy,roomIdx:i,isFake:false});
      // 挖一条短走廊连接虚空……但这个房间已经孤立了，至少有个门
    }
  }

  const openDoors=new Set();
  return {tiles:T,rooms,monsters:mons,items,lvl:lv,doors:allDoors,doorMap,corridors,openDoors,upRoom:rooms[upIdx],downRoom:rooms[dnIdx]};
}

// ═════════════════════════════════════════════
//  游戏服务器（同前）
// ═════════════════════════════════════════════

class Game {
  constructor(io){this.io=io;this.players=new Map();this.levels=new Map();this.socks=new Map();this.nd=0;}
  gl(n){if(!this.levels.has(n))this.levels.set(n,genDungeon(n));return this.levels.get(n);}

  openDoor(lv,dx,dy,seen){
    const k=`${dx},${dy}`; lv.openDoors.add(k); seen.add(k);
    const linked=lv.doorMap[k]||[];
    for(const {door,path} of linked){
      for(const p of path) seen.add(`${p.x},${p.y}`);
      seen.add(`${door.x},${door.y}`);
    }
    const curRoom=this.findRoom(lv,dx,dy);
    if(curRoom>=0) this.revealRoom(lv,curRoom,seen);
  }

  enterRoom(lv,x,y,seen){
    const ri2=this.findRoom(lv,x,y);if(ri2>=0)this.revealRoom(lv,ri2,seen);
  }

  revealRoom(lv,ri2,seen){
    const r=lv.rooms[ri2];
    for(let y=r.y-1;y<=r.y+r.h;y++)for(let x=r.x-1;x<=r.x+r.w;x++)if(x>=0&&x<MW&&y>=0&&y<MH&&lv.tiles[y][x]!==VOID)seen.add(`${x},${y}`);
  }

  findRoom(lv,x,y){
    for(let i=0;i<lv.rooms.length;i++){const r=lv.rooms[i];if(x>=r.x-1&&x<=r.x+r.w&&y>=r.y-1&&y<=r.y+r.h)return i;}return -1;
  }

  addPlayer(sock,d){
    const nm=(d.name||'冒险者').slice(0,12),cl=CLS[d.class]?d.class:'warrior',t=CLS[cl],lv=this.gl(1);
    const p={id:sock.id,name:nm,cls:cl,color:t.c,str:t.st,dex:t.dx,hp:t.hp,mhp:t.hp,lvl:1,xp:0,gold:0,kills:0,depth:1,level:1,x:lv.upRoom.cx,y:lv.upRoom.cy,alive:true,dt:0,lm:0,inv:[],weapon:null,armor:null,ring:null,res:{火焰:false,冰霜:false,毒素:false,闪电:false,酸:false},eff:[],seenTiles:new Set(),escaped:false};
    if(t.w)this.gi(p,mkIt(t.w,1));if(t.a)this.gi(p,mkIt(t.a,1));this.gi(p,mkIt('ration',1));this.gi(p,mkIt('bread',1));
    this.enterRoom(lv,p.x,p.y,p.seenTiles);
    this.players.set(sock.id,p);this.socks.set(sock.id,sock);
    sock.emit('welcome',{you:this.san(p,true),map:lv.tiles,level:1,openDoors:[...lv.openDoors],fakeDoors:lv.doors.filter(d=>d.isFake).map(d=>({x:d.x,y:d.y}))});
    this.ss(sock,1);this.bc(1,sock.id);
    this.lg(sock.id,`🎉 欢迎，${nm}！`);this.la(`👋 ${nm}（${t.n}）进入了地牢。`);
  }

  rm(sid){const p=this.players.get(sid);if(!p)return;if(p.alive)this.da(p);const l=p.level;this.players.delete(sid);this.socks.delete(sid);if(l)this.bc(l);this.la(`👋 ${p.name} 离开了。`);}
  rp(p){const lv=this.gl(p.level);p.alive=true;p.hp=p.mhp;p.x=lv.upRoom.cx;p.y=lv.upRoom.cy;p.eff=[];p.gold=Math.floor(p.gold*0.75);this.lg(p.id,'🔄 已复活。');this.bc(p.level);}
  da(p){const lv=this.gl(p.level);for(const it of p.inv){it.x=p.x;it.y=p.y;it.lv=p.level;lv.items.push(it);}if(p.weapon){p.weapon.x=p.x;p.weapon.y=p.y;p.weapon.lv=p.level;lv.items.push(p.weapon);}if(p.armor){p.armor.x=p.x;p.armor.y=p.y;p.armor.lv=p.level;lv.items.push(p.armor);}if(p.ring){p.ring.x=p.x;p.ring.y=p.y;p.ring.lv=p.level;lv.items.push(p.ring);}p.inv=[];p.weapon=null;p.armor=null;p.ring=null;}
  gi(p,it){if(!it)return;delete it.x;delete it.y;delete it.lv;if(it.cat==='武器'&&!p.weapon){p.weapon=it}else if(it.cat==='护甲'&&!p.armor){p.armor=it}else if(it.cat==='戒指'&&!p.ring){p.ring=it}else{p.inv.push(it)}}

  act(sid){const p=this.players.get(sid);if(!p||!p.alive)return;this.et(sid);this.sy(sid);}
  et(sid){const p=this.players.get(sid);if(!p||!p.alive)return;const lv=this.gl(p.level);if(!lv||!lv.monsters)return;const now=Date.now();
    for(const m of lv.monsters){if(m.hp<=0)continue;if(now-(m.la||0)<450)continue;const d=dist(m.x,m.y,p.x,p.y);if(d>S+2)continue;if(d<=1){this.mh(m,p);m.la=now;}else if(d<=S+2)this.ch(m,p,lv,now);}
    lv.monsters=lv.monsters.filter(m=>m.hp>0);
    for(let i=p.eff.length-1;i>=0;i--){p.eff[i].trn--;if(p.eff[i].trn<=0)p.eff.splice(i,1);}
    if(p.ring&&p.ring.ring==='regen'&&p.hp<p.mhp)p.hp=Math.min(p.mhp,p.hp+1);
    if(p.eff.find(e=>e.type==='regen')&&p.hp<p.mhp)p.hp=Math.min(p.mhp,p.hp+2);
    if(!p.alive&&p.dt&&now-p.dt>RSP)this.rp(p);this.bc(p.level);}

  ch(m,tg,lv,now){const dx=Math.sign(tg.x-m.x),dy=Math.sign(tg.y-m.y);const mv=Math.abs(tg.x-m.x)>Math.abs(tg.y-m.y)?[{x:dx,y:0},{x:0,y:dy}]:[{x:0,y:dy},{x:dx,y:0}];for(const s of mv){const nx=m.x+s.x,ny=m.y+s.y;if(tg.x===nx&&tg.y===ny){this.mh(m,tg);m.la=now;return;}if(this.cs(nx,ny,lv)){m.x=nx;m.y=ny;m.la=now;return;}}}
  cs(x,y,lv){if(x<0||x>=MW||y<0||y>=MH)return false;if(lv.tiles[y][x]===VOID||lv.tiles[y][x]===WALL)return false;if(lv.tiles[y][x]===CLOSED_DOOR)return false;for(const p of this.players.values())if(p.alive&&p.level===lv.lvl&&p.x===x&&p.y===y)return false;for(const m of lv.monsters)if(m.hp>0&&m.x===x&&m.y===y)return false;return true;}

  mv(sid,dx,dy){
    const p=this.players.get(sid);if(!p||!p.alive)return;if(Date.now()-p.lm<MCD)return;p.lm=Date.now();
    const nx=p.x+dx,ny=p.y+dy,lv=this.gl(p.level);if(!lv)return;
    if(nx<0||nx>=MW||ny<0||ny>=MH||lv.tiles[ny][nx]===VOID)return;

    if(lv.tiles[ny][nx]===CLOSED_DOOR){
      this.openDoor(lv,nx,ny,p.seenTiles);lv.tiles[ny][nx]=OPEN_DOOR;p.x=nx;p.y=ny;
      this.enterRoom(lv,nx,ny,p.seenTiles);
      this.lg(sid,'🚪 你推开了门。');this.ss(this.socks.get(sid),p.level);this.act(sid);return;
    }
    if(lv.tiles[ny][nx]===WALL){const mon=lv.monsters.find(m=>m.hp>0&&m.x===nx&&m.y===ny);if(mon)this.ph(p,mon,lv);this.act(sid);return;}
    const mon=lv.monsters.find(m=>m.hp>0&&m.x===nx&&m.y===ny);if(mon){this.ph(p,mon,lv);this.act(sid);return;}
    for(const[oi,op]of this.players)if(oi!==sid&&op.alive&&op.level===p.level&&op.x===nx&&op.y===ny)return;
    p.x=nx;p.y=ny;
    const oldRoom=this.findRoom(lv,p.x-dx,p.y-dy),newRoom=this.findRoom(lv,nx,ny);
    if(newRoom>=0&&newRoom!==oldRoom)this.enterRoom(lv,nx,ny,p.seenTiles);
    const here=lv.items.filter(it=>it.x===nx&&it.y===ny);if(here.length)this.lg(sid,`📦 地上：${here.map(i=>i.n).join('、')}。按G拾取。`);
    if(lv.tiles[ny][nx]===STAIRS_DOWN||lv.tiles[ny][nx]===STAIRS_UP)this.lg(sid,lv.tiles[ny][nx]===STAIRS_DOWN?'⬇️ 按>下楼':'⬆️ 按<上楼');
    this.act(sid);
  }

  ph(p,mon,lv){const wd=p.weapon?p.weapon.dmg:'1d2',wa=p.weapon?(p.weapon.atk||0):0,atk=p.str+wa,def=mon.dx,hit=atk/(atk+def+1),crit=p.cls==='rogue'?Math.random()<0.28:Math.random()<0.15;if(Math.random()<hit){let dmg=roll(wd)+Math.floor(p.str/4);if(crit){dmg=Math.floor(dmg*2);this.lg(p.id,'💥 暴击！');}if(p.eff.find(e=>e.type==='breath')){dmg+=ri(8,18);this.lg(p.id,'🔥 火焰吐息！');}mon.hp-=dmg;this.lg(p.id,`⚔️ 对${mon.n}造成${dmg}伤害。`);if(mon.hp<=0)this.km(mon,p,lv);}else{this.lg(p.id,`💨 没击中${mon.n}。`);}this.bc(p.level);}
  km(mon,killer,lv){killer.xp+=mon.xp;killer.kills++;const g=ri(Math.floor(mon.xp/2),mon.xp*2);killer.gold+=g;const cp={id:uid(),cat:'尸体',key:mon.key,n:`${mon.n}尸体`,e:'🍖',nut:400+ri(0,300),x:mon.x,y:mon.y,lv:mon.lvl};lv.items.push(cp);if(Math.random()<0.45){const it=mkIt(IP(mon.lvl),mon.lvl,mon.x,mon.y);if(it)lv.items.push(it);}this.lg(killer.id,`💀 击杀${mon.n}！+${mon.xp}XP +${g}💰`);const nd=killer.lvl*140;if(killer.xp>=nd){killer.lvl++;killer.mhp+=ri(3,8);killer.hp=killer.mhp;killer.str+=Math.random()<0.5?1:0;killer.dex+=Math.random()<0.5?1:0;killer.xp-=nd;this.lg(killer.id,`🎆 升级！${killer.lvl}级！`);this.la(`🎆 ${killer.name}升到${killer.lvl}级！`);}if(mon.key==='nemesis'){this.nd++;this.la(`🏆 ${killer.name}击败复仇女神！(${this.nd}次)`);}}
  mh(mon,p){const atk=mon.st,def=p.dex+(p.armor?(p.armor.def||0):0);if(Math.random()<atk/(atk+def+1)){let dmg=ri(1,mon.st)+Math.floor(mon.st/4);if(mon.key==='dragon'&&Math.random()<0.3){dmg+=ri(5,16);this.lg(p.id,'🔥 火龙喷火！');}if(mon.key==='nemesis'&&Math.random()<0.2){dmg+=ri(10,28);this.lg(p.id,'💀 复仇女神释放暗黑能量！');}if(p.armor)dmg=Math.max(1,dmg-(p.armor.def||0));if(p.res&&p.res['火焰']&&mon.key==='dragon')dmg=Math.floor(dmg/2);p.hp-=dmg;this.lg(p.id,`👊 ${mon.n}对你造成${dmg}伤害！`);if(p.hp<=0){p.alive=false;p.hp=0;p.dt=Date.now();this.da(p);this.lg(p.id,`💀 你被${mon.n}杀死了！`);this.la(`💀 ${p.name}被${mon.n}击败。`);}}}

  pk(sid){const p=this.players.get(sid);if(!p||!p.alive)return;const lv=this.gl(p.level);const h=lv.items.filter(it=>it.x===p.x&&it.y===p.y);if(!h.length){this.lg(sid,'这里什么都没有。');return;}const it=h[0];lv.items=lv.items.filter(i=>i.id!==it.id);this.gi(p,it);this.lg(sid,`✅ 拾取：${it.n}。`);this.act(sid);}
  et2(sid,idx){const p=this.players.get(sid);if(!p||!p.alive)return;const lv=this.gl(p.level);if(idx===undefined||idx===null){const gf=lv.items.find(it=>it.x===p.x&&it.y===p.y&&(it.cat==='食物'||it.cat==='尸体'));if(gf){lv.items=lv.items.filter(i=>i.id!==gf.id);this.ae(p,gf);this.act(sid);return;}const f=p.inv.find(it=>it.cat==='食物'||it.cat==='尸体');if(f){p.inv=p.inv.filter(i=>i.id!==f.id);this.ae(p,f);this.act(sid);return;}this.lg(sid,'没有可吃的。');return;}if(idx>=0&&idx<p.inv.length){const it=p.inv[idx];p.inv.splice(idx,1);this.ae(p,it);this.act(sid);}}
  ae(p,it){if(it.cat==='食物'){const h=it.heal||0;if(h)p.hp=Math.min(p.mhp,p.hp+h);this.lg(p.id,`🍽️ 吃了${it.n}。${h?'+'+h+'HP':''}`);}else if(it.cat==='尸体'){p.hp=Math.min(p.mhp,p.hp+ri(4,12));const fx=CORPSE[it.key];if(fx)for(const f of fx){if(f.pc&&Math.random()>f.pc)continue;switch(f.t){case'heal':p.hp=Math.min(p.mhp,p.hp+f.v);break;case'resist':if(f.r==='全')Object.keys(p.res).forEach(k=>p.res[k]=true);else p.res[f.r]=true;break;case'temp':p.eff.push({st:f.st,v:f.v,trn:f.trn});break;case'perm':p[f.st]+=f.v;break;case'regen':p.eff.push({type:'regen',trn:f.trn});break;case'breath':p.eff.push({type:'breath',trn:f.trn});break;case'sick':p.hp-=ri(3,8);if(p.hp<=0)p.hp=1;break;}if(f.msg)this.lg(p.id,f.msg);}this.lg(p.id,`🍖 吞下${it.n}。`);}else{p.hp-=ri(2,6);if(p.hp<=0)p.hp=1;this.lg(p.id,`🤢 吃${it.n}……坏主意。（-HP）`);}}
  use(sid,idx){const p=this.players.get(sid);if(!p||!p.alive||idx<0||idx>=p.inv.length)return;const it=p.inv[idx];if(it.cat==='药水'){p.inv.splice(idx,1);if(it.fx==='heal'){p.hp=Math.min(p.mhp,p.hp+(it.v||25));this.lg(sid,`🧪 +${it.v||25}HP！`)}else if(it.fx==='str'){p.str+=1;this.lg(sid,`💪 力量+1！(${p.str})`)}else if(it.fx==='dex'){p.dex+=1;this.lg(sid,`💨 敏捷+1！(${p.dex})`)}}else if(it.cat==='卷轴'){p.inv.splice(idx,1);if(it.fx==='tele'){const lv=this.gl(p.level);const rm=rp(lv.rooms);p.x=rm.cx;p.y=rm.cy;this.lg(sid,'✨ 传送！');}else if(it.fx==='ewep'&&p.weapon){p.weapon.atk=(p.weapon.atk||0)+1;this.lg(sid,'⚔️ 武器+1');}else if(it.fx==='earm'&&p.armor){p.armor.def=(p.armor.def||0)+1;this.lg(sid,'🛡️ 护甲+1');}else if(it.fx==='fire'){const lv=this.gl(p.level);lv.monsters.forEach(m=>{if(dist(m.x,m.y,p.x,p.y)<=3){m.hp-=ri(12,28);this.lg(sid,`🔥 ${m.n}！`)}});lv.monsters=lv.monsters.filter(m=>m.hp>0);}}else{this.lg(sid,'无法使用。');return;}this.act(sid);}
  eq(sid,idx){const p=this.players.get(sid);if(!p||!p.alive||idx<0||idx>=p.inv.length)return;const it=p.inv[idx];if(it.cat!=='武器'&&it.cat!=='护甲'&&it.cat!=='戒指'){this.lg(sid,'无法装备。');return;}p.inv.splice(idx,1);let old=null;if(it.cat==='武器'){old=p.weapon;p.weapon=it}else if(it.cat==='护甲'){old=p.armor;p.armor=it}else{old=p.ring;p.ring=it}if(old)p.inv.push(old);this.lg(sid,`⚔️ 装备：${it.n}。`);this.act(sid);}
  dr(sid,idx){const p=this.players.get(sid);if(!p||!p.alive||idx<0||idx>=p.inv.length)return;const it=p.inv.splice(idx,1)[0];const lv=this.gl(p.level);it.x=p.x;it.y=p.y;it.lv=p.level;lv.items.push(it);this.lg(sid,`🗑️ 丢弃：${it.n}。`);this.act(sid);}
  ue(sid,slot){const p=this.players.get(sid);if(!p||!p.alive)return;let item=null;if(slot==='weapon'){item=p.weapon;p.weapon=null}else if(slot==='armor'){item=p.armor;p.armor=null}else{item=p.ring;p.ring=null}if(item){p.inv.push(item);this.lg(sid,`卸下：${item.n}。`);}this.act(sid);}

  cl(sid,dir){
    const p=this.players.get(sid);if(!p||!p.alive)return;const lv=this.gl(p.level);const tile=lv.tiles[p.y][p.x];
    if(dir==='down'&&tile===STAIRS_DOWN){if(p.level>=MAX_DEPTH){this.lg(sid,'⚠️ 已是最深处。');return;}p.level++;p.depth=Math.max(p.depth,p.level);const nl=this.gl(p.level);p.x=nl.upRoom.cx;p.y=nl.upRoom.cy;p.seenTiles=new Set();this.enterRoom(nl,p.x,p.y,p.seenTiles);this.lg(sid,`⬇️ 第${p.level}/${MAX_DEPTH}层`);this.bc(p.level-1);this.socks.get(sid)?.emit('newLevel',{map:nl.tiles,level:p.level,openDoors:[...nl.openDoors]});this.bc(p.level);this.la(`⬇️ ${p.name}下到第${p.level}层。`);}
    else if(dir==='up'&&tile===STAIRS_UP){if(p.level===1){p.escaped=true;p.alive=false;const sc=this.calcScore(p);this.lg(sid,'🏆 你逃出了地牢！');this.lg(sid,`📊 得分: ${sc} (等级${p.lvl}·击杀${p.kills}·💰${p.gold}·最深${p.depth}层)`);this.la(`🏆 ${p.name}逃出地牢！得分:${sc}`);this.bc(1);this.socks.get(sid)?.emit('escaped',{score:sc,name:p.name,lvl:p.lvl,kills:p.kills,gold:p.gold,depth:p.depth});return;}p.level--;const nl=this.gl(p.level);p.x=nl.downRoom.cx;p.y=nl.downRoom.cy;p.seenTiles=new Set();this.enterRoom(nl,p.x,p.y,p.seenTiles);this.lg(sid,`⬆️ 第${p.level}层`);this.bc(p.level+1);this.socks.get(sid)?.emit('newLevel',{map:nl.tiles,level:p.level,openDoors:[...nl.openDoors]});this.bc(p.level);this.la(`⬆️ ${p.name}上到第${p.level}层。`);}
    else{this.lg(sid,'这里没有楼梯。');return;}this.act(sid);}

  calcScore(p){return p.lvl*100+p.kills*70+p.gold+p.depth*200;}

  chat(sid,msg){const p=this.players.get(sid);if(!p||!msg.trim())return;this.io.emit('chat',{from:p.name,cls:p.cls,color:p.color,msg:msg.trim().slice(0,150)});}

  ss(sock,lv){if(!sock||!lv)return;const l=this.gl(lv);if(!l)return;sock.emit('gameState',{ps:[...this.players.values()].filter(p=>p.alive&&p.level===lv).map(p=>this.san(p,false)),ms:l.monsters.filter(m=>m.hp>0).map(m=>({id:m.id,key:m.key,n:m.n,e:m.e,hp:m.hp,mhp:m.mhp,x:m.x,y:m.y})),is:l.items.map(i=>({id:i.id,key:i.key||'',cat:i.cat,n:i.n,e:i.e||'📦',x:i.x,y:i.y})),level:lv,openDoors:[...l.openDoors]});}
  sy(sid){const p=this.players.get(sid),s=this.socks.get(sid);if(p&&s)s.emit('syncPlayer',this.san(p,true));}
  bc(lv,ex){if(!lv)return;const l=this.gl(lv);if(!l)return;const st={ps:[...this.players.values()].filter(p=>p.alive&&p.level===lv).map(p=>this.san(p,false)),ms:l.monsters.filter(m=>m.hp>0).map(m=>({id:m.id,key:m.key,n:m.n,e:m.e,hp:m.hp,mhp:m.mhp,x:m.x,y:m.y})),is:l.items.map(i=>({id:i.id,key:i.key||'',cat:i.cat,n:i.n,e:i.e||'📦',x:i.x,y:i.y})),level:lv,openDoors:[...l.openDoors]};for(const[sid,p]of this.players){if(p.level!==lv)continue;if(sid===ex)continue;this.socks.get(sid)?.emit('gameState',st);}}
  san(p,full){const b={id:p.id,name:p.name,cls:p.cls,color:p.color,lvl:p.lvl,hp:p.hp,mhp:p.mhp,str:p.str,dex:p.dex,gold:p.gold,x:p.x,y:p.y,alive:p.alive,kills:p.kills,depth:p.depth,wpn:p.weapon?{n:p.weapon.n,e:p.weapon.e,atk:p.weapon.atk||0,dmg:p.weapon.dmg}:null,arm:p.armor?{n:p.armor.n,e:p.armor.e,def:p.armor.def||0}:null,rng:p.ring?{n:p.ring.n,e:p.ring.e,ring:p.ring.ring,v:p.ring.v}:null};if(full){b.inv=p.inv.map(i=>({id:i.id,key:i.key,cat:i.cat,n:i.n,e:i.e||'📦',dmg:i.dmg,atk:i.atk,def:i.def,fx:i.fx,ring:i.ring,nut:i.nut,heal:i.heal}));b.eff=p.eff;b.res=p.res;b.xp=p.xp;b.weapon=p.weapon;b.armor=p.armor;b.ring=p.ring;b.seenTiles=p.seenTiles?[...p.seenTiles]:[];}return b;}
  lg(sid,msg){this.socks.get(sid)?.emit('log',{msg,time:Date.now()});}
  la(msg){this.io.emit('log',{msg,time:Date.now(),global:true});}
  hb(){const now=Date.now();for(const p of this.players.values()){if(!p.alive&&p.dt&&now-p.dt>RSP)this.rp(p);if(p.eff.find(e=>e.type==='regen')&&p.alive&&p.hp<p.mhp)p.hp=Math.min(p.mhp,p.hp+2);}const al=new Set();for(const p of this.players.values())if(p.alive)al.add(p.level);for(const l of al)this.bc(l);}
}

// ═════════════════════════════════════════════
//  启动
// ═════════════════════════════════════════════

const app=express();
const srv=http.createServer(app);
const io=new Server(srv,{transports:['websocket','polling'],pingTimeout:30000,pingInterval:12000,maxHttpBufferSize:1e6,allowEIO3:true});

app.use(express.static(__dirname));
app.get('/',(r,s)=>s.sendFile(path.join(__dirname,'index.html')));
app.get('/health',(r,s)=>s.status(200).send('ok'));

const g=new Game(io);
function w(sid,fn){try{fn();}catch(e){console.error(`[ERR] ${sid}:`,e.message);try{g.lg(sid,'⚠️ 出错，重试。');}catch(_){}}}

io.on('connection',sock=>{
  const sid=sock.id;
  sock.on('join',d=>w(sid,()=>g.addPlayer(sock,d)));
  sock.on('move',d=>w(sid,()=>g.mv(sid,(d&&d.dx)||0,(d&&d.dy)||0)));
  sock.on('pickup',()=>w(sid,()=>g.pk(sid)));
  sock.on('use',d=>w(sid,()=>g.use(sid,d&&d.idx)));
  sock.on('equip',d=>w(sid,()=>g.eq(sid,d&&d.idx)));
  sock.on('drop',d=>w(sid,()=>g.dr(sid,d&&d.idx)));
  sock.on('eat',d=>w(sid,()=>g.et2(sid,d&&d.idx)));
  sock.on('unequip',d=>w(sid,()=>g.ue(sid,d&&d.slot)));
  sock.on('descend',()=>w(sid,()=>g.cl(sid,'down')));
  sock.on('ascend',()=>w(sid,()=>g.cl(sid,'up')));
  sock.on('chat',d=>w(sid,()=>g.chat(sid,d&&d.msg)));
  sock.on('disconnect',()=>w(sid,()=>g.rm(sid)));
  sock.on('error',e=>console.error(`[SOCK] ${sid}:`,e.message));
});

setInterval(()=>{try{g.hb();}catch(e){console.error('[HB]',e.message);}},2000);
process.on('uncaughtException',e=>console.error('[FATAL]',e.message,e.stack));
process.on('unhandledRejection',r=>console.error('[FATAL] Promise:',r));
process.on('SIGTERM',()=>{srv.close(()=>process.exit(0));});

const PORT=process.env.PORT||3000;
srv.listen(PORT,'0.0.0.0',()=>console.log(`🏰 Pathos 种子地牢 v11 :${PORT}`));
