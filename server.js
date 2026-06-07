// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create_room', () => {
        const roomId = Math.random().toString(36).substring(2, 8);
        rooms[roomId] = { hostId: socket.id, isPlaying: false, currentTime: 0, sourceType: '', sourceId: '' };
        socket.join(roomId);
        socket.emit('room_created', { roomId, isHost: true });
    });

    socket.on('join_room', (roomId) => {
        if (rooms[roomId]) {
            socket.join(roomId);
            socket.emit('room_joined', { roomId, isHost: false, state: rooms[roomId] });
        }
    });

    socket.on('change_source', (data) => {
        if (rooms[data.roomId] && rooms[data.roomId].hostId === socket.id) {
            rooms[data.roomId].sourceType = data.type;
            rooms[data.roomId].sourceId = data.id;
            rooms[data.roomId].isPlaying = false; // Reset play state on new video
            io.to(data.roomId).emit('source_changed', data);
        }
    });

    // Host controls
    socket.on('host_action', (data) => {
        if (rooms[data.roomId] && rooms[data.roomId].hostId === socket.id) {
            rooms[data.roomId].isPlaying = data.action === 'play';
            rooms[data.roomId].currentTime = data.time;
            io.to(data.roomId).emit('sync_action', data);
        }
    });

    // Heartbeat for drift correction
    socket.on('heartbeat', (data) => {
        if (rooms[data.roomId] && rooms[data.roomId].hostId === socket.id) {
            rooms[data.roomId].currentTime = data.time;
            io.to(data.roomId).emit('heartbeat_sync', { time: data.time, isPlaying: rooms[data.roomId].isPlaying });
        }
    });

    // --- NEW: CHAT FEATURE ---
    socket.on('send_message', (data) => {
        if (rooms[data.roomId]) {
            // Broadcast to everyone in the room
            io.to(data.roomId).emit('receive_message', {
                user: data.isHost ? 'Host' : 'Guest',
                text: data.text,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId].hostId === socket.id) {
                io.to(roomId).emit('host_disconnected');
                delete rooms[roomId];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
