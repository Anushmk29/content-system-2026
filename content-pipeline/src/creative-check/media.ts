// What's actually in the creative (PRD CC-02): video frames + cuts via PyAV/numpy (they ship with
// faster-whisper) and the spoken words via faster-whisper; images downscaled with sharp.
// Its own Python calls with their own timeouts, so a stuck Decode transcription can't hold a check.
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { WHISPER_PY, type Transcript } from '../adapters/transcriber.ts';

const run = promisify(execFile);

export const MAX_FRAMES = 10;
export const MAX_SECONDS = 90;
const SIDE = 768;
// Mean grey-level change (0–255, 64px-wide frames, 0.5 s apart) that counts as a cut.
// ponytail: fixed threshold; fast pans can read as cuts. Tune here if cuts look wrong.
const CUT_THRESHOLD = 30;

// argv: path outDir cap maxSeconds side threshold. Prints one JSON line.
const FRAMES_PY = `
import sys, json
import av, numpy as np
path, out, cap, maxs, side, thr = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5]), float(sys.argv[6])
c = av.open(path)
s = c.streams.video[0]
s.thread_type = "AUTO"
w, h = s.codec_context.width, s.codec_context.height
dur = float(c.duration) / 1e6 if c.duration else (float(s.duration * s.time_base) if s.duration else 0.0)
sc = min(1.0, side / max(w, h))
W, H = max(2, int(w * sc) // 2 * 2), max(2, int(h * sc) // 2 * 2)
gh = max(2, int(64 * h / w))
fixed, done, picked, scene, cuts = [0.0, 1.5, 3.0], set(), {}, [], []
prev, last, nxt, rot = None, None, 0.0, 0
def rgb(f):
    a = f.to_ndarray(width=W, height=H, format="rgb24")
    return np.ascontiguousarray(np.rot90(a, k=(rot // 90) % 4)) if rot else a
for f in c.decode(s):
    if f.time is None: continue
    t = float(f.time)
    if t > maxs: break
    if t + 1e-3 < nxt: continue
    nxt, rot, tt = t + 0.5, int(getattr(f, "rotation", 0) or 0), round(t, 2)
    g = f.to_ndarray(width=64, height=gh, format="gray").astype(np.int16)
    if prev is not None:
        d = float(np.abs(g - prev).mean())
        if d > thr:
            cuts.append(tt)
            scene.append((d, tt, rgb(f)))
            scene.sort(key=lambda x: -x[0]); del scene[cap:]
    prev = g
    for x in fixed:
        if x not in done and abs(t - x) < 0.26:
            done.add(x); picked[tt] = rgb(f)
    last = (tt, f)
if last and last[0] not in picked: picked[last[0]] = rgb(last[1])
for d, tt, a in scene:
    if len(picked) >= cap: break
    if tt not in picked: picked[tt] = a
frames = []
for i, tt in enumerate(sorted(picked)[:cap]):
    a = picked[tt]
    open(f"{out}/f{i}.rgb", "wb").write(a.tobytes())
    frames.append({"t": tt, "file": f"f{i}.rgb", "w": int(a.shape[1]), "h": int(a.shape[0])})
if rot in (90, 270, -90): w, h = h, w
print(json.dumps({"duration": dur, "width": w, "height": h, "cuts": cuts, "frames": frames}))
`;

export interface Frame { t: number; jpeg: Buffer }
export interface VideoRead {
  durationS: number; width: number; height: number; cuts: number[]; frames: Frame[];
  transcript: Transcript | null; limitations: string[];
}
export interface ImageRead { width: number; height: number; jpeg: Buffer }

const pyOk = new Map<string, boolean>();
/** Python with PyAV + numpy (+ faster-whisper for speech); checked once per process. */
export function pythonHas(python: string, mod: 'av' | 'faster_whisper'): boolean {
  const key = `${python}:${mod}`;
  if (!pyOk.has(key)) pyOk.set(key, spawnSync(python, ['-c', mod === 'av' ? 'import av, numpy' : 'import faster_whisper'], { timeout: 30_000 }).status === 0);
  return pyOk.get(key)!;
}

export async function readImage(buf: Buffer): Promise<ImageRead> {
  const meta = await sharp(buf, { limitInputPixels: 4e7 }).rotate().metadata();
  const jpeg = await sharp(buf, { limitInputPixels: 4e7 }).rotate().resize(SIDE, SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
  return { width: w, height: h, jpeg };
}

/** Frames + transcript of an MP4, or null when this host has no Python video tools.
 *  Temp files are removed whatever happens; nothing is stored. */
export async function readVideo(buf: Buffer, opts: { python?: string; whisperModel?: string } = {}): Promise<VideoRead | null> {
  const python = opts.python ?? 'python';
  if (!pythonHas(python, 'av')) return null;
  const dir = await mkdtemp(join(tmpdir(), 'creative-check-'));
  try {
    const file = join(dir, 'v.mp4');
    await writeFile(file, buf);
    const speech = pythonHas(python, 'faster_whisper')
      ? run(python, ['-c', WHISPER_PY, file, opts.whisperModel ?? 'small'], { timeout: 240_000, maxBuffer: 64 * 1024 * 1024 })
        .then(({ stdout }) => JSON.parse(stdout.trim().split('\n').pop()!) as { text: string; segments: Transcript['segments']; lang?: string; duration?: number })
        .then((j): Transcript => ({ text: j.text.trim(), segments: j.segments.filter((s) => s.start < MAX_SECONDS), lang: j.lang ?? null, durationS: j.duration ?? null }))
        .catch(() => null)
      : Promise.resolve(null);
    const { stdout } = await run(python, ['-c', FRAMES_PY, file, dir, String(MAX_FRAMES), String(MAX_SECONDS), String(SIDE), String(CUT_THRESHOLD)], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    const j = JSON.parse(stdout.trim().split('\n').pop()!) as { duration: number; width: number; height: number; cuts: number[]; frames: { t: number; file: string; w: number; h: number }[] };
    const frames = await Promise.all(j.frames.map(async (f) => ({
      t: f.t,
      jpeg: await sharp(await readFile(join(dir, f.file)), { raw: { width: f.w, height: f.h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer(),
    })));
    const transcript = await speech;
    const limitations: string[] = [];
    if (j.duration > MAX_SECONDS) limitations.push(`Only the first ${MAX_SECONDS} seconds of the video were checked.`);
    if (!pythonHas(python, 'faster_whisper')) limitations.push('Speech wasn’t transcribed: faster-whisper isn’t installed on this server.');
    else if (!transcript) limitations.push('Speech couldn’t be read from this video (no audio track, or transcription failed).');
    return { durationS: Math.round(j.duration * 10) / 10, width: j.width, height: j.height, cuts: j.cuts, frames, transcript, limitations };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
