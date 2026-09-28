import express from 'express';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Game state management for actual browser game (not streaming)
import { GameManager } from './game-manager.js';
const gameManager = new GameManager();

// Configuration
const PORT = process.env.PORT || 8080;
const MAX_PLAYERS_PER_ROOM = parseInt(process.env.MAX_PLAYERS || '8');
const ROOM_CODE_LENGTH = 6;

// Small persistent profile store. Replace with a shared database for production deployment.
const dataDir = path.join(__dirname, '..', 'data');
const profilePath = path.join(dataDir, 'players.json');
fs.mkdirSync(dataDir, { recursive: true });
let profiles = fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, 'utf8')) : [];

function saveProfiles() {
  const tempPath = `${profilePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(profiles, null, 2));
  fs.renameSync(tempPath, profilePath);
}

function findProfile(id) {
  return profiles.find(profile => profile.id === id);
}

// In-memory room state
const rooms = new Map();

function publicRoom(room) {
  return {
    id: room.id,
    code: room.code,
    hostId: room.hostId,
    players: room.players,
    state: room.state,
    maxPlayers: room.maxPlayers,
    createdAt: room.createdAt
  };
}

function broadcastRoom(room) {
  const message = JSON.stringify({ type: 'room_state', ...publicRoom(room) });
  for (const socket of room.sockets ?? []) {
    if (socket.readyState === 1) socket.send(message);
  }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateDisplayName() {
  const suffixes = ['Penguin', 'Chef', 'Waiter', 'Guest', 'Manager', 'Bartender'];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `Player-${num}-${suffix}`;
}

function createPlayerProfile() {
  const id = randomUUID();
  let displayName = generateDisplayName();
  
  // Ensure unique display name
  while (profiles.some(profile => profile.displayName === displayName)) {
    displayName = generateDisplayName();
  }
  
  const profile = {
    id,
    displayName,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  };
  profiles.push(profile);
  saveProfiles();
  return profile;
}

// Express app for HTTP endpoints
const app = express();
app.use(express.json());

// Serve web client
app.use(express.static(path.join(__dirname, '..', 'web')));

// API: Create player profile
app.post('/api/profile', (req, res) => {
  const profile = createPlayerProfile();
  res.json(profile);
});

// API: Get player profile by ID
app.get('/api/profile/:id', (req, res) => {
  const player = findProfile(req.params.id);
  if (player) {
    res.json(player);
  } else {
    res.status(404).json({ error: 'Player not found' });
  }
});

// API: Get locally selected profiles. The browser owns the profile list.
app.get('/api/profiles', (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (ids.length === 0) return res.json([]);

  const placeholders = ids.map(() => '?').join(',');
  res.json(ids.map(findProfile).filter(Boolean));
});

// API: Create multiplayer room
app.post('/api/room', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'playerId required' });
  }
  
  // Verify player exists
  const player = findProfile(playerId);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  
  // Generate unique room code
  let roomCode;
  do {
    roomCode = generateRoomCode();
  } while (rooms.has(roomCode));
  
  const roomId = randomUUID();
  
  rooms.set(roomCode, {
    id: roomId,
    code: roomCode,
    hostId: playerId,
    players: [{ id: playerId, name: player.displayName }],
    state: 'WAITING',
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    createdAt: Date.now()
  });
  
  res.json(publicRoom(rooms.get(roomCode)));
});

// API: Join room by code
app.post('/api/room/join', (req, res) => {
  const { roomCode, playerId } = req.body;
  
  if (!roomCode || !playerId) {
    return res.status(400).json({ error: 'roomCode and playerId required' });
  }
  
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  if (room.state !== 'WAITING') {
    return res.status(400).json({ error: 'Room is not waiting for players' });
  }
  
  if (room.players.length >= room.maxPlayers) {
    return res.status(400).json({ error: 'Room is full' });
  }
  
  // Check player already in room
  const existing = room.players.find(p => p.id === playerId);
  if (existing) {
    return res.json(publicRoom(room));
  }
  
  const player = findProfile(playerId);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  
  room.players.push({ id: playerId, name: player.displayName });
  broadcastRoom(room);
  res.json(publicRoom(room));
});

// API: Get room info
app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (room) {
    res.json(publicRoom(room));
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

// API: Leave room
app.post('/api/room/:code/leave', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const idx = room.players.findIndex(p => p.id === req.body.playerId);
  if (idx !== -1) {
    room.players.splice(idx, 1);
    
    // If host left and others remain, transfer host
    if (room.hostId === req.body.playerId && room.players.length > 0) {
      room.hostId = room.players[0].id;
    }
    
    // Clean up empty rooms
    if (room.players.length === 0) {
      rooms.delete(req.params.code.toUpperCase());
    } else {
      broadcastRoom(room);
    }
  }
  
  res.json(publicRoom(room));
});

// Game session endpoints - authoritative server-side game state
app.post('/api/room/:code/start', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  if (room.hostId !== req.body.playerId) {
    return res.status(403).json({ error: 'Only host can start the game' });
  }
  
  // Initialize actual game session
  const session = gameManager.createSession(room, req.body.playerId);
  room.state = 'IN_GAME';
  room.gameSession = session;
  broadcastRoom(room);
  res.json({ ...publicRoom(room), sessionId: session.id });
});

// Get game state for a player
app.get('/api/game/:sessionId/state', (req, res) => {
  const session = gameManager.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Game session not found' });
  }
  res.json(session.getState());
});

// Send player input to game
app.post('/api/game/:sessionId/input', (req, res) => {
  const session = gameManager.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Game session not found' });
  }
  session.processInput(req.body.playerId, req.body);
  res.json({ ok: true });
});

// End game session
app.post('/api/game/:sessionId/end', (req, res) => {
  const session = gameManager.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Game session not found' });
  }
  const result = session.endGame();
  
  // Update room state
  for (const [code, room] of rooms) {
    if (room.gameSession?.id === req.params.sessionId) {
      room.state = 'ENDED';
      broadcastRoom(room);
      break;
    }
  }
  
  res.json(result);
});

// WebSocket server for real-time multiplayer
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const playerId = url.searchParams.get('playerId');
  const roomCode = url.searchParams.get('roomCode');
  
  if (!playerId || !roomCode) {
    ws.close();
    return;
  }
  
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) {
    ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
    ws.close();
    return;
  }

  if (!room.players.some(player => player.id === playerId)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Player is not a member of this room' }));
    ws.close();
    return;
  }
  
  // Add to room's WebSocket connections
  if (!room.sockets) {
    room.sockets = [];
  }
  room.sockets.push(ws);
  
  // Send current room state
  ws.send(JSON.stringify({
    type: 'room_state',
    ...publicRoom(room)
  }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Broadcast game input to all players in room
      if (data.type === 'input' && room.state === 'IN_GAME') {
        room.sockets.forEach(socket => {
          if (socket !== ws && socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'remote_input',
              playerId,
              data: data.data
            }));
          }
        });
      }
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });
  
  ws.on('close', () => {
    const idx = room.sockets.indexOf(ws);
    if (idx !== -1) {
      room.sockets.splice(idx, 1);
    }

    const playerIndex = room.players.findIndex(player => player.id === playerId);
    if (playerIndex !== -1) {
      room.players.splice(playerIndex, 1);
      if (room.hostId === playerId && room.players.length > 0) {
        room.hostId = room.players[0].id;
      }
      if (room.players.length === 0) {
        rooms.delete(room.code);
        return;
      }
      broadcastRoom(room);
    }
    
    // Notify other players
    room.sockets.forEach(socket => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({
          type: 'player_left',
          playerId
        }));
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`[SERVER] Running on port ${PORT}`);
  console.log(`[SERVER] Max players per room: ${MAX_PLAYERS_PER_ROOM}`);
});
