let socket;
let localStream;
let clientId;
let audioContext;
let audioMeter;
let peerConnections = new Map(); // Map of peerId -> SimplePeer
let audioContexts = new Map();
let audioMeters = new Map();

// Initialize the application
async function init() {
    socket = io({
        secure: true,
        rejectUnauthorized: false
    });
    setupSocketListeners();
    await setupAudio();
}

// Set up all socket event listeners
function setupSocketListeners() {
    socket.on('clientId', (id) => {
        clientId = id;
        updateStatus('Connected to server');
    });

    socket.on('signal', async (data) => {
        const peer = peerConnections.get(data.from);
        if (peer) {
            try {
                peer.signal(data.signal);
            } catch (e) {
                console.error('Signaling error:', e);
            }
        }
    });

    socket.on('initiateConnection', async (data) => {
        await createPeerConnection(data.peerId, data.initiator);
    });

    socket.on('clientDisconnected', (disconnectedId) => {
        if (peerConnections.has(disconnectedId)) {
            cleanupPeerConnection(disconnectedId);
            updateStatus('Peer disconnected');
        }
    });

    socket.on('peerDisconnected', (peerId) => {
        console.log('Peer disconnected:', peerId);
        cleanupPeerConnection(peerId);
        updateStatus('Peer disconnected');
    });
}

// Clean up a peer connection and its resources
function cleanupPeerConnection(peerId) {
    const peerConnection = peerConnections.get(peerId);
    if (peerConnection) {
        peerConnection.destroy();
        peerConnections.delete(peerId);
        
        // Clean up audio context if needed
        if (audioContexts.has(peerId)) {
            const ctx = audioContexts.get(peerId);
            ctx.close();
            audioContexts.delete(peerId);
        }
        
        // Clean up audio meter if exists
        if (audioMeters.has(peerId)) {
            audioMeters.delete(peerId);
        }
    }
}

// Set up audio stream and audio context
async function setupAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }, 
            video: false 
        });
        setupAudioMeter();
        document.getElementById('muteButton').disabled = false;
        updateStatus('Microphone connected');
    } catch (e) {
        console.error('Error accessing microphone:', e);
        updateStatus('Error accessing microphone');
    }
}

// Create a new peer connection
async function createPeerConnection(peerId, initiator) {
    // Clean up existing connection if any
    cleanupPeerConnection(peerId);

    const peer = new SimplePeer({
        initiator: initiator,
        stream: localStream,
        trickle: false
    });

    peerConnections.set(peerId, peer);

    peer.on('signal', (signal) => {
        socket.emit('signal', {
            target: peerId,
            from: clientId,
            signal: signal
        });
    });

    peer.on('stream', (stream) => {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.play();
        updateStatus(`Connected to peer ${peerId}`);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        updateStatus('Connection error');
        cleanupPeerConnection(peerId);
    });

    peer.on('close', () => {
        updateStatus('Peer connection closed');
        cleanupPeerConnection(peerId);
    });
}

// Set up audio meter visualization
function setupAudioMeter() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(localStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function updateMeter() {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;
        const volume = (average / 255) * 100;
        document.getElementById('meterFill').style.width = `${volume}%`;
        requestAnimationFrame(updateMeter);
    }

    updateMeter();
}

// Update the status display
function updateStatus(message) {
    document.getElementById('status').textContent = `Status: ${message}`;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    init();

    // Mute button
    const muteButton = document.getElementById('muteButton');
    muteButton.addEventListener('click', () => {
        const audioTracks = localStream.getAudioTracks();
        const isEnabled = audioTracks[0].enabled;
        audioTracks[0].enabled = !isEnabled;
        muteButton.textContent = isEnabled ? 'Unmute' : 'Mute';
    });

    // Volume slider
    const volumeSlider = document.getElementById('volumeSlider');
    volumeSlider.addEventListener('input', (e) => {
        const peerConnectionsArray = Array.from(peerConnections.values());
        peerConnectionsArray.forEach((peer) => {
            if (peer.remoteStream) {
                const audio = document.querySelector('audio');
                if (audio) {
                    audio.volume = e.target.value / 100;
                }
            }
        });
    });
});
