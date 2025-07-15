export function validateSettings(settings) {
    return {
      defaultUsername: typeof settings?.defaultUsername === 'string' ? settings.defaultUsername : '',
      defaultLayout: ['card', 'list'].includes(settings?.defaultLayout) ? settings.defaultLayout : 'card',
      showCoverImages: !!settings?.showCoverImages,
      showRatings: !!settings?.showRatings,
      showProgress: !!settings?.showProgress,
      showGenres: !!settings?.showGenres,
      gridColumns: Number.isInteger(settings?.gridColumns) ? settings.gridColumns : 3,
      clientId: typeof settings?.clientId === 'string' ? settings.clientId : '',
      clientSecret: typeof settings?.clientSecret === 'string' ? settings.clientSecret : '',
      redirectUri: typeof settings?.redirectUri === 'string' ? settings.redirectUri : DEFAULT_SETTINGS.redirectUri,
      accessToken: typeof settings?.accessToken === 'string' ? settings.accessToken : '',
    };
  }
  
 export async function saveSettings() {
    try {
      const validSettings = this.validateSettings(this.settings);
      await this.saveData(validSettings);
      console.log('[Zoro] Settings saved successfully.');
    } catch (err) {
      console.error('[Zoro] Failed to save settings:', err);
      new Notice('⚠️ Failed to save settings. See console for details.');
    }
  }


export  async function loadSettings() {
    const saved = await this.loadData() || {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings = this.validateSettings(merged);
   
   // no secret saved...
   if (!this.settings.clientSecret) {
    const secret = await this.promptForSecret("Paste your client secret:");
    this.settings.clientSecret = secret.trim();
    await this.saveData(this.settings);
  }}
  