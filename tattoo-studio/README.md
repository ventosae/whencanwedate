# Tattoo Studio

Try tattoos on a 3D torso, like a video-game character editor.

1. **Your body** – upload a torso photo. Pose detection (MediaPipe, running in the
   browser) reads your shoulders, hips and silhouette and fits a parametric 3D
   torso to them, and samples your skin tone. Fine-tune with presets and sliders,
   and optionally wrap the photo itself onto the front of the model.
2. **Tattoos you have** – upload photos of your ink. The skin background is
   removed so only the ink is projected onto the model.
3. **Tattoo ideas** – upload designs (or use the built-in samples) and drag them
   around the body. Resize, rotate, mirror, change ink strength, reorder, lock,
   and hide all ideas to compare before/after. Save a picture when you like it.

Everything runs client-side: photos never leave the browser. The session is
kept in IndexedDB so a reload restores your work.

## Run

```sh
cd tattoo-studio
npm install      # also copies the MediaPipe runtime and downloads the pose model into public/
npm run dev      # http://localhost:5173
npm run build    # static site in dist/, host it anywhere
```

## Controls

| Action | How |
| --- | --- |
| Turn the body | drag empty space / the body |
| Zoom | scroll or pinch |
| Move a tattoo | drag it |
| Resize / rotate | scroll / Shift + scroll over the selected tattoo, `-` `=` / `[` `]`, or the sliders |
| Delete | `Delete` |

## Limits

- The torso is a fitted mannequin (shoulders, chest, waist, hips, length, build),
  not a photogrammetry scan of the photo. A true per-person 3D reconstruction
  needs a server-side model.
- Photo fitting works best front-on, shoulders to hips visible, arms slightly
  away from the sides. If detection fails the sliders still work.

## Layout

- `src/body.js` – parametric torso mesh
- `src/photofit.js` – photo → body proportions, skin tone, torso crop
- `src/studio.js` – three.js scene, decal projection, drag interaction
- `src/imaging.js` – background removal / ink extraction
- `src/main.js` – UI wiring, `src/store.js` – persistence
