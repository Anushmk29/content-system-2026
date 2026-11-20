// Local transcription for Decode: yt-dlp pulls a public video's audio, faster-whisper (Python)
// turns it into text. Free, no API key, but it needs a real host with both installed — not a
// serverless function (docs/operations/GO-LIVE.md). Video hooks become the actual spoken first lines.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Adapter } from './adapter.ts';
import type { HealthReport } from '../health.ts';
import { report } from '../health.ts';

const run = promisify(execFile);

// Prints one JSON line: { text, segments: [{start,end,text}], lang, duration }.
export const WHISPER_PY = `
import sys, json
from faster_whisper import WhisperModel
def run(device):
    model = WhisperModel(sys.argv[2], device=device, compute_type="int8")
    segs, info = model.transcribe(sys.argv[1], vad_filter=True)
    return [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs], info
try:
    out, info = run("auto")
except RuntimeError:  # a GPU without its CUDA libraries (cuBLAS/cuDNN): CPU instead
    out, info = run("cpu")
print(json.dumps({"text": " ".join(x["text"] for x in out), "segments": out, "lang": info.language, "duration": info.duration}))
`;

const GPU_ERROR = /cuda|cudnn|cublas|cudart|gpu/i;
/** The last non-empty line of a crash: where Python puts the actual error. */
const lastLine = (m: string) => m.split('\n').map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 200) ?? m;

export interface Transcript { text: string; segments: { start: number; end: number; text: string }[]; lang: string | null; durationS: number | null }

export interface TranscriberConfig { ytdlp?: string; python?: string; model?: string; cap?: number }

export interface TranscriberAdapter extends Adapter {
  /** Most videos to transcribe per Decode run (best performers first). */
  readonly cap: number;
  transcribe(url: string): Promise<Transcript>;
}

export function createTranscriber(cfg: TranscriberConfig = {}): TranscriberAdapter {
  const ytdlp = cfg.ytdlp ?? 'yt-dlp', python = cfg.python ?? 'python', model = cfg.model ?? 'small';
  // Importing faster_whisper can be slow: probe once asynchronously, never on the Node event loop.
  let missing: string[] | undefined;
  let checking: Promise<string[]> | undefined;
  const check = () => checking ??= Promise.all([
    run(ytdlp, ['--version'], { timeout: 15_000 }).then(() => '', () => `yt-dlp (${ytdlp})`),
    run(python, ['-c', 'import faster_whisper'], { timeout: 30_000 }).then(() => '', () => `faster-whisper (pip install faster-whisper into ${python})`),
  ]).then((results) => missing = results.filter(Boolean));

  return {
    id: 'transcriber',
    get configured() { return missing?.length === 0; },
    cap: cfg.cap ?? 15,

    async transcribe(url) {
      const dir = await mkdtemp(join(tmpdir(), 'decode-audio-'));
      try {
        // Audio only, no conversion: faster-whisper decodes any container itself.
        await run(ytdlp, ['-f', 'bestaudio/best', '--no-playlist', '--max-filesize', '300M', '-o', join(dir, 'a.%(ext)s'), '--', url], { timeout: 300_000 });
        const file = (await readdir(dir)).find((f) => f.startsWith('a.'));
        if (!file) throw new Error('yt-dlp downloaded nothing');
        const whisper = (device: string) => run(python, ['-c', WHISPER_PY, join(dir, file), model, device], { timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
        // A broken CUDA install can crash the process outright, past the Python RuntimeError fallback: retry on CPU.
        const { stdout } = await whisper('auto').catch(async (e: Error) => {
          if (!GPU_ERROR.test(e.message)) throw e;
          return whisper('cpu').catch((e2: Error) => { throw new Error(`Transcription failed: the GPU is unavailable and the CPU retry failed (${lastLine(e2.message)})`); });
        });
        const j = JSON.parse(stdout.trim().split('\n').pop()!) as { text: string; segments: Transcript['segments']; lang?: string; duration?: number };
        return { text: j.text.trim(), segments: j.segments, lang: j.lang ?? null, durationS: j.duration != null ? Math.round(j.duration) : null };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    async healthCheck(): Promise<HealthReport> {
      const m = await check();
      return m.length
        ? report('transcriber', 'unconfigured', `missing: ${m.join(', ')} — video posts keep their captions`)
        : report('transcriber', 'ok', `yt-dlp + faster-whisper (${model}) found`, { model, cap: cfg.cap ?? 15 });
    },
  };
}
