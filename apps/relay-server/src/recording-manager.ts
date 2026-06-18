/**
 * RecordingManager — manages screenshot frame capture and ffmpeg video compilation.
 *
 * Lifecycle:
 *   startSession(deviceId) → saveFrame(deviceId, base64) … → stopSession(deviceId) → mp4
 *
 * Directory layout:
 *   D:\O_T_O\test\electron-agent\apps\relay-server\recordings\<sessionId>\
 *     frame_00001.png
 *     frame_00002.png
 *     …
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
   * Start a recording session for a device.  Stops any existing session first.
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
    };
    this.sessions.set(deviceId, session);
    console.log(`[Recording] Started session ${sessionId} for device ${deviceId.slice(0, 8)}...`);
    return session;
  }

  /**
   * Save a base64-encoded JPEG/PNG screenshot as a numbered frame file.
   * Frames are saved as PNG so ffmpeg can read them as an image sequence.
   */
  saveFrame(deviceId: string, base64Data: string): number {
    const session = this.sessions.get(deviceId);
    if (!session) return 0;

    session.frameCount++;
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
    const elapsed = Date.now() - session.startedAt;

    console.log(
      `[Recording] Stopping session ${session.sessionId}: ` +
      `${session.frameCount} frames, ${elapsed}ms`
    );

    if (session.frameCount === 0) {
      console.warn(`[Recording] No frames captured for ${session.sessionId}, removing dir`);
      fs.rmSync(session.dir, { recursive: true, force: true });
      return null;
    }

    const outputPath = path.join(session.dir, 'output.mp4');
    const inputPattern = path.join(session.dir, 'frame_%05d.jpg');

    try {
      // ffmpeg: 2 FPS, H.264.  pad to even dimensions (H.264 requirement).
      const vf = 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos';
      await execFileAsync('ffmpeg', [
        '-framerate', '2',
        '-i', inputPattern,
        '-vf', vf,
        '-c:v', 'libx264',
        '-crf', '23',
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-y',  // overwrite
        outputPath,
      ], { timeout: 60000 });

      const stat = fs.statSync(outputPath);
      const result: RecordingResult = {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        videoPath: outputPath,
        videoUrl: `/api/recordings/${session.sessionId}/video.mp4`,
        durationMs: elapsed,
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
        `${(stat.size / 1024 / 1024).toFixed(1)} MB, ${elapsed}ms`
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
      // Parse timestamp from sessionId (format: deviceId_<ts>)
      const aTs = parseInt(a.sessionId.split('_').pop() || '0');
      const bTs = parseInt(b.sessionId.split('_').pop() || '0');
      return bTs - aTs;
    });
  }

  /** Stop and cleanup an existing session for the device */
  private stopExisting(deviceId: string): void {
    const existing = this.sessions.get(deviceId);
    if (existing) {
      console.log(`[Recording] Stopping existing session ${existing.sessionId}`);
      this.sessions.delete(deviceId);
      // Clean up frames dir without compiling
      try {
        fs.rmSync(existing.dir, { recursive: true, force: true });
      } catch (_) { /* ok */ }
    }
  }

  /** Check if a device is currently recording */
  isRecording(deviceId: string): boolean {
    return this.sessions.has(deviceId);
  }
}
