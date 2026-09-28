# Meccha Chameleon Web — Source Provenance

This project follows the authorized direct-reuse directive supplied for the Meccha Chameleon Web conversion.

## Primary Meccha Chameleon material
- MECCHA CHAMELEON game/cooked assets in this repository: semantic/source-of-truth evidence; proprietary binaries are not treated as open-source assets.
- c0re-i5/meccha-chameleon-modkit-guide: developer/mod-kit workflow reference and supplied mod-kit resources.
- The Player / Meccha Chameleon model-resource page supplied for model inspection.
- Mecchachameleon 3D models — Sketchfab tag supplied by the project owner: https://sketchfab.com/tags/mecchachameleon (visual/model reference only; individual model licenses must be checked before redistribution).
- MECCHA CHAMELEON Controls / Paint reference pages supplied and searched for current input/paint behavior; used as gameplay-reference material, not as a substitute for the game's proprietary implementation.

## Reusable gameplay/networking sources
- twalkerallenii-spec/hide-and-seek-arena — browser/Three.js multiplayer architecture, server authority, room lifecycle, interpolation, controller and validation patterns. License: MIT.
- chengai77/paint-and-seek — paint/camouflage, surface sampling, hider/seeker flow, detection and scoring patterns. License: MIT.
- zeddic/hide-and-seek — authoritative server, client prediction/reconciliation and shared-state patterns. License: MIT.
- JPBotelho/Camouflage-Shader — camouflage mask/material/shader concepts. License: MIT.
- maccam912/mega-chamomile — paint-to-hide gameplay and multiplayer test patterns; included under the supplied direct-reuse authorization.
- FugitiveTheGame/Fugitive — hide-and-seek game-state/networking patterns; included under the supplied direct-reuse authorization.
- nicholas-maltbie/PropHunt — prop/hunter role and round-state patterns; included under the supplied direct-reuse authorization.
- probablyspoonie/Prop-Hunt — prop/disguise and round/networking patterns; included under the supplied direct-reuse authorization.
- inuskeph/mygame — Meccha Chameleon Roblox gameplay reference; ported/adapted concepts only where useful and compatible.

## Environment/model inputs
All of the following current map assets are loaded as web-ready GLB resources through Three.js GLTFLoader. The 3DAssets.dev sources state CC0 1.0 Universal for these packs:
- Sunlit Grove — https://cdn.3dassets.dev/assets/38765/v1/model.glb
- Backrooms and Liminal Spaces — https://cdn.3dassets.dev/assets/25333/v1/model.glb
- Art Gallery and Exhibition Rooms — https://cdn.3dassets.dev/assets/35871/v1/model.glb
- Restaurant Kitchen and Dining Room — https://cdn.3dassets.dev/assets/16541/v1/model.glb
- Supermarket Operations — https://cdn.3dassets.dev/assets/26952/v1/model.glb
- Hotel and Resort Operations — https://cdn.3dassets.dev/assets/25950/v1/model.glb
- Undercity Sewers and Thieves Den — https://cdn.3dassets.dev/assets/27259/v1/model.glb
- Pixel Modern City Street — https://cdn.3dassets.dev/assets/29075/v1/model.glb
- Arable Fields and Farm Machinery — https://cdn.3dassets.dev/assets/16895/v1/model.glb

Other supplied/authorized asset sources retained for future local ingestion:
- Kenney Mini Characters
- Kenney Blocky Characters
- Kenney Nature Kit
- Kenney Prototype Kit / Prototype Textures
- Kenney Mini Market / Mini Arcade
- Quaternius stylized nature / city packs
- KayKit Restaurant Bits / City Builder Bits / Bits Bundle
- supplied Japanese garden resources

## Implementation policy
Source projects are components/resources, not replacements for Meccha Chameleon identity. Original Meccha behavior takes precedence when sources conflict.

No Steam lobby/relay dependency is introduced by the new server architecture.
