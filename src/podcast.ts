import type { Request, Response } from "express";
import { Logger } from "winston";
import { generateRssFeed } from "feedsmith";
import type { Rss, Atom } from "feedsmith/types";
import { RSSHandler } from "./rss";
import { PodcastDatabase } from "./podcast-db";
import { MediaDownloader } from "./media-downloader";
import fs from "fs";
import path from "path";

export class PodcastHandler {
  private logger: Logger;
  private rssHandler: RSSHandler;
  private db: PodcastDatabase;
  private downloader: MediaDownloader;
  private baseUrl: string;

  constructor({ 
    logger, 
    rssHandler, 
    db, 
    downloader, 
    baseUrl 
  }: { 
    logger: Logger; 
    rssHandler: RSSHandler; 
    db: PodcastDatabase; 
    downloader: MediaDownloader;
    baseUrl: string;
  }) {
    this.logger = logger;
    this.rssHandler = rssHandler;
    this.db = db;
    this.downloader = downloader;
    this.baseUrl = baseUrl;
  }

  async handle(req: Request, res: Response) {
    const params = this.rssHandler.parseParams(req);
    if (!params) {
      res.status(400).json({ error: `Failed to parse params` });
    } else {
      const { url, filter } = params;
      
      // Get optional title and description overrides from query parameters
      const titleOverride = req.query["title"];
      const customTitle = typeof titleOverride === "string" ? titleOverride : undefined;
      const descriptionOverride = req.query["description"];
      const customDescription = typeof descriptionOverride === "string" ? descriptionOverride : undefined;
      const result = await this.rssHandler.rss(url, filter);
      if (typeof result === "string") {
        if (result === "FETCH") {
          res.status(400).json({ error: `Failed to fetch RSS feed ${url}` });
        } else if (result === "PARSE") {
          res.status(400).json({ error: `Failed to parse RSS feed ${url}` });
        } else if (result === "UNSUPPORTED") {
          res.status(400).json({ error: `Unsupported RSS feed ${url}` });
        } else {
          res.status(500).json({ error: "Internal server error" });
        }
      } else {
        res.status(200);
        res.set("Content-Type", "application/rss+xml; charset=utf-8");
        Object.entries(result.headers).forEach(([key, value]) => {
          res.set(key, value);
        });
        
        // Convert Atom to RSS
        const rssFeed = this.convertAtomToRss(result.feed);
        
        // Apply custom title and description if provided
        if (customTitle) {
          rssFeed.title = customTitle;
        }
        if (customDescription) {
          rssFeed.description = customDescription;
        }
        
        // Extract channel ID from URL
        const channelIdMatch = url.match(/channel_id=([^&]+)/);
        const channelId = channelIdMatch ? channelIdMatch[1] : null;
        
        // Store in database and get merged results
        const storedFeed = this.db.getOrCreateFeed(url, rssFeed);
        const newItemCount = rssFeed.items?.length ?? 0;
        
        if (rssFeed.items && rssFeed.items.length > 0) {
          this.db.upsertItems(storedFeed.id, rssFeed.items);
        }
        
        // Download media synchronously before returning feed
        await this.scheduleDownloads(storedFeed.id);
        
        // Get all items from database (merged with historical data)
        const storedItems = this.db.getItems(storedFeed.id);
        const mergedFeed = this.db.storedFeedToRss(storedFeed, storedItems);
        
        // Update enclosure URLs and thumbnail URLs to point to our server
        if (mergedFeed.items) {
          for (const item of mergedFeed.items) {
            // Update audio enclosure URLs and calculate file sizes
            if (item.enclosures && item.enclosures.length > 0 && item.enclosures[0]) {
              const audioPath = item.enclosures[0].url;
              item.enclosures[0].url = this.downloader.getMediaUrl(
                audioPath,
                this.baseUrl
              );
              
              // Calculate file size dynamically
              if (fs.existsSync(audioPath)) {
                const stats = fs.statSync(audioPath);
                item.enclosures[0].length = stats.size;
              }
            }
            
            // Update episode thumbnail URL (iTunes image)
            if (item.itunes && item.itunes.image) {
              const thumbnailPath = item.itunes.image as string;
              if (fs.existsSync(thumbnailPath)) {
                const thumbnailUrl = this.downloader.getMediaUrl(
                  thumbnailPath,
                  this.baseUrl
                );
                item.itunes.image = thumbnailUrl;
              }
            }
          }
        }
        
        // Set channel thumbnail by fetching from YouTube
        if (!mergedFeed.itunes) {
          mergedFeed.itunes = {};
        }
        
        if (channelId) {
          const channelThumbnail = await this.getChannelThumbnail(storedFeed.id, channelId);
          if (channelThumbnail) {
            mergedFeed.itunes.image = this.downloader.getMediaUrl(channelThumbnail, this.baseUrl);
          }
        }
        
        // Generate and send the feed
        const feed = generateRssFeed(mergedFeed);
        this.logger.info(
          `Successfully sent podcast feed ${url} with ${storedItems.length} entries (${newItemCount} new from source, ${result.feed.entries?.length ?? 0} filtered from source)`,
        );
        res.send(feed);
      }
    }
  }

  private convertAtomToRss(atomFeed: Atom.Feed<Date>): Rss.Feed<Date> {
    const link = atomFeed.links?.[0]?.href || "";
    
    // Validate lastBuildDate is a valid Date object
    const lastBuildDate = atomFeed.updated && !isNaN(atomFeed.updated.getTime()) 
      ? atomFeed.updated 
      : undefined;
    
    return {
      title: atomFeed.title,
      description: atomFeed.subtitle || atomFeed.title,
      link: link,
      ...(lastBuildDate && { lastBuildDate }),
      ...(atomFeed.rights && { copyright: atomFeed.rights }),
      ...(atomFeed.generator && {
        generator: typeof atomFeed.generator === "string"
          ? atomFeed.generator
          : atomFeed.generator.text,
      }),
      ...(atomFeed.logo && { 
        image: { 
          url: atomFeed.logo, 
          title: atomFeed.title,
          link: link,
        } 
      }),
      ...(atomFeed.entries && {
        items: atomFeed.entries.map((entry) => this.convertAtomEntryToRssItem(entry)),
      }),
      ...(atomFeed.itunes && { itunes: atomFeed.itunes }),
    };
  }

  private convertAtomEntryToRssItem(entry: Atom.Entry<Date>): Rss.Item<Date> {
    let link = entry.links?.[0]?.href;
    
    // If no link, try to construct YouTube URL from the video ID in the GUID
    if (!link && entry.id) {
      const match = entry.id.match(/yt:video:([^:]+)/);
      if (match && match[1]) {
        link = `https://www.youtube.com/watch?v=${match[1]}`;
      }
    }
    const author = entry.authors?.[0]
      ? (entry.authors[0].email || entry.authors[0].name)
      : undefined;
    
    // Validate pubDate is a valid Date object
    const pubDate = entry.updated && !isNaN(entry.updated.getTime())
      ? entry.updated
      : undefined;
    
    const categories: Rss.Category[] | undefined = entry.categories?.map((cat) => {
      if (typeof cat === "string") {
        return { name: cat };
      } else {
        const category: Rss.Category = { name: cat.term };
        if (cat.scheme) {
          category.domain = cat.scheme;
        }
        return category;
      }
    });

    // RSS items must have either title or description
    const item: Rss.Item<Date> = {
      ...(entry.title && { title: entry.title }),
      ...(link && { link }), // Include link for database storage (will be removed from feed output)
      description: entry.summary || entry.content || entry.title || "",
      ...(entry.id && { guid: { value: entry.id, isPermaLink: false } }),
      ...(pubDate && { pubDate }),
      ...(author && { authors: [author] }),
      ...(entry.content && { content: { encoded: entry.content } }),
      ...(categories && { categories }),
      ...(entry.itunes && { itunes: entry.itunes }),
    };
    
    return item;
  }

  private async scheduleDownloads(feedId: number) {
    // Get items that need downloading
    const itemsToDownload = this.db.getItemsNeedingDownload(feedId, 5);
    
    if (itemsToDownload.length === 0) {
      return;
    }

    this.logger.info(`Downloading ${itemsToDownload.length} items...`);

    // Download synchronously (block until complete)
    for (const item of itemsToDownload) {
      if (!item.link) {
        continue;
      }

      try {
        const result = await this.downloader.download(feedId, item.link);
        
        if (result) {
          this.db.updateItemMedia(
            feedId,
            item.guid,
            result.audioPath,
            result.thumbnailPath
          );
        }
      } catch (error) {
        this.logger.error(`Failed to download media for ${item.guid}: ${error}`);
      }
    }
  }

  private async getChannelThumbnail(feedId: number, channelId: string): Promise<string | null> {
    const channelDir = path.join(this.downloader['mediaDir'], feedId.toString(), 'channel');
    const thumbnailPath = path.join(channelDir, 'avatar.jpg');

    // Check if already downloaded
    if (fs.existsSync(thumbnailPath)) {
      return thumbnailPath;
    }

    // Create directory
    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }

    try {
      const channelUrl = `https://www.youtube.com/channel/${channelId}`;
      
      // Use yt-dlp to get channel thumbnail
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      // Download all thumbnail sizes to get highest quality
      const command = `yt-dlp --write-all-thumbnails --skip-download --convert-thumbnails jpg --playlist-items 0 -o "${path.join(channelDir, 'avatar')}" "${channelUrl}"`;
      
      await execAsync(command, { timeout: 60000 });
      
      // Find the channel avatar (yt-dlp saves it as avatar_uncropped)
      const preferredThumbnails = [
        path.join(channelDir, "avatar.avatar_uncropped.jpg"),
        path.join(channelDir, "avatar.jpg"),
      ];
      
      let foundThumbnail = false;
      for (const preferredPath of preferredThumbnails) {
        if (fs.existsSync(preferredPath)) {
          if (preferredPath !== thumbnailPath) {
            fs.copyFileSync(preferredPath, thumbnailPath);
          }
          foundThumbnail = true;
          break;
        }
      }
      
      // Clean up extra thumbnail files
      const files = fs.readdirSync(channelDir);
      for (const file of files) {
        if (file.startsWith("avatar.") && file !== "avatar.jpg") {
          fs.unlinkSync(path.join(channelDir, file));
        }
      }
      
      if (foundThumbnail) {
        return thumbnailPath;
      } else {
        return null;
      }
    } catch (error) {
      this.logger.error(`Failed to download channel avatar: ${error}`);
      return null;
    }
  }
}