// public/client.js

// CONNECT DIRECTLY TO YOUR RENDER BACKEND
const socket = io('https://watchsync-4ga1.onrender.com');

let isHost = false;
let roomId = '';
let client = null;
let currentTorrentFile = null;
let ytPlayer = null;
let heartbeatInterval = null;

// Check for shareable link on load
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
    document.getElementById('join-room-id').value = roomFromUrl;
    joinRoom();
}

socket.on('connect', () => {
    console.log('Connected to server!');
});

socket.on('room_created', (data) => {
    setupWatchScreen(data.roomId, true);
});

socket.on('room_joined', (data) => {
    setupWatchScreen(data.roomId, false);
    if (data.state.sourceId) {
        applySource(data.state.sourceType, data.state.sourceId);
        if (data.state.isPlaying) {
            syncPlay(data.state.currentTime);
        }
    }
});

socket.on('source_changed', (data) => {
    applySource(data.type, data.id);
});

socket.on('sync_action', (data) => {
    if (data.action === 'play') syncPlay(data.time);
    else if (data.action === 'pause') syncPause(data.time);
});

socket.on('heartbeat_sync', (data) => {
    if (!isHost) {
        const currentTime = getCurrentTime();
        if (currentTime && Math.abs(currentTime - data.time) > 2) {
            seekTo(data.time);
        }
    }
});

socket.on('host_disconnected', () => {
    alert('The host has disconnected. The room is closed.');
    location.reload();
});

function createRoom() {
    socket.emit('create_room');
}

function joinRoom() {
    const id = document.getElementById('join-room-id').value.trim();
    if (id) socket.emit('join_room', id);
    else alert('Please enter a Room ID');
}

function setupWatchScreen(id, host) {
    roomId = id;
    isHost = host;
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('watch-screen').classList.remove('hidden');
    document.getElementById('display-room-id').innerText = roomId;
    
    if (isHost) {
        document.getElementById('host-badge').classList.remove('hidden');
        document.getElementById('btn-play').disabled = false;
        document.getElementById('btn-pause').disabled = false;
        document.getElementById('status-text').innerText = "You are the host. Load a video and control playback.";
        
        // GENERATE SHAREABLE LINK USING YOUR RENDER URL
        const shareUrl = `https://watchsync-4ga1.onrender.com/?room=${roomId}`;
        document.getElementById('share-link').classList.remove('hidden');
        document.getElementById('link-text').innerText = shareUrl;
        
        // Start heartbeat
        heartbeatInterval = setInterval(() => {
            const time = getCurrentTime();
            if (time !== null) socket.emit('heartbeat', { roomId, time });
        }, 3000);
    } else {
        document.getElementById('source-inputs').classList.add('hidden');
        document.getElementById('status-text').innerText = "You are a guest. Waiting for host to control playback.";
    }
}

function loadSource() {
    if (!isHost) return;
    const type = document.getElementById('source-type').value;
    const id = document.getElementById('source-id').value.trim();
    
    if(!id) {
        alert("Please enter a Magnet link or YouTube ID");
        return;
    }

    socket.emit('change_source', { roomId, type, id });
    applySource(type, id);
}

function applySource(type, id) {
    const container = document.getElementById('video-container');
    container.innerHTML = ''; // Clear previous
    currentTorrentFile = null;
    ytPlayer = null;
    
    if (type === 'youtube') {
        loadYouTube(id, container);
    } else {
        loadTorrent(id, container);
    }
}

function loadTorrent(magnetURI, container) {
    if (!client) client = new WebTorrent();
    document.getElementById('status-text').innerText = "Fetching torrent metadata... (This may take a moment)";
    
    client.add(magnetURI, (torrent) => {
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.webm') || f.name.endsWith('.mkv'));
        if (file) {
            currentTorrentFile = file;
            file.renderTo(container, { autoplay: false });
            document.getElementById('status-text').innerText = "Video loaded. Host can now press Play.";
        } else {
            document.getElementById('status-text').innerText = "No playable video file (.mp4/.mkv) found in this torrent.";
        }
    });
}

function loadYouTube(videoId, container) {
    // If API is already loaded, just create player
    if (window.YT && window.YT.Player) {
        createYTPlayer(videoId, container);
        return;
    }

    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = function() {
        createYTPlayer(videoId, container);
    };
}

function createYTPlayer(videoId, container) {
    ytPlayer = new YT.Player(container, {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: { 'playsinline': 1, 'controls': isHost ? 1 : 0 },
        events: {
            'onReady': () => { 
                document.getElementById('status-text').innerText = "YouTube loaded. Host can press Play."; 
            }
        }
    });
}

// --- Host Control Functions ---
function sendAction(action) {
    if (!isHost) return;
    const time = getCurrentTime();
    socket.emit('host_action', { roomId, action, time });
    
    if (action === 'play') syncPlay(time);
    else if (action === 'pause') syncPause(time);
}

function syncPlay(time) {
    if (currentTorrentFile) {
        const video = document.querySelector('#video-container video');
        if (video) { video.currentTime = time; video.play(); }
    } else if (ytPlayer && ytPlayer.playVideo) {
        ytPlayer.seekTo(time, true);
        ytPlayer.playVideo();
    }
    document.getElementById('status-text').innerText = "Playing...";
}

function syncPause(time) {
    if (currentTorrentFile) {
        const video = document.querySelector('#video-container video');
        if (video) { video.currentTime = time; video.pause(); }
    } else if (ytPlayer && ytPlayer.pauseVideo) {
        ytPlayer.seekTo(time, true);
        ytPlayer.pauseVideo();
    }
    document.getElementById('status-text').innerText = "Paused.";
}

function seekTo(time) {
    if (currentTorrentFile) {
        const video = document.querySelector('#video-container video');
        if (video) video.currentTime = time;
    } else if (ytPlayer && ytPlayer.seekTo) {
        ytPlayer.seekTo(time, true);
    }
}

function getCurrentTime() {
    if (currentTorrentFile) {
        const video = document.querySelector('#video-container video');
        return video ? video.currentTime : null;
    } else if (ytPlayer && ytPlayer.getCurrentTime) {
        return ytPlayer.getCurrentTime();
    }
    return null;
}