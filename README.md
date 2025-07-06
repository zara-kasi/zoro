# AniList Integration Plugin for Obsidian

Embed your AniList anime and manga data directly in your Obsidian notes, similar to how the Raindrop plugin works with bookmarks.

## Features

- 📺 **Embed your AniList data** - Display your anime/manga lists directly in your notes
- 🎨 **Multiple display options** - Choose between card layout or table layout
- 🔍 **Inline references** - Link to specific anime/manga or show user stats
- ⚡ **Cached data** - Fast loading with smart caching (5-minute cache)
- 🎯 **Customizable** - Show/hide images, ratings, progress, and more
- 📱 **Mobile friendly** - Works on desktop and mobile versions of Obsidian

## Installation

### Manual Installation

1. Download the latest release from the [releases page](https://github.com/yourusername/obsidian-anilist-plugin/releases)
2. Extract the files to your vault's `.obsidian/plugins/anilist-integration/` directory
3. Enable the plugin in Obsidian's settings under "Community plugins"

### From Community Plugins (Coming Soon)

1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode
3. Click Browse and search for "AniList Integration"
4. Install and enable the plugin

## Setup

1. Go to Settings → Community Plugins → AniList Integration
2. Enter your AniList username in the "Default Username" field
3. Configure your display preferences
4. Start using the plugin in your notes!


## [comprehensive guide on how to use all its features:](Guide.md)

### [Here is How I use it](My-Template.md)

## Advanced Features

### Caching

The plugin automatically caches AniList data for 5 minutes to improve performance and reduce API calls. You can manually clear the cache in the plugin settings.

### Error Handling

The plugin gracefully handles errors and will display helpful error messages if:
- The username doesn't exist
- The AniList API is unavailable
- Invalid anime/manga IDs are used

### Responsive Design

The plugin automatically adapts to different screen sizes and works well on both desktop and mobile versions of Obsidian.

## Customization

### Settings

You can customize the plugin behavior in Settings → Community Plugins → AniList Integration:

- **Default Username**: Your AniList username
- **Default List Type**: Which list to show by default
- **Show Cover Images**: Toggle image display
- **Show Ratings**: Toggle rating display
- **Show Progress**: Toggle progress display
- **Card Layout**: Choose between card or table layout

### CSS Customization

You can customize the appearance by adding CSS to your vault's `snippets` folder:

```css
/* Make cards smaller */
.anilist-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

/* Change genre tag colors */
.anilist-genre-tag {
    background: #ff6b6b;
    color: white;
}

/* Customize card hover effects */
.anilist-card:hover {
    transform: scale(1.05);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}
```

## Troubleshooting

### Common Issues

**"User not found" error**
- Check that the username is spelled correctly
- Ensure the AniList profile is public

**Images not loading**
- Check your internet connection
- The images are loaded from AniList's CDN

**Plugin not working**
- Make sure you have the latest version of Obsidian
- Check that the plugin is enabled in Community Plugins
- Try reloading Obsidian

### Getting Help

If you encounter issues:

1. Check the [Issues page](https://github.com/yourusername/obsidian-anilist-plugin/issues) on GitHub
2. Enable Debug mode in Obsidian settings and check the Developer Console
3. Create a new issue with your error details

## Contributing

Contributions are welcome! Please feel free to submit pull requests or create issues for bugs and feature requests.

### Development Setup

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start the development server
4. Make your changes and test thoroughly
5. Submit a pull request

## License

This plugin is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [AniList](https://anilist.co) for providing the excellent API
- [Obsidian](https://obsidian.md) for the amazing note-taking platform
- [Raindrop plugin](https://github.com/mtopping/obsidian-raindrop) for inspiration

## Support

If you find this plugin helpful, consider:
- ⭐ Starring the repository
- 🐛 Reporting bugs
- 💡 Suggesting new features
- ☕ [Buying me a coffee](https://github.com/sponsors/yourusername)

---

**Made with ❤️ for the Obsidian and AniList communities**
