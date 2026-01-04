import Database from "better-sqlite3";
import type { Rss } from "feedsmith/types";
import { Logger } from "winston";
import path from "path";
import fs from "fs";

export interface StoredFeed {
  id: number;
  url: string;
  title: string;
  description: string;
  link: string;
  lastBuildDate?: string;
  copyright?: string;
  generator?: string;
  imageUrl?: string;
  imageTitle?: string;
  imageLink?: string;
  itunesData?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredItem {
  id: number;
  feedId: number;
  guid: string;
  title?: string;
  link?: string;
  description: string;
  pubDate?: string;
  authors?: string;
  content?: string;
  categories?: string;
  mediaData?: string;
  itunesData?: string;
  audioPath?: string;
  thumbnailPath?: string;
  createdAt: string;
  updatedAt: string;
}

export class PodcastDatabase {
  private db: Database.Database;
  private logger: Logger;

  constructor({ storagePath, logger }: { storagePath: string; logger: Logger }) {
    this.logger = logger;

    // Ensure the storage directory exists
    const dir = path.dirname(storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.info(`Created storage directory: ${dir}`);
    }

    this.db = new Database(storagePath);
    this.db.pragma("journal_mode = WAL");
    this.initDatabase();
  }

  private initDatabase() {
    // Create schema version table for migrations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Get current schema version
    const versionResult = this.db
      .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
      .get() as { version: number } | undefined;
    const currentVersion = versionResult?.version || 0;

    this.logger.info(`Current database schema version: ${currentVersion}`);

    // Run migrations
    this.runMigrations(currentVersion);

    this.logger.info("Database initialized");
  }

  private runMigrations(currentVersion: number) {
    const migrations = [
      // Migration 1: Initial schema
      () => {
        this.logger.info("Running migration 1: Initial schema");
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS feeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            link TEXT NOT NULL,
            lastBuildDate TEXT,
            copyright TEXT,
            generator TEXT,
            imageUrl TEXT,
            imageTitle TEXT,
            imageLink TEXT,
            itunesData TEXT,
            createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feedId INTEGER NOT NULL,
            guid TEXT NOT NULL,
            title TEXT,
            link TEXT,
            description TEXT NOT NULL,
            pubDate TEXT,
            authors TEXT,
            content TEXT,
            categories TEXT,
            mediaData TEXT,
            itunesData TEXT,
            audioPath TEXT,
            thumbnailPath TEXT,
            createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (feedId) REFERENCES feeds(id) ON DELETE CASCADE,
            UNIQUE(feedId, guid)
          );

          CREATE INDEX IF NOT EXISTS idx_items_feedId ON items(feedId);
          CREATE INDEX IF NOT EXISTS idx_items_guid ON items(guid);
          CREATE INDEX IF NOT EXISTS idx_items_pubDate ON items(pubDate DESC);
        `);
      },
    ];

    // Run migrations that haven't been applied yet
    for (let i = currentVersion; i < migrations.length; i++) {
      const migrationVersion = i + 1;
      this.logger.info(`Applying migration ${migrationVersion}...`);
      
      const migration = migrations[i];
      if (migration) {
        migration();
        this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migrationVersion);
        this.logger.info(`Migration ${migrationVersion} applied successfully`);
      }
    }
  }

  getOrCreateFeed(url: string, feedData: Rss.Feed<Date>): StoredFeed {
    const existing = this.db
      .prepare("SELECT * FROM feeds WHERE url = ?")
      .get(url) as StoredFeed | undefined;

    if (existing) {
      // Update the feed metadata
      this.db
        .prepare(
          `UPDATE feeds SET 
            title = ?, 
            description = ?, 
            link = ?,
            lastBuildDate = ?,
            copyright = ?,
            generator = ?,
            imageUrl = ?,
            imageTitle = ?,
            imageLink = ?,
            itunesData = ?,
            updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`
        )
        .run(
          feedData.title,
          feedData.description,
          feedData.link || "",
          feedData.lastBuildDate ? feedData.lastBuildDate.toISOString() : null,
          feedData.copyright || null,
          feedData.generator || null,
          feedData.image?.url || null,
          feedData.image?.title || null,
          feedData.image?.link || null,
          feedData.itunes ? JSON.stringify(feedData.itunes) : null,
          existing.id
        );
      this.logger.debug(`Updated feed metadata for ${url}`);
      return this.db
        .prepare("SELECT * FROM feeds WHERE id = ?")
        .get(existing.id) as StoredFeed;
    } else {
      // Create new feed
      const result = this.db
        .prepare(
          `INSERT INTO feeds (
            url, title, description, link, lastBuildDate, copyright, 
            generator, imageUrl, imageTitle, imageLink, itunesData
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          url,
          feedData.title,
          feedData.description,
          feedData.link || "",
          feedData.lastBuildDate ? feedData.lastBuildDate.toISOString() : null,
          feedData.copyright || null,
          feedData.generator || null,
          feedData.image?.url || null,
          feedData.image?.title || null,
          feedData.image?.link || null,
          feedData.itunes ? JSON.stringify(feedData.itunes) : null
        );
      this.logger.info(`Created new feed for ${url}`);
      return this.db
        .prepare("SELECT * FROM feeds WHERE id = ?")
        .get(result.lastInsertRowid) as StoredFeed;
    }
  }

  upsertItems(feedId: number, items: Rss.Item<Date>[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO items (
        feedId, guid, title, link, description, pubDate, authors, 
        content, categories, mediaData, itunesData, audioPath, thumbnailPath
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feedId, guid) DO UPDATE SET
        title = excluded.title,
        link = excluded.link,
        description = excluded.description,
        pubDate = excluded.pubDate,
        authors = excluded.authors,
        content = excluded.content,
        categories = excluded.categories,
        mediaData = excluded.mediaData,
        itunesData = excluded.itunesData,
        audioPath = COALESCE(excluded.audioPath, audioPath),
        thumbnailPath = COALESCE(excluded.thumbnailPath, thumbnailPath),
        updatedAt = CURRENT_TIMESTAMP`
    );

    const transaction = this.db.transaction((items: Rss.Item<Date>[]) => {
      let count = 0;
      for (const item of items) {
        const guid = item.guid?.value || item.link || `${feedId}-${item.title}`;
        stmt.run(
          feedId,
          guid,
          item.title || null,
          item.link || null,
          item.description,
          item.pubDate ? item.pubDate.toISOString() : null,
          item.authors ? JSON.stringify(item.authors) : null,
          item.content?.encoded || null,
          item.categories ? JSON.stringify(item.categories) : null,
          item.media ? JSON.stringify(item.media) : null,
          item.itunes ? JSON.stringify(item.itunes) : null,
          null, // audioPath - will be set by download service
          null  // thumbnailPath - will be set by download service
        );
        count++;
      }
      return count;
    });

    return transaction(items);
  }

  getItems(feedId: number, limit?: number): StoredItem[] {
    const query = limit
      ? "SELECT * FROM items WHERE feedId = ? ORDER BY pubDate DESC, id DESC LIMIT ?"
      : "SELECT * FROM items WHERE feedId = ? ORDER BY pubDate DESC, id DESC";

    const params = limit ? [feedId, limit] : [feedId];
    return this.db.prepare(query).all(...params) as StoredItem[];
  }

  storedFeedToRss(feed: StoredFeed, items: StoredItem[]): Rss.Feed<Date> {
    return {
      title: feed.title,
      description: feed.description,
      link: feed.link,
      ...(feed.lastBuildDate && { lastBuildDate: new Date(feed.lastBuildDate) }),
      ...(feed.copyright && { copyright: feed.copyright }),
      ...(feed.generator && { generator: feed.generator }),
      ...(feed.imageUrl && {
        image: {
          url: feed.imageUrl,
          title: feed.imageTitle || feed.title,
          link: feed.imageLink || feed.link,
        },
      }),
      ...(feed.itunesData && { itunes: JSON.parse(feed.itunesData) }),
      items: items.map((item) => this.storedItemToRssItem(item)),
    };
  }

  private storedItemToRssItem(item: StoredItem): Rss.Item<Date> {
    const rssItem: Rss.Item<Date> = {
      ...(item.title && { title: item.title }),
      description: item.description,
      ...(item.guid && { guid: { value: item.guid, isPermaLink: false } }),
      ...(item.pubDate && { pubDate: new Date(item.pubDate) }),
      ...(item.authors && { authors: JSON.parse(item.authors) }),
      ...(item.content && { content: { encoded: item.content } }),
      ...(item.categories && { categories: JSON.parse(item.categories) }),
      ...(item.itunesData && { itunes: JSON.parse(item.itunesData) }),
    };

    // Add enclosure if we have downloaded audio (size will be calculated dynamically)
    if (item.audioPath) {
      rssItem.enclosures = [{
        url: item.audioPath, // This will be updated to a proper URL by the handler
        length: 0, // Will be set dynamically when reading file stats
        type: "audio/mpeg"
      }];
    }

    // Add iTunes image if we have a thumbnail
    if (item.thumbnailPath) {
      if (!rssItem.itunes) {
        rssItem.itunes = {};
      }
      rssItem.itunes.image = item.thumbnailPath; // Will be updated to a proper URL by the handler
    }

    return rssItem;
  }

  updateItemMedia(feedId: number, guid: string, audioPath: string, thumbnailPath: string) {
    this.db
      .prepare(
        `UPDATE items SET 
          audioPath = ?,
          thumbnailPath = ?,
          updatedAt = CURRENT_TIMESTAMP
        WHERE feedId = ? AND guid = ?`
      )
      .run(audioPath, thumbnailPath, feedId, guid);
  }

  getItemsNeedingDownload(feedId: number, limit: number = 10): StoredItem[] {
    // First, let's see all items for this feed
    const allItems = this.db
      .prepare(`SELECT id, guid, link, audioPath FROM items WHERE feedId = ?`)
      .all(feedId) as Array<{ id: number; guid: string; link: string | null; audioPath: string | null }>;
    
    this.logger.info(`Total items in feed ${feedId}: ${allItems.length}`);
    allItems.forEach((item) => {
      this.logger.info(`  Item ${item.id}: guid=${item.guid}, link=${item.link ? 'YES' : 'NULL'}, audioPath=${item.audioPath ? 'YES' : 'NULL'}`);
    });
    
    const items = this.db
      .prepare(
        `SELECT * FROM items 
         WHERE feedId = ? AND audioPath IS NULL AND link IS NOT NULL
         ORDER BY pubDate DESC, id DESC
         LIMIT ?`
      )
      .all(feedId, limit) as StoredItem[];
    
    this.logger.info(`getItemsNeedingDownload(feedId=${feedId}, limit=${limit}) returned ${items.length} items`);
    if (items.length > 0 && items[0]) {
      this.logger.info(`First item to download: ${items[0].guid} - ${items[0].link}`);
    }
    
    return items;
  }

  close() {
    this.db.close();
  }
}