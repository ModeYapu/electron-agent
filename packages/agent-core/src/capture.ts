/**
 * 截图服务
 * 使用 webContents.capturePage() 捕获页面截图
 */

import { BrowserWindow, nativeImage } from 'electron';
import type { ScreenshotData, MaskConfig } from '@electron-agent/shared';

export interface CaptureConfig {
  quality: number; // JPEG quality 0-100
  maskConfig?: MaskConfig; // Privacy masking configuration
  adaptiveQuality?: boolean; // Enable adaptive JPEG quality (default: true)
  adaptiveFPS?: boolean; // Enable adaptive FPS (default: true)
}

export class CaptureService {
  private captureInterval: NodeJS.Timeout | null = null;
  private currentQuality: number;
  private currentFPS: number;
  private lastActivity: number = Date.now();

  constructor(private win: BrowserWindow, private config: CaptureConfig) {
    this.currentQuality = config.quality;
    this.currentFPS = 1; // Start at 1 FPS
  }

  async capture(): Promise<ScreenshotData> {
    const image = await this.win.webContents.capturePage();
    let processedImage = image;

    // Apply privacy masks if configured
    if (this.config.maskConfig?.enabled) {
      processedImage = await this.applyPrivacyMasks(image);
    }

    // Adaptive JPEG quality
    let quality = this.config.quality;
    if (this.config.adaptiveQuality) {
      const size = processedImage.getSize();
      const estimatedSize = size.width * size.height * 0.1; // Rough estimate

      if (estimatedSize > 100 * 1024) { // If over 100KB
        quality = Math.max(50, quality - 10); // Reduce quality by 10%
        this.currentQuality = quality;
      } else if (estimatedSize < 50 * 1024) { // If under 50KB
        quality = Math.min(90, quality + 5); // Increase quality slightly
        this.currentQuality = quality;
      }
    }

    const size = processedImage.getSize();
    const width = size.width;
    const height = size.height;
    const jpeg = processedImage.toJPEG(quality);
    const data = jpeg.toString('base64');

    // Track activity for adaptive FPS
    this.lastActivity = Date.now();

    return {
      data,
      width,
      height,
      quality: quality,
      timestamp: Date.now(),
    };
  }

  private async applyPrivacyMasks(image: any): Promise<any> {
    if (!this.config.maskConfig?.enabled) {
      return image;
    }

    const { cssSelectors = [], fixedRegions = [], blurRadius = 10 } = this.config.maskConfig;

    // If no mask regions defined, return original image
    if (cssSelectors.length === 0 && fixedRegions.length === 0) {
      return image;
    }

    // Get mask regions
    const maskRegions = await this.getMaskRegions(cssSelectors, fixedRegions);

    if (maskRegions.length === 0) {
      return image;
    }

    // Apply blur effect to masked regions
    return this.blurRegions(image, maskRegions, blurRadius);
  }

  private async getMaskRegions(cssSelectors: string[], fixedRegions: Array<{ x: number; y: number; width: number; height: number }>): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
    const regions: Array<{ x: number; y: number; width: number; height: number }> = [];

    // Add fixed regions
    regions.push(...fixedRegions);

    // Get CSS selector regions
    if (cssSelectors.length > 0) {
      try {
        const selectorRegions = await this.win.webContents.executeJavaScript(`
          (() => {
            const regions = [];
            ${cssSelectors.map(selector => `
              document.querySelectorAll('${selector}').forEach(el => {
                const rect = el.getBoundingClientRect();
                regions.push({
                  x: Math.floor(rect.left),
                  y: Math.floor(rect.top),
                  width: Math.ceil(rect.width),
                  height: Math.ceil(rect.height)
                });
              });
            `).join('\n')}
            return regions;
          })()
        `);
        regions.push(...selectorRegions);
      } catch (err) {
        console.error('Failed to get CSS selector regions:', err);
      }
    }

    return regions;
  }

  private blurRegions(image: any, regions: Array<{ x: number; y: number; width: number; height: number }>, blurRadius: number): any {
    try {
      const size = image.getSize();
      const buffer = image.toBitmap();
      const bytesPerPixel = 4; // RGBA

      // Create a copy for the blurred image
      const blurredBuffer = Buffer.from(buffer);

      // Apply simple box blur to each region
      for (const region of regions) {
        const { x, y, width, height } = region;

        // Ensure region is within image bounds
        if (x < 0 || y < 0 || x + width > size.width || y + height > size.height) {
          continue;
        }

        // Apply blur to region
        for (let py = y; py < y + height; py++) {
          for (let px = x; px < x + width; px++) {
            const centerIdx = (py * size.width + px) * bytesPerPixel;
            let r = 0, g = 0, b = 0, count = 0;

            // Average surrounding pixels (simple blur)
            for (let dy = -blurRadius; dy <= blurRadius; dy++) {
              for (let dx = -blurRadius; dx <= blurRadius; dx++) {
                const nx = px + dx;
                const ny = py + dy;

                if (nx >= 0 && nx < size.width && ny >= 0 && ny < size.height) {
                  const idx = (ny * size.width + nx) * bytesPerPixel;
                  r += buffer[idx];
                  g += buffer[idx + 1];
                  b += buffer[idx + 2];
                  count++;
                }
              }
            }

            // Set averaged values
            blurredBuffer[centerIdx] = r / count;
            blurredBuffer[centerIdx + 1] = g / count;
            blurredBuffer[centerIdx + 2] = b / count;
            // Alpha remains unchanged
          }
        }
      }

      // Create new image from blurred buffer
      return nativeImage.createFromBuffer(blurredBuffer, {
        width: size.width,
        height: size.height,
      });
    } catch (err) {
      console.error('Failed to blur regions:', err);
      return image;
    }
  }

  startCaptureLoop(fps: number, callback: (screenshot: ScreenshotData) => void): void {
    this.stopCaptureLoop();

    const interval = 1000 / fps;
    this.currentFPS = fps;

    this.captureInterval = setInterval(async () => {
      try {
        // Adaptive FPS based on activity
        if (this.config.adaptiveFPS) {
          const timeSinceActivity = Date.now() - this.lastActivity;
          if (timeSinceActivity > 30000) { // No activity for 30 seconds
            // Slow down to 0.5 FPS
            if (this.currentFPS !== 0.5) {
              this.currentFPS = 0.5;
              this.startCaptureLoop(0.5, callback);
              return;
            }
          } else if (timeSinceActivity > 10000) { // No activity for 10 seconds
            // Slow down to 1 FPS
            if (this.currentFPS !== 1) {
              this.currentFPS = 1;
              this.startCaptureLoop(1, callback);
              return;
            }
          } else {
            // Recent activity, use higher FPS
            if (this.currentFPS !== fps) {
              this.currentFPS = fps;
            }
          }
        }

        const screenshot = await this.capture();
        callback(screenshot);
      } catch (err) {
        console.error('Failed to capture screenshot:', err);
      }
    }, interval);
  }

  stopCaptureLoop(): void {
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
  }

  isCapturing(): boolean {
    return this.captureInterval !== null;
  }

  getActivityLevel(): 'high' | 'medium' | 'low' {
    const timeSinceActivity = Date.now() - this.lastActivity;
    if (timeSinceActivity < 10000) return 'high';
    if (timeSinceActivity < 30000) return 'medium';
    return 'low';
  }

  getCurrentQuality(): number {
    return this.currentQuality;
  }

  getCurrentFPS(): number {
    return this.currentFPS;
  }
}
