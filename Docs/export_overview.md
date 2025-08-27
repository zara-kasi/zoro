# Export

Most services don’t make it easy to export your data:  
- **MAL** → Has a built-in export (standard format)  
- **AniList** → No official export (only imports / 3rd-party tools)  
- **Simkl** → Export locked behind premium  

To fix this, **Zoro adds its own Export feature** for all supported APIs.  
Find it in **Settings → Data → Export**  

---

## Export Formats

| Type            | Anime & Manga                        | TV & Movies                     |
|-----------------|---------------------------------------|---------------------------------|
| **Full Data**   | CSV (complete, no loss)              | CSV (complete, no loss)         |
| **Standard**    | XML (MAL-compatible, limited fields) | IMDb CSV (importable, some loss) |

> Standard formats are “lighter” — they don’t include every field.  


---

## Export Location

All files are saved locally in your vault:  
```
Zoro/
  └─ Export/
        ├── Zoro_AniList_Unified.csv
        ├── Zoro_AniList_Anime.xml
        ├── Zoro_MAL_Unified.csv
        └── ... (all export files)

```

Naming pattern: `Zoro_[Platform]_[Type].extension`

---

## Quick Import & Export Links

- [MAL Export](https://myanimelist.net/panel.php?go=export)
- [MAL Import](https://myanimelist.net/import.php)  
- [AniList Import](https://anilist.co/settings/import)
- [Simkl Import](https://simkl.com/apps/import/)

> For missing exports links use Zoro: Settings → Data → Export your data

---

## Safety

- All exports are created locally in your Obsidian vault


---
