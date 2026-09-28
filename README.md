# CAMELEON — Meccha Chameleon Web

Browser multiplayer hide-and-seek built around Meccha Chameleon gameplay requirements.

## 1. Requirements

- Node.js 22 or newer is recommended.
- npm (included with Node.js).
- A modern desktop browser with WebGL support.
- Network access when running the default client, because Three.js and the default map GLBs are loaded from their configured CDN URLs.
- For multiplayer testing, use two or more browser sessions connected to the same running server.

> **Important:** This is a browser game server. Do not open `public/index.html` directly from the filesystem. Start the Node server first and open the HTTP address it serves.

## 2. Installation

From the repository root:

```bash
npm install
```

This installs the server/test dependencies declared by `package.json`.

To verify the project syntax and automated gameplay tests:

```bash
npm test
npm run check
```

The repository also contains a GitHub Actions workflow that runs the Node checks/tests on pushes and pull requests.

## 3. Start the game server

Run:

```bash
npm start
```

The server starts the HTTP/WebSocket game service. In GitHub Codespaces, use the forwarded port shown by Codespaces (the project is configured around port **3000**).

Then open the forwarded URL in your browser.

### GitHub Codespaces

A typical workflow is:

1. Open the repository in Codespaces.
2. Open the terminal.
3. Run `npm install`.
4. Run `npm start`.
5. Open the forwarded **3000** port from the **Ports** panel.
6. Keep the terminal/server process running while playing.
7. Open a second browser tab/window for a second player.

If the page looks unstyled, shows only a static HTML shell, or buttons appear not to work, first confirm that you opened the server URL rather than a `file://...` copy of `index.html`.

## 4. Runtime architecture

The runtime is split into two main pieces:

- **Client:** `public/index.html`, `public/style.css`, and `public/game.js`.
  - Builds the lobby and HUD.
  - Renders the 3D scene with Three.js.
  - Loads GLB/GLTF map assets.
  - Handles keyboard/mouse/gamepad input and local visual effects.
  - Sends room, movement, paint, pose, clone and seeker actions to the server.
- **Server:** `server.mjs` and the authoritative room/game-state code.
  - Creates private/public rooms.
  - Assigns Hider/Seeker roles.
  - Controls setup/search/results phases.
  - Validates movement, stamina, camouflage, spotting and clone state.
  - Controls room map selection and round completion.
  - Filters hidden hider information from seeker state.

The server is authoritative for gameplay state; the browser is primarily responsible for presentation, input and visual rendering.

## 5. Starting a game

### Step 1 — Enter a display name

Enter a player name in the lobby.

### Step 2 — Create or join a room

You can:

- **Create Private Room** — creates a room with a join code.
- **Create Public Room** — creates a room visible in the public-room list.
- **Join by Code** — enter the room code supplied by another player.
- **Join a Public Room** — select a listed public room when one is available.

For a normal multiplayer test, create a room in one browser and join the same room from a second browser session.

### Step 3 — Choose the map

The room host can select a map while the room is still in the lobby.

Available map scenes currently include:

- Grove
- Backrooms
- Gallery
- Restaurant
- Supermarket
- Hotel
- Sewer
- City
- Farm

Map selection is synchronized through the authoritative room state and is locked once the round has started.

### Step 4 — Wait for enough players

The round starts only when the server's minimum-player requirement is satisfied.

The server assigns players to Hiders and Seekers and advances the room through its round phases.

## 6. Round phases

### Setup

Hiders receive a preparation/camouflage period.

During setup, a Hider can:

- Paint the character.
- Sample colors/materials with the Eye Dropper.
- Adjust brush size.
- Select paint patterns.
- Adjust metallic and roughness values.
- Choose poses.
- Create/remove decoy clones.
- Use the camera to inspect the camouflage.

### Search

Seekers enter the search phase and try to find Hiders.

Hiders move and hide while using the environment, color, pose and camouflage coverage to blend in.

The server validates spotting using gameplay constraints such as range, field of view and line of sight rather than trusting a client-side "I found this player" result.

### Results

When the round ends, the results screen shows the round outcome and available rematch/lobby actions.

The server guards round completion so a completed round is not repeatedly finished by later ticks or duplicate actions.

## 7. Controls

The current HUD displays the main controls in-game. The practical keyboard/mouse layout is:

| Input | Action |
|---|---|
| **W A S D** | Move |
| **Shift** | Sprint |
| **Ctrl** | Crouch |
| **Space** | Eye Dropper while paint mode is open; otherwise jump/camera-bob behavior |
| **1–0** | Select poses |
| **R** | Cycle pose |
| **F** | Toggle paint/camouflage mode |
| **V** | Toggle camera mode |
| **E** | Seeker Scan Pulse / Hider Freeze |
| **Q** | Taunt |
| **LMB** | Paint during Hider setup / attempt a spot as Seeker |
| **MMB** | Eye Dropper; in paint mode, drag to inspect the camera |
| **RMB** | Adjust brush size in Hider setup / mouse-look outside brush adjustment |
| **Mouse wheel** | Change brush size |
| **Gamepad** | Supported movement/camera input where available |

Some actions are phase- or role-dependent. For example, painting is a Hider setup action and Scan Pulse is a Seeker search action.

## 8. Hider camouflage workbench

When playing as a Hider, the camouflage panel provides the main customization controls.

### Brush

Select the brush tool, choose a brush size, then use **LMB** on a paintable surface.

The current brush sizes are **1–5**.

Painting is continuous while the mouse is held and moved across paintable surfaces.

### Eye Dropper

Use the Eye Dropper to sample a visible surface color/material.

The eye-dropper workflow is intentionally tied to paint mode so an ordinary mouse interaction does not unexpectedly change the selected paint color.

### Color

Use the palette or custom color picker. The paint panel also provides a circular color-wheel control.

### Paint patterns

Available patterns include:

- Solid
- Edge
- Bands
- Dither

### Material tuning

The camouflage workbench exposes:

- Metallic
- Roughness

These are cosmetic material properties and do not by themselves count as additional paint coverage.

### Poses

The game includes the main pose set used by the camouflage gameplay:

- Default
- T-Pose
- Arms Up
- Arms Forward
- Legs Out
- Star
- Starfish
- Lie Flat
- Ball
- Sit
- Crouch
- Freeze
- Wall Flat
- Lean
- Slant
- Backbend

The numbered keyboard shortcuts and pose-cycle key provide quick access, while the on-screen pose buttons expose the full set.

### Decoys

Hiders can create decoy clones during the allowed phase and clear them again from the camouflage panel.

The server limits clone count and checks clone placement against collision before accepting a new clone.

## 9. Seeker gameplay

As a Seeker:

1. Move through the map.
2. Use the camera and mouse to inspect suspicious geometry.
3. Use **LMB** to attempt a spot when a Hider is in a valid spotting situation.
4. Use **E** for Scan Pulse when available.
5. Use **Q** for Taunt.
6. Watch the HUD, score and event feed for confirmed actions.

The server performs the authoritative spotting checks. Hidden Hider state is not freely exposed to Seeker clients during the search phase.

## 10. Camera and movement

The client supports role-aware camera behavior:

- Hiders normally use a third-person camera.
- Seekers can use the first-person search camera.
- **V** toggles available camera modes.
- Mouse input controls view direction.
- Sprinting consumes stamina.
- Crouching changes movement behavior.
- Frozen/attached states can restrict movement.
- A Hider can detach from an attached/wall state by sprinting when the server permits it.

If a client stops sending movement input, the server times out stale input so a disconnected or stalled client does not continue moving indefinitely.

## 11. Local map import

The lobby includes a local map importer for **GLB/GLTF** files.

Use it when you want to inspect a local map asset without replacing the authoritative multiplayer map system.

Workflow:

1. Start the server with `npm start`.
2. Open the game.
3. In the lobby, locate the **Local Map** importer.
4. Select a `.glb` or `.gltf` asset from your computer.
5. The client loads and normalizes the model for viewing.

This importer is a client-side visual feature. A locally imported visual map does **not** automatically create matching server collision/line-of-sight geometry for multiplayer gameplay.

## 12. Multiplayer testing

For a two-player smoke test:

1. Start the server once.
2. Open the game in Browser A.
3. Create a private/public room.
4. Copy the room code if private.
5. Open the game again in Browser B (or use another browser/incognito session).
6. Join the same room.
7. Confirm both clients display the same room/map state.
8. Start the round when the minimum-player requirement is met.
9. Exercise setup, movement, camouflage and spotting.
10. Complete the round and use the results/rematch flow.

For stronger validation, use two genuinely independent browser sessions rather than relying only on synthetic DOM events.

## 13. Automated tests

Run:

```bash
npm test
```

The gameplay test suite covers server-side behavior including:

- Room creation/privacy.
- Role and round state.
- Camouflage/paint state.
- Material and pose state.
- Clone creation and visibility.
- Spotting behavior.
- Movement acceleration and stamina.
- AI coach state.
- Authoritative map selection.
- Map-lock behavior after a round starts.
- Material-only changes not increasing paint coverage.
- Stale-input movement timeout.
- Wall-flat detach behavior.

Run syntax checks with:

```bash
npm run check
```

## 14. Troubleshooting

### "The buttons do nothing"

Make sure the application is being served by Node:

```bash
npm install
npm start
```

Then open the forwarded/server URL. Do not double-click `public/index.html`.

Also check the browser console for JavaScript errors and confirm that the server terminal is still running.

### "Multiplayer does not connect"

Check:

- The Node process is still running.
- You opened the same server URL in both sessions.
- The Codespaces port is forwarded.
- Both browser sessions can reach the WebSocket endpoint.
- You did not accidentally open one client from a `file://` URL.

### "The map is missing"

The default map assets are remote GLB resources. Confirm that the browser has network access to the configured asset CDN. If a remote asset fails, the client has fallback scene behavior, but the visual map may not match the intended selected scene.

### "The game looks different between map and collision"

The current project deliberately separates visual GLB assets from the authoritative server simulation geometry. A visual map can therefore contain geometry that does not yet have a one-to-one server collision/LOS representation. The local map importer is visual-only as well.

### "The second player does not move"

Check that both sessions are actually connected to the same room. Also remember that the server deliberately stops stale input after a short timeout; this prevents disconnected clients from continuing to move.

## 15. Project layout

```text
.
├── public/
│   ├── index.html       # Lobby + HUD + game UI
│   ├── style.css        # Visual styling
│   ├── game.js          # Three.js client/runtime
│   └── test.html        # Browser-facing game test harness
├── server.mjs           # HTTP/WebSocket server + authoritative game logic
├── test/
│   └── game.test.mjs    # Gameplay/server tests
├── third_party/
│   ├── SOURCES.md       # Source/provenance notes
│   ├── ATTRIBUTIONS.md  # Attribution information
│   └── manifest.json    # Asset/license manifest
├── package.json
└── .github/
    └── workflows/
        └── cameleon-checks.yml
```

## 16. Asset and provenance notes

The repository records third-party sources and asset provenance under `third_party/`.

The project can use permitted/reference material from the supplied Meccha Chameleon-related sources, but proprietary original game assets are not treated as generally redistributable open-source assets unless their rights permit that use. The browser implementation therefore uses its own procedural player presentation and documented third-party resources where appropriate.

See:

- `third_party/SOURCES.md`
- `third_party/ATTRIBUTIONS.md`
- `third_party/manifest.json`

## 17. Development workflow

A typical development loop is:

```bash
npm install
npm start
```

Then:

1. Open the forwarded game URL.
2. Test the lobby.
3. Test with a second browser session.
4. Exercise the current gameplay phase.
5. Run `npm test`.
6. Run `npm run check`.
7. Review browser/server console errors.
8. Commit changes only after the relevant local checks are complete.

For changes affecting multiplayer authority, test at least two independent sessions because a single browser cannot validate synchronization, privacy filtering or authoritative state propagation.

## 18. Verification status

The README documents the intended installation/runtime workflow and the repository's automated checks. It does **not** claim that browser/two-session runtime verification has been completed in every environment.

If you are working in GitHub Codespaces, the most reliable smoke test is to run `npm install && npm test && npm run check && npm start`, open the forwarded port, and then validate the game in two independent browser sessions.
