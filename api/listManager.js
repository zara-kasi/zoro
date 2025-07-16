export async function updateMediaListEntry(mediaId, updates) {
  try {
    // Ensure valid token before proceeding
    if (!this.settings.accessToken || !(await this.ensureValidToken())) {
      throw new Error('❌ Authentication required to update entries.');
    }

    const mutation = `
      mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, score: $score, progress: $progress) {
          id
          status
          score
          progress
        }
      }
    `;

    // Filter out undefined values
    const variables = {
      mediaId,
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.score !== undefined && { score: updates.score }),
      ...(updates.progress !== undefined && { progress: updates.progress }),
    };

    
// Rate Limit  add
    const response = await this.requestQueue.add(() => requestUrl({
  url: 'https://graphql.anilist.co',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.settings.accessToken}`
      },
      body: JSON.stringify({ query: mutation, variables })
    }));

    const result = response.json;

    if (!result || result.errors?.length > 0) {
      const message = result.errors?.[0]?.message || 'Unknown mutation error';
      throw new Error(`AniList update error: ${message}`);
    }

    // Targeted cache clearing instead of full clear
    clearCacheForMedia.bind(this)(mediaId);
    
    return result.data.SaveMediaListEntry;

  } catch (error) {
    console.error('[Zoro] updateMediaListEntry failed:', error);
    throw new Error(`❌ Failed to update entry: ${error.message}`);
  }
}

export async function checkIfMediaInList(mediaId, mediaType) {
  if (!this.settings.accessToken) return false;
  
  try {
    const config = {
      type: 'single',
      mediaType: mediaType,
      mediaId: parseInt(mediaId)
    };
    
    const response = await fetchZoroData.bind(this)(config);
    return response.MediaList !== null;
  } catch (error) {
    console.warn('Error checking media list status:', error);
    return false;
  }
}

export async function addMediaToList(mediaId, updates, mediaType) {
  if (!this.settings.accessToken) {
    throw new Error('Authentication required');
  }
  

  return await updateMediaListEntry.bind(this)(mediaId, updates);
}

