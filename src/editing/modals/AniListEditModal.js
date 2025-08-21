import { Notice } from 'obsidian';


class AniListEditModal {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async initializeFavoriteButton(entry, favBtn) {
    if (entry.media.isFavourite !== undefined) {
      favBtn.className = entry.media.isFavourite ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      favBtn.disabled = false;
      return;
    }
    
    try {
      const query = `
        query ($mediaId: Int) {
          Media(id: $mediaId) { 
            isFavourite 
            type
          }
        }`;
      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.plugin.settings.accessToken}`
          },
          body: JSON.stringify({ query, variables: { mediaId: entry.media.id } })
        })
      );
      const mediaData = res.json.data?.Media;
      const fav = mediaData?.isFavourite;
      entry.media.isFavourite = fav;
      favBtn.className = fav ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      favBtn.dataset.mediaType = mediaData?.type;
    } catch (e) {
      console.warn('Could not fetch favorite', e);
    }
  }

  async toggleFavorite(entry, favBtn) {
    favBtn.disabled = true;
    const wasAlreadyFavorited = entry.media.isFavourite;
    
    try {
      let mediaType = favBtn.dataset.mediaType;
      if (!mediaType) {
        mediaType = entry.media.type || 'TV';
      }
      
      const isAnime = mediaType === 'ANIME';
      
      const mutation = `
        mutation ToggleFav($animeId: Int, $mangaId: Int) {
          ToggleFavourite(animeId: $animeId, mangaId: $mangaId) {
            anime { nodes { id } }
            manga { nodes { id } }
          }
        }`;
        
      const variables = {};
      if (isAnime) {
        variables.animeId = entry.media.id;
      } else {
        variables.mangaId = entry.media.id;
      }

      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.plugin.settings.accessToken}`
          },
          body: JSON.stringify({ query: mutation, variables })
        })
      );
      
      if (res.json.errors) {
        new Notice(`API Error: ${res.json.errors[0].message}`, 8000);
        throw new Error(res.json.errors[0].message);
      }
      
      const isFav = !wasAlreadyFavorited;
      
      entry.media.isFavourite = isFav;
      document.querySelectorAll(`[data-media-id="${entry.media.id}"] .zoro-heart`)
        .forEach(h => h.style.display = entry.media.isFavourite ? '' : 'none');
      
      this.invalidateCache(entry);
      this.updateAllFavoriteButtons(entry);
      
      favBtn.className = isFav ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      new Notice(`${isFav ? 'Added to' : 'Removed from'} favorites!`, 3000);
      
    } catch (e) {
      new Notice(`❌ Error: ${e.message || 'Unknown error'}`, 8000);
    } finally {
      favBtn.disabled = false;
    }
  }

  async updateEntry(entry, updates, onSave) {
    await onSave(updates);
    Object.assign(entry, updates);
    return entry;
  }

  async removeEntry(entry) {
    const mutation = `
      mutation ($id: Int) {
        DeleteMediaListEntry(id: $id) { deleted }
      }`;
    await this.plugin.requestQueue.add(() =>
      requestUrl({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.plugin.settings.accessToken}`
        },
        body: JSON.stringify({ query: mutation, variables: { id: entry.id } })
      })
    );
  }

  invalidateCache(entry) {
    this.plugin.cache.invalidateByMedia(String(entry.media.id));
  }

  updateAllFavoriteButtons(entry) {
    document.querySelectorAll(`[data-media-id="${entry.media.id}"] .zoro-fav-btn`)
      .forEach(btn => {
        btn.className = entry.media.isFavourite ? 'zoro-fav-btn zoro-heart' : 'zoro-fav-btn zoro-no-heart';
      });
  }

  supportsFeature(feature) {
    return ['favorites', 'remove', 'update'].includes(feature);
  }
}

export { AniListEditModal };