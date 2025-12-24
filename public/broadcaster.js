const socket = io.connect(window.location.origin);
const startButton = document.getElementById('startButton');
const stopButton = document.createElement('button'); // Creating the Stop button element
const statusDiv = document.getElementById('status');
const localAudio = document.getElementById('localAudio');

// Add the Stop button to the DOM, initially hidden
stopButton.id = 'stopButton';
stopButton.textContent = 'Stop Broadcast';
stopButton.style.display = 'none'; 
stopButton.style.backgroundColor = '#cc0000';
document.body.appendChild(stopButton);

let localStream = null;
const peerConnections = {}; 
const STUN_SERVERS = { 
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] 
};

startButton.onclick = startBroadcast;
stopButton.onclick = stopBroadcast; // Assign the new stop function

function startBroadcast() {
    // Check if stream is already active
    if (localStream) {
        console.warn('Broadcaster: Stream already running.');
        return;
    }

    // Request Audio-Only access
    navigator.mediaDevices.getUserMedia({ audio: true, video: false }) 
        .then(stream => {
            localStream = stream;
            localAudio.srcObject = stream;
            
            socket.emit('broadcaster'); 
            
            statusDiv.innerHTML = 'Broadcasting **LIVE** (Microphone active)';
            startButton.style.display = 'none'; // Hide Start button
            stopButton.style.display = 'inline-block'; // Show Stop button
            console.log('✅ Broadcaster: Local stream active and registered.');
        })
        .catch(error => {
            console.error('❌ Broadcaster Error: Could not access microphone:', error);
            statusDiv.innerHTML = 'Error: Could not access microphone. Please check permissions.';
        });
}

/**
 * Ensures the microphone track is stopped and all connections are closed.
 */
function stopBroadcast() {
    console.log('🛑 Broadcaster: Stopping broadcast.');

    // 1. Stop the local stream/microphone track
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // 2. Close all active peer connections
    Object.keys(peerConnections).forEach(viewerId => {
        peerConnections[viewerId].close();
        delete peerConnections[viewerId];
    });
    
    // 3. Notify the server (and viewers) of the disconnection
    // Since this is a hard stop, relying on 'disconnect' is simpler, but 
    // we can add a custom 'broadcaster-stop' event for robustness if needed.
    
    // 4. Update UI
    statusDiv.innerHTML = 'Broadcast Stopped.';
    startButton.style.display = 'inline-block';
    stopButton.style.display = 'none';
    
    // Force socket disconnect/reconnect to clear broadcaster state on server
    socket.disconnect();
    socket.connect();
}


// 2. A new viewer has joined, create a new connection for them
socket.on('new-viewer', (viewerId) => {
    // Only proceed if a stream is active
    if (!localStream) {
        console.warn(`⚠️ Broadcaster: Cannot connect viewer ${viewerId}. Broadcast not active.`);
        return;
    }

    console.log(`📡 Broadcaster: Received request from new viewer: ${viewerId}`);
    
    if (peerConnections[viewerId]) {
        console.warn(`⚠️ Broadcaster: Connection to viewer ${viewerId} already exists. Skipping.`);
        return;
    }
    
    const pc = new RTCPeerConnection(STUN_SERVERS);
    peerConnections[viewerId] = pc;

    // --- Connection State Logging ---
    pc.oniceconnectionstatechange = () => {
        console.log(`➡️ Broadcaster: ICE state for ${viewerId} is now: ${pc.iceConnectionState}`);
    };
    pc.onconnectionstatechange = () => {
        console.log(`➡️ Broadcaster: Connection state for ${viewerId} is now: ${pc.connectionState}`);
    };
    // ------------------------------

    // Add the local audio track (this is the key to one-to-many)
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log(`   - Audio track added for ${viewerId}.`);
    });

    // Send ICE candidates to the viewer via the server
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', viewerId, event.candidate);
        } else {
            console.log(`   - ICE Candidate gathering complete for ${viewerId}.`);
        }
    };

    // 3. Create Offer (SDP)
    pc.createOffer()
        .then(sdp => {
            console.log(`   - Offer created for ${viewerId}. Setting local description.`);
            return pc.setLocalDescription(sdp);
        })
        .then(() => {
            // Send the Offer to the viewer
            socket.emit('offer', viewerId, pc.localDescription);
            console.log(`   - Offer SENT to ${viewerId}. Waiting for Answer.`);
        })
        .catch(error => {
            console.error(`❌ Broadcaster Error: Offer creation failed for ${viewerId}:`, error);
        });
});

// 4. Receive Answer from the viewer
socket.on('answer', (viewerId, sdp) => {
    if (peerConnections[viewerId]) {
        console.log(`⬅️ Broadcaster: Received Answer from ${viewerId}. Setting remote description.`);
        peerConnections[viewerId].setRemoteDescription(new RTCSessionDescription(sdp))
            .then(() => {
                console.log(`✅ Broadcaster: SDP negotiation complete for ${viewerId}.`);
            })
            .catch(error => {
                console.error(`❌ Broadcaster Error: Failed to set remote Answer for ${viewerId}:`, error);
            });
    } else {
        console.warn(`⚠️ Broadcaster: Received answer for an unknown/closed viewer (${viewerId}).`);
    }
});

// 5. Receive ICE Candidates from the viewer
socket.on('candidate', (viewerId, candidate) => {
    if (peerConnections[viewerId]) {
        peerConnections[viewerId].addIceCandidate(new RTCIceCandidate(candidate))
            .catch(error => {
                console.error(`❌ Broadcaster Error: Failed to add ICE candidate for ${viewerId}:`, error);
            });
    } else {
        console.warn(`⚠️ Broadcaster: Received candidate for an unknown/closed peer (${viewerId}).`);
    }
});

// 6. Clean up when a viewer disconnects (CRITICAL: Does NOT stop localStream)
socket.on('viewer-disconnected', (viewerId) => {
    if (peerConnections[viewerId]) {
        peerConnections[viewerId].close();
        delete peerConnections[viewerId];
        console.log(`🗑️ Broadcaster: Connection closed and cleaned up for viewer ${viewerId}`);
    }
});

// Handle server message if a broadcaster is already present
socket.on('error-message', (message) => {
    statusDiv.innerHTML = 'Error: ' + message;
    startButton.style.display = 'none';
    stopButton.style.display = 'none';
});