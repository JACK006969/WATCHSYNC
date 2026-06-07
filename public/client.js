// public/client.js
const socket = io('https://watchsync-4ga1.onrender.com');

let isHost = false;
let roomId = '';
let client = null;
let currentTorrentFile = null;
let ytPlayer = null;
let heartbeatInterval = null;
let progressInterval = null;

// --- CHAT FUNCTIONS ---
function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text && roomId) {
        socket.emit('send_message', { roomId, text, isHost });
        input.value = '';
    }
}
function handleChatKey(e) { if (e.key === 'Enter') sendMessage(); }

socket.on('receive_message', (data) => {
    const chatBox = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${data.user.toLowerCase()}`;
    msgDiv.innerHTML = `<strong>${data.user}:</strong> ${data.text}<span class="msg-time">${data.time}</span>`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// --- SYNC & PLAYER FUNCTIONS ---
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('room')) {
    document.getElementById('join-room-id').value = urlParams.get('room');
    joinRoom();
}

socket.on('connect', () => console.log('Connected!'));
socket.on('room_created', (data) => setupWatchScreen(data.roomId, true));
socket.on('room_joined', (data) => {
    setupWatchScreen(data.roomId, false);
    if (data.state.sourceId) applySource(data.state.sourceType, data.state.sourceId, data.state);
});
socket.on('source_changed', (data) => applySource(data.type, data.id));

socket.on('sync_action', (data) => {
    if (data.action === 'play') executePlay(data.time);
    else if (data.action === 'pause') executePause(data.time);
});

socket.on('heartbeat_sync', (data) => {
    if (!isHost) {
        const currentTime = getCurrentTime();
        // Only correct if drift is significant (> 3 seconds) to prevent stuttering
        if (Math.abs(currentTime - data.time) > 3) {
            executeSeek(data.time);
            if (data.isPlaying) executePlay(data.time);
            else executePause(data.time);
        }
    }
});

socket.on('host_disconnected', () => { alert('Host disconnected.'); location.reload(); });

function createRoom() { socket.emit('create_room'); }
function joinRoom() {
    const id = document.getElementById('join-room-id').value.trim();
    if (id) socket.emit('join_room', id);
}

function setupWatchScreen(id, host) {
    roomId = id;
    isHost = host;
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('watch-screen').classList.remove('hidden');
    document.getElementById('display-room-id').innerText = roomId;
    
    if (isHost) {
        document.getElementById('host-badge').classList.remove('hidden');
        document.getElementById('custom-controls').classList.remove('hidden'); // Show custom controls
        document.getElementById('status-text').innerText = "You are the host. Load a video.";
        const shareUrl = `${window.location.origin}/?room=${roomId}`;
        document.getElementById('share-link').classList.remove('hidden');
        document.getElementById('link-text').innerText = shareUrl;
        
        heartbeatInterval = setInterval(() => {
            const time = getCurrentTime();
            if (time !== null) socket.emit('heartbeat', { roomId, time });
        }, 5000); // Heartbeat every 5 seconds
        
        progressInterval = setInterval(updateProgressUI, 1000);
    } else {
        document.getElementById('source-inputs').classList.add('hidden');
        document.getElementById('status-text').innerText = "Waiting for host...";
    }
}

function loadSource() {
    if (!isHost) return;
    const type = document.getElementById('source-type').value;
    let id = document.getElementById('source-id').value.trim();
    if(!id) return alert("Please enter a link");

    if (type === 'youtube') {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = id.match(regExp);
        id = (match && match[2].length === 11) ? match[2] : id;
    }

    socket.emit('change_source', { roomId, type, id });
    applySource(type, id);
}

function applySource(type, id, initialState = null) {
    const container = document.getElementById('video-container');
    container.innerHTML = ''; 
    currentTorrentFile = null;
    if (ytPlayer) { ytPlayer.destroy(); ytPlayer = null; }
    clearInterval(progressInterval);
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('time-display').innerText = '0:00 / 0:00';
    document.getElementById('btn-play-pause').innerText = '▶';

    if (type === 'youtube') {
        loadYouTube(id, container, initialState);
    } else {
        loadTorrent(id, container, initialState);
    }
}

function loadYouTube(videoId, container, initialState) {
    if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
    }
    const checkAPI = setInterval(() => {
        if (window.YT && window.YT.Player) {
            clearInterval(checkAPI);
            ytPlayer = new YT.Player(container, {
                videoId: videoId,
                playerVars: { 'playsinline': 1, 'controls': 0, 'disablekb': 1, 'rel': 0 }, // Hide default controls
                events: {
                    'onReady': () => {
                        document.getElementById('status-text').innerText = "YouTube loaded!";
                        if (initialState && initialState.isPlaying) executePlay(initialState.currentTime);
                    }
                }
            });
        }
    }, 200);
}

function loadTorrent(magnetURI, container, initialState) {
    if (!client) client = new WebTorrent();
    document.getElementById('status-text').innerText = "Fetching torrent metadata...";
    client.add(magnetURI, (torrent) => {
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.webm'));
        if (file) {
            currentTorrentFile = file;
            file.renderTo(container, { autoplay: false, controls: false }); // Hide default controls
            document.getElementById('status-text').innerText = "Torrent loaded!";
            if (initialState && initialState.isPlaying) executePlay(initialState.currentTime);
        } else {
            document.getElementById('status-text').innerText = "Error: No .mp4/.webm found.";
        }
    });
}

// --- CUSTOM CONTROLS & SYNC EXECUTION ---
function togglePlay() {
    if (!isHost) return;
    const time = getCurrentTime();
    const isPlaying = getIsPlaying();
    const action = isPlaying ? 'pause' : 'play';
    socket.emit('host_action', { roomId, action, time });
    if (action === 'play') executePlay(time);
    else executePause(time);
}

function seekVideo(e) {
    if (!isHost) return;
    const bar = document.getElementById('progress-bar');
    const percent = e.offsetX / bar.offsetWidth;
    const duration = getDuration();
    const newTime = percent * duration;
    
    socket.emit('host_action', { roomId, action: 'seek', time: newTime });
    executeSeek(newTime);
    if (getIsPlaying()) executePlay(newTime);
}

function executePlay(time) {
    document.getElementById('btn-play-pause').innerText = '⏸';
    if (ytPlayer) { ytPlayer.seekTo(time, true); setTimeout(() => ytPlayer.playVideo(), 300); }
    else if (currentTorrentFile) { const v = document.querySelector('video'); if(v) { v.currentTime = time; v.play(); } }
}

function executePause(time) {
    document.getElementById('btn-play-pause').innerText = '▶';
    if (ytPlayer) { ytPlayer.seekTo(time, true); ytPlayer.pauseVideo(); }
    else if (currentTorrentFile) { const v = document.querySelector('video'); if(v) { v.currentTime = time; v.pause(); } }
}

function executeSeek(time) {
    if (ytPlayer) ytPlayer.seekTo(time, true);
    else if (currentTorrentFile) { const v = document.querySelector('video'); if(v) v.currentTime = time; }
}

function getCurrentTime() {
    if (ytPlayer) return ytPlayer.getCurrentTime() || 0;
    if (currentTorrentFile) { const v = document.querySelector('video'); return v ? v.currentTime : 0; }
    return 0;
}

function getDuration() {
    if (ytPlayer) return ytPlayer.getDuration() || 0;
    if (currentTorrentFile) { const v = document.querySelector('video'); return v ? v.duration : 0; }
    return 0;
}

function getIsPlaying() {
    if (ytPlayer) return ytPlayer.getPlayerState() === 1;
    if (currentTorrentFile) { const v = document.querySelector('video'); return v ? !v.paused : false; }
    return false;
}

function updateProgressUI() {
    const time = getCurrentTime();
    const duration = getDuration();
    if (duration > 0) {
        document.getElementById('progress-fill').style.width = `${(time / duration) * 100}%`;
        document.getElementById('time-display').innerText = `${formatTime(time)} / ${formatTime(duration)}`;
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' :
