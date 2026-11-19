// Copies the MediaPipe WASM runtime and downloads the pose model into public/
// so the app runs fully in the browser with no third-party requests at runtime.
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const modelPath = join(root, 'public/models/pose_landmarker_lite.task');

const exists = (p) => access(p).then(() => true, () => false);

await mkdir(join(root, 'public/wasm'), { recursive: true });
await mkdir(join(root, 'public/models'), { recursive: true });
await cp(join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), join(root, 'public/wasm'), { recursive: true });

if (!(await exists(modelPath))) {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log('Downloaded pose model.');
  } catch (err) {
    console.warn(`Could not download the pose model (${err.message}). The app will load it from the network at runtime instead.`);
  }
}
