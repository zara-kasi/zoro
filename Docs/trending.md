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
- **TMDb**: Movie and TV show trends

| Media Type  | Sources Available | API Used                   | Requirements               |
| ----------- | ----------------- | -------------------------- | -------------------------- |
| Anime/Manga | AniList, MAL      | AniList GraphQL, Jikan API | No authentication required |
| TV/Movies   | Simkl             | TMDB API                   | TMDB API key required      |

> -  The Jikan API limits trending results to 25 items.
> -  Simkl doesn’t provide a trending endpoint, TMDB is used for TV shows and movies. If you prefer not to get a TMDB API key, you can simply skip the TV/Movie trending feature.

