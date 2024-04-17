# misc-server

Server just runs a stuff I find useful

```
docker run -p 8080:8080 d3v01d/misc-server:stable
```

APIS:

```
GET /rss

PARAMS (supports multiple in request as x=a&x=b

filters=value
- shorts (remove youtube shorts)

excludetext=value
- removes entries without the given text

includetext=value
- removes entries with the given text

EXAMPLES
- /rss?filter=SHORTS&includetext=Race%20Highlights&url=https://www.youtube.com/feeds/videos.xml?channel_id=UCfDfvvMARk4TKcC62ALi6eA
-- Removes all shorts and non race highlights from Eurosport Cycling
```