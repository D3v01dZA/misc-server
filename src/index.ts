import express from "express";
import type { Request, Response } from "express";
import winston from "winston";
import { RSSHandler } from "./rss.ts";

const app = express();
const port = 3000;

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

// Logging middleware
app.use((req: Request, res: Response, next) => {
  const startTime = Date.now();
  logger.info(`→ ${req.method} ${req.path} started`);
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

// Default route
app.use((_: Request, res: Response) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(port, () => {
  logger.info(`Misc listening on port ${port}`);
});
