import { Notice } from 'obsidian';

class Sample {
    constructor(plugin) {
        this.plugin = plugin;
    }

    async createSampleFolders() {
        new Notice('Creating…', 3000);
        const vault = this.plugin.app.vault;
        const parentFolder = 'Zoro';
        
        const folders = [
            {
                name: 'Anime',
                files: ['Watching.md', 'Planning.md', 'Re-watching .md', 'On Hold.md', 'Completed.md', 'Dropped.md',
                'Trending.md','Stats.md'],
                firstFile: 'Watching.md'
            },
            {
                name: 'Manga', 
                files: ['Reading.md', 'Planning.md', 'Re-reading.md', 'On Hold.md', 'Completed.md', 'Dropped.md','Trending.md', 'Stats.md'],
                firstFile: 'Reading.md'
            },
             {
                name: 'Movie',
                files: ['Planning.md', 'Completed.md', 'Dropped.md','Stats.md'],
                firstFile: 'Planning.md'
            },
            {
                name: 'TV',
                files: ['Watching.md', 'Planning.md', 'On Hold.md', 'Completed.md', 'Dropped.md', 'Stats.md'],
                firstFile: 'Watching.md'
            }
            
        ];

        if (!vault.getAbstractFileByPath(parentFolder)) {
            await vault.createFolder(parentFolder);
        }

        for (const folder of folders) {
            const folderPath = parentFolder + '/' + folder.name;
            
            if (vault.getAbstractFileByPath(folderPath)) {
                new Notice('⏭️ ' + folder.name + ' already exists in ' + parentFolder);
                continue;
            }

            const baseUrl = 'https://raw.githubusercontent.com/zara-kasi/zoro/main/Template/' + 
                           encodeURIComponent(folder.name) + '/';

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
                    const filePath = folderPath + '/' + templateFile;
                    
                    await vault.create(filePath, content);
                    successfulFiles++;
                    
                } catch (error) {
                    continue;
                }
            }

            new Notice('✅ ' + folder.name + ' in ' + parentFolder + ' (' + successfulFiles + ' files)');

            if (successfulFiles > 0) {
                this.plugin.app.workspace.openLinkText(folder.firstFile, folderPath, false);
            }
        }
    }
}

export { Sample };