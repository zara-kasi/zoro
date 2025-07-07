
# AniList-Obsidian

**Integrate your AniList anime & manga data directly into Obsidian notes!**

---

## Features

- 📺 **Embed your AniList data** - Display your anime/manga lists directly in your notes
- 🎨 **Multiple display options** - Choose between card layout or table layout
- 🔍 **Inline references** - Link to specific anime/manga or show user stats
- ⚡ **Cached data** - Fast loading with smart caching (5-minute cache)
- 🎯 **Customizable** - Show/hide images, ratings, progress, and more
- 📱 **Mobile friendly** - Works on desktop and mobile versions of Obsidian
### 📋 Media Lists
- Display your AniList anime/manga lists with customizable layouts
- Support for all list statuses (Current, Completed, Paused, Dropped, Planning, Repeating)
- Card and table layout options
- Real-time data fetching with 5-minute caching

### 🔍 Search Functionality
- Interactive search interface for anime and manga
- Real-time search results with debouncing
- Clickable results with direct links to AniList

### 📊 User Statistics
- Display comprehensive user statistics
- Anime and manga viewing/reading stats
- Mean scores and standard deviations
- Episodes watched, chapters read, and more

### 🎯 Single Media Display
- Show individual anime/manga entries
- Personal progress and ratings
- Detailed media information

### 🔗 Inline Links
- Special `anilist:` link syntax for quick media embedding
- Automatic link processing in your notes

### ⚙️ Customizable Settings
- Toggle cover images, ratings, progress, and genres
- Choose default layout preferences
- Responsive design for mobile and desktop


---

## Installation
### Option 1 ( Recommended):
-  Use BRAT community plugin to install.
### Option 2:
1. Download the latest release from [Releases](https://github.com/zara-kasi/AniList-Obsidian/releases).  
2. Unzip into your Obsidian vault’s `plugins/` folder, e.g.  

3. Reload Obsidian and enable “AniList-Obsidian” in Settings → Community Plugins.

---

## Configuration

1. Open Settings → AniList-Obsidian  
2. Enter your AniList **Username** (e.g. `your-anilist-username`)  
3. You can begin by using the templates available in the settings.

---
## Usage

1. Go to Settings → Community Plugins → AniList Integration
2. Enter your AniList username in the "Default Username" field
3. Configure your display preferences
4. Start using the plugin in your notes!
5. You can begin by using the templates available here.
[Anime](https://github.com/zara-kasi/AniList-Obsidian/blob/main/Anime-Template.md) ,
[Manga](https://github.com/zara-kasi/AniList-Obsidian/blob/main/Manga-Template.md)

### Code Blocks

#### Media Lists
Display your anime or manga lists using code blocks:

## [Comprehensive guide on how to use all its features:](Guide.md)
```markdown
```anilist
listType: CURRENT
```
**Parameters:**
- `username`: Your AniList username (required)
- `listType`: List status (CURRENT, COMPLETED, PAUSED, DROPPED, PLANNING, REPEATING)
- `layout`: Display layout (card, table)

## Advanced Features
#### Search Interface
Create an interactive search interface:

### Caching
```markdown
```anilist-search
mediaType: ANIME
```

The plugin automatically caches AniList data for 5 minutes to improve performance and reduce API calls. You can manually clear the cache in the plugin settings.
**Parameters:**
- `mediaType`: Type of media to search (ANIME, MANGA)
- `layout`: Display layout (card, table)

#### User Statistics
Display user statistics:

```markdown
```anilist
type: stats
```

### Responsive Design
#### Single Media Item
Display a specific anime/manga from your list:

The plugin automatically adapts to different screen sizes and works well on both desktop and mobile versions of Obsidian.
```markdown
```anilist
type: single
mediaType: ANIME
mediaId: 123456
```

## Customization
### Inline Links

### Settings
Use special `anilist:` links in your notes:

<!-- User's current anime list -->
[My Current Anime](anilist:username/current)

- **Default Username**: Your AniList username
- **Default List Type**: Which list to show by default
- **Show Cover Images**: Toggle image display
- **Show Ratings**: Toggle rating display
- **Show Progress**: Toggle progress display
- **Card Layout**: Choose between card or table layout
<!-- User statistics -->
[My Stats](anilist:username/stats)

### CSS Customization
<!-- Specific anime/manga -->
[Attack on Titan](anilist:username/anime/16498)


You can customize the appearance by adding CSS to your vault's `snippets` folder:
**Link Format:**
- `anilist:username/current` - Current watching/reading list
- `anilist:username/completed` - Completed list
- `anilist:username/stats` - User statistics
- `anilist:username/anime/ID` - Specific anime
- `anilist:username/manga/ID` - Specific manga

## Configuration

Access plugin settings through Obsidian Settings → Community Plugins → AniList Integration:

### Display Options
- **Default Layout**: Choose between card or table layout
- **Show Cover Images**: Toggle anime/manga cover images
- **Show Ratings**: Display user scores and ratings
- **Show Progress**: Show watching/reading progress
- **Show Genres**: Display genre tags

### Performance Features
- **Caching**: 5-minute cache for API responses
- **Debounced Search**: 300ms delay for search queries
- **Responsive Design**: Optimized for mobile and desktop

## Supported List Types

| Status | Description |
|--------|-------------|
| CURRENT | Currently watching/reading |
| COMPLETED | Finished anime/manga |
| PAUSED | On hold |
| DROPPED | Discontinued |
| PLANNING | Plan to watch/read |
| REPEATING | Rewatching/rereading |

## Layout Options

### Card Layout
- Grid-based display (3 columns on desktop)
- Cover images with media information
- Responsive design
- Hover effects and animations

### Table Layout
- Tabular format with sortable columns
- Compact information display
- Better for large lists
- Mobile-friendly

## API Integration

The plugin uses the AniList GraphQL API:
- **Endpoint**: `https://graphql.anilist.co`
- **Rate Limiting**: Handled automatically with caching
- **Authentication**: Not required for public data

## Examples

### Basic Usage
```markdown
# My Current Anime
```anilist
listType: CURRENT
```

```css
/* Make cards smaller */
.anilist-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
# Search for Anime
```anilist-search
mediaType: ANIME
```

/* Change genre tag colors */
.anilist-genre-tag {
    background: #ff6b6b;
    color: white;
}
# My AniList Stats
```anilist
type: stats
```
```

/* Customize card hover effects */
.anilist-card:hover {
    transform: scale(1.05);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}
### Advanced Usage
```markdown
# Completed Manga (Table View)
```anilist
username: myusername
listType: COMPLETED
layout: table
```

### Error Messages
- "Username is required": Add a username in settings or in code block.
- "API Error": Check AniList service status and your internet connection
- "No results found": Try different search terms or check spelling
---


---

## License

MIT © 2025 zara-kasi

---

## 🚀 Future Features

- [ ] Support filters (genres, scores, tags, etc.)
- [ ] Custom sorting (e.g. by score, date)
- [ ] Inline charts or rating bars
- [ ] Support for custom field rendering (markdown or HTML)
```

