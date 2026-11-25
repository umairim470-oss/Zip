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

const users = {};
const groups = {}; // groupId -> { id, name, members: [userIds] }
const pendingMessages = {};

async function getAIReply(userText, userName) {
    const q = (userText || "").toLowerCase().trim();
    if (process.env.GEMINI_API_KEY) {
        try {
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Reply naturally in friendly Hinglish/Hindi (short and helpful) to ${userName}: ${userText}` }] }]
                })
            });
            const json = await resp.json();
            const reply = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (reply) return reply;
        } catch (e) {}
    }

    if (/^(hi|hello|hey|hlo|namaste|salam|assalam)/.test(q)) return `Hello ${userName}! Main Zip AI hoon ⚡ Bataiye kya madad karun?`;
    if (q.includes('time') || q.includes('samay')) return `Abhi ka samay: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`;
    if (q.includes('date') || q.includes('tarikh')) return `Aaj ki tarikh: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })}`;
    if (q.includes('shayari')) return `✨ "Waqt se ladkar jo naseeb badal de, Insaan wahi jo apni taqdeer badal de!"`;
    if (q.includes('joke')) return `😂 Teacher: "Chand par pehla kadam kisne rakha?" Student: "Neil Armstrong ne!" Teacher: "Aur doosra?" Student: "Doosra bhi usi ne rakha hoga, langdi thodi khel raha tha!"`;
    return `Main aapki baat samajh gaya ("${userText}"). Aap mujhse time, date, shayari, joke ya koi bhi sawal pooch sakte hain!`;
}

io.on('connection', (socket) => {
    socket.on('register', ({ userId, name, gender }) => {
        if (!userId || !name || name.trim().length < 5 || !gender) return;
        socket.userId = userId;
        users[userId] = { id: userId, name: name.trim(), gender, online: true, socketId: socket.id };

        broadcastAllUsers();
        sendUserGroups(userId);

        if (pendingMessages[userId] && pendingMessages[userId].length > 0) {
            pendingMessages[userId].forEach(msg => socket.emit('private message', msg));
            pendingMessages[userId] = [];
        }
    });

    function broadcastAllUsers() {
        const allList = Object.values(users).map(u => ({ id: u.id, name: u.name, gender: u.gender, online: u.online }));
        Object.values(users).forEach(u => {
            if (u.online && u.socketId) {
                io.to(u.socketId).emit('contact list', allList.filter(item => item.id !== u.id));
            }
        });
    }

    function sendUserGroups(uid) {
        const u = users[uid];
        if (!u || !u.online || !u.socketId) return;
        const myGroups = Object.values(groups).filter(g => g.members.includes(uid));
        io.to(u.socketId).emit('group list', myGroups);
    }

    // Naya Group Banana
    socket.on('create group', ({ groupName, memberIds }) => {
        const creatorId = socket.userId;
        if (!creatorId || !groupName || !Array.isArray(memberIds)) return;

        const allMembers = Array.from(new Set([creatorId, ...memberIds]));
        const groupId = 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        groups[groupId] = {
            id: groupId,
            name: groupName.trim(),
            members: allMembers
        };

        allMembers.forEach(uid => sendUserGroups(uid));
    });

    // 1-to-1, AI, aur Group Messaging
    socket.on('private message', async ({ toUserId, msgId, text, mediaData, mediaType, time, isGroup }) => {
        const sender = users[socket.userId];
        if (!sender || !toUserId) return;

        const payload = {
            msgId,
            fromUserId: sender.id,
            toUserId,
            senderName: sender.name,
            senderGender: sender.gender,
            text: text || "",
            mediaData: mediaData || null,
            mediaType: mediaType || null,
            time,
            isGroup: !!isGroup
        };

        // Group Message
        if (isGroup && groups[toUserId]) {
            const grp = groups[toUserId];
            grp.members.forEach(memberId => {
                const mUser = users[memberId];
                if (mUser && mUser.online && mUser.socketId) {
                    io.to(mUser.socketId).emit('private message', payload);
                } else if (memberId !== sender.id) {
                    if (!pendingMessages[memberId]) pendingMessages[memberId] = [];
                    pendingMessages[memberId].push(payload);
                }
            });
            return;
        }

        socket.emit('private message', payload);

        if (toUserId === 'zip_ai_bot') {
            setTimeout(() => socket.emit('message seen', { fromUserId: 'zip_ai_bot', msgId }), 400);
            const aiReplyText = await getAIReply(text || "Media", sender.name);
            const replyTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setTimeout(() => {
                socket.emit('private message', {
                    msgId: 'ai_' + Date.now(),
                    fromUserId: 'zip_ai_bot',
                    toUserId: sender.id,
                    senderName: 'Zip AI',
                    senderGender: 'AI',
                    text: aiReplyText,
                    time: replyTime
                });
            }, 600);
            return;
        }

        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('private message', payload);
        } else {
            if (!pendingMessages[toUserId]) pendingMessages[toUserId] = [];
            pendingMessages[toUserId].push(payload);
        }
    });

    // Message Edit Karna
    socket.on('edit message', ({ toUserId, msgId, newText, isGroup }) => {
        const senderId = socket.userId;
        if (!senderId || !toUserId || !msgId || !newText) return;

        if (isGroup && groups[toUserId]) {
            groups[toUserId].members.forEach(mid => {
                const u = users[mid];
                if (u && u.online && u.socketId) {
                    io.to(u.socketId).emit('message edited', { chatId: toUserId, msgId, newText });
                }
            });
            return;
        }

        socket.emit('message edited', { chatId: toUserId, msgId, newText });
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('message edited', { chatId: senderId, msgId, newText });
        }
    });

    // Message Delete Karna
    socket.on('delete message', ({ toUserId, msgId, isGroup }) => {
        const senderId = socket.userId;
        if (!senderId || !toUserId || !msgId) return;

        if (isGroup && groups[toUserId]) {
            groups[toUserId].members.forEach(mid => {
                const u = users[mid];
                if (u && u.online && u.socketId) {
                    io.to(u.socketId).emit('message deleted', { chatId: toUserId, msgId });
                }
            });
            return;
        }

        socket.emit('message deleted', { chatId: toUserId, msgId });
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('message deleted', { chatId: senderId, msgId });
        }
    });

    socket.on('message seen', ({ toUserId, msgId }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('message seen', { fromUserId: socket.userId, msgId });
        }
    });

    // Voice & Video Call Signaling
    socket.on('call-user', ({ toUserId, offer, callType }) => {
        const sender = users[socket.userId], receiver = users[toUserId];
        if (sender && receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('incoming-call', { fromUserId: sender.id, callerName: sender.name, offer, callType });
        }
    });
    socket.on('answer-call', ({ toUserId, answer }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) io.to(receiver.socketId).emit('call-answered', { answer });
    });
    socket.on('ice-candidate', ({ toUserId, candidate }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) io.to(receiver.socketId).emit('ice-candidate', { candidate });
    });
    socket.on('call-hold', ({ toUserId, isHold }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) io.to(receiver.socketId).emit('call-hold', { isHold });
    });
    socket.on('end-call', ({ toUserId }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) io.to(receiver.socketId).emit('call-ended');
    });

    socket.on('disconnect', () => {
        const uid = socket.userId;
        if (uid && users[uid]) {
            users[uid].online = false;
            broadcastAllUsers();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
