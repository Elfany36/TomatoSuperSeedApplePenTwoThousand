import assert from "node:assert/strict";
import { GameManager, GameRoom, CONFIG, sanitizeName, makeRoomCode } from "../server.mjs";

assert.equal(sanitizeName("<bad>!"), "bad");
const rooms = new Map();
const code = makeRoomCode(rooms);
assert.match(code, /^[A-Z0-9]{6}$/);

const room = new GameRoom("TEST01", true);
const gm = new GameManager({ SETUP_MS: 30, SEARCH_MS: 50, RESULTS_MS: 30, RECONNECT_MS: 80, BROADCAST_MS: 20, TICK_MS: 10 });
for (let i = 0; i < 4; i++) {
  const p = gm.makePlayer("p" + i, "Player " + i);
  room.addPlayer(p);
}
room.startRound();
assert.equal(room.phase, "setup");
assert.equal(room.players.size, 4);
assert.equal([...room.players.values()].filter(p => p.role === "seeker").length, 1);
assert.equal([...room.players.values()].filter(p => p.role === "hider").length, 3);

const seeker = [...room.players.values()].find(p => p.role === "seeker");
const hider = [...room.players.values()].find(p => p.role === "hider");
const customize = room.customize(hider.id, { color: "#E94F64", pose: "crouch", surfaceId: "red-diner" });
assert.equal(customize.ok, true);
assert.equal(hider.color, "#E94F64");
assert.equal(hider.pose, "crouch");

room.transitionToSearch();
assert.equal(room.phase, "search");
hider.x = seeker.x;
hider.z = seeker.z - 3;
seeker.yaw = Math.PI;
const spot = room.spot(seeker.id, hider.id);
assert.equal(spot.ok, true);
assert.equal(hider.found, true);

gm.detach({}); // no-op
console.log("server gameplay checks passed");


const createPlayer = gm.makePlayer("creator", "Creator");
gm.connections.set({ readyState: 1 }, createPlayer);
const createRoomResult = gm.createRoom("Creator", false, "creator");
assert.equal(createRoomResult.room.players.has("creator"), true);
assert.equal(createRoomResult.player.roomCode, createRoomResult.room.code);

const privacyRoom = new GameRoom("PRIV01", true);
for (const id of ["seeker","hider"]) privacyRoom.addPlayer(gm.makePlayer(id, id));
privacyRoom.startRound();
const pSeeker = [...privacyRoom.players.values()].find(p => p.role === "seeker");
const pHider = [...privacyRoom.players.values()].find(p => p.role === "hider");
pHider.x = pSeeker.x + 100;
pHider.z = pSeeker.z + 100;
const hiddenForSeeker = privacyRoom.stateFor(pSeeker.id).players.find(p => p.id === pHider.id);
assert.equal(hiddenForSeeker.x, null);
assert.equal(hiddenForSeeker.color, null);

const custom2 = privacyRoom.customize(pHider.id, { color: "#5ED7FF", pose: "freeze", brushSize: 3, paintCoverage: .72, surfaceId: "water" });
assert.equal(custom2.brushSize, 3);
assert.equal(custom2.paintCoverage, .15);
assert.equal(pHider.pose, "freeze");
assert.ok(pHider.frozenUntil > Date.now());

privacyRoom.phase = "setup";
const materialPose = privacyRoom.customize(pHider.id, {
  color: "#5ED7FF",
  pose: "tpose",
  brushSize: 5,
  metallic: 0.72,
  roughness: 0.24,
  pattern: "bands",
  surfaceId: "paint"
});
assert.equal(materialPose.pose, "tpose");
assert.equal(pHider.brushSize, 5);
assert.equal(pHider.metallic, 0.72);
assert.equal(pHider.roughness, 0.24);
assert.equal(pHider.pattern, "bands");

const cloneResult = privacyRoom.createClone(pHider.id);
assert.equal(cloneResult.ok, true);
assert.equal(privacyRoom.allClones().length, 1);
const hiderView = privacyRoom.stateFor(pHider.id);
assert.equal(hiderView.clones.length, 1);

privacyRoom.transitionToSearch();
const clone=pHider.clones[0];
const seekerForClone=[...privacyRoom.players.values()].find(p=>p.role==="seeker");
clone.x=seekerForClone.x;
clone.z=seekerForClone.z-0.75;
seekerForClone.yaw=Math.PI;
const cloneSpot=privacyRoom.spot(seekerForClone.id,"clone:"+clone.id);
assert.equal(cloneSpot.ok,true);
assert.equal(cloneSpot.clone,true);
assert.equal(privacyRoom.allClones().length,0);

privacyRoom.transitionToSearch();
const scanSeeker = [...privacyRoom.players.values()].find(p => p.role === "seeker");
scanSeeker.lastAbilityAt = 0;
for (const p of privacyRoom.players.values()) if (p.role === "hider") { p.x = scanSeeker.x + 3; p.z = scanSeeker.z; }
assert.ok([...privacyRoom.players.values()].some(p => p.role === "hider"));
console.log("extended room, privacy, camouflage and ability state checks passed");


const movementRoom = new GameRoom("MOVE01", false);
movementRoom.addPlayer(gm.makePlayer("m0", "Mover"));
movementRoom.addPlayer(gm.makePlayer("m1", "Mover2"));
movementRoom.startRound();
const mover = [...movementRoom.players.values()].find(p => p.role === "hider");
const beforeX = mover.x;
mover.input = { x: 1, z: 0, sprint: true };
movementRoom.update(0.25);
assert.ok(mover.x !== beforeX);
assert.ok(mover.stamina < 100);
mover.input = { x: 0, z: 0, sprint: false };
movementRoom.update(1);
assert.ok(mover.stamina > 0);
assert.ok(mover.stamina <= 100);
console.log("authoritative acceleration/stamina checks passed");

const aiRoom = new GameRoom("AI01", false);
aiRoom.addPlayer(gm.makePlayer("ai0", "AI Hider"));
aiRoom.addPlayer(gm.makePlayer("ai1", "AI Seeker"));
aiRoom.startRound();
const aiHider=[...aiRoom.players.values()].find(p=>p.role==="hider");
const aiSeeker=[...aiRoom.players.values()].find(p=>p.role==="seeker");
const setupCoach=aiRoom.stateFor(aiHider.id).aiCoach;
assert.equal(typeof setupCoach.hint,"string");
assert.ok(setupCoach.confidence>0);
aiRoom.transitionToSearch();
const seekerCoach=aiRoom.stateFor(aiSeeker.id).aiCoach;
assert.equal(typeof seekerCoach.hint,"string");
console.log("adaptive AI coach checks passed");


const systemRoom = new GameRoom("SYS01", false);
const sysHost = gm.makePlayer("sys-host", "Host");
const sysGuest = gm.makePlayer("sys-guest", "Guest");
systemRoom.addPlayer(sysHost);
systemRoom.addPlayer(sysGuest);
assert.equal(systemRoom.mapId, "grove");
assert.equal(systemRoom.setMap("gallery").ok, true);
assert.equal(systemRoom.mapId, "gallery");
systemRoom.startRound();
assert.equal(systemRoom.stateFor(sysHost.id).mapId, "gallery");
assert.equal(systemRoom.setMap("farm").ok, false);

const sysHider = [...systemRoom.players.values()].find(p => p.role === "hider");
const coverageBeforeMaterial = sysHider.paintCoverage;
const materialUpdate = systemRoom.customize(sysHider.id, {
  color: "#FFFFFF",
  pose: sysHider.pose,
  metallic: 0.4,
  roughness: 0.5,
  pattern: "edge",
  surfaceId: "material"
});
assert.equal(materialUpdate.ok, true);
assert.equal(sysHider.paintCoverage, coverageBeforeMaterial);

sysHider.input = { x: 1, z: 0, sprint: false };
sysHider.lastInputAt = Date.now() - 1000;
const staleX = sysHider.x;
systemRoom.update(0.1);
assert.equal(sysHider.x, staleX);

sysHider.attached = true;
sysHider.pose = "wallflat";
sysHider.input = { x: 0, z: 0, sprint: true };
sysHider.lastInputAt = Date.now();
systemRoom.update(0.05);
assert.equal(sysHider.attached, false);
console.log("map authority, paint accounting, stale input and wall detach checks passed");
