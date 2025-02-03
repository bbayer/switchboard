let socket;
let clientId;
let graph;
let canvas;
let clientNodes = new Map(); // Track client nodes

// Initialize the application
function init() {
    socket = io({
        secure: true,
        rejectUnauthorized: false
    });
    setupSocketListeners();
    setupGraph();
    // Initial resize
    setTimeout(() => {
        resizeCanvas();
    }, 100);
}

// Set up the LiteGraph environment
function setupGraph() {
    graph = new LGraph();
    canvas = new LGraphCanvas("#graphCanvas", graph);
    
    // Register custom node type for audio clients
    LiteGraph.registerNodeType("audio/client", AudioClientNode);
    
    // Set some graph configurations
    graph.configure({ align_to_grid: true });
    canvas.background_image = "";
    canvas.render_connections_border = true;
    canvas.render_curved_connections = true;
    
    // Configure canvas for fullscreen
    canvas.allow_searchbox = false;
    canvas.allow_dragnodes = true;
    canvas.allow_reconnect_links = true;
    canvas.allow_dragcanvas = true;
    canvas.show_info = true;
    
    // Start graph execution
    graph.start();
}

// Set up all socket event listeners
function setupSocketListeners() {
    socket.on('clientId', (id) => {
        clientId = id;
        console.log('Admin connected with ID:', clientId);
        // Authenticate as admin
        socket.emit('adminAuth');
    });

    socket.on('clientsUpdate', (data) => {
        console.log('Received clients update:', data);
        const { clients, connections } = data;
        
        // First, remove nodes for disconnected clients
        for (const [nodeClientId, node] of clientNodes) {
            if (!clients.some(c => c.socketId === nodeClientId)) {
                console.log('Removing node for disconnected client:', nodeClientId);
                graph.remove(node);
                clientNodes.delete(nodeClientId);
            }
        }
        
        // Then, add nodes for new clients
        clients.forEach(client => {
            if (!clientNodes.has(client.socketId)) {
                console.log('Adding node for new client:', client);
                const node = createClientNode(client);
                clientNodes.set(client.socketId, node);
            } else {
                // Update existing node's display name if needed
                const node = clientNodes.get(client.socketId);
                node.properties.clientName = client.clientName;
                node.properties.displayName = client.clientName || `Client ${client.socketId.substring(0, 4)}`;
            }
        });
        
        // Wait a bit for nodes to be fully created
        setTimeout(() => {
            // Restore connections visually without triggering events
            connections.forEach(conn => {
                const { receiver, transmitters } = conn;
                transmitters.forEach(transmitter => {
                    const receiverNode = findNodeByClientId(receiver.socketId);
                    const transmitterNode = findNodeByClientId(transmitter.socketId);
                    
                    if (receiverNode && transmitterNode) {
                        // Get slot indices
                        const outputSlot = transmitterNode.findOutputSlot("tx");
                        const inputSlot = receiverNode.getAvailableRxSlot();
                        
                        if (outputSlot !== -1 && inputSlot !== -1) {
                            // Create visual connection without triggering events
                            const receiverHandler = receiverNode.onConnectionsChange;
                            const transmitterHandler = transmitterNode.onConnectionsChange;
                            
                            receiverNode.onConnectionsChange = null;
                            transmitterNode.onConnectionsChange = null;
                            
                            receiverNode.connect(inputSlot, transmitterNode, outputSlot);
                            
                            receiverNode.incomingConnections.add(transmitter.socketId);
                            transmitterNode.outgoingConnections.add(receiver.socketId);
                            
                            receiverNode.onConnectionsChange = receiverHandler;
                            transmitterNode.onConnectionsChange = transmitterHandler;
                        }
                    }
                });
            });
            
            canvas.setDirty(true, true);
        }, 100); // Small delay to ensure nodes are ready
    });

    socket.on('clientsList', (clients) => {
        console.log('Received clients list:', clients);
        updateClientNodes(clients);
    });
}

// Helper method to find slot index by name
LGraphNode.prototype.findInputSlot = function(name) {
    if (!this.inputs) return -1;
    for (let i = 0; i < this.inputs.length; ++i) {
        if (this.inputs[i].name === name) {
            return i;
        }
    }
    return -1;
};

LGraphNode.prototype.findOutputSlot = function(name) {
    if (!this.outputs) return -1;
    for (let i = 0; i < this.outputs.length; ++i) {
        if (this.outputs[i].name === name) {
            return i;
        }
    }
    return -1;
};

// Helper to check if input is already connected to a node
LGraphNode.prototype.isInputConnectedTo = function(node, slot) {
    if (!this.inputs || !this.inputs[slot] || !this.inputs[slot].link) return false;
    const links = Array.isArray(this.inputs[slot].link) ? this.inputs[slot].link : [this.inputs[slot].link];
    return links.some(link => {
        const linkInfo = graph.links[link];
        return linkInfo && linkInfo.origin_id === node.id;
    });
};

// Find a node by client ID
function findNodeByClientId(clientId) {
    return clientNodes.get(clientId);
}

// Update client nodes based on current clients
function updateClientNodes(clients) {
    // Track current client IDs for cleanup
    const currentClientIds = new Set(clients.map(c => c.socketId));
    
    // Remove nodes for disconnected clients
    for (let [nodeId, node] of clientNodes) {
        if (!currentClientIds.has(nodeId)) {
            graph.remove(node);
            clientNodes.delete(nodeId);
        }
    }

    // Add new nodes for new clients
    clients.forEach((client) => {
        if (!clientNodes.has(client.socketId)) {
            const node = createClientNode(client);
            clientNodes.set(client.socketId, node);
        }
    });

    // Trigger canvas update
    canvas.setDirty(true, true);
}

// Create a new client node
function createClientNode(client) {
    const node = LiteGraph.createNode("audio/client");
    node.properties.socketId = client.socketId;
    node.properties.clientName = client.clientName;
    node.properties.displayName = client.clientName || `Client ${client.socketId.substring(0, 4)}`;
    
    // Position node in a grid layout
    const nodeCount = clientNodes.size;
    const row = Math.floor(nodeCount / 3);
    const col = nodeCount % 3;
    node.pos = [col * 250 + 50, row * 150 + 50];
    
    graph.add(node);
    return node;
}

// Resize canvas to match window size
function resizeCanvas() {
    const graphCanvasElement = document.getElementById('graphCanvas');
    if (!graphCanvasElement) return;
    
    graphCanvasElement.width = window.innerWidth;
    graphCanvasElement.height = window.innerHeight;
    if (canvas) {
        canvas.resize();
        // If there are no nodes, just center the view
        if (!graph || !graph._nodes.length) {
            canvas.ds.scale = 1;
            canvas.ds.offset[0] = window.innerWidth / 2;
            canvas.ds.offset[1] = window.innerHeight / 2;
            canvas.setDirty(true, true);
        } else {
            zoomToFit();
        }
    }
}

// Zoom to fit all nodes
function zoomToFit() {
    if (!canvas || !graph || !graph._nodes.length) {
        // If there are no nodes, just center the view
        if (canvas) {
            canvas.ds.scale = 1;
            canvas.ds.offset[0] = window.innerWidth / 2;
            canvas.ds.offset[1] = window.innerHeight / 2;
            canvas.setDirty(true, true);
        }
        return;
    }

    // Find bounds of all nodes
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    graph._nodes.forEach(node => {
        minX = Math.min(minX, node.pos[0]);
        minY = Math.min(minY, node.pos[1]);
        maxX = Math.max(maxX, node.pos[0] + node.size[0]);
        maxY = Math.max(maxY, node.pos[1] + node.size[1]);
    });

    // Add padding
    const padding = 100;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // Calculate center and scale
    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const scaleX = window.innerWidth / graphWidth;
    const scaleY = window.innerHeight / graphHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in more than 100%

    // Center the graph
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Update canvas view
    canvas.ds.scale = scale;
    canvas.ds.offset[0] = window.innerWidth / 2 - centerX * scale;
    canvas.ds.offset[1] = window.innerHeight / 2 - centerY * scale;
    canvas.setDirty(true, true);
}

class AudioClientNode {
    constructor() {
        // Configure the node
        this.addInput("rx", "audio", {
            removable: true,
            color_off: "#666",
            color_on: "#4CAF50"
        });
        
        this.addOutput("tx", "audio", {
            color_off: "#666",
            color_on: "#2196F3"
        });

        this.size = [180, 90];
        this.properties = { 
            socketId: "",
            clientName: "Unknown Client",
            displayName: "Unknown Client"
        };
        this.color = "#2A363B";
        this.incomingConnections = new Set(); // Track incoming connections
        this.outgoingConnections = new Set(); // Track outgoing connections
        this.rxSlotCount = 1; // Track number of RX slots
    }

    // Find an available RX slot or create a new one
    getAvailableRxSlot() {
        // Check existing slots
        for (let i = 0; i < this.inputs.length; i++) {
            if (!this.inputs[i].link) {
                return i;
            }
        }
        
        // If no available slot, create a new one
        const newSlotIndex = this.inputs.length;
        this.addInput(`rx${newSlotIndex}`, "audio", {
            removable: true,
            color_off: "#666",
            color_on: "#4CAF50"
        });
        this.rxSlotCount++;
        this.size[1] = Math.max(90, 60 + this.rxSlotCount * 20); // Adjust node height
        return newSlotIndex;
    }

    onConnectionsChange(slotType, slot, isConnected, link_info, output_slot) {
        if (!this.properties.socketId) return;

        const otherNode = graph.getNodeById(
            slotType === LiteGraph.INPUT ? link_info.origin_id : link_info.target_id
        );
        
        if (!otherNode || !otherNode.properties.socketId) return;

        if (isConnected) {
            if (slotType === LiteGraph.INPUT) {
                // When RX is connected (receiving audio)
                socket.emit('connectClients', {
                    client1: otherNode.properties.socketId,
                    client2: this.properties.socketId
                });
                this.incomingConnections.add(otherNode.properties.socketId);
                otherNode.outgoingConnections.add(this.properties.socketId);
            }
        } else {
            if (slotType === LiteGraph.INPUT) {
                // When RX is disconnected
                socket.emit('disconnectClients', {
                    client1: otherNode.properties.socketId,
                    client2: this.properties.socketId
                });
                this.incomingConnections.delete(otherNode.properties.socketId);
                otherNode.outgoingConnections.delete(this.properties.socketId);

                // Clean up empty slots except the first one
                this.cleanupEmptySlots();
            }
        }

        this.setDirtyCanvas(true, true);
    }

    // Clean up empty slots, keeping at least one
    cleanupEmptySlots() {
        // Keep track of slots to remove
        const slotsToRemove = [];
        
        // Find empty slots (except the first one)
        for (let i = this.inputs.length - 1; i > 0; i--) {
            if (!this.inputs[i].link) {
                slotsToRemove.push(i);
            }
        }
        
        // Remove empty slots from the end
        for (let i = slotsToRemove.length - 1; i >= 0; i--) {
            this.removeInput(slotsToRemove[i]);
            this.rxSlotCount--;
        }
        
        // Adjust node height
        this.size[1] = Math.max(90, 60 + this.rxSlotCount * 20);
    }

    onDrawForeground(ctx) {
        // Draw client information
        ctx.font = "12px Arial";
        ctx.fillStyle = "#CCC";
        ctx.textAlign = "center";
        
        // Draw client name (user-defined ID or socket ID)
        ctx.fillText(this.properties.displayName, this.size[0] * 0.5, 20);
        
        // Draw socket ID in smaller text if client name exists
        if (this.properties.clientName) {
            ctx.font = "10px Arial";
            ctx.fillStyle = "#888";
            ctx.fillText(this.properties.socketId.substring(0, 8), this.size[0] * 0.5, 35);
        }
        
        // Draw connection counts
        const inCount = this.incomingConnections.size;
        const outCount = this.outgoingConnections.size;
        
        if (inCount > 0 || outCount > 0) {
            ctx.fillStyle = "#666";
            ctx.textAlign = "center";
            ctx.font = "11px Arial";
            
            let connectionText = [];
            if (inCount > 0) connectionText.push(`${inCount} in`);
            if (outCount > 0) connectionText.push(`${outCount} out`);
            
            ctx.fillText(connectionText.join(', '), this.size[0] * 0.5, 55);
        }
        
        // Draw TX label with connection count
        ctx.fillStyle = "#666";
        ctx.textAlign = "right";
        ctx.font = "11px Arial";
        ctx.fillText(`TX${outCount > 0 ? ` (${outCount})` : ''}`, this.size[0] - 10, this.size[1] - 15);

        // Draw connection indicators
        if (outCount > 0) {
            ctx.fillStyle = "#2196F3";
            ctx.beginPath();
            ctx.arc(this.size[0] - 20, this.size[1] - 20, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Override connection logic
    onConnectInput(slot, type, pos, link, input_slot) {
        if (type !== "audio") return false;
        
        // If the slot is already connected, get a new slot
        if (this.inputs[slot].link) {
            const newSlot = this.getAvailableRxSlot();
            // Return the new slot index to tell LiteGraph to use this slot instead
            return newSlot;
        }
        
        return true; // Allow connection to empty slot
    }
}

// Handle window resize
window.addEventListener('resize', resizeCanvas);

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
