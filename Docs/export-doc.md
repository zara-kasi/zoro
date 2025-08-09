# 📤 Export Features Guide

## 🎯 Overview

Zoro supports comprehensive export functionality for three major anime/manga platforms, creating both unified formats and industry-standard files that can be imported anywhere.

---

## 🌟 What's New?

### ✨ Multi-Format Exports
Each platform now creates **multiple export files** to give you maximum flexibility:

- **📊 Unified CSV** - Your custom format with all data in one place
- **🎌 MAL-Compatible XML** - Industry standard format accepted by MyAnimeList  
- **🎬 IMDb-Compatible CSV** - Standard format for movies/TV shows (SIMKL only)

### 📁 Export Location
All exported files are automatically saved in:
```
📁 Zoro/
  └── 📁 Export/
      ├── Zoro_AniList_Unified.csv
      ├── Zoro_AniList_Anime.xml
      ├── Zoro_MAL_Unified.csv
      └── ... (all export files)
```

---

## 🚀 Platform Features

### 🎌 AniList Export
**Files Created:**
- `Zoro_AniList_Unified.csv` - Unified data export
- `Zoro_AniList_Anime.xml` - MAL-compatible anime list
- `Zoro_AniList_Manga.xml` - MAL-compatible manga list

**✅ Perfect For:**
- Migrating from AniList to MyAnimeList
- Creating backups of your AniList data
- Analyzing your anime/manga consumption patterns
- Sharing your lists with friends

---

### 📺 MyAnimeList (MAL) Export  
**Files Created:**
- `Zoro_MAL_Unified.csv` - Unified data export
- `Zoro_MAL_Anime.xml` - Official MAL anime export
- `Zoro_MAL_Manga.xml` - Official MAL manga export

**✅ Perfect For:**
- Creating complete backups of your MAL account
- Transferring lists between MAL accounts
- Sharing your complete list data
- Data analysis and statistics

---

### 🎬 SIMKL Export
**Files Created:**
- `Zoro_SIMKL_Unified.csv` - Unified data export
- `Zoro_SIMKL_IMDb.csv` - IMDb-compatible movies/TV
- `Zoro_SIMKL_MAL.xml` - MAL-compatible anime list

**✅ Perfect For:**
- Bypassing SIMKL's paid export restriction
- Importing your movies/TV shows to IMDb
- Moving your anime data to MyAnimeList
- Comprehensive data portability

---

## 📋 File Format Details

### 📊 CSV Files (Spreadsheet Compatible)
- **Opens in:** Excel, Google Sheets, LibreOffice Calc, any text editor
- **Use for:** Data analysis, filtering, sorting, custom reports
- **Contains:** Complete metadata, ratings, progress, dates, IDs

### 📄 XML Files (Platform Import Compatible)  
- **Opens in:** Any text editor, XML viewers
- **Use for:** Importing to MyAnimeList, other compatible platforms
- **Contains:** Structured data in official MAL export format

### 🎬 IMDb CSV (Movies/TV Shows)
- **Opens in:** Excel, Google Sheets, any CSV reader
- **Use for:** Importing to IMDb, other movie databases
- **Contains:** IMDb-standard fields like ratings, release dates, URLs

---

## 🎯 How to Use Your Exports

### 🔄 Import to MyAnimeList
1. **Download** the XML file from your export
2. **Go to** [MAL Import Page](https://myanimelist.net/import.php)
3. **Select** "MyAnimeList Import" 
4. **Choose** your XML file
5. **Import** your data

### 🎬 Import to IMDb  
1. **Download** the IMDb CSV file (SIMKL exports only)
2. **Go to** [IMDb Import Page](https://www.imdb.com/list/ratings-import)
3. **Upload** your CSV file
4. **Review** and confirm import


---
## 🚀 Quick Migration Links

Need to migrate between platforms? Here are the official links:

### 🔄 Platform Migration
- **MAL Export:** [myanimelist.net/panel.php?go=export](https://myanimelist.net/panel.php?go=export)
- **MAL Import:** [myanimelist.net/import.php](https://myanimelist.net/import.php)  
- **AniList Import:** [anilist.co/settings/import](https://anilist.co/settings/import)
- **AniList Export Tool:** [malscraper.azurewebsites.net](https://malscraper.azurewebsites.net/)
- **IMDb Ratings Import:** [imdb.com/list/ratings-import](https://www.imdb.com/list/ratings-import)

*💡 Use Zoro plugin exports with these official import pages for seamless data migration!*

---

## 🛡️ Data Security & Privacy

### ✅ What's Safe
- All exports are **created locally** in your Obsidian vault
- **No data** is sent to third-party servers during export

### ⚠️ What to Consider
- **Private lists** may include personal ratings and comments
- **Share carefully** - files contain your complete viewing history  
- **MAL IDs** and external service IDs are included when available

---

## 🎨 File Naming Convention

All export files follow a consistent naming pattern:

```
Zoro_[Platform]_[Type].extension

Examples:
├── Zoro_AniList_Unified.csv
├── Zoro_AniList_Anime.xml  
├── Zoro_AniList_Manga.xml
├── Zoro_MAL_Unified.csv
├── Zoro_MAL_Anime.xml
├── Zoro_MAL_Manga.xml
├── Zoro_SIMKL_Unified.csv
├── Zoro_SIMKL_IMDb.csv
└── Zoro_SIMKL_MAL.xml
```

**📁 All files are saved in: `Zoro/Export/` folder**

---

### 🔄 Import Problems
- **MAL Import:** Verify XML structure matches expected format
- **IMDb Import:** Check that all required columns are present
- **Missing Data:** Some fields may not transfer between platforms


### 📁 File Purposes
| File Type | Best For | Compatible With |
|-----------|----------|-----------------|
| **CSV** | Analysis, backup | Excel, Sheets, databases |
| **Anime XML** | MAL import | MyAnimeList, compatible sites |
| **Manga XML** | MAL import | MyAnimeList, compatible sites |
| **IMDb CSV** | Movie tracking | IMDb, movie databases |

---

## 🔧 Technical Specifications

### 📊 CSV Format Details
- **Encoding:** UTF-8 with BOM
- **Delimiter:** Comma (`,`)
- **Text Qualifier:** Double quotes (`"`) when needed
- **Date Format:** `YYYY-MM-DD` 
- **Special Characters:** Properly escaped

### 📄 XML Format Details  
- **Encoding:** UTF-8
- **Schema:** Official MyAnimeList export format
- **CDATA Sections:** Used for titles and comments
- **Export Types:** 
  - Type 1 = Anime
  - Type 2 = Manga
 ---
