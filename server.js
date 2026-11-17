const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));

// =========================
// 414 Core Rules & Engine
// =========================
const LEVELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const BASE_RANK_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'SJ', 'BJ'];
const STRAIGHT_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = [
  { symbol: '♠', color: 'card-black' },
  { symbol: '♥', color: 'card-red' },
  { symbol: '♣', color: 'card-black' },
  { symbol: '♦', color: 'card-red' }
];
const DEFAULT_SEAT_NAMES = ['南家', '东家', '北家', '西家'];

function getRankPower(rank, activeLevel) {
  if (rank === 'BJ') return 100;
  if (rank === 'SJ') return 99;
  if (rank === activeLevel) return 98;
  return BASE_RANK_ORDER.indexOf(rank);
}

function createDoubleDeck() {
  const deck = [];
  let id = 1;
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (const rank of ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']) {
        deck.push({ id: id++, rank, suit: suit.symbol, color: suit.color, isJoker: false });
      }
    }
    deck.push({ id: id++, rank: 'SJ', suit: '★', color: 'card-joker-small', isJoker: true });
    deck.push({ id: id++, rank: 'BJ', suit: '★', color: 'card-joker-big', isJoker: true });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function evaluateCards(cards, activeLevel) {
  const n = cards.length;
  if (n === 0) return null;

  const counts = {};
  for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
  const uniqueRanks = Object.keys(counts);

  // 1. A44 Rocket
  if (n === 3 && counts['A'] === 1 && counts['4'] === 2) {
    return { type: 'rocket', label: '火箭 (A44)', isBomb: true, bombTier: 100, power: 9999 };
  }

  // 2. Double Joker
  if (n === 2 && cards.every(c => c.isJoker)) {
    const jokerSum = cards.reduce((s, c) => s + (c.rank === 'BJ' ? 2 : 1), 0);
    return { type: 'double_joker', label: '双王', isBomb: true, bombTier: 4.5, power: jokerSum };
  }

  // Single Joker
  if (cards.some(c => c.isJoker)) {
    if (n === 1) {
      return {
        type: 'single',
        label: cards[0].rank === 'BJ' ? '大王' : '小王',
        rank: cards[0].rank,
        isBomb: false,
        power: getRankPower(cards[0].rank, activeLevel)
      };
    }
    return null;
  }

  // 3. Single
  if (n === 1) {
    return {
      type: 'single',
      label: `单牌 ${cards[0].rank}`,
      rank: cards[0].rank,
      isBomb: false,
      power: getRankPower(cards[0].rank, activeLevel)
    };
  }

  // 4. Pair / Small Bomb / Big Bomb
  if (uniqueRanks.length === 1) {
    const r = uniqueRanks[0];
    const p = getRankPower(r, activeLevel);
    if (n === 2) return { type: 'pair', label: `对子 ${r}${r}`, rank: r, isBomb: false, power: p };
    if (n === 3) return { type: 'small_bomb', label: `小炸弹 ${r}×3`, rank: r, isBomb: true, bombTier: 3, power: p };
    if (n >= 4) return { type: 'big_bomb', label: `${n}张大炸弹 (${r})`, rank: r, count: n, isBomb: true, bombTier: n, power: p };
  }

  // 5. Single Straight (单龙)
  if (n >= 3 && uniqueRanks.length === n) {
    const idxs = uniqueRanks.map(r => STRAIGHT_ORDER.indexOf(r)).sort((a, b) => a - b);
    if (idxs[0] !== -1 && idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1)) {
      const highRank = STRAIGHT_ORDER[idxs[idxs.length - 1]];
      return { type: 'single_dragon', label: `单龙 (${STRAIGHT_ORDER[idxs[0]]}~${highRank})`, length: n, isBomb: false, power: idxs[idxs.length - 1] };
    }
  }

  // 6. Double Straight (双龙)
  if (n >= 6 && n % 2 === 0 && uniqueRanks.every(r => counts[r] === 2)) {
    const idxs = uniqueRanks.map(r => STRAIGHT_ORDER.indexOf(r)).sort((a, b) => a - b);
    if (idxs.length >= 3 && idxs[0] !== -1 && idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1)) {
      const highRank = STRAIGHT_ORDER[idxs[idxs.length - 1]];
      return { type: 'double_dragon', label: `双龙 (${STRAIGHT_ORDER[idxs[0]]}~${highRank})`, length: idxs.length, isBomb: false, power: idxs[idxs.length - 1] };
    }
  }

  return null;
}

function checkPlayAgainstTable(candidateEval, tablePlay, seat) {
  if (!candidateEval) return { valid: false, reason: '无效牌型' };
  if (!tablePlay) return { valid: true, mode: 'normal' };

  const topEval = tablePlay.eval;
  const topMode = tablePlay.mode;

  if (tablePlay.seat !== seat) {
    if ((topMode === 'normal' && topEval.type === 'single' && !['SJ', 'BJ'].includes(topEval.rank)) || topMode === 'gou') {
      if (candidateEval.type === 'pair' && candidateEval.rank === topEval.rank) {
        return { valid: true, mode: 'cha' };
      }
    }
    if (topMode === 'cha' || topMode === 'gou') {
      if (candidateEval.type === 'single' && candidateEval.rank === topEval.rank) {
        return { valid: true, mode: 'gou' };
      }
    }
  }

  if (topMode === 'gou') {
    if (candidateEval.type === 'rocket') return { valid: true, mode: 'normal' };
    return { valid: false, reason: '勾只能被火箭或叉/勾拦截' };
  }

  if (topMode === 'cha') {
    if (candidateEval.isBomb && candidateEval.bombTier >= 4) return { valid: true, mode: 'normal' };
    return { valid: false, reason: '叉只能用勾或4张及以上炸弹拦截' };
  }

  if (candidateEval.isBomb) {
    if (!topEval.isBomb) return { valid: true, mode: 'normal' };
    if (candidateEval.bombTier > topEval.bombTier) return { valid: true, mode: 'normal' };
    if (candidateEval.bombTier === topEval.bombTier && candidateEval.power > topEval.power) return { valid: true, mode: 'normal' };
    return { valid: false, reason: '炸弹不够大' };
  }

  if (topEval.isBomb) return { valid: false, reason: '须用更大的炸弹拦截' };
  if (candidateEval.type !== topEval.type) return { valid: false, reason: '牌型不匹配' };
  if ((candidateEval.type === 'single_dragon' || candidateEval.type === 'double_dragon') && candidateEval.length !== topEval.length) {
    return { valid: false, reason: '龙的长度必须相同' };
  }
  if (candidateEval.power > topEval.power) return { valid: true, mode: 'normal' };
  return { valid: false, reason: '点数不够大' };
}

function groupByRank(hand) {
  const map = {};
  for (const c of hand) {
    if (!map[c.rank]) map[c.rank] = [];
    map[c.rank].push(c);
  }
  return map;
}

function findAllValidPlays(hand, tablePlay, seat, activeLevel) {
  const results = [];
  const groups = groupByRank(hand);
  const ranks = Object.keys(groups);
  const tryPush = (cards) => {
    const ev = evaluateCards(cards, activeLevel);
    if (!ev) return;
    const chk = checkPlayAgainstTable(ev, tablePlay, seat);
    if (chk.valid) results.push({ cards, eval: ev, mode: chk.mode });
  };

  for (const r of ranks) tryPush([groups[r][0]]);
  for (const r of ranks) {
    if (r === 'SJ' || r === 'BJ') continue;
    const list = groups[r];
    if (list.length >= 2) tryPush(list.slice(0, 2));
    if (list.length >= 3) tryPush(list.slice(0, 3));
    for (let k = 4; k <= list.length; k++) tryPush(list.slice(0, k));
  }
  if ((groups['SJ'] || []).length >= 2) tryPush(groups['SJ'].slice(0, 2));
  if (groups['SJ']?.length && groups['BJ']?.length) tryPush([groups['SJ'][0], groups['BJ'][0]]);
  if ((groups['BJ'] || []).length >= 2) tryPush(groups['BJ'].slice(0, 2));
  if (groups['A']?.length >= 1 && groups['4']?.length >= 2) tryPush([groups['A'][0], groups['4'][0], groups['4'][1]]);

  const targetSingleLen = (tablePlay && !tablePlay.eval.isBomb && tablePlay.eval.type === 'single_dragon') ? tablePlay.eval.length : null;
  for (let start = 0; start < STRAIGHT_ORDER.length; start++) {
    let seq = [];
    for (let i = start; i < STRAIGHT_ORDER.length; i++) {
      const r = STRAIGHT_ORDER[i];
      if (!groups[r] || groups[r].length === 0) break;
      seq.push(groups[r][0]);
      if (seq.length >= 3 && (!targetSingleLen || seq.length === targetSingleLen)) tryPush([...seq]);
    }
  }

  const targetDoubleLen = (tablePlay && !tablePlay.eval.isBomb && tablePlay.eval.type === 'double_dragon') ? tablePlay.eval.length : null;
  for (let start = 0; start < STRAIGHT_ORDER.length; start++) {
    let seq = [];
    for (let i = start; i < STRAIGHT_ORDER.length; i++) {
      const r = STRAIGHT_ORDER[i];
      if (!groups[r] || groups[r].length < 2) break;
      seq.push(groups[r][0], groups[r][1]);
      if (i - start + 1 >= 3 && (!targetDoubleLen || i - start + 1 === targetDoubleLen)) tryPush([...seq]);
    }
  }
  return results;
}

function findChaGouOptions(hand, tablePlay, seat, activeLevel) {
  if (!tablePlay || tablePlay.seat === seat) return [];
  const groups = groupByRank(hand);
  const top = tablePlay.eval;
  const opts = [];
  if ((tablePlay.mode === 'normal' && top.type === 'single' && !['SJ', 'BJ'].includes(top.rank)) || tablePlay.mode === 'gou') {
    if (groups[top.rank]?.length >= 2) {
      const cards = groups[top.rank].slice(0, 2);
      opts.push({ cards, eval: evaluateCards(cards, activeLevel), mode: 'cha' });
    }
  }
  if (tablePlay.mode === 'cha' || tablePlay.mode === 'gou') {
    if (groups[top.rank]?.length >= 1) {
      const cards = [groups[top.rank][0]];
      opts.push({ cards, eval: evaluateCards(cards, activeLevel), mode: 'gou' });
    }
  }
  return opts;
}

// =========================
// Room Management
// =========================
const rooms = new Map();

function generateRoomId() {
  let code = '';
  do {
    code = '414-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createRoomState(roomId, hostSocketId, hostName) {
  return {
    roomId,
    hostSocketId,
    seats: [
      { socketId: hostSocketId, name: hostName, isAI: false },
      { socketId: null, name: '东家 (AI)', isAI: true },
      { socketId: null, name: '北家 (AI)', isAI: true },
      { socketId: null, name: '西家 (AI)', isAI: true }
    ],
    teamLevels: [0, 0],
    activeLevel: '2',
    roundNumber: 1,
    leadSeat: 0,
    hands: [[], [], [], []],
    currentTurn: 0,
    tablePlay: null,
    passCount: 0,
    finishOrder: [],
    lastPlaysBySeat: [null, null, null, null],
    roundActive: false,
    waitingInterrupt: false,
    interruptTargetSeat: null,
    interruptOptions: null,
    roundSummary: null,
    aiTimer: null
  };
}

function broadcastRoom(room, toastMsg = null) {
  const handCounts = room.hands.map(h => h.length);
  const seatPlayers = room.seats.map(s => ({ name: s.name, isAI: s.isAI }));

  room.seats.forEach((seatObj, seatIdx) => {
    if (!seatObj.isAI && seatObj.socketId) {
      io.to(seatObj.socketId).emit('stateSync', {
        roomId: room.roomId,
        isHost: seatObj.socketId === room.hostSocketId,
        mySeat: seatIdx,
        myHand: room.hands[seatIdx],
        handCounts,
        seatPlayers,
        teamLevels: room.teamLevels,
        activeLevel: room.activeLevel,
        currentTurn: room.currentTurn,
        tablePlay: room.tablePlay,
        finishOrder: room.finishOrder,
        lastPlaysBySeat: room.lastPlaysBySeat,
        roundActive: room.roundActive,
        waitingInterrupt: room.waitingInterrupt,
        roundNumber: room.roundNumber,
        interruptOpts: room.interruptTargetSeat === seatIdx ? room.interruptOptions : null,
        roundSummary: room.roundSummary,
        toastMsg
      });
    }
  });
}

function startRound(room) {
  clearTimeout(room.aiTimer);
  const deck = createDoubleDeck();
  room.hands = [[], [], [], []];
  for (let i = 0; i < 108; i++) room.hands[i % 4].push(deck[i]);
  room.tablePlay = null;
  room.passCount = 0;
  room.finishOrder = [];
  room.lastPlaysBySeat = [null, null, null, null];
  room.currentTurn = room.leadSeat;
  room.roundActive = true;
  room.waitingInterrupt = false;
  room.interruptTargetSeat = null;
  room.interruptOptions = null;
  room.roundSummary = null;

  broadcastRoom(room, `第 ${room.roundNumber} 局开始 · 本局主牌：${room.activeLevel}`);
  if (room.seats[room.currentTurn].isAI) scheduleAiTurn(room);
}

function nextActiveSeat(room, fromSeat) {
  for (let step = 1; step <= 4; step++) {
    const s = (fromSeat + step) % 4;
    if (room.hands[s].length > 0) return s;
  }
  return fromSeat;
}

function executePlay(room, seat, cards, evalObj, mode) {
  const idSet = new Set(cards.map(c => c.id));
  room.hands[seat] = room.hands[seat].filter(c => !idSet.has(c.id));

  const modePrefix = mode === 'cha' ? '叉! ' : mode === 'gou' ? '勾! ' : '';
  room.tablePlay = { seat, eval: evalObj, cards, mode };
  room.passCount = 0;
  room.lastPlaysBySeat[seat] = { text: `${modePrefix}${evalObj.label}`, cards, pass: false };
  room.waitingInterrupt = false;
  room.interruptTargetSeat = null;
  room.interruptOptions = null;

  let toast = null;
  if (room.hands[seat].length === 0 && !room.finishOrder.includes(seat)) {
    room.finishOrder.push(seat);
    toast = `${room.seats[seat].name} 出完了所有牌！(第 ${room.finishOrder.length} 名)`;
  }

  const teamADone = room.hands[0].length === 0 && room.hands[2].length === 0;
  const teamBDone = room.hands[1].length === 0 && room.hands[3].length === 0;
  if (teamADone || teamBDone) {
    endRound(room);
    return;
  }

  // Check immediate Cha/Gou for human seats
  for (let step = 1; step <= 3; step++) {
    const s = (seat + step) % 4;
    if (!room.seats[s].isAI && room.hands[s].length > 0) {
      const opts = findChaGouOptions(room.hands[s], room.tablePlay, s, room.activeLevel);
      if (opts.length > 0) {
        room.waitingInterrupt = true;
        room.interruptTargetSeat = s;
        room.interruptOptions = opts;
        room.currentTurn = nextActiveSeat(room, seat);
        broadcastRoom(room, toast);
        return;
      }
    }
  }

  advanceTurnAfterPlay(room, seat, toast);
}

function advanceTurnAfterPlay(room, lastPlaySeat, toast = null) {
  for (let step = 1; step <= 3; step++) {
    const s = (lastPlaySeat + step) % 4;
    if (room.seats[s].isAI && room.hands[s].length > 0) {
      const opts = findChaGouOptions(room.hands[s], room.tablePlay, s, room.activeLevel);
      if (opts.length > 0 && Math.random() < 0.65) {
        room.currentTurn = s;
        broadcastRoom(room, toast);
        room.aiTimer = setTimeout(() => {
          executePlay(room, s, opts[0].cards, opts[0].eval, opts[0].mode);
        }, 650);
        return;
      }
    }
  }

  room.currentTurn = nextActiveSeat(room, lastPlaySeat);
  broadcastRoom(room, toast);
  if (room.roundActive && room.seats[room.currentTurn].isAI) scheduleAiTurn(room);
}

function executePass(room, seat) {
  room.lastPlaysBySeat[seat] = { text: '不出', cards: [], pass: true };
  room.passCount++;

  const remaining = [0, 1, 2, 3].filter(s => room.hands[s].length > 0);
  const tableSeatAlive = room.tablePlay && room.hands[room.tablePlay.seat].length > 0;
  const neededPasses = tableSeatAlive ? remaining.length - 1 : remaining.length;

  if (room.tablePlay && room.passCount >= neededPasses) {
    const winnerSeat = room.tablePlay.seat;
    let nextLeader = winnerSeat;
    if (room.hands[winnerSeat].length === 0) {
      const mate = (winnerSeat + 2) % 4;
      nextLeader = room.hands[mate].length > 0 ? mate : nextActiveSeat(room, winnerSeat);
    }
    room.tablePlay = null;
    room.passCount = 0;
    room.lastPlaysBySeat = [null, null, null, null];
    room.currentTurn = nextLeader;
  } else {
    room.currentTurn = nextActiveSeat(room, seat);
  }

  broadcastRoom(room);
  if (room.roundActive && room.seats[room.currentTurn].isAI) scheduleAiTurn(room);
}

function scheduleAiTurn(room) {
  clearTimeout(room.aiTimer);
  room.aiTimer = setTimeout(() => {
    if (!room.roundActive || room.waitingInterrupt) return;
    const seat = room.currentTurn;
    const hand = room.hands[seat];
    if (hand.length === 0) {
      executePass(room, seat);
      return;
    }

    const validPlays = findAllValidPlays(hand, room.tablePlay, seat, room.activeLevel);
    if (!room.tablePlay) {
      const nonBombs = validPlays.filter(p => !p.eval.isBomb);
      let choice = null;
      if (nonBombs.length > 0) {
        nonBombs.sort((a, b) => (b.cards.length - a.cards.length) || (a.eval.power - b.eval.power));
        choice = nonBombs[0];
      } else {
        validPlays.sort((a, b) => a.eval.bombTier - b.eval.bombTier || a.eval.power - b.eval.power);
        choice = validPlays[0];
      }
      executePlay(room, seat, choice.cards, choice.eval, choice.mode);
      return;
    }

    if (validPlays.length === 0) {
      executePass(room, seat);
      return;
    }

    const tableOwner = room.tablePlay.seat;
    if ((tableOwner % 2) === (seat % 2)) {
      const finisher = validPlays.find(p => p.cards.length === hand.length);
      if (finisher) executePlay(room, seat, finisher.cards, finisher.eval, finisher.mode);
      else executePass(room, seat);
      return;
    }

    const nonBombs = validPlays.filter(p => !p.eval.isBomb);
    if (nonBombs.length > 0) {
      nonBombs.sort((a, b) => a.eval.power - b.eval.power);
      executePlay(room, seat, nonBombs[0].cards, nonBombs[0].eval, nonBombs[0].mode);
      return;
    }

    const bombs = validPlays.filter(p => p.eval.isBomb).sort((a, b) => a.eval.bombTier - b.eval.bombTier || a.eval.power - b.eval.power);
    const oppLow = room.hands[tableOwner].length <= 6 || hand.length <= 5;
    if (bombs.length > 0 && (oppLow || room.tablePlay.eval.power >= 10 || Math.random() < 0.45)) {
      executePlay(room, seat, bombs[0].cards, bombs[0].eval, bombs[0].mode);
    } else {
      executePass(room, seat);
    }
  }, 680);
}

function endRound(room) {
  room.roundActive = false;
  clearTimeout(room.aiTimer);

  const remaining = [0, 1, 2, 3].filter(s => !room.finishOrder.includes(s));
  const firstFinisher = room.finishOrder[0];
  const winningTeam = firstFinisher % 2;
  const losingTeam = 1 - winningTeam;
  const winMateFinished = room.hands[(firstFinisher + 2) % 4].length === 0;

  let points = 0;
  if (winMateFinished) {
    points = [losingTeam, losingTeam + 2].filter(s => room.hands[s].length > 0).length;
  }

  const wasAtAce = room.teamLevels[winningTeam] === LEVELS.length - 1;
  const matchWon = wasAtAce && points === 2;
  if (!matchWon && points > 0) {
    room.teamLevels[winningTeam] = Math.min(LEVELS.length - 1, room.teamLevels[winningTeam] + points);
  }

  room.activeLevel = LEVELS[room.teamLevels[winningTeam]];
  room.leadSeat = firstFinisher;
  room.roundSummary = {
    matchWon,
    roundNum: room.roundNumber,
    winningTeam,
    points,
    activeLevel: room.activeLevel,
    finishOrder: [...room.finishOrder],
    remaining: remaining.map(s => ({ seat: s, count: room.hands[s].length })),
    teamLevels: [...room.teamLevels]
  };
  room.roundNumber++;

  if (matchWon) {
    room.teamLevels = [0, 0];
    room.activeLevel = '2';
    room.roundNumber = 1;
  }

  broadcastRoom(room);
}

// =========================
// Socket.IO Event Handlers
// =========================
io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    const roomId = generateRoomId();
    const cleanName = (name || '房主').trim().slice(0, 10) || '房主';
    const room = createRoomState(roomId, socket.id, cleanName);
    rooms.set(roomId, room);
    socket.data.roomId = roomId;
    socket.data.seat = 0;
    broadcastRoom(room, `房间 ${roomId} 创建成功`);
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const code = (roomId || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('errorMsg', '未找到该房间号，请检查是否输入正确');
      return;
    }
    const openSeat = [1, 2, 3].find(s => room.seats[s].isAI);
    if (openSeat === undefined) {
      socket.emit('errorMsg', '该房间已满 (4/4)');
      return;
    }
    const cleanName = (name || `玩家${openSeat + 1}`).trim().slice(0, 10);
    room.seats[openSeat] = { socketId: socket.id, name: cleanName, isAI: false };
    socket.data.roomId = code;
    socket.data.seat = openSeat;
    broadcastRoom(room, `${cleanName} 加入了房间`);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostSocketId !== socket.id) return;
    startRound(room);
  });

  socket.on('playCards', ({ cardIds }) => {
    const room = rooms.get(socket.data.roomId);
    const seat = socket.data.seat;
    if (!room || !room.roundActive || seat === undefined) return;

    const isInterruptPlayer = room.waitingInterrupt && room.interruptTargetSeat === seat;
    if (!isInterruptPlayer && (room.waitingInterrupt || room.currentTurn !== seat)) return;

    const cards = room.hands[seat].filter(c => cardIds.includes(c.id));
    if (cards.length !== cardIds.length) return; // Anti-cheat: must own cards

    const ev = evaluateCards(cards, room.activeLevel);
    const chk = checkPlayAgainstTable(ev, room.tablePlay, seat);
    if (!chk.valid) {
      socket.emit('errorMsg', chk.reason || '出牌不合法');
      return;
    }
    executePlay(room, seat, cards, ev, chk.mode);
  });

  socket.on('passTurn', () => {
    const room = rooms.get(socket.data.roomId);
    const seat = socket.data.seat;
    if (!room || !room.roundActive || room.waitingInterrupt || room.currentTurn !== seat || !room.tablePlay) return;
    executePass(room, seat);
  });

  socket.on('skipInterrupt', () => {
    const room = rooms.get(socket.data.roomId);
    const seat = socket.data.seat;
    if (!room || !room.waitingInterrupt || room.interruptTargetSeat !== seat) return;
    room.waitingInterrupt = false;
    room.interruptTargetSeat = null;
    room.interruptOptions = null;
    advanceTurnAfterPlay(room, room.tablePlay.seat);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomId);
    const seat = socket.data.seat;
    if (!room || seat === undefined) return;

    const oldName = room.seats[seat].name;
    room.seats[seat] = { socketId: null, name: `${DEFAULT_SEAT_NAMES[seat]} (AI)`, isAI: true };

    const remainingHumans = room.seats.filter(s => !s.isAI);
    if (remainingHumans.length === 0) {
      clearTimeout(room.aiTimer);
      rooms.delete(room.roomId);
      return;
    }

    if (room.hostSocketId === socket.id) {
      room.hostSocketId = remainingHumans[0].socketId;
    }

    if (room.waitingInterrupt && room.interruptTargetSeat === seat) {
      room.waitingInterrupt = false;
      room.interruptTargetSeat = null;
      room.interruptOptions = null;
    }

    broadcastRoom(room, `${oldName} 已离开，由 AI 接管`);
    if (room.roundActive && room.currentTurn === seat) scheduleAiTurn(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`414 Poker Server listening on http://localhost:${PORT}`);
});
