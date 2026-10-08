'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../poker');

function setup(count=2) {
  const room=G.makeRoom('TEST1');
  for(let i=0;i<count;i++) {
    const player=G.makePlayer(`p${i}`,`token${i}`,`Player ${i+1}`,i);
    player.connected=true;room.players.push(player);
  }
  room.hostId='p0';
  return room;
}
function actor(room){return room.players.find(p=>p.seat===room.actorSeat);}
function doAction(room,type,amount){const p=actor(room);assert.ok(p,`No actor on ${room.phase}`);const result=G.act(room,p.id,type,amount);assert.deepEqual(result,{ok:true});return p;}
function chipsTotal(room){return room.players.reduce((t,p)=>t+p.chips,0)+(room.phase==='showdown'?0:G.potSize(room));}

test('crypto shuffle produces 52 unique cards',()=>{
  for(let i=0;i<12;i++){const cards=G.newDeck();assert.equal(cards.length,52);assert.equal(new Set(cards).size,52);}
});
test('ace-low straight is five-high (not ace-high)',()=>{
  assert.deepEqual(G.evaluate(['As','2h','3c','4d','5s','9d','Jc']),[4,5]);
  assert.deepEqual(G.evaluate(['As','Ks','Qd','Jc','Th','4h','2d']),[4,14]);
});
test('straight flush, quads, and full house compare correctly',()=>{
  const sf=G.evaluate(['As','Ks','Qs','Js','Ts','2h','3c']);
  const quads=G.evaluate(['2h','2d','2c','2s','9h','Ac','Kd']);
  const full=G.evaluate(['3h','3d','3c','9s','9h','9c','Ad']);
  assert.equal(sf[0],8);assert.equal(quads[0],7);assert.deepEqual(full,[6,9,3]);
  assert.ok(G.compareRanks(sf,quads)>0);
  assert.ok(G.compareRanks(quads,full)>0);
});
test('two pair, trips, and kickers are ranked correctly',()=>{
  assert.deepEqual(G.evaluate(['Ah','Ad','Kh','Kd','3c','2s','8s']),[2,14,13,8]);
  assert.ok(G.compareRanks(G.evaluate(['Th','Td','Tc','As','Ks']),G.evaluate(['Th','Td','Tc','As','Qs']))>0);
  assert.ok(G.compareRanks(G.evaluate(['As','Ah','Kc','Qs','Jh']),G.evaluate(['As','Ah','Kc','Qs','Th']))>0);
});
test('heads-up dealer posts the small blind and acts first preflop',()=>{
  const room=setup(); assert.equal(G.startHand(room).ok,true);
  assert.equal(room.dealerSeat,room.sbSeat);
  assert.equal(room.bbSeat,1);
  assert.equal(room.actorSeat,0);
  assert.equal(room.players[0].bet,10);
  assert.equal(room.players[1].bet,20);
  assert.equal(G.potSize(room),30);
  assert.equal(chipsTotal(room),3000);
});
test('three-player blinds and table position order are correct',()=>{
  const room=setup(3);G.startHand(room);
  assert.equal(room.dealerSeat,0);assert.equal(room.sbSeat,1);assert.equal(room.bbSeat,2);
  assert.equal(room.actorSeat,0);
});
test('calls/checks advance through flop, turn, river, and showdown',()=>{
  const room=setup();G.startHand(room);
  doAction(room,'call'); assert.equal(room.actorSeat,1);
  doAction(room,'check');assert.equal(room.phase,'flop');assert.equal(room.board.length,3);
  assert.equal(room.actorSeat,1,'post-flop action starts after dealer');
  doAction(room,'check');doAction(room,'check');assert.equal(room.phase,'turn');
  doAction(room,'check');doAction(room,'check');assert.equal(room.phase,'river');
  doAction(room,'check');doAction(room,'check');assert.equal(room.phase,'showdown');
  assert.equal(room.board.length,5);assert.equal(chipsTotal(room),3000);
  assert.ok(room.result.headline);
});
test('fold awards pot to remaining player and preserves chips',()=>{
  const room=setup();G.startHand(room);
  doAction(room,'fold');
  assert.equal(room.phase,'showdown');
  assert.equal(room.players[1].chips,1510);
  assert.equal(room.players[0].chips,1490);
  assert.equal(chipsTotal(room),3000);
});
test('cannot raise below minimum except with remaining stack all-in',()=>{
  const room=setup();G.startHand(room);
  const p=actor(room);
  assert.match(G.act(room,p.id,'raise',25).error,/Minimum raise/);
  assert.equal(room.actorSeat,p.seat);
  assert.equal(G.act(room,p.id,'raise',40).ok,true);
  assert.equal(room.currentBet,40);
  assert.equal(G.act(room,actor(room).id,'call').ok,true);
  assert.equal(room.phase,'flop');
});
test('short stack all-in runs board to showdown without stalling',()=>{
  const room=setup();room.players[0].chips=10;room.players[1].chips=100;
  assert.equal(G.startHand(room).ok,true);
  assert.equal(room.phase,'showdown');
  assert.equal(room.board.length,5);
  assert.equal(room.players.reduce((s,p)=>s+p.chips,0),110);
});
test('server never leaks face-down opponents cards',()=>{
  const room=setup(3);G.startHand(room);
  const privateHand=room.players[1].cards;
  assert.equal(G.stateFor(room,'p0').players[1].cards[0],null);
  assert.deepEqual(G.stateFor(room,'p1').players[1].cards,privateHand);
  assert.equal(G.stateFor(room,'p2').players[0].cards[0],null);
});
test('leaving table folds a player and progresses action',()=>{
  const room=setup();G.startHand(room);G.depart(room,'p0');
  assert.equal(room.phase,'showdown');assert.equal(room.players[0].left,true);
  assert.equal(room.players[1].chips,1510);
});
test('split pot gives odd chip to first winner clockwise from dealer',()=>{
  const room=setup(3);room.phase='river';room.dealerSeat=0;
  room.board=['2s','3h','4c','5d','6s'];
  for(const p of room.players){p.inHand=true;p.folded=false;p.bet=0;p.contributed=0;p.cards=['Kd','Kh'];}
  room.players[0].contributed=5;room.players[1].contributed=5;room.players[2].contributed=5;
  G.finishShowdown(room);
  assert.equal(room.phase,'showdown');
  assert.equal(room.players.reduce((sum,p)=>sum+p.winnings,0),15);
  assert.deepEqual(room.players.map(p=>p.winnings),[5,5,5]);
});
test('multiple side pots correctly separate main pot and short stacks',()=>{
  const room=setup(3);room.phase='river';room.dealerSeat=0;
  room.board=['2s','6s','9d','Jc','Qh'];
  for(const p of room.players){p.inHand=true;p.folded=false;p.bet=0;p.winnings=0;p.chips=0;}
  room.players[0].contributed=100;room.players[0].cards=['As','Ad'];
  room.players[1].contributed=200;room.players[1].cards=['Kh','Kd'];
  room.players[2].contributed=200;room.players[2].cards=['Qc','Qd'];
  G.finishShowdown(room);
  assert.equal(room.result.pots.length,2);
  assert.equal(room.result.pots[0].size,300);
  assert.equal(room.result.pots[1].size,200);
  assert.deepEqual(room.players.map(p=>p.winnings),[0,0,500]);
});
test('short all-in does not reopen raising for a player who has acted',()=>{
  const room=setup(3);
  room.players[2].chips=35;
  G.startHand(room);
  assert.equal(G.act(room,'p0','call').ok,true); // Player 0 calls 20.
  assert.equal(G.act(room,'p1','call').ok,true); // SB calls 10.
  // Big blind raises all-in from 20 to 35.
  assert.equal(room.actorSeat,2);
  assert.equal(G.act(room,'p2','allin').ok,true);
  assert.equal(room.actorSeat,0);
  assert.equal(G.legalActions(room,room.players[0]).canRaise,false);
  assert.equal(G.act(room,'p0','raise',100).error,'You cannot raise right now.');
  assert.equal(G.act(room,'p0','call').ok,true);
  assert.equal(G.act(room,'p1','call').ok,true);
  assert.equal(room.phase,'flop');
});
test('chip accounting and turn selection remain valid over 250 randomized hands',()=>{
  for(let game=0;game<250;game++) {
    const room=setup(2+game%7);
    for (const p of room.players) p.chips=300+(p.seat*77)%500;
    const initial=room.players.reduce((n,p)=>n+p.chips,0);
    assert.equal(G.startHand(room).ok,true);
    for(let step=0;step<250 && room.phase!=='showdown';step++) {
      const p=actor(room);assert.ok(p,`Missing actor on game=${game} step=${step} phase=${room.phase}`);
      const legal=G.legalActions(room,p);assert.ok(legal);
      const choice=(game*19+step*11+room.currentBet)%13;
      let type;
      let amount;
      if (choice===0) type='fold';
      else if (choice===1 && legal.canAllIn) type='allin';
      else if (choice===2 && legal.canRaise) {type='raise';amount=Math.min(legal.minRaiseTo,legal.maxRaiseTo);}
      else type=legal.canCheck?'check':'call';
      const result=G.act(room,p.id,type,amount);
      assert.equal(result.ok,true,JSON.stringify({game,step,p:p.id,type,amount,result}));
      const total=room.players.reduce((s,q)=>s+q.chips,0)+(room.phase==='showdown'?0:G.potSize(room));
      assert.equal(total,initial,`Chip leak on game ${game}`);
    }
    assert.equal(room.phase,'showdown',`Game ${game} did not finish`);
  }
});
test('folds by a non-acting player do not skip the current actor',()=>{
  const room=setup(3);G.startHand(room);
  assert.equal(room.actorSeat,0);
  G.depart(room,'p2');
  assert.equal(room.actorSeat,0);
  assert.equal(room.phase,'preflop');
  assert.equal(G.act(room,'p0','call').ok,true);
  assert.equal(G.act(room,'p1','call').ok,true);
  assert.equal(room.phase,'flop');
});
