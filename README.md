# Zoro 

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-blueviolet?style=flat-square&logo=obsidian)](https://obsidian.md/plugins?id=zoro)
[![GitHub release](https://img.shields.io/github/v/release/zara-kasi/zoro?style=flat-square)](https://github.com/zara-kasi/zoro/releases)
![GitHub Stars](https://img.shields.io/github/stars/zara-kasi/zoro?style=flat-square)
![GitHub Issues](https://img.shields.io/github/issues-raw/zara-kasi/zoro?style=flat-square)

> "Zoro — Track anime, manga, movies and TV inside Obsidian with AniList, MyAnimeList and Simkl."

---

## 📋 Table of Contents
- [Quick Start](#-quick-start)
- [Features](#-features)
- [Installation](#-installation)
- [Guides](#-guides)
- [Supported Platforms](#-supported-platforms)
- [Usage Guide](#-usage-guide)
- [Layout Options](#-layout-options)
- [Single Media](#-single-media)
- [Code Block Reference](#-code-block-reference)
- [Configuration](#-configuration)
- [Advanced Features](#-advanced-features)
- [API Support](#-api-support)
- [Contributing](#-contributing)
- [Acknowledgements](#-acknowledgements)
- [License](#-license)

---

## 🚀 Quick Start

### **Step 1: Connect Your Account**

1. Go to **Settings → Zoro**.
2. Authenticate with **AniList**, **MyAnimeList (MAL)**, or **Simkl**.
3. Alternatively, enter an **AniList public username** for view-only mode.
4. For detailed instructions, open **Setup → Authentication**.
5. Or [Guides](#-guides)

### **Step 2: Create the Zoro Folder**

1. Go to **Setup → Sample Folder**.
2. Click **Create**.
3. Return to your vault.
4. Open the newly-created **Zoro** folder.

---

## 🌟 Features

**📊 Multi-Platform Support**
- **AniList** - Full GraphQL integration with OAuth2 authentication
- **MyAnimeList (MAL)** - Complete OAuth2 authentication and API integration
- **Simkl** - Modern tracking platform for anime, movies, and TV shows

**🎨 Beautiful Renderings**
- **Card Layout** - Grid-based display with cover art, hover effects, and progress overlays
- **Table Layout** - Compact tabular view with sortable columns and quick editing
- **Stats Dashboard** - Comprehensive analytics with enhanced, compact, and minimal layouts
- **Real-time Search** - Instant results with thumbnails and live filtering

**⚡ Performance & Reliability**
- **Smart Caching** - 30min user data, 10min media data, 2min search results
- **Request Queueing** - Prevents rate limiting with intelligent request management
- **Circuit Breakers** - Graceful degradation during API outages
- **Progressive Loading** - Chunked rendering for large lists (20 items per chunk)
- **Background Refresh** - Silent cache updates without interrupting user experience

**🛠 Advanced Features**
- **In-note Editing** - Update progress, scores, and status without leaving Obsidian
- **Rich Details Panel** - Press & hold covers for comprehensive media information
- **Trending Discovery** - See what's popular across platforms with real-time data
- **Cross-platform Sync** - Convert between AniList/MAL IDs automatically
- **Connected Notes** - Auto-detect and link related notes in your vault
- **Export & Migration** - Export data to CSV/XML formats for backup or migration
- **Custom External URLs** - Add site-specific search buttons for external platforms
- **Theme System** - Multiple visual themes including minimal, glass, and viscosity styles

**🎯 User Experience**
- **Unified Grid System** - Dropdown-based column selection with responsive behavior
- **Authentication Prompts** - Clear guidance for setup and feature access
- **Error Recovery** - Automatic retries with exponential backoff
- **Loading Indicators** - Visual feedback during API operations
- **Keyboard Navigation** - Full keyboard support for accessibility

---

## 📦 Installation

**Method 1: Use Community Plugin BRAT (Recommended)**
1. Open Obsidian Settings
2. Go to Community Plugins → BRAT
3. Click "Add beta plugin"
4. Paste the Zoro GitHub repo URL: `https://github.com/zara-kasi/zoro`
5. Click "Add plugin"
6. Enable the plugin in Community Plugins settings

**Method 2: Manual Installation**
1. Download latest release from [GitHub Releases](https://github.com/zara-kasi/zoro/releases)
2. Extract to `.obsidian/plugins/zoro/`
3. Restart Obsidian
4. Enable in Community Plugins settings

**Requirements:**
- Obsidian v0.15.0 or higher
- Internet connection for API access
- Modern browser (for authentication flows)

---

## 📚 Guides

**AniList Authentication**  
Setup OAuth authentication with AniList for full feature access  
[→ View Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md)

**MAL Authentication**  
Connect your MyAnimeList account with OAuth2  
[→ View Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/mal-auth-setup.md)

**SIMKL Authentication**  
Connect your SIMKL account for anime, movies, and TV tracking  
[→ View Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/simkl-auth-setup.md)

**Export & Migration**  
Export and migrate data between platforms with detailed instructions  
[→ View Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/export-doc.md)

---

## 📱 Supported Platforms

| Platform | Status | Features | Media Types |
|----------|--------|----------|-------------|
| **AniList** | ✅ Full | All features including favorites, editing, stats | Anime, Manga |
| **MyAnimeList** | ✅ Full | Progress tracking, updates, OAuth2 | Anime, Manga |
| **Simkl** | ✅ Beta | Modern tracking, movies & TV support | Anime, Movies, TV |

**Platform Comparison:**

| Feature | AniList | MyAnimeList | Simkl |
|---------|---------|-------------|-------|
| **Authentication** | OAuth2 | OAuth2 | OAuth2 |
| **Anime Support** | ✅ Full | ✅ Full | ✅ Full |
| **Manga Support** | ✅ Full | ✅ Full | ❌ Limited |
| **Movies/TV** | ❌ No | ❌ No | ✅ Full |
| **Repeating Status** | ✅ Yes | ❌ No | ❌ No |
| **Public Access** | ✅ Yes | ❌ No | ❌ No |
| **GraphQL API** | ✅ Yes | ❌ REST | ❌ REST |

---

## 🎯 Usage Guide

### **🖱️ Interactive Elements**
- **Press & Hold** on cover images for detailed media information
- **Click status badges** to edit entries directly from the interface
- **Real-time search** with live results and thumbnails
- **Hover effects** on cards for enhanced visual feedback

### **📊 Display Your Stats**

```zoro
type: stats
mediaType: anime
```

**Enhanced Stats Features:**
- **Enhanced Layout**: Comprehensive analytics with charts and breakdowns
- **Compact Layout**: Condensed view for quick overview
- **Minimal Layout**: Simple text-based statistics
- **Auto-refresh**: Stats update automatically with cache

### **📺 Current Watching List**

```zoro
type: list
listType: current
mediaType: anime
layout: card
```

**List Types Available:**
- `current` - Currently watching/reading
- `completed` - Finished titles
- `planning` - Plan to watch/read
- `paused` - On hold
- `dropped` - Dropped titles
- `repeating` - Re-watching/re-reading (AniList only)
- `all` - All entries

### **📖 Manga Reading**

```zoro
type: list
listType: current
mediaType: manga 
layout: table
```

### **🔍 Search & Discover**

```zoro
type: search
search: attack on titan
mediaType: anime
layout: card
```

**Search Features:**
- **Real-time results** as you type
- **Fuzzy matching** for better results
- **Multiple sources** (AniList, MAL, Simkl)
- **Media type filtering** (anime, manga, movies, TV)

### **📈 Trending Now**

```zoro
type: trending
mediaType: anime
source: anilist
```

**Trending Features:**
- **Real-time data** from multiple platforms
- **Configurable limits** (default: 40 items)
- **Source-specific** trending lists
- **Cached results** for performance

### **🎬 Movies & TV Shows (SIMKL)**

```zoro
type: list
listType: current
mediaType: movie
source: simkl
layout: card
```

---

## 🎨 Layout Options

### **Card Layout (Default)**
- **Grid-based display** with responsive columns
- **Cover images** with hover effects and overlays
- **Progress indicators** showing completion status
- **Status badges** with color coding
- **Edit buttons** for quick modifications
- **Rating display** with star icons

```zoro
layout: card
```

**Grid Column Options:**
- **Default (Responsive)**: Automatically adapts to screen size
  - Mobile (< 600px): 2 columns
  - Tablet (600px+): 3 columns
  - Desktop (900px+): 4 columns
  - Large Desktop (1200px+): 5 columns
- **Fixed Columns**: 1-6 columns regardless of screen size

### **Table Layout**
- **Compact tabular view** for efficient space usage
- **Sortable columns** by title, score, progress, etc.
- **Quick editing** with inline controls
- **Efficient rendering** for large lists
- **Keyboard navigation** support

```zoro
layout: table
```

### **Display Customization**
- **Cover Images**: Toggle on/off for performance
- **Ratings**: Show/hide user scores
- **Progress**: Display completion status
- **Genres**: Show genre tags
- **Plain Titles**: Remove clickable links

---

## 🧩 Single Media
(AniList and MAL)

Render a single entry from your list by AniList or MAL ID. For AniList, either set a default username, authenticate, or provide `username`.

```zoro
# AniList single media example
source: anilist
type: single
mediaType: anime
username: your_anilist_username
mediaId: 16498  # Attack on Titan (example)
```

```zoro
# MAL single media example (requires MAL auth)
source: mal
type: single
mediaType: anime
mediaId: 5114  # Fullmetal Alchemist: Brotherhood (example)
```

**Single Media Features:**
- **Detailed information** display
- **Edit capabilities** (when authenticated)
- **Cross-platform ID conversion**
- **Rich metadata** including studios, genres, dates

---

## 🧑‍💻 Code Block Reference

| Parameter | Aliases | Description | Possible Values | Default Value | Required For | Example Usage |
|-----------|---------|-------------|-----------------|---------------|--------------|---------------|
| **type** | - | Operation type to perform | `stats`, `search`, `single`, `list`, `trending` | `list` | All operations | `type: stats` |
| **source** | `api` | API source to use | `anilist`, `mal`, `simkl` | Plugin default or `anilist` | All operations | `source: mal` |
| **username** | `user` | Username for user-specific operations | Any valid username or authenticated user | Plugin default or authenticated user | `stats`, `list` operations | `username: YourUsername` |
| **mediaType** | `media-type`, `media_type`, `mediatype` | Type of media to work with | `ANIME`, `MANGA`, `MOVIE`, `TV` | `ANIME` | All operations | `mediaType: MANGA` |
| **listType** | `list-type`, `list_type`, `listtype` | Status filter for user lists | `CURRENT`, `COMPLETED`, `PAUSED`, `DROPPED`, `PLANNING`, `ALL`, `REPEATING`* | `CURRENT` | `list` operations | `listType: COMPLETED` |
| **layout** | - | Display layout style | `card`, `table` | Plugin default or `card` | All display operations | `layout: table` |
| **mediaId** | `media-id`, `media_id`, `mediaid`, `id` | Specific media ID for single media operations | Any valid numeric ID | None | `single` operations | `mediaId: 21` |
| **search** | `query` | Search query for search operations | Any search string | None | `search` operations | `search: Attack on Titan` |
| **page** | - | Page number for paginated results | Positive integer | `1` | `search`, paginated operations | `page: 2` |
| **perPage** | `per-page`, `per_page`, `perpage`, `limit` | Number of results per page | Positive integer (typically 1-50) | Varies by operation | Optional for paginated operations | `perPage: 10` |

**Note:** `REPEATING` status is only supported on AniList.

### **Key Features:**

1. **Multiple Aliases**: Most parameters support multiple naming conventions (e.g., `mediaType`, `media-type`, `media_type`, `mediatype`)
2. **Five Operation Types**: `stats`, `search`, `single`, `list`, and `trending`
3. **Three API Sources**: AniList, MyAnimeList (MAL), and Simkl
4. **Flexible Layouts**: Card and table display options
5. **Smart Defaults**: The plugin uses sensible defaults when parameters are omitted

### **Source-Specific Limitations:**

| Feature/Status | AniList | MyAnimeList | Simkl |
|----------------|---------|-------------|-------|
| **ANIME** | ✅ | ✅ | ✅ |
| **MANGA** | ✅ | ✅ | ❌ |
| **MOVIES** | ❌ | ❌ | ✅ |
| **TV SHOWS** | ❌ | ❌ | ✅ |
| **REPEATING** status | ✅ | ❌ | ❌ |
| **Authentication Required** | Optional* | Required | Required |

*AniList works without authentication for public data, but authentication is required for user-specific operations.

The configuration system is very flexible and user-friendly, supporting various naming conventions and providing helpful error messages for invalid configurations.

---

## ⚙️ Configuration

### **Basic Settings**

```yaml
# In Obsidian Settings → Zoro
defaultApiSource: anilist  # anilist | mal | simkl
defaultUsername: your_username
defaultLayout: card       # card | table
showCoverImages: true
showRatings: true
showProgress: true
showGenres: false
```

### **Display Settings**

```yaml
# Grid Layout
gridColumns: default      # default | 1 | 2 | 3 | 4 | 5 | 6

# Visual Options
theme: auto              # auto | light | dark
statsLayout: enhanced    # enhanced | compact | minimal
hideUrlsInTitles: true
forceScoreFormat: true   # Forces 0-10 scale
showLoadingIcon: true
```

### **Advanced Settings**

```yaml
# Cache & Performance
cacheTTL: 1800000        # 30 minutes
maxCacheSize: 10000
backgroundRefresh: true

# Note Integration
notePath: Zoro/Note
insertCodeBlockOnNote: true

# External URLs
autoFormatSearchUrls: true
customSearchUrls: {
  ANIME: [],
  MANGA: [],
  MOVIE_TV: []
}
```

### **Authentication Settings**

```yaml
# AniList
clientId: your_anilist_client_id
clientSecret: your_anilist_client_secret
accessToken: auto_generated

# MyAnimeList
malClientId: your_mal_client_id
malClientSecret: your_mal_client_secret
malAccessToken: auto_generated

# SIMKL
simklClientId: your_simkl_client_id
simklClientSecret: your_simkl_client_secret
simklAccessToken: auto_generated

# TMDb (for enhanced movie/TV features)
tmdbApiKey: your_tmdb_api_key
```

---

## 🔧 Advanced Features

### **🔄 Smart Caching System**
- **User Data**: 30 minutes (profile, lists, stats)
- **Media Data**: 10 minutes (details, covers, metadata)
- **Search Results**: 2 minutes (quick access)
- **Airing Data**: 1 hour (schedule information)
- **ID Conversions**: 30 days (cross-platform mapping)
- **Trending Data**: 24 hours (popular content)

### **⚡ Performance Features**
- **Request Queue**: Prevents rate limiting with intelligent queuing
- **Progressive Loading**: Large lists load in chunks of 20 items
- **Background Refresh**: Updates cache silently without interruption
- **Error Recovery**: Automatic retries with exponential backoff
- **Circuit Breakers**: Graceful degradation during API outages

### **📊 Export & Migration**
- **CSV Export**: Standard format for data analysis
- **XML Export**: Compatible with MAL import tools
- **Unified Lists**: Combined anime and manga exports
- **Progress Tracking**: Export with completion status
- **Cross-platform**: Convert between AniList and MAL formats

### **🔗 Connected Notes**
- **Auto-detection**: Finds related notes in your vault
- **Smart Linking**: Connects media to existing notes
- **URL Matching**: Matches against external platform URLs
- **Cross-platform**: Works with AniList, MAL, and Simkl URLs

### **🎨 Theme System**
- **Minimal Theme**: Clean, distraction-free interface
- **Glass Theme**: Modern glassmorphism design
- **Viscosity Theme**: Fluid, dynamic visual effects
- **Custom Themes**: Download and apply additional themes
- **Auto-apply**: Themes apply immediately after download

### **🔍 Custom External URLs**
- **Site-specific Search**: Add buttons for external platforms
- **Auto-formatting**: Intelligent URL template learning
- **Multiple Platforms**: Support for various external sites
- **Template Learning**: Automatically learns URL patterns

---

## 🔍 API Support

### **AniList (GraphQL)**
- **Full GraphQL API** integration
- **OAuth2 Authentication** for secure access
- **Real-time Data** with GraphQL subscriptions
- **Rich Metadata** including studios, genres, dates

```zoro
source: anilist
```

### **MyAnimeList (REST + OAuth2)**
- **Complete REST API** integration
- **OAuth2 Authentication** for secure access
- **Rate Limiting** compliance
- **Cross-platform ID** mapping

```zoro
source: mal
```

### **Simkl (Modern API)**
- **Modern REST API** with OAuth2
- **Multi-media Support** (anime, movies, TV)
- **Real-time Updates** and synchronization
- **Advanced Filtering** and search capabilities

```zoro
source: simkl
```

### **TMDb Integration**
- **Enhanced Movie/TV** data through TMDb API
- **Rich Metadata** including cast, crew, reviews
- **Poster Art** and backdrop images
- **Release Information** and ratings

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### **🐛 Report Bugs**
1. Check [existing issues](https://github.com/zara-kasi/zoro/issues) first
2. Create new issue with detailed reproduction steps
3. Include console logs from Developer Tools (F12)
4. Specify your Obsidian version and platform

### **💡 Feature Requests**
1. Search [existing requests](https://github.com/zara-kasi/zoro/issues) first
2. Submit detailed feature description with use cases
3. Include mockups or examples if possible
4. Consider implementation complexity and user impact

### **🔧 Code Contributions**
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with clear commit messages
4. Test thoroughly across different platforms
5. Push to branch: `git push origin feature/amazing-feature`
6. Open Pull Request with detailed description

### **📚 Documentation**
- Improve existing documentation
- Add examples and tutorials
- Translate to other languages
- Create video guides or screenshots

### **🎨 Design & UX**
- Suggest UI/UX improvements
- Create new themes
- Improve accessibility
- Optimize performance

---

## 🌟 Acknowledgements

- **[Obsidian](https://obsidian.md/)** - The amazing note-taking app that makes this possible
- **[Obsidian Raindrop Plugin](https://github.com/mtopping/obsidian-raindrop)** - Inspiration for plugin architecture
- **[AniList](https://anilist.co/)** - Comprehensive anime and manga database with excellent API
- **[MyAnimeList](https://myanimelist.net/)** - The original anime tracking platform
- **[Simkl](https://simkl.com/)** - Modern tracking platform for all media types
- **[TMDb](https://www.themoviedb.org/)** - Movie and TV database for enhanced metadata

This work would not be possible without these essential tools and services. Special thanks to the Obsidian community for their support and feedback.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

The MIT License allows for:
- ✅ Commercial use
- ✅ Modification
- ✅ Distribution
- ✅ Private use
- ✅ Attribution requirement

---

## 🔗 Links

- **[GitHub Repository](https://github.com/zara-kasi/zoro)**
- **[Releases](https://github.com/zara-kasi/zoro/releases)**
- **[Issues](https://github.com/zara-kasi/zoro/issues)**
- **[Discussions](https://github.com/zara-kasi/zoro/discussions)**
- **[Obsidian Community](https://obsidian.md/plugins?id=zoro)**

---

*Made with ❤️ for the anime and manga community*