# AniList Integration Plugin for Obsidian

A powerful Obsidian plugin that seamlessly integrates AniList data into your notes, allowing you to display anime and manga information directly within your vault.

## Features

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

## Installation

### Manual Installation
1. Download the plugin files (`main.js`, `manifest.json`, `styles.css`)
2. Create a folder named `anilist-integration` in your `.obsidian/plugins/` directory
3. Place the downloaded files in this folder
4. Enable the plugin in Obsidian's Community Plugins settings

### From Community Plugins (when available)
1. Open Obsidian Settings
2. Go to Community Plugins
3. Search for "AniList Integration"
4. Install and enable the plugin

## Usage

### Code Blocks

#### Media Lists
Display your anime or manga lists using code blocks:

```markdown
```anilist
username: your-anilist-username
listType: CURRENT
layout: card
```

**Parameters:**
- `username`: Your AniList username (required)
- `listType`: List status (CURRENT, COMPLETED, PAUSED, DROPPED, PLANNING, REPEATING)
- `layout`: Display layout (card, table)

#### Search Interface
Create an interactive search interface:

```markdown
```anilist-search
mediaType: ANIME
```

**Parameters:**
- `mediaType`: Type of media to search (ANIME, MANGA)
- `layout`: Display layout (card, table)

#### User Statistics
Display user statistics:

```markdown
```anilist
username: your-anilist-username
type: stats
```

#### Single Media Item
Display a specific anime/manga from your list:

```markdown
```anilist
username: your-anilist-username
type: single
mediaType: ANIME
mediaId: 123456
```

### Inline Links

Use special `anilist:` links in your notes:

```markdown
<!-- User's current anime list -->
[My Current Anime](anilist:username/current)

<!-- User statistics -->
[My Stats](anilist:username/stats)

<!-- Specific anime/manga -->
[Attack on Titan](anilist:username/anime/16498)
```

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
username: myusername
listType: CURRENT
```

# Search for Anime
```anilist-search
mediaType: ANIME
```

# My AniList Stats
```anilist
username: myusername
type: stats
```
```

### Advanced Usage
```markdown
# Completed Manga (Table View)
```anilist
username: myusername
listType: COMPLETED
layout: table
```

# Search for Manga
```anilist-search
mediaType: MANGA
```

Check out [my current anime](anilist:myusername/current) and [statistics](anilist:myusername/stats)!


## Troubleshooting

### Common Issues
1. **Username not found**: Ensure your AniList username is correct and public
2. **No data displayed**: Check if your lists are set to public on AniList
3. **Images not loading**: Verify your internet connection and AniList accessibility
4. **Search not working**: Make sure to type at least 3 characters

### Error Messages
- "Username is required": Add a username parameter to your code block
- "API Error": Check AniList service status and your internet connection
- "No results found": Try different search terms or check spelling

## Privacy & Data

- The plugin only accesses public AniList data
- No authentication or personal data storage
- All data is cached locally for 5 minutes
- No data is sent to third parties

## Contributing

This plugin is open source. Feel free to contribute by:
- Reporting bugs
- Suggesting new features
- Submitting pull requests
- Improving documentation

## Changelog

### Version 1.0.0
- Initial release
- Basic media list display
- Search functionality
- User statistics
- Inline link support
- Customizable settings

## Support

For support, bug reports, or feature requests, please create an issue on the project repository.

## License

This plugin is released under the MIT License.

---

**Note**: This plugin is not affiliated with AniList. AniList is a trademark of their respective owners.
