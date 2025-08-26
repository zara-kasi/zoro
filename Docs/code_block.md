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

