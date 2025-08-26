Zoro Side Panel — Create Note & Connect Note
This side panel helps you turn any media item into a first-class note in your vault and keep it linked. It focuses on two core actions: Create Note and Connect Note.

How to open
From any Zoro list/search/trending view, select a card and click the “note” icon (or open the panel via the Zoro ribbon/command, if available).
The panel shows controls contextual to the selected media.
What the panel does
Shows whether this media is already linked to a note.
Lets you create a new connected note with one click.
Lets you connect an existing note if you already wrote one.
Helps you resolve duplicates or ambiguous matches safely.
Connected state overview
Linked status: Shows the currently connected note’s title and path.
Quick actions: Open note, reveal in folder, disconnect, refresh links.
Metadata snapshot: Which IDs/URLs are driving the connection.
Create Note
One click creates a new note under your configured Note path (Settings → Zoro → Note → “Note path”).
The note includes:
Frontmatter with stable identifiers:
media_type (ANIME | MANGA | MOVIE | TV)
Known IDs (e.g., mal_id, anilist_id, simkl_id, plus any other available IDs)
url: a list of authoritative platform URLs (AniList/MAL/SIMKL/etc.)
Optional Zoro media block if enabled (Settings → Zoro → Note → “Media block”).
File naming: Uses a clean, readable title (with disambiguators if needed).
After creation, the side panel updates to “Connected”.
Connect Note (link an existing note)
Use when you already have a note for this title.
The panel proposes likely matches using:
Exact ID match (highest priority): MAL → AniList → others
URL match: any overlap between note frontmatter url array and current media URLs
Title/tag hints: presence of #Zoro tag or title similarity (fallback)
You can:
Pick from suggested matches
Search by filename
Manually choose a note from your vault
On connect, Zoro updates the note’s frontmatter to include the appropriate IDs and media_type (if missing) to make the link stable.
Disconnect (Unlink)
Breaks the association without deleting the note.
Leaves the note intact (frontmatter remains unless you choose to clean it up).
Refresh links
Re-runs matching in case you changed frontmatter or renamed notes.
Useful after editing a note’s frontmatter or adding URLs/IDs.
Matching logic (how Zoro finds your notes)


Priority order:

MAL ID + media_type
AniList ID + media_type
Other known IDs + media_type (e.g., simkl/tmdb/imdb if present)
URL overlap between frontmatter url array and current media URLs
Fallback hints: #Zoro tag, filename/title
Notes:

Matching is strict on media_type to avoid cross-type collisions.
URL checks support single string or array in frontmatter; arrays are recommended.
Frontmatter reference (what Zoro writes/reads)
Required for strong linking:
media_type: ANIME | MANGA | MOVIE | TV
Platform IDs when available: mal_id, anilist_id, simkl_id, tmdb_id, imdb_id, etc.
url: one or more canonical URLs (array preferred)
Example:
---
media_type: ANIME
mal_id: 5114
anilist_id: 11061
url:
  - https://myanimelist.net/anime/5114/Fullmetal_Alchemist__Brotherhood
  - https://anilist.co/anime/5114
tags: [Zoro]
---
Media block insertion (optional)
When enabled, new notes get an embedded zoro code block showing cover, rating, and details.
You can remove/modify it later; the panel link remains via frontmatter.
Typical workflows
From a list: Open a show → “Create Note” to draft impressions; or “Connect Note” to link your existing write-up.
From search/trending: Find a title → use “Create Note” to spin up a new note instantly.
From an existing note: Add IDs/URLs/frontmatter, then “Refresh links” or “Connect Note” to link it.
Settings that affect the panel
Settings → Zoro → Note:
“Note path”: destination folder for new notes
“Media block”: auto-insert Zoro block in new notes
Settings → Zoro → Shortcut:
Custom external URLs appear in the linked More Details panel for quick jumps (complimentary to your connected note flow).
Best practices
Prefer arrays for url in frontmatter (easier matching).
Include both MAL and AniList IDs when possible for bulletproof linking.
Keep media_type accurate; it’s part of match validation.
Add #Zoro to legacy notes to help discovery.
Troubleshooting
Not seeing a match: Ensure media_type is set and at least one stable ID (or a canonical URL) is present in frontmatter.
Wrong note matched: Disconnect, refine frontmatter (IDs/URLs), then Connect again.
Duplicate matches: Use the disambiguation list; pick the correct note and clean the other’s frontmatter if needed.
Note not created in the right place: Update “Note path” in settings, then Create again.
This side panel is your control center for turning viewing into knowledge: make notes quickly, anchor them with stable IDs, and keep everything connected as your vault grows.