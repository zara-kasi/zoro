const { Notice } = require('obsidian');

async function createSampleNotes(plugin) {
  try {
    const notes = [
      {
        title: 'Anime Dashboard',
        content: `\`\`\`zoro-search\nmediaType: ANIME\n\`\`\`\n\n# 👀 Watching:\n\`\`\`zoro\nlistType: CURRENT\nmediaType: ANIME\n\`\`\`\n\n# 📝 Planning:\n\`\`\`zoro\nlistType: PLANNING\nmediaType: ANIME\n\`\`\`\n\n# 🌀 Repeating:\n\`\`\`zoro\nlistType: REPEATING\nmediaType: ANIME\n\`\`\`\n\n# ⏸️ On Hold:\n\`\`\`zoro\nlistType: PAUSED\nmediaType: ANIME\n\`\`\`\n\n# 🏁 Completed:\n\`\`\`zoro\nlistType: COMPLETED\nmediaType: ANIME\n\`\`\`\n\n# 🗑️ Dropped:\n\`\`\`zoro\nlistType: DROPPED\nmediaType: ANIME\n\`\`\`\n\n# 📊 Stats:\n\`\`\`zoro\ntype: stats\n\`\`\`\n`
      },
      {
        title: 'Manga Dashboard',
        content: `\`\`\`zoro-search\nmediaType: MANGA\n\`\`\`\n\n# 📖 Reading:\n\`\`\`zoro\nlistType: CURRENT\nmediaType: MANGA\n\`\`\`\n\n# 📝 Planning:\n\`\`\`zoro\nlistType: PLANNING\nmediaType: MANGA\n\`\`\`\n\n# 🌀 Repeating:\n\`\`\`zoro\nlistType: REPEATING\nmediaType: MANGA\n\`\`\`\n\n# ⏸️ On Hold:\n\`\`\`zoro\nlistType: PAUSED\nmediaType: MANGA\n\`\`\`\n\n# 🏁 Completed:\n\`\`\`zoro\nlistType: COMPLETED\nmediaType: MANGA\n\`\`\`\n\n# 🗑️ Dropped:\n\`\`\`zoro\nlistType: DROPPED\nmediaType: MANGA\n\`\`\`\n\n# 📊 Stats:\n\`\`\`zoro\ntype: stats\n\`\`\`\n`
      }
    ];

    let success = 0;
    const errors = [];
    for (const note of notes) {
      try {
        const path = `${note.title}.md`;
        if (plugin.app.vault.getAbstractFileByPath(path)) { errors.push(`"${note.title}" already exists`); continue; }
        await plugin.app.vault.create(path, note.content);
        success++;
      } catch (e) { errors.push(`Failed to create "${note.title}": ${e.message}`); }
    }
    if (success) new Notice(`✅ Created ${success} sample note${success > 1 ? 's' : ''}!`, 4000);
    if (errors.length) new Notice(`Issues: ${errors.join(', ')}`, 5000);
    const first = plugin.app.vault.getAbstractFileByPath('Anime Dashboard.md');
    if (first) await plugin.app.workspace.openLinkText('Anime Dashboard.md', '', false);
  } catch (e) {
    new Notice(`Failed to create notes: ${e.message}`, 5000);
  }
}

module.exports = { createSampleNotes };
