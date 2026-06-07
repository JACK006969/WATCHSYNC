// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store room states in memory (use Redis for production)
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create_room', () => {
        const roomId = Math.random().toString(36).substring(2, 8);
        rooms[roomId] = { 
            hostId: socket.id, 
            isPlaying: false, 
            currentTime: 0,
            sourceType: 'torrent', // 'torrent' or 'youtube'
            sourceId: '' 
        };
        socket.join(roomId);
        socket.emit('room_created', { roomId, isHost: true });
        console.log(`Room ${roomId} created by ${socket.id}`);
    });

    socket.on('join_room', (roomId) => {
        if (rooms[roomId]) {
            socket.join(roomId);
            const room = rooms[roomId];
            // Send current state to the new user
            socket.emit('room_joined', { 
                roomId, 
                isHost: false, 
                state: { 
                    isPlaying: room.isPlaying, 
                    currentTime: room.currentTime,
                    sourceType: room.sourceType,
                    sourceId: room.sourceId
                } 
            });
            console.log(`User ${socket.id} joined room ${roomId}`);
        } else {
            socket.emit('error', 'Room does not exist.');
        }
    });

    // Host sends a new video source
    socket.on('change_source', (data) => {
        const room = getRoomBySocket(socket.id);
        if (room && room.hostId === socket.id) {
            room.sourceType = data.type;
            room.sourceId = data.id;
            io.to(data.roomId).emit('source_changed', data);
        }
    });

    // Host controls (Play, Pause, Seek)
    socket.on('host_action', (data) => {
        const room = getRoomBySocket(socket.id);
        if (room && room.hostId === socket.id) {
            room.isPlaying = data.action === 'play';
            room.currentTime = data.time;
            // Broadcast to everyone in the room EXCEPT the host (they already did it)
            socket.to(data.roomId).emit('sync_action', data);
        }
    });

    // Heartbeat: Host sends current time every 3 seconds to catch drift
    socket.on('heartbeat', (data) => {
        const room = getRoomBySocket(socket.id);
        if (room && room.hostId === socket.id) {
            room.currentTime = data.time;
            // Only correct guests who are off by more than 2 seconds
            socket.to(data.roomId).emit('heartbeat_sync', { time: data.time });
        }
    });

    socket.on('disconnect', () => {
        // Simple cleanup: if host leaves, room is effectively dead
        for (const roomId in rooms) {
            if (rooms[roomId].hostId === socket.id) {
                io.to(roomId).emit('host_disconnected');
                delete rooms[roomId];
                break;
            }
        }
    });
});

function getRoomBySocket(socketId) {
    for (const roomId in rooms) {
        if (rooms[roomId].hostId === socketId) return rooms[roomId];
    }
    return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));