const express = require('express');
const app = express();
const fs = require('fs');
const https = require('https');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');

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

// SSL Certificate options
const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, 'certificates', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certificates', 'cert.pem'))
};

app.use(express.static('public'));

// Redirect HTTP to HTTPS
app.use((req, res, next) => {
    if (!req.secure) {
        const httpsUrl = `https://${req.headers.host.split(':')[0]}:${HTTPS_PORT}${req.url}`;
        return res.redirect(httpsUrl);
    }
    next();
});

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const clients = new Map(); // Store connected clients
const connections = new Map(); // Store active audio connections

const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;
const HOST = '0.0.0.0';

// Create HTTPS server
const httpsServer = https.createServer(httpsOptions, app);
const io = new Server(httpsServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    const clientId = uuidv4();
    
    // Check if connection is from admin page
    const isAdmin = socket.handshake.headers.referer?.includes('/admin');
    
    clients.set(clientId, {
        socket: socket,
        isAdmin: isAdmin,
        connected: false,
        connections: new Set()
    });

    // Send client their ID
    socket.emit('clientId', clientId);

    // If this is a regular client, notify admins
    if (!isAdmin) {
        notifyAdmins('newClient', clientId);
    } else {
        // If this is an admin, send them the current client list
        const clientsList = Array.from(clients.keys()).filter(id => 
            id !== clientId && !clients.get(id).isAdmin
        );
        socket.emit('clientsList', clientsList);
    }

    // Handle client signaling
    socket.on('signal', (data) => {
        if (data.target && clients.has(data.target)) {
            clients.get(data.target).socket.emit('signal', {
                from: clientId,
                signal: data.signal
            });
        }
    });

    // Handle admin connecting two clients
    socket.on('connectClients', (data) => {
        const client = clients.get(clientId);
        if (client && client.isAdmin && data.client1 && data.client2) {
            if (clients.has(data.client1) && clients.has(data.client2)) {
                // Store the connection
                if (!connections.has(data.client1)) {
                    connections.set(data.client1, new Set());
                }
                connections.get(data.client1).add(data.client2);
                
                // Store the connection in client's connections
                clients.get(data.client1).connections.add(data.client2);

                // Notify clients to establish connection
                clients.get(data.client1).socket.emit('initiateConnection', {
                    peerId: data.client2,
                    initiator: true
                });
                clients.get(data.client2).socket.emit('initiateConnection', {
                    peerId: data.client1,
                    initiator: false
                });
            }
        }
    });

    // Handle admin disconnecting clients
    socket.on('disconnectClients', (data) => {
        const client = clients.get(clientId);
        if (client && client.isAdmin && data.clientId) {
            disconnectClient(data.clientId);
        }
    });

    // Handle admin clearing all connections
    socket.on('clearConnections', () => {
        const client = clients.get(clientId);
        if (client && client.isAdmin) {
            connections.clear();
            // Notify all clients to disconnect
            for (const [clientId, client] of clients.entries()) {
                if (!client.isAdmin) {
                    disconnectClient(clientId);
                }
            }
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const client = clients.get(clientId);
        if (client) {
            // Remove all connections for this client
            disconnectClient(clientId);
            
            // Remove client from clients map
            clients.delete(clientId);
            
            // If this was a regular client, notify admins
            if (!client.isAdmin) {
                notifyAdmins('clientDisconnected', clientId);
            }
        }
    });
});

// Helper function to disconnect a client from all connections
function disconnectClient(clientId) {
    if (connections.has(clientId)) {
        // Notify connected peers about disconnection
        for (const peerId of connections.get(clientId)) {
            if (clients.has(peerId)) {
                clients.get(peerId).socket.emit('peerDisconnected', clientId);
            }
        }
        connections.delete(clientId);
    }
    
    // Remove this client from other clients' connections
    for (const [peerId, peerConnections] of connections.entries()) {
        if (peerConnections.has(clientId)) {
            peerConnections.delete(clientId);
            if (clients.has(peerId)) {
                clients.get(peerId).socket.emit('peerDisconnected', clientId);
            }
        }
    }
}

// Helper function to notify all admin clients
function notifyAdmins(event, data) {
    for (const [_, client] of clients.entries()) {
        if (client.isAdmin) {
            client.socket.emit(event, data);
        }
    }
}

// Start the server
httpsServer.listen(HTTPS_PORT, HOST, () => {
    const localIP = getLocalIP();
    console.log('\nServer running on:');
    console.log(`HTTPS URLs (secure):`);
    console.log(`- Local:   https://localhost:${HTTPS_PORT}`);
    console.log(`- Network: https://${localIP}:${HTTPS_PORT}`);
    console.log(`- Admin:   https://${localIP}:${HTTPS_PORT}/admin`);
    console.log('\nNote: Accept the security warning in your browser (self-signed certificate)');
});
