# UI Assets

Hand-authored PNG art consumed by the HUD layer. Each file is loaded by
`BootScene.preload()`; missing files are non-fatal — the HUD falls back to
procedural rendering via `Graphics`/`PixelSprite` and a small unicode
glyph for icons.

| File | Size | Transparency | Used by |
| --- | --- | --- | --- |
| `top_bar.png` | 1024×134 | yes | top HUD frame (carved stone bezel, scaled to panel height) |
| `bottom_bar.png` | 1024×155 | yes | bottom HUD frame (scaled to panel height) |
| `stone_wall.png` | optional | no | background of the play area between panels |
| `hud_icons.png` | 512×128 | yes | 8×2 grid of 64×64 frames in `IconFrame` order |
| `room_frames.png` | 192×64 | yes | 3×1 grid of 64×64 frames (gold / red / grey) for map nodes |
| `room_icons.png` | 512×64 | yes | 8×1 grid of 64×64 room-type icons (loaded but currently unused) |

## `hud_icons.png` frame order

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
