'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const EventEmitter=require('node:events');
const Module=require('node:module');
const {randomUUID}=require('node:crypto');

class FakeIO extends EventEmitter {
  constructor(){super();this.sockets={sockets:new Map()};}
  to(id){return {emit:(event,data)=>this.sockets.sockets.get(id)?.outgoing.push({event,data})};}
}
class FakeSocket extends EventEmitter {
  constructor(id){super();this.id=id;this.data={};this.outgoing=[];this.rooms=new Set();}
  join(room){this.rooms.add(room);}
  leave(room){this.rooms.delete(room);}
  emit(event,data){this.outgoing.push({event,data});}
  receive(event,...args){super.emit(event,...args);}
  latest(){return this.outgoing.filter(x=>x.event==='state').at(-1)?.data;}
}
const realLoad=Module._load;
Module._load=function(name,...args) {if(name==='socket.io')return {Server:FakeIO};return realLoad.call(this,name,...args);};
const {io,httpServer}=require('../server');
Module._load=realLoad;
function connect(id){const socket=new FakeSocket(id);io.sockets.sockets.set(id,socket);io.emit('connection',socket);return socket;}
function message(socket,event,payload){let response;socket.receive(event,payload,r=>response=r);return response;}

test('HTTP serves app and health check and blocks arbitrary paths',async t=>{
  await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>httpServer.close(resolve)));
  const url=`http://127.0.0.1:${httpServer.address().port}`;
  const health=await fetch(url+'/health');assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{status:'ok'});
  const page=await fetch(url);assert.equal(page.status,200);
  assert.match(await page.text(),/Good cards/);
  const css=await fetch(url+'/styles.css');assert.equal(css.status,200);
  const missing=await fetch(url+'/package.json');assert.equal(missing.status,404);
});
test('two connected clients can create/join private room, start, and keep hole cards secret',()=>{
  const a=connect('socket_a');const b=connect('socket_b');
  const aToken=randomUUID();const bToken=randomUUID();
  const created=message(a,'createRoom',{name:'Alice',token:aToken});
  assert.equal(created.ok,true);assert.match(created.code,/^[A-Z0-9]{5}$/);
  const joined=message(b,'joinRoom',{code:created.code,name:'Bob',token:bToken});
  assert.equal(joined.ok,true);
  assert.equal(a.latest().players.length,2);
  assert.equal(b.latest().players.length,2);
  assert.equal(message(b,'startHand',{}).error,'Only the host can start the next hand.');
  assert.equal(message(a,'startHand',{}).ok,true);
  assert.equal(a.latest().phase,'preflop');
  const alice=a.latest().players.find(p=>p.name==='Alice');
  const aliceFromBob=b.latest().players.find(p=>p.name==='Alice');
  assert.equal(alice.cards.length,2);assert.ok(alice.cards.every(Boolean));
  assert.deepEqual(aliceFromBob.cards,[null,null]);
  assert.equal(message(a,'action',{type:'fold'}).ok,true);
  assert.equal(a.latest().phase,'showdown');
});
test('reconnect uses token to claim existing seat; nobody else can steal it by name alone',()=>{
  const a=connect('socket_c');const tkn=randomUUID();
  const {code}=message(a,'createRoom',{name:'Chris',token:tkn});
  const b=connect('socket_d');
  const conflict=message(b,'joinRoom',{code,name:'Chris',token:randomUUID()});
  assert.match(conflict.error,/name is taken/);
  const rejoin=message(b,'joinRoom',{code,name:'Chris',token:tkn});
  assert.equal(rejoin.ok,true);
  assert.equal(b.latest().players.length,1);
  assert.equal(a.data.roomCode,null);
});
