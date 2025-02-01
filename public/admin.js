let socket;
let clientId;
let graph;
let canvas;

// Initialize the application
function init() {
    socket = io();
    setupSocketListeners();
    setupGraph();
}

// Set up the LiteGraph environment
function setupGraph() {
    graph = new LGraph();
    canvas = new LGraphCanvas("#graphCanvas", graph);
    
    // Register custom node type for audio clients
    LiteGraph.registerNodeType("audio/client", AudioClientNode);
    
    // Set some graph configurations
    graph.config.align_to_grid = true;
    canvas.background_image = "";
    canvas.render_connections_border = true;
    canvas.render_curved_connections = true;
    
    // Start graph execution
    graph.start();
}

// Custom node type for audio clients
class AudioClientNode {
    constructor() {
        this.addInput("rx", "audio");
        this.addOutput("tx", "audio");
        this.size = [180, 90];
        this.properties = { clientId: "", clientName: "Unknown Client" };
        this.color = "#2A363B";
    }

    onConnectionsChange(slotType, slot, isConnected, link_info, output_slot) {
        if (isConnected && slotType === LiteGraph.INPUT) {
            // When RX is connected
            const fromNode = graph.getNodeById(link_info.origin_id);
            if (fromNode) {
                socket.emit('connectClients', {
                    client1: fromNode.properties.clientId,
                    client2: this.properties.clientId
                });
            }
        } else if (!isConnected && slotType === LiteGraph.INPUT) {
            // When RX is disconnected
            socket.emit('disconnectClients', {
                clientId: this.properties.clientId
            });
        }
    }

    onDrawForeground(ctx) {
        // Draw client information
        ctx.font = "12px Arial";
        ctx.fillStyle = "#CCC";
        ctx.textAlign = "center";
        ctx.fillText(this.properties.clientName, this.size[0] * 0.5, 20);
        ctx.fillText(this.properties.clientId.substring(0, 8), this.size[0] * 0.5, 40);
        
        // Draw RX/TX labels
        ctx.fillStyle = "#666";
        ctx.textAlign = "left";
        ctx.fillText("RX", 10, 65);
        ctx.textAlign = "right";
        ctx.fillText("TX", this.size[0] - 10, 65);
    }
}

AudioClientNode.title = "Audio Client";
AudioClientNode.desc = "WebRTC Audio Client Node";

// Set up all socket event listeners
function setupSocketListeners() {
    socket.on('clientId', (id) => {
        clientId = id;
        // Auto-authenticate as admin
        socket.emit('adminAuth');
    });

    socket.on('newClient', (client) => {
        console.log('New client connected:', client);
        addClientNode(client);
    });

    socket.on('clientDisconnected', (disconnectedId) => {
        console.log('Client disconnected:', disconnectedId);
        removeClientNode(disconnectedId);
    });

    socket.on('clientsList', (clients) => {
        console.log('Received clients list:', clients);
        // Clear existing nodes
        graph.clear();
        
        // Add nodes for each client
        clients.forEach(client => {
            addClientNode(client);
        });
    });
}

// Find a node by client ID
function findNodeByClientId(clientId) {
    const nodes = graph._nodes;
    return nodes.find(node => node.properties && node.properties.clientId === clientId);
}

// Add a new client node to the graph
function addClientNode(clientId) {
    console.log('Adding node for client:', clientId);
    const existingNode = findNodeByClientId(clientId);
    if (existingNode) {
        console.log('Node already exists for client:', clientId);
        return;
    }

    const node = LiteGraph.createNode("audio/client");
    if (!node) {
        console.error('Failed to create node for client:', clientId);
        return;
    }

    node.properties.clientId = clientId;
    node.properties.clientName = `Client ${clientId.substring(0, 8)}`;
    
    // Position node in a grid-like layout
    const nodeCount = (graph._nodes || []).length;
    node.pos = [nodeCount * 220, nodeCount * 120];
    
    graph.add(node);
    console.log('Added node for client:', clientId);
}

// Remove a client node from the graph
function removeClientNode(clientId) {
    console.log('Removing node for client:', clientId);
    const node = findNodeByClientId(clientId);
    if (node) {
        graph.remove(node);
        console.log('Removed node for client:', clientId);
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    init();

    // Clear graph
    document.getElementById('clearGraph').addEventListener('click', () => {
        graph.clear();
        socket.emit('clearConnections');
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        if (canvas) {
            canvas.resize();
        }
    });
});
