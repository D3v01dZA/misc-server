import { Logger } from "winston";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

export interface DownloadResult {
  audioPath: string;
  thumbnailPath: string;
}

export class MediaDownloader {
  private logger: Logger;
  private mediaDir: string;

  constructor({ logger, mediaDir }: { logger: Logger; mediaDir: string }) {
    this.logger = logger;
    this.mediaDir = mediaDir;

    // Ensure media directory exists
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
      this.logger.info(`Created media directory: ${mediaDir}`);
    }
  }

  private extractVideoId(url: string): string | null {
    // Handle various YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
      /youtube\.com\/embed\/([^&\n?#]+)/,
      /youtube\.com\/v\/([^&\n?#]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  async download(
    feedId: number,
    url: string
  ): Promise<DownloadResult | null> {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      this.logger.warn(`Could not extract video ID from URL: ${url}`);
      return null;
    }

    const outputDir = path.join(this.mediaDir, feedId.toString(), videoId);
    
    // Check if already downloaded
    const audioPath = path.join(outputDir, "audio.mp3");
    const thumbnailPath = path.join(outputDir, "thumbnail.jpg");
    
    if (fs.existsSync(audioPath) && fs.existsSync(thumbnailPath)) {
      this.logger.debug(`Media already exists for ${videoId}, skipping download`);
      return {
        audioPath,
        thumbnailPath,
      };
    }

    // Create output directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      // Download audio as mp3
      const audioOutput = path.join(outputDir, "audio.%(ext)s");
      const audioCommand = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${audioOutput}" "${url}"`;
      
      const audioResult = await execAsync(audioCommand, { timeout: 300000 }); // 5 minute timeout
      
      // Download all thumbnail sizes to get highest quality
      const thumbnailCommand = `yt-dlp --write-all-thumbnails --skip-download --convert-thumbnails jpg -o "${path.join(outputDir, "thumbnail")}" "${url}"`;
      
      await execAsync(thumbnailCommand, { timeout: 60000 }); // 1 minute timeout

      // Verify files exist
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found after download: ${audioPath}`);
      }

      // Find the best quality thumbnail (prefer maxresdefault > hqdefault > others)
      const preferredThumbnails = [
        path.join(outputDir, "thumbnail.maxresdefault.jpg"),
        path.join(outputDir, "thumbnail.hqdefault.jpg"),
        path.join(outputDir, "thumbnail.sddefault.jpg"),
        path.join(outputDir, "thumbnail.jpg"),
      ];
      
      let finalThumbnailPath = thumbnailPath;
      let foundThumbnail = false;
      
      for (const preferredPath of preferredThumbnails) {
        if (fs.existsSync(preferredPath)) {
          if (preferredPath !== thumbnailPath) {
            // Copy best quality to standard location
            fs.copyFileSync(preferredPath, thumbnailPath);
          }
          finalThumbnailPath = thumbnailPath;
          foundThumbnail = true;
          break;
        }
      }
      
      // Clean up extra thumbnail files
      const files = fs.readdirSync(outputDir);
      for (const file of files) {
        if (file.startsWith("thumbnail.") && file !== "thumbnail.jpg") {
          fs.unlinkSync(path.join(outputDir, file));
        }
      }

      const stats = fs.statSync(audioPath);

      return {
        audioPath,
        thumbnailPath: fs.existsSync(finalThumbnailPath) ? finalThumbnailPath : "",
      };
    } catch (error) {
      this.logger.error(`Failed to download media for ${videoId}: ${error}`);
      
      // Clean up partial downloads
      try {
        if (fs.existsSync(outputDir)) {
          fs.rmSync(outputDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        this.logger.error(`Failed to clean up after failed download: ${cleanupError}`);
      }
      
      return null;
    }
  }

  getMediaUrl(audioPath: string, baseUrl: string): string {
    // Convert absolute path to relative URL
    const relativePath = path.relative(this.mediaDir, audioPath);
    return `${baseUrl}/media/${relativePath.replace(/\\/g, "/")}`;
  }

  getThumbnailUrl(thumbnailPath: string, baseUrl: string): string {
    // Convert absolute path to relative URL
    const relativePath = path.relative(this.mediaDir, thumbnailPath);
    return `${baseUrl}/media/${relativePath.replace(/\\/g, "/")}`;
  }
}