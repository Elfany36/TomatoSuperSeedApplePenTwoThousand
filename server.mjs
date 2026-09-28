
import express from "express";
import { createServer as createHttpServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  WORLD_BOUNDS,
  SURFACES,
  PLAYER_SPAWNS,
  pointAabbDistance,
  colorSimilarity
} from "./public/world.js";

export const CONFIG = {
  PORT: Number(process.env.PORT || 3000),
  MAX_PLAYERS: 10,
  MIN_PLAYERS: 2,
  SETUP_MS: Number(process.env.SETUP_MS || 22000),
  SEARCH_MS: Number(process.env.SEARCH_MS || 90000),
  RESULTS_MS: Number(process.env.RESULTS_MS || 7000),
  RECONNECT_MS: Number(process.env.RECONNECT_MS || 20000),
  TICK_MS: 50,
  BROADCAST_MS: 100
};

const MOVE_SPEED = 4.2;
const PLAYER_RADIUS = 0.62;
const SPOT_RANGE = 7.0;
const SPOT_COOLDOWN_MS = 650;
const STEP_INTERVAL_MS = 420;
const MAX_CLONES = 2;
const TAUNT_COOLDOWN_MS = 1800;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_PER_SEC = 30;
const STAMINA_REGEN_PER_SEC = 22;
const ACCELERATION = 15;
const DECELERATION = 22;
const SPOT_HALF_FOV = 35 * Math.PI / 180;
const SPOT_MIN_DOT = Math.cos(SPOT_HALF_FOV);
const MAP_IDS = ["grove","backrooms","gallery","restaurant","supermarket","hotel","sewer","city","farm"];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const now = () => Date.now();

export function sanitizeName(value) {
  const clean = String(value ?? "Player")
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .trim()
    .slice(0, 18);
  return clean || "Player";
}

export function makeRoomCode(rooms) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += alphabet[randomBytes(1)[0] % alphabet.length];
    }
  } while (rooms.has(code));
  return code;
}

function rgbBlendScore(color, x, z) {
  let best = { score: 8, id: null, distance: Infinity };
  for (const surface of SURFACES) {
    if (surface.kind === "ground") continue;
    const d = pointAabbDistance(x, z, surface);
    const distanceFactor = Math.max(0, 1 - d / 7);
    const colorFactor = colorSimilarity(color, surface.color);
    const score = Math.round((colorFactor * 0.78 + distanceFactor * 0.22) * 100);
    if (score > best.score) {
      best = { score, id: surface.id, distance: d };
    }
  }
  const floorColor = colorSimilarity(color, "#79C86A");
  const floorScore = Math.round(floorColor * 88);
  return floorScore > best.score ? { score: floorScore, id: "floor", distance: 0 } : best;
}

function aabbContainsSegment(item, ax, az, bx, bz, padding = 0) {
  const minX = item.x - item.w * 0.5 - padding;
  const maxX = item.x + item.w * 0.5 + padding;
  const minZ = item.z - item.d * 0.5 - padding;
  const maxZ = item.z + item.d * 0.5 + padding;
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, ax - minX) &&
    clip(dx, maxX - ax) &&
    clip(-dz, az - minZ) &&
    clip(dz, maxZ - az)
  );
}

function hasLineOfSight(ax, az, bx, bz) {
  for (const surface of SURFACES) {
    if (surface.kind === "ground") continue;
    if (aabbContainsSegment(surface, ax, az, bx, bz, 0.1)) return false;
  }
  return true;
}

function collides(x, z) {
  if (x < WORLD_BOUNDS.minX + PLAYER_RADIUS || x > WORLD_BOUNDS.maxX - PLAYER_RADIUS) return true;
  if (z < WORLD_BOUNDS.minZ + PLAYER_RADIUS || z > WORLD_BOUNDS.maxZ - PLAYER_RADIUS) return true;
  return SURFACES.some(surface =>
    surface.kind !== "ground" &&
    pointAabbDistance(x, z, surface) < PLAYER_RADIUS
  );
}

function roundedPlayers(players) {
  return players.map(p => ({
    id: p.id,
    name: p.name,
    role: p.role,
    score: p.score,
    connected: p.connected,
    found: p.found,
    pose: p.pose,
    color: p.color,
    blendScore: p.blendScore,
    x: Number(p.x.toFixed(3)),
    z: Number(p.z.toFixed(3)),
    yaw: Number(p.yaw.toFixed(3))
  }));
}

export class GameRoom {
  constructor(code, isPublic) {
    this.code = code;
    this.public = !!isPublic;
    this.hostId = null;
    this.players = new Map();
    this.phase = "lobby";
    this.round = 0;
    this.roundId = null;
    this.completed = false;
    this.winnerRole = null;
    this.endReason = null;
    this.endAt = 0;
    this.roundStartedAt = 0;
    this.endedAt = null;
    this.roundStats = [];
    this.lastBroadcast = 0;
    this.createdAt = now();
    this.joinCounter = 0;
    this.roundReason = "";
    this.mapId = "grove";
  }

  activePlayers() {
    return [...this.players.values()].filter(p => p.connected || (now() - p.disconnectedAt < CONFIG.RECONNECT_MS));
  }

  connectedPlayers() {
    return [...this.players.values()].filter(p => p.connected);
  }

  addPlayer(player) {
    if (this.players.size >= CONFIG.MAX_PLAYERS && !this.players.has(player.id)) {
      throw new Error("Room full");
    }
    if (!this.hostId) this.hostId = player.id;
    player.roomCode = this.code;
    player.joinOrder = ++this.joinCounter;
    player.disconnectedAt = 0;
    player.connected = true;
    this.players.set(player.id, player);
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return false;
    this.players.delete(id);
    if (this.hostId === id) {
      this.hostId = this.connectedPlayers()[0]?.id ?? this.players.keys().next().value ?? null;
    }
    if (this.players.size < CONFIG.MIN_PLAYERS && this.phase !== "lobby") {
      if (this.phase === "search") {
        this.finish("hiders", "Round stopped because the room fell below two players.");
      } else {
        this.phase = "lobby";
        this.roundId = null;
        this.completed = false;
        this.winnerRole = null;
        this.endReason = null;
        this.roundStats = [];
        this.roundReason = "";
        this.endAt = 0;
      }
    }
    return true;
  }

  startRound() {
    const players = this.activePlayers();
    if (players.length < CONFIG.MIN_PLAYERS) throw new Error("Need at least 2 players");
    if (this.phase !== "lobby" && this.phase !== "results") throw new Error("Round already running");
    this.round += 1;
    this.roundId = randomUUID();
    if (!MAP_IDS.includes(this.mapId)) this.mapId = MAP_IDS[0];
    this.completed = false;
    this.winnerRole = null;
    this.endReason = null;
    this.endedAt = null;
    const seekerCount = Math.max(1, Math.floor(players.length / 4));
    const ordered = players.slice().sort((a, b) => a.joinOrder - b.joinOrder);
    const offset = (this.round - 1) % ordered.length;
    const rotated = ordered.slice(offset).concat(ordered.slice(0, offset));
    const seekers = new Set(rotated.slice(0, seekerCount).map(p => p.id));

    const spawns = PLAYER_SPAWNS.slice();
    for (let i = spawns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
    }

    players.forEach((p, index) => {
      p.role = seekers.has(p.id) ? "seeker" : "hider";
      p.found = false;
      p.color = "#FFFFFF";
      p.pose = "stand";
      p.brushSize = 1;
      p.paintCoverage = 0;
      p.input = { x: 0, z: 0, sprint: false };
      p.velocity = { x: 0, z: 0 };
      p.stamina = STAMINA_MAX;
      p.lastInputAt = now();
      p.lastSpotAt = 0;
      p.lastAbilityAt = 0;
      p.lastStepAt = 0;
      p.revealedUntil = 0;
      p.frozenUntil = 0;
      p.attached = false;
      p.clones = [];
      p.metallic = 0.03;
      p.roughness = 0.86;
      p.pattern = "solid";
      p.yaw = p.role === "seeker" ? Math.PI : 0;
      const spawn = spawns[index % spawns.length];
      p.x = p.role === "seeker" ? spawn[0] * 0.55 : spawn[0] * 0.88;
      p.z = p.role === "seeker" ? 13.2 : spawn[1] * 0.72;
      p.blendScore = rgbBlendScore(p.color, p.x, p.z).score;
    });

    this.phase = "setup";
    this.roundStartedAt = now();
    this.endAt = this.roundStartedAt + CONFIG.SETUP_MS;
    this.roundStats = [];
    this.roundReason = "";

  }

  setMap(mapId) {
    if (this.phase !== "lobby") return { ok: false, reason: "round_running" };
    const id = String(mapId || "").toLowerCase();
    if (!MAP_IDS.includes(id)) return { ok: false, reason: "unknown_map" };
    this.mapId = id;
    return { ok: true, mapId: id };
  }

  transitionToSearch() {
    this.phase = "search";
    this.endAt = now() + CONFIG.SEARCH_MS;
    for (const p of this.players.values()) {
      if (p.role === "seeker") {
        const lane = [...this.players.values()].filter(x => x.role === "seeker").indexOf(p);
        p.x = lane === 0 ? -3.5 : 3.5;
        p.z = 13.0;
        p.input = { x: 0, z: 0 };
        p.yaw = -Math.PI;
      }
    }
  }

  finish(winnerRole, reason) {
    if (this.phase !== "search" || this.completed) return;
    this.completed = true;
    this.winnerRole = winnerRole;
    this.endReason = reason;
    this.endedAt = now();
    const hiders = [...this.players.values()].filter(p => p.role === "hider");
    const seekers = [...this.players.values()].filter(p => p.role === "seeker");
    const roundStats = [];

    for (const p of hiders) {
      const survived = !p.found;
      const camouflageBonus = survived ? Math.floor(p.blendScore / 34) : 0;
      const delta = survived ? 5 + camouflageBonus : 0;
      p.score += delta;
      roundStats.push({
        id: p.id,
        name: p.name,
        role: p.role,
        delta,
        detail: survived ? "Survived" : "Spotted"
      });
    }
    for (const p of seekers) {
      const foundCount = hiders.filter(h => h.found).length;
      const delta = foundCount === hiders.length ? Math.max(0, foundCount * 3) : foundCount * 3;
      p.score += delta;
      roundStats.push({
        id: p.id,
        name: p.name,
        role: p.role,
        delta,
        detail: foundCount + " hider" + (foundCount === 1 ? "" : "s") + " found"
      });
    }

    this.roundStats = roundStats;
    this.phase = "results";
    this.endAt = now() + CONFIG.RESULTS_MS;
    this.roundReason = reason;
  }

  checkWinConditions() {
    const hiders = [...this.players.values()].filter(p => p.role === "hider");
    if (hiders.length && hiders.every(p => p.found)) {
      this.finish("seekers", "Every hider was spotted.");
    } else if (this.phase === "search" && now() >= this.endAt) {
      this.finish("hiders", "The search timer expired.");
    }
  }

  update(dt) {
    if (this.phase !== "setup" && this.phase !== "search") return [];
    const steps = [];
    const timestamp = now();
    for (const p of this.players.values()) {
      if (!p.connected) {
        p.input = { x: 0, z: 0, sprint: false };
        p.velocity.x = 0; p.velocity.z = 0;
        continue;
      }
      if (timestamp - p.lastInputAt > 350) p.input = { x: 0, z: 0, sprint: false };
      if (this.phase === "setup" && p.role === "seeker") p.input = { x: 0, z: 0, sprint: false };
      if (p.attached && p.input.sprint) {
        p.attached = false;
        p.pose = "stand";
      }
      const disabled = p.attached || p.frozenUntil > timestamp;
      if (disabled) p.input = { x: 0, z: 0, sprint: false };

      const ix = clamp(p.input.x, -1, 1);
      const iz = clamp(p.input.z, -1, 1);
      const len = Math.hypot(ix, iz) || 1;
      const movingInput = !disabled && (Math.abs(ix) + Math.abs(iz) > .01);
      const requestedSprint = movingInput && p.input.sprint && p.pose === "stand" && p.stamina > 0;
      if (requestedSprint) p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN_PER_SEC * dt);
      else p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN_PER_SEC * dt);

      const poseMult = p.pose === "curl" ? .48 : p.pose === "crouch" ? .62 : p.pose === "freeze" ? 0 : 1;
      const sprintMult = requestedSprint ? 1.42 : 1;
      const speed = MOVE_SPEED * poseMult * sprintMult;
      const targetVX = movingInput ? ix / len * speed : 0;
      const targetVZ = movingInput ? iz / len * speed : 0;
      const rate = movingInput ? ACCELERATION : DECELERATION;
      const blend = Math.min(1, rate * dt);
      p.velocity.x += (targetVX - p.velocity.x) * blend;
      p.velocity.z += (targetVZ - p.velocity.z) * blend;

      if (Math.abs(p.velocity.x) + Math.abs(p.velocity.z) > .001) {
        const nx = p.x + p.velocity.x * dt;
        const nz = p.z + p.velocity.z * dt;
        if (!collides(nx, p.z)) p.x = nx; else p.velocity.x = 0;
        if (!collides(p.x, nz)) p.z = nz; else p.velocity.z = 0;
        p.blendScore = rgbBlendScore(p.color, p.x, p.z).score;
      } else {
        p.velocity.x = 0; p.velocity.z = 0;
      }

      if (this.phase === "search" && p.role === "hider" && timestamp - p.lastStepAt >= STEP_INTERVAL_MS && Math.abs(p.velocity.x) + Math.abs(p.velocity.z) > .2) {
        p.lastStepAt = timestamp;
        const sprintNoise = requestedSprint ? 1.35 : 1;
        const postureNoise = p.pose === "crouch" ? .62 : 1;
        steps.push({ id: p.id, x: p.x, z: p.z, strength: Math.max(.16, Math.min(1, (1 - p.blendScore / 140) * sprintNoise * postureNoise)) });
      }
    }
    return steps;
  }

  spot(seekerId,targetId){
    const seeker=this.players.get(seekerId);
    if(!seeker) return {ok:false,reason:"missing"};
    if(this.phase!=="search"||seeker.role!=="seeker") return {ok:false,reason:"phase"};
    if(now()-seeker.lastSpotAt<SPOT_COOLDOWN_MS) return {ok:false,reason:"cooldown"};
    seeker.lastSpotAt=now();

    const raw=String(targetId||"");
    if(raw.startsWith("clone:")){
      const cloneId=raw.slice(6);
      for(const owner of this.players.values()){
        const index=(owner.clones||[]).findIndex(clone=>clone.id===cloneId);
        if(index<0) continue;
        const clone=owner.clones[index];
        const dx=clone.x-seeker.x,dz=clone.z-seeker.z,distance=Math.hypot(dx,dz);
        if(distance>SPOT_RANGE||!hasLineOfSight(seeker.x,seeker.z,clone.x,clone.z)) return {ok:false,reason:"out_of_range",x:clone.x,z:clone.z};
        const forwardX=Math.sin(seeker.yaw),forwardZ=Math.cos(seeker.yaw);
        const dot=(dx*forwardX+dz*forwardZ)/(distance||1);
        if(dot<SPOT_MIN_DOT) return {ok:false,reason:"wrong_direction",x:clone.x,z:clone.z};
        owner.clones.splice(index,1);
        seeker.score+=1;
        return {ok:true,x:clone.x,z:clone.z,targetId:raw,clone:true};
      }
      return {ok:false,reason:"missing"};
    }

    const target=this.players.get(raw);
    if(!target) return {ok:false,reason:"missing"};
    if(target.role!=="hider"||target.found) return {ok:false,reason:"target"};
    const dx=target.x-seeker.x,dz=target.z-seeker.z,distance=Math.hypot(dx,dz);
    if(distance>SPOT_RANGE||!hasLineOfSight(seeker.x,seeker.z,target.x,target.z)) return {ok:false,reason:"out_of_range",x:target.x,z:target.z};
    const forwardX=Math.sin(seeker.yaw),forwardZ=Math.cos(seeker.yaw);
    const dot=(dx*forwardX+dz*forwardZ)/(distance||1);
    if(dot<SPOT_MIN_DOT) return {ok:false,reason:"wrong_direction",x:target.x,z:target.z};
    target.found=true;
    seeker.score+=3;
    this.checkWinConditions();
    return {ok:true,x:target.x,z:target.z,targetId:target.id};
  }

  customize(playerId, msg) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== "setup" || p.role !== "hider") return { ok: false, reason: "not_allowed" };
    if (typeof msg.color === "string" && /^#[0-9a-f]{6}$/i.test(msg.color)) p.color = msg.color.toUpperCase();
    if (["stand", "crouch", "curl", "freeze", "prone", "wallflat", "lean", "backbend", "slant", "tpose", "armsup", "armsfwd", "legsout", "star", "starfish", "lieflat", "ball", "sit"].includes(msg.pose)) {
      p.pose = msg.pose;
      p.frozenUntil = msg.pose === "freeze" ? now() + 2200 : 0;
      p.attached = msg.pose === "wallflat";
    }
    if (Number.isFinite(Number(msg.brushSize))) p.brushSize = clamp(Math.round(Number(msg.brushSize)), 1, 5);
    if (Number.isFinite(Number(msg.metallic))) p.metallic = clamp(Number(msg.metallic), 0, 1);
    if (Number.isFinite(Number(msg.roughness))) p.roughness = clamp(Number(msg.roughness), 0.05, 1);
    if (["solid","edge","dither","bands"].includes(msg.pattern)) p.pattern = msg.pattern;
    const surfaceId=String(msg.surfaceId||"");
    const isPaintStroke = typeof msg.color === "string" &&
      (surfaceId === "floor" || SURFACES.some(s => s.id === surfaceId) || surfaceId.startsWith("asset:"));
    if (isPaintStroke) {
      const gain = [0, 0.06, 0.10, 0.15, 0.20, 0.26][p.brushSize] || 0.10;
      p.paintCoverage = clamp(p.paintCoverage + gain, 0, 1);
    }
    p.blendScore = rgbBlendScore(p.color, p.x, p.z).score;
    const sample = SURFACES.find(s => s.id === msg.surfaceId);
    return { ok: true, color: p.color, pose: p.pose, brushSize: p.brushSize, paintCoverage: p.paintCoverage, surface: sample?.name ?? "Painted" };
  }

  createClone(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== "setup" || p.role !== "hider") return { ok: false, reason: "not_allowed" };
    p.clones = p.clones || [];
    if (p.clones.length >= MAX_CLONES) return { ok: false, reason: "limit" };
    const angles = [p.yaw - Math.PI / 2, p.yaw + Math.PI / 2, p.yaw + Math.PI, p.yaw];
    let spawn = null;
    for (const angle of angles) {
      const x = clamp(p.x + Math.sin(angle) * 1.35, WORLD_BOUNDS.minX + 1, WORLD_BOUNDS.maxX - 1);
      const z = clamp(p.z + Math.cos(angle) * 1.35, WORLD_BOUNDS.minZ + 1, WORLD_BOUNDS.maxZ - 1);
      if (!collides(x,z)) { spawn={x,z}; break; }
    }
    if (!spawn) return { ok: false, reason: "blocked" };
    const clone = {
      id: randomUUID(),
      ownerId: p.id,
      x: spawn.x,
      z: spawn.z,
      yaw: p.yaw,
      color: p.color,
      pose: p.pose,
      brushSize: p.brushSize,
      metallic: p.metallic,
      roughness: p.roughness,
      pattern: p.pattern
    };
    p.clones.push(clone);
    return { ok: true, clone };
  }

  deleteClones(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.role !== "hider") return { ok: false, reason: "not_allowed" };
    p.clones = [];
    return { ok: true };
  }

  allClones() {
    return [...this.players.values()].flatMap(p => (p.clones || []).map(clone => ({ ...clone, role: "hider", found: false })));
  }

  aiCoach(viewerId) {
    const p=this.players.get(viewerId);
    if(!p) return {mode:"observer",title:"AI DIRECTOR",hint:"Join the round to receive adaptive coaching.",confidence:1};
    if(this.phase==="setup" && p.role==="hider"){
      if(p.blendScore<45) return {mode:"hide",title:"CAMOUFLAGE COACH",hint:"Blend is strong. Reduce movement and choose a matching surface.",confidence:.92};
      const nearby=SURFACES.filter(s=>s.kind!=="ground").map(s=>({s,d:pointAabbDistance(p.x,p.z,s)})).sort((a,b)=>a.d-b.d)[0];
      if(nearby && nearby.d<8) return {mode:"paint",title:"CAMOUFLAGE COACH",hint:"Paint toward the nearby "+nearby.s.id.replace(/[-_]/g," ")+" palette, then try a low-profile pose.",confidence:.86};
      return {mode:"paint",title:"CAMOUFLAGE COACH",hint:"Find cover, sample its color, then increase paint coverage.",confidence:.8};
    }
    if(this.phase==="search" && p.role==="hider"){
      if(p.found) return {mode:"danger",title:"AI DIRECTOR",hint:"You have been revealed. Break line of sight and relocate.",confidence:.98};
      if(p.blendScore>=70) return {mode:"hide",title:"AI DIRECTOR",hint:"Camouflage is currently favorable. Freeze when a seeker approaches.",confidence:.9};
      return {mode:"move",title:"AI DIRECTOR",hint:"Your contrast is high. Repaint or relocate before moving.",confidence:.82};
    }
    if(this.phase==="search" && p.role==="seeker"){
      const found=[...this.players.values()].filter(h=>h.role==="hider"&&h.found).length;
      const total=[...this.players.values()].filter(h=>h.role==="hider").length;
      if(found===0) return {mode:"scan",title:"AI HUNT COACH",hint:"Use Scan Pulse, then follow confirmed line-of-sight targets.",confidence:.88};
      if(found<total) return {mode:"hunt",title:"AI HUNT COACH",hint:"Sweep intersections and listen for footsteps; do not tag through cover.",confidence:.84};
      return {mode:"clear",title:"AI HUNT COACH",hint:"All hiders are revealed. Confirm the remaining targets.",confidence:.96};
    }
    return {mode:"ready",title:"AI DIRECTOR",hint:"Prepare for the next phase.",confidence:.7};
  }

  stateFor(viewerId) {
    const viewer = this.players.get(viewerId);
    const players = [...this.players.values()].map(p => {
      const base = {
        id: p.id,
        name: p.name,
        role: p.role,
        score: p.score,
        connected: p.connected,
        found: p.found,
        pose: p.pose,
        color: p.color,
        blendScore: p.blendScore,
        brushSize: p.brushSize,
        metallic: p.metallic,
        roughness: p.roughness,
        pattern: p.pattern,
        paintCoverage: p.paintCoverage,
        stamina: Math.round(p.stamina)
      };
      const revealAll = this.phase === "results" || this.phase === "lobby";
      const revealSelf = viewerId === p.id;
      const revealTeam = viewer && viewer.role === p.role;
      let revealSearchTarget = false;
      if (this.phase === "search" && viewer?.role === "seeker" && p.role === "hider") {
        if (p.found || p.revealedUntil > now()) {
          revealSearchTarget = true;
        } else {
          const distance = Math.hypot(p.x - viewer.x, p.z - viewer.z);
          revealSearchTarget = distance <= 10 && hasLineOfSight(viewer.x, viewer.z, p.x, p.z);
        }
      }
      if (revealAll || revealSelf || revealTeam || revealSearchTarget) {
        return { ...base, x: p.x, z: p.z, yaw: p.yaw };
      }
      if (viewer?.role === "seeker" && p.role === "hider") {
        return { ...base, color: null, blendScore: null, brushSize: null, paintCoverage: null, pose: null, x: null, z: null, yaw: 0 };
      }
      return { ...base, x: null, z: null, yaw: 0 };
    });

    const clones = this.allClones().map(clone => {
      const owner = this.players.get(clone.ownerId);
      const revealSelf = viewerId === clone.ownerId;
      const revealAll = this.phase === "results" || this.phase === "lobby";
      const revealSearch = this.phase === "search" && viewer?.role === "seeker" &&
        owner && hasLineOfSight(viewer.x, viewer.z, clone.x, clone.z) &&
        Math.hypot(viewer.x - clone.x, viewer.z - clone.z) <= 10;
      return {
        id: "clone:" + clone.id,
        ownerId: clone.ownerId,
        role: "hider",
        color: clone.color,
        pose: clone.pose,
        brushSize: clone.brushSize,
        metallic: clone.metallic,
        roughness: clone.roughness,
        pattern: clone.pattern,
        x: revealSelf || revealAll || revealSearch ? clone.x : null,
        z: revealSelf || revealAll || revealSearch ? clone.z : null,
        yaw: clone.yaw
      };
    });

    return {
      code: this.code,
      public: this.public,
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      roundId: this.roundId,
      completed: this.completed,
      winner: this.winnerRole,
      endReason: this.endReason,
      startedAt: this.roundStartedAt || null,
      endedAt: this.endedAt,
      leftMs: Math.max(0, this.endAt - now()),
      players,
      clones,
      roundStats: this.roundStats,
      winnerRole: this.phase === "results"
        ? ([...this.roundStats].some(s => s.role === "hider" && s.delta > 0) ? "hiders" : "seekers")
        : null,
      reason: this.roundReason,
      mapId: this.mapId,
      aiCoach: this.aiCoach(viewerId)
    };
  }
}

export class GameManager {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.rooms = new Map();
    this.connections = new Map();
  }

  makePlayer(id, name) {
    return {
      id,
      name: sanitizeName(name),
      roomCode: null,
      role: "hider",
      score: 0,
      x: 0,
      z: 12,
      yaw: 0,
      color: "#FFFFFF",
      pose: "stand",
      brushSize: 1,
      paintCoverage: 0,
      blendScore: 8,
      found: false,
      revealedUntil: 0,
      frozenUntil: 0,
      connected: false,
      disconnectedAt: 0,
      joinOrder: 0,
      ws: null,
      input: { x: 0, z: 0, sprint: false },
      velocity: { x: 0, z: 0 },
      stamina: STAMINA_MAX,
      lastInputAt: 0,
      lastSpotAt: 0,
      lastAbilityAt: 0,
      lastStepAt: 0,
      metallic: 0.03,
      roughness: 0.86,
      pattern: "solid",
      attached: false,
      clones: []
    };
  }

  findPlayer(id) {
    for (const room of this.rooms.values()) {
      const player = room.players.get(id);
      if (player) return player;
    }
    return null;
  }

  createRoom(name, isPublic, existingId = null) {
    const player = existingId
      ? (this.findPlayer(existingId) || [...this.connections.values()].find(p => p.id === existingId))
      : null;
    if (existingId && !player) throw new Error("Player not found");
    const id = existingId || randomUUID();
    const p = player || this.makePlayer(id, name);
    const room = new GameRoom(makeRoomCode(this.rooms), isPublic);
    room.addPlayer(p);
    this.rooms.set(room.code, room);
    return { room, player: p };
  }

  joinRoom(code, name, clientId) {
    const room = this.rooms.get(String(code || "").toUpperCase());
    if (!room) throw new Error("Room not found");
    const existing = room.players.get(clientId);
    if (existing) {
      existing.name = sanitizeName(name || existing.name);
      existing.connected = true;
      existing.disconnectedAt = 0;
      return { room, player: existing, reconnected: true };
    }
    if (room.players.size >= this.config.MAX_PLAYERS) throw new Error("Room full");
    if (room.phase !== "lobby") throw new Error("Round already in progress");
    const player = this.makePlayer(clientId, name);
    room.addPlayer(player);
    return { room, player, reconnected: false };
  }

  attach(player, ws) {
    if (player.ws && player.ws !== ws) {
      try { player.ws.close(4001, "Reconnected"); } catch {}
    }
    player.ws = ws;
    player.connected = true;
    player.disconnectedAt = 0;
    this.connections.set(ws, player);
  }

  detach(ws) {
    const player = this.connections.get(ws);
    if (!player) return;
    this.connections.delete(ws);
    if (player.ws === ws) player.ws = null;
    player.connected = false;
    player.disconnectedAt = now();
    player.input = { x: 0, z: 0, sprint: false };
  }

  send(player, message) {
    if (player?.ws?.readyState === 1) {
      try { player.ws.send(JSON.stringify(message)); } catch {}
    }
  }

  broadcastRoom(room, type = "state") {
    for (const player of room.connectedPlayers()) {
      this.send(player, { type, room: room.stateFor(player.id) });
    }
  }

  directory() {
    return [...this.rooms.values()]
      .filter(room => room.public && room.phase === "lobby")
      .map(room => ({
        code: room.code,
        players: room.players.size,
        maxPlayers: this.config.MAX_PLAYERS
      }));
  }

  broadcastDirectory() {
    const rooms = this.directory();
    for (const [ws, player] of this.connections) {
      if (!player.roomCode) this.send(player, { type: "rooms", rooms });
    }
  }

  handleMessage(ws, message) {
    const parsed = typeof message === "string" ? JSON.parse(message) : message;
    const current = this.connections.get(ws);

    if (parsed.type === "hello") {
      const clientId = String(parsed.clientId || randomUUID());
      let player = this.findPlayer(clientId);
      let room = player ? this.rooms.get(player.roomCode) : null;

      if (!player) {
        player = this.makePlayer(clientId, parsed.name);
      } else {
        player.name = sanitizeName(parsed.name || player.name);
      }

      this.attach(player, ws);
      if (room) {
        player.connected = true;
        this.send(player, { type: "reconnected", self: player.id, room: room.stateFor(player.id) });
        this.broadcastRoom(room);
      } else {
        this.send(player, { type: "welcome", self: player.id, rooms: this.directory() });
      }
      return;
    }

    if (!current) {
      this.send({ ws }, { type: "error", message: "Send hello first" });
      return;
    }

    if (parsed.type === "create") {
      try {
        if (current.roomCode) throw new Error("Already in a room");
        const result = this.createRoom(parsed.name || current.name, !!parsed.public, current.id);
        this.attach(result.player, ws);
        this.send(result.player, { type: "joined", self: result.player.id, room: result.room.stateFor(result.player.id) });
        this.broadcastRoom(result.room);
        this.broadcastDirectory();
      } catch (error) {
        this.send(current, { type: "error", message: error.message });
      }
      return;
    }

    if (parsed.type === "join") {
      try {
        if (current.roomCode) throw new Error("Already in a room");
        const result = this.joinRoom(parsed.code, parsed.name || current.name, current.id);
        this.attach(result.player, ws);
        this.send(result.player, {
          type: result.reconnected ? "reconnected" : "joined",
          self: result.player.id,
          room: result.room.stateFor(result.player.id)
        });
        this.broadcastRoom(result.room);
        this.broadcastDirectory();
      } catch (error) {
        this.send(current, { type: "error", message: error.message });
      }
      return;
    }

    if (parsed.type === "rooms") {
      this.send(current, { type: "rooms", rooms: this.directory() });
      return;
    }

    if (parsed.type === "ping") {
      this.send(current, { type: "pong", t: Number(parsed.t) || 0 });
      return;
    }

    if (!current.roomCode) {
      this.send(current, { type: "error", message: "Join a room first" });
      return;
    }

    const room = this.rooms.get(current.roomCode);
    if (!room) {
      current.roomCode = null;
      this.send(current, { type: "error", message: "Room expired" });
      return;
    }

    if (parsed.type === "clone_create") {
      try {
        const result = room.createClone(current.id);
        if (!result.ok) throw new Error(result.reason === "limit" ? "Clone limit reached." : "Clones can only be created by hiders during setup.");
        this.broadcastRoom(room);
        this.send(current, { type: "clone_created", clone: result.clone });
      } catch (error) {
        this.send(current, { type: "error", message: error.message });
      }
      return;
    }

    if (parsed.type === "clone_delete") {
      const result = room.deleteClones(current.id);
      if (result.ok) this.broadcastRoom(room);
      return;
    }

    if (parsed.type === "map_select") {
      try {
        if (room.hostId !== current.id) throw new Error("Only the room host can change the map");
        const result = room.setMap(parsed.mapId);
        if (!result.ok) throw new Error(result.reason === "round_running" ? "Map can only be changed in the lobby." : "Unknown map");
        this.broadcastRoom(room);
      } catch (error) {
        this.send(current, { type: "error", message: error.message });
      }
      return;
    }

    if (parsed.type === "rematch") {
      try {
        if (room.hostId !== current.id) throw new Error("Only the room host can rematch");
        if (room.phase !== "results") throw new Error("The round is not complete yet");
        if (room.activePlayers().length < this.config.MIN_PLAYERS) throw new Error("Need at least 2 players");
        room.startRound();
        this.broadcastRoom(room);
      } catch (error) {
        this.send(current, { type: "error", message: error.message });
      }
      return;
    }

    if (parsed.type === "start") {
      try {
        if (room.hostId !== current.id) throw new Error("Only the room host can start");
        if (room.phase !== "lobby") throw new Error("Round already running");
        room.startRound();
        this.broadcastRoom(room);
      } catch (error) {
        this.send(current, { type: "error", message: error.message });
      }
      return;
    }

    if (parsed.type === "leave") {
      const code = room.code;
      room.removePlayer(current.id);
      current.roomCode = null;
      current.connected = true;
      current.role = "hider";
      current.score = 0;
      this.send(current, { type: "left", code });
      this.broadcastRoom(room);
      this.broadcastDirectory();
      if (room.players.size === 0) this.rooms.delete(room.code);
      return;
    }

    if (parsed.type === "input") {
      current.input = {
        x: clamp(Number(parsed.x) || 0, -1, 1),
        z: clamp(Number(parsed.z) || 0, -1, 1),
        sprint: !!parsed.sprint
      };
      if (Number.isFinite(Number(parsed.yaw))) current.yaw = Number(parsed.yaw);
      current.lastInputAt = now();
      return;
    }

    if (parsed.type === "customize") {
      const result = room.customize(current.id, parsed);
      if (!result.ok) {
        this.send(current, { type: "error", message: "Camouflage can only be changed by hiders during setup." });
      } else {
        this.send(current, { type: "customized", ...result });
        this.broadcastRoom(room);
      }
      return;
    }

    if (parsed.type === "ability") {
      const room = this.rooms.get(current.roomCode);
      if (!room) return;
      const ability = String(parsed.ability || "");
      if (ability === "scan") {
        if (room.phase !== "search" || current.role !== "seeker") return;
        if (now() - current.lastAbilityAt < 6500) return;
        current.lastAbilityAt = now();
        const duration = 2200;
        for (const p of room.players.values()) {
          if (p.role !== "hider" || p.found) continue;
          if (Math.hypot(p.x - current.x, p.z - current.z) <= 14) p.revealedUntil = now() + duration;
        }
        for (const viewer of room.connectedPlayers()) {
          this.send(viewer, { type: "scan_effect", x: current.x, z: current.z });
        }
        this.broadcastRoom(room);
      } else if (ability === "taunt") {
        if (!current.roomCode || now() - current.lastAbilityAt < TAUNT_COOLDOWN_MS) return;
        current.lastAbilityAt = now();
        for (const viewer of room.connectedPlayers()) {
          this.send(viewer, { type: "taunt_effect", x: current.x, z: current.z, name: current.name });
        }
      }
      return;
    }

    if (parsed.type === "spot") {
      const result = room.spot(current.id, String(parsed.targetId || ""));
      if (result.ok) {
        for (const player of room.connectedPlayers()) {
          this.send(player, {
            type: "spot_effect",
            success: true,
            targetId: result.targetId,
            x: result.x,
            z: result.z
          });
        }
        this.broadcastRoom(room);
      } else if (["out_of_range", "wrong_direction"].includes(result.reason)) {
        this.send(current, {
          type: "spot_miss",
          reason: result.reason,
          x: result.x,
          z: result.z
        });
      }
      return;
    }
  }

  tick() {
    const timestamp = now();
    for (const room of [...this.rooms.values()]) {
      if (room.phase === "lobby" && room.connectedPlayers().length >= 2 && room.autoStartAt && timestamp >= room.autoStartAt) {
        room.startRound();
      }
      const footsteps = room.update(this.config.TICK_MS / 1000);

      if (room.phase === "setup" && timestamp >= room.endAt) room.transitionToSearch();
      if (room.phase === "search") room.checkWinConditions();
      if (room.phase === "results" && timestamp >= room.endAt) {
        if (room.activePlayers().length < this.config.MIN_PLAYERS) {
          room.phase = "lobby";
          room.completed = false;
          room.winnerRole = null;
          room.endReason = null;
        } else {
          room.endAt = timestamp + CONFIG.RESULTS_MS;
        }
      }

      for (const step of footsteps) {
        for (const player of room.connectedPlayers()) {
          if (player.role === "seeker") {
            const dx = step.x - player.x;
            const dz = step.z - player.z;
            const distance = Math.hypot(dx, dz);
            if (distance < 16) {
              this.send(player, {
                type: "footstep",
                x: step.x,
                z: step.z,
                strength: step.strength * Math.max(0, 1 - distance / 16)
              });
            }
          }
        }
      }

      if (timestamp - room.lastBroadcast >= this.config.BROADCAST_MS) {
        room.lastBroadcast = timestamp;
        this.broadcastRoom(room);
      }

      for (const player of [...room.players.values()]) {
        if (!player.connected && timestamp - player.disconnectedAt >= this.config.RECONNECT_MS) {
          room.removePlayer(player.id);
        }
      }
      if (room.players.size === 0) this.rooms.delete(room.code);
    }
    this.broadcastDirectory();
  }
}

export function createServer() {
  const manager = new GameManager();
  const app = express();
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public")));
  app.get("/health", (_req, res) => res.json({
    ok: true,
    rooms: manager.rooms.size,
    maxPlayers: manager.config.MAX_PLAYERS
  }));
  app.get("/api/rooms", (_req, res) => res.json({ rooms: manager.directory() }));

  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", ws => {
    ws.on("message", raw => {
      try {
        manager.handleMessage(ws, JSON.parse(String(raw)));
      } catch (error) {
        manager.send(manager.connections.get(ws), {
          type: "error",
          message: "Invalid message"
        });
      }
    });
    ws.on("close", () => manager.detach(ws));
  });

  const ticker = setInterval(() => manager.tick(), manager.config.TICK_MS);
  const close = () => new Promise(resolve => {
    clearInterval(ticker);
    for (const ws of wss.clients) {
      try { ws.close(); } catch {}
    }
    server.close(resolve);
  });

  return { app, server, manager, wss, close };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const { server, manager } = createServer();
  server.listen(CONFIG.PORT, () => {
    console.log("[CAMELEON] Listening on http://localhost:" + CONFIG.PORT);
    console.log("[CAMELEON] WebSocket path: /ws");
    console.log("[CAMELEON] Supports 2-" + CONFIG.MAX_PLAYERS + " players.");
  });
}
