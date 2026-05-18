# UI Assets

Hand-authored art consumed by the HUD layer. Each file is loaded by
`BootScene.preload()`; missing files are non-fatal — the HUD falls back to
procedural rendering via `Graphics`/`PixelSprite` and a small unicode
glyph for icons. Most large UI textures are shipped as WebP (~3× smaller
than the original PNG); only the small palette PNGs (`torch.png`,
`room_frames.png`) and the nine-slice button skins under `buttons/` stay
as PNG because they're already tiny.

| File | Size | Transparency | Used by |
| --- | --- | --- | --- |
| `top_bar.webp` | 1024×96 | yes | top HUD frame (carved stone bezel, scaled to panel height) |
| `bottom_bar.webp` | 1024×155 | yes | bottom HUD frame (scaled to panel height) |
| `stone_wall.webp` | 1710×920 | no | background of the play area between panels; stretched to fit via `setDisplaySize`. Optional — falls back to the procedural `StoneBackdrop` renderer when missing. |
| `hud_icons.webp` | 512×128 | yes | 8×2 grid of 64×64 frames in `IconFrame` order |
| `room_frames.png` | 192×64 | yes | 3×1 grid of 64×64 frames (gold / red / grey) for map nodes |
| `room_icons.webp` | 576×64 | yes | 9×1 grid of 64×64 room-type icons. Frame order matches `ROOM_ICON_FRAME` in `src/ui/RoomVisuals.ts`: 0 campfire (START/REST), 1 enemy skull, 2 stone "?" (EMPTY), 3 elite skull, 4 boss crown skull (BOSS/MINI_BOSS), 5 chest (TREASURE), 6 sigil (TRAP), 7 tombstone (SHRINE), 8 coin pouch (MERCHANT) |
| `torch.png` | 288×288 (3×3 grid of 96×96) | yes | Boot-screen wall torch flame loop. Square cells laid out row-major (left → right, top → bottom). `BootScene.preload` re-binds the texture as a spritesheet with cell size from `BOOT_TORCH_FRAME_SIZE` (96 px), and Phaser auto-derives the frame count from the texture dimensions, so 4 / 9 / 16-frame variants work without code changes. Used by `src/ui/BootTorch.ts`. |
| `title_logo.webp` | 1672×941 | yes | boot-screen title art, rendered above the door. |
| `door.webp` | 1774×887 (2 frames of 887×887) | yes | boot-screen door spritesheet, frame 0 closed / 1 open. |
| `panel_small.webp` | 240×212 | yes | nine-slice panel used by upgrade-shop cards. |

## `hud_icons.webp` frame order

Frames are 64×64 each, indexed row-major (row 0 first, left-to-right).

| Index | Key | Meaning |
| --- | --- | --- |
| 0 | `heart` | HP |
| 1 | `skull` | Stress |
| 2 | `star` | Level / prestige |
| 3 | `xpArrow` | XP up-arrow |
| 4 | `sword` | Attack |
| 5 | `shield` | Defense |
| 6 | `coin` | Gold |
| 7 | `potion` | Health potion |
| 8 | `resolve` | Resolve / will (green gem) |
| 9 | `lantern` | Light resource (lantern) |
| 10 | `shard` | Relic shards (teal crystal) |
| 11 | `depth` | Depth (down arrow) |
| 12 | `kills` | Kills counter (gravestone) |
| 13 | `boss` | Bosses (crown) |
| 14 | `music` | Audio toggle |
| 15 | `globe` | Language toggle |

Order must match `src/ui/HudIcons.ts > IconFrame`. If the order in the
spritesheet changes, update that map (and only that map).

Legacy keys (`torch`, `moon`, `quill`) are aliases for backward compat:
they map to `lantern`, `shard`, and `resolve` respectively.

## Preprocessing

`hud_icons.png`, `room_frames.png`, and `room_icons.png` are produced from
the raw AI sheets by `~/preprocess_assets.py` (not committed): each cell is
detected by its alpha bbox, downscaled with LANCZOS to fit a 64×64 cell,
and centered with 2px padding. `top_bar.png` / `bottom_bar.png` are simply
trimmed to opaque bbox and downscaled to 1024-wide.
