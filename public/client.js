let socket;
let peer;
let localStream;
let clientId;
let audioContext;
let audioMeter;

// Initialize the application
async function init() {
    socket = io({
        secure: true,
        rejectUnauthorized: false // Accept self-signed certificates
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
        if (peer && peer.peerId === disconnectedId) {
            peer.destroy();
            peer = null;
            updateStatus('Peer disconnected');
        }
    });
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
    if (peer) {
        peer.destroy();
    }

    peer = new SimplePeer({
        initiator: initiator,
        stream: localStream,
        trickle: false
    });

    peer.peerId = peerId;

    peer.on('signal', (signal) => {
        socket.emit('signal', {
            target: peerId,
            signal: signal
        });
    });

    peer.on('stream', (stream) => {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.play();
        updateStatus('Connected to peer');
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        updateStatus('Connection error');
    });

    peer.on('close', () => {
        updateStatus('Peer connection closed');
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
        if (peer && peer.remoteStream) {
            const audio = document.querySelector('audio');
            if (audio) {
                audio.volume = e.target.value / 100;
            }
        }
    });
});
