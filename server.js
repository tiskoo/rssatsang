const express = require('express');
// CHANGE 1: Import 'https' module instead of 'http'
const https = require('https'); 
const fs = require('fs'); // To read the certificate files
// REMOVE: const http = require('http'); 
const socketIo = require('socket.io');
const path = require('path');

const app = express();

// --- HTTPS/SSL Configuration ---
// Make sure you have 'server.key' and 'server.cert' files in the same directory.
// *** You must generate these files first using OpenSSL! ***
try {
    const options = {
        key: fs.readFileSync('server.key'),
        cert: fs.readFileSync('server.cert')
    };

    // CHANGE 2: Create the HTTPS server with the options object
    const server = https.createServer(options, app);
    const io = socketIo(server);

    // Serve static files from the 'public' directory
    app.use(express.static(path.join(__dirname, 'public')));

    // Simple routing for testing
    app.get('/broadcaster', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'broadcaster.html'));
    });

    app.get('/viewer', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
    });

    let broadcasterId = null; 
    const viewers = {}; 

    io.on('connection', (socket) => {
        console.log('A user connected:', socket.id);

        // === BROADCASTER LOGIC ===
        socket.on('broadcaster', () => {
            if (broadcasterId && broadcasterId !== socket.id) {
                socket.emit('error-message', 'A broadcaster is already active.');
                return;
            }
            broadcasterId = socket.id;
            socket.join('broadcasting');
            console.log('Broadcaster registered:', broadcasterId);
            socket.broadcast.emit('broadcaster-ready');
        });

        // === VIEWER LOGIC ===
        socket.on('viewer', () => {
            viewers[socket.id] = true;
            socket.join('viewing');
            console.log('Viewer joined:', socket.id);
            
            if (broadcasterId) {
                socket.to(broadcasterId).emit('new-viewer', socket.id);
            } else {
                socket.emit('no-broadcaster'); 
            }
        });

        // === SIGNALING ===
        // Offer: Broadcaster -> Viewer
        socket.on('offer', (id, message) => {
            socket.to(id).emit('offer', socket.id, message);
        });

        // Answer: Viewer -> Broadcaster
        socket.on('answer', (id, message) => {
            socket.to(id).emit('answer', socket.id, message);
        });

        // ICE Candidate: Forward to the target peer
        socket.on('candidate', (id, message) => {
            socket.to(id).emit('candidate', socket.id, message);
        });

        // === DISCONNECTION ===
        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
            
            if (socket.id === broadcasterId) {
                io.to('viewing').emit('broadcaster-disconnected');
                broadcasterId = null;
                Object.keys(viewers).forEach(id => delete viewers[id]);
            } else if (viewers[socket.id]) {
                socket.to(broadcasterId).emit('viewer-disconnected', socket.id);
                delete viewers[socket.id];
            }
        });
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        // CHANGE 3: The console log now reflects the secure protocol
        console.log(`✅ HTTPS Server running on https://localhost:${PORT}`);
    });

} catch (e) {
    console.error("❌ ERROR: Could not start HTTPS server.");
    console.error("Please ensure you have run the OpenSSL command to generate 'server.key' and 'server.cert'.");
    console.error(`Error details: ${e.message}`);
}