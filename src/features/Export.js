class Export {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async ensureZoroFolder() {
    const folderPath = 'Zoro/Export';
    const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.plugin.app.vault.createFolder(folderPath);
    }
    return folderPath;
  }

  async exportUnifiedListsToCSV() {
    let username = this.plugin.settings.authUsername;
    if (!username) username = this.plugin.settings.defaultUsername;
    if (!username) {
      new Notice('Set a default username in settings first.', 3000);
      return;
    }

    const useAuth = !!this.plugin.settings.accessToken;
    const query = `
      query ($userName: String) {
        MediaListCollection(userName: $userName, type: ANIME) {
          lists {
            name
            entries {
              status progress score(format: POINT_10) repeat
              startedAt { year month day } completedAt { year month day }
              media {
                id idMal type format
                title { romaji english native }
                episodes chapters volumes
                startDate { year month day } endDate { year month day }
                averageScore genres
                studios(isMain: true) { nodes { name } }
              }
            }
          }
        }
      }
    `;

    new Notice(`${useAuth ? '📥 Full' : '📥 Public'} export started…`, 3000);
    const progress = this.createProgressNotice('📊 Exporting… 0 %');
    const fetchType = async type => {
      const headers = { 'Content-Type': 'application/json' };
      if (useAuth) {
        await this.plugin.auth.ensureValidToken();
        headers['Authorization'] = `Bearer ${this.plugin.settings.accessToken}`;
      }

      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: 'https://graphql.anilist.co',
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: query.replace('type: ANIME', `type: ${type}`),
            variables: { userName: username }
          })
        })
      );
      const percent = type === 'ANIME' ? 33 : 66;
      this.updateProgressNotice(progress, `📊 Exporting… ${percent} %`);
      return res.json.data?.MediaListCollection?.lists || [];
    };

    const [animeLists, mangaLists] = await Promise.all([fetchType('ANIME'), fetchType('MANGA')]);
    
    if (!animeLists.flatMap(l => l.entries).length && !mangaLists.flatMap(l => l.entries).length) {
      new Notice('No lists found (private or empty).', 3000);
      return;
    }

    this.updateProgressNotice(progress, '📊 Generating standard export files...');

    const folderPath = await this.ensureZoroFolder();

    await this.createAniListUnifiedCSV([...animeLists, ...mangaLists], folderPath);

    if (animeLists.flatMap(l => l.entries).length > 0) {
      await this.createAniListAnimeXML(animeLists, folderPath);
    }

    if (mangaLists.flatMap(l => l.entries).length > 0) {
      await this.createAniListMangaXML(mangaLists, folderPath);
    }

    const totalItems = [...animeLists, ...mangaLists].flatMap(l => l.entries).length;
    const fileCount = 1 + (animeLists.flatMap(l => l.entries).length > 0 ? 1 : 0) + (mangaLists.flatMap(l => l.entries).length > 0 ? 1 : 0);
    
    this.finishProgressNotice(progress, `✅ Exported ${totalItems} items in ${fileCount} files`);
    new Notice(`✅ AniList export complete! Created ${fileCount} files`, 3000);
  }

  async createAniListUnifiedCSV(lists, folderPath) {
    const rows = [];
    const headers = [
      'ListName', 'Status', 'Progress', 'Score', 'Repeat',
      'StartedAt', 'CompletedAt', 'MediaID', 'Type', 'Format',
      'TitleRomaji', 'TitleEnglish', 'TitleNative',
      'Episodes', 'Chapters', 'Volumes',
      'MediaStart', 'MediaEnd', 'AverageScore', 'Genres', 'MainStudio', 'URL','MAL_ID'
    ];
    rows.push(headers.join(','));

    for (const list of lists) {
      for (const e of list.entries) {
        const m = e.media;
        const row = [
          list.name, e.status, e.progress ?? 0, e.score ?? '', e.repeat ?? 0,
          this.dateToString(e.startedAt), this.dateToString(e.completedAt),
          m.id, m.type, m.format,
          this.csvEscape(m.title.romaji), this.csvEscape(m.title.english), this.csvEscape(m.title.native),
          m.episodes ?? '', m.chapters ?? '', m.volumes ?? '',
          this.dateToString(m.startDate), this.dateToString(m.endDate),
          m.averageScore ?? '', this.csvEscape((m.genres || []).join(';')),
          this.csvEscape(m.studios?.nodes?.[0]?.name || ''),
          this.csvEscape(this.plugin.getAniListUrl(m.id, m.type)), m.idMal ?? ''
        ];
        rows.push(row.join(','));
      }
    }

    const csv = rows.join('\n');
    const fileName = `${folderPath}/Zoro_AniList_Unified.csv`;
    await this.plugin.app.vault.create(fileName, csv);
    console.log('[AniList Export] Unified CSV created successfully');
    await this.plugin.app.workspace.openLinkText(fileName, '', false);
  }

  async createAniListAnimeXML(animeLists, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>1</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let animeXml = '';
    
    for (const list of animeLists) {
      for (const entry of list.entries) {
        const media = entry.media;
        const malStatus = this.mapAniListToMalStatus(entry.status);
        const score = entry.score || 0;
        const episodes = entry.progress || 0;
        const malId = media.idMal || 0;
        
        const startDate = this.aniListDateToString(entry.startedAt);
        const finishDate = entry.status === 'COMPLETED' ? this.aniListDateToString(entry.completedAt) : '';
        
        const animeType = this.getAniListAnimeType(media.format);
        
        animeXml += `
  <anime>
    <series_animedb_id>${malId}</series_animedb_id>
    <series_title><![CDATA[${media.title.english || media.title.romaji || media.title.native || ''}]]></series_title>
    <series_type>${animeType}</series_type>
    <series_episodes>${media.episodes || 0}</series_episodes>
    <my_id>0</my_id>
    <my_watched_episodes>${episodes}</my_watched_episodes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_storage_value>0.00</my_storage_value>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[Imported from AniList - List: ${list.name}]]></my_comments>
    <my_times_watched>${entry.repeat || 0}</my_times_watched>
    <my_rewatch_value></my_rewatch_value>
    <my_priority>LOW</my_priority>
    <my_tags><![CDATA[${(media.genres || []).join(', ')}]]></my_tags>
    <my_rewatching>0</my_rewatching>
    <my_rewatching_ep>0</my_rewatching_ep>
    <update_on_import>1</update_on_import>
  </anime>`;
      }
    }

    const xml = xmlHeader + animeXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_AniList_Anime.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[AniList Export] Anime MAL XML created successfully');
  }

  async createAniListMangaXML(mangaLists, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>2</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let mangaXml = '';
    
    for (const list of mangaLists) {
      for (const entry of list.entries) {
        const media = entry.media;
        const malStatus = this.mapAniListToMalStatus(entry.status);
        const score = entry.score || 0;
        const chapters = entry.progress || 0;
        const malId = media.idMal || 0;
        
        const startDate = this.aniListDateToString(entry.startedAt);
        const finishDate = entry.status === 'COMPLETED' ? this.aniListDateToString(entry.completedAt) : '';
        
        const mangaType = this.getAniListMangaType(media.format);
        
        mangaXml += `
  <manga>
    <series_mangadb_id>${malId}</series_mangadb_id>
    <series_title><![CDATA[${media.title.english || media.title.romaji || media.title.native || ''}]]></series_title>
    <series_type>${mangaType}</series_type>
    <series_chapters>${media.chapters || 0}</series_chapters>
    <series_volumes>${media.volumes || 0}</series_volumes>
    <my_id>0</my_id>
    <my_read_chapters>${chapters}</my_read_chapters>
    <my_read_volumes>0</my_read_volumes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[Imported from AniList - List: ${list.name}]]></my_comments>
    <my_times_read>${entry.repeat || 0}</my_times_read>
    <my_reread_value></my_reread_value>
    <my_priority>LOW</my_priority>
    <my_tags><![CDATA[${(media.genres || []).join(', ')}]]></my_tags>
    <my_rereading>0</my_rereading>
    <my_rereading_chap>0</my_rereading_chap>
    <update_on_import>1</update_on_import>
  </manga>`;
      }
    }

    const xml = xmlHeader + mangaXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_AniList_Manga.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[AniList Export] Manga MAL XML created successfully');
  }

  mapAniListToMalStatus(anilistStatus) {
    const statusMap = {
      'CURRENT': 'Watching',
      'READING': 'Reading',
      'COMPLETED': 'Completed',
      'PAUSED': 'On-Hold',
      'DROPPED': 'Dropped',
      'PLANNING': 'Plan to Watch',
      'PLAN_TO_READ': 'Plan to Read'
    };
    return statusMap[anilistStatus] || 'Plan to Watch';
  }

  getAniListAnimeType(format) {
    if (!format) return 'TV';
    
    const typeMap = {
      'TV': 'TV',
      'TV_SHORT': 'TV',
      'MOVIE': 'Movie',
      'SPECIAL': 'Special',
      'OVA': 'OVA',
      'ONA': 'ONA',
      'MUSIC': 'Music'
    };
    
    return typeMap[format] || 'TV';
  }

  getAniListMangaType(format) {
    if (!format) return 'Manga';
    
    const typeMap = {
      'MANGA': 'Manga',
      'LIGHT_NOVEL': 'Light Novel',
      'ONE_SHOT': 'One-shot',
      'DOUJINSHI': 'Doujinshi',
      'MANHWA': 'Manhwa',
      'MANHUA': 'Manhua',
      'NOVEL': 'Novel'
    };
    
    return typeMap[format] || 'Manga';
  }

  aniListDateToString(dateObj) {
    if (!dateObj || !dateObj.year) return '0000-00-00';
    const month = String(dateObj.month || 0).padStart(2, '0');
    const day = String(dateObj.day || 0).padStart(2, '0');
    return `${dateObj.year}-${month}-${day}`;
  }
  
  async exportMALListsToCSV() {
    if (!this.plugin.malAuth.isLoggedIn) {
      new Notice('❌ Please authenticate with MyAnimeList first.', 3000);
      return;
    }

    const username = this.plugin.settings.malUserInfo?.name;
    if (!username) {
      new Notice('❌ Could not fetch MAL username.', 3000);
      return;
    }

    new Notice('📥 Exporting MyAnimeList…', 3000);
    const progress = this.createProgressNotice('📊 MAL export 0 %');

    const fetchType = async type => {
      const headers = this.plugin.malAuth.getAuthHeaders();
      const apiType = type === 'ANIME' ? 'anime' : 'manga';
      const url = `https://api.myanimelist.net/v2/users/@me/${apiType}list?fields=list_status{status,score,num_episodes_watched,num_chapters_read,is_rewatching,num_times_rewatched,rewatch_value,start_date,finish_date,priority,num_times_reread,comments,tags},node{id,title,media_type,status,num_episodes,num_chapters,num_volumes,start_season,source,rating,mean,genres}&limit=1000&nsfw=true`;

      const res = await this.plugin.requestQueue.add(() =>
        requestUrl({ url, method: 'GET', headers })
      );
      
      const items = (res.json?.data || []).map(item => ({
        ...item,
        _type: type
      }));
      
      const percent = type === 'ANIME' ? 33 : 66;
      this.updateProgressNotice(progress, `📊 MAL export ${percent} %`);
      return items;
    };

    const [anime, manga] = await Promise.all([
      fetchType('ANIME'),
      fetchType('MANGA')
    ]);

    if (anime.length === 0 && manga.length === 0) {
      new Notice('No MAL data found.', 3000);
      return;
    }

    this.updateProgressNotice(progress, '📊 Generating standard export files...');

    const folderPath = await this.ensureZoroFolder();

    await this.createMALUnifiedCSV([...anime, ...manga], folderPath);

    if (anime.length > 0) {
      await this.createMALAnimeXML(anime, folderPath);
    }

    if (manga.length > 0) {
      await this.createMALMangaXML(manga, folderPath);
    }

    const totalItems = anime.length + manga.length;
    const fileCount = 1 + (anime.length > 0 ? 1 : 0) + (manga.length > 0 ? 1 : 0);
    
    this.finishProgressNotice(progress, `✅ Exported ${totalItems} items in ${fileCount} files`);
    new Notice(`✅ MAL export complete! Created ${fileCount} files`, 3000);
  }

  async createMALUnifiedCSV(allItems, folderPath) {
    const rows = [];
    const headers = [
      'Type','Status','Progress','Score','Title','Start','End','Episodes','Chapters','Mean','MAL_ID','URL'
    ];
    rows.push(headers.join(','));

    allItems.forEach(item => {
      const m = item.node;
      const s = item.list_status;
      const type = item._type;
      rows.push([
        type,
        s.status,
        s.num_episodes_watched || s.num_chapters_read || 0,
        s.score || '',
        this.csvEscape(m.title),
        this.malDateToString(s.start_date),
        this.malDateToString(s.finish_date),
        m.num_episodes || '',
        m.num_chapters || '',
        m.mean || '',
        m.id,
        this.csvEscape(`https://myanimelist.net/${type.toLowerCase()}/${m.id}`)
      ].join(','));
    });

    const csv = rows.join('\n');
    const fileName = `${folderPath}/Zoro_MAL_Unified.csv`;
    await this.plugin.app.vault.create(fileName, csv);
    console.log('[MAL Export] Unified CSV created successfully');
    await this.plugin.app.workspace.openLinkText(fileName, '', false);
  }

  async createMALAnimeXML(animeItems, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>1</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let animeXml = '';
    
    animeItems.forEach(item => {
      const media = item.node;
      const listStatus = item.list_status;
      
      const malStatus = this.mapMALStatusToXML(listStatus.status, 'anime');
      const score = listStatus.score || 0;
      const episodes = listStatus.num_episodes_watched || 0;
      const malId = media.id;
      
      const startDate = this.malDateToString(listStatus.start_date);
      const finishDate = this.malDateToString(listStatus.finish_date);
      
      const animeType = this.getMALAnimeType(media.media_type);
      
      animeXml += `
  <anime>
    <series_animedb_id>${malId}</series_animedb_id>
    <series_title><![CDATA[${media.title || ''}]]></series_title>
    <series_type>${animeType}</series_type>
    <series_episodes>${media.num_episodes || 0}</series_episodes>
    <my_id>0</my_id>
    <my_watched_episodes>${episodes}</my_watched_episodes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_storage_value>0.00</my_storage_value>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[${listStatus.comments || ''}]]></my_comments>
    <my_times_watched>${listStatus.num_times_rewatched || 0}</my_times_watched>
    <my_rewatch_value>${listStatus.rewatch_value || ''}</my_rewatch_value>
    <my_priority>${this.mapMALPriority(listStatus.priority)}</my_priority>
    <my_tags><![CDATA[${this.formatMALTags(listStatus.tags, media.genres)}]]></my_tags>
    <my_rewatching>${listStatus.is_rewatching ? 1 : 0}</my_rewatching>
    <my_rewatching_ep>0</my_rewatching_ep>
    <update_on_import>1</update_on_import>
  </anime>`;
    });

    const xml = xmlHeader + animeXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_MAL_Anime.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[MAL Export] Anime XML created successfully');
  }

  async createMALMangaXML(mangaItems, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>2</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let mangaXml = '';
    
    mangaItems.forEach(item => {
      const media = item.node;
      const listStatus = item.list_status;
      
      const malStatus = this.mapMALStatusToXML(listStatus.status, 'manga');
      const score = listStatus.score || 0;
      const chapters = listStatus.num_chapters_read || 0;
      const malId = media.id;
      
      const startDate = this.malDateToString(listStatus.start_date);
      const finishDate = this.malDateToString(listStatus.finish_date);
      
      const mangaType = this.getMALMangaType(media.media_type);
      
      mangaXml += `
  <manga>
    <series_mangadb_id>${malId}</series_mangadb_id>
    <series_title><![CDATA[${media.title || ''}]]></series_title>
    <series_type>${mangaType}</series_type>
    <series_chapters>${media.num_chapters || 0}</series_chapters>
    <series_volumes>${media.num_volumes || 0}</series_volumes>
    <my_id>0</my_id>
    <my_read_chapters>${chapters}</my_read_chapters>
    <my_read_volumes>0</my_read_volumes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[${listStatus.comments || ''}]]></my_comments>
    <my_times_read>${listStatus.num_times_reread || 0}</my_times_read>
    <my_reread_value></my_reread_value>
    <my_priority>${this.mapMALPriority(listStatus.priority)}</my_priority>
    <my_tags><![CDATA[${this.formatMALTags(listStatus.tags, media.genres)}]]></my_tags>
    <my_rereading>0</my_rereading>
    <my_rereading_chap>0</my_rereading_chap>
    <update_on_import>1</update_on_import>
  </manga>`;
    });

    const xml = xmlHeader + mangaXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_MAL_Manga.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[MAL Export] Manga XML created successfully');
  }

  mapMALStatusToXML(malStatus, type) {
    const animeStatusMap = {
      'watching': 'Watching',
      'completed': 'Completed',
      'on_hold': 'On-Hold',
      'dropped': 'Dropped',
      'plan_to_watch': 'Plan to Watch'
    };

    const mangaStatusMap = {
      'reading': 'Reading',
      'completed': 'Completed',
      'on_hold': 'On-Hold',
      'dropped': 'Dropped',
      'plan_to_read': 'Plan to Read'
    };

    const statusMap = type === 'anime' ? animeStatusMap : mangaStatusMap;
    return statusMap[malStatus] || (type === 'anime' ? 'Plan to Watch' : 'Plan to Read');
  }

  getMALAnimeType(mediaType) {
    if (!mediaType) return 'TV';
    
    const typeMap = {
      'tv': 'TV',
      'movie': 'Movie',
      'ova': 'OVA',
      'special': 'Special',
      'ona': 'ONA',
      'music': 'Music'
    };
    
    return typeMap[mediaType.toLowerCase()] || 'TV';
  }

  getMALMangaType(mediaType) {
    if (!mediaType) return 'Manga';
    
    const typeMap = {
      'manga': 'Manga',
      'novel': 'Novel',
      'light_novel': 'Light Novel',
      'one_shot': 'One-shot',
      'doujinshi': 'Doujinshi',
      'manhwa': 'Manhwa',
      'manhua': 'Manhua'
    };
    
    return typeMap[mediaType.toLowerCase()] || 'Manga';
  }

  mapMALPriority(priority) {
    const priorityMap = {
      0: 'LOW',
      1: 'MEDIUM', 
      2: 'HIGH'
    };
    return priorityMap[priority] || 'LOW';
  }

  formatMALTags(userTags, genres) {
    const tags = [];
    
    if (userTags && Array.isArray(userTags)) {
      tags.push(...userTags);
    }
    
    if (genres && Array.isArray(genres)) {
      tags.push(...genres.map(genre => genre.name || genre));
    }
    
    return tags.join(', ');
  }

  malDateToString(dateStr) {
    if (!dateStr) return '0000-00-00';
    return dateStr;
  }

  async exportSimklListsToCSV() {
    if (!this.plugin.simklAuth.isLoggedIn) {
      new Notice('❌ Please authenticate with SIMKL first.', 3000);
      return;
    }

    const username = this.plugin.settings.simklUserInfo?.user?.name;
    if (!username) {
      new Notice('❌ Could not fetch SIMKL username.', 3000);
      return;
    }

    console.log('[SIMKL Export] Starting export for user:', username);
    new Notice('📥 Exporting SIMKL data…', 3000);
    const progress = this.createProgressNotice('📊 Fetching SIMKL data...');

    try {
      this.updateProgressNotice(progress, '📊 Fetching all items...');
      
      const allItemsUrl = 'https://api.simkl.com/sync/all-items/';
      console.log('[SIMKL Export] Fetching from:', allItemsUrl);

      const allItemsRes = await this.plugin.requestQueue.add(() =>
        requestUrl({
          url: allItemsUrl,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.plugin.settings.simklAccessToken}`,
            'simkl-api-key': this.plugin.settings.simklClientId,
            'Content-Type': 'application/json'
          },
          throw: false
        })
      );

      console.log('[SIMKL Export] Response status:', allItemsRes.status);
      console.log('[SIMKL Export] Response data:', allItemsRes.json);

      if (allItemsRes.status !== 200) {
        throw new Error(`Failed to fetch data: HTTP ${allItemsRes.status}`);
      }

      const data = allItemsRes.json || {};
      console.log('[SIMKL Export] Data keys:', Object.keys(data));
      console.log('[SIMKL Export] Data structure:', data);

      const allItems = [];
      let totalItemsFound = 0;

      Object.keys(data).forEach(category => {
        console.log(`[SIMKL Export] Processing category: ${category}`);
        
        if (data[category] && Array.isArray(data[category])) {
          console.log(`[SIMKL Export] Found ${data[category].length} items in ${category}`);
          totalItemsFound += data[category].length;
          
          data[category].forEach(item => {
            allItems.push({
              ...item,
              _category: category,
              _type: this.determineItemType(item, category)
            });
          });
        } else if (data[category] && typeof data[category] === 'object') {
          console.log(`[SIMKL Export] ${category} has subcategories:`, Object.keys(data[category]));
          
          Object.keys(data[category]).forEach(status => {
            if (Array.isArray(data[category][status])) {
              console.log(`[SIMKL Export] Found ${data[category][status].length} items in ${category}.${status}`);
              totalItemsFound += data[category][status].length;
              
              data[category][status].forEach(item => {
                allItems.push({
                  ...item,
                  _category: category,
                  _status: status,
                  _type: this.determineItemType(item, category)
                });
              });
            }
          });
        }
      });

      console.log('[SIMKL Export] Total items processed:', allItems.length);
      console.log('[SIMKL Export] Total items found:', totalItemsFound);

      if (allItems.length === 0) {
        console.log('[SIMKL Export] No items found after processing');
        this.finishProgressNotice(progress, '❌ No data found');
        new Notice('No SIMKL data found after processing.', 3000);
        return;
      }

      const animeItems = allItems.filter(item => 
        item._category === 'anime' || 
        item._type === 'ANIME' ||
        (item.show && item.show.type === 'anime')
      );
      
      const moviesTvItems = allItems.filter(item => 
        item._category === 'movies' || 
        item._category === 'shows' ||
        item._type === 'MOVIE' || 
        item._type === 'SHOW' ||
        item.movie || 
        (item.show && item.show.type !== 'anime')
      );

      this.updateProgressNotice(progress, '📊 Generating standard export files...');

      const folderPath = await this.ensureZoroFolder();

      await this.createSimklUnifiedCSV(allItems, folderPath);

      if (moviesTvItems.length > 0) {
        await this.createSimklImdbCSV(moviesTvItems, folderPath);
      }

      if (animeItems.length > 0) {
        await this.createSimklMalXML(animeItems, folderPath);
      }

      this.finishProgressNotice(progress, `✅ Exported ${allItems.length} items in multiple formats`);
      new Notice(`✅ SIMKL export complete! Created ${1 + (moviesTvItems.length > 0 ? 1 : 0) + (animeItems.length > 0 ? 1 : 0)} files`, 3000);

    } catch (error) {
      console.error('[SIMKL Export] Export failed:', error);
      this.finishProgressNotice(progress, `❌ Export failed: ${error.message}`);
      new Notice(`❌ SIMKL export failed: ${error.message}`, 3000);
    }
  }

  async createSimklUnifiedCSV(allItems, folderPath) {
    const headers = [
      'Category', 'Type', 'Title', 'Year', 'Status', 'Rating',
      'SIMKL_ID', 'IMDB_ID', 'TMDB_ID', 'MAL_ID', 'Anilist_ID'
    ];

    const rows = [headers.join(',')];
    
    allItems.forEach((item, index) => {
      const safeGet = (obj, path, fallback = '') => {
        try {
          return path.split('.').reduce((o, p) => (o && o[p]) || fallback, obj);
        } catch {
          return fallback;
        }
      };

      const mediaObject = item.show || item.movie || item.anime || {};
      
      const row = [
        item._category || '',
        item._type || '',
        this.csvEscape(mediaObject.title || mediaObject.name || ''),
        mediaObject.year || mediaObject.aired?.year || mediaObject.released?.year || '',
        item._status || item.status || '',
        item.user_rating || item.rating || item.score || '',
        safeGet(mediaObject, 'ids.simkl'),
        safeGet(mediaObject, 'ids.imdb'),
        safeGet(mediaObject, 'ids.tmdb'),
        safeGet(mediaObject, 'ids.mal'),
        safeGet(mediaObject, 'ids.anilist')
      ];
      
      rows.push(row.join(','));
    });

    const csv = rows.join('\n');
    const fileName = `${folderPath}/Zoro_SIMKL_Unified.csv`;
    
    await this.plugin.app.vault.create(fileName, csv);
    console.log('[SIMKL Export] Unified CSV created successfully');
    await this.plugin.app.workspace.openLinkText(fileName, '', false);
  }

  async createSimklImdbCSV(moviesTvItems, folderPath) {
    const headers = [
      'Const', 'Your Rating', 'Date Rated', 'Title', 'URL', 'Title Type', 
      'IMDb Rating', 'Runtime (mins)', 'Year', 'Genres', 'Num Votes', 
      'Release Date', 'Directors'
    ];

    const rows = [headers.join(',')];
    
    moviesTvItems.forEach(item => {
      const mediaObject = item.show || item.movie || {};
      const safeGet = (obj, path, fallback = '') => {
        try {
          return path.split('.').reduce((o, p) => (o && o[p]) || fallback, obj);
        } catch {
          return fallback;
        }
      };

      const dateRated = this.getDateFromStatus(item._status || item.status);
      const imdbId = safeGet(mediaObject, 'ids.imdb');
      const imdbUrl = imdbId ? `https://www.imdb.com/title/${imdbId}/` : '';
      const titleType = item._category === 'movies' ? 'movie' : 'tvSeries';
      
      const row = [
        imdbId || '',
        item.user_rating || item.rating || item.score || '',
        dateRated,
        this.csvEscape(mediaObject.title || mediaObject.name || ''),
        this.csvEscape(imdbUrl),
        titleType,
        mediaObject.rating || '',
        mediaObject.runtime || '',
        mediaObject.year || mediaObject.aired?.year || mediaObject.released?.year || '',
        this.csvEscape((mediaObject.genres || []).join(', ')),
        '',
        this.formatReleaseDate(mediaObject.released || mediaObject.aired),
        this.csvEscape((mediaObject.directors || []).join(', '))
      ];
      
      rows.push(row.join(','));
    });

    const csv = rows.join('\n');
    const fileName = `${folderPath}/Zoro_SIMKL_IMDb.csv`;
    
    await this.plugin.app.vault.create(fileName, csv);
    console.log('[SIMKL Export] IMDb CSV created successfully');
  }

  async createSimklMalXML(animeItems, folderPath) {
    const xmlHeader = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
  <myinfo>
    <user_id>0</user_id>
    <user_name>Zoro</user_name>
    <user_export_type>1</user_export_type>
  </myinfo>`;

    const xmlFooter = `</myanimelist>`;

    let animeXml = '';
    
    animeItems.forEach(item => {
      const mediaObject = item.show || item.anime || {};
      const safeGet = (obj, path, fallback = '') => {
        try {
          return path.split('.').reduce((o, p) => (o && o[p]) || fallback, obj);
        } catch {
          return fallback;
        }
      };

      const malStatus = this.mapSimklToMalStatus(item._status || item.status);
      const score = item.user_rating || item.rating || item.score || 0;
      const episodes = this.getSimklProgress(item);
      const malId = safeGet(mediaObject, 'ids.mal');
      
      const startDate = this.getDateFromStatus(item._status || item.status, 'start');
      const finishDate = malStatus === 'Completed' ? this.getDateFromStatus(item._status || item.status, 'finish') : '';
      
      animeXml += `
  <anime>
    <series_animedb_id>${malId || 0}</series_animedb_id>
    <series_title><![CDATA[${mediaObject.title || mediaObject.name || ''}]]></series_title>
    <series_type>${this.getAnimeType(mediaObject)}</series_type>
    <series_episodes>${mediaObject.episodes || 0}</series_episodes>
    <my_id>0</my_id>
    <my_watched_episodes>${episodes}</my_watched_episodes>
    <my_start_date>${startDate}</my_start_date>
    <my_finish_date>${finishDate}</my_finish_date>
    <my_rated></my_rated>
    <my_score>${score}</my_score>
    <my_storage></my_storage>
    <my_storage_value>0.00</my_storage_value>
    <my_status>${malStatus}</my_status>
    <my_comments><![CDATA[Imported from SIMKL]]></my_comments>
    <my_times_watched>0</my_times_watched>
    <my_rewatch_value></my_rewatch_value>
    <my_priority>LOW</my_priority>
    <my_tags><![CDATA[]]></my_tags>
    <my_rewatching>0</my_rewatching>
    <my_rewatching_ep>0</my_rewatching_ep>
    <update_on_import>1</update_on_import>
  </anime>`;
    });

    const xml = xmlHeader + animeXml + xmlFooter;
    const fileName = `${folderPath}/Zoro_SIMKL_MAL.xml`;
    
    await this.plugin.app.vault.create(fileName, xml);
    console.log('[SIMKL Export] MAL XML created successfully');
  }

  mapSimklToMalStatus(simklStatus) {
    const statusMap = {
      'watching': 'Watching',
      'completed': 'Completed',
      'plantowatch': 'Plan to Watch',
      'hold': 'On-Hold',
      'dropped': 'Dropped'
    };
    return statusMap[simklStatus?.toLowerCase()] || 'Plan to Watch';
  }

  getAnimeType(mediaObject) {
    if (!mediaObject.type) return 'TV';
    
    const typeMap = {
      'tv': 'TV',
      'movie': 'Movie',
      'ova': 'OVA',
      'ona': 'ONA',
      'special': 'Special',
      'music': 'Music'
    };
    
    return typeMap[mediaObject.type.toLowerCase()] || 'TV';
  }

  getDateFromStatus(status, type = 'rated') {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const currentDay = String(now.getDate()).padStart(2, '0');
    
    if (status === 'completed' && type === 'finish') {
      return `${currentYear}-${currentMonth}-${currentDay}`;
    } else if (type === 'start' && (status === 'watching' || status === 'completed')) {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      return `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    } else if (type === 'rated') {
      return `${currentYear}-${currentMonth}-${currentDay}`;
    }
    
    return '';
  }

  formatReleaseDate(dateObj) {
    if (!dateObj) return '';
    if (typeof dateObj === 'string') return dateObj;
    if (dateObj.year) {
      const month = String(dateObj.month || 1).padStart(2, '0');
      const day = String(dateObj.day || 1).padStart(2, '0');
      return `${dateObj.year}-${month}-${day}`;
    }
    return '';
  }

  xmlEscape(str) {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  determineItemType(item, category) {
    if (item.type) {
      return item.type.toUpperCase();
    }
    
    if (category) {
      return category.toUpperCase();
    }
    
    return 'UNKNOWN';
  }

  mapSimklStatus(simklStatus) {
    const statusMap = {
      'watching': 'CURRENT',
      'completed': 'COMPLETED', 
      'plantowatch': 'PLANNING',
      'hold': 'PAUSED',
      'dropped': 'DROPPED'
    };
    return statusMap[simklStatus] || simklStatus.toUpperCase();
  }

  getSimklProgress(item) {
    if (!item) return 0;

    const watched = (item.watched_episodes_count ?? item.watched_episodes ?? item.episodes_watched ?? item.progress);
    if (watched !== undefined && watched !== null && watched !== '') {
      const n = Number(watched);
      if (!isNaN(n)) return n;
    }

    const total = (item.total_episodes_count ?? item.total_episodes ?? item.episodes);
    if (item.seasons_watched && total) {
      const episodesPerSeason = Number(total) / (item.seasons || 1);
      return Math.floor(Number(item.seasons_watched) * episodesPerSeason);
    }

    const t = String(item._type || item.type || '').toLowerCase();
    if (t === 'movie' || item.media_type === 'movie') {
      return (String(item._status || item.status || '').toLowerCase() === 'completed') ? 1 : 0;
    }

    return Number(item.seasons_watched) || 0;
  }

  getSimklUrl(apiType, simklId, title) {
    if (!simklId) return '';
    
    const baseUrl = 'https://simkl.com';
    const urlType = apiType === 'anime' ? 'anime' : 
                   apiType === 'movies' ? 'movies' : 'tv';
    
    return `${baseUrl}/${urlType}/${simklId}`;
  }

  dateToString(dateObj) {
    if (!dateObj || !dateObj.year) return '';
    return `${dateObj.year}-${String(dateObj.month || 0).padStart(2, '0')}-${String(dateObj.day || 0).padStart(2, '0')}`;
  }

  csvEscape(str = '') {
    if (typeof str !== 'string') str = String(str);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
  
  createProgressNotice(message) {
    return new Notice(message, 0);
  }

  updateProgressNotice(notice, message) {
    notice.hide();
    return new Notice(message, 0);
  }

  finishProgressNotice(notice, message) {
    notice.hide();
    new Notice(message, 3000);
  }
}

export { Export };