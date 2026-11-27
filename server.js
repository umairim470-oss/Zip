const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Connected users track karne ke liye
const users = {};

io.on('connection', (socket) => {
    // Jab user apna naam register kare
    socket.on('register', (username) => {
        users[socket.id] = { id: socket.id, name: username };
        io.emit('user list', Object.values(users));
    });

    // Private 1-to-1 message bhejne ke liye
    socket.on('private message', ({ to, text, time }) => {
        const sender = users[socket.id];
        if (sender && users[to]) {
            io.to(to).emit('private message', {
                from: socket.id,
                senderName: sender.name,
                text: text,
                time: time
            });
        }
    });

    // User disconnect hone par list update karein
    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('user list', Object.values(users));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
