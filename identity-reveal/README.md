# Swapnil Gorde — Cinematic Identity Reveal

A 15-second, 1920×1080 identity reveal built in Three.js and rendered frame by frame.

**Deliverables (in `dist/`)**

| File | What it is |
|---|---|
| `swapnil-gorde-reveal.html` | One self-contained HTML file (about 1.4 MB). Three.js, the scene code and all the typography geometry are bundled in, so it works offline. Open it in a browser to play it in real time. |
| `swapnil-gorde-reveal.mp4` | The rendered film: H.264, 1920×1080, 30 fps, 15.0 s, yuv420p. |

## Sequence

| Time | Scene |
|---|---|
| 0.0–1.2 s | **Scene 1, macro.** A 100 mm lens sits close to a machined graphite surface with fine milling marks and precision seams. A narrow orange light travels along the chamfered edges. |
| 1.2–3.0 s | Spring-driven pull-back and swing. The surface turns out to be a massive extruded **S**. Its seams glow briefly just before it opens. |
| 3.0–5.5 s | **Scene 2.** The S opens into an exploded view of about 320 machined components in two depth layers. Accounting symbols, financial figures and code emerge from inside the structure. |
| 5.5–8.4 s | **Scene 3.** The components converge into a **G** while the camera orbits about 60° to show its depth and construction. |
| 8.4–10.7 s | **Scene 4.** The floating fragments crystallise into a second S. It travels into the G's counter and locks with a spring "click" and an orange pulse along every seam. |
| 10.7–12.9 s | **Signature shot.** A controlled pull-back (about 17× in distance, 60→85 mm lens) while the monogram turns into type. S and G slide to their places in the name and turn from graphite to ivory. SWAPNIL rises in the S's wake and GORDE rises from the G. |
| 12.3–15.0 s | **Final frame.** SWAPNIL GORDE above the tagline FINANCE \| FINTECH \| ACADEMIA \| INNOVATION, with one restrained orange glint. |

## Craft notes

- **Typography.** The name is set in Cormorant Garamond SemiBold capitals with the font's own kerning and +0.16 em tracking. The tagline is Inter Medium capitals at +0.30 em, with thin orange rules as the separators. Every glyph is real outline geometry, extracted offline with opentype.js. There is no canvas text and no bitmap fonts, so the type stays sharp at any resolution. The fonts are licensed under SIL OFL 1.1.
- **Components.** The S and G outlines are cut on a 0.46-unit grid with exact polygon clipping (`polygon-clipping`). Slivers are merged into their neighbours, and full cells are split into triangles. Each piece is a chamfered extrusion, so the assembled letter shows hairline machined seams.
- **Materials and light.** The letters use a physical metal material with a procedural milled bump/roughness map. They are lit by a custom studio environment of a few soft boxes on black, a shadow-casting key light and a cool rim light. The orange is not a lamp: it is an emissive band that lives only on chamfers and edges. Bloom is keyed on warm chroma, so only the orange glows and white highlights stay crisp. Tone mapping is Khronos PBR Neutral, so the white type stays white.
- **Motion.** Every move is an analytic damped spring, x(t) = 1 − e^(−ζωt)(cos ω_d t + (ζω/ω_d) sin ω_d t). Camera keys are superposed spring step responses.
- **Deterministic.** `REVEAL.renderFrame(t)` is a pure function of `t`. There is no `Math.random` (a seeded PRNG is used instead), no clock and no accumulated state. The same frame number always gives the same image, and the film grain is seeded per frame.

## Rebuild / re-render

```bash
cd identity-reveal
npm install
npm run fonts      # extract glyph outlines + partition S/G   -> src/glyph-data.json
npm run build      # bundle into one HTML file                -> dist/swapnil-gorde-reveal.html
npm run render     # headless Chromium + ffmpeg               -> dist/swapnil-gorde-reveal.mp4
```

`npm run render` needs Playwright's Chromium and `ffmpeg` with libx264. Options:

- `--scale 0.5 --fps 15` gives a quick motion preview.
- `--crf` sets the encode quality (default 14).

In the browser, `?t=7.5` holds a still, `?render=1` hides the controls, Space plays or pauses, and ←/→ step one frame.
