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
const pendingMessages = {};

// Smart Built-in AI Reply Generator
async function getAIReply(userText, userName) {
    const q = (userText || "").toLowerCase().trim();

    // Agar Render Environment mein GEMINI_API_KEY set hai toh real Gemini AI use karega
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

    // Built-in Fast Smart Replies (Bina API key ke)
    if (/^(hi|hello|hey|hlo|namaste|salam|assalam)/.test(q)) {
        return `Hello ${userName}! Main Zip AI hoon ⚡ Bataiye aaj main aapki kya madad kar sakta hoon?`;
    }
    if (q.includes('kaise ho') || q.includes('kya haal') || q.includes('how are you')) {
        return `Main bilkul badhiya hoon ${userName}! Aap sunaiye, sab kaisa chal raha hai?`;
    }
    if (q.includes('time') || q.includes('samay') || q.includes('baje')) {
        return `Abhi ka samay hai: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}`;
    }
    if (q.includes('date') || q.includes('tarikh') || q.includes('aaj kya din')) {
        return `Aaj ki tarikh hai: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
    }
    if (q.includes('shayari') || q.includes('sher')) {
        return `✨ "Waqt se ladkar jo naseeb badal de, Insaan wahi jo apni taqdeer badal de, Kal kya hoga kabhi mat socho, Kya pata kal waqt khud apni tasveer badal de!"`;
    }
    if (q.includes('joke') || q.includes('chutkula')) {
        return `😂 Teacher: "Batao chand par pehla kadam kisne rakha?"\nStudent: "Neil Armstrong ne!"\nTeacher: "Aur doosra?"\nStudent: "Doosra bhi usi ne rakha hoga, langdi thodi khel raha tha!"`;
    }
    if (q.includes('naam') || q.includes('who are you') || q.includes('kaun ho')) {
        return `Main **Zip AI** hoon — aapka personal smart assistant! Aap mujhse kuch bhi pooch sakte hain.`;
    }
    return `Main aapki baat samajh gaya hoon ("${userText}"). Aap mujhse time, date, shayari, joke ya koi bhi sawal pooch sakte hain!`;
}

io.on('connection', (socket) => {
    socket.on('register', ({ userId, name, gender }) => {
        if (!userId || !name || name.trim().length < 5 || !gender) return;

        socket.userId = userId;
        users[userId] = {
            id: userId,
            name: name.trim(),
            gender: gender,
            online: true,
            socketId: socket.id
        };

        broadcastAllUsers();

        if (pendingMessages[userId] && pendingMessages[userId].length > 0) {
            pendingMessages[userId].forEach(msg => {
                socket.emit('private message', msg);
            });
            pendingMessages[userId] = [];
        }
    });

    function broadcastAllUsers() {
        const allList = Object.values(users).map(u => ({
            id: u.id,
            name: u.name,
            gender: u.gender,
            online: u.online
        }));

        Object.values(users).forEach(u => {
            if (u.online && u.socketId) {
                const others = allList.filter(item => item.id !== u.id);
                io.to(u.socketId).emit('contact list', others);
            }
        });
    }

    socket.on('private message', async ({ toUserId, msgId, text, mediaData, mediaType, time }) => {
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
            time
        };

        // Sender ko message confirm karein
        socket.emit('private message', payload);

        // Agar message Zip AI ko bheja gaya hai
        if (toUserId === 'zip_ai_bot') {
            setTimeout(() => {
                socket.emit('message seen', { fromUserId: 'zip_ai_bot', msgId });
            }, 400);

            const aiReplyText = await getAIReply(text || "Media bheja gaya", sender.name);
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
            }, 700);
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

    socket.on('message seen', ({ toUserId, msgId }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('message seen', { fromUserId: socket.userId, msgId });
        }
    });

    // Voice & Video Call Signaling + Hold Status
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

    socket.on('call-hold', ({ toUserId, isHold }) => {
        const receiver = users[toUserId];
        if (receiver && receiver.online && receiver.socketId) {
            io.to(receiver.socketId).emit('call-hold', { isHold });
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
            broadcastAllUsers();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
