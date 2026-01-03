import type { Request, Response } from "express";
import { Logger } from "winston";
import { parseFeed, generateAtomFeed } from "feedsmith";
import type { Atom } from "feedsmith/types";

const HEADERS_TO_COPY = new Set<string>([
  "cache-control",
  "date",
  "expires",
  "age",
]);

const _RSSError = {
  fetch: "FETCH",
  parse: "PARSE",
  unsupported: "UNSUPPORTED",
  unknown: "UNKNOWN",
} as const;

const SHORTS_RESULTS: { [id: string]: boolean } = {};
const COUNTRY_RESULTS: { [id: string]: boolean } = {};

type RSSError = (typeof _RSSError)[keyof typeof _RSSError];

type RSSHeaders = {
  [key: string]: string;
};

type RSSResult =
  | RSSError
  | {
      feed: Atom.Feed<Date>;
      headers: RSSHeaders;
    };

type Filter = (entry: Atom.Entry<string>) => Promise<boolean>;

type RSSFilter = {
  url: string;
  filter: Filter;
};

export class RSSHandler {
  private logger: Logger;

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger;
  }

  async handle(req: Request, res: Response) {
    const params = this.parseParams(req);
    if (!params) {
      res.status(400).json({ error: `Failed to parse params` });
    } else {
      const { url, filter } = params;
      const result = await this.rss(url, filter);
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
        res.set("Content-Type", "application/atom+xml; charset=utf-8");
        Object.entries(result.headers).forEach(([key, value]) => {
          res.set(key, value);
        });
        const feed = generateAtomFeed(result.feed);
        res.send(feed);
      }
    }
  }

  extractArray(req: Request, name: string): string[] {
    const param = req.query[name];
    if (typeof param === "string") {
      return param.toLowerCase().split(",");
    }
    if (Array.isArray(param)) {
      return param
        .filter((value) => typeof value === "string")
        .map((value) => value.toLowerCase().split(","))
        .flat();
    }
    return [];
  }

  parseParams(req: Request): RSSFilter | undefined {
    const url = req.query["url"];
    if (!url || typeof url !== "string") {
      return undefined;
    }
    const includes = this.extractArray(req, "includetext");
    const excludes = this.extractArray(req, "excludetext");
    const filters = this.extractArray(req, "filter");
    this.logger.debug(
      `Filtering ${url} with includes [${includes}] excludes [${excludes}] filters [${filters}]`,
    );
    return {
      url: url,
      filter: this.filter(url, includes, excludes, filters),
    };
  }

  filter(
    url: string,
    includes: string[],
    excludes: string[],
    filters: string[],
  ): Filter {
    return async (entry) => {
      const entryJSON = JSON.stringify(entry).toLowerCase();
      // Quickly include
      for (const include of includes) {
        if (!entryJSON.includes(include)) {
          this.logger.debug(
            `Filtering feed ${url} entry ${entry.title} because it doesn't include ${include}`,
          );
          return true;
        }
      }
      // Quickly exclude
      for (const exclude of excludes) {
        if (entryJSON.includes(exclude)) {
          this.logger.debug(
            `Filtering feed ${url} entry ${entry.title} because it includes ${exclude}`,
          );
          return true;
        }
      }
      // Run other filters
      for (const filter of filters) {
        if (filter === "shorts") {
          // Check the quick path which is its link
          for (const link of entry.links ?? []) {
            if (link.href.includes("/shorts/")) {
              this.logger.debug(
                `Filtering feed ${url} entry ${entry.title} because it is a short ${link.href}`,
              );
              return true;
            }
          }
          // Also HEAD the short path to check if we get a redirect
          const split = entry.id.split(":");
          if (split.length === 3) {
            const actualId = split[2]!!;
            const result = SHORTS_RESULTS[actualId];
            if (result === undefined) {
              const response = await fetch(
                `https://www.youtube.com/shorts/${actualId}`,
                {
                  redirect: "manual",
                  method: "HEAD",
                },
              );
              const _ = await response.text();
              if (!response.headers.has("location")) {
                SHORTS_RESULTS[actualId] = true;
                this.logger.debug(
                  `Filtering feed ${url} entry ${entry.title} because it is a short`,
                );
                return true;
              }
              SHORTS_RESULTS[actualId] = false;
            }
            if (result === true) {
              this.logger.debug(
                `Filtering feed ${url} entry ${entry.title} because it is a short [cached]`,
              );
              return true;
            }
          } else {
            this.logger.warn(
              `Filtering feed ${url} short filter missing id ${entry.id}`,
            );
          }
        } else if (filter === "country") {
          const split = entry.id.split(":");
          if (split.length === 3) {
            const actualId = split[2]!!;
            const result = COUNTRY_RESULTS[actualId];
            if (result === undefined) {
              const response = await fetch(
                `https://www.youtube.com/watch?v=${actualId}`,
                {
                  redirect: "manual",
                },
              );
              const text = await response.text();
              if (
                text.includes(
                  "The uploader has not made this video available in your country",
                )
              ) {
                COUNTRY_RESULTS[actualId] = true;
                this.logger.debug(
                  `Filtering feed ${url} entry ${entry.title} because it is out of country`,
                );
                return true;
              }
              COUNTRY_RESULTS[actualId] = false;
            }
            if (result === true) {
              this.logger.debug(
                `Filtering feed ${url} entry ${entry.title} because it is out of country [cached]`,
              );
              return true;
            }
          } else {
            this.logger.warn(
              `Filtering feed ${url} country filter missing id ${entry.id}`,
            );
          }
        } else {
          this.logger.warn(`Filtering feed ${url} unknown filter ${filter}`);
        }
      }
      return false;
    };
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async rss(url: string, filter: Filter): Promise<RSSResult> {
    try {
      this.logger.debug(`Fetching YouTube RSS feed from ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        this.logger.error(
          `Failed to fetch RSS feed: ${response.status} ${response.statusText}`,
        );
        return Promise.resolve("FETCH");
      }

      const headers: RSSHeaders = {};
      response.headers.forEach((value, key) => {
        if (HEADERS_TO_COPY.has(key)) {
          headers[key] = value;
        }
      });

      const feedData = await response.text();
      this.logger.debug(`Successfully processed RSS feed ${url}`);

      try {
        const parsed = parseFeed(feedData);
        let feed: Atom.Feed<Date>;
        if (parsed.format === "atom") {
          const original = parsed.feed as Atom.Feed<string>;
          feed = {
            ...(original.authors && { authors: original.authors }),
            ...(original.categories && { categories: original.categories }),
            ...(original.contributors && { contributors: original.contributors }),
            ...(original.generator && { generator: original.generator }),
            ...(original.icon && { icon: original.icon }),
            id: original.id,
            ...(original.logo && { logo: original.logo }),
            ...(original.rights && { rights: original.rights }),
            ...(original.subtitle && { subtitle: original.subtitle }),
            title: original.title,
            updated: new Date(original.updated),
            ...(await (async () => {
              const entries = await this.filterEntries(original.entries, filter);
              return entries ? { entries } : {};
            })()),
            ...(original.itunes && { itunes: original.itunes }),
            ...(original.media && { media: original.media }),
            ...(original.georss && { georss: original.georss }),
            ...(original.yt && { yt: original.yt }),
          };
        } else {
          return Promise.resolve("UNSUPPORTED");
        }

        this.logger.info(
          `Successfully sent RSS feed ${url} with ${feed.entries?.length ?? 0}/${parsed.feed.entries?.length ?? 0} entries`,
        );
        return Promise.resolve({ feed, headers });
      } catch (error) {
        this.logger.error(`Error parsing RSS feed ${url}: ${error}`);
        return Promise.resolve("PARSE");
      }
    } catch (error) {
      this.logger.error(`Error fetching RSS feed ${url}: ${error}`);
      return Promise.resolve("UNKNOWN");
    }
  }

  async filterEntries(
    entries: Atom.Entry<string>[] | undefined,
    filter: Filter,
  ): Promise<Atom.Entry<Date>[] | undefined> {
    if (!entries) return undefined;

    // Creates an array of { entry, shouldInclude: boolean }
    const results = await Promise.all(
      entries.map(async (entry) => ({
        entry,
        shouldInclude: !(await filter(entry)),
      })),
    );

    // Ties it all together
    return results
      .filter(({ shouldInclude }) => shouldInclude)
      .map(({ entry }) => this.atomEntry(entry));
  }

  atomEntry(entry: Atom.Entry<string>): Atom.Entry<Date> {
    return {
      ...(entry.authors && { authors: entry.authors }),
      ...(entry.categories && { categories: entry.categories }),
      ...(entry.content && { content: entry.content }),
      ...(entry.contributors && { contributors: entry.contributors }),
      id: entry.id,
      ...(entry.rights && { rights: entry.rights }),
      ...(entry.summary && { summary: entry.summary }),
      title: entry.title,
      updated: new Date(entry.updated),
      ...(entry.slash && { slash: entry.slash }),
      ...(entry.itunes && { itunes: entry.itunes }),
      ...(entry.psc && { psc: entry.psc }),
      ...(entry.media && { media: entry.media }),
      ...(entry.georss && { georss: entry.georss }),
      ...(entry.thr && { thr: entry.thr }),
      ...(entry.wfw && { wfw: entry.wfw }),
      ...(entry.yt && { yt: entry.yt }),
    };
  }
}
