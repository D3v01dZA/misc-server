import express from "express";
import type { Request, Response } from "express";
import winston from "winston";
import path from "path";
import { RSSHandler } from "./rss";
import { PodcastHandler } from "./podcast";
import { PodcastDatabase } from "./podcast-db";
import { MediaDownloader } from "./media-downloader";

const app = express();
const port = 3000;

// Configure storage paths based on environment
const storagePath = process.env.NODE_ENV === "production"
  ? "/storage/podcasts/podcasts.db"
  : path.join(process.cwd(), "build", "storage", "podcasts.db");

const mediaDir = process.env.NODE_ENV === "production"
  ? "/storage/podcasts/media"
  : path.join(process.cwd(), "build", "storage", "media");

const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`,
    ),
  ),
  transports: [new winston.transports.Console({ forceConsole: true })],
});

const rssHandler = new RSSHandler({ logger });
const podcastDb = new PodcastDatabase({ storagePath, logger });
const mediaDownloader = new MediaDownloader({ logger, mediaDir });
const podcastHandler = new PodcastHandler({ 
  logger, 
  rssHandler, 
  db: podcastDb, 
  downloader: mediaDownloader,
  baseUrl 
});

// Logging middleware
app.use((req: Request, res: Response, next) => {
  const startTime = Date.now();
  logger.info(`→ ${req.method} ${req.url} started`);
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    logger.info(
      `← ${req.method} ${req.url} completed [${res.statusCode}] in ${duration}ms`,
    );
  });
  next();
});

// Root route
app.get("/", async (_: Request, res: Response) => {
  res.status(200).send("Root");
});

// RSS route
app.get("/rss", async (req: Request, res: Response) => {
  await rssHandler.handle(req, res);
});

// Podcast route
app.get("/podcast", async (req: Request, res: Response) => {
  await podcastHandler.handle(req, res);
});

// Media serving route
app.use("/media", express.static(mediaDir));

// Default route
app.use((_: Request, res: Response) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(port, () => {
  logger.info(`Misc listening on port ${port}`);
  logger.info(`Podcast storage path: ${storagePath}`);
  logger.info(`Media directory: ${mediaDir}`);
  logger.info(`Base URL: ${baseUrl}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, closing database connections");
  podcastDb.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, closing database connections");
  podcastDb.close();
  process.exit(0);
});
