const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
  }
});

let rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('createRoom', (roomId) => {
    rooms[roomId] = { players: [], sentence: '', started: false };
    socket.join(roomId);
    rooms[roomId].players.push({ id: socket.id, score: 0 });
    io.to(roomId).emit('roomUpdate', rooms[roomId].players);
  });

  socket.on('joinRoom', (roomId) => {
    if (rooms[roomId] && !rooms[roomId].started) {
      socket.join(roomId);
      rooms[roomId].players.push({ id: socket.id, score: 0 });
      io.to(roomId).emit('roomUpdate', rooms[roomId].players);
    }
  });

  socket.on('startGame', (roomId, sentence) => {
    if (rooms[roomId]) {
      rooms[roomId].sentence = sentence;
      rooms[roomId].started = true;
      io.to(roomId).emit('gameStarted', sentence);
    }
  });

  socket.on('submitScore', ({ roomId, score }) => {
    const player = rooms[roomId]?.players.find(p => p.id === socket.id);
    if (player) player.score = score;
    io.to(roomId).emit('scoreUpdate', rooms[roomId].players);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
      io.to(roomId).emit('roomUpdate', rooms[roomId].players);
    }
  });
});

server.listen(3000, () => console.log('Server running on port 3000'));
