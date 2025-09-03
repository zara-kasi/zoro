### Code Block

You can use a special code block named `zoro` to customize and display media content directly in your notes.  
#### How to use it  
```zoro
# Your parameters go here
```

| Parameter     | Purpose / When to Use                                                                 | Accepted Values                                                                 | Default Value                           | Example                    |
| ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- | -------------------------- |
| **type**      | Defines the operation you want to run.                                                 | `stats` (user stats), `search` (find media), `single` (one media), `list` (user list), `trending` (popular items) | `list`                                  | `type: stats`              |
| **source**    | Choose which API/database to pull data from.                                           | `anilist`, `mal`, `simkl`                                                       | Your configured source (default: `anilist`) | `source: mal`              |
| **username**  | Specify which user’s data to show (stats or lists). Use your own or another’s username. | Any valid username (or leave empty to use your authenticated account).           | Your account (if logged in)             | `username: YourUsername`   |
| **mediaType** | Restrict results to a certain media category.                                          | `ANIME`, `MANGA`, `MOVIE`, `TV`                                                 | `ANIME`                                 | `mediaType: MANGA`         |
| **listType**  | Filter user lists by completion status.                                                | `CURRENT`, `COMPLETED`, `PAUSED`, `DROPPED`, `PLANNING`, `REPEATING`     | `CURRENT`                               | `listType: COMPLETED`      |
| **layout**    | Control how results are displayed inside your notes.                                   | `card`, `table`                                                                 | `card` (or your saved plugin setting)   | `layout: table`            |
| **mediaId**   | Fetch a specific media item by its ID.                                                 | Numeric ID (AniList/MAL/Simkl media ID)                                         | None                                    | `mediaId: 21`              |
| **search**    | Search for media by text query.                                                        | Any string (title, keyword, etc.)                                               | None                                    | `search: Attack on Titan`  |

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
| **REPEATING** status        | ✅         | ❌           | ❌        |
| **Favourite**               | ✅         | ❌           | ❌        |
| **Remove** item from list   | ✅         | ❌           | ✅        |
| **Authentication Required** | Optional* | Required    | Required |

> AniList works without authentication for public data, but authentication is required for user-specific operations.

