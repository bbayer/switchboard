const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.static('public'));

// Serve socket.io client from node_modules
app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
});

// Serve simple-peer from node_modules
app.get('/simple-peer/simplepeer.min.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'simple-peer', 'simplepeer.min.js'));
});

// SSL configuration
const options = {
    key: fs.readFileSync(path.join(__dirname, 'certificates', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certificates', 'cert.pem'))
};

const server = https.createServer(options, app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Track clients and connections
const clients = new Map(); // socketId -> Set(connectedTo)
const clientNames = new Map(); // socketId -> clientName
const connections = new Map(); // receiverId -> Set(transmitterIds)
let adminSocket = null;

function getClientInfo(socketId) {
    return {
        socketId,
        clientName: clientNames.get(socketId) || null
    };
}

function broadcastClientsUpdate() {
    const clientsList = Array.from(clients.keys()).map(getClientInfo);
    const connectionsList = Array.from(connections.entries()).map(([receiver, transmitters]) => ({
        receiver: getClientInfo(receiver),
        transmitters: Array.from(transmitters).map(getClientInfo)
    }));

    io.emit('clientsUpdate', { 
        clients: clientsList,
        connections: connectionsList
    });
}

function sendClientsUpdate() {
    if (!adminSocket) return;

    // Filter out admin from clients list
    const clientsList = Array.from(clients.keys()).filter(id => id !== adminSocket.id).map(getClientInfo);

    const clientsInfo = {
        clients: clientsList,
        connections: Array.from(connections.entries()).map(([receiverId, transmitters]) => ({
            receiver: getClientInfo(receiverId),
            transmitters: Array.from(transmitters).map(getClientInfo)
        }))
    };

    adminSocket.emit('clientsUpdate', clientsInfo);
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    clients.set(socket.id, new Set());
    clientNames.set(socket.id, null);

    // Check for client ID in query parameters
    const clientId = socket.handshake.query.id;
    if (clientId) {
        clientNames.set(socket.id, clientId);
    }

    // Send client their socket ID and name
    socket.emit('clientInfo', { 
        socketId: socket.id,
        clientName: clientNames.get(socket.id)
    });

    // Send client ID
    socket.emit('clientId', socket.id);

    // Handle admin authentication
    socket.on('adminAuth', () => {
        console.log('Admin authenticated:', socket.id);
        adminSocket = socket;
        // Send current clients and connections to admin
        sendClientsUpdate();
    });

    // Handle client disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        clients.delete(socket.id);
        clientNames.delete(socket.id);
        
        // Clean up connections
        if (connections.has(socket.id)) {
            connections.delete(socket.id);
        }
        
        // Remove from all transmitter sets
        for (let [receiverId, transmitters] of connections) {
            if (transmitters.has(socket.id)) {
                transmitters.delete(socket.id);
                if (transmitters.size === 0) {
                    connections.delete(receiverId);
                }
            }
        }

        // Notify admin
        sendClientsUpdate();
        
        // Notify other clients about disconnection
        socket.broadcast.emit('peerDisconnected', socket.id);
    });

    // Handle client connection request
    socket.on('connectClients', (data) => {
        const { client1, client2 } = data; // client1 is transmitter, client2 is receiver
        
        // Initialize or get the set of transmitters for this receiver
        if (!connections.has(client2)) {
            connections.set(client2, new Set());
        }
        connections.get(client2).add(client1);

        // Update clients' connected sets
        clients.get(client1).add(client2);
        clients.get(client2).add(client1);

        // Notify clients to establish connection
        const transmitterSocket = io.sockets.sockets.get(client1);
        const receiverSocket = io.sockets.sockets.get(client2);
        
        if (transmitterSocket && receiverSocket) {
            transmitterSocket.emit('initiateConnection', {
                peerId: client2,
                initiator: true
            });
            receiverSocket.emit('initiateConnection', {
                peerId: client1,
                initiator: false
            });
        }

        // Notify admin about the new connection
        sendClientsUpdate();
    });

    // Handle client disconnection request
    socket.on('disconnectClients', (data) => {
        const { client1, client2 } = data; // client1 is transmitter, client2 is receiver
        
        // Remove the connection
        if (connections.has(client2)) {
            connections.get(client2).delete(client1);
            if (connections.get(client2).size === 0) {
                connections.delete(client2);
            }
        }

        // Update clients' connected sets
        if (clients.has(client1)) clients.get(client1).delete(client2);
        if (clients.has(client2)) clients.get(client2).delete(client1);

        // Notify clients
        const transmitterSocket = io.sockets.sockets.get(client1);
        const receiverSocket = io.sockets.sockets.get(client2);
        
        if (transmitterSocket) transmitterSocket.emit('peerDisconnected', client2);
        if (receiverSocket) receiverSocket.emit('peerDisconnected', client1);

        // Notify admin about the connection change
        sendClientsUpdate();
    });

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
        const { target, signal } = data;
        const targetSocket = io.sockets.sockets.get(target);
        if (targetSocket) {
            targetSocket.emit('signal', {
                signal: signal,
                from: socket.id
            });
        }
    });

    // Send initial clients list
    sendClientsUpdate();
});

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Redirect HTTP to HTTPS
app.use((req, res, next) => {
    if (!req.secure) {
        const httpsUrl = `https://${req.headers.host.split(':')[0]}:${server.address().port}${req.url}`;
        return res.redirect(httpsUrl);
    }
    next();
});

const HTTPS_PORT = process.env.HTTPS_PORT || 3001;
const HOST = '0.0.0.0';

// Start the server
server.listen(HTTPS_PORT, HOST, () => {
    const localIP = getLocalIP();
    console.log('\nServer running on:');
    console.log(`HTTPS URLs (secure):`);
    console.log(`- Local:   https://localhost:${HTTPS_PORT}`);
    console.log(`- Network: https://${localIP}:${HTTPS_PORT}`);
    console.log(`- Admin:   https://${localIP}:${HTTPS_PORT}/admin`);
    console.log('\nNote: Accept the security warning in your browser (self-signed certificate)');
});

// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (!iface.internal && iface.family === 'IPv4') {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
