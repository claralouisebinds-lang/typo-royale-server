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

const rooms = {};

function pickSentence() {
  return sentences[Math.floor(Math.random() * sentences.length)];
}

function emitRoomUpdate(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('roomUpdate', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
}

function emitScoreUpdate(roomId) {
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
    } else {
      rooms[roomId].hostId = socket.id;
    }
  });

  socket.on('joinRoom', (roomId, name) => {
    if (!roomId || !name) return;
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = { players: [], hostId: null, round: 0, totalRounds: 0, currentSentence: '', submittedCount: 0 };
    const room = rooms[roomId];
    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: name || socket.id, score: 0 });
    }
    emitRoomUpdate(roomId);
    console.log(`${name} joined ${roomId}`);
  });

  socket.on('startGame', (roomId, totalRounds) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostId && room.hostId !== socket.id) return;
    room.totalRounds = Math.max(1, parseInt(totalRounds, 10) || 1);
    room.round = 1;
    room.players.forEach(p => p.score = 0);
    room.submittedCount = 0;
    room.currentSentence = pickSentence();
    io.to(roomId).emit('gameStarted', { sentence: room.currentSentence, round: room.round, total: room.totalRounds });
    emitScoreUpdate(roomId);
  });

  socket.on('submitScore', ({ roomId, score }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.score = (player.score || 0) + (Number.isFinite(score) ? score : 0);
    room.submittedCount = (room.submittedCount || 0) + 1;
    emitScoreUpdate(roomId);
    console.log(`score submitted ${roomId} ${player.name} +${score} (round ${room.round})`);
    if (room.submittedCount >= room.players.length) {
      setTimeout(() => {
        if (!rooms[roomId]) return;
        if (room.round < room.totalRounds) {
          room.round += 1;
          room.currentSentence = pickSentence();
          room.submittedCount = 0;
          io.to(roomId).emit('nextRound', { sentence: room.currentSentence, round: room.round, total: room.totalRounds });
        } else {
          io.to(roomId).emit('gameOver', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
        }
      }, 3000);
    }
  });

  socket.on('readyForNextRound', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    room.submittedCount = (room.submittedCount || 0) + 1;
    if (room.submittedCount >= room.players.length) {
      if (room.round < room.totalRounds) {
        room.round += 1;
        room.currentSentence = pickSentence();
        room.submittedCount = 0;
        io.to(roomId).emit('nextRound', { sentence: room.currentSentence, round: room.round, total: room.totalRounds });
      } else {
        io.to(roomId).emit('gameOver', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
      }
    } else {
      emitRoomUpdate(roomId);
    }
  });

  socket.on('endGame', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('gameOver', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
  });

  socket.on('disconnect', () => {
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      if (!room) return;
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.hostId === socket.id) room.hostId = null;
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          emitRoomUpdate(roomId);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
