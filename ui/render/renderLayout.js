export function renderTableLayout(el, entries, config) {
    el.empty();
    
    const table = document.createElement('table');
    table.className = 'zoro-table';

    // --- HEADER ---
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const headers = ['Title', 'Format', 'Status'];
    if (this.settings.showProgress) headers.push('Progress');
    if (this.settings.showRatings) headers.push('Score');

    headers.forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // --- BODY ---
    const tbody = document.createElement('tbody');

    entries.forEach(entry => {
      const media = entry.media;
      if (!media) return; // skip broken

      const row = document.createElement('tr');

      // --- Title ---
      const titleCell = document.createElement('td');
      const title = media.title.english || media.title.romaji || 'Untitled';
      const link = document.createElement('a');
      // RENAMED from getAniListUrl to getZoroUrl
      link.href = this.getZoroUrl(media.id, config.mediaType);
      link.textContent = title;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'zoro-title-link';
      titleCell.appendChild(link);
      row.appendChild(titleCell);

      // --- Format ---
      const formatCell = document.createElement('td');
      formatCell.textContent = media.format || '-';
      row.appendChild(formatCell);

      // --- Status ---
      const statusCell = document.createElement('td');
      const status = document.createElement('span');
      status.textContent = entry.status || '-';
      status.className = `zoro-badge status-${entry.status?.toLowerCase()} clickable-status`;
      status.style.cursor = 'pointer';

      if (this.settings.accessToken) {
        status.title = 'Click to edit';
        status.onclick = (e) => this.handleEditClick(e, entry, status);
      } else {
        status.title = 'Click to authenticate';
        status.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.createAuthenticationPrompt();
        };
      }

      statusCell.appendChild(status);
      row.appendChild(statusCell);

      // --- Progress ---
      if (this.settings.showProgress) {
        const progressCell = document.createElement('td');
        const total = media.episodes ?? media.chapters ?? '?';
        progressCell.textContent = `${entry.progress}/${total}`;
        row.appendChild(progressCell);
      }

      // --- Score ---
      if (this.settings.showRatings) {
        const scoreCell = document.createElement('td');
        scoreCell.textContent = entry.score != null ? `★ ${entry.score}` : '-';
        row.appendChild(scoreCell);
      }

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    el.appendChild(table);
  }