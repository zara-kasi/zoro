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
- [Inline Links](#-inline-links)
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
- AniList - Full GraphQL integration
- MyAnimeList (MAL) - OAuth2 authentication
- Simkl - Modern tracking platform

**🎨 Beautiful Renderings**
- Card Layout - Grid-based with cover art
- Table Layout - Compact tabular view
- Stats Dashboard - Comprehensive analytics
- Real-time Search - Instant results with thumbnails

**⚡ Performance**
- Smart Caching - 30min user data, 10min media data
- Request Queueing - Prevents rate limiting
- Circuit Breakers - Graceful degradation
- Progressive Loading - Chunked rendering for large lists

**🛠 Advanced Features**
- In-note Editing - Update progress without leaving Obsidian
- Rich Details Panel - Press & hold covers for more info
- Trending Discovery - See what's popular across platforms
- Cross-platform Sync - Convert between AniList/MAL IDs automatically

---

## 📦 Installation

**Method 1: Use Community Plugin BRAT (Recommended)**
1. Open Obsidian Settings
2. Go to Community Plugins → BRAT
3. Click add beta plugin
4. Paste the zoro GitHub repo url : https://github.com/zara-kasi/zoro
5. Click→ add plugin

**Method 2: Manual Installation**
1. Download latest release from [GitHub Releases](https://github.com/zara-kasi/zoro/releases)
2. Extract to `.obsidian/plugins/zoro/`
3. Restart Obsidian
4. Enable in Community Plugins settings

---

## 📚 Guides

**AniList Authentication**  
Setup OAuth authentication with AniList  
[→ View Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md)

**MAL Authentication**  
Connect your MyAnimeList account  
[→ View Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/mal-auth-setup.md)

**Export & Migration**  
Export and migrate data between platforms  
[→ View Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/export-doc.md)

---

## 📱 Supported Platforms

| Platform | Status | Features |
|----------|--------|----------|
| AniList | ✅ Full | All features including favorites |
| MyAnimeList | ✅ Full | Progress tracking, updates |
| Simkl | ✅ Beta | |

---

## 🎯 Usage Guide

**📊 Display Your Stats**

```zoro
type: stats
mediaType: anime
```

**📺 Current Watching List**

```zoro
type: list
listType: current
mediaType: anime
layout: card
```

**📖 Manga Reading**

```zoro
type: list
listType: current
mediaType: manga 
layout: table
```

**🔍 Search & Discover**

```zoro
type: search
search: attack on titan
mediaType: anime
layout: card
```

**📈 Trending Now**

```zoro
type: trending
mediaType: anime
source: anilist
```

---

## 🎨 Layout Options

**Card Layout (Default)**
- Grid-based display
- Cover images with hover effects
- Progress overlays
- Status badges
- Edit buttons

```zoro
layout: card
```

**Table Layout**
- Compact tabular view
- Sortable columns
- Quick editing
- Efficient for large lists

```zoro
layout: table
```
---

## 🧩 Inline Links

Use anywhere in your notes:

```markdown
[zoro:username/CURRENT](zoro:username/CURRENT#card)
[zoro:username/stats](zoro:username/stats#enhanced)
[zoro:username/search](zoro:username/search#attack on titan)
```

---

## ⚙️ Configuration

**Basic Settings**

```yaml
# In Obsidian Settings → Zoro
defaultApiSource: anilist  # anilist | mal | simkl
defaultUsername: your_username
defaultLayout: card       # card | table | minimal
showCoverImages: true
showRatings: true
showProgress: true
```
**Advanced Settings**

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

## 🔧 Advanced Features

**🖱️ Interactive Elements**
- Press & Hold on cover images for detailed info
- Click status badges to edit entries
- Real-time search with live results

**🔄 Smart Caching**
- User Data: 30 minutes
- Media Data: 10 minutes
- Search Results: 2 minutes
- Airing Data: 1 hour
- Conversions: 30 days

**⚡ Performance Features**
- Request Queue: Prevents rate limiting
- Progressive Loading: Large lists load in chunks
- Background Refresh: Updates cache silently
- Error Recovery: Automatic retries with backoff

---

## 🔍 API Support

**AniList (GraphQL)**

```zoro
source: anilist
```

**MyAnimeList (REST + OAuth2)**

```zoro
source: mal
```

**Simkl (Modern API)**

```zoro
source: simkl
```

---

## 🤝 Contributing

We welcome contributions! Here's how:

**🐛 Report Bugs**
1. Check [existing issues](https://github.com/zara-kasi/zoro/issues)
2. Create new issue with reproduction steps
3. Include console logs from Developer Tools

**💡 Feature Requests**
1. Search [existing requests](https://github.com/zara-kasi/zoro/issues)
2. Submit detailed feature description
3. Include mockups if possible

**🔧 Code Contributions**
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

---

## 🤝 Acknowledgements

- **[Obsidian](https://obsidian.md/)**
- **[Obsidian Raindrop Plugin](https://github.com/mtopping/obsidian-raindrop)**
- **[AniList](https://anilist.co/)**
- **[MyAnimeList](https://myanimelist.net/)**
- **[Simkl](https://simkl.com/)**

This work would not be possible without these essential tools and services.

---

## 📄 License

This project is licensed under the MIT License.

---