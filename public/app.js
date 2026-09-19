const socket = io(window.WORDMINE_SOCKET_URL || undefined);
const state = { id: null, name: '', words: [] };
const $ = (selector) => document.querySelector(selector);
const lobbyView = $('#lobby-view');
const gameView = $('#game-view');
const resultsView = $('#results-view');

function showMessage(selector, message, good = false) {
  const element = $(selector);
  element.textContent = message;
  element.style.color = good ? '#71817a' : '';
}

function renderPlayers(players) {
  $('#player-count').textContent = players.length;
  $('#lobby-players').innerHTML = players.map((player) => `<li><span>${escapeHtml(player.name)}</span><span>${player.connected === false ? 'away' : 'ready'}</span></li>`).join('');
}

function renderScoreboard(players) {
  $('#scoreboard').innerHTML = players.map((player) => `<li class="${player.id === state.id ? 'you' : ''}"><span>${escapeHtml(player.name)}${player.id === state.id ? ' (you)' : ''}</span><span class="score">${player.score} pts</span></li>`).join('');
}

function renderWords(words) {
  state.words = words;
  $('#word-count').textContent = words.length;
  $('#word-list').innerHTML = words.map((word) => `<span class="word-chip">${escapeHtml(word)}</span>`).join('');
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatLetterInventory(word) {
  const counts = [...word].reduce((result, letter) => {
    result[letter] = (result[letter] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).map(([letter, count]) => count > 1 ? `${letter} x${count}` : letter).join('  ');
}

function escapeHtml(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}

function openGame(round, totalRounds, baseWord) {
  lobbyView.classList.add('hidden');
  gameView.classList.remove('hidden');
  resultsView.classList.add('hidden');
  $('#round-label').textContent = `Round ${round} of ${totalRounds}`;
  $('#base-word').textContent = baseWord;
  document.querySelector('.base-hint').textContent = `Available letters: ${formatLetterInventory(baseWord)}`;
  showMessage('#word-message', '');
  $('#word-input').value = '';
  $('#word-input').focus();
  renderWords([]);
}

function openResults(payload) {
  resultsView.classList.remove('hidden');
  $('#results-eyebrow').textContent = payload.final ? 'The mine is empty' : `Round ${payload.round} complete`;
  $('#results-title').textContent = payload.final ? 'Final standings' : 'The uncommon words';
  const roundWinnerNames = payload.roundWinners.map((winner) => winner.name).join(' and ');
  const roundWinnerPoints = payload.roundWinners[0]?.points || 0;
  const finalWinnerNames = payload.finalWinners.map((winner) => winner.name).join(' and ');
  const personalRoundWin = payload.roundWinners.some((winner) => winner.id === state.id);
  const personalFinalWin = payload.finalWinners.some((winner) => winner.id === state.id);
  $('#winner-callout').className = `winner-callout ${payload.final ? (personalFinalWin ? 'winner' : 'loser') : (personalRoundWin ? 'winner' : 'loser')}`;
  $('#winner-callout').textContent = payload.final
    ? (personalFinalWin ? `You won the game with ${payload.finalWinners[0].points} points!` : `${finalWinnerNames} won the game with ${payload.finalWinners[0].points} points.`)
    : (personalRoundWin ? `You won this round with ${roundWinnerPoints} points!` : `You missed this round. ${roundWinnerNames} won with ${roundWinnerPoints} points.`);
  $('#results-summary').textContent = payload.final ? 'The final standings are in. Unique words made the difference.' : 'Shared words were crossed out. Unique finds scored one point.';
  $('#results-list').innerHTML = payload.results.map((result) => {
    const words = [...result.uniqueWords.map((word) => `<span>${escapeHtml(word)}</span>`), ...result.canceledWords.map((word) => `<span class="canceled">${escapeHtml(word)}</span>`)].join(' · ');
    return `<div class="result-row"><div><div class="result-name">${escapeHtml(result.name)}</div><div class="result-words">${words || 'No valid words this round'}</div></div><div class="result-points">+${result.roundPoints}</div></div>`;
  }).join('');
  $('#new-game-button').classList.toggle('hidden', !payload.final);
}

socket.on('connect', () => {
  $('#connection-dot').classList.add('online');
  $('#connection-text').textContent = 'Connected';
  if (state.id) {
    state.id = socket.id;
    state.name = '';
    gameView.classList.add('hidden');
    resultsView.classList.add('hidden');
    lobbyView.classList.remove('hidden');
    $('#join-form-wrap').classList.remove('hidden');
    $('#waiting-room').classList.add('hidden');
    showMessage('#join-error', 'Your connection restarted. Join the lobby again to continue.');
  }
});
socket.on('disconnect', () => {
  $('#connection-dot').classList.remove('online');
  $('#connection-text').textContent = 'Reconnecting';
  $('#word-input').disabled = true;
  $('#word-form button').disabled = true;
});
socket.on('joined', ({ id, name }) => { state.id = id; state.name = name; $('#join-form-wrap').classList.add('hidden'); $('#waiting-room').classList.remove('hidden'); });
socket.on('lobby-state', (payload) => {
  renderPlayers(payload.players);
  if (payload.phase === 'round' && state.name) {
    $('#word-input').disabled = false;
    $('#word-form button').disabled = false;
  }
  if (state.name) {
    $('#join-form-wrap').classList.add('hidden');
    $('#waiting-room').classList.remove('hidden');
  }
  $('#start-button').disabled = !payload.canStart;
  $('#lobby-status').textContent = payload.players.length < 2 ? 'Waiting for one more player...' : 'The mine is ready. Start when everyone is in.';
});
socket.on('round-start', ({ round, totalRounds, baseWord }) => openGame(round, totalRounds, baseWord));
socket.on('timer', ({ secondsLeft }) => { $('#timer').textContent = formatTime(secondsLeft); $('#timer').parentElement.classList.toggle('warning', secondsLeft <= 15); });
socket.on('scoreboard', renderScoreboard);
socket.on('round-results', openResults);
socket.on('game-over', ({ scoreboard }) => renderScoreboard(scoreboard));

$('#join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  showMessage('#join-error', '');
  socket.emit('join-lobby', $('#username').value, (response) => { if (!response.ok) showMessage('#join-error', response.error); });
});
$('#start-button').addEventListener('click', () => {
  const rounds = Number($('#round-count').value);
  socket.emit('start-game', { rounds }, (response) => { if (!response.ok) showMessage('#start-error', response.error); });
});
$('#word-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#word-input');
  socket.emit('submit-word', input.value, (response) => {
    if (!response.ok) { showMessage('#word-message', response.error); return; }
    renderWords(response.words);
    showMessage('#word-message', 'Word accepted.', true);
    input.value = '';
    input.focus();
  });
});
$('#new-game-button').addEventListener('click', () => socket.emit('new-game', (response) => { if (!response.ok) return; resultsView.classList.add('hidden'); gameView.classList.add('hidden'); lobbyView.classList.remove('hidden'); }));