let socket;
let localStream;
let clientId;
let audioContext;
let audioMeter;
let peerConnections = new Map(); // Map of peerId -> SimplePeer
let audioElements = new Map(); // Map of peerId -> Audio Element
let transmittingTo = new Set();
let receivingFrom = new Set();

// Initialize the application
async function init() {
    socket = io({
        query: {
            id: new URLSearchParams(window.location.search).get('id')
        },
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
        updateStatus(`Received client ID: ${id}`);
    });

    socket.on('clientInfo', (info) => {
        clientId = info.socketId;
        document.getElementById('socketId').textContent = info.socketId.substring(0, 8);
        document.getElementById('clientName').textContent = info.clientName || 'Unnamed';
        updateStatus(`Connected as ${info.clientName || 'Unnamed'} (${info.socketId.substring(0, 8)})`);
    });

    socket.on('signal', async (data) => {
        const peer = peerConnections.get(data.from);
        if (peer) {
            try {
                peer.signal(data.signal);
                updateStatus(`Processed signal from peer ${data.from}`);
            } catch (e) {
                updateStatus(`Error processing signal from ${data.from}: ${e.message}`);
                console.error('Signaling error:', e);
            }
        } else {
            updateStatus(`Received signal for unknown peer ${data.from}`);
        }
    });

    socket.on('initiateConnection', async (data) => {
        await createPeerConnection(data.peerId, data.initiator);
        updateStatus(`${data.initiator ? 'Initiating' : 'Accepting'} connection with peer ${data.peerId}`);
    });

    socket.on('clientDisconnected', (disconnectedId) => {
        if (peerConnections.has(disconnectedId)) {
            cleanupPeerConnection(disconnectedId);
            updateStatus(`Peer ${disconnectedId} disconnected`);
        }
    });

    socket.on('peerDisconnected', (peerId) => {
        console.log('Peer disconnected:', peerId);
        cleanupPeerConnection(peerId);
        updateStatus(`Peer ${peerId} disconnected`);
    });

    socket.on('connect', () => {
        updateStatus('Connected to server');
    });

    socket.on('disconnect', () => {
        updateStatus('Disconnected from server');
        cleanupPeerConnections();
    });
}

// Clean up a peer connection and its resources
function cleanupPeerConnection(peerId) {
    const peerConnection = peerConnections.get(peerId);
    if (peerConnection) {
        updateStatus(`Cleaning up connection with peer ${peerId}`);
        peerConnection.destroy();
        peerConnections.delete(peerId);
    }

    // Clean up audio element
    const audioElement = audioElements.get(peerId);
    if (audioElement) {
        audioElement.srcObject = null;
        audioElement.remove();
        audioElements.delete(peerId);
    }
    updateStatus(`Connection with peer ${peerId} cleaned up`);
    transmittingTo.delete(peerId);
    receivingFrom.delete(peerId);
    updateConnectionLists();
}

// Set up audio stream and audio context
async function setupAudio() {
    try {
        updateStatus('Requesting microphone access...');
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }, 
            video: false 
        });
        updateStatus('Microphone access granted');
        
        // Enable controls
        document.getElementById('muteButton').disabled = false;
        updateStatus('Audio stream setup complete');
    } catch (e) {
        updateStatus(`Error accessing microphone: ${e.message}`);
        console.error('Error accessing microphone:', e);
    }
}

// Create a new peer connection
async function createPeerConnection(peerId, initiator) {
    updateStatus(`Creating peer connection with ${peerId} (initiator: ${initiator})`);
    
    // Clean up existing connection if any
    cleanupPeerConnection(peerId);

    try {
        const peer = new SimplePeer({
            initiator: initiator,
            stream: localStream,
            trickle: false
        });

        // Set up peer event handlers
        peer.on('signal', (signal) => {
            updateStatus(`Sending signal to peer ${peerId}`);
            socket.emit('signal', { target: peerId, signal: signal });
        });

        peer.on('stream', (stream) => {
            updateStatus(`Received audio stream from peer ${peerId}`);
            // Only add to receivingFrom if we're not the initiator (we're the receiver)
            if (!initiator) {
                receivingFrom.add(peerId);
                updateConnectionLists();
            }
            handleIncomingStream(peerId, stream);
        });

        peer.on('connect', () => {
            updateStatus(`Connected to peer ${peerId}`);
            // Only add to transmittingTo if we're the initiator (we're the sender)
            if (initiator) {
                transmittingTo.add(peerId);
                updateConnectionLists();
            }
        });

        peer.on('error', (error) => {
            updateStatus(`Peer connection error with ${peerId}: ${error.message}`);
            console.error('Peer connection error:', error);
            cleanupPeerConnection(peerId);
        });

        peer.on('close', () => {
            updateStatus(`Peer connection closed with ${peerId}`);
            cleanupPeerConnection(peerId);
        });

        peerConnections.set(peerId, peer);
        updateStatus(`Peer connection created with ${peerId}`);
    } catch (error) {
        updateStatus(`Error creating peer connection with ${peerId}: ${error.message}`);
        console.error('Error creating peer connection:', error);
    }
}

// Set up audio meter visualization
function setupAudioMeter() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(localStream);
    microphone.connect(analyser);
    
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    audioMeter = { analyser, dataArray };
    updateAudioMeter();
    updateStatus('Setting up volume meter');
}

// Update audio meter visualization
function updateAudioMeter() {
    if (!audioMeter) return;
    
    requestAnimationFrame(updateAudioMeter);
    audioMeter.analyser.getByteFrequencyData(audioMeter.dataArray);
    
    let sum = 0;
    for (let i = 0; i < audioMeter.dataArray.length; i++) {
        sum += audioMeter.dataArray[i];
    }
    const average = sum / audioMeter.dataArray.length;
    
    const meter = document.getElementById('audioMeter');
    if (meter) {
        meter.value = average;
    }
    updateStatus('Volume meter active');
}

// Update connection lists
function updateConnectionLists() {
    // Update transmitting list
    const transmittingList = document.getElementById('transmittingList');
    const transmittingCount = document.getElementById('transmittingCount');
    transmittingList.innerHTML = '';
    transmittingCount.textContent = transmittingTo.size;
    
    if (transmittingTo.size === 0) {
        transmittingList.innerHTML = '<li class="empty-message">No active transmissions</li>';
    } else {
        Array.from(transmittingTo).forEach(id => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'status-dot';
            li.appendChild(dot);
            li.appendChild(document.createTextNode(`Client ${id.substring(0, 8)}`));
            transmittingList.appendChild(li);
        });
    }
    
    // Update receiving list
    const receivingList = document.getElementById('receivingList');
    const receivingCount = document.getElementById('receivingCount');
    receivingList.innerHTML = '';
    receivingCount.textContent = receivingFrom.size;
    
    if (receivingFrom.size === 0) {
        receivingList.innerHTML = '<li class="empty-message">No active receivers</li>';
    } else {
        Array.from(receivingFrom).forEach(id => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'status-dot';
            li.appendChild(dot);
            li.appendChild(document.createTextNode(`Client ${id.substring(0, 8)}`));
            receivingList.appendChild(li);
        });
    }
}

// Update status display with timestamp
function updateStatus(message) {
    const statusContainer = document.querySelector('.status-container');
    const statusList = document.getElementById('status');
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    const logEntry = document.createElement('li');
    logEntry.className = 'log-entry';
    
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'timestamp';
    timestampSpan.textContent = timestamp;
    
    const messageSpan = document.createElement('span');
    messageSpan.className = 'message';
    messageSpan.textContent = message;
    
    logEntry.appendChild(timestampSpan);
    logEntry.appendChild(messageSpan);
    
    statusList.appendChild(logEntry);
    
    // Keep only last 100 messages
    while (statusList.children.length > 100) {
        statusList.removeChild(statusList.firstChild);
    }
    
    // Auto-scroll to bottom if we're already near the bottom
    const isNearBottom = statusContainer.scrollHeight - statusContainer.scrollTop - statusContainer.clientHeight < 50;
    if (isNearBottom) {
        statusContainer.scrollTop = statusContainer.scrollHeight;
    }
    
    // Also log to console for debugging
    console.log(`[${timestamp}] ${message}`);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    init();

    // Mute button
    const muteButton = document.getElementById('muteButton');
    muteButton.addEventListener('click', () => {
        const audioTracks = localStream.getAudioTracks();
        const isEnabled = audioTracks[0].enabled;
        audioTracks.forEach(track => {
            track.enabled = !isEnabled;
        });
        updateStatus(`Microphone ${isEnabled ? 'muted' : 'unmuted'}`);
        muteButton.textContent = isEnabled ? 'Unmute' : 'Mute';
    });

    // Master volume slider
    const volumeSlider = document.getElementById('volumeSlider');
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        // Update all audio elements
        audioElements.forEach(audio => {
            audio.volume = volume;
        });
        
        // Update volume percentage display
        const volumeValue = document.querySelector('.volume-value');
        if (volumeValue) {
            volumeValue.textContent = `${e.target.value}%`;
        }
    });
});

function handleIncomingStream(peerId, stream) {
    updateStatus(`Received audio stream from peer ${peerId}`);
    // Create and set up audio element
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    
    // Store the audio element
    audioElements.set(peerId, audio);

    // Set initial volume
    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
        audio.volume = volumeSlider.value / 100;
    }
}
