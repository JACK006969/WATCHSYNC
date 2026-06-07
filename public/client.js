// public/client.js
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

socket.on('connect', () => console.log('Connected to server!'));
socket.on('room_created', (data) => setupWatchScreen(data.roomId, true));
socket.on('room_joined', (data) => {
    setupWatchScreen(data.roomId, false);
    if (data.state.sourceId) {
        applySource(data.state.sourceType, data.state.sourceId);
        if (data.state.isPlaying) syncPlay(data.state.currentTime);
    }
});
socket.on('source_changed', (data) => applySource(data.type, data.id));
socket.on('sync_action', (data) => {
    if (data.action === 'play') syncPlay(data.time);
    else if (data.action === 'pause') syncPause(data.time);
});
socket.on('heartbeat_sync', (data) => {
    if (!isHost) {
        const currentTime = getCurrentTime();
        if (currentTime && Math.abs(currentTime - data.time) > 2) seekTo(data.time);
    }
});
socket.on('host_disconnected', () => {
    alert('The host has disconnected.');
    location.reload();
});

function createRoom() { socket.emit('create_room'); }
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
        document.getElementById('status-text').innerText = "You are the host. Load a video.";
        const shareUrl = `${window.location.origin}/?room=${roomId}`;
        document.getElementById('share-link').classList.remove('hidden');
        document.getElementById('link-text').innerText = shareUrl;
        heartbeatInterval = setInterval(() => {
            const time = getCurrentTime();
            if (time !== null) socket.emit('heartbeat', { roomId, time });
        }, 3000);
    } else {
        document.getElementById('source-inputs').classList.add('hidden');
        document.getElementById('status-text').innerText = "Waiting for host...";
    }
}

function loadSource() {
    if (!isHost) return;
    const type = document.getElementById('source-type').value;
    let id = document.getElementById('source-id').value.trim();
    
    if(!id) return alert("Please enter a link or ID");

    // FIX: Automatically extract YouTube ID if they paste a full URL
    if (type === 'youtube') {
        id = extractYouTubeId(id);
        if (!id) return alert("Invalid YouTube URL or ID");
    }

    socket.emit('change_source', { roomId, type, id });
    applySource(type, id);
}

function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : url;
}

function applySource(type, id) {
    const container = document.getElementById('video-container');
    container.innerHTML = ''; 
    currentTorrentFile = null;
    ytPlayer = null;
    
    if (type === 'youtube') loadYouTube(id, container);
    else loadTorrent(id, container);
}

function loadTorrent(magnetURI, container) {
    if (!client) client = new WebTorrent();
    document.getElementById('status-text').innerText = "Fetching torrent metadata... Please wait.";
    
    client.add(magnetURI, (torrent) => {
        // FIX: Only look for MP4 and WEBM. Browsers CANNOT play MKV natively.
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.webm'));
        
        if (file) {
            currentTorrentFile = file;
            file.renderTo(container, { autoplay: false, controls: isHost });
            document.getElementById('status-text').innerText = "Video loaded! Press Play.";
        } else {
            document.getElementById('status-text').innerText = "Error: No .mp4 or .webm file found in this torrent.";
            console.error("Files in torrent:", torrent.files.map(f => f.name));
        }
    });

    // Add error logging for torrents
    client.on('error', (err) => {
        console.error("WebTorrent Error:", err);
        document.getElementById('status-text').innerText = "Torrent Error: Check Console (F12)";
    });
}

function loadYouTube(videoId, container) {
    document.getElementById('status-text').innerText = "Loading YouTube...";
    
    // Load YouTube API if not already loaded
    if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    // Wait for API to be ready
    const checkAPI = setInterval(() => {
        if (window.YT && window.YT.Player) {
            clearInterval(checkAPI);
            createYTPlayer(videoId, container);
        }
    }, 500);
}

function createYTPlayer(videoId, container) {
    ytPlayer = new YT.Player(container, {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: { 'playsinline': 1, 'controls': isHost ? 1 : 0, 'rel': 0 },
        events: {
            'onReady': () => document.getElementById('status-text').innerText = "YouTube loaded! Press Play.",
            'onError': (e) => document.getElementById('status-text').innerText = "YouTube Error: Video might be restricted."
        }
    });
}

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
        if (video) { video.currentTime = time; video.play().catch(e => console.log("Autoplay blocked", e)); }
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
