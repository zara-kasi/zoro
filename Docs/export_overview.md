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
└── Export/  
├── Zoro_AniList_Unified.csv  
├── Zoro_AniList_Anime.xml  
├── Zoro_MAL_Unified.csv  
├── Zoro_SIMKL_IMDb.csv  
└── ...

```

Naming pattern: `Zoro_[Platform]_[Type].extension`

---

## Quick Import Links

- [MAL Import](https://myanimelist.net/import.php)  
- [AniList Import](https://anilist.co/settings/import)  
- [IMDb Import](https://www.imdb.com/list/ratings-import)  
- [Simkl Import](https://simkl.com/apps/import/)  

(Simkl export → use Zoro, imports work fine)

---

## Safety

- All exports are created locally in your Obsidian vault


---
