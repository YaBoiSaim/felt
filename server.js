'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const { Server } = require('socket.io');
const poker = require('./poker');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname,'public');
const staticPaths = {
  '/': ['index.html','text/html; charset=utf-8'],
  '/index.html': ['index.html','text/html; charset=utf-8'],
  '/app.js': ['app.js','text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css','text/css; charset=utf-8']
};
const httpServer = http.createServer((req,res)=>{
  const pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname==='/health') {
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(JSON.stringify({status:'ok'}));
  }
  if (!Object.prototype.hasOwnProperty.call(staticPaths,pathname)) {
    res.writeHead(404);return res.end('Not found');
  }
  const [name,contentType]=staticPaths[pathname];
  res.writeHead(200,{
    'Content-Type':contentType,'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  });
  fs.createReadStream(path.join(PUBLIC,name)).pipe(res);
});
const io = new Server(httpServer,{
  maxHttpBufferSize:20_000,
  transports:['websocket','polling'],
  pingTimeout:25_000,
  pingInterval:20_000
});
const rooms = new Map();
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 250;

function codeForRoom() {
  let code;
  do {code=Array.from({length:5},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');}
  while (rooms.has(code));
  return code;
}
function validToken(value) {
  return typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function normalizeName(value) {
  if (typeof value!=='string') return '';
  return value.trim().replace(/\s+/g,' ').slice(0,18);
}
function reply(callback,result) {
  if (typeof callback==='function') callback(result);
}
function broadcast(room) {
  // Secrets are never broadcast: send personalized state to each socket.
  for (const player of room.players) if (player.connected && player.socketId) {
    io.to(player.socketId).emit('state',poker.stateFor(room,player.id));
  }
  scheduleTurn(room);
}
function scheduleTurn(room) {
  if (room.scheduledDeadline===room.turnDeadline) return;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.scheduledDeadline=room.turnDeadline;
  if (!room.turnDeadline || room.actorSeat===null) return;
  const deadline=room.turnDeadline;
  room.turnTimer=setTimeout(()=>{
    if (room.turnDeadline!==deadline || !rooms.has(room.code)) return;
    const player=room.players.find(p=>p.seat===room.actorSeat);
    if (!player) return;
    const legal=poker.legalActions(room,player);
    if (!legal) return;
    poker.log(room,`${player.name} ran out of time.`);
    const result=poker.act(room,player.id,legal.canCheck?'check':'fold');
    if (result.ok) broadcast(room);
  },Math.max(1,deadline-Date.now()));
  room.turnTimer.unref?.();
}
function leave(socket,wasExplicit=false) {
  const code=socket.data.roomCode;
  if (!code) return;
  const room=rooms.get(code);
  const player=room?.players.find(p=>p.id===socket.data.playerId);
  if (room && player && player.socketId===socket.id) {
    player.connected=false;player.socketId=null;
    if (wasExplicit) {
      // A departing player forfeits their cards but their committed chips stay in the pot.
      poker.depart(room,player.id);
      poker.log(room,`${player.name} left the table.`);
    } else poker.log(room,`${player.name} disconnected (they can rejoin).`);
    broadcast(room);
  }
  socket.leave(code);socket.data.roomCode=null;socket.data.playerId=null;
}
function enter(socket,room,player) {
  if (player.socketId && player.socketId!==socket.id) {
    const previous=io.sockets.sockets.get(player.socketId);
    if (previous) {
      previous.emit('sessionTaken');
      previous.leave(room.code);
      previous.data.roomCode=null;previous.data.playerId=null;
    }
  }
  player.socketId=socket.id;player.connected=true;player.left=false;
  socket.data.roomCode=room.code;socket.data.playerId=player.id;
  socket.join(room.code);
  room.lastActive=Date.now();
  broadcast(room);
}
function current(socket) {
  const room=rooms.get(socket.data.roomCode);
  const player=room?.players.find(p=>p.id===socket.data.playerId && p.socketId===socket.id);
  return {room,player};
}
function canControl(room,player) {
  if (!player || !room) return false;
  return poker.stateFor(room,player.id).isHost;
}

io.on('connection',socket=>{
  socket.on('createRoom',(payload={},callback)=>{
    if (!payload || typeof payload!=='object') payload={};
    if (socket.data.roomCode) return reply(callback,{error:'Leave your current table first.'});
    const name=normalizeName(payload.name);
    if (!name) return reply(callback,{error:'Enter a display name.'});
    if (!validToken(payload.token)) return reply(callback,{error:'Refresh the page and try again.'});
    if (rooms.size>=MAX_ROOMS) return reply(callback,{error:'The server has reached its room limit.'});
    const room=poker.makeRoom(codeForRoom());
    const player=poker.makePlayer(randomUUID(),payload.token,name,0);
    room.players.push(player);room.hostId=player.id;
    rooms.set(room.code,room);
    poker.log(room,`${name} created the table.`);
    enter(socket,room,player);
    reply(callback,{ok:true,code:room.code});
  });
  socket.on('joinRoom',(payload={},callback)=>{
    if (!payload || typeof payload!=='object') payload={};
    const code=String(payload.code||'').trim().toUpperCase();
    const room=rooms.get(code);
    if (!room) return reply(callback,{error:'Room not found. It may have expired or the server restarted.'});
    if (!validToken(payload.token)) return reply(callback,{error:'Refresh the page and try again.'});
    if (socket.data.roomCode && socket.data.roomCode!==code) return reply(callback,{error:'Leave your current table first.'});
    let player=room.players.find(p=>p.token===payload.token);
    if (!player) {
      const name=normalizeName(payload.name);
      if (!name) return reply(callback,{error:'Enter a display name.'});
      if (room.players.filter(p=>!p.left).length>=8) return reply(callback,{error:'This table is full (8 players maximum).'});
      if (room.players.some(p=>!p.left && p.name.toLowerCase()===name.toLowerCase())) return reply(callback,{error:'That name is taken at this table.'});
      const taken=new Set(room.players.filter(p=>!p.left).map(p=>p.seat));
      const seat=Array.from({length:8},(_,i)=>i).find(i=>!taken.has(i));
      player=poker.makePlayer(randomUUID(),payload.token,name,seat);
      room.players.push(player);
      poker.log(room,`${name} joined the table.`);
    } else poker.log(room,`${player.name} rejoined the table.`);
    enter(socket,room,player);
    reply(callback,{ok:true,code:room.code});
  });
  socket.on('startHand',(_,callback)=>{
    const {room,player}=current(socket);
    if (!room || !player) return reply(callback,{error:'Join a table first.'});
    if (!canControl(room,player)) return reply(callback,{error:'Only the host can start the next hand.'});
    const result=poker.startHand(room);
    if (result.ok) broadcast(room);
    reply(callback,result);
  });
  socket.on('action',(payload={},callback)=>{
    if (!payload || typeof payload!=='object') payload={};
    const {room,player}=current(socket);
    if (!room || !player) return reply(callback,{error:'Join a table first.'});
    const result=poker.act(room,player.id,payload.type,payload.amount);
    if (result.ok) broadcast(room);
    reply(callback,result);
  });
  socket.on('refill',(_,callback)=>{
    const {room,player}=current(socket);
    if (!room || !player) return reply(callback,{error:'Join a table first.'});
    const result=poker.refill(room,player.id);
    if (result.ok) broadcast(room);
    reply(callback,result);
  });
  socket.on('chat',(payload={},callback)=>{
    if (!payload || typeof payload!=='object') payload={};
    const {room,player}=current(socket);
    if (!room || !player) return reply(callback,{error:'Join a table first.'});
    const content=typeof payload.text==='string'?payload.text.trim().slice(0,220):'';
    if (!content) return reply(callback,{error:'Your message is empty.'});
    const now=Date.now();
    if (socket.data.lastChat && now-socket.data.lastChat<800) return reply(callback,{error:'Send messages a little more slowly.'});
    socket.data.lastChat=now;
    room.messages.push({id:++room.messageSequence,text:content,name:player.name,type:'chat',time:now});
    if (room.messages.length>35) room.messages.shift();
    broadcast(room);reply(callback,{ok:true});
  });
  socket.on('leaveRoom',(_,callback)=>{leave(socket,true);reply(callback,{ok:true});});
  socket.on('disconnect',()=>leave(socket,false));
});

setInterval(()=>{
  const now=Date.now();
  for (const [code,room] of rooms) {
    const anyOnline=room.players.some(p=>p.connected);
    if (anyOnline) {room.lastActive=now;continue;}
    if (now-(room.lastActive||room.createdAt)>60*60*1000) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      rooms.delete(code);
    }
  }
},60*1000).unref?.();

if (require.main===module) httpServer.listen(PORT,'0.0.0.0',()=>console.log(`Felt is running on http://localhost:${PORT}`));
module.exports={httpServer,io,rooms};
