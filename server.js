// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.get('/', (req, res) => res.send('Typo Royale backend running'));

const sentences = [
  "The quick brown fox jumps over the lazy dog.",
  "Typing fast is a skill worth mastering.",
  "JavaScript powers interactive web experiences.",
  "Socket.IO enables real-time communication.",
  "Frontend and backend must work together."
];

// rooms structure:
// rooms[roomId] = {
//   players: [{ id, name, score }],
//   hostId,
//   round: 0,
//   totalRounds: 0,
//   currentSentence: '',
//   submittedCount: 0
// }
const rooms = {};

function pickSentence() {
  return sentences[Math.floor(Math.random() * sentences.length)];
}

function safeEmitRoomUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('roomUpdate', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
}

function broadcastScores(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('scoreUpdate', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
}

io.on('connection', (socket) => {
  console.log('connect', socket.id);

  socket.on('createRoom', (roomId) => {
    if (!roomId) return;
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], hostId: socket.id, round: 0, totalRounds: 0, currentSentence: '', submittedCount: 0 };
      console.log('room created', roomId);
    } else {
      rooms[roomId].hostId = socket.id;
    }
  });

  socket.on('joinRoom', (roomId, name) => {
    if (!roomId || !name) return;
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], hostId: null, round: 0, totalRounds: 0, currentSentence: '', submittedCount: 0 };
    }
    const room = rooms[roomId];

    // prevent duplicate entries for same socket
    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: name || socket.id, score: 0 });
    }

    safeEmitRoomUpdate(roomId);
    console.log(`${name} joined ${roomId}`);
  });

  socket.on('startGame', (roomId, totalRounds) => {
    const room = rooms[roomId];
    if (!room) return;
    // only host may start (best-effort)
    if (room.hostId && room.hostId !== socket.id) {
      // allow if host isn't set; otherwise ignore
      console.log('startGame blocked - not host');
      return;
    }
    room.totalRounds = Math.max(1, parseInt(totalRounds, 10) || 1);
    room.round = 1;
    room.players.forEach(p => p.score = 0);
    room.submittedCount = 0;
    room.currentSentence = pickSentence();
    io.to(roomId).emit('gameStarted', { sentence: room.currentSentence, round: room.round, total: room.totalRounds });
    broadcastScores(roomId);
    console.log(`gameStarted ${roomId} round ${room.round}`);
  });

  socket.on('submitScore', ({ roomId, score }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.score = (player.score || 0) + (Number.isFinite(score) ? score : 0);
    room.submittedCount = (room.submittedCount || 0) + 1;

    // broadcast updated scores immediately
    broadcastScores(roomId);
    console.log(`score submitted ${roomId} ${player.name} +${score} (round ${room.round})`);

    // optional: if all players submitted, advance automatically after short delay
    if (room.submittedCount >= room.players.length) {
      // ensure small delay to allow frontends to show scoreboard for 3s
      setTimeout(() => {
        if (room.round < room.totalRounds) {
          room.round += 1;
          room.currentSentence = pickSentence();
          room.submittedCount = 0;
          io.to(roomId).emit('nextRound', { sentence: room.currentSentence, round: room.round, total: room.totalRounds });
          console.log(`auto nextRound ${roomId} -> ${room.round}`);
        } else {
          io.to(roomId).emit('gameOver', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
          console.log(`gameOver ${roomId}`);
        }
      }, 3000); // keep 3s scoreboard display
    }
  });

  socket.on('readyForNextRound', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    // increment submitted count to reflect this player's readiness if they haven't submitted already
    room.submittedCount = (room.submittedCount || 0) + 1;

    // if everyone ready, move to next
    if (room.submittedCount >= room.players.length) {
      if (room.round < room.totalRounds) {
        room.round += 1;
        room.currentSentence = pickSentence();
        room.submittedCount = 0;
        io.to(roomId).emit('nextRound', { sentence: room.currentSentence, round: room.round, total: room.totalRounds });
        console.log(`readyForNextRound -> nextRound ${roomId} ${room.round}`);
      } else {
        io.to(roomId).emit('gameOver', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
        console.log(`readyForNextRound -> gameOver ${roomId}`);
      }
    } else {
      // still waiting for others; broadcast current submittedCount optionally
      safeEmitRoomUpdate(roomId);
    }
  });

  socket.on('endGame', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('gameOver', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
    console.log(`endGame emitted for ${roomId}`);
  });

  socket.on('disconnect', () => {
    // remove player from any room they were in
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      if (!room) return;
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        console.log(`player left ${room.players[idx].name} from ${roomId}`);
        room.players.splice(idx, 1);
        // if host left, clear hostId so next joiner can become host or previous host reconnects
        if (room.hostId === socket.id) room.hostId = null;
        // if room empty, cleanup
        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`room ${roomId} deleted`);
        } else {
          safeEmitRoomUpdate(roomId);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
