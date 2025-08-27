# Zoro Side Panel — Create & Connect Notes  

The **Zoro Side Panel** lets you turn any media item into a note in your vault and keep it linked.  
It focuses on two main actions: **Create Note** and **Connect Note**.  

---

## Opening the Panel  
You can open the panel :  
- From any Zoro **list, search, or trending view**: select a card and click the “note” icon.  


---

## Core Features  

### 1. Create Note  
- Creates a new note in your configured path:  
  `Settings → Zoro → Note → "Note path"`.  
- The note includes frontmatter with stable identifiers:  
  - `media_type`: ANIME | MANGA | MOVIE | TV  
  - Known IDs (e.g. `mal_id`, `anilist_id`, `simkl_id`)  
  - `url`: list of canonical platform URLs  
- File naming: clean, readable titles (with disambiguators if needed).  
- Optional: auto-inserts a Zoro media block if enabled in settings.  
- After creation, the panel updates to **Connected**.  

---

### 2. Connect Note (link an existing note)  
Use when you already have a note for the media.  

Zoro suggests matches based on:  
1. Exact ID match (priority: MAL → AniList → others)  
2. URL overlap between note frontmatter and media URLs  
3. Title/tag hints (`#Zoro` tag or title similarity)  

You can:  
- Pick from suggested matches  
- Search by filename  
- Manually select a note from your vault  

On connect, Zoro updates the note’s frontmatter to include IDs and `media_type` if missing.  

---

### 3. Connected State Overview  
Once linked, the panel shows:  
- **Linked status:** note title and path  
- **Quick actions:** open note, reveal in folder, disconnect, refresh links  
- **Metadata snapshot:** which IDs/URLs are driving the connection  

---

### 4. Disconnect (Unlink)  
- Breaks the association without deleting the note.  
- The note remains intact; frontmatter is unchanged unless you edit it manually.  

---

### 5. Refresh Links  
- Re-runs matching after frontmatter or file changes.  
- Useful if you edited IDs, URLs, or renamed notes.  

---

## Matching Logic  

Priority order:  
1. `mal_id` + `media_type`  
2. `anilist_id` + `media_type`  
3. Other IDs + `media_type` (simkl/tmdb/imdb)  
4. URL overlap in frontmatter  
5. Fallback: `#Zoro` tag or title/filename similarity  

**Notes:**  
- `media_type` is strictly required to prevent cross-type mismatches.  
- `url` supports both single string and array (arrays recommended).  

---

## Frontmatter Reference  

Zoro writes/reads these fields:  

```yaml
---
media_type: ANIME
mal_id: 5114
anilist_id: 11061
url:
  - https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood
  - https://anilist.co/anime/5114
tags: [Zoro]
---
```

---

## Media Block (Optional)

If enabled in settings, new notes get a **Zoro media block** showing cover, rating, and details.  
This can be removed or edited without affecting the link.

---

## Workflows

- **From a list:** open a title → “Create Note” to draft impressions or “Connect Note” to link an existing note.
    
- **From search/trending:** find a title → “Create Note” for instant capture.
    
- **From an existing note:** add IDs/URLs in frontmatter, then “Refresh links” or “Connect Note”.
    

---

## Settings That Affect the Panel

- **Note path:** destination folder for new notes  
    `Settings → Zoro → Note → "Note path"`
    
- **Media block:** toggle auto-insertion of the Zoro block in new notes
    
- **Shortcuts:** custom external URLs shown in the More Details panel
    

---

## Best Practices

- Prefer arrays for `urls` in frontmatter.
    
- Include both MAL and AniList IDs for stronger linking.
    
- Keep `media_type` accurate.
    
- Tag legacy notes with `#Zoro` to improve matching.
    

---

## Troubleshooting

- **No match found:** Ensure `media_type` and at least one ID or canonical URL are in frontmatter.
    
- **Wrong note matched:** Disconnect, refine IDs/URLs, then reconnect.
    
- **Duplicate matches:** Use the disambiguation list; clean up extra frontmatter.
    
- **Note in wrong folder:** Update `"Note path"` in settings and recreate.
    

---

## Summary

The Zoro Side Panel is your control hub for note management:

- Create new notes with stable identifiers
    
- Connect existing notes with reliable matching
    
- Keep everything linked as your vault grows
    

