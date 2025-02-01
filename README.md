# WebRTC Audio Application

This is a WebRTC-based audio application that allows users to connect and communicate through audio channels. An admin can manage and establish connections between clients.

## Features

- Real-time audio streaming using WebRTC
- Admin panel for managing client connections
- Audio visualization meter
- Mute/unmute functionality
- Volume control
- Simple and intuitive UI

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Access the application:
- Open `http://localhost:3000` in your browser
- Allow microphone access when prompted

## Usage

### As a Client
1. Open the application in your browser
2. Grant microphone permissions when prompted
3. Wait for an admin to establish a connection with another client
4. Use the mute button and volume slider to control audio

### As an Admin
1. Click "Login as Admin"
2. Enter the admin password (default: "admin123")
3. Select two clients from the dropdown menus
4. Click "Connect Selected Clients" to establish an audio connection

## Security Note
For production use, please:
1. Change the admin password in server.js
2. Implement proper authentication
3. Use HTTPS
4. Add additional security measures as needed
