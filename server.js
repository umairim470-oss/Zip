const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Har secret room ke members track karne ke liye
const rooms = {};

io.on('connection', (socket) => {
    socket.on('join room', ({ roomId, username }) => {
        if (!roomId) return;

        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = username;

        if (!rooms[roomId]) rooms[roomId] = [];
        rooms[roomId].push({ id: socket.id, name: username });

        // Sirf isi room ke logon ko batayein ki kaun online hai
        io.to(roomId).emit('room users', rooms[roomId]);
    });

    // Sirf isi secret room mein message bhejna
    socket.on('room message', ({ text, time }) => {
        if (socket.roomId && socket.username) {
            io.to(socket.roomId).emit('room message', {
                senderId: socket.id,
                senderName: socket.username,
                text: text,
                time: time
            });
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(u => u.id !== socket.id);
            io.to(roomId).emit('room users', rooms[roomId]);
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
