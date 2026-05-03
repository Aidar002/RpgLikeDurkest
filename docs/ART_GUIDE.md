# Art Guide

How to add hand-authored art to the game. Each asset is a WebP file dropped
into `public/sprites/`. The procedural pixel-art fallback keeps working for
any missing file, so assets can land one at a time.

## Quick Start

1. Create or export your image as **WebP** (128 × 128 px recommended).
2. Name it exactly as listed in the tables below.
3. Drop it into the matching `public/sprites/` subfolder.
4. Run `npm run build` — the file is copied to `dist/` as a separate HTTP
   asset (not bundled into JS), so the JS bundle size stays the same.

No code changes needed — `BootScene.preload` already registers every slot
listed below, and `PixelSprite.registerAll` skips its procedural fallback
when a real texture exists.

## Room Icons (map nodes)

Displayed on the dungeon map graph at ~34 × 34 px.
High-res sources are scaled down automatically by `fitRoomSprite`.

| File | Texture key | Used for | Status |
|---|---|---|---|
| `public/sprites/rooms/camp.webp` | `room_START` | Starting camp node | **done** |
| `public/sprites/rooms/enemy.webp` | `room_ENEMY` | Regular enemy room | needed |
| `public/sprites/rooms/treasure.webp` | `room_TREASURE` | Treasure room | needed |
| `public/sprites/rooms/trap.webp` | `room_TRAP` | Trap room | needed |
| `public/sprites/rooms/rest.webp` | `room_REST` | Rest / campfire room | needed |
| `public/sprites/rooms/shrine.webp` | `room_SHRINE` | Shrine / NPC altar | needed |
| `public/sprites/rooms/merchant.webp` | `room_MERCHANT` | Merchant room | needed |
| `public/sprites/rooms/elite.webp` | `room_ELITE` | Elite enemy room | needed |
| `public/sprites/rooms/boss.webp` | `room_BOSS` | Boss room | needed |
| `public/sprites/rooms/empty.webp` | `room_EMPTY` | Empty / passage | needed |

## Enemy Portraits (combat panel)

Displayed in the 96 × 96 px combat panel. High-res sources are scaled
down by `fitEnemySprite` (max 88 px).

| File | Texture key | Enemy profile |
|---|---|---|
| `public/sprites/enemies/brute.webp` | `enemy_brute` | Brute — heavy melee |
| `public/sprites/enemies/stalker.webp` | `enemy_stalker` | Stalker — fast, hunched |
| `public/sprites/enemies/mage.webp` | `enemy_mage` | Mage — robed caster |
| `public/sprites/enemies/boss.webp` | `enemy_boss` | Boss — crowned guardian |
| `public/sprites/enemies/bleeder.webp` | `enemy_bleeder` | Bleeder — organic, dripping |
| `public/sprites/enemies/disruptor.webp` | `enemy_disruptor` | Disruptor — ethereal, floating |

## Specs

| Property | Recommendation |
|---|---|
| Format | **WebP** (lossy or lossless, both work) |
| Size | 128 × 128 px (square; other sizes work but will be scaled) |
| File size target | < 10 KB each (a typical 128 px WebP is 3–6 KB) |
| Transparency | Supported — use alpha for non-rectangular sprites |
| Style | Pixel art or painterly — both render fine at the game's scale |

## Bundle Impact

Art files live in `public/` and are copied verbatim to `dist/` at build
time. They are **not** part of the JS bundle — Phaser fetches each one as
a separate HTTP request and the browser caches it. Adding all 16 assets
at ~5 KB each adds roughly **80 KB** of static files to the deploy, with
zero impact on JS parse/compile time.

## How It Works

```
BootScene.preload()        — registers load requests for every .webp slot
  ↓
Phaser loader              — fetches files; missing → console warn, no crash
  ↓
PixelSprite.registerAll()  — skips key if texture already exists
  ↓
GameScene / CombatHud      — uses whichever texture is registered
```

## Adding a New Asset Type

If a future update adds new room types or enemy profiles:

1. Add the `.webp` entry to `BootScene.preload()` (follow the existing pattern).
2. Add the procedural fallback drawer in `PixelSprite.ts` (optional).
3. Update this guide.
