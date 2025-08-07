🍥 Zoro - Your Ultimate Anime & Manga Tracker for Obsidian

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-blueviolet?style=flat-square&logo=obsidian)](https://obsidian.md/plugins?id=zoro)
[![GitHub release](https://img.shields.io/github/v/release/username/zoro-obsidian?style=flat-square)](https://github.com/username/zoro-obsidian/releases)
![GitHub Stars](https://img.shields.io/github/stars/username/zoro-obsidian?style=flat-square)
![GitHub Issues](https://img.shields.io/github/issues-raw/username/zoro-obsidian?style=flat-square)

> "Track your anime journey inside Obsidian - beautifully rendered, intelligently cached, and seamlessly integrated."

---

📋 Table of Contents
- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Supported Platforms](#-supported-platforms)
- [Configuration](#-configuration)
- [Usage Guide](#-usage-guide)
- [Advanced Features](#-advanced-features)
- [API Support](#-api-support)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

🌟 Features

📊 Multi-Platform Support
- AniList - Full GraphQL integration
- MyAnimeList (MAL) - OAuth2 authentication
- Simkl - Modern tracking platform

🎨 Beautiful Renderings
- Card Layout - Grid-based with cover art
- Table Layout - Compact tabular view
- Stats Dashboard - Comprehensive analytics
- Real-time Search - Instant results with thumbnails

⚡ Enterprise-Grade Performance
- Smart Caching - 30min user data, 10min media data
- Request Queueing - Prevents rate limiting
- Circuit Breakers - Graceful degradation
- Progressive Loading - Chunked rendering for large lists

🛠 Advanced Features
- In-note Editing - Update progress without leaving Obsidian
- Rich Details Panel - Press & hold covers for more info
- Trending Discovery - See what's popular across platforms
- Cross-platform Sync - Convert between AniList/MAL IDs automatically

---

📦 Installation

Method 1: Community Plugins (Recommended)
1. Open Obsidian Settings
2. Go to Community Plugins → Browse
3. Search for "Zoro"
4. Click Install → Enable

Method 2: Manual Installation
1. Download latest release from [GitHub Releases](https://github.com/username/zoro-obsidian/releases)
2. Extract to `.obsidian/plugins/zoro/`
3. Restart Obsidian
4. Enable in Community Plugins settings

---

🚀 Quick Start

Step 1: Connect Your Account
1. Open Settings → Zoro
2. Click Authenticate with AniList (or MAL/Simkl)
3. Follow the OAuth flow
4. Done! 🎉

Step 2: Your First Code Block

```zoro
username: your_username
type: stats
mediaType: ANIME
layout: enhanced
```

Step 3: Track Your Watching

```zoro
username: your_username
type: list
listType: CURRENT
mediaType: ANIME
layout: card
```

---

📱 Supported Platforms

Platform	Status	Features	
AniList	✅ Full	All features including favorites	
MyAnimeList	✅ Full	Progress tracking, updates	
Simkl	✅ Beta	Basic tracking & discovery	

---

⚙️ Configuration

Basic Settings

```yaml
# In Obsidian Settings → Zoro
defaultApiSource: anilist  # anilist | mal | simkl
defaultUsername: your_username
defaultLayout: card       # card | table | minimal
showCoverImages: true
showRatings: true
showProgress: true
```

Advanced Settings

```yaml
# Cache & Performance
cacheTTL: 1800000        # 30 minutes
maxCacheSize: 10000
backgroundRefresh: true

# Display Options
theme: auto              # auto | light | dark
statsLayout: enhanced    # enhanced | compact | minimal
hideUrlsInTitles: true
forceScoreFormat: true   # Forces 0-10 scale
```

---

🎯 Usage Guide

📊 Display Your Stats

```zoro
# Anime Statistics
username: your_username
type: stats
mediaType: ANIME
layout: enhanced
```

📺 Current Watching List

```zoro
# Currently Watching
username: your_username
type: list
listType: CURRENT
mediaType: ANIME
layout: card
```

📖 Manga Reading

```zoro
# Manga Reading List
username: your_username
type: list
listType: CURRENT
mediaType: MANGA
layout: table
```

🔍 Search & Discover

```zoro
# Search for "Attack on Titan"
type: search
search: attack on titan
mediaType: ANIME
layout: card
```

📈 Trending Now

```zoro
# Trending Anime
type: trending
mediaType: ANIME
source: anilist
limit: 20
```

---

🎨 Layout Options

Card Layout (Default)
- Grid-based display
- Cover images with hover effects
- Progress overlays
- Status badges
- Edit buttons

Table Layout
- Compact tabular view
- Sortable columns
- Quick editing
- Efficient for large lists

Stats Layout (Enhanced)
- User statistics dashboard
- Completion rates
- Score distributions
- Time watched
- Genre breakdowns

---

🧩 Inline Links

Use anywhere in your notes:

```markdown
[zoro:username/CURRENT](zoro:username/CURRENT#card)
[zoro:username/stats](zoro:username/stats#enhanced)
[zoro:username/search](zoro:username/search#attack on titan)
```

---

🔧 Advanced Features

🖱️ Interactive Elements
- Press & Hold on cover images for detailed info
- Click status badges to edit entries
- Real-time search with live results

🔄 Smart Caching
- User Data: 30 minutes
- Media Data: 10 minutes
- Search Results: 2 minutes
- Airing Data: 1 hour
- Conversions: 30 days

⚡ Performance Features
- Request Queue: Prevents rate limiting
- Progressive Loading: Large lists load in chunks
- Background Refresh: Updates cache silently
- Error Recovery: Automatic retries with backoff

---

🔍 API Support

AniList (GraphQL)

```zoro
source: anilist
# Full feature set
```

MyAnimeList (REST + OAuth2)

```zoro
source: mal
# Progress tracking, updates
```

Simkl (Modern API)

```zoro
source: simkl
# Basic tracking & discovery
```

---

🛠 Troubleshooting

❌ Loading Icon Not Showing
1. Check CSS targeting: Use `#zoro-global-loader` (ID) not `.zoro-global-loader` (class)
2. Ensure styles are loaded before requests
3. Test with: `Developer Tools → Elements → #zoro-global-loader`

❌ Authentication Failed

```bash
# Check console for errors
Developer Tools → Console → [Zoro]
```

❌ Rate Limiting
- AniList: 90 requests/minute
- MAL: 60 requests/minute
- Simkl: 100 requests/minute

❌ Cache Issues

```zoro
# Force refresh
nocache: true
```

---

📊 FAQ

---

🤝 Contributing

We welcome contributions! Here's how:

🐛 Report Bugs
1. Check [existing issues](https://github.com/username/zoro-obsidian/issues)
2. Create new issue with reproduction steps
3. Include console logs from Developer Tools

💡 Feature Requests
1. Search [existing requests](https://github.com/username/zoro-obsidian/issues)
2. Submit detailed feature description
3. Include mockups if possible

🔧 Code Contributions
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

---

📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

🙏 Acknowledgments

- AniList for the amazing GraphQL API
- MyAnimeList for the comprehensive database
- Simkl for modern tracking capabilities
- Obsidian Team for the plugin framework
- Community for feedback and testing

---

📱 Connect With Us

- 🐦 Twitter: [@zoro_obsidian](https://twitter.com/zoro_obsidian)
- 💬 Discord: [Join our server](https://discord.gg/zoro-obsidian)
- 📧 Email: zoro@obsidian.com

---