The **Side Panel** is your main hub for managing media inside Obsidian.  
Open it from the *aline-right* on any media card.

The panel offers four actions: **Create Note**, **Connect Note**, **Edit**, and **Details**.

---

## 1. Create Note
- Creates a new note in your configured folder (`Settings → Zoro → Note path`).  
- Adds extended frontmatter with:
  - `title` and alternate titles
  - `media_type` (ANIME | MANGA | MOVIE | TV)
  - IDs (`mal_id`, `anilist_id`, `simkl_id`, etc.)
  - `progress`, `rating`, `favorite`
  - `cover` (image link)
  - `url` (canonical links to the media)  
- File is named with a clean title (with disambiguator if needed).
- Can also auto-insert a **media block** if enabled.

---

## 2. Connect Note
- Use when you already have a note for the media.  
- Opens a search bar to select a note from your vault.  
- On connect, Zoro updates the note with the same extended frontmatter as **Create Note** (title, IDs, cover, rating, etc.).  

---

## 3. Edit
- Opens an edit menu for the selected media.  
- You can change and sync values directly with your connected API (AniList, MAL, Simkl):
  - **Status** (CURRENT, COMPLETED, PAUSED, DROPPED, PLANNING)
  - **Progress** (episodes/chapters)
  - **Rating**
  - **Favorite toggle**  
- All edits are applied instantly to your online list.

---

## 4. Details
- Opens a full detail view for the media, including:
  - **Synopsis** and description
  - **Format** (TV, Movie, Manga, etc.)
  - **Genres**
  - **External ratings** (IMDb, etc.)
  - **External links** (AniList, MAL, Simkl, TMDb, etc.)

---

## Notes on Properties
Both **Create Note** and **Connect Note** will insert enhanced properties in frontmatter.  
Example:

```yaml
---
title: Fullmetal Alchemist: Brotherhood
alt_titles:
  - Hagane no Renkinjutsushi: Brotherhood
  - FMA Brotherhood
media_type: ANIME
mal_id: 5114
anilist_id: 11061
simkl_id: 12345
progress: 64
rating: 9
favorite: true
cover: https://cdn.anilist.co/img/cover/anime/5114.jpg
url:
  - https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood
  - https://anilist.co/anime/5114
---