import { randomUUID } from 'crypto';

// Meccha Chameleon Game Manager
// Implements the core gameplay: chicken (survivor) vs hunters asymmetric horror
// Based on reverse-engineered UE5 blueprints: BP_GameMode_cLeon, BPGI_Main, etc.

class GameSession {
  constructor(room, hostPlayerId) {
    this.id = randomUUID();
    this.room = room;
    this.hostPlayerId = hostPlayerId;
    this.players = new Map(); // playerId -> playerState
    this.phase = 'LOBBY';
    this.timer = null;
    this.chickenPhaseTimer = 90; // seconds
    this.hunterPhaseTimer = 60; // seconds
    this.currentTimer = this.chickenPhaseTimer;
    
    // Chicken/survivor state
    this.chickenPlayerId = null;
    this.chickenLocation = { x: 0, y: 0 };
    this.chickenVisible = true;
    this.chickenSearchTargets = [];
    this.chickenFoundCount = 0;
    
    // Hunter state
    this.hunterIds = [];
    this.hunterLocations = new Map();
    this.maxHunters = Math.min(3, room.players.length - 1);
    
    // Game world (simplified map grid)
    this.mapSize = 20;
    this.obstacles = [];
    this.searchItems = [];
    
    // Results
    this.winner = null;
    this.winnerRole = null;
    this.gameLog = [];
    
    this.lastUpdated = Date.now();
  }
  
  initializeGame() {
    // Assign chicken (survivor) - random player
    const playerIds = Array.from(this.players.keys());
    this.chickenPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
    
    // Place chicken at random location
    this.chickenLocation = {
      x: Math.floor(Math.random() * this.mapSize),
      y: Math.floor(Math.random() * this.mapSize)
    };
    
    // Select hunters via lottery (remaining players)
    const remaining = playerIds.filter(id => id !== this.chickenPlayerId);
    for (let i = 0; i < this.maxHunters && i < remaining.length; i++) {
      this.hunterIds.push(remaining[i]);
    }
    
    // Place hunters at different locations
    for (const hunterId of this.hunterIds) {
      let loc;
      do {
        loc = {
          x: Math.floor(Math.random() * this.mapSize),
          y: Math.floor(Math.random() * this.mapSize)
        };
      } while (loc.x === this.chickenLocation.x && loc.y === this.chickenLocation.y);
      
      this.hunterLocations.set(hunterId, loc);
    }
    
    // Generate search targets for chicken
    for (let i = 0; i < 5; i++) {
      this.chickenSearchTargets.push({
        x: Math.floor(Math.random() * this.mapSize),
        y: Math.floor(Math.random() * this.mapSize),
        found: false
      });
    }
    
    // Generate obstacles
    for (let i = 0; i < 15; i++) {
      this.obstacles.push({
        x: Math.floor(Math.random() * this.mapSize),
        y: Math.floor(Math.random() * this.mapSize)
      });
    }
    
    this.phase = 'CHICKEN';
    this.startTimer();
    this.log('Game started! Chicken phase begins.');
  }
  
  startTimer() {
    if (this.timer) clearInterval(this.timer);
    
    this.timer = setInterval(() => {
      this.currentTimer--;
      
      if (this.currentTimer <= 0) {
        if (this.phase === 'CHICKEN') {
          // Chicken phase ended - check win conditions
          if (this.chickenFoundCount >= this.chickenSearchTargets.length) {
            this.endGame('CHICKEN', 'Found all items before time ran out!');
          } else {
            // Transition to hunter phase
            this.phase = 'HUNTER';
            this.currentTimer = this.hunterPhaseTimer;
            this.log('Hunter phase begins!');
          }
        } else if (this.phase === 'HUNTER') {
          // Hunter phase ended - chicken survived
          this.endGame('CHICKEN', 'Survived until time ran out!');
        }
      }
      
      this.lastUpdated = Date.now();
    }, 1000);
  }
  
  processInput(playerId, input) {
    if (this.phase === 'ENDED') return;
    
    const player = this.players.get(playerId);
    if (!player) return;
    
    switch (input.type) {
      case 'move':
        this.handleMove(playerId, input);
        break;
      case 'search':
        this.handleSearch(playerId);
        break;
      case 'toggle_visibility':
        if (playerId === this.chickenPlayerId) {
          this.chickenVisible = !this.chickenVisible;
          this.log(`Chicken is now ${this.chickenVisible ? 'visible' : 'invisible'}`);
        }
        break;
      case 'teleport':
        if (this.hunterIds.includes(playerId)) {
          this.handleHunterTeleport(playerId);
        }
        break;
    }
  }
  
  handleMove(playerId, input) {
    const dx = input.dx || 0;
    const dy = input.dy || 0;
    
    if (playerId === this.chickenPlayerId) {
      let newX = this.chickenLocation.x + dx;
      let newY = this.chickenLocation.y + dy;
      
      // Check bounds
      newX = Math.max(0, Math.min(this.mapSize - 1, newX));
      newY = Math.max(0, Math.min(this.mapSize - 1, newY));
      
      // Check obstacles
      const obstacle = this.obstacles.find(o => o.x === newX && o.y === newY);
      if (!obstacle) {
        this.chickenLocation = { x: newX, y: newY };
        
        // Check if caught by hunter (only when visible)
        if (this.phase === 'HUNTER' && this.chickenVisible) {
          for (const [hunterId, loc] of this.hunterLocations) {
            if (loc.x === newX && loc.y === newY) {
              this.endGame('HUNTERS', `Caught by hunter ${hunterId.slice(0, 8)}!`);
              return;
            }
          }
        }
        
        // Check if reached search target
        const target = this.chickenSearchTargets.find(t => 
          t.x === newX && t.y === newY && !t.found
        );
        if (target) {
          target.found = true;
          this.chickenFoundCount++;
          this.log(`Chicken found item ${this.chickenFoundCount}/${this.chickenSearchTargets.length}`);
          
          // Check win condition
          if (this.chickenFoundCount >= this.chickenSearchTargets.length) {
            this.endGame('CHICKEN', 'Found all items!');
          }
        }
      }
    } else if (this.hunterIds.includes(playerId)) {
      let loc = this.hunterLocations.get(playerId);
      let newX = loc.x + dx;
      let newY = loc.y + dy;
      
      newX = Math.max(0, Math.min(this.mapSize - 1, newX));
      newY = Math.max(0, Math.min(this.mapSize - 1, newY));
      
      const obstacle = this.obstacles.find(o => o.x === newX && o.y === newY);
      if (!obstacle) {
        this.hunterLocations.set(playerId, { x: newX, y: newY });
        
        // Check if caught chicken (only when visible)
        if (this.phase === 'HUNTER' && this.chickenVisible) {
          if (newX === this.chickenLocation.x && newY === this.chickenLocation.y) {
            this.endGame('HUNTERS', `Caught chicken by hunter ${playerId.slice(0, 8)}!`);
          }
        }
      }
    }
  }
  
  handleSearch(playerId) {
    if (playerId !== this.chickenPlayerId) return;
    
    // Search reveals nearest unfound item direction
    const unfound = this.chickenSearchTargets.filter(t => !t.found);
    if (unfound.length === 0) return;
    
    // Find closest target
    let closest = null;
    let minDist = Infinity;
    for (const target of unfound) {
      const dist = Math.abs(target.x - this.chickenLocation.x) + 
                  Math.abs(target.y - this.chickenLocation.y);
      if (dist < minDist) {
        minDist = dist;
        closest = target;
      }
    }
    
    if (closest) {
      const dx = closest.x - this.chickenLocation.x;
      const dy = closest.y - this.chickenLocation.y;
      this.log(`Search: item is ${dx > 0 ? 'right' : dx < 0 ? 'left' : 'same row'} ${dy > 0 ? 'down' : dy < 0 ? 'up' : 'same col'}`);
    }
  }
  
  handleHunterTeleport(playerId) {
    // Hunter can teleport to chicken's last known location (with some randomness)
    if (!this.chickenVisible) return; // Can't teleport when chicken is invisible
    
    const offset = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
    const newX = this.chickenLocation.x + offset;
    const newY = this.chickenLocation.y + offset;
    
    const clampedX = Math.max(0, Math.min(this.mapSize - 1, newX));
    const clampedY = Math.max(0, Math.min(this.mapSize - 1, newY));
    
    this.hunterLocations.set(playerId, { x: clampedX, y: clampedY });
    this.log(`Hunter ${playerId.slice(0, 8)} teleported near chicken`);
    
    // Check if caught
    if (clampedX === this.chickenLocation.x && clampedY === this.chickenLocation.y) {
      this.endGame('HUNTERS', `Caught by teleport! Hunter ${playerId.slice(0, 8)}!`);
    }
  }
  
  endGame(winnerRole, reason) {
    if (this.phase === 'ENDED') return;
    
    clearInterval(this.timer);
    this.phase = 'ENDED';
    this.winner = winnerRole;
    this.winnerRole = winnerRole;
    this.log(`GAME OVER: ${winnerRole} wins! ${reason}`);
  }
  
  log(message) {
    this.gameLog.push({ time: Date.now(), message });
    if (this.gameLog.length > 50) {
      this.gameLog.shift();
    }
  }
  
  getState() {
    return {
      id: this.id,
      phase: this.phase,
      timer: this.currentTimer,
      chickenPlayerId: this.chickenPlayerId,
      hunterIds: this.hunterIds,
      chickenLocation: this.phase !== 'LOBBY' ? this.chickenLocation : null,
      hunterLocations: this.phase !== 'LOBBY' ? Object.fromEntries(this.hunterLocations) : {},
      chickenVisible: this.chickenVisible,
      searchTargetsFound: this.chickenFoundCount,
      searchTargetsTotal: this.chickenSearchTargets.length,
      mapSize: this.mapSize,
      obstacles: this.obstacles,
      winner: this.winner,
      winnerRole: this.winnerRole,
      log: this.gameLog.slice(-10),
      lastUpdated: this.lastUpdated
    };
  }
  
  cleanup() {
    if (this.timer) clearInterval(this.timer);
  }
}

class GameManager {
  constructor() {
    this.sessions = new Map();
    
    // Clean up old sessions periodically
    setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (now - session.lastUpdated > 300000) { // 5 minutes idle
          session.cleanup();
          this.sessions.delete(id);
        }
      }
    }, 60000);
  }
  
  createSession(room, hostPlayerId) {
    const session = new GameSession(room, hostPlayerId);
    
    // Add all players to session
    for (const player of room.players) {
      session.players.set(player.id, { id: player.id, name: player.name });
    }
    
    this.sessions.set(session.id, session);
    
    // Initialize game after brief delay
    setTimeout(() => {
      session.initializeGame();
    }, 2000);
    
    return session;
  }
  
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
}

export { GameManager, GameSession };