// server.js — WatchSync Pro Backend
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for all routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};
const usernames = {}; // socketId -> username

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('[+] Connected:', socket.id);

  // ── ROOM MANAGEMENT ──────────────────────────────────────────
  socket.on('create_room', ({ username }) => {
    const roomId = generateRoomId();
    usernames[socket.id] = username || 'Host';
    rooms[roomId] = {
      hostId: socket.id,
      hostName: username || 'Host',
      isPlaying: false,
      currentTime: 0,
      sourceType: 'youtube',
      sourceId: '',
      members: [{ id: socket.id, name: username || 'Host', isHost: true }],
      messages: []
    };
    socket.join(roomId);
    socket.emit('room_created', { roomId, isHost: true, username: username || 'Host' });
    console.log(`[ROOM] Created: ${roomId} by ${username}`);
  });

  socket.on('join_room', ({ roomId, username }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('room_error', { message: 'Room not found. Check the Room ID.' });
      return;
    }
    usernames[socket.id] = username || 'Guest';
    room.members.push({ id: socket.id, name: username || 'Guest', isHost: false });
    socket.join(roomId);

    socket.emit('room_joined', {
      roomId,
      isHost: false,
      username: username || 'Guest',
      hostName: room.hostName,
      state: {
        sourceType: room.sourceType,
        sourceId: room.sourceId,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime
      }
    });

    // Notify others
    io.to(roomId).emit('user_joined', {
      username: username || 'Guest',
      memberCount: room.members.length
    });

    // Broadcast updated member list
    io.to(roomId).emit('members_update', {
      members: room.members.map(m => ({ name: m.name, isHost: m.isHost })),
      count: room.members.length
    });

    console.log(`[ROOM] ${username} joined ${roomId}`);
  });

  // ── SOURCE CONTROL (Host only) ────────────────────────────────
  socket.on('change_source', (data) => {
    const room = rooms[data.roomId];
    if (!room || room.hostId !== socket.id) return;
    room.sourceType = data.type;
    room.sourceId = data.id;
    room.isPlaying = false;
    room.currentTime = 0;
    io.to(data.roomId).emit('source_changed', { type: data.type, id: data.id });
  });

  // ── PLAYBACK CONTROL (Host only) ─────────────────────────────
  socket.on('host_action', (data) => {
    const room = rooms[data.roomId];
    if (!room || room.hostId !== socket.id) return;

    if (data.action === 'play') room.isPlaying = true;
    else if (data.action === 'pause') room.isPlaying = false;
    room.currentTime = data.time || 0;

    // Broadcast to all INCLUDING host (for UI consistency)
    io.to(data.roomId).emit('sync_action', {
      action: data.action,
      time: data.time || 0
    });
  });

  // ── HEARTBEAT (Drift correction) ─────────────────────────────
  socket.on('heartbeat', (data) => {
    const room = rooms[data.roomId];
    if (!room || room.hostId !== socket.id) return;
    room.currentTime = data.time;
    room.isPlaying = data.isPlaying;

    // Send to guests only (not back to host)
    socket.to(data.roomId).emit('heartbeat_sync', {
      time: data.time,
      isPlaying: data.isPlaying
    });
  });

  // ── CHAT ─────────────────────────────────────────────────────
  socket.on('send_message', (data) => {
    const room = rooms[data.roomId];
    if (!room) return;

    const username = usernames[socket.id] || 'Unknown';
    const isHost = room.hostId === socket.id;
    const message = {
      username,
      text: data.text,
      isHost,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      id: Date.now()
    };

    room.messages.push(message);
    // Keep only last 100 messages
    if (room.messages.length > 100) room.messages.shift();

    io.to(data.roomId).emit('receive_message', message);
  });

  // ── DISCONNECT ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('[-] Disconnected:', socket.id);
    delete usernames[socket.id];

    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.hostId === socket.id) {
        // Host left — notify and destroy room
        io.to(roomId).emit('host_disconnected');
        delete rooms[roomId];
        console.log(`[ROOM] Destroyed: ${roomId} (host left)`);
        break;
      }

      // Remove guest from member list
      const idx = room.members.findIndex(m => m.id === socket.id);
      if (idx !== -1) {
        const name = room.members[idx].name;
        room.members.splice(idx, 1);
        io.to(roomId).emit('user_left', { username: name, memberCount: room.members.length });
        io.to(roomId).emit('members_update', {
          members: room.members.map(m => ({ name: m.name, isHost: m.isHost })),
          count: room.members.length
        });
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎬 WatchSync running on http://localhost:${PORT}\n`);
});
SERVEREOF
echo "server.js written"
