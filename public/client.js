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

// UPDATED: Heartbeat now checks BOTH time and Play/Pause state
socket.on('heartbeat_sync', (data) => {
    if (!isHost) {
        const currentTime = getCurrentTime();
        const currentIsPlaying = getIsPlaying();

        // 1. Force Play/Pause state if it doesn't match the host
        if (data.isPlaying !== currentIsPlaying) {
            if (data.isPlaying) {
                // Host is playing, guest is paused. Force play.
                if (currentTime !== null && Math.abs(currentTime - data.time) > 1) {
                    seekTo(data.time);
                }
                // Tiny delay for YouTube API to register the seek before playing
                setTimeout(() => {
                    if (currentTorrentFile) document.querySelector('video').play();
                    else if (ytPlayer) ytPlayer.playVideo();
                }, 100);
            } else {
                // Host is paused, force guest to pause
                if (currentTorrentFile) document.querySelector('video').pause();
                else if (ytPlayer) ytPlayer.pauseVideo();
            }
        } 
        // 2. Correct time drift if both are playing
        else if (data.isPlaying && currentTime !== null && Math.abs(currentTime - data.time) > 1.5) {
            seekTo(data.time);
        }
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
        
        // Heartbeat sends time AND play state every 2 seconds
        heartbeatInterval = setInterval(() => {
            const time = getCurrentTime();
            const isPlaying = getIsPlaying();
            if (time !== null) socket.emit('heartbeat', { roomId, time, isPlaying });
        }, 2000); 
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
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.webm'));
        if (file) {
            currentTorrentFile = file;
            // STRICT CONTROL: Only show controls if host
            file.renderTo(container, { autoplay: false, controls: isHost });
            document.getElementById('status-text').innerText = "Video loaded! Press Play.";
        } else {
            document.getElementById('status-text').innerText = "Error: No .mp4 or .webm file found.";
        }
    });
}

function loadYouTube(videoId, container) {
    document.getElementById('status-text').innerText = "Loading YouTube...";
    if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

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
        playerVars: { 
            'playsinline': 1, 
            'controls': isHost ? 1 : 0, 
            'disablekb': 1, // DISABLES KEYBOARD SHORTCUTS FOR GUESTS
            'rel': 0,
            'modestbranding': 1
        },
        events: {
            'onReady': () => document.getElementById('status-text').innerText = "YouTube loaded! Press Play.",
            'onError': (e) => document.getElementById('status-text').innerText = "YouTube Error."
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

// NEW: Helper to check if the video is currently playing
function getIsPlaying() {
    if (currentTorrentFile) {
        const video = document.querySelector('#video-container video');
        return video ? !video.paused : false;
    } else if (ytPlayer && ytPlayer.getPlayerState) {
        // YouTube API state 1 means PLAYING
        return ytPlayer.getPlayerState() === 1; 
    }
    return false;
}
