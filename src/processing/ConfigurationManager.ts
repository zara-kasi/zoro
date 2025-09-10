// ConfigurationManager.ts - Handles configuration parsing and validation

import { 
  ProcessorConfig, 
  ConfigKeyMappings, 
  ZoroPlugin,
  ApiSource,
  MediaType,
  ListType,
  LayoutType,
  OperationType
} from './ProcessorTypes';

export class ConfigurationManager {
  private plugin: ZoroPlugin;

  private readonly keyMappings: ConfigKeyMappings = {
    'username': 'username',
    'user': 'username',
    'listtype': 'listType',
    'list-type': 'listType',
    'list_type': 'listType',
    'mediatype': 'mediaType',
    'media-type': 'mediaType',
    'media_type': 'mediaType',
    'type': 'type',
    'layout': 'layout',
    'search': 'search',
    'query': 'search',
    'source': 'source',
    'api': 'source',
    'page': 'page',
    'perpage': 'perPage',
    'per-page': 'perPage',
    'per_page': 'perPage',
    'limit': 'perPage',
    'mediaid': 'mediaId',
    'media-id': 'mediaId',
    'media_id': 'mediaId',
    'id': 'mediaId'
  };

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
  }

  parseCodeBlockConfig(source: string): ProcessorConfig {
    const config: Partial<ProcessorConfig> = {};
    const lines = source.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    for (let raw of lines) {
      const colonIndex = raw.indexOf(':');
      if (colonIndex === -1) continue;

      let key = raw.slice(0, colonIndex).trim().toLowerCase();
      let value = raw.slice(colonIndex + 1).trim();

      const mappedKey = this.keyMappings[key];
      if (!mappedKey) continue;

      config[mappedKey] = this.processConfigValue(mappedKey, value);
    }

    return this.applyConfigDefaults(config as ProcessorConfig);
  }

  private processConfigValue(key: keyof ProcessorConfig, value: string): any {
    switch (key) {
      case 'listType':
        return (value.toUpperCase().replace(/[\s-]/g, '_') as ListType);
      case 'mediaType':
        return (value.toUpperCase() as MediaType);
      case 'type':
      case 'layout':
      case 'source':
        return value.toLowerCase();
      case 'page':
      case 'perPage':
      case 'mediaId':
        return parseInt(value) || undefined;
      default:
        return value;
    }
  }

  private applyConfigDefaults(config: Partial<ProcessorConfig>): ProcessorConfig {
    const mt = String(config.mediaType || 'ANIME').toUpperCase() as MediaType;
    
    // Set default source based on media type
    if (!config.source) {
      if (mt === 'MOVIE' || mt === 'MOVIES' || mt === 'TV' || mt === 'SHOW' || mt === 'SHOWS') {
        config.source = 'simkl';
      } else if (mt === 'MANGA') {
        const def = this.plugin.settings.defaultApiSource || 'anilist';
        config.source = def === 'simkl' ? 'mal' : def;
      } else {
        config.source = this.plugin.settings.defaultApiSource || 'anilist';
      }
    }

    // Handle trending operation defaults
    if (config.type === 'trending') {
      config.mediaType = config.mediaType || 'ANIME';
      config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
      config.limit = config.limit || config.perPage || 40;
      
      const mtUpper = config.mediaType.toUpperCase() as MediaType;
      if (['MOVIE','MOVIES','TV','SHOW','SHOWS'].includes(mtUpper)) {
        config.source = 'simkl';
      } else if (mtUpper === 'MANGA' && config.source === 'simkl') {
        config.source = 'mal';
      }
      
      return config as ProcessorConfig;
    }

    // Skip auto-authentication for search operations
    if (config.type === 'search') {
      config.mediaType = config.mediaType || 'ANIME';
      config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
      return config as ProcessorConfig;
    }

    // Handle authentication requirements
    this.handleAuthentication(config);

    // Apply remaining defaults
    config.type = config.type || 'list';
    config.mediaType = config.mediaType || 'ANIME';
    config.layout = config.layout || this.plugin.settings.defaultLayout || 'card';
    
    if (!config.listType && config.type === 'list') {
      config.listType = 'CURRENT';
    }

    // Validate source-specific constraints
    this.validateSourceConstraints(config as ProcessorConfig);

    return config as ProcessorConfig;
  }

  private handleAuthentication(config: Partial<ProcessorConfig>): void {
    if (config.source === 'mal' || config.source === 'simkl') {
      if (!this.hasValidAuthForSource(config.source)) {
        throw new Error(`❌ ${config.source.toUpperCase()} authentication required. Please authenticate in plugin settings.`);
      }
    } else {
      // AniList authentication logic
      if (!config.username) {
        if (this.plugin.settings.defaultUsername) {
          config.username = this.plugin.settings.defaultUsername;
        } else if (this.plugin.settings.anilistUsername) {
          config.username = this.plugin.settings.anilistUsername;
        } else if (this.hasValidAuthForSource(config.source!)) {
          if (config.type !== 'search') {
            config.useAuthenticatedUser = true;
          }
        } else {
          throw new Error('❌ Username is required. Please set a default username in plugin settings, authenticate, or specify one in the code block.');
        }
      }
    }
  }

  private validateSourceConstraints(config: ProcessorConfig): void {
    if ((config.source === 'mal' || config.source === 'simkl') && config.listType === 'REPEATING') {
      throw new Error('Repeating is supported only on AniList.');
    }
    
    if (config.source === 'simkl' && config.mediaType === 'MANGA') {
      throw new Error('Manga is supported only on AniList and MyAnimeList.');
    }
  }

  private hasValidAuthForSource(source: ApiSource): boolean {
    switch (source) {
      case 'mal':
        return !!this.plugin.settings.malAccessToken;
      case 'simkl':
        return !!this.plugin.settings.simklAccessToken;
      case 'anilist':
        return !!this.plugin.settings.accessToken;
      default:
        return false;
    }
  }
}