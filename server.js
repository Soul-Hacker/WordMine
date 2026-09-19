const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 10;
const ROUND_SECONDS = 120;
const MIN_WORD_LENGTH = 3;
const FALLBACK_BASE_WORDS = [
  'extinguisher', 'blacksmith', 'playground', 'masterpiece', 'friendship',
  'newspaper', 'background', 'conversation', 'imagination', 'celebration'
];

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || true,
    methods: ['GET', 'POST']
  }
});
app.use(express.static(path.join(__dirname, 'public')));

const dictionaryPath = require('word-list').default || require('word-list');
const dictionary = new Set(
  fs.readFileSync(dictionaryPath, 'utf8')
    .split('\n')
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z]+$/.test(word))
);
const baseWords = [...dictionary].filter((word) => word.length >= 8 && word.length <= 16);

const players = new Map();
const game = {
  phase: 'lobby',
  round: 0,
  roundLimit: 5,
  baseWord: '',
  endsAt: 0,
  timer: null,
  nextRoundTimer: null
};

function publicPlayers() {
  return [...players.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(({ id, name, score, connected }) => ({ id, name, score, connected }));
}

function broadcastLobby() {
  io.emit('lobby-state', {
    players: publicPlayers(),
    canStart: players.size >= 2 && game.phase === 'lobby',
    phase: game.phase,
    round: game.round,
    roundLimit: game.roundLimit
  });
}

function emitScoreboard() {
  io.emit('scoreboard', publicPlayers());
}

function chooseBaseWord() {
  const pool = baseWords.length ? baseWords : FALLBACK_BASE_WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function letterCounts(word) {
  return [...word].reduce((counts, letter) => {
    counts[letter] = (counts[letter] || 0) + 1;
    return counts;
  }, {});
}

function validDerivative(word) {
  const normalized = word.trim().toLowerCase();
  if (!/^[a-z]+$/.test(normalized) || normalized.length < MIN_WORD_LENGTH) {
    return { valid: false, reason: 'Words must be at least 3 letters.' };
  }
  if (normalized === game.baseWord) {
    return { valid: false, reason: 'The base word does not count.' };
  }
  if (!dictionary.has(normalized)) {
    return { valid: false, reason: 'That word is not in the dictionary.' };
  }

  const available = letterCounts(game.baseWord);
  const missingLetters = [];
  for (const [letter, count] of Object.entries(letterCounts(normalized))) {
    if (!available[letter] || count > available[letter]) {
      missingLetters.push(available[letter] ? `${letter} (need ${count}, have ${available[letter]})` : letter);
    }
  }
  if (missingLetters.length) {
    return { valid: false, reason: `Unavailable letter(s): ${missingLetters.join(', ')}. Base word: ${game.baseWord}.` };
  }
  return { valid: true, word: normalized };
}

function sendTimer() {
  const secondsLeft = Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000));
  io.emit('timer', { secondsLeft });
  return secondsLeft;
}

function beginRound() {
  game.phase = 'round';
  game.round += 1;
  game.baseWord = chooseBaseWord();
  game.endsAt = Date.now() + ROUND_SECONDS * 1000;
  for (const player of players.values()) player.words = new Set();

  io.emit('round-start', {
    round: game.round,
    totalRounds: game.roundLimit,
    baseWord: game.baseWord,
    seconds: ROUND_SECONDS
  });
  emitScoreboard();
  sendTimer();
  game.timer = setInterval(() => {
    if (sendTimer() === 0) finishRound();
  }, 1000);
}

function finishRound() {
  if (game.phase !== 'round') return;
  clearInterval(game.timer);
  game.timer = null;
  game.phase = 'results';

  const occurrences = new Map();
  for (const player of players.values()) {
    for (const word of player.words) {
      occurrences.set(word, (occurrences.get(word) || 0) + 1);
    }
  }

  const roundResults = [...players.values()].map((player) => {
    const uniqueWords = [...player.words].filter((word) => occurrences.get(word) === 1);
    const canceledWords = [...player.words].filter((word) => occurrences.get(word) > 1);
    player.score += uniqueWords.length;
    return {
      id: player.id,
      name: player.name,
      uniqueWords,
      canceledWords,
      roundPoints: uniqueWords.length,
      totalScore: player.score
    };
  });

  const highestRoundPoints = Math.max(...roundResults.map((result) => result.roundPoints));
  const roundWinners = roundResults.filter((result) => result.roundPoints === highestRoundPoints);
  const final = game.round === game.roundLimit;
  const highestTotalScore = Math.max(...roundResults.map((result) => result.totalScore));
  const finalWinners = final ? roundResults.filter((result) => result.totalScore === highestTotalScore) : [];
  const finalLosers = final ? roundResults.filter((result) => result.totalScore < highestTotalScore) : [];

  io.emit('round-results', {
    round: game.round,
    baseWord: game.baseWord,
    results: roundResults,
    scoreboard: publicPlayers(),
    final,
    roundWinners: roundWinners.map(({ id, name, roundPoints }) => ({ id, name, points: roundPoints })),
    finalWinners: finalWinners.map(({ id, name, totalScore }) => ({ id, name, points: totalScore })),
    finalLosers: finalLosers.map(({ id, name, totalScore }) => ({ id, name, points: totalScore }))
  });
  emitScoreboard();

  if (final) {
    game.phase = 'finished';
    io.emit('game-over', { scoreboard: publicPlayers() });
    broadcastLobby();
    return;
  }

  game.nextRoundTimer = setTimeout(beginRound, 7000);
}

function resetGame() {
  clearInterval(game.timer);
  clearTimeout(game.nextRoundTimer);
  game.phase = 'lobby';
  game.round = 0;
  game.roundLimit = 5;
  game.baseWord = '';
  game.endsAt = 0;
  for (const player of players.values()) {
    player.score = 0;
    player.words = new Set();
  }
}

io.on('connection', (socket) => {
  socket.emit('lobby-state', {
    players: publicPlayers(),
    canStart: players.size >= 2 && game.phase === 'lobby',
    phase: game.phase,
    round: game.round
  });
  if (game.phase === 'round') {
    socket.emit('round-start', {
      round: game.round,
      totalRounds: game.roundLimit,
      baseWord: game.baseWord,
      seconds: Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000))
    });
    socket.emit('timer', { secondsLeft: Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000)) });
    socket.emit('scoreboard', publicPlayers());
  }

  socket.on('join-lobby', (rawName, reply) => {
    const name = String(rawName || '').trim().slice(0, 18);
    const taken = [...players.values()].some((player) => player.name.toLowerCase() === name.toLowerCase());
    if (!/^[a-z0-9 _-]{2,18}$/i.test(name)) return reply?.({ ok: false, error: 'Use 2-18 letters, numbers, spaces, _ or -.' });
    if (taken) return reply?.({ ok: false, error: 'That username is already in use.' });
    if (game.phase !== 'lobby') return reply?.({ ok: false, error: 'The game is already in progress.' });

    players.set(socket.id, { id: socket.id, name, score: 0, words: new Set(), connected: true });
    reply?.({ ok: true });
    socket.emit('joined', { id: socket.id, name });
    broadcastLobby();
  });

  socket.on('start-game', (settings, reply) => {
    if (typeof settings === 'function') {
      reply = settings;
      settings = {};
    }
    if (!players.has(socket.id)) return reply?.({ ok: false, error: 'Join the lobby first.' });
    if (players.size < 2) return reply?.({ ok: false, error: 'At least two players are required.' });
    if (game.phase !== 'lobby') return reply?.({ ok: false, error: 'A game is already running.' });
    const requestedRounds = Number(settings?.rounds);
    if (!Number.isInteger(requestedRounds) || requestedRounds < MIN_ROUNDS || requestedRounds > MAX_ROUNDS) {
      return reply?.({ ok: false, error: `Choose between ${MIN_ROUNDS} and ${MAX_ROUNDS} rounds.` });
    }
    game.roundLimit = requestedRounds;
    reply?.({ ok: true });
    beginRound();
  });

  socket.on('submit-word', (rawWord, reply) => {
    const player = players.get(socket.id);
    if (!player) return reply?.({ ok: false, error: 'Your lobby session ended. Please join the lobby again.' });
    if (game.phase !== 'round') return reply?.({ ok: false, error: 'This round has ended. Wait for the next round to begin.' });
    const result = validDerivative(String(rawWord || ''));
    if (!result.valid) return reply?.({ ok: false, error: result.reason });
    if (player.words.has(result.word)) return reply?.({ ok: false, error: 'You already found that word.' });
    player.words.add(result.word);
    reply?.({ ok: true, word: result.word, words: [...player.words].sort() });
  });

  socket.on('new-game', (reply) => {
    if (game.phase !== 'finished') return reply?.({ ok: false, error: 'The current game has not finished.' });
    resetGame();
    reply?.({ ok: true });
    broadcastLobby();
  });

  socket.on('disconnect', () => {
    if (game.phase === 'lobby' || game.phase === 'finished') {
      players.delete(socket.id);
      broadcastLobby();
    } else {
      const player = players.get(socket.id);
      if (player) player.connected = false;
      broadcastLobby();
    }
  });
});

server.listen(PORT, () => {
  console.log(`WordMine is running at http://localhost:${PORT}`);
  console.log(`Loaded ${dictionary.size.toLocaleString()} dictionary words.`);
});