// public/client.js
const socket = io('https://watchsync-4ga1.onrender.com');

let isHost = false;
let roomId = '';
let client = null;
let currentTorrentFile = null;
let ytPlayer = null; // This will be our new Custom Wrapper
let heartbeatInterval = null;

// --- CUSTOM YOUTUBE PLAYER WRAPPER ---
// This fixes the "refreshing" bug by queuing commands until the API is 100% ready.
class YTSyncPlayer {
    constructor(containerId, videoId, onReadyCallback) {
        this.container = document.getElementById(containerId);
        this.videoId = videoId;
        this.player = null;
        this.isReady = false;
        this.queue = [];
        this.onReadyCallback = onReadyCallback;
        this.loadAPI();
    }

    loadAPI() {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
        }
        
        const checkAPI = setInterval(() => {
            if (window.YT && window.YT.Player) {
                clearInterval(checkAPI);
                this.createPlayer();
            }
        }, 200);
    }

    createPlayer() {
        this.player = new YT.Player(this.container, {
            videoId: this.videoId,
            playerVars: { 
                'playsinline': 1, 
                'controls': isHost ? 1 : 0, 
                'disablekb': 1, // Disable keyboard
                'rel': 0,
                'modestbranding': 1
            },
            events: {
                'onReady': () => {
                    this.isReady = true;
                    document.getElementById('status-text').innerText = "Video loaded! Host can press Play.";
                    if (this.onReadyCallback) this.onReadyCallback();
                    this.processQueue();
                },
                'onError': () => document.getElementById('status-text').innerText = "YouTube Error: Video might be restricted."
            }
        });
    }

    // Queue system prevents the "refreshing/stuttering" bug
    enqueue(command) {
        if (this.isReady && this.player) {
            command();
        } else {
            this.queue.push(command);
        }
    }

    processQueue() {
        while (this.queue.length > 0) {
            const cmd = this.queue.shift();
            cmd();
        }
    }

    play(time) {
        this.enqueue(() => {
            this.player.seekTo(time, true);
            // Small delay to let the player buffer the new timestamp before playing
            setTimeout(() => this.player.playVideo(), 500); 
        });
    }

    pause(time) {
        this.enqueue(() => {
            this.player.seekTo(time, true);
            this.player.pauseVideo();
        });
    }

    seek(time) {
        this.enqueue(() => this.player.seekTo(time, true));
    }

    getTime() { return this.isReady ? this.player.getCurrentTime() : 0; }
    isPlaying() { return this.isReady ? this.player.getPlayerState() === 1 : false; }
    destroy() { if (this.player) this.player.destroy(); }
}
// -------------------------------------

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('room')) {
    document.getElementById('join-room-id').value = urlParams.get('room');
    joinRoom();
}

socket.on('connect', () => console.log('Connected!'));
socket.on('room_created', (data) => setupWatchScreen(data.roomId, true));
socket.on('room_joined', (data) => {
    setupWatchScreen(data.roomId, false);
    if (data.state.sourceId) {
        applySource(data.state.sourceType, data.state.sourceId, data.state);
    }
});
socket.on('source_changed', (data) => applySource(data.type, data.id));

socket.on('sync_action', (data) => {
    if (data.action === 'play') syncPlay(data.time);
    else if (data.action === 'pause') syncPause(data.time);
});

socket.on('heartbeat_sync', (data) => {
    if (!isHost && ytPlayer && ytPlayer.isReady) {
        const currentTime = ytPlayer.getTime();
        const currentIsPlaying = ytPlayer.isPlaying();

        // Force state if guest is out of sync
        if (data.isPlaying !== currentIsPlaying) {
            if (data.isPlaying) syncPlay(data.time);
            else syncPause(data.time);
        } 
        // Correct time drift if both are playing
        else if (data.isPlaying && Math.abs(currentTime - data.time) > 2) {
            ytPlayer.seek(data.time);
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
    
    // Show/Hide Guest Blocker
    const blocker = document.getElementById('guest-blocker');
    if (isHost) {
        blocker.classList.add('hidden');
        document.getElementById('host-badge').classList.remove('hidden');
        document.getElementById('btn-play').disabled = false;
        document.getElementById('btn-pause').disabled = false;
        document.getElementById('status-text').innerText = "You are the host. Load a video.";
        const shareUrl = `${window.location.origin}/?room=${roomId}`;
        document.getElementById('share-link').classList.remove('hidden');
        document.getElementById('link-text').innerText = shareUrl;
        
        heartbeatInterval = setInterval(() => {
            if (ytPlayer && ytPlayer.isReady) {
                socket.emit('heartbeat', { roomId, time: ytPlayer.getTime(), isPlaying: ytPlayer.isPlaying() });
            } else if (currentTorrentFile) {
                const video = document.querySelector('video');
                if(video) socket.emit('heartbeat', { roomId, time: video.currentTime, isPlaying: !video.paused });
            }
        }, 3000); 
    } else {
        blocker.classList.remove('hidden'); // BLOCK GUEST CLICKS
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
        id = extractYouTubeId(id);
        if (!id) return alert("Invalid YouTube URL");
    }

    socket.emit('change_source', { roomId, type, id });
    applySource(type, id);
}

function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : url;
}

function applySource(type, id, initialState = null) {
    const container = document.getElementById('video-container');
    container.innerHTML = ''; 
    currentTorrentFile = null;
    if (ytPlayer) ytPlayer.destroy();
    ytPlayer = null;
    
    if (type === 'youtube') {
        ytPlayer = new YTSyncPlayer('video-container', id, () => {
            if (initialState && initialState.isPlaying) {
                syncPlay(initialState.currentTime);
            }
        });
    } else {
        loadTorrent(id, container, initialState);
    }
}

function loadTorrent(magnetURI, container, initialState) {
    if (!client) client = new WebTorrent();
    document.getElementById('status-text').innerText = "Fetching torrent metadata...";
    
    client.add(magnetURI, (torrent) => {
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.webm'));
        if (file) {
            currentTorrentFile = file;
            file.renderTo(container, { autoplay: false, controls: isHost });
            document.getElementById('status-text').innerText = "Torrent loaded!";
            if (initialState && initialState.isPlaying) {
                const video = document.querySelector('video');
                if(video) { video.currentTime = initialState.currentTime; video.play(); }
            }
        } else {
            document.getElementById('status-text').innerText = "Error: No .mp4/.webm found.";
        }
    });
}

function sendAction(action) {
    if (!isHost) return;
    let time = 0;
    if (ytPlayer) time = ytPlayer.getTime();
    else if (currentTorrentFile) {
        const video = document.querySelector('video');
        if(video) time = video.currentTime;
    }

    socket.emit('host_action', { roomId, action, time });
    if (action === 'play') syncPlay(time);
    else if (action === 'pause') syncPause(time);
}

function syncPlay(time) {
    if (ytPlayer) ytPlayer.play(time);
    else if (currentTorrentFile) {
        const video = document.querySelector('video');
        if (video) { video.currentTime = time; video.play(); }
    }
    document.getElementById('status-text').innerText = "Playing...";
}

function syncPause(time) {
    if (ytPlayer) ytPlayer.pause(time);
    else if (currentTorrentFile) {
        const video = document.querySelector('video');
        if (video) { video.currentTime = time; video.pause(); }
    }
    document.getElementById('status-text').innerText = "Paused.";
}
