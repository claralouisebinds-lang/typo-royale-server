const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ✅ Friendly root route
app.get('/', (req, res) => {
  res.send('Typo Royale backend is running!');
});

const rooms = {};
const sentences = [
  "The quick brown fox jumps over the lazy dog.",
  "Typing fast is a skill worth mastering.",
  "JavaScript powers interactive web experiences.",
  "Socket.IO enables real-time communication.",
  "Frontend and backend must work together."
];

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('createRoom', (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], round: 0, totalRounds: 1 };
    }
  });

  socket.on('joinRoom', (roomId, name) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = { players: [], round: 0, totalRounds: 1 };
    rooms[roomId].players.push({ id: socket.id, name, score: 0 });
    io.to(roomId).emit('roomUpdate', rooms[roomId].players);
  });

  socket.on('startGame', (roomId, totalRounds) => {
    const room = rooms[roomId];
    if (!room) return;
    room.round = 1;
    room.totalRounds = totalRounds;
    const sentence = sentences[Math.floor(Math.random() * sentences.length)];
    io.to(roomId).emit('gameStarted', {
      sentence,
      round: room.round,
      total: room.totalRounds
    });
  });

  socket.on('submitScore', ({ roomId, score }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.score += score;

    io.to(roomId).emit('scoreUpdate', room.players);

    if (room.round < room.totalRounds) {
      room.round += 1;
      const sentence = sentences[Math.floor(Math.random() * sentences.length)];
      io.to(roomId).emit('nextRound', {
        sentence,
        round: room.round,
        total: room.totalRounds
      });
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomId).emit('roomUpdate', room.players);
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
