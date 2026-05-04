# UI Assets

PNG art consumed by the HUD layer. Each file is loaded by
`BootScene.preload()`; missing files are non-fatal — the HUD falls back to
procedural rendering via `Graphics`/`PixelSprite`.

| File | Size | Transparency | Used by |
| --- | --- | --- | --- |
| `top_bar.png` | 1024×100 | yes | top HUD frame (overlaid on the panel rectangle) |
| `bottom_bar.png` | 1024×120 | yes | bottom HUD frame with cell separators |
| `stone_wall.png` | 1024×592 | no | background of the play area between panels |
| `icons.png` | 256×16 | yes | 16 icons of 16×16 in a single row, in `IconKey` order |
| `room_frames.png` | 192×64 | yes | three 64×64 frames (gold / red / grey) for map nodes |

## `icons.png` frame order

Frames are 16×16 each, indexed left-to-right starting at 0:

| Index | Key | Meaning |
| --- | --- | --- |
| 0 | `heart` | HP |
| 1 | `skull` | Stress |
| 2 | `star` | Level |
| 3 | `xpArrow` | XP arrow |
| 4 | `sword` | Attack |
| 5 | `shield` | Defense |
| 6 | `torch` | High-light torch |
| 7 | `moon` | Low-light crescent |
| 8 | `coin` | Gold |
| 9 | `potion` | Potion |
| 10 | `quill` | Resolve / will |
| 11 | `lantern` | Light resource |
| 12 | `shard` | Relic shards |
| 13 | `depth` | Depth (down arrow) |
| 14 | `kills` | Kills counter |
| 15 | `boss` | Bosses |

Order must match `src/ui/HudIcons.ts > IconFrame`. If the order in the
spritesheet changes, update that map (and only that map).
