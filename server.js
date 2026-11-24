const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join room', ({ roomId, username, gender }) => {
        if (!roomId || !username || username.trim().length < 5 || !gender) return;

        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = username.trim();
        socket.gender = gender;

        if (!rooms[roomId]) rooms[roomId] = [];
        rooms[roomId] = rooms[roomId].filter(u => u.id !== socket.id);
        rooms[roomId].push({ id: socket.id, name: socket.username, gender: socket.gender });

        io.to(roomId).emit('room users', rooms[roomId]);
        socket.to(roomId).emit('system status', `${socket.username} (${socket.gender}) is Online`);
    });

    socket.on('room message', ({ msgId, text, time }) => {
        if (socket.roomId && socket.username) {
            io.to(socket.roomId).emit('room message', {
                msgId: msgId,
                senderId: socket.id,
                senderName: socket.username,
                senderGender: socket.gender,
                text: text,
                time: time
            });
        }
    });

    socket.on('message seen', ({ msgId }) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('message seen', { msgId });
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        const leftUser = socket.username;
        const leftGender = socket.gender;
        if (roomId && rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(u => u.id !== socket.id);
            io.to(roomId).emit('room users', rooms[roomId]);
            if (leftUser) {
                io.to(roomId).emit('system status', `${leftUser} (${leftGender}) went Offline`);
            }
            if (rooms[roomId].length === 0) {
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
