import { Notice, requestUrl } from 'obsidian';

class Theme {
static THEME_REPO_URL = 'https://api.github.com/repos/zara-kasi/zoro/contents/Theme?ref=main';

  constructor(plugin) {
    this.plugin = plugin;
    this.themeStyleId = 'zoro-theme';
    this.pluginScopes = [
      '.zoro-container',
      '.zoro-search-container',
      '.zoro-dashboard-container',
      '.zoro-edit-modal',
      '.zoro-auth-modal'
    ];
  }

   async fetchRemoteThemes() {
  try {
    const res = await fetch(Theme.THEME_REPO_URL);
    if (!res.ok) throw res.status;
    const json = await res.json();
    return json
      .filter(item => item.type === 'file' && item.name.endsWith('.css'))
      .map(item => item.name.replace('.css', ''));
  } catch (e) {
    console.warn('[Zoro] Remote theme list failed', e);
    return [];
  }
}
   async downloadTheme(name) {
  const rawUrl = `https://raw.githubusercontent.com/zara-kasi/zoro/main/Theme/${encodeURIComponent(name)}.css`;
  const localPath = `${this.plugin.manifest.dir}/themes/${name}.css`;
  
  try {
    // Check if file exists and delete it
    try {
      await this.plugin.app.vault.adapter.stat(localPath);
      // File exists, delete it
      await this.plugin.app.vault.adapter.remove(localPath);
    } catch (e) {
      // File doesn't exist, continue with download
    }

    const res = await fetch(rawUrl);
    if (!res.ok) throw res.status;
    const css = await res.text();
    
    // Ensure themes directory exists
    const themesDir = `${this.plugin.manifest.dir}/themes`;
    try {
      await this.plugin.app.vault.adapter.mkdir(themesDir);
    } catch (e) {
      // Directory already exists
    }
    
    await this.plugin.app.vault.adapter.write(localPath, css);
    new Notice(`✅ Theme "${name}" downloaded successfully`);
    
    // Auto-apply the theme after successful download
    await this.applyTheme(name);
    
    return true;
  } catch (e) {
    new Notice(`❌ Could not download "${name}": ${e}`);
    return false;
  }
}

  async getAvailableThemes() {
    try {
      const themesDir = `${this.plugin.manifest.dir}/themes`;
      const { files } = await this.plugin.app.vault.adapter.list(themesDir);
      return files
        .filter(f => f.endsWith('.css'))
        .map(f => f.split('/').pop().replace('.css', ''));
    } catch {
      return [];
    }
  }

  async applyTheme(themeName) {
    const old = document.getElementById(this.themeStyleId);
    if (old) old.remove();

    if (!themeName) return;

    const cssPath = `${this.plugin.manifest.dir}/themes/${themeName}.css`;
    let rawCss;
    try {
      rawCss = await this.plugin.app.vault.adapter.read(cssPath);
    } catch (err) {
      console.warn('Zoro: theme file missing:', themeName, err);
      new Notice(`❌ Theme "${themeName}" not found`);
      return;
    }

    const scopedCss = this.scopeToPlugin(rawCss);

    const style = document.createElement('style');
    style.id = this.themeStyleId;
    style.textContent = scopedCss;
    document.head.appendChild(style);
  }

   async deleteTheme(name) {
  const localPath = `${this.plugin.manifest.dir}/themes/${name}.css`;
  
  try {
    await this.plugin.app.vault.adapter.remove(localPath);
    new Notice(`✅ Theme "${name}" deleted successfully`);
    return true;
  } catch (e) {
    new Notice(`❌ Could not delete "${name}": ${e}`);
    return false;
  }
}
  scopeToPlugin(css) {
    const rules = this.extractCSSRules(css);
    const scopedRules = [];

    for (const rule of rules) {
      if (rule.type === 'at-rule') {
        scopedRules.push(this.handleAtRule(rule));
      } else if (rule.type === 'rule') {
        scopedRules.push(this.handleRegularRule(rule));
      } else {
        scopedRules.push(rule.content);
      }
    }

    return scopedRules.join('\n');
  }

  extractCSSRules(css) {
    const rules = [];
    let pos = 0;
    let current = '';
    let braceDepth = 0;
    let inAtRule = false;
    let atRuleType = '';

    while (pos < css.length) {
      const char = css[pos];
      current += char;

      if (char === '@' && braceDepth === 0) {
        if (current.slice(0, -1).trim()) {
          rules.push({ type: 'text', content: current.slice(0, -1) });
        }
        current = char;
        inAtRule = true;
        const match = css.slice(pos).match(/^@(\w+)/);
        atRuleType = match ? match[1] : '';
      }

      if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
        
        if (braceDepth === 0) {
          if (inAtRule) {
            rules.push({ type: 'at-rule', content: current, atType: atRuleType });
            inAtRule = false;
            atRuleType = '';
          } else {
            rules.push({ type: 'rule', content: current });
          }
          current = '';
        }
      }

      pos++;
    }

    if (current.trim()) {
      rules.push({ type: 'text', content: current });
    }

    return rules;
  }

  handleAtRule(rule) {
    if (rule.atType === 'media') {
      const mediaMatch = rule.content.match(/^(@media[^{]+)\{(.*)\}$/s);
      if (mediaMatch) {
        const mediaQuery = mediaMatch[1];
        const innerCSS = mediaMatch[2];
        const scopedInner = this.scopeToPlugin(innerCSS);
        return `${mediaQuery} {\n${scopedInner}\n}`;
      }
    }
    return rule.content;
  }

  handleRegularRule(rule) {
    const match = rule.content.match(/^([^{]+)\{(.*)\}$/s);
    if (!match) return rule.content;

    const selectors = match[1].trim();
    const declarations = match[2];

    const selectorList = selectors.split(',').map(s => s.trim());
    const scopedSelectors = [];

    for (const selector of selectorList) {
      if (this.isAlreadyPluginScoped(selector)) {
        scopedSelectors.push(selector);
      } else if (this.shouldBePluginScoped(selector)) {
        scopedSelectors.push(this.addPluginScope(selector));
      } else {
        scopedSelectors.push(selector);
      }
    }

    return `${scopedSelectors.join(', ')} {${declarations}}`;
  }

  isAlreadyPluginScoped(selector) {
    return this.pluginScopes.some(scope => selector.includes(scope));
  }

  shouldBePluginScoped(selector) {
    const globalPrefixes = [':root', 'html', 'body', '*'];
    const pluginPrefixes = ['.zoro-', '#zoro-'];
    
    const hasGlobalPrefix = globalPrefixes.some(prefix => selector.startsWith(prefix));
    const hasPluginPrefix = pluginPrefixes.some(prefix => selector.includes(prefix));
    
    return !hasGlobalPrefix && (hasPluginPrefix || !selector.startsWith('.'));
  }

  addPluginScope(selector) {
    const primaryScope = '.zoro-container';
    
    if (selector.includes('.zoro-modal') || selector.includes('.zoro-overlay')) {
      return selector;
    }
    
    if (selector.startsWith(':')) {
      return `${primaryScope}${selector}`;
    }
    
    return `${primaryScope} ${selector}`;
  }

  removeTheme() {
    const existingStyle = document.getElementById(this.themeStyleId);
    if (existingStyle) {
      existingStyle.remove();
    }
  }
}

export { Theme };
