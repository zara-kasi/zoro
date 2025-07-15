export function renderMediaList(el, entries, config) {
    const gridDiv = document.createElement('div');
    gridDiv.className = 'zoro-cards-grid';
    gridDiv.style.setProperty('--zoro-grid-columns', this.settings.gridColumns);

    entries.forEach(entry => {
      const card = this.createMediaCard(entry, config);
      gridDiv.appendChild(card);
    });

    el.empty();
    el.appendChild(gridDiv);
  }

export function  createMediaCard(entry, config) {
    const media = entry.media;
    if (!media) return document.createTextNode('⚠️ Missing media');

    const title = media.title.english || media.title.romaji || 'Untitled';

    const cardDiv = document.createElement('div');
    cardDiv.className = 'zoro-card';

    
    if (this.settings.showCoverImages && media.coverImage?.large) {
      const img = document.createElement('img');
      img.src = media.coverImage.large;
      img.alt = title;
      img.className = 'media-cover'; 
      cardDiv.appendChild(img);
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'media-info'; 

    
    const titleElement = document.createElement('h4');
    const titleLink = document.createElement('a');
    titleLink.href = this.getZoroUrl(media.id, config.mediaType);
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'anilist-title-link'; 
    titleLink.textContent = title;
    titleElement.appendChild(titleLink);
    infoDiv.appendChild(titleElement);

    // Details - using old styling approach
    const detailsDiv = this.createDetailsRow(entry);
    infoDiv.appendChild(detailsDiv);

    // Genres - 
    if (this.settings.showGenres && media.genres?.length) {
      const genresDiv = document.createElement('div');
      genresDiv.className = 'genres'; 
      media.genres.slice(0, 3).forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag'; 
        tag.textContent = genre;
        genresDiv.appendChild(tag);
      });
      infoDiv.appendChild(genresDiv);
    }

    cardDiv.appendChild(infoDiv);
    return cardDiv;
  }

 export function createDetailsRow(entry) {
    const media = entry.media;
    const details = document.createElement('div');
    details.className = 'media-details'; 

    
    if (media.format) {
      const format = document.createElement('span');
      format.className = 'format-badge'; 
      format.textContent = media.format;
      details.appendChild(format);
    }

    const status = document.createElement('span');
    status.className = `status-badge status-${entry.status?.toLowerCase()} clickable-status`; 
    status.textContent = entry.status ?? 'Unknown';
    status.style.cursor = 'pointer';

    if (this.settings.accessToken) {
      status.title = 'Click to edit';
      status.onclick = e => this.handleEditClick(e, entry, status);
    } else {
      status.title = 'Click to authenticate';
      status.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        this.createAuthenticationPrompt();
      };
    }

    details.appendChild(status);

    
    if (this.settings.showProgress) {
      const progress = document.createElement('span');
      progress.className = 'progress'; 
      const total = media.episodes ?? media.chapters ?? '?';
      progress.textContent = `${entry.progress}/${total}`; 
      details.appendChild(progress);
    }

    
    if (this.settings.showRatings && entry.score != null) {
      const score = document.createElement('span');
      score.className = 'score'; 
      score.textContent = `★ ${entry.score}`;
      details.appendChild(score);
    }

    return details;
  }