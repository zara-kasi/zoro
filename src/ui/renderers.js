function createStatItem(label, value, safe) {
  const item = document.createElement('div');
  item.className = 'zoro-stat-item';
  item.innerHTML = `<span>${label}:</span><span>${safe(value)}</span>`;
  return item;
}

function createStatSection(title, stats, safe) {
  const section = document.createElement('div');
  section.className = 'zoro-stat-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.appendChild(heading);
  const labels = {
    count: 'Count',
    episodesWatched: 'Episodes',
    minutesWatched: 'Minutes',
    meanScore: 'Mean Score',
    chaptersRead: 'Chapters',
    volumesRead: 'Volumes'
  };
  for (const [key, label] of Object.entries(labels)) {
    if (stats[key] !== undefined) section.appendChild(createStatItem(label, stats[key].toLocaleString?.() || stats[key], safe));
  }
  return section;
}

function renderUserStats(el, user) {
  if (!user || !user.statistics) return require('./error').renderError(el, 'User statistics unavailable.');
  const safe = (v, f = '—') => (v != null ? v : f);
  const container = document.createElement('div');
  container.className = 'zoro-user-stats';
  container.innerHTML = `
    <div class="zoro-user-header">
      <img src="${safe(user.avatar?.medium)}" alt="${safe(user.name)}" class="zoro-user-avatar">
      <h3>${safe(user.name)}</h3>
    </div>
    <div class="zoro-stats-grid"></div>
  `;
  const grid = container.querySelector('.zoro-stats-grid');
  grid.appendChild(createStatSection('Anime', user.statistics.anime || {}, safe));
  grid.appendChild(createStatSection('Manga', user.statistics.manga || {}, safe));
  el.empty();
  el.appendChild(container);
}

function renderSingleMedia(el, mediaList, config, settings) {
  const media = mediaList.media;
  const title = media.title.english || media.title.romaji;
  const card = document.createElement('div');
  card.className = 'zoro-single-card';
  if (settings.showCoverImages) {
    const img = document.createElement('img');
    img.src = media.coverImage.large;
    img.alt = title;
    img.className = 'media-cover';
    card.appendChild(img);
  }
  const info = document.createElement('div');
  info.className = 'media-info';
  info.innerHTML = `
    <h3><a href="https://anilist.co/${config.mediaType.toLowerCase()}/${media.id}" target="_blank" rel="noopener noreferrer" class="zoro-title-link">${title}</a></h3>
    <div class="media-details">
      ${media.format ? `<span class="format-badge">${media.format}</span>` : ''}
      <span class="status-badge status-${mediaList.status.toLowerCase()}">${mediaList.status}</span>
      ${settings.showProgress ? `<span class="progress">${mediaList.progress}/${media.episodes || media.chapters || '?'}</span>` : ''}
      ${settings.showRatings && mediaList.score ? `<span class="score">★ ${mediaList.score}</span>` : ''}
    </div>
    ${settings.showGenres && media.genres?.length ? `<div class="genres">${media.genres.slice(0,3).map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>` : ''}
  `;
  el.empty();
  el.appendChild(card);
}

function renderMediaList(el, entries, config, settings, plugin) {
  const grid = document.createElement('div');
  grid.className = 'zoro-cards-grid';
  grid.style.setProperty('--zoro-grid-columns', settings.gridColumns);
  entries.forEach(entry => {
    const card = createMediaCard(entry, config, settings, plugin);
    grid.appendChild(card);
  });
  el.empty();
  el.appendChild(grid);
}

function createMediaCard(entry, config, settings, plugin) {
  const media = entry.media;
  const title = media.title.english || media.title.romaji || 'Untitled';
  const card = document.createElement('div');
  card.className = 'zoro-card';
  if (settings.showCoverImages && media.coverImage?.large) {
    const img = document.createElement('img');
    img.src = media.coverImage.large;
    img.alt = title;
    img.className = 'media-cover';
    card.appendChild(img);
  }
  const info = document.createElement('div');
  info.className = 'media-info';
  info.innerHTML = `
    <h4><a href="https://anilist.co/${config.mediaType.toLowerCase()}/${media.id}" target="_blank" rel="noopener noreferrer" class="anilist-title-link">${title}</a></h4>
    <div class="media-details">
      ${media.format ? `<span class="format-badge">${media.format}</span>` : ''}
      <span class="status-badge status-${entry.status?.toLowerCase()} clickable-status">${entry.status}</span>
      ${settings.showProgress ? `<span class="progress">${entry.progress}/${media.episodes || media.chapters || '?'}</span>` : ''}
      ${settings.showRatings && entry.score != null ? `<span class="score">★ ${entry.score}</span>` : ''}
    </div>
    ${settings.showGenres && media.genres?.length ? `<div class="genres">${media.genres.slice(0,3).map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>` : ''}
  `;
  const statusEl = info.querySelector('.clickable-status');
  if (statusEl) {
    statusEl.style.cursor = 'pointer';
    statusEl.title = settings.accessToken ? 'Click to edit' : 'Click to authenticate';
    statusEl.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      if (!settings.accessToken) return plugin.createAuthenticationPrompt();
      require('../ui/modals').createEditModal(entry, async updates => {
        try {
          await plugin.updateMediaListEntry(entry.media.id, updates);
          new Notice('✅ Updated!');
          plugin.clearCacheForMedia(entry.media.id);
          const block = el.closest('.markdown-rendered')?.querySelector('code');
          if (block) plugin.processZoroCodeBlock(block.textContent, el.closest('.zoro-container'), {});
        } catch (err) {
          new Notice(`❌ Update failed: ${err.message}`);
        }
      }, () => new Notice('Edit canceled.'));
    };
  }
  card.appendChild(info);
  return card;
}

function renderTableLayout(el, entries, config, settings) {
  el.empty();
  const table = document.createElement('table');
  table.className = 'zoro-table';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  ['Title', 'Format', 'Status', ...(settings.showProgress ? ['Progress'] : []), ...(settings.showRatings ? ['Score'] : [])]
    .forEach(h => { const th = document.createElement('th'); th.textContent = h; tr.appendChild(th); });
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  entries.forEach(entry => {
    const row = document.createElement('tr');
    const title = entry.media.title.english || entry.media.title.romaji || 'Untitled';
    row.innerHTML = `
      <td><a href="https://anilist.co/${config.mediaType.toLowerCase()}/${entry.media.id}" target="_blank" rel="noopener noreferrer" class="zoro-title-link">${title}</a></td>
      <td>${entry.media.format || '-'}</td>
      <td><span class="zoro-badge status-${entry.status?.toLowerCase()} clickable-status">${entry.status}</span></td>
      ${settings.showProgress ? `<td>${entry.progress}/${entry.media.episodes || entry.media.chapters || '?'}</td>` : ''}
      ${settings.showRatings ? `<td>${entry.score != null ? `★ ${entry.score}` : '-'}</td>` : ''}
    `;
    const statusEl = row.querySelector('.clickable-status');
    if (statusEl) {
      statusEl.style.cursor = 'pointer';
      statusEl.title = settings.accessToken ? 'Click to edit' : 'Click to authenticate';
      statusEl.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        if (!settings.accessToken) return; // handled by parent
        require('../ui/modals').createEditModal(entry, async updates => {
          try {
            await require('../plugin/ZoroPlugin').prototype.updateMediaListEntry.call(/* plugin ref needed */);
            new Notice('✅ Updated!');
          } catch (err) {
            new Notice(`❌ Update failed: ${err.message}`);
          }
        }, () => new Notice('Edit canceled.'));
      };
    }
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  el.appendChild(table);
}

module.exports = { renderUserStats, renderSingleMedia, renderMediaList, renderTableLayout };
