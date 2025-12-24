const socket = io.connect(window.location.origin);
const remoteAudio = document.getElementById('remoteAudio');
const statusDiv = document.getElementById('status');

let peerConnection = null;
const STUN_SERVERS = { 
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] 
};

// 1. Register as a viewer upon page load
socket.emit('viewer');

statusDiv.innerHTML = 'Attempting to find a broadcaster...';

// If the broadcaster is not present, the server sends this message.
socket.on('no-broadcaster', () => {
    statusDiv.innerHTML = 'Waiting for a broadcaster to start streaming...';
});

// If the broadcaster was waiting for viewers, this triggers the Offer/Answer cycle
socket.on('broadcaster-ready', () => {
    // Re-send 'viewer' to ensure the broadcaster notices us
    socket.emit('viewer'); 
});

// 2. Receive the Offer from the broadcaster
socket.on('offer', (broadcasterId, sdp) => {
    statusDiv.innerHTML = 'Connecting to broadcaster...';

    peerConnection = new RTCPeerConnection(STUN_SERVERS);

    // This event fires when the broadcaster's audio track arrives
    peerConnection.ontrack = (event) => {
        statusDiv.innerHTML = 'Successfully connected! Listening live.';
        // Assign the remote stream to the <audio> element
        remoteAudio.srcObject = event.streams[0]; 
    };

    // Send ICE candidates back to the broadcaster via the server
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', broadcasterId, event.candidate);
        }
    };

    // 3. Set the Offer and create the Answer (SDP)
    peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
        .then(() => peerConnection.createAnswer())
        .then(sdp => peerConnection.setLocalDescription(sdp))
        .then(() => {
            // Send the Answer back to the broadcaster
            socket.emit('answer', broadcasterId, peerConnection.localDescription);
        })
        .catch(error => console.error('Error creating/sending answer:', error));
});

// 4. Receive ICE Candidates from the broadcaster
socket.on('candidate', (broadcasterId, candidate) => {
    if (peerConnection) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

// 5. Broadcaster disconnected
socket.on('broadcaster-disconnected', () => {
    statusDiv.innerHTML = 'BROADCAST ENDED. The broadcaster has disconnected.';
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
        remoteAudio.srcObject = null;
    }
});