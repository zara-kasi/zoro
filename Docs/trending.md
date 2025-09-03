### Trending

View the Top 40 Trending TV Shows, Anime, Manga and Movies

Example
```zoro
type: trending
mediaType: anime
source: anilist
```

**Trending Features:**
- **Real-time Data**: Current trending content from platforms
- **Source-specific Lists**: Platform-specific trending content
- **Cached Results**: Performance optimization for repeated queries

**Trending Data Sources:**
- **AniList**: Popular anime and manga
- **MyAnimeList**: Trending content from MAL
- **Simkl**: Movie and TV show trends

| Media Type  | Sources Available | API Used                   | Requirements               |
| ----------- | ----------------- | -------------------------- | -------------------------- |
| Anime/Manga | AniList, MAL      | AniList GraphQL, Jikan API | No authentication required |
| TV/Movies   | Simkl             | Simkl API                   | Authentication required      |

> -  The Jikan API limits trending results to 25 items.
> -  Simkl doesn’t provide titles for trending items, so the rank will be shown in place of the title.

