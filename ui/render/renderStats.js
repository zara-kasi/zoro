export function renderUserStats(el, user) {
    if (!user || !user.statistics) {
      renderError.bind(this)(el, 'User statistics unavailable.');
      return;
    }
    

    const safe = (val, fallback = '—') => (val != null ? val : fallback);

    const createStatItem = (label, value) => {
      const item = document.createElement('div');
      item.className = 'zoro-stat-item';
      item.innerHTML = `<span>${label}:</span><span>${safe(value)}</span>`;
      return item;
    };

    const createStatSection = (title, stats) => {
      const section = document.createElement('div');
      section.className = 'zoro-stat-section';

      const heading = document.createElement('h4');
      heading.textContent = title;
      section.appendChild(heading);

      for (const [key, label] of Object.entries({
        count: 'Count',
        episodesWatched: 'Episodes',
        minutesWatched: 'Minutes',
        meanScore: 'Mean Score',
        chaptersRead: 'Chapters',
        volumesRead: 'Volumes'
      })) {
        if (stats[key] !== undefined) {
          section.appendChild(createStatItem(label, stats[key].toLocaleString?.() || stats[key]));
        }
      }

      return section;
    };

    const container = document.createElement('div');
    container.className = 'zoro-user-stats';

    const header = document.createElement('div');
    header.className = 'zoro-user-header';
    header.innerHTML = `
      <img src="${safe(user.avatar?.medium, '')}" alt="${safe(user.name)}" class="zoro-user-avatar">
      <h3>${safe(user.name)}</h3>
    `;

    const statsGrid = document.createElement('div');
    statsGrid.className = 'zoro-stats-grid';

    statsGrid.appendChild(createStatSection('Anime', user.statistics.anime || {}));
    statsGrid.appendChild(createStatSection('Manga', user.statistics.manga || {}));

    container.appendChild(header);
    container.appendChild(statsGrid);
    el.appendChild(container);
  }
