/**
 * RecordingManager — manages screenshot frame capture and ffmpeg video compilation.
 *
 * Lifecycle:
 *   startSession(deviceId) → saveFrame(deviceId, base64) … → stopSession(deviceId) → mp4
 *
 * Directory layout:
 *   recordings/<sessionId>/
 *     frame_00001.jpg
 *     frame_00002.jpg
 *     …
 *     concat.txt      (ffmpeg concat demuxer input — per-frame durations from timestamps)
 *     output.mp4
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface RecordingSession {
  sessionId: string;
  deviceId: string;
  startedAt: number;
  frameCount: number;
  dir: string;
  /** Per-frame relay-server timestamps (ms) for accurate video timing */
  frameTimestamps: number[];
}

export interface RecordingResult {
  sessionId: string;
  deviceId: string;
  videoPath: string;
  /** URL path relative to relay server, e.g. /api/recordings/<id>/video.mp4 */
  videoUrl: string;
  durationMs: number;
  frameCount: number;
  fileSizeBytes: number;
}

export class RecordingManager {
  private sessions = new Map<string, RecordingSession>(); // deviceId → session
  private completed = new Map<string, RecordingResult>(); // sessionId → result
  private baseDir: string;
  /** Max completed recordings to keep in memory for listing */
  private static readonly MAX_COMPLETED = 20;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  /**
   * Start a recording session for a device.  Compiles any existing session first.
   */
  startSession(deviceId: string): RecordingSession {
    this.stopExisting(deviceId);

    const ts = Date.now();
    const safeId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    const sessionId = `${safeId}_${ts}`;
    const dir = path.join(this.baseDir, sessionId);
    fs.mkdirSync(dir, { recursive: true });

    const session: RecordingSession = {
      sessionId,
      deviceId,
      startedAt: ts,
      frameCount: 0,
      dir,
      frameTimestamps: [],
    };
    this.sessions.set(deviceId, session);
    console.log(`[Recording] Started session ${sessionId} for device ${deviceId.slice(0, 8)}...`);
    return session;
  }

  /**
   * Save a base64-encoded JPEG screenshot as a numbered frame file.
   * Records the current time for accurate video timing.
   */
  saveFrame(deviceId: string, base64Data: string): number {
    const session = this.sessions.get(deviceId);
    if (!session) return 0;

    session.frameCount++;
    session.frameTimestamps.push(Date.now());

    const frameName = `frame_${String(session.frameCount).padStart(5, '0')}.jpg`;
    const framePath = path.join(session.dir, frameName);

    try {
      // Screenshots come as data:image/jpeg;base64,<data> — strip header if present
      let raw = base64Data;
      const commaIdx = raw.indexOf(',');
      if (commaIdx !== -1 && raw.slice(0, commaIdx).includes('base64')) {
        raw = raw.slice(commaIdx + 1);
      }
      const buffer = Buffer.from(raw, 'base64');
      fs.writeFileSync(framePath, buffer);
    } catch (err) {
      console.error(`[Recording] Failed to write frame:`, err);
    }

    return session.frameCount;
  }

  /**
   * Stop recording for a device and compile frames to MP4 using ffmpeg.
   */
  async stopSession(deviceId: string): Promise<RecordingResult | null> {
    const session = this.sessions.get(deviceId);
    if (!session) return null;

    this.sessions.delete(deviceId);
    return this.compileFrames(session);
  }

  /**
   * Compile a session's frames to MP4 with per-frame timing from timestamps.
   *
   * Uses ffmpeg concat demuxer with per-frame durations derived from actual
   * frame capture timestamps, so the video plays at real-time speed regardless
   * of adaptive FPS changes (1-10 fps).
   */
  private async compileFrames(session: RecordingSession): Promise<RecordingResult | null> {
    if (session.frameCount === 0) {
      console.warn(`[Recording] No frames captured for ${session.sessionId}, removing dir`);
      fs.rmSync(session.dir, { recursive: true, force: true });
      return null;
    }

    // Build concat file with per-frame durations from timestamps
    const ts = session.frameTimestamps;
    const concatPath = path.join(session.dir, 'concat.txt');
    const lines: string[] = [];

    for (let i = 0; i < session.frameCount; i++) {
      const frameName = `frame_${String(i + 1).padStart(5, '0')}.jpg`;
      lines.push(`file '${frameName}'`);

      if (i < session.frameCount - 1) {
        // Duration = time until next frame (seconds)
        const durationSec = (ts[i + 1] - ts[i]) / 1000;
        // Clamp: min 33ms (30fps max), max 5s (prevent gaps from stalling video)
        const clamped = Math.max(0.033, Math.min(5.0, durationSec));
        lines.push(`duration ${clamped.toFixed(3)}`);
      }
      // Last frame: duration omitted (ffmpeg convention)
    }
    fs.writeFileSync(concatPath, lines.join('\n') + '\n', 'utf-8');

    const actualDurationMs = ts.length >= 2
      ? ts[ts.length - 1] - session.startedAt
      : Date.now() - session.startedAt;

    console.log(
      `[Recording] Compiling session ${session.sessionId}: ` +
      `${session.frameCount} frames, ${(actualDurationMs / 1000).toFixed(1)}s actual`
    );

    const outputPath = path.join(session.dir, 'output.mp4');

    try {
      // ffmpeg concat demuxer: per-frame durations for accurate real-time playback
      const vf = 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p';
      await execFileAsync('ffmpeg', [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatPath,
        '-vf', vf,
        '-c:v', 'libx264',
        '-crf', '23',
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ], { timeout: 120000 });

      const stat = fs.statSync(outputPath);
      const result: RecordingResult = {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        videoPath: outputPath,
        videoUrl: `/api/recordings/${session.sessionId}/video.mp4`,
        durationMs: actualDurationMs,
        frameCount: session.frameCount,
        fileSizeBytes: stat.size,
      };

      // Store in completed list, trim old ones
      this.completed.set(session.sessionId, result);
      if (this.completed.size > RecordingManager.MAX_COMPLETED) {
        const oldest = this.completed.keys().next().value;
        if (oldest) this.completed.delete(oldest);
      }

      console.log(
        `[Recording] Compiled ${session.sessionId}: ` +
        `${(stat.size / 1024 / 1024).toFixed(1)} MB, ${(actualDurationMs / 1000).toFixed(1)}s`
      );
      return result;
    } catch (err) {
      console.error(`[Recording] ffmpeg failed for ${session.sessionId}:`, err);
      return null;
    }
  }

  /** Get session for a device, if any */
  getSession(deviceId: string): RecordingSession | undefined {
    return this.sessions.get(deviceId);
  }

  /** Get a completed recording by sessionId */
  getResult(sessionId: string): RecordingResult | undefined {
    return this.completed.get(sessionId);
  }

  /** List all completed recordings (newest first) */
  listCompleted(): RecordingResult[] {
    return [...this.completed.values()].sort((a, b) => {
      const aTs = parseInt(a.sessionId.split('_').pop() || '0');
      const bTs = parseInt(b.sessionId.split('_').pop() || '0');
      return bTs - aTs;
    });
  }

  /**
   * Compile existing session asynchronously before starting a new one.
   * Fire-and-forget — doesn't block the new session from starting.
   */
  private stopExisting(deviceId: string): void {
    const existing = this.sessions.get(deviceId);
    if (existing) {
      this.sessions.delete(deviceId);
      console.log(`[Recording] Compiling existing session ${existing.sessionId} before new one`);
      this.compileFrames(existing).catch(err => {
        console.error(`[Recording] Failed to compile existing session:`, err);
      });
    }
  }

  /** Check if a device is currently recording */
  isRecording(deviceId: string): boolean {
    return this.sessions.has(deviceId);
  }
}
