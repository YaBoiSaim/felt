/* global io */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const els={
    landing:$('landing'),game:$('game'),landingFooter:$('landingFooter'),connection:$('connectionPill'),
    nickname:$('nickname'),joinCode:$('joinCode'),create:$('createBtn'),join:$('joinBtn'),
    roomCode:$('roomCode'),copyInvite:$('copyInvite'),leave:$('leaveBtn'),
    potLabel:$('potLabel'),potAmount:$('potAmount'),board:$('board'),players:$('players'),
    phaseLabel:$('phaseLabel'),handIndicator:$('handIndicator'),playerCount:$('playerCount'),
    result:$('resultBanner'),actionTitle:$('actionTitle'),actionDescription:$('actionDescription'),
    actions:$('actionButtons'),fold:$('foldBtn'),checkCall:$('checkCallBtn'),allin:$('allinBtn'),
    raiseAmount:$('raiseAmount'),raiseSlider:$('raiseSlider'),raise:$('raiseBtn'),
    waitingActions:$('waitingActions'),start:$('startBtn'),refill:$('refillBtn'),waitingNote:$('waitingNote'),
    yourChips:$('yourChips'),roster:$('roster'),seatCounter:$('seatCounter'),
    chatMessages:$('chatMessages'),chatForm:$('chatForm'),chatInput:$('chatInput'),toast:$('toast')
  };
  let token=readStorage('felt:token');
  if (!token) {
    token=globalThis.crypto?.randomUUID?.() || ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx').replace(/[xy]/g,c=>{
      const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3|8)).toString(16);
    });
    writeStorage('felt:token',token);
  }
  let roomCode=readStorage('felt:room')||'';
  let current=null;
  let actionKey='';
  let lastChatId=null;
  let toastTimer;
  const socket=io({reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:6000});

  const roomFromUrl=new URL(location.href).searchParams.get('room');
  els.nickname.value=readStorage('felt:name')||'';
  if (roomFromUrl) els.joinCode.value=roomFromUrl.toUpperCase().slice(0,5);
  else if (roomCode) els.joinCode.value=roomCode;

  function readStorage(key){try{return localStorage.getItem(key)||'';}catch{return '';}}
  function writeStorage(key,value){try{localStorage.setItem(key,value);}catch{}}
  function removeStorage(key){try{localStorage.removeItem(key);}catch{}}
  function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function fmt(n){return Number(n||0).toLocaleString('en-US');}
  function toast(message){els.toast.textContent=message;els.toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>els.toast.hidden=true,3700);}
  function saveRoom(code){roomCode=code;writeStorage('felt:room',code);history.replaceState(null,'',`/?room=${encodeURIComponent(code)}`);}
  function clearRoom(message){
    roomCode='';current=null;lastChatId=null;actionKey='';removeStorage('felt:room');
    history.replaceState(null,'','/');els.game.hidden=true;els.landing.hidden=false;els.landingFooter.hidden=false;
    if (message) toast(message);
  }
  function emitAck(event,payload,onSuccess){
    if (!socket.connected){toast('Connecting to the server. Try again in a moment.');return;}
    socket.timeout(10_000).emit(event,payload,(err,result)=>{
      if (err){toast('The server did not respond. Try again.');return;}
      if (result?.error){toast(result.error);return;}
      if (result?.ok && onSuccess)onSuccess(result);
    });
  }
  function nameValue(){const name=els.nickname.value.trim().replace(/\s+/g,' ').slice(0,18);if(!name){toast('Enter a display name first.');els.nickname.focus();return null;}writeStorage('felt:name',name);return name;}
  els.create.addEventListener('click',()=>{const name=nameValue();if(!name)return;emitAck('createRoom',{name,token},r=>saveRoom(r.code));});
  els.join.addEventListener('click',joinFromForm);
  els.joinCode.addEventListener('keydown',e=>{if(e.key==='Enter')joinFromForm();});
  els.nickname.addEventListener('keydown',e=>{if(e.key==='Enter'){if(els.joinCode.value.trim())joinFromForm();else els.create.click();}});
  function joinFromForm(){const name=nameValue();if(!name)return;const code=els.joinCode.value.trim().toUpperCase();if(!/^[A-Z0-9]{5}$/.test(code)){toast('Enter the five-character room code.');return;}emitAck('joinRoom',{code,name,token},r=>saveRoom(r.code));}
  socket.on('connect',()=>{
    els.connection.classList.remove('offline');els.connection.innerHTML='<span class="status-dot"></span>Connected';
    const inviteCode=typeof roomFromUrl==='string' && /^[A-Z0-9]{5}$/i.test(roomFromUrl) ? roomFromUrl.toUpperCase() : '';
    const stored=inviteCode||roomCode||readStorage('felt:room');
    const savedName=readStorage('felt:name');
    if (stored && savedName) {
      emitAck('joinRoom',{code:stored,name:savedName,token},r=>saveRoom(r.code));
    }
  });
  socket.on('disconnect',()=>{
    els.connection.classList.add('offline');els.connection.innerHTML='<span class="status-dot"></span>Reconnecting';
  });
  socket.on('sessionTaken',()=>clearRoom('This table was opened from another tab.'));
  socket.on('state',state=>{
    current=state;
    if (roomCode!==state.code)saveRoom(state.code);
    els.game.hidden=false;els.landing.hidden=true;els.landingFooter.hidden=true;
    render(state);
  });

  els.copyInvite.addEventListener('click',async()=>{
    if(!current)return;
    const url=`${location.origin}/?room=${encodeURIComponent(current.code)}`;
    try {await navigator.clipboard.writeText(url);toast('Invite link copied.');}
    catch {window.prompt('Copy this invite link:',url);}
  });
  els.leave.addEventListener('click',()=>{
    if (!current)return clearRoom();
    emitAck('leaveRoom',{},()=>clearRoom('You left the table.'));
  });
  els.start.addEventListener('click',()=>emitAck('startHand',{}));
  els.refill.addEventListener('click',()=>emitAck('refill',{}));
  els.fold.addEventListener('click',()=>sendAction('fold'));
  els.checkCall.addEventListener('click',()=>sendAction(current?.legal?.canCheck?'check':'call'));
  els.allin.addEventListener('click',()=>sendAction('allin'));
  els.raise.addEventListener('click',()=>sendAction('raise',Number(els.raiseAmount.value)));
  els.raiseSlider.addEventListener('input',()=>els.raiseAmount.value=els.raiseSlider.value);
  els.raiseAmount.addEventListener('input',()=>{
    const n=Number(els.raiseAmount.value);if(Number.isFinite(n))els.raiseSlider.value=String(n);
  });
  els.chatForm.addEventListener('submit',event=>{
    event.preventDefault();const text=els.chatInput.value.trim();if(!text)return;
    emitAck('chat',{text},()=>els.chatInput.value='');
  });
  function sendAction(type,amount){emitAck('action',{type,amount});}

  function cardMarkup(card,placeholder=false) {
    if(placeholder)return '<span class="playing-card placeholder" aria-label="Empty community card"></span>';
    if (!card)return '<span class="playing-card unknown" aria-label="Face-down card"></span>';
    const suit={s:'♠',h:'♥',d:'♦',c:'♣'}[card[1]]||'?';
    const face=card[0]==='T'?'10':card[0];
    const red=['h','d'].includes(card[1]);
    return `<span class="playing-card ${red?'red':''}" title="${face} of ${{s:'spades',h:'hearts',d:'diamonds',c:'clubs'}[card[1]]}" aria-label="${face} ${suit}"><span>${face}</span><span class="suit">${suit}</span></span>`;
  }
  function phaseName(phase){return ({lobby:'WAITING ROOM',preflop:'PRE-FLOP',flop:'THE FLOP',turn:'THE TURN',river:'THE RIVER',showdown:'HAND COMPLETE'})[phase]||phase.toUpperCase();}
  function render(state) {
    els.roomCode.textContent=state.code;
    els.potLabel.textContent=state.phase==='showdown'?'FINAL POT':'TOTAL POT';
    els.potAmount.textContent=fmt(state.pot);
    els.phaseLabel.textContent=phaseName(state.phase);
    els.handIndicator.textContent=`HAND #${state.handNumber}`;
    els.playerCount.textContent=`${state.players.filter(p=>p.connected).length} / 8 ONLINE`;
    els.board.innerHTML=Array.from({length:5},(_,i)=>cardMarkup(state.board[i],i>=state.board.length)).join('');
    renderPlayers(state);renderRoster(state);renderActions(state);renderChat(state);
    if (state.result) {
      const details=state.result.pots.length>1?`${state.result.pots.length} separate pots awarded`:state.result.kind==='showdown'?state.result.pots[0]?.hand:'Everyone else folded';
      els.result.innerHTML=`${escapeHTML(state.result.headline)}<small>${escapeHTML(details||'')}</small>`;
      els.result.hidden=false;
    } else els.result.hidden=true;
  }
  function renderPlayers(state) {
    const you=state.players.find(p=>p.id===state.yourId);
    const ordered=state.players.slice().sort((a,b)=>a.seat-b.seat);
    // Each player sees their own seat at the bottom.
    const yourSeat=you?.seat??0;
    const others=ordered.filter(p=>p.id!==state.yourId).sort((a,b)=>((a.seat-yourSeat+8)%8)-((b.seat-yourSeat+8)%8));
    const locations=new Map([[state.yourId,{x:50,y:85}]]);
    others.forEach((p,index)=>{
      const t=(index+1)/(others.length+1);
      locations.set(p.id,{x:9+82*t,y:48-36*Math.sin(Math.PI*t)});
    });
    els.players.innerHTML=ordered.map(p=>{
      const location=locations.get(p.id)||{x:50,y:50};
      const own=p.id===state.yourId;
      const playing= p.inHand && !p.folded;
      const status=p.id===state.actorId?'Thinking…':p.allIn?'ALL-IN':p.folded&&p.inHand?'FOLDED':p.lastAction || (p.inHand?'In hand':'Waiting');
      const cards=p.cards.map(c=>cardMarkup(c)).join('');
      const seatStatus=p.connected?'':'off';
      let role='';
      if(p.dealer)role='<span class="role-badge" title="Dealer">D</span>';
      else if(p.bigBlind)role='<span class="role-badge big-blind" title="Big blind">BB</span>';
      else if(p.smallBlind)role='<span class="role-badge small-blind" title="Small blind">SB</span>';
      return `<div class="player-seat ${own?'is-you':''} ${p.id===state.actorId?'is-turn':''} ${p.folded&&p.inHand?'is-folded':''}" style="left:${location.x}%;top:${location.y}%">
        <div class="player-cards">${cards}</div>
        ${p.bet>0?`<span class="player-bet"><span>●</span> ${fmt(p.bet)}</span>`:''}
        <div class="player-badge">${role}<span class="player-online ${seatStatus}" title="${p.connected?'Online':'Offline'}"></span><span class="player-name">${escapeHTML(p.name)}${own?' (you)':''}</span><span class="player-stack"><span class="coin mini"></span>${fmt(p.chips)}</span></div>
        <span class="player-status">${escapeHTML(status)}</span>
      </div>`;
    }).join('');
  }
  function renderRoster(state) {
    const sorted=state.players.slice().sort((a,b)=>a.seat-b.seat);
    els.seatCounter.textContent=`${sorted.length} / 8`;
    els.roster.innerHTML=sorted.map(p=>{
      const name=escapeHTML(p.name);
      const initial=escapeHTML(p.name[0]?.toUpperCase()||'?');
      const flag=p.id===state.hostId?'HOST':!p.connected?'OFFLINE':p.id===state.yourId?'YOU':'';
      return `<div class="roster-row"><span class="roster-avatar">${initial}</span><div class="roster-info"><div class="roster-name"><span>${name}</span>${flag?`<b class="roster-flag ${!p.connected?'off':''}">${flag}</b>`:''}</div><div class="roster-money">${fmt(p.chips)} chips${p.winnings?` · won ${fmt(p.winnings)}`:''}</div></div></div>`;
    }).join('');
  }
  function renderActions(state) {
    const you=state.players.find(p=>p.id===state.yourId);
    els.yourChips.innerHTML=`<span class="coin mini"></span>${fmt(you?.chips)}`;
    const isBetween=['lobby','showdown'].includes(state.phase);
    els.start.hidden=!(isBetween&&state.isHost);
    els.start.textContent=state.phase==='showdown'?'Deal next hand →':'Start the game →';
    els.refill.hidden=!(isBetween&&you && you.chips<1500);
    els.waitingActions.hidden=!!state.legal;
    els.actions.hidden=!state.legal;
    if (state.legal) {
      const legal=state.legal;
      els.actionTitle.textContent='The action is on you.';
      els.actionDescription.textContent=legal.toCall>0?`${fmt(legal.toCall)} chips to call. You have until the timer runs out.`:'You can check for free, or make a bet.';
      els.checkCall.textContent=legal.canCheck?'Check':`Call ${fmt(legal.callAmount)}`;
      els.checkCall.disabled=!(legal.canCheck||legal.canCall);
      els.allin.disabled=!legal.canAllIn;
      els.allin.hidden=!legal.canAllIn;
      els.raise.disabled=!legal.canRaise;
      els.raiseAmount.disabled=!legal.canRaise;
      els.raiseSlider.disabled=!legal.canRaise;
      const key=`${state.handNumber}:${state.phase}:${state.actorId}:${state.currentBet}`;
      const min=Math.min(legal.minRaiseTo,legal.maxRaiseTo);
      if (key!==actionKey) {els.raiseAmount.value=String(min);els.raiseSlider.value=String(min);actionKey=key;}
      els.raiseAmount.min=String(min);els.raiseAmount.max=String(legal.maxRaiseTo);
      els.raiseSlider.min=String(min);els.raiseSlider.max=String(legal.maxRaiseTo);
    } else {
      actionKey='';
      if(state.phase==='lobby') {
        els.actionTitle.textContent='The table is yours.';
        els.actionDescription.textContent='Share the invite link and wait for at least one friend to join.';
        els.waitingNote.textContent=state.isHost?'Start whenever two or more players are here.':'Waiting for the host to start the first hand.';
      } else if (state.phase==='showdown') {
        els.actionTitle.textContent='That’s a wrap.';
        els.actionDescription.textContent='The hand is complete. Play another round when everyone is ready.';
        els.waitingNote.textContent=state.isHost?'You can deal the next hand.':'Waiting for the host to deal.';
      } else if(!you?.inHand) {
        els.actionTitle.textContent='You’re sitting out this hand.';
        els.actionDescription.textContent='You will join the action at the start of the next hand.';
        els.waitingNote.textContent='Watch the table while you wait.';
      } else if(you.folded) {
        els.actionTitle.textContent='You folded this hand.';
        els.actionDescription.textContent='You’ll be back in when the next hand starts.';
        els.waitingNote.textContent='Watch the rest of the hand play out.';
      } else if(you.allIn) {
        els.actionTitle.textContent='All-in. Good luck.';
        els.actionDescription.textContent='You have no more chips to bet this hand.';
        els.waitingNote.textContent='Waiting for the remaining players.';
      } else {
        const actor=state.players.find(p=>p.id===state.actorId);
        els.actionTitle.textContent=actor?`Waiting on ${actor.name}...`:'Dealing the next card...';
        els.actionDescription.textContent='The next player has 75 seconds to make a move.';
        els.waitingNote.textContent='The game advances automatically after each action.';
      }
    }
  }
  function renderChat(state) {
    const last=state.messages.at(-1)?.id||0;
    if(last===lastChatId)return;
    const chat=els.chatMessages;
    const wasNearBottom=chat.scrollHeight-chat.scrollTop-chat.clientHeight<80;
    chat.innerHTML=state.messages.map(m=>{
      const time=new Date(m.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
      return m.type==='chat'?`<div class="chat-item"><span class="chat-name">${escapeHTML(m.name)}</span><span>${escapeHTML(m.text)}</span><span class="chat-time">${escapeHTML(time)}</span></div>`:
        `<div class="chat-item system">${escapeHTML(m.text)}</div>`;
    }).join('');
    if (wasNearBottom||lastChatId===null)chat.scrollTop=chat.scrollHeight;
    lastChatId=last;
  }
})();
