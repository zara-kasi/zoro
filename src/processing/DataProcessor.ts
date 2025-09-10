// DataProcessor.ts - Handles data processing and metadata injection

import { 
  ProcessorConfig, 
  MediaEntry, 
  ZoroMetadata,
  ProcessorData 
} from './ProcessorTypes';

export class DataProcessor {
  
  injectMetadata<T extends ProcessorData>(data: T, config: ProcessorConfig): T {
    if (!data) return data;
    
    const metadata: ZoroMetadata = {
      source: config.source || 'anilist',
      mediaType: config.mediaType || 'ANIME'
    };

    if (Array.isArray(data)) {
      data.forEach(entry => {
        if (entry && typeof entry === 'object') {
          (entry as MediaEntry)._zoroMeta = metadata;
          // Ensure media type is consistent
          if ((entry as MediaEntry).media && !(entry as MediaEntry).media!.type) {
            (entry as MediaEntry).media!.type = metadata.mediaType;
          }
        }
      });
      return data;
    }
    
    // Handle single entry
    if (data && typeof data === 'object') {
      (data as any)._zoroMeta = metadata;
      if ((data as MediaEntry).media && !(data as MediaEntry).media!.type) {
        (data as MediaEntry).media!.type = metadata.mediaType;
      }
    }
    
    return data;
  }

  injectTrendingMetadata(data: MediaEntry[], config: ProcessorConfig): MediaEntry[] {
    if (!Array.isArray(data)) return data;

    data.forEach(item => {
      if (!item._zoroMeta) {
        item._zoroMeta = {
          source: config.source,
          mediaType: config.mediaType,
          fetchedAt: Date.now()
        };
      }
    });

    return data;
  }
}