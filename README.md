
# AniList-Obsidian

**Integrate your AniList anime & manga data directly into Obsidian notes!**

![Plugin Logo](assets/icon.png)

---

## Features

- Embed individual anime/manga entries with metadata (titles, cover image, status, score, dates)  
- Generate watch/read lists (e.g. “Top Rated Anime”, “Currently Watching”)  
- Inline links to AniList pages  
- Caching for faster performance and reduced API calls  
- Dark & light theme support  

---

## Installation

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

Wrap your commands in a fenced code block:



```anilist
user: your-anilist-username
media: anime
id: 5114
layout: card
```



### Supported Parameters

| Key      | Required? | Description                                          |
|----------|-----------|------------------------------------------------------|
| `user`   | Yes       | Your AniList username                                |
| `media`  | No        | `anime` or `manga` (defaults to `anime`)             |
| `id`     | Yes       | AniList media ID                                     |
| `layout` | No        | `card`, `table`, or `inline` (defaults to `inline`)  |
| `fields` | No        | Comma-separated list of extra fields (e.g. `score`)  |

---

## Examples

- **Single inline entry**  


```anilist
user: your-anilist-username
id: 30276
```



- **Table of currently watching anime**  


```anilist
user: your-anilist-username
media: anime
list: CURRENT
layout: table
```

---

## Troubleshooting

- **Blank block**: make sure your username is correct, and check network console for errors.  
- **Rate limit errors**: increase cache duration or switch to a personal AniList API key.  
- **Styling issues**: customize your CSS in `.obsidian/plugins/AniList-Obsidian/styles.css`

---

## Contributing

1. Fork the repo  
2. Create a feature branch (`git checkout -b feature/awesome`)  
3. Commit your changes with clear messages  
4. Open a Pull Request against `main`  

Please run `npm test` and `npm run lint` before submitting.

---

## License

MIT © 2025 zara-kasi

---

## 🛠️ `TO-DO.md`


# AniList-Obsidian Plugin — To-Do List

## 🔧 Critical Fixes

- [ ] **Fix README**
- [ ] Replace placeholder repo links with correct ones (e.g. releases/issues)
- [ ] Clarify install instructions and examples
- [ ] Publish an initial release for manual installs

- [ ] **Renderer Bugs**
- [ ] `renderTableLayout` uses undefined variables (`title`, `entry`)
- [ ] Output table structure correctly and render all items

- [ ] **Parameter Parsing**
- [ ] Support quoted values and whitespace handling in key-value pairs
- [ ] Ensure default values work consistently (e.g. media type = "anime")
- [ ] Align error messages with settings (e.g. "username required" vs stored config)

## ⚠️ UX & Stability

- [ ] **Error Handling**
- [ ] Replace raw error output with clean, user-friendly messages
- [ ] Add inline feedback or status banners inside the rendered blocks

- [ ] **Loading State**
- [ ] Show a spinner or "Loading..." placeholder while fetching data

- [ ] **API Safety**
- [ ] Sanitize all dynamic values (titles, genres, etc.) to prevent XSS

- [ ] **Media Defaults**
- [ ] Fallback to `anime` when media type is not provided
- [ ] Validate all config inputs before use

## 🎨 Styling

- [ ] **Fix CSS**
- [ ] Correct syntax errors (`minmax(200 px, 1 fr)` → `minmax(200px, 1fr)`)
- [ ] Ensure consistent use of classes in HTML output
- [ ] Respect Obsidian themes (dark/light modes)
- [ ] Improve spacing, card layout, and responsiveness

## 📦 Code Quality

- [ ] **Refactor to TypeScript**
- [ ] Set up build pipeline with `tsconfig.json`, `rollup`, etc.
- [ ] Break logic into smaller, reusable modules

- [ ] **Lint & Format**
- [ ] Add ESLint + Prettier for code consistency

- [ ] **Test Coverage**
- [ ] Add unit tests for config parsing, rendering, and caching logic
- [ ] Use Jest or similar framework

- [ ] **Caching**
- [ ] Replace in-memory cache with persistent Obsidian Data API
- [ ] Allow configurable cache duration in settings

## 🚀 Future Features

- [ ] Support filters (genres, scores, tags, etc.)
- [ ] Custom sorting (e.g. by score, date)
- [ ] Inline charts or rating bars
- [ ] Support for custom field rendering (markdown or HTML)
```

Let me know if you want the `README.md` and `TO-DO.md` saved as actual files or embedded in your GitHub repo.
````
