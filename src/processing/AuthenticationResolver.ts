// AuthenticationResolver.ts - Handles authentication resolution

import { ProcessorConfig, ZoroPlugin } from './ProcessorTypes';

export class AuthenticationResolver {
  private plugin: ZoroPlugin;

  constructor(plugin: ZoroPlugin) {
    this.plugin = plugin;
  }

  async resolveAuthentication(config: ProcessorConfig): Promise<ProcessorConfig> {
    const updatedConfig = { ...config };

    // MAL and Simkl don't need username resolution
    if (config.source === 'mal' || config.source === 'simkl') {
      return updatedConfig;
    }

    // Handle AniList authentication
    if (updatedConfig.useAuthenticatedUser) {
      const authUsername = await this.plugin.auth.getAuthenticatedUsername();
      if (!authUsername) {
        throw new Error('❌ Could not retrieve authenticated username. Please authenticate or provide a username.');
      }
      updatedConfig.username = authUsername;
    }

    return updatedConfig;
  }
}