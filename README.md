# misc-server

Server just runs a stuff I find useful

```
docker run -p 8080:8080 d3v01d/misc-server:stable
```

Or with docker-compose (includes persistent storage for podcasts):

```
docker-compose up -d
```

## APIs

### GET /rss

Returns an Atom feed with optional filtering.

**PARAMS** (supports multiple in request as x=a&x=b)

- `url` - The RSS/Atom feed URL to fetch (required)
- `filter=value` - Special filters:
  - `shorts` - Remove YouTube shorts
  - `country` - Remove videos unavailable in your country
- `excludetext=value` - Removes entries containing the given text
- `includetext=value` - Only include entries containing the given text

**EXAMPLES**
- `/rss?filter=shorts&includetext=Race%20Highlights&url=https://www.youtube.com/feeds/videos.xml?channel_id=UCfDfvvMARk4TKcC62ALi6eA`
  - Removes all shorts and non race highlights from Eurosport Cycling

### GET /podcast

Returns an RSS podcast feed with persistent storage and automatic media downloading. Feed entries are stored in a SQLite database and merged with new entries, preventing data loss when the source feed drops old items.

**PARAMS** (same as /rss, plus additional options)

- `url` - The RSS/Atom feed URL to fetch (required)
- `title` - Custom title for the podcast feed (optional, overrides original title)
- `description` - Custom description for the podcast feed (optional, overrides original description)
- `filter=value` - Special filters (shorts, country)
- `excludetext=value` - Removes entries containing the given text
- `includetext=value` - Only include entries containing the given text

**Storage**
- **Development**: 
  - Database: `build/storage/podcasts.db`
  - Media files: `build/storage/media/{feedId}/{videoId}/`
- **Production**: 
  - Database: `/storage/podcasts/podcasts.db`
  - Media files: `/storage/podcasts/media/{feedId}/{videoId}/`
  - (mount a volume for persistence)

**Features**
- Persistent storage of all feed entries
- Automatically merges new entries with historical data
- **Automatic media downloading** using yt-dlp:
  - Downloads audio as MP3 (best quality)
  - Downloads and converts thumbnails to JPG
  - Stores files locally in organized directory structure
  - Synchronous processing (waits for downloads to complete before returning feed)
  - Downloads up to 5 items per request automatically
  - File sizes calculated dynamically from filesystem
- **Thumbnail support**:
  - Channel thumbnail automatically extracted from first video
  - Episode thumbnails included in iTunes image tags
  - All thumbnails served locally via `/media` endpoint
- Preserves podcast metadata (iTunes tags, media enclosures, etc.)
- Returns RSS 2.0 format suitable for podcast players
- Serves media files via `/media` endpoint
- **Database migrations** for backwards-compatible schema updates

**EXAMPLES**
- `/podcast?url=https://www.youtube.com/feeds/videos.xml?channel_id=UCUyeluBRhGPCW4rPe_UvBZQ`
  - Creates a podcast feed that accumulates all videos from the channel
- `/podcast?title=My%20Custom%20Podcast&description=Custom%20description&url=https://www.youtube.com/feeds/videos.xml?channel_id=UCUyeluBRhGPCW4rPe_UvBZQ`
  - Same as above, but with a custom podcast title and description
- `/podcast?filter=shorts&excludetext=trailer&url=https://www.youtube.com/feeds/videos.xml?channel_id=UCUyeluBRhGPCW4rPe_UvBZQ`
  - Filters out shorts and trailers while maintaining full history

## Development

```bash
npm install
npm run dev
```

**Requirements:**
- Node.js 22+
- yt-dlp (for media downloading)
- ffmpeg (for audio conversion)

**Storage locations:**
- Database: `build/storage/podcasts.db`
- Media files: `build/storage/media/`

**Environment variables:**
- `BASE_URL` - Base URL for media serving (default: `http://localhost:3000`)
- `NODE_ENV` - Set to `production` for production paths

## Docker Deployment

The docker-compose.yml includes a volume mount for persistent podcast storage:

```yaml
volumes:
  - podcast-storage:/storage/podcasts
```

This ensures your podcast database and downloaded media files persist across container restarts.

The Docker image includes:
- yt-dlp for downloading videos/audio
- ffmpeg for audio conversion
- All necessary Python dependencies

**Environment variables:**
- `BASE_URL` - Set this to your public URL for proper media serving (e.g., `https://yourserver.com`)

### Media Serving

Downloaded media files are served at:
- Audio: `/media/{feedId}/{videoId}/audio.mp3`
- Thumbnails: `/media/{feedId}/{videoId}/thumbnail.jpg`

The podcast RSS feed automatically includes these URLs as:
- `<enclosure>` tags for audio files
- `<itunes:image>` tags for episode thumbnails
- Feed-level `<itunes:image>` tag using the channel's thumbnail

This makes the feeds fully compatible with standard podcast players like Apple Podcasts, Overcast, Pocket Casts, etc.

### Database Migrations

The database uses a migration system to ensure backwards compatibility. When the server starts, it automatically applies any pending schema migrations. Your existing data will be preserved across updates.
```