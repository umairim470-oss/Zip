const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 25 * 1024 * 1024
});

app.use(express.static(path.join(__dirname, 'public')));

const users = {};          // userId -> { id, name, gender, online, socketId }
const connections = {};    // userId -> Set of friend userIds
const pendingMessages = {}; // receiverId -> Array of unread/offline messages

io.on('connection', (socket) => {
    socket.on('register', ({ userId, name, gender, inviteFrom }) => {
        if (!userId || !name || name.trim().length < 5 || !gender) return;

        socket.userId = userId;
        users[userId] = {
            id: userId,
            name: name.trim(),
            gender: gender,
            online: true,
            socketId: socket.id
        };

        if (!connections[userId]) connections[userId] = new Set();

        // Invite link se judne par dono ko ek-doosre ki list mein add karein
        if (inviteFrom && inviteFrom !== userId && users[inviteFrom]) {
            connections[userId].add(inviteFrom);
            connections[inviteFrom].add(userId);
            sendContactList(inviteFrom);
        }

        sendContactList(userId);
        notifyContacts(userId);

        // Agar offline rehne par koi message aaya tha toh turant deliver karein
        if (pendingMessages[userId] && pendingMessages[userId].length > 0) {
            pendingMessages[userId].forEach(msg => {
                socket.emit('private message', msg);
            });
            pendingMessages[userId] = [];
        }
    });

    function getContactsFor(uid) {
        const list = [];
        if (connections[uid]) {
            connections[uid].forEach(friendId => {
                if (users[friendId]) {
                    list.push({
                        id: users[friendId].id,
                        name: users[friendId].name,
                        gender: users[friendId].gender,
                        online: users[friendId].online
                    });
                }
            });
        }
        return list;
    }

    function sendContactList(uid) {
        const u = users[uid];
        if (u && u.online && u.socketId) {
            io.to(u.socketId).emit('contact list', getContactsFor(uid));
        }
    }

    function notifyContacts(uid) {
        if (connections[uid]) {
            connections[uid].forEach(friendId => sendContactList(friendId));
        }
    }

    // Message bhejna + Automatically dono ko ek-doosre ki list mein add karna
    socket.on('private message', ({ toUserId, msgId, text, mediaData, mediaType, time }) => {
        const sender = users[socket.userId];
        if (!sender || !toUserId) return;

        if (!connections[sender.id]) connections[sender.id] = new Set();
        if (!connections[toUserId]) connections[toUserId] = new Set();

        // Agar pehle se list mein nahi the toh ab dono ki list mein add kar dein
        const isNewForReceiver = !connections[toUserId].has(sender.id);
        connections[sender.id].add(toUserId);
        connections[toUserId].add(sender.id);

        if (isNewForReceiver) {
            sendContactList(toUserId);
            sendContactList(sender.id);
        }

        const payload = {
            msgId,
            fromUserId: sender.id,
            toUserId,
            senderName: sender.name,
            senderGender: sender.gender,
            text: text || "",
            mediaData: mediaData || null,
            mediaType: mediaType || null,
            time
        };

        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('private message', payload);
        } else {
            if (!pendingMessages[toUserId]) pendingMessages[toUserId] = [];
            pendingMessages[toUserId].push(payload);
        }

        socket.emit('private message', payload);
    });

    socket.on('message seen', ({ toUserId, msgId }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('message seen', { fromUserId: socket.userId, msgId });
        }
    });

    // Voice & Video Call Signaling
    socket.on('call-user', ({ toUserId, offer, callType }) => {
        const sender = users[socket.userId];
        const receiver = users[toUserId];
        if (sender && receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('incoming-call', {
                fromUserId: sender.id,
                callerName: sender.name,
                offer,
                callType
            });
        }
    });

    socket.on('answer-call', ({ toUserId, answer }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('call-answered', { answer });
        }
    });

    socket.on('ice-candidate', ({ toUserId, candidate }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('ice-candidate', { candidate });
        }
    });

    socket.on('end-call', ({ toUserId }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('call-ended');
        }
    });

    socket.on('disconnect', () => {
        const uid = socket.userId;
        if (uid && users[uid]) {
            users[uid].online = false;
            notifyContacts(uid);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
