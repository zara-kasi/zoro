# Zoro

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-blueviolet?style=flat-square&logo=obsidian)](https://obsidian.md/plugins?id=zoro)
[![GitHub release](https://img.shields.io/github/v/release/zara-kasi/zoro?style=flat-square)](https://github.com/zara-kasi/zoro/releases)
![GitHub Stars](https://img.shields.io/github/stars/zara-kasi/zoro?style=flat-square)
![GitHub Issues](https://img.shields.io/github/issues-raw/zara-kasi/zoro?style=flat-square)

> "Zoro — Track anime, manga, movies and TV inside Obsidian"

---

## Table of Contents

###  Getting Started

- [Quick summary ](#-quick-summary)
- [Quick Start ](#-quick-start)
- [Quick Look ](#-quick-look)
- [Recommendation ](#-Recommendation)
- [Authentication ](#-authentication)

### Core Features

- [Feature Overview](#-feature-overview)
- [Connected Notes](#-connected-notes)
- [Search](#-search)
- [Media Lists](#-media-list)
- [Statistics](#-statistics)
- [Trending](#-trending)
- [Details Panel](#-details-panel)
- [Side Panel](#-side-panel)
- [Single Media](#-single-media)
- [Shortcuts](#-shortcuts)
- [Export](#-export)

### Customization

- [Code Block ](#-code-block)
- [Settings](#-settings)

### Development

- [Upcoming](#-upcoming)
- [Report Bugs](#-report-bugs)
- [Feature Requests](#-feature-requests)
- [Acknowledgements](#-acknowledgements)
- [License](#-license)

---

## Getting Started

### Quick summary 

- Track and show lists for **anime**, **manga**, **movies**, **TV** inside Obsidian.
    
- Connect AniList, MyAnimeList (MAL) and Simkl APIs for live data and editing.
    
- Card/table layouts, stats dashboards, connected notes and exports.

### Quick Start
![create sample note](Assets/ create_sample_note.png)
- **Zoro** →Settings →  **Setup → Sample Folder** → **Create** to scaffold `Zoro/Anime/`, `Zoro/Manga/`, `Zoro/Movie/`, `Zoro/TV/` and helpful templates.

### Quick Look

- Open the **Trending** note inside `Zoro/Anime/` or `Zoro/Manga/`.  
- You’ll instantly get a preview of how media cards are displayed — no authentication needed.

###  Recommendation

#### **For Anime & Manga Only:**
*Recommended: AniList*
- Best overall experience for anime and manga
- Rich statistics and social features
- Modern, fast interface
- Public access available

##### **Alternative: MyAnimeList**
- If you have existing MAL account
- If you prefer the legacy platform

#### **For Multi-media (Anime + Manga + Movies + TV):**
*Recommended: SIMKL + AniList*
- SIMKL for movies and TV shows
- AniList for anime and manga
- Best coverage across all media types

#### **For Casual Users:**
*Recommended: AniList*
- Public access without authentication
- Easy to use interface
- Good for exploration and discovery
- No commitment required

### Authentication

These guides provide step-by-step instructions with video for setting up secure connections to your media tracking platforms. It takes only 2 mins if you already have a account.

- [AniList Authentication](https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md)

- [SIMKL Authentication](https://github.com/zara-kasi/zoro/blob/main/Docs/simkl-auth-setup.md)

- [MAL Authentication](https://github.com/zara-kasi/zoro/blob/main/Docs/mal-auth-setup.md)
  

--- 

## Core Features

### Feature Overview

- Connected Notes — Create note or link notes for media.
- Search — Find anime, manga, movies, or TV.
- Media Lists — Track current, completed, planned, on-hold, dropped, rewatching, or all media in one place.
- Statistics — View detailed analytics of your media.
- Trending — Discover popular anime, manga, movies, and TV.
- Editing — Update progress, status, ratings, and notes directly inside Obsidian.
- Details Panel — Long-press cover image for quick access to more details about the item. 
- Single Media— View details, ratings, and metadata for individual titles.    
- Shortcuts — Add custom external link to reviews, streaming services, social media, or news sites.  
- Export — Easily export your data from AniList, MyAnimeList, or Simkl with one click into proper formats (CSV and MAL-compatible XML for anime and manga).

### Connected Notes

One of Zoro's best features is its ability to connect your media item with your existing notes and create new ones.

- **ID-based Matching** (MAL ID, AniList ID, SIMKL ID, IMDb ID, Tmdb ID), with media type( Anime, Manga, Movie, TV)
- **URL-based Matching** for external platform links
- **Code Block Insertion** for media display


### Search

```zoro
type: search
mediaType: anime
```

- **Real-time Results**: Instant search as you type
- **Title Search**: Search by English, Japanese, or native titles


### Media Lists

viewing and managing your media lists.

Example 
```zoro
listType: current
mediaType: anime
```

**List Features:**
- Progress Tracking: Episode/chapter progress display
- Status Updates: Quick status change options
- Score Management: Rate item from 0 to 10
- Favourite: only available for AniList. 

**List Types Available:**
- **`current`**: Currently watching/reading
- **`completed`**: Finished titles
- **`planning`**: Plan to watch/read list
- **`paused`**: On hold or paused titles
- **`dropped`**: Dropped or abandoned titles
- **`repeating`**: Re-watching/re-reading (AniList only)


### Statistics

Statistics system provides comprehensive insights into your media consumption patterns.

Example

```zoro
type: stats
mediaType: anime
Source: anilist
```

**Statistics Features:**
- **User Profile Display**: Avatar, username, and basic information
- **Overview Cards**: Key metrics at a glance
- **Detailed Breakdowns**: Genre, format, and status analysis
- **Total Entries**: Complete count of tracked media
- **Average Score**: Mean rating across all entries
- **Completion Rate**: Percentage of completed vs. planned
- **Format Analysis**: TV, movie, OVA, special distribution
- **Status Overview**: Current, completed, planning, etc.
- **Time-based Analysis**: Consumption patterns over time

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


### Details Panel

**Press and hold the cover image to open a details panel.**  

**This panel provides**:  
- Multiple titles  
  - English title  
  - Original title  
  - Romaji title  
  - And more  
- Format information  
- Release status (e.g., Releasing, Completed, etc.)  
- Synopsis  
- Statistics  
- Ratings from multiple sources  
- External links (to different sites and sources)


### Single Media

This allows you to display one specific item directly using its source-specific ID.  

Example
```zoro
source: anilist
type: single
mediaType: anime
mediaId: 16498
```

How it works:  
- Enter the item ID (e.g., AniList ID, MAL ID and Simkl ID,)  
- The plugin fetches and shows that single media item  
- Uses search to retrieve the item directly from the source


### Shortcuts


This feature lets you add your own website URLs to the **More Details Panel → External Links** section.  
It’s useful for quickly searching an item’s title (e.g., English title) on any website you prefer.  

**How it works** 
- The plugin uses the website’s search URL and automatically inserts the item’s title into it.  
- When clicked, the link redirects you to that website’s search results for the selected item.  

**How to use it**
1. Go to the website where you want to search (e.g., a review site, wiki, or streaming service).  
2. Perform a search manually for anything.  
3. Copy the **search URL** from your browser’s address bar.  
4. Paste that URL into the **shortcut section** for the correct media type (Anime, Manga, TV, or Movie).  
5. Once saved, the plugin will generate a working link in the **External Links** section of the details panel.  

This way, you can instantly search any item on your favorite websites with one click.

> If the search URL you added **doesn’t work**, it means that website’s search format isn’t directly compatible with the plugin. In that case, you can still make it work by following the [guide](https://github.com/zara-kasi/zoro/blob/main/Docs%2Fcustom-external-search-urls.md).


### Export


Most services do not provide free or standard export options.  
- **MAL**: Has a built-in export feature (standard format).  
- **AniList**: No direct export feature — you would need third-party tools.  
- **Simkl**: Export is available, but only for premium subscribers.  

To solve this, Zoro provides its own **Export Feature** for all supported APIs.  Go to **Settings → Data → Export**

**What the Export Feature does**
- Exports your full data into two formats:  
  1. **Complete CSV Export** – Contains all your data with no loss of information.  
  2. **Standard Format Export** – A commonly supported format for migrating to other platforms.  

**Export Formats**
- **Anime & Manga**:  
  - CSV (full data, no loss)  
  - XML (MAL-compatible standard format, may have some limitations)  
- **TV & Movies**:  
  - CSV (full data, no loss)  
  - IMDb-formatted CSV (importable on websites that support IMDb lists, but with some data loss/limitations)  

>  Standard formats (like XML or IMDb CSV) may have restrictions and do not include every data field.  For details on these limitations, see the [Export Guide](https://github.com/zara-kasi/zoro/blob/main/Docs%2Fexport-doc.md).


--- 

## Customization

### Code Block

You can use a special code block named `zoro` to customize and display media content directly in your notes.  
#### How to use it  
```zoro
# Your parameters go here
```

| Parameter     | Aliases                                 | Description                                   | Possible Values                                                              | Default Value                        | Required For                   | Example Usage             |
| ------------- | --------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ | ------------------------------ | ------------------------- |
| **type**      | -                                       | Operation type to perform                     | `stats`, `search`, `single`, `list`, `trending`                              | `list`                               | All operations                 | `type: stats`             |
| **source**    | `api`                                   | API source to use                             | `anilist`, `mal`, `simkl`                                                    | Plugin default or `anilist`          | All operations                 | `source: mal`             |
| **username**  | `user`                                  | Username for user-specific operations         | Any valid username or authenticated user                                     | Plugin default or authenticated user | `stats`, `list` operations     | `username: YourUsername`  |
| **mediaType** | `media-type`, `media_type`, `mediatype` | Type of media to work with                    | `ANIME`, `MANGA`, `MOVIE`, `TV`                                              | `ANIME`                              | All operations                 | `mediaType: MANGA`        |
| **listType**  | `list-type`, `list_type`, `listtype`    | Status filter for user lists                  | `CURRENT`, `COMPLETED`, `PAUSED`, `DROPPED`, `PLANNING`, `ALL`, `REPEATING`* | `CURRENT`                            | `list` operations              | `listType: COMPLETED`     |
| **layout**    | -                                       | Display layout style                          | `card`, `table`                                                              | Plugin default or `card`             | All display operations         | `layout: table`           |
| **mediaId**   | `media-id`, `media_id`, `mediaid`, `id` | Specific media ID for single media operations | Any valid numeric ID                                                         | None                                 | `single` operations            | `mediaId: 21`             |
| **search**    | `query`                                 | Search query for search operations            | Any search string                                                            | None                                 | `search` operations            | `search: Attack on Titan` |

#### Parameter Formatting  

When typing parameters inside the `zoro` code block:  
- **Case does not matter** → You can use lowercase, UPPERCASE, or MixedCase.  
- **Spelling matters** → The parameter must be spelled exactly as shown in the list above.

Examples (all valid):  
```zoro
type: anime
TYPE: Anime
Type: ANIME
```

Invalid (wrong spelling):
```zoro
typo: anime
```

#### **Source-Specific Limitations:**

| Feature/Status              | AniList   | MyAnimeList | Simkl    |
| --------------------------- | --------- | ----------- | -------- |
| **ANIME**                   | ✅         | ✅           | ✅        |
| **MANGA**                   | ✅         | ✅           | ❌        |
| **MOVIES**                  | ❌         | ❌           | ✅        |
| **TV SHOWS**                | ❌         | ❌           | ✅        |
| **Trending**                | ✅         | ✅           | ❌        |
| **REPEATING** status        | ✅         | ❌           | ❌        |
| **Favourite**               | ✅         | ❌           | ❌        |
| **Remove** item from list   | ✅         | ❌           | ✅        |
| **Authentication Required** | Optional* | Required    | Required |

> AniList works without authentication for public data, but authentication is required for user-specific operations.


### Settings

Here’s a quick explanation of all the available settings:
#### **Account Section**

**Public profile**
- **What it does**: Sets your AniList username for viewing public profiles and stats without authentication
- **When to use**: If you want to view public AniList data without logging in
- **Example**: Enter your or any public AniList username to view public lists

**AniList,  MyAnimeList,  SIMKL**
- **What they do**: Connect your accounts for full feature access
- **When to use**: Required for editing lists, accessing private data, and using all features
- **Setup**: Click the authentication buttons and follow the guides

#### **Setup Section**

**Sample Folder**
- **What it does**: Creates a complete Zoro folder structure with pre-configured notes
- **When to use**: Recommended for new users to get started quickly
- **Creates**: Anime, Manga, Movie, and TV folders with template files

**Default Source**
- **What it does**: Chooses which service to use when none is specified in code blocks
- **Options**: AniList, MyAnimeList, SIMKL
- **Recommendation**: AniList (most comprehensive)

#### **Note Section**

**Note path**
- **What it does**: Sets the folder where connected notes will be created
- **Default**: `Zoro/Note`
- **Example**: `Movie/Reviews` would create notes in that folder

**Media block**
- **What it does**: Automatically inserts a code block showing cover, rating, and details in new notes
- **When to use**: If you want media information automatically added to connected notes

#### **Display Section**

**Layout**
- **What it does**: Sets the default layout for media lists
- **Options**: Card Layout, Table Layout
- **Card Layout**: Grid-based with cover images and hover effects
- **Table Layout**: Compact tabular view with sortable columns

**Grid Columns**
- **What it does**: Controls how many columns appear in card layouts
- **Options**:
  - **Default (Responsive)**: Automatically adapts to screen size
  - **1-6 Columns**: Forces a specific number regardless of screen size

#### **More Section**

** Loading Icon**
- **What it does**: Shows loading animation during API requests
- **When to use**: Keep enabled for visual feedback during operations

**Plain Titles**
- **What it does**: Shows titles as plain text instead of clickable links
- **When to use**: If you prefer simpler text without external links

**Cover**
- **What it does**: Displays cover images for anime/manga
- **When to use**: Disable for better performance on slower devices

**Ratings**
- **What it does**: Displays user ratings/scores
- **When to use**: Keep enabled to see your scores and average ratings

**Progress**
- **What it does**: Shows progress information (episodes watched, chapters read)
- **When to use**: Essential for tracking your progress

**Genres**
- **What it does**: Displays genre tags on media cards
- **When to use**: Enable to see genre information at a glance

**Score Scale**
- **What it does**: Ensures all ratings use the 0–10 point scale
- **When to use**: Keep enabled for consistent rating display

#### **Shortcut Section**

**Open on site**
- **What it does**: Adds customizable external-link buttons to the More Details panel
- **Options**: Add Anime URL, Add Manga URL, Add Movie/TV URL
- **When to use**: If you want quick access to external platform pages

**Auto-format URL**  
This feature allows you to paste any search URL, and Zoro will automatically detect and convert it into the correct format for **External Links**. 

#### **Data Section**

**Export Your data**
- You can export all of your data into proper formats for all supported APIs directly within Obsidian.  
- All exported files are saved in `Zoro/Export`. If Obsidian can’t open them, use any file manager to access the folder directly.

#### **Cache Section**

**Cache Stats**
- **What it does**: Shows live cache usage and hit-rate information
- **When to use**: For monitoring performance and debugging

**Clear Cache**
- **What it does**: Deletes all cached data (user, media, search results)
- **When to use**: If you're experiencing issues or want fresh data

#### **Beta Section**

**TMDb API Key**
- **What it does**: Your The Movie Database API key for enhanced movie & TV features
- **When to use**: If you want additional movie/TV metadata and trending data
- **Get one**: Free at [TMDb](https://www.themoviedb.org/settings/api)

---

## Developement

### Upcoming

- [ ] Improving the note creation and connection features by adding more Obsidian properties, such as image URLs, progress, ratings, summaries, and multiple titles.
- [ ] Shifting both the More Details panel and the Edit panel into the side panel, allowing user to view details and edit items directly without opening separate panels.


### Report Bugs
1. Check [existing issues](https://github.com/zara-kasi/zoro/issues)
2. Include console logs from Developer Tools

### Feature Requests
1. Search [existing requests](https://github.com/zara-kasi/zoro/issues)
2. Submit detailed feature description


### Acknowledgements

- **[Obsidian](https://obsidian.md/)** - The amazing note-taking app that makes this possible
- **[Obsidian Raindrop Plugin](https://github.com/mtopping/obsidian-raindrop)** - Inspiration for plugin architecture
- **[AniList](https://anilist.co/)** - Comprehensive anime and manga database with excellent API
- **[MyAnimeList](https://myanimelist.net/)** - Long-standing and widely regarded platform for cataloging, rating, and discovering anime and manga.
- **[Simkl](https://simkl.com/)** - Modern tracking platform for all media types
- **[TMDb](https://www.themoviedb.org/)** - Movie and TV database for enhanced metadata

This work would not be possible without these essential tools and services.


### License

This project is licensed under the MIT License.

---