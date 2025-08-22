# TMDb to Simkl Integration for Obsidian Plugin

## Overview

This integration allows the Obsidian plugin to seamlessly convert TMDb trending items to Simkl IDs, enabling users to access the full Simkl details panel (with genres, proper URLs, descriptions, etc.) instead of the limited TMDb details panel.

## Problem Solved

**Before**: TMDb trending items showed limited information:
- Basic title and description
- No genres (just numbers)
- Limited URLs (only TMDb and IMDB)

**After**: TMDb trending items with Simkl conversion show full details:
- Complete genre information
- All available URLs (Simkl, TMDb, IMDB, etc.)
- Rich descriptions and metadata
- Consistent with existing Simkl system

## How It Works

### 1. TMDb ID to Simkl ID Conversion

The integration uses Simkl's search API endpoint to convert TMDb IDs to Simkl IDs:

```javascript
// API endpoint: https://api.simkl.com/search/id?tmdb={tmdb_id}&client_id={client_id}
const url = `${this.baseUrl}/search/id?tmdb=${encodeURIComponent(tmdbId)}&client_id=${this.plugin.settings.simklClientId}`;
```

**Location**: `src/api/services/SimklApi.js` - `convertTMDbToSimklId()` method

### 2. Integration in Trending System

When fetching TMDb trending content, the system automatically attempts to convert TMDb IDs to Simkl IDs:

**Location**: `src/features/Trending.js` - `fetchTMDbTrending()` method

```javascript
// Convert TMDb IDs to Simkl IDs for better integration
try {
  if (this.plugin.simklApi && this.plugin.settings.simklClientId) {
    const simklConversions = await Promise.allSettled(
      mediaList.slice(0, 10).map(async (media) => {
        const conversion = await this.plugin.simklApi.convertTMDbToSimklId(
          media.idTmdb, 
          mediaType.toLowerCase()
        );
        if (conversion && conversion.simklId) {
          return { media, conversion };
        }
        return null;
      })
    );
    
    // Apply successful conversions
    simklConversions.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        const { media, conversion } = result.value;
        media.idSimkl = conversion.simklId;
        media.ids.simkl = conversion.simklId;
        media.id = conversion.simklId; // Use Simkl ID for better integration
      }
    });
  }
} catch (error) {
  console.warn('[Trending] Simkl ID conversion failed:', error);
}
```

### 3. Source Detection and Panel Selection

The system automatically detects when a TMDb item has a successful Simkl conversion and treats it as a Simkl item:

**Location**: `src/features/Trending.js` - `renderTrendingBlock()` method

```javascript
items.forEach(item => {
  const isTmdb = ['MOVIE','MOVIES','TV','SHOW','SHOWS'].includes((config.mediaType || '').toUpperCase());
  
  // Check if this TMDb item has a successful Simkl conversion
  const hasSimklConversion = isTmdb && item.idSimkl && item.ids?.simkl;
  
  if (!item._zoroMeta) {
    item._zoroMeta = {
      source: hasSimklConversion ? 'simkl' : (isTmdb ? 'tmdb' : source),
      mediaType: config.mediaType || 'ANIME',
      fetchedAt: Date.now()
    };
  } else {
    // If we have a Simkl conversion, treat it as a Simkl item for better integration
    item._zoroMeta.source = hasSimklConversion ? 'simkl' : (isTmdb ? 'tmdb' : source);
    item._zoroMeta.mediaType = config.mediaType || 'ANIME';
    item._zoroMeta.fetchedAt = Date.now();
  }
  
  // For items with Simkl conversion, ensure the ID is set to Simkl ID
  if (hasSimklConversion) {
    item.id = item.idSimkl;
  }
});
```

### 4. Details Panel Routing

When a user long-presses on a trending item, the system automatically routes to the appropriate details panel:

- **TMDb items without Simkl conversion**: Opens TMDb details panel (limited)
- **TMDb items with Simkl conversion**: Opens Simkl details panel (full features)

The routing is handled by the existing `DetailPanelSource.js` system, which detects the source from `item._zoroMeta.source`.

## Key Features

### ✅ Automatic Conversion
- TMDb IDs are automatically converted to Simkl IDs during trending fetch
- No user intervention required
- Conversion is cached for 7 days to improve performance

### ✅ Seamless Integration
- Uses existing Simkl details panel system
- No new UI components created
- Maintains consistency with existing Simkl entries

### ✅ Fallback Support
- If conversion fails, falls back to TMDb details panel
- Graceful degradation ensures functionality is never lost
- Error handling prevents crashes

### ✅ Performance Optimized
- Converts only first 10 items to avoid API rate limits
- Caching reduces API calls
- Uses Promise.allSettled for parallel processing

## Configuration Requirements

### Required Settings
```javascript
// In plugin settings
simklClientId: 'your-simkl-client-id' // Get from https://simkl.com/developers/
```

### Optional Settings
```javascript
// TMDb API key (for fetching trending data)
tmdbApiKey: 'your-tmdb-api-key'
```

## API Endpoints Used

### Simkl API
- **Search by ID**: `GET /search/id?tmdb={tmdb_id}&client_id={client_id}`
- **Movie Details**: `GET /movies/{simkl_id}?extended=full&client_id={client_id}`
- **TV Details**: `GET /tv/{simkl_id}?extended=full&client_id={client_id}`

### TMDb API
- **Trending Movies**: `GET /trending/movie/day`
- **Trending TV**: `GET /trending/tv/day`
- **External IDs**: `GET /movie/{id}/external_ids` or `GET /tv/{id}/external_ids`

## Testing

A test script is provided to verify the conversion functionality:

```bash
# Update the client ID in test-tmdb-simkl-conversion.js
# Then run:
node test-tmdb-simkl-conversion.js
```

## Error Handling

The integration includes comprehensive error handling:

1. **API Failures**: Logs warnings and continues with TMDb fallback
2. **Rate Limiting**: Processes conversions in batches
3. **Network Issues**: Graceful degradation to TMDb details
4. **Invalid Responses**: Validation and fallback mechanisms

## Benefits

### For Users
- **Rich Information**: Access to full genre lists, descriptions, and metadata
- **Consistent Experience**: Same details panel for all Simkl-sourced content
- **Better Discovery**: More comprehensive information for trending content

### For Developers
- **Maintainable Code**: Uses existing, proven systems
- **Scalable Architecture**: Caching and batching for performance
- **Clean Integration**: No duplicate code or UI components

## Future Enhancements

Potential improvements that could be added:

1. **Batch Conversion**: Convert more than 10 items if API limits allow
2. **User Preferences**: Allow users to disable conversion if desired
3. **Conversion History**: Track successful/failed conversions for analytics
4. **Smart Caching**: Adaptive TTL based on content popularity

## Troubleshooting

### Common Issues

1. **No Simkl Details Panel**: Check if `simklClientId` is configured
2. **Conversion Failures**: Verify Simkl API is accessible and client ID is valid
3. **Performance Issues**: Check cache settings and API rate limits

### Debug Information

Enable console logging to see conversion process:
```javascript
// Check browser console for:
[Trending] Simkl ID conversion failed: [error details]
[Simkl] TMDb to Simkl conversion failed for ID [id]: [status]
```

## Conclusion

This integration successfully bridges the gap between TMDb trending data and Simkl's rich content system, providing users with a seamless and feature-rich experience while maintaining the existing plugin architecture and user interface.