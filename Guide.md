# AniList Plugin Complete Usage Guide

## 📋 Table of Contents
1. [Plugin Settings](#plugin-settings)
2. [Code Block Usage](#code-block-usage)
3. [Inline Link Usage](#inline-link-usage)
4. [Available List Types](#available-list-types)
5. [Layout Options](#layout-options)
6. [Advanced Examples](#advanced-examples)
7. [Troubleshooting](#troubleshooting)

---

## ⚙️ Plugin Settings

First, configure your plugin settings:

1. Go to **Settings** → **Community Plugins**
2. Find **AniList Integration** and click the gear icon
3. Configure these options:
   - **Default Layout**: Choose between Card or Table layout
   - **Show Cover Images**: Toggle anime/manga cover images
   - **Show Ratings**: Display your personal scores
   - **Show Progress**: Show episode/chapter progress
   - **Show Genres**: Display genre tags

---

## 📝 Code Block Usage

### Basic Syntax
```
```anilist
username: YOUR_ANILIST_USERNAME
listType: CURRENT
layout: card
```
```

### Required Parameters
- `username`: Your AniList username (case-sensitive)

### Optional Parameters
- `listType`: See [Available List Types](#available-list-types)
- `layout`: `card` or `table`
- `mediaType`: `ANIME` or `MANGA` (defaults to ANIME)

### Examples

#### View Currently Watching Anime
```
```anilist
username: YourUsername
listType: CURRENT
layout: card
```
```

#### View Completed Manga in Table Format
```
```anilist
username: YourUsername
listType: COMPLETED
mediaType: MANGA
layout: table
```
```

#### View Plan to Watch List
```
```anilist
username: YourUsername
listType: PLANNING
```
```

---

## 🔗 Inline Link Usage

### Basic Syntax
```markdown
[Link Text](anilist:username/listtype)
```

### Examples

#### Link to Current Anime List
```markdown
Check out [my current anime](anilist:YourUsername/current)
```

#### Link to Completed Manga
```markdown
See [my completed manga](anilist:YourUsername/completed)
```

#### Link to User Statistics
```markdown
View [my AniList stats](anilist:YourUsername/stats)
```

#### Link to Specific Anime/Manga
```markdown
Currently reading [this manga](anilist:YourUsername/manga/98263)
```

---

## 📊 Available List Types

| List Type | Code Block | Inline Link | Description |
|-----------|------------|-------------|-------------|
| **Currently Watching/Reading** | `CURRENT` | `current` | Media you're currently consuming |
| **Completed** | `COMPLETED` | `completed` | Finished media |
| **Paused/On Hold** | `PAUSED` | `paused` | Temporarily stopped media |
| **Dropped** | `DROPPED` | `dropped` | Discontinued media |
| **Planning** | `PLANNING` | `planning` | Media you plan to watch/read |
| **Repeating** | `REPEATING` | `repeating` | Media you're rewatching/rereading |

---

## 🎨 Layout Options

### Card Layout (Default)
- Visual grid layout with cover images
- Shows status badges, progress, and scores
- Responsive design for mobile
- Best for browsing and visual appeal

### Table Layout
- Compact tabular format
- Efficient for large lists
- Easy to scan information
- Better for data analysis

---

## 🔥 Advanced Examples

### Mixed Media Types in One Note
```markdown
# My AniList Dashboard

## Currently Watching Anime
```anilist
username: YourUsername
listType: CURRENT
mediaType: ANIME
layout: card
```

## Currently Reading Manga
```anilist
username: YourUsername
listType: CURRENT
mediaType: MANGA
layout: table
```

## My Statistics
```anilist
username: YourUsername
type: stats
```
```

### Embedding in Daily Notes
```markdown
# Daily Note - 2024-01-15

## Today's Anime Progress
Quick link to [my current anime](anilist:YourUsername/current)

## Completed This Week
```anilist
username: YourUsername
listType: COMPLETED
layout: card
```
```

### Review Template
```markdown
# Anime Review Template

## Currently Watching
```anilist
username: YourUsername
listType: CURRENT
layout: card
```

## Recently Completed
View my [completed anime](anilist:YourUsername/completed) for review ideas.

## Planning to Watch
```anilist
username: YourUsername
listType: PLANNING
layout: table
```
```

### Statistics Dashboard
```markdown
# My AniList Analytics

## Overall Statistics
```anilist
username: YourUsername
type: stats
```

## Quick Links
- [Currently Watching](anilist:YourUsername/current)
- [Completed Shows](anilist:YourUsername/completed)
- [Plan to Watch](anilist:YourUsername/planning)
- [On Hold](anilist:YourUsername/paused)
- [Dropped](anilist:YourUsername/dropped)


---

## 🎯 Special Features

### User Statistics Display
Shows comprehensive statistics including:
- **Anime Stats**: Count, episodes watched, minutes watched, mean score
- **Manga Stats**: Count, chapters read, volumes read, mean score
- **User Avatar**: Profile picture display

### Status Badges
Color-coded badges for easy identification:
- 🟢 **Current**: Green
- 🔵 **Completed**: Blue
- 🟡 **Paused**: Yellow
- 🔴 **Dropped**: Red
- 🟣 **Planning**: Purple
- 🔵 **Repeating**: Cyan

### Progress Tracking
- Shows current progress vs. total episodes/chapters
- Example: "12/24" for episode 12 of 24
- Shows "?" for unknown totals

### Genre Tags
- Displays up to 3 genres per entry
- Styled as small tags below the title
- Helps with quick categorization

---

## 🚨 Troubleshooting

### Common Issues

#### "Username is required" Error
- Ensure you've spelled your AniList username correctly
- Check that your AniList profile is public

#### "API Error: 404" 
- Username doesn't exist or is private
- Check your AniList username spelling

#### Plugin Not Loading
- Ensure all three files are in the correct folder
- Restart Obsidian completely
- Check for JavaScript errors in Developer Tools

#### No Data Showing
- Verify your lists aren't empty
- Check if your profile is set to public
- Try a different listType

### Performance Tips

#### Caching
- Data is cached for 5 minutes to reduce API calls
- Refresh by reloading the note or restarting Obsidian

#### Large Lists
- Use table layout for better performance with large lists
- Consider splitting large lists by status type

---

## 📱 Mobile Compatibility

The plugin is fully responsive and works on:
- Desktop Obsidian
- Mobile app (iOS/Android)
- Tablet devices

Mobile optimizations include:
- Stacked card layouts on small screens
- Responsive table scrolling
- Touch-friendly interface elements

---

## 🔄 Data Refresh

### Automatic Refresh
- Data automatically refreshes every 5 minutes
- No manual refresh needed for recent changes

### Manual Refresh
- Reload the note (Ctrl+R)
- Restart Obsidian
- Edit and save the code block

---

## 💡 Pro Tips

1. **Combine with Templates**: Use with Obsidian templates for consistent anime/manga note formats
2. **Link Integration**: Use inline links in your media review notes
3. **Dashboard Creation**: Create a dedicated AniList dashboard note with all your lists
4. **Status Tracking**: Use in daily notes to track your viewing progress
5. **Discovery**: Use planning lists to track recommendations from friends

---

## 📞 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Verify your AniList username and privacy settings
3. Ensure your internet connection is stable
4. Try restarting Obsidian

The plugin respects AniList's API rate limits and caches data to minimize requests.
