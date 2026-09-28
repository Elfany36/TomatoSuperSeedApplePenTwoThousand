# CAMELEON — Meccha Chameleon Web

Browser multiplayer hide-and-seek built around Meccha Chameleon gameplay requirements.

## Run

```bash
npm install
npm start
```

Open the forwarded/local port and use two browser sessions for multiplayer validation.

## Current gameplay systems

- 2–10 player private/public WebSocket rooms
- authoritative role assignment and round lifecycle
- hider paint/camouflage setup
- brush + Eye Dropper modes
- three brush sizes
- Stand / Crouch / Curl / Freeze poses
- hider camouflage coverage and blend score
- seeker FOV/range/line-of-sight spotting
- seeker Scan Pulse and player Taunt
- first-person seeker camera and third-person hider camera
- mouse look, keyboard, gamepad, sprint and camera controls
- footsteps/noise feedback
- round results and explicit host rematch
- server privacy: hidden hider positions and camouflage details are not freely broadcast to seekers
- rotating production map assets loaded with Three.js GLTFLoader
- ambient/fill/key lighting, shadows, tone mapping, fog and gameplay VFX

## Asset maps

The client currently rotates through Grove, Backrooms, Gallery, Restaurant, Supermarket, Hotel, Sewer, City and Farm scenes. Provenance for the imported resources is recorded under `third_party/`.

## Testing

`npm test` covers room creation, role assignment, camouflage state, server privacy and round-state behavior. The repository also includes an Actions workflow that runs the Node syntax checks and gameplay tests on pushes and pull requests.

## Provenance

See:
- `third_party/SOURCES.md`
- `third_party/ATTRIBUTIONS.md`
- `third_party/manifest.json`
