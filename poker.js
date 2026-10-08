'use strict';

const { randomInt } = require('node:crypto');
const STARTING_CHIPS = 1500;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const PHASES = ['preflop', 'flop', 'turn', 'river'];
const SUITS = ['s', 'h', 'd', 'c'];
const FACES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function newDeck() {
  const cards = SUITS.flatMap(s => FACES.map(v => v + s));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function evaluateFive(cards) {
  if (cards.length !== 5) throw new Error('Expected five cards');
  const values = cards.map(c => FACES.indexOf(c[0]) + 2).sort((a,b) => b-a);
  const count = new Map();
  for (const value of values) count.set(value, (count.get(value) || 0) + 1);
  const groups = [...count.entries()].sort((a,b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(c => c[1] === cards[0][1]);
  const unique = [...new Set(values)];
  if (unique.includes(14)) unique.push(1);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i+4] === 4) { straightHigh = unique[i]; break; }
  }
  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map(g=>g[0]).sort((a,b)=>b-a)];
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a,b)=>b-a);
    return [2, ...pairs, groups[2][0]];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map(g=>g[0]).sort((a,b)=>b-a)];
  return [0, ...values];
}

function compareRanks(a,b) {
  for (let i=0; i<Math.max(a.length,b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7) throw new Error('Expected 5 to 7 cards');
  let best = null;
  const choose = (start, chosen) => {
    if (chosen.length === 5) {
      const rank = evaluateFive(chosen);
      if (!best || compareRanks(rank,best) > 0) best = rank;
      return;
    }
    for (let i=start; i<=cards.length-(5-chosen.length);i++) choose(i+1,[...chosen,cards[i]]);
  };
  choose(0,[]);
  return best;
}

const HAND_NAMES = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
function nextPlayer(room, afterSeat, filter) {
  const candidates = room.players.filter(filter).sort((a,b)=>a.seat-b.seat);
  if (!candidates.length) return null;
  return candidates.find(p=>p.seat>afterSeat) || candidates[0];
}
const live = p => p.inHand && !p.folded && !p.left;
const canAct = p => live(p) && !p.allIn;
const potSize = room => room.players.reduce((sum,p) => sum + p.contributed,0);
function log(room, text) {
  room.messages.push({id: ++room.messageSequence, text, time: Date.now(), type:'system'});
  if (room.messages.length > 35) room.messages.shift();
}
function makeRoom(code) {
  return {
    code, players: [], phase:'lobby', handNumber:0, dealerSeat:-1, sbSeat:null, bbSeat:null,
    actorSeat:null, deck:[], board:[], currentBet:0, lastFullRaise:BIG_BLIND,
    messages:[], messageSequence:0, result:null, turnDeadline:null, createdAt:Date.now(),
    hostId:null
  };
}
function makePlayer(id, token, name, seat) {
  return {id, token, name, seat, chips:STARTING_CHIPS, socketId:null, connected:false, left:false,
    inHand:false, folded:false, allIn:false, cards:[], bet:0, contributed:0,
    acted:false, raiseLocked:false, lastAction:'', winnings:0};
}
function pay(player, chips) {
  if (!Number.isInteger(chips) || chips < 0 || chips > player.chips) throw new Error('Invalid chip amount');
  player.chips -= chips;
  player.bet += chips;
  player.contributed += chips;
  if (player.chips === 0) player.allIn = true;
}
function startHand(room) {
  if (!['lobby','showdown'].includes(room.phase)) return {error:'Finish the current hand first.'};
  room.players = room.players.filter(p=>!p.left);
  const participants = room.players.filter(p=>p.connected && p.chips>0);
  if (participants.length < 2) return {error:'At least two connected players with chips are needed.'};
  room.handNumber++;
  room.phase = 'preflop'; room.deck = newDeck(); room.board=[];
  room.currentBet=0; room.lastFullRaise=BIG_BLIND; room.result=null; room.turnDeadline=null;
  room.dealerSeat = nextPlayer(room,room.dealerSeat,p=>participants.includes(p)).seat;
  const playerFilter = p => participants.includes(p);
  room.sbSeat = participants.length===2 ? room.dealerSeat : nextPlayer(room,room.dealerSeat,playerFilter).seat;
  room.bbSeat = nextPlayer(room,room.sbSeat,playerFilter).seat;
  for (const p of room.players) {
    p.inHand = participants.includes(p); p.folded = !p.inHand; p.allIn = false;
    p.cards=[]; p.bet=0; p.contributed=0; p.acted=false; p.raiseLocked=false;
    p.lastAction=''; p.winnings=0;
  }
  // Cards are dealt in order starting to the left of the dealer.
  for (let round=0;round<2;round++) {
    let seat = room.dealerSeat;
    for (let i=0;i<participants.length;i++) {
      const p = nextPlayer(room,seat,playerFilter);
      p.cards.push(room.deck.pop()); seat = p.seat;
    }
  }
  const sb = room.players.find(p=>p.seat===room.sbSeat);
  const bb = room.players.find(p=>p.seat===room.bbSeat);
  pay(sb,Math.min(SMALL_BLIND,sb.chips));
  pay(bb,Math.min(BIG_BLIND,bb.chips));
  sb.lastAction='Small blind'; bb.lastAction='Big blind';
  room.currentBet=Math.max(sb.bet,bb.bet);
  log(room,`Hand #${room.handNumber} started. ${sb.name} posts ${sb.bet}; ${bb.name} posts ${bb.bet}.`);
  const first = nextPlayer(room,room.bbSeat,canAct);
  room.actorSeat = first ? first.seat : null;
  progress(room,room.bbSeat);
  return {ok:true};
}
function legalActions(room,p) {
  if (!p || room.actorSeat!==p.seat || !PHASES.includes(room.phase) || !canAct(p)) return null;
  const toCall = Math.max(0,room.currentBet-p.bet);
  const maxRaiseTo=p.bet+p.chips;
  const minRaiseTo=room.currentBet===0 ? BIG_BLIND : room.currentBet+room.lastFullRaise;
  const opponentsCanAct = room.players.some(q=>q!==p && canAct(q) && q.chips>0);
  const canRaise = opponentsCanAct && !p.raiseLocked && maxRaiseTo>room.currentBet;
  return {toCall,callAmount:Math.min(toCall,p.chips),canCheck:toCall===0,
    canCall:toCall>0, canFold:true, canRaise, minRaiseTo, maxRaiseTo,
    canAllIn:p.chips>0 && (maxRaiseTo<=room.currentBet || canRaise)};
}
function act(room, playerId, action, amount) {
  const p=room.players.find(p=>p.id===playerId);
  const legal=legalActions(room,p);
  if (!legal) return {error:'It is not your turn.'};
  if (typeof action !== 'string') return {error:'Invalid action.'};
  if (action==='fold') {p.folded=true;p.acted=true;p.lastAction='Fold';log(room,`${p.name} folds.`);}
  else if (action==='check' && legal.canCheck) {p.acted=true;p.lastAction='Check';log(room,`${p.name} checks.`);}
  else if (action==='call' && legal.canCall) {
    const n=legal.callAmount;
    pay(p,n);p.acted=true;p.lastAction=p.allIn?'Call · all-in':`Call ${n}`;
    log(room,`${p.name} calls ${n}${p.allIn?' (all-in)':''}.`);
  } else if (action==='raise' || action==='allin') {
    let total=action==='allin'?legal.maxRaiseTo:Number(amount);
    if (!Number.isSafeInteger(total) || total<0) return {error:'Enter a whole number of chips.'};
    if (total<=room.currentBet && action==='allin' && legal.canAllIn) {
      const n=p.chips; pay(p,n);p.acted=true;p.lastAction='All-in call';
      log(room,`${p.name} calls all-in for ${n}.`);
    } else {
      if (!legal.canRaise) return {error:'You cannot raise right now.'};
      if (total>legal.maxRaiseTo || total<=room.currentBet) return {error:'Raise amount is out of range.'};
      if (total<legal.minRaiseTo && total!==legal.maxRaiseTo) return {error:`Minimum raise is to ${legal.minRaiseTo}, unless you go all-in.`};
      const oldBet=room.currentBet;
      const raiseSize=total-oldBet;
      const fullRaise=raiseSize >= (oldBet===0?BIG_BLIND:room.lastFullRaise);
      const n=total-p.bet;
      pay(p,n);
      p.acted=true;p.raiseLocked=false;
      room.currentBet=total;
      if (fullRaise) {
        room.lastFullRaise=raiseSize;
        for (const other of room.players) if (other!==p && canAct(other)) {
          other.acted=false; other.raiseLocked=false;
        }
      } else {
        // A short all-in does not reopen raises for players who already acted.
        for (const other of room.players) if (other!==p && other.acted) other.raiseLocked=true;
      }
      p.lastAction=p.allIn?'All-in':(oldBet?'Raise':'Bet');
      log(room,`${p.name} ${p.allIn?'moves all-in':oldBet?'raises':'bets'} to ${total}.`);
    }
  } else return {error:'That action is not available.'};
  progress(room,p.seat);
  return {ok:true};
}
function progress(room, afterSeat) {
  for (let i=0;i<6;i++) {
    const remaining=room.players.filter(live);
    if (remaining.length===1) {finishByFold(room,remaining[0]);return;}
    if (remaining.length===0) {room.actorSeat=null;room.phase='showdown';return;}
    const available=remaining.filter(p=>!p.allIn);
    const allMatched=available.every(p=>p.acted && p.bet===room.currentBet);
    const noFurtherBetting = available.length===0 || (available.length===1 && available[0].bet>=room.currentBet);
    if (allMatched || noFurtherBetting) {
      if (room.phase==='river') {finishShowdown(room);return;}
      nextStreet(room); afterSeat=room.dealerSeat;continue;
    }
    const next=nextPlayer(room,afterSeat,p=>canAct(p) && (!p.acted || p.bet!==room.currentBet));
    if (!next) throw new Error('Poker turn invariant failed');
    room.actorSeat=next.seat;
    room.turnDeadline=Date.now()+75_000;
    return;
  }
  throw new Error('Too many street transitions');
}
function nextStreet(room) {
  const next = PHASES[PHASES.indexOf(room.phase)+1];
  if (!next) throw new Error('No next street');
  room.phase=next;
  room.deck.pop(); // Burn one card.
  const count=next==='flop'?3:1;
  for (let i=0;i<count;i++) room.board.push(room.deck.pop());
  room.currentBet=0;room.lastFullRaise=BIG_BLIND;room.actorSeat=null;
  for (const p of room.players) {p.bet=0;p.acted=false;p.raiseLocked=false;}
  log(room,`The ${next} is dealt.`);
}
function finishByFold(room,winner) {
  const chips=potSize(room);
  winner.chips+=chips;
  winner.winnings=chips;
  room.result={kind:'fold',headline:`${winner.name} wins ${chips} chips`,pots:[],winners:[winner.id]};
  room.phase='showdown';room.actorSeat=null;room.turnDeadline=null;
  log(room,`${winner.name} takes the pot of ${chips} chips. Hand complete.`);
}
function payoutOrder(room,winners) {
  return winners.slice().sort((a,b)=>((a.seat-room.dealerSeat+8)%8)-((b.seat-room.dealerSeat+8)%8));
}
function finishShowdown(room) {
  while (room.board.length<5) {
    room.deck.pop();
    room.board.push(room.deck.pop());
  }
  const inPot=room.players.filter(p=>p.contributed>0);
  const levels=[...new Set(inPot.map(p=>p.contributed))].sort((a,b)=>a-b);
  const ranks=new Map(room.players.filter(live).map(p=>[p.id,evaluate([...p.cards,...room.board])]));
  const pots=[];
  let previous=0;
  for (const level of levels) {
    const contributors=inPot.filter(p=>p.contributed>=level);
    const size=(level-previous)*contributors.length;
    const eligible=contributors.filter(live);
    if (!eligible.length) throw new Error('Side pot has no eligible winner');
    let winners;
    if (eligible.length===1) winners=eligible;
    else {
      const best=eligible.map(p=>ranks.get(p.id)).sort((a,b)=>compareRanks(b,a))[0];
      winners=eligible.filter(p=>compareRanks(ranks.get(p.id),best)===0);
    }
    const ordered=payoutOrder(room,winners);
    const share=Math.floor(size/ordered.length);
    const extra=size%ordered.length;
    ordered.forEach((winner,i)=>{const chips=share+(i<extra?1:0);winner.chips+=chips;winner.winnings+=chips;});
    pots.push({size,winners:ordered.map(p=>p.id),hand:HAND_NAMES[ranks.get(ordered[0].id)[0]]});
    previous=level;
  }
  const awarded=room.players.filter(p=>p.winnings>0);
  const headline=awarded.length===1
    ? `${awarded[0].name} wins ${awarded[0].winnings} chips`
    : `Pot split: ${awarded.map(p=>p.name).join(', ')}`;
  room.result={kind:'showdown',headline,pots,winners:awarded.map(p=>p.id)};
  room.phase='showdown';room.actorSeat=null;room.turnDeadline=null;
  log(room,`${headline}. Hand complete.`);
}
function depart(room,playerId) {
  const player=room.players.find(p=>p.id===playerId);
  if (!player) return;
  if (PHASES.includes(room.phase) && live(player)) {
    if (room.actorSeat===player.seat) act(room,playerId,'fold');
    else {
      player.folded=true;player.acted=true;player.lastAction='Left table';
      const remaining=room.players.filter(live);
      if (remaining.length===1) finishByFold(room,remaining[0]);
    }
  }
  player.left=true;
}
function refill(room,playerId) {
  if (!['lobby','showdown'].includes(room.phase)) return {error:'You can refill chips between hands.'};
  const p=room.players.find(p=>p.id===playerId);
  if (!p || p.left) return {error:'Player not found.'};
  if (p.chips>=STARTING_CHIPS) return {error:'You already have at least 1,500 chips.'};
  p.chips=STARTING_CHIPS;
  log(room,`${p.name} resets their play-chip stack to 1,500.`);
  return {ok:true};
}
function stateFor(room,viewerId) {
  const viewer=room.players.find(p=>p.id===viewerId);
  const showHands=room.phase==='showdown' && room.result?.kind==='showdown';
  return {
    code:room.code, phase:room.phase, handNumber:room.handNumber,
    yourId:viewerId,hostId:room.hostId,
    isHost:!!viewer && (room.hostId===viewerId || (!room.players.some(p=>p.id===room.hostId && p.connected) && room.players.find(p=>p.connected)?.id===viewerId)),
    smallBlind:SMALL_BLIND,bigBlind:BIG_BLIND,
    players:room.players.filter(p=>!p.left).map(p=>({
      id:p.id,name:p.name,seat:p.seat,chips:p.chips,bet:p.bet,contributed:p.contributed,
      inHand:p.inHand,folded:p.folded,allIn:p.allIn,connected:p.connected,
      lastAction:p.lastAction,winnings:p.winnings,
      dealer:p.seat===room.dealerSeat && room.phase!=='lobby',
      smallBlind:p.seat===room.sbSeat && room.phase!=='lobby',
      bigBlind:p.seat===room.bbSeat && room.phase!=='lobby',
      cards: p.id===viewerId || (showHands && live(p)) ? p.cards : p.inHand ? [null,null] : []
    })),
    board:room.board,pot:potSize(room),currentBet:room.currentBet,
    actorId:room.players.find(p=>p.seat===room.actorSeat)?.id||null,
    deadline:room.turnDeadline,
    legal:legalActions(room,viewer),result:room.result,
    messages:room.messages.slice(-25)
  };
}

module.exports={
  makeRoom,makePlayer,newDeck,evaluateFive,evaluate,compareRanks,HAND_NAMES,
  startHand,act,legalActions,stateFor,refill,depart,finishShowdown,potSize,log,live,
  STARTING_CHIPS,SMALL_BLIND,BIG_BLIND
};
