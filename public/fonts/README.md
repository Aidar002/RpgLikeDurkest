# Self-hosted web fonts

These woff2 files back the two centralised font stacks declared in
`src/ui/HudTheme.ts`:

| File | Family | Weight | Use | License |
|------|--------|--------|-----|---------|
| `JetBrainsMono-Regular.woff2` | JetBrains Mono | 400 | `HUD_FONT` body (HUD / log / numbers) | Apache 2.0 (jetbrains.com/lp/mono/) |
| `JetBrainsMono-Bold.woff2` | JetBrains Mono | 700 | `fontStyle: 'bold'` overrides on `HUD_FONT` | Apache 2.0 |
| `EBGaramond-Regular.woff2` | EB Garamond | 400 | `BODY_FONT` body (room copy / dialogs / end-screens), Latin subset | OFL 1.1 (Octavio Pardo) |
| `EBGaramond-Bold.woff2` | EB Garamond | 700 | `fontStyle: 'bold'` overrides on `BODY_FONT`, Latin subset | OFL 1.1 |
| `EBGaramond-Cyrillic-Regular.woff2` | EB Garamond | 400 | `BODY_FONT`, Cyrillic subset (`ru` locale) | OFL 1.1 |
| `EBGaramond-Cyrillic-Bold.woff2` | EB Garamond | 700 | `BODY_FONT` bold, Cyrillic subset | OFL 1.1 |

`@font-face` declarations live in `src/style.css`. The two subsets of EB
Garamond use `unicode-range` so the browser only downloads the script
actually rendered (the Latin file does not contain Cyrillic glyphs and
vice versa).

`src/main.ts` runs `FontFace.load()` on both regular cuts before
calling `new Phaser.Game(...)`, so the canvas Text objects render with
the web font from the very first frame.

### Replacing a font

1. Drop the new woff2 into this directory (keep the same filename, or
   adjust the matching `src:` URL in `src/style.css` and the URL list in
   `src/main.ts`).
2. If the new font has a different family name, update the constant
   strings (`HUD_FONT` / `BODY_FONT`) in `src/ui/HudTheme.ts` so the
   canvas Text objects pick it up.
3. Commit the source upstream link / license for traceability.
