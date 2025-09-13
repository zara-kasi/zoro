import { Notice, type Plugin, type Vault } from 'obsidian';

interface FolderConfig {
  readonly name: string;
  readonly files: readonly string[];
  readonly firstFile: string;
}

export class Sample {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async createSampleFolders(): Promise<void> {
    new Notice('Creating…', 3000);
    const vault: Vault = this.plugin.app.vault;
    const parentFolder = 'Zoro';
    
    const folders: readonly FolderConfig[] = [
      {
        name: 'Anime',
        files: ['Watching.md', 'Planning.md', 'Re-watching .md', 'On Hold.md', 'Completed.md', 'Dropped.md',
        'Trending.md','Stats.md'],
        firstFile: 'Trending.md'
      },
      {
        name: 'Manga', 
        files: ['Reading.md', 'Planning.md', 'Re-reading.md', 'On Hold.md', 'Completed.md', 'Dropped.md','Trending.md', 'Stats.md'],
        firstFile: 'Trending.md'
      },
       {
        name: 'Movie',
        files: ['Planning.md', 'Completed.md', 'Dropped.md', 'Trending.md', 'Stats.md'],
        firstFile: 'Planning.md'
      },
      {
        name: 'TV',
        files: ['Watching.md', 'Planning.md', 'On Hold.md', 'Completed.md', 'Dropped.md',
        'Trending.md', 'Stats.md'],
        firstFile: 'Watching.md'
      }
    ] as const;

    if (!vault.getAbstractFileByPath(parentFolder)) {
      await vault.createFolder(parentFolder);
    }

    for (const folder of folders) {
      const folderPath = `${parentFolder}/${folder.name}`;
      
      if (vault.getAbstractFileByPath(folderPath)) {
        new Notice(`⏭️ ${folder.name} already exists in ${parentFolder}`);
        continue;
      }

      const baseUrl = `https://raw.githubusercontent.com/zara-kasi/zoro/main/Template/${encodeURIComponent(folder.name)}/`;
      await vault.createFolder(folderPath);
      let successfulFiles = 0;

      for (const templateFile of folder.files) {
        try {
          const fileUrl = baseUrl + encodeURIComponent(templateFile);
          const response = await fetch(fileUrl);
          
          if (!response.ok) {
            continue;
          }

          const content = await response.text();
          const filePath = `${folderPath}/${templateFile}`;
          
          await vault.create(filePath, content);
          successfulFiles++;
          
        } catch (error) {
          // Silently continue on error as per original behavior
          continue;
        }
      }

      new Notice(`✅ ${folder.name} in ${parentFolder} (${successfulFiles} files)`);
      
      if (successfulFiles > 0) {
        this.plugin.app.workspace.openLinkText(folder.firstFile, folderPath, false);
      }
    }
  }
}
