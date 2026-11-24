const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Photo aur video bhejne ke liye 25MB limit set ki gayi hai
const io = new Server(server, {
    maxHttpBufferSize: 25 * 1024 * 1024
});

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

    // Text, Photo ya Video message bhejne ke liye
    socket.on('room message', ({ msgId, text, mediaData, mediaType, time }) => {
        if (socket.roomId && socket.username) {
            io.to(socket.roomId).emit('room message', {
                msgId: msgId,
                senderId: socket.id,
                senderName: socket.username,
                senderGender: socket.gender,
                text: text || "",
                mediaData: mediaData || null,
                mediaType: mediaType || null,
                time: time
            });
        }
    });

    // Seen receipt
    socket.on('message seen', ({ msgId }) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('message seen', { msgId });
        }
    });

    // Voice / Video Call Signaling (WebRTC)
    socket.on('call-user', ({ offer, callType }) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('incoming-call', {
                offer: offer,
                callType: callType,
                callerName: socket.username
            });
        }
    });

    socket.on('answer-call', ({ answer }) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('call-answered', { answer });
        }
    });

    socket.on('ice-candidate', ({ candidate }) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('ice-candidate', { candidate });
        }
    });

    socket.on('end-call', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('call-ended');
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
                io.to(roomId).emit('call-ended');
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
