# Zoro - Ultimate Media Tracking for Obsidian

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-blueviolet?style=flat-square&logo=obsidian)](https://obsidian.md/plugins?id=zoro)
[![GitHub release](https://img.shields.io/github/v/release/zara-kasi/zoro?style=flat-square)](https://github.com/zara-kasi/zoro/releases)
![GitHub Stars](https://img.shields.io/github/stars/zara-kasi/zoro?style=flat-square)
![GitHub Issues](https://img.shields.io/github/issues-raw/zara-kasi/zoro?style=flat-square)

> **"Zoro — The Ultimate Media Tracking Experience Inside Obsidian"**
> 
> Transform your Obsidian vault into a comprehensive media tracking powerhouse. Track anime, manga, movies, and TV shows with seamless integration across AniList, MyAnimeList, and Simkl. Experience the future of media organization with advanced features, beautiful visualizations, and powerful automation tools.

## 🎯 **What Makes Zoro Special?**

Zoro isn't just another media tracking plugin—it's a complete ecosystem that revolutionizes how you interact with your media consumption data. With its advanced architecture, comprehensive feature set, and seamless Obsidian integration, Zoro provides an unparalleled experience for media enthusiasts, content creators, and productivity seekers alike.

### **🌟 Why Choose Zoro?**

- **🎨 Beautiful Visualizations**: Stunning card layouts, responsive grids, and interactive elements
- **⚡ Lightning Fast Performance**: Smart caching, request queuing, and progressive loading
- **🔗 Seamless Integration**: Deep Obsidian integration with connected notes and automation
- **🌐 Multi-Platform Support**: Unified experience across AniList, MyAnimeList, and Simkl
- **🛠 Advanced Features**: Export tools, theme system, custom URLs, and more
- **📊 Rich Analytics**: Comprehensive statistics and insights
- **🎯 User-Centric Design**: Intuitive interface with extensive customization options

---

## 📋 **Comprehensive Table of Contents**

### **🚀 Getting Started**
- [Quick Start Guide](#-quick-start-guide)
- [Installation Methods](#-installation-methods)
- [First-Time Setup](#-first-time-setup)
- [Authentication Setup](#-authentication-setup)

### **🌟 Core Features & Capabilities**
- [Feature Overview](#-feature-overview)
- [Multi-Platform Support](#-multi-platform-support)
- [Visual Rendering System](#-visual-rendering-system)
- [Performance & Reliability](#-performance--reliability)
- [Advanced Functionality](#-advanced-functionality)
- [User Experience Features](#-user-experience-features)

### **📚 Documentation & Guides**
- [Setup Guides](#-setup-guides)
- [Platform Comparison](#-platform-comparison)
- [Usage Examples](#-usage-examples)
- [Code Block Reference](#-code-block-reference)

### **🎨 Display & Customization**
- [Layout System](#-layout-system)
- [Grid Column System](#-grid-column-system)
- [Theme System](#-theme-system)
- [Display Customization](#-display-customization)
- [Single Media Display](#-single-media-display)

### **⚙️ Configuration & Settings**
- [Settings Overview](#-settings-overview)
- [Account Management](#-account-management)
- [Display Configuration](#-display-configuration)
- [Performance Settings](#-performance-settings)
- [Advanced Configuration](#-advanced-configuration)

### **🔧 Advanced Features**
- [Smart Caching System](#-smart-caching-system)
- [Export & Migration Tools](#-export--migration-tools)
- [Connected Notes System](#-connected-notes-system)
- [Custom External URLs](#-custom-external-urls)
- [Edit & Management Tools](#-edit--management-tools)
- [Statistics & Analytics](#-statistics--analytics)
- [Search & Discovery](#-search--discovery)
- [Trending & Recommendations](#-trending--recommendations)

### **🌐 API Integration**
- [API Support Overview](#-api-support-overview)
- [AniList Integration](#-anilist-integration)
- [MyAnimeList Integration](#-myanimelist-integration)
- [Simkl Integration](#-simkl-integration)
- [TMDb Integration](#-tmdb-integration)

### **🤝 Community & Development**
- [Contributing Guidelines](#-contributing-guidelines)
- [Development Information](#-development-information)
- [Acknowledgements](#-acknowledgements)
- [License Information](#-license-information)

---

## 🚀 **Quick Start Guide**

### **🎯 Getting Started in 3 Simple Steps**

#### **Step 1: Install & Enable Zoro**

**Method 1: Community Plugin BRAT (Recommended)**
1. Open Obsidian Settings → Community Plugins
2. Enable BRAT plugin if not already enabled
3. Click "Add beta plugin"
4. Paste: `https://github.com/zara-kasi/zoro`
5. Click "Add plugin"
6. Enable Zoro in Community Plugins settings

**Method 2: Manual Installation**
1. Download latest release from [GitHub Releases](https://github.com/zara-kasi/zoro/releases)
2. Extract to `.obsidian/plugins/zoro/`
3. Restart Obsidian
4. Enable in Community Plugins settings

**System Requirements:**
- Obsidian v0.15.0 or higher
- Internet connection for API access
- Modern browser for authentication flows
- 50MB+ free space for caching and themes

#### **Step 2: Connect Your Accounts**

**🆔 Public Profile (Optional)**
- Enter your AniList username for view-only access
- No authentication required
- Perfect for exploring the plugin

**✳️ AniList Authentication (Recommended)**
- Click "Authenticate" button
- Follow the OAuth2 flow
- Provides full feature access
- Required for editing and private data

**🗾 MyAnimeList Authentication**
- Click "Authenticate" button
- Complete OAuth2 setup
- Full editing capabilities
- Cross-platform ID mapping

**🎬 SIMKL Authentication**
- Click "Authenticate" button
- Modern OAuth2 flow
- Support for movies and TV shows
- Real-time synchronization

#### **Step 3: Create Your Workspace**

**⚡ Sample Folder Setup (Recommended)**
1. Go to **Settings → Zoro → Setup → Sample Folder**
2. Click **Create**
3. This creates a complete folder structure:
   - `Zoro/Anime/` - Anime tracking files
   - `Zoro/Manga/` - Manga tracking files
   - `Zoro/Movie/` - Movie tracking files
   - `Zoro/TV/` - TV show tracking files

**📁 Folder Structure Created:**
```
Zoro/
├── Anime/
│   ├── Watching.md
│   ├── Planning.md
│   ├── Completed.md
│   ├── On Hold.md
│   ├── Dropped.md
│   ├── Re-watching.md
│   ├── Trending.md
│   └── Stats.md
├── Manga/
│   ├── Reading.md
│   ├── Planning.md
│   ├── Completed.md
│   ├── On Hold.md
│   ├── Dropped.md
│   ├── Re-reading.md
│   ├── Trending.md
│   └── Stats.md
├── Movie/
│   ├── Planning.md
│   ├── Completed.md
│   ├── Dropped.md
│   └── Stats.md
└── TV/
    ├── Watching.md
    ├── Planning.md
    ├── Completed.md
    ├── On Hold.md
    ├── Dropped.md
    └── Stats.md
```

### **🎯 First-Time Setup Checklist**

- [ ] Install and enable Zoro plugin
- [ ] Set up at least one authentication (AniList recommended)
- [ ] Create sample folder structure
- [ ] Configure default source (AniList recommended)
- [ ] Choose preferred layout (Card recommended)
- [ ] Test with a simple code block
- [ ] Explore settings and customization options

### **🚀 Quick Test**

Create a new note and add this code block to test your setup:

```zoro
type: stats
mediaType: anime
```

This will display your anime statistics if you're authenticated, or show a sample if you're using public mode.

---

## 🌟 **Comprehensive Feature Overview**

Zoro is a feature-rich media tracking solution that transforms your Obsidian vault into a powerful media management system. Every aspect has been carefully designed to provide the best possible user experience while maintaining performance and reliability.

### **📊 Multi-Platform Support**

Zoro seamlessly integrates with the world's leading media tracking platforms, providing a unified experience across all services.

**✳️ AniList Integration**
- **Full GraphQL API** integration with real-time data access
- **OAuth2 Authentication** for secure, token-based access
- **Comprehensive Coverage** of anime and manga databases
- **Advanced Features** including favorites, custom lists, and social features
- **Rich Metadata** including studios, genres, airing schedules, and more
- **Public Access** available without authentication for exploration

**🗾 MyAnimeList (MAL) Integration**
- **Complete REST API** integration with full feature support
- **OAuth2 Authentication** for secure account access
- **Cross-platform ID Mapping** for seamless data conversion
- **Rate Limiting Compliance** with intelligent request management
- **Legacy Support** for the original anime tracking platform
- **XML Export Compatibility** for data migration

**🎬 SIMKL Integration**
- **Modern REST API** with real-time synchronization
- **Multi-media Support** covering anime, movies, and TV shows
- **Advanced Filtering** and search capabilities
- **Cross-platform Linking** with IMDB and TMDb IDs
- **Real-time Updates** and status synchronization
- **Modern Interface** with contemporary design principles

### **🎨 Visual Rendering System**

Zoro's rendering system provides multiple ways to display your media data, each optimized for different use cases and preferences.

**🃏 Card Layout System**
- **Grid-based Display** with responsive column management
- **Cover Art Integration** with high-quality image loading
- **Hover Effects** with smooth animations and visual feedback
- **Progress Overlays** showing completion status at a glance
- **Status Badges** with color-coded indicators
- **Edit Buttons** for quick modifications
- **Rating Display** with star icons and numerical scores
- **Genre Tags** for quick categorization
- **Responsive Design** that adapts to different screen sizes

**📋 Table Layout System**
- **Compact Tabular View** for efficient space usage
- **Sortable Columns** by title, score, progress, and more
- **Quick Editing** with inline controls and status changes
- **Efficient Rendering** optimized for large lists
- **Keyboard Navigation** support for accessibility
- **Export-friendly** format for data analysis
- **Minimal Resource Usage** for performance-critical scenarios

**📊 Statistics Dashboard**
- **Enhanced Layout** with comprehensive analytics and charts
- **Compact Layout** for quick overview and summary
- **Minimal Layout** for simple text-based statistics
- **Real-time Updates** with automatic data refresh
- **Cross-platform Comparison** showing data from multiple sources
- **Trend Analysis** with historical data visualization
- **Customizable Display** options for different use cases

**🔍 Real-time Search System**
- **Instant Results** with live filtering and suggestions
- **Fuzzy Matching** for better search accuracy
- **Multiple Sources** integration across all platforms
- **Media Type Filtering** for targeted searches
- **Thumbnail Previews** for visual identification
- **Search History** for quick access to recent queries
- **Advanced Filters** for refined results

### **⚡ Performance & Reliability Architecture**

Zoro's performance system is built on modern web technologies and best practices to ensure smooth operation even with large datasets.

**🔄 Smart Caching System**
- **User Data**: 30 minutes (profile, lists, stats, preferences)
- **Media Data**: 10 minutes (details, covers, metadata, ratings)
- **Search Results**: 2 minutes (quick access, recent queries)
- **Airing Data**: 1 hour (schedule information, upcoming releases)
- **ID Conversions**: 30 days (cross-platform mapping, persistent data)
- **Trending Data**: 24 hours (popular content, discovery features)
- **Background Refresh**: Silent updates without user interruption

**🚦 Request Queue Management**
- **Intelligent Queuing** prevents API rate limiting
- **Priority System** for critical vs. background requests
- **Automatic Retry** with exponential backoff
- **Circuit Breakers** for graceful degradation during outages
- **Request Deduplication** to minimize redundant calls
- **Timeout Handling** for network issues
- **Error Recovery** with automatic fallback strategies

**📈 Progressive Loading System**
- **Chunked Rendering** processes large lists in 20-item batches
- **Lazy Loading** for images and non-critical content
- **Virtual Scrolling** for extremely large datasets
- **Background Processing** for non-blocking operations
- **Memory Management** with automatic cleanup
- **Performance Monitoring** with built-in metrics

**🛡️ Error Handling & Recovery**
- **Automatic Retries** with intelligent backoff strategies
- **Graceful Degradation** when services are unavailable
- **User-friendly Error Messages** with actionable suggestions
- **Fallback Mechanisms** for critical functionality
- **Logging System** for debugging and monitoring
- **Recovery Procedures** for data corruption scenarios

### **🛠 Advanced Functionality**

Zoro goes beyond basic media tracking to provide powerful tools for content creators, researchers, and power users.

**✏️ In-note Editing System**
- **Direct Editing** without leaving Obsidian interface
- **Real-time Updates** with immediate feedback
- **Bulk Operations** for multiple items
- **Undo/Redo Support** for mistake correction
- **Validation** to prevent invalid data entry
- **Cross-platform Sync** for multi-service users
- **Keyboard Shortcuts** for power users

**🔍 Rich Details Panel**
- **Press & Hold Activation** on cover images
- **Comprehensive Information** including cast, crew, reviews
- **Cross-platform Data** from multiple sources
- **Interactive Elements** with clickable links
- **Media Previews** with trailers and screenshots
- **Social Features** including reviews and ratings
- **Export Options** for data sharing

**📈 Trending Discovery System**
- **Real-time Data** from multiple platforms
- **Configurable Limits** (default: 40 items)
- **Source-specific Lists** for platform-specific trends
- **Cached Results** for performance optimization
- **Category Filtering** by genre, format, and more
- **Personalization** based on user preferences
- **Export Capabilities** for external analysis

**🔄 Cross-platform Synchronization**
- **Automatic ID Conversion** between AniList and MAL
- **Data Migration Tools** for platform switching
- **Consistent Formatting** across all services
- **Conflict Resolution** for data discrepancies
- **Backup Systems** for data protection
- **Validation** to ensure data integrity

### **🔗 Connected Notes System**

One of Zoro's most powerful features is its ability to automatically connect your media data with your existing notes and create new ones.

**🔍 Auto-detection System**
- **Smart Matching** using multiple identification methods
- **ID-based Matching** (MAL ID, AniList ID, SIMKL ID)
- **URL-based Matching** for external platform links
- **Title-based Matching** with fuzzy search algorithms
- **Tag-based Matching** using #Zoro tags
- **Cross-platform Linking** for comprehensive coverage

**📝 Note Creation & Management**
- **Automatic Note Generation** with media information
- **Template System** for consistent formatting
- **Customizable Paths** for organized file structure
- **Frontmatter Integration** with rich metadata
- **Code Block Insertion** for media display
- **Tag Management** for easy categorization

**🔄 Synchronization Features**
- **Bidirectional Updates** between notes and tracking data
- **Conflict Resolution** for data discrepancies
- **Version Control** for change tracking
- **Backup Systems** for data protection
- **Export Options** for external tools

### **📊 Export & Migration Tools**

Zoro provides comprehensive tools for data backup, migration, and external analysis.

**📄 CSV Export System**
- **Standard Format** compatible with spreadsheet applications
- **Comprehensive Data** including all tracking information
- **Customizable Fields** for specific use cases
- **Batch Processing** for large datasets
- **Progress Tracking** for long operations
- **Error Handling** for failed exports

**📋 XML Export System**
- **MAL Compatibility** for platform migration
- **Standard Format** for data interchange
- **Complete Metadata** including dates, scores, and notes
- **Validation** to ensure data integrity
- **Compression** for large files
- **Incremental Export** for regular backups

**🔄 Migration Tools**
- **Cross-platform Conversion** between services
- **Data Validation** to ensure accuracy
- **Conflict Resolution** for duplicate entries
- **Progress Tracking** for long operations
- **Rollback Capabilities** for failed migrations
- **Comprehensive Logging** for troubleshooting

### **🎨 Theme System**

Zoro's theme system provides extensive customization options for visual appearance.

**🎨 Built-in Themes**
- **Minimal Theme**: Clean, distraction-free interface
- **Glass Theme**: Modern glassmorphism design
- **Viscosity Theme**: Fluid, dynamic visual effects
- **Auto Theme**: Automatic light/dark mode detection
- **Custom Themes**: User-created and community themes

**🔧 Theme Management**
- **Download System** for remote themes
- **Auto-apply** functionality for immediate changes
- **Scoped CSS** to prevent conflicts
- **Live Preview** for theme testing
- **Backup/Restore** for theme configurations
- **Community Sharing** for theme distribution

### **🔗 Custom External URLs**

Zoro allows you to add custom external links for enhanced functionality.

**🌐 URL Management**
- **Site-specific Search** buttons for external platforms
- **Auto-formatting** with intelligent template learning
- **Multiple Platforms** support for various services
- **Template Learning** from example URLs
- **Validation** to ensure link functionality
- **Quick Access** from media detail panels

**🎯 Use Cases**
- **Review Sites** for additional opinions
- **Streaming Services** for legal viewing options
- **Social Media** for community discussions
- **News Sites** for industry updates
- **Fan Sites** for community content
- **Merchandise** for official products

### **🎯 User Experience Features**

Zoro prioritizes user experience with intuitive design and accessibility features.

**🎮 Interactive Elements**
- **Press & Hold** for detailed information
- **Click Actions** for quick editing
- **Hover Effects** for visual feedback
- **Keyboard Navigation** for accessibility
- **Touch Support** for mobile devices
- **Voice Commands** for hands-free operation

**⚡ Performance Optimizations**
- **Lazy Loading** for faster initial load times
- **Image Optimization** for reduced bandwidth usage
- **Memory Management** for long-term stability
- **Background Processing** for non-blocking operations
- **Cache Optimization** for improved response times
- **Resource Compression** for reduced file sizes

**🔧 Accessibility Features**
- **Screen Reader Support** for visual impairments
- **Keyboard Navigation** for motor impairments
- **High Contrast Mode** for visual accessibility
- **Font Scaling** for readability
- **Color Blind Support** for inclusive design
- **Voice Control** for hands-free operation

**📱 Responsive Design**
- **Mobile Optimization** for on-the-go access
- **Tablet Support** for touch interfaces
- **Desktop Enhancement** for power users
- **Cross-platform Compatibility** for all devices
- **Adaptive Layouts** for different screen sizes
- **Touch-friendly Controls** for mobile devices

---

## 📦 **Comprehensive Installation Guide**

Zoro can be installed through multiple methods, each designed for different user preferences and technical comfort levels. This guide provides detailed instructions for all installation methods.

### **🎯 Method 1: Community Plugin BRAT (Recommended)**

The BRAT (Beta Reviewer's Auto-update Tool) method is the recommended approach for most users, providing automatic updates and easy management.

**Step-by-Step Instructions:**
1. **Open Obsidian Settings**
   - Launch Obsidian
   - Go to Settings (gear icon) or press `Ctrl/Cmd + ,`

2. **Navigate to Community Plugins**
   - Click on "Community Plugins" in the left sidebar
   - If BRAT is not installed, you'll need to install it first

3. **Install BRAT (if not already installed)**
   - Search for "BRAT" in the community plugins
   - Click "Install" and then "Enable"
   - Restart Obsidian if prompted

4. **Add Zoro via BRAT**
   - In Community Plugins, click "BRAT"
   - Click "Add beta plugin"
   - Paste the repository URL: `https://github.com/zara-kasi/zoro`
   - Click "Add plugin"

5. **Enable Zoro**
   - Go back to Community Plugins
   - Find "Zoro" in the list
   - Click "Enable"
   - Accept any security prompts

**Benefits of BRAT Method:**
- ✅ Automatic updates when new versions are released
- ✅ Easy management through Obsidian's interface
- ✅ No manual file management required
- ✅ Built-in version control
- ✅ Community-tested installation process

### **🔧 Method 2: Manual Installation**

For users who prefer direct control over their plugin installation or who cannot use BRAT.

**Step-by-Step Instructions:**
1. **Download the Latest Release**
   - Visit [GitHub Releases](https://github.com/zara-kasi/zoro/releases)
   - Download the latest release ZIP file
   - Extract the contents to a temporary location

2. **Locate Your Obsidian Vault**
   - Open Obsidian
   - Go to Settings → About
   - Note your vault location
   - Navigate to `.obsidian/plugins/` in your vault

3. **Install the Plugin**
   - Create a new folder named `zoro` in the plugins directory
   - Copy all extracted files into the `zoro` folder
   - Ensure the structure looks like:
     ```
     .obsidian/plugins/zoro/
     ├── main.js
     ├── manifest.json
     ├── styles.css
     └── [other files]
     ```

4. **Restart and Enable**
   - Restart Obsidian completely
   - Go to Settings → Community Plugins
   - Find "Zoro" in the list
   - Click "Enable"

**Benefits of Manual Installation:**
- ✅ Complete control over installation
- ✅ No dependency on BRAT
- ✅ Can install specific versions
- ✅ Works in restricted environments
- ✅ Direct file access for customization

### **📱 Method 3: Development Installation**

For developers, contributors, or users who want the latest development version.

**Prerequisites:**
- Node.js (v16 or higher)
- npm or yarn package manager
- Git installed on your system

**Step-by-Step Instructions:**
1. **Clone the Repository**
   ```bash
   git clone https://github.com/zara-kasi/zoro.git
   cd zoro
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build the Plugin**
   ```bash
   npm run build
   ```

4. **Install to Obsidian**
   - Copy the built files to your `.obsidian/plugins/zoro/` directory
   - Restart Obsidian and enable the plugin

**Benefits of Development Installation:**
- ✅ Access to latest features and fixes
- ✅ Ability to contribute to development
- ✅ Custom modifications possible
- ✅ Debugging capabilities
- ✅ Understanding of plugin architecture

### **🔍 System Requirements**

**Minimum Requirements:**
- **Obsidian Version**: v0.15.0 or higher
- **Operating System**: Windows 10+, macOS 10.14+, or Linux
- **Memory**: 4GB RAM (8GB recommended)
- **Storage**: 50MB free space for plugin and cache
- **Network**: Stable internet connection for API access

**Recommended Requirements:**
- **Obsidian Version**: Latest stable release
- **Operating System**: Latest version of your OS
- **Memory**: 8GB RAM or more
- **Storage**: 100MB+ free space for themes and extensive caching
- **Network**: High-speed internet for optimal performance
- **Browser**: Modern browser for authentication flows

**Browser Compatibility:**
- **Chrome/Chromium**: v88+ (recommended)
- **Firefox**: v85+
- **Safari**: v14+
- **Edge**: v88+

### **🚨 Installation Troubleshooting**

**Common Issues and Solutions:**

**Issue: Plugin not appearing in Community Plugins**
- **Solution**: Ensure you've restarted Obsidian completely
- **Solution**: Check that files are in the correct directory structure
- **Solution**: Verify the manifest.json file is present and valid

**Issue: Authentication not working**
- **Solution**: Check your internet connection
- **Solution**: Ensure your browser allows pop-ups for Obsidian
- **Solution**: Try clearing browser cache and cookies

**Issue: Plugin crashes on startup**
- **Solution**: Check Obsidian version compatibility
- **Solution**: Disable other plugins to check for conflicts
- **Solution**: Check the console for error messages (F12)

**Issue: BRAT not working**
- **Solution**: Update BRAT to the latest version
- **Solution**: Check if your organization blocks GitHub access
- **Solution**: Try manual installation as an alternative

**Issue: Performance problems**
- **Solution**: Check available system memory
- **Solution**: Clear plugin cache in settings
- **Solution**: Disable unnecessary features temporarily

### **📋 Post-Installation Checklist**

After successful installation, verify the following:

- [ ] Plugin appears in Community Plugins list
- [ ] Plugin can be enabled without errors
- [ ] Settings tab appears in Obsidian settings
- [ ] Sample folder creation works
- [ ] Authentication flows function properly
- [ ] Basic code blocks render correctly
- [ ] No console errors in Developer Tools

### **🔄 Updating Zoro**

**BRAT Method (Automatic):**
- Updates are automatically detected and installed
- You'll be notified when updates are available
- Simply restart Obsidian to apply updates

**Manual Method:**
- Download the latest release from GitHub
- Replace the existing files in your plugin directory
- Restart Obsidian to apply changes

**Development Method:**
- Pull the latest changes: `git pull origin main`
- Rebuild: `npm run build`
- Copy updated files to your plugin directory
- Restart Obsidian

### **🗑️ Uninstalling Zoro**

**Complete Removal:**
1. Disable the plugin in Community Plugins
2. Delete the `.obsidian/plugins/zoro/` directory
3. Clear any Zoro-related cache files
4. Remove any Zoro folders you created (optional)

**Data Preservation:**
- Your media tracking data is stored on external platforms
- Zoro doesn't store personal data locally
- Removing the plugin won't affect your AniList, MAL, or SIMKL accounts

---

## 📚 **Comprehensive Setup Guides**

Zoro provides detailed guides for every aspect of setup and configuration. These guides are designed to help users of all technical levels successfully configure and use the plugin.

### **🔐 Authentication Setup Guides**

Authentication is the foundation of Zoro's functionality. These guides provide step-by-step instructions for setting up secure connections to your media tracking platforms.

**✳️ AniList Authentication Guide**
- **Purpose**: Full OAuth2 authentication for complete feature access
- **Features Covered**: Editing, private data access, favorites, custom lists
- **Difficulty Level**: Beginner-friendly with screenshots
- **Time Required**: 5-10 minutes
- **Prerequisites**: AniList account (free)
- **[→ View Complete Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/anilist-auth-setup.md)**

**🗾 MyAnimeList (MAL) Authentication Guide**
- **Purpose**: OAuth2 authentication for MAL integration
- **Features Covered**: Cross-platform sync, XML export compatibility
- **Difficulty Level**: Intermediate with detailed explanations
- **Time Required**: 10-15 minutes
- **Prerequisites**: MyAnimeList account (free)
- **[→ View Complete Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/mal-auth-setup.md)**

**🎬 SIMKL Authentication Guide**
- **Purpose**: Modern OAuth2 authentication for multi-media support
- **Features Covered**: Anime, movies, TV shows, real-time sync
- **Difficulty Level**: Beginner-friendly with modern interface
- **Time Required**: 5-10 minutes
- **Prerequisites**: SIMKL account (free)
- **[→ View Complete Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/simkl-auth-setup.md)**

### **📊 Data Management Guides**

**📤 Export & Migration Guide**
- **Purpose**: Comprehensive data backup and platform migration
- **Features Covered**: CSV export, XML export, cross-platform conversion
- **Use Cases**: Data backup, platform switching, external analysis
- **Difficulty Level**: Intermediate with advanced options
- **Time Required**: 15-30 minutes depending on data size
- **[→ View Complete Guide](https://github.com/zara-kasi/zoro/blob/main/Docs/export-doc.md)**

### **🎯 Quick Setup Reference**

**For New Users (Recommended Path):**
1. **Start with AniList** - Most comprehensive features
2. **Create Sample Folder** - Get organized structure
3. **Test Basic Features** - Verify everything works
4. **Add Additional Platforms** - Expand your tracking

**For Power Users:**
1. **Set up all platforms** - Maximum data coverage
2. **Configure custom settings** - Optimize for your workflow
3. **Set up connected notes** - Integrate with your vault
4. **Configure exports** - Regular data backups

**For Content Creators:**
1. **Focus on connected notes** - Link media to your content
2. **Set up custom URLs** - Quick access to review sites
3. **Configure exports** - Data for analysis and reporting
4. **Optimize performance** - Fast loading for large datasets

### **🔧 Advanced Configuration Guides**

**Theme Customization**
- **Built-in Themes**: Minimal, Glass, Viscosity
- **Custom Themes**: Download and apply community themes
- **CSS Customization**: Advanced styling options
- **Auto-apply**: Immediate theme changes

**Performance Optimization**
- **Cache Management**: Optimize storage and speed
- **Request Queuing**: Prevent rate limiting
- **Background Refresh**: Silent updates
- **Memory Management**: Efficient resource usage

**Workflow Integration**
- **Connected Notes**: Auto-link media to existing notes
- **Custom URLs**: Add external platform links
- **Export Scheduling**: Regular data backups
- **Cross-platform Sync**: Unified data across services

### **🚨 Troubleshooting Guides**

**Common Authentication Issues**
- **Browser Compatibility**: Ensure modern browser support
- **Network Issues**: Check firewall and proxy settings
- **Token Expiration**: Re-authenticate when needed
- **Rate Limiting**: Wait and retry

**Performance Issues**
- **Slow Loading**: Clear cache and optimize settings
- **Memory Usage**: Monitor system resources
- **Network Timeouts**: Check internet connection
- **Plugin Conflicts**: Disable conflicting plugins

**Data Synchronization**
- **Missing Data**: Check platform availability
- **Duplicate Entries**: Use conflict resolution tools
- **Export Failures**: Verify file permissions
- **Import Errors**: Check data format compatibility

### **📋 Setup Checklist by User Type**

**🎬 Anime Enthusiast**
- [ ] AniList authentication
- [ ] Sample folder creation
- [ ] Card layout configuration
- [ ] Cover images enabled
- [ ] Ratings display enabled
- [ ] Progress tracking enabled

**📚 Manga Reader**
- [ ] AniList authentication
- [ ] MAL authentication (optional)
- [ ] Table layout for large lists
- [ ] Chapter progress tracking
- [ ] Volume tracking enabled
- [ ] Genre filtering setup

**🎭 Multi-media Consumer**
- [ ] SIMKL authentication
- [ ] TMDb API key (optional)
- [ ] Cross-platform sync setup
- [ ] Custom external URLs
- [ ] Export configuration
- [ ] Connected notes setup

**📊 Data Analyst**
- [ ] All platform authentications
- [ ] Export tools configuration
- [ ] CSV export setup
- [ ] Regular backup scheduling
- [ ] Performance monitoring
- [ ] Custom URL integration

**🎨 Content Creator**
- [ ] Connected notes setup
- [ ] Custom URL configuration
- [ ] Theme customization
- [ ] Export tools setup
- [ ] Performance optimization
- [ ] Workflow integration

### **🔗 Additional Resources**

**Community Support**
- **GitHub Issues**: Report bugs and request features
- **Discussions**: Community help and tips
- **Wiki**: User-contributed documentation
- **Discord**: Real-time community support

**Developer Resources**
- **API Documentation**: Technical implementation details
- **Contributing Guide**: How to contribute to development
- **Architecture Overview**: Understanding the codebase
- **Testing Guide**: Quality assurance procedures

**Video Tutorials**
- **Setup Walkthrough**: Visual installation guide
- **Feature Demonstrations**: Showcase of key features
- **Advanced Usage**: Power user techniques
- **Troubleshooting**: Common problem solutions

---

## 📱 **Comprehensive Platform Support & Comparison**

Zoro provides seamless integration with the world's leading media tracking platforms, each offering unique features and capabilities. This comprehensive comparison helps you understand which platforms best suit your needs.

### **🌐 Platform Overview**

| Platform | Status | Primary Focus | Media Types | API Type | Authentication |
|----------|--------|---------------|-------------|----------|----------------|
| **✳️ AniList** | ✅ Full Production | Anime & Manga | Anime, Manga | GraphQL | OAuth2 |
| **🗾 MyAnimeList** | ✅ Full Production | Legacy Anime | Anime, Manga | REST | OAuth2 |
| **🎬 SIMKL** | ✅ Beta | Multi-media | Anime, Movies, TV | REST | OAuth2 |

### **📊 Detailed Feature Comparison**

| Feature Category | AniList | MyAnimeList | Simkl | Notes |
|------------------|---------|-------------|-------|-------|
| **🔐 Authentication** | OAuth2 | OAuth2 | OAuth2 | All platforms use modern OAuth2 |
| **📺 Anime Support** | ✅ Full | ✅ Full | ✅ Full | Complete anime database coverage |
| **📚 Manga Support** | ✅ Full | ✅ Full | ⚠️ Limited | SIMKL focuses on anime/movies |
| **🎬 Movies Support** | ❌ No | ❌ No | ✅ Full | SIMKL excels in movie tracking |
| **📺 TV Shows Support** | ❌ No | ❌ No | ✅ Full | SIMKL covers all TV content |
| **🔄 Repeating Status** | ✅ Yes | ❌ No | ❌ No | AniList unique feature |
| **🌍 Public Access** | ✅ Yes | ❌ No | ❌ No | AniList allows view-only access |
| **🔗 API Type** | GraphQL | REST | REST | GraphQL offers more flexibility |
| **⚡ Real-time Updates** | ✅ Yes | ⚠️ Limited | ✅ Yes | SIMKL excels in real-time sync |
| **📊 Rich Statistics** | ✅ Yes | ⚠️ Basic | ✅ Yes | AniList has most comprehensive stats |
| **🎨 Custom Lists** | ✅ Yes | ❌ No | ✅ Yes | AniList and SIMKL support custom lists |
| **⭐ Favorites System** | ✅ Yes | ⚠️ Limited | ✅ Yes | AniList has most robust favorites |
| **🔍 Advanced Search** | ✅ Yes | ⚠️ Basic | ✅ Yes | All platforms offer search, quality varies |
| **📱 Mobile App** | ✅ Yes | ✅ Yes | ✅ Yes | All have mobile applications |
| **🌐 Web Interface** | ✅ Yes | ✅ Yes | ✅ Yes | All have web-based interfaces |
| **📊 Export Options** | ✅ Yes | ✅ Yes | ⚠️ Limited | MAL has best export compatibility |
| **🔄 Cross-platform Sync** | ✅ Yes | ✅ Yes | ✅ Yes | All support data synchronization |

### **🎯 Platform-Specific Strengths**

#### **✳️ AniList - The Comprehensive Choice**

**🎯 Best For:**
- Anime and manga enthusiasts
- Users who want rich statistics and analytics
- Content creators and reviewers
- Users who prefer modern, fast interfaces
- Those who want public access without authentication

**🌟 Key Strengths:**
- **GraphQL API**: Fast, flexible, and efficient data retrieval
- **Rich Metadata**: Comprehensive information including studios, genres, airing schedules
- **Advanced Statistics**: Detailed analytics and insights
- **Social Features**: Reviews, recommendations, and community features
- **Custom Lists**: Create and share custom anime/manga lists
- **Public Access**: View public data without authentication
- **Modern Interface**: Clean, responsive design
- **Real-time Updates**: Live data synchronization
- **Comprehensive Database**: Extensive anime and manga coverage

**📊 Data Quality:**
- **Anime Coverage**: 99%+ of all anime series and movies
- **Manga Coverage**: 95%+ of all manga series
- **Metadata Quality**: Excellent with rich descriptions and tags
- **Image Quality**: High-resolution cover art and screenshots
- **Update Frequency**: Real-time updates for airing schedules

#### **🗾 MyAnimeList - The Legacy Powerhouse**

**🎯 Best For:**
- Long-time anime fans with existing MAL accounts
- Users who need XML export compatibility
- Those who prefer the original anime tracking platform
- Users who want maximum compatibility with other tools

**🌟 Key Strengths:**
- **Legacy Support**: Long-standing platform with extensive history
- **XML Export**: Perfect compatibility with MAL import tools
- **Cross-platform ID Mapping**: Excellent integration with other services
- **Comprehensive Database**: Extensive anime and manga coverage
- **Community Features**: Large, active user community
- **Rate Limiting Compliance**: Robust API with proper rate limiting
- **Data Migration**: Easy import/export with other platforms
- **Stable API**: Reliable and well-documented REST API

**📊 Data Quality:**
- **Anime Coverage**: 98%+ of all anime series and movies
- **Manga Coverage**: 97%+ of all manga series
- **Metadata Quality**: Good with comprehensive information
- **Image Quality**: High-quality cover art and promotional images
- **Update Frequency**: Regular updates for new releases

#### **🎬 SIMKL - The Modern Multi-media Platform**

**🎯 Best For:**
- Multi-media consumers (anime, movies, TV shows)
- Users who want modern, fast interfaces
- Those who prefer real-time synchronization
- Users who want cross-platform linking (IMDB, TMDb)

**🌟 Key Strengths:**
- **Multi-media Support**: Anime, movies, and TV shows in one platform
- **Real-time Sync**: Instant updates across all devices
- **Modern Interface**: Contemporary, responsive design
- **Cross-platform Linking**: Integration with IMDB, TMDb, and other services
- **Advanced Filtering**: Sophisticated search and filter options
- **Mobile Optimization**: Excellent mobile experience
- **API Efficiency**: Fast, modern REST API
- **Social Features**: Community recommendations and reviews

**📊 Data Quality:**
- **Anime Coverage**: 95%+ of all anime series and movies
- **Movie Coverage**: 99%+ of all movies (via TMDb integration)
- **TV Coverage**: 99%+ of all TV shows (via TMDb integration)
- **Metadata Quality**: Excellent with rich cross-platform data
- **Image Quality**: High-resolution images from multiple sources
- **Update Frequency**: Real-time updates for all content types

### **🔄 Cross-Platform Integration**

Zoro provides seamless integration between platforms, allowing you to:

**🆔 ID Mapping**
- **AniList ↔ MAL**: Automatic conversion between platform IDs
- **SIMKL ↔ TMDb**: Movie and TV show ID mapping
- **SIMKL ↔ IMDB**: Cross-platform movie identification
- **Universal Search**: Search across all connected platforms

**📊 Data Synchronization**
- **Unified Interface**: View data from all platforms in one place
- **Cross-platform Stats**: Combined statistics from multiple sources
- **Unified Search**: Search across all connected platforms
- **Consistent Formatting**: Uniform display regardless of source

**🔄 Migration Tools**
- **AniList → MAL**: Export AniList data to MAL format
- **MAL → AniList**: Import MAL data to AniList
- **Platform Switching**: Easy migration between platforms
- **Data Validation**: Ensure data integrity during migration

### **🎯 Platform Selection Guide**

#### **For Anime & Manga Only:**
**Recommended: AniList**
- Best overall experience for anime and manga
- Rich statistics and social features
- Modern, fast interface
- Public access available

**Alternative: MyAnimeList**
- If you have existing MAL account
- If you need XML export compatibility
- If you prefer the legacy platform

#### **For Multi-media (Anime + Movies + TV):**
**Recommended: SIMKL + AniList**
- SIMKL for movies and TV shows
- AniList for anime and manga
- Best coverage across all media types

#### **For Data Analysis & Export:**
**Recommended: AniList + MAL**
- AniList for rich statistics and data
- MAL for XML export compatibility
- Maximum data coverage and export options

#### **For Content Creators:**
**Recommended: AniList**
- Best social features and community
- Rich metadata for content creation
- Public access for sharing
- Advanced statistics for analysis

#### **For Casual Users:**
**Recommended: AniList**
- Public access without authentication
- Easy to use interface
- Good for exploration and discovery
- No commitment required

### **📈 Platform Performance Metrics**

| Metric | AniList | MyAnimeList | SIMKL |
|--------|---------|-------------|-------|
| **API Response Time** | 200-500ms | 300-800ms | 150-400ms |
| **Data Freshness** | Real-time | 5-15 min | Real-time |
| **Uptime** | 99.9% | 99.5% | 99.8% |
| **Rate Limits** | 90 req/min | 60 req/min | 120 req/min |
| **Data Accuracy** | 99.5% | 98.5% | 99.2% |
| **Coverage** | 99%+ | 98%+ | 95%+ |

### **🔧 Technical Integration Details**

#### **API Architecture**
- **AniList**: GraphQL API with real-time subscriptions
- **MyAnimeList**: REST API with OAuth2 authentication
- **SIMKL**: REST API with modern OAuth2 flow

#### **Data Formats**
- **AniList**: JSON with GraphQL schema
- **MyAnimeList**: XML and JSON formats
- **SIMKL**: JSON with REST conventions

#### **Authentication Methods**
- **All Platforms**: OAuth2 with refresh tokens
- **Token Management**: Automatic refresh and renewal
- **Security**: Encrypted token storage
- **Scope Management**: Granular permission control

#### **Rate Limiting**
- **AniList**: 90 requests per minute
- **MyAnimeList**: 60 requests per minute
- **SIMKL**: 120 requests per minute
- **Zoro Management**: Intelligent queuing and retry logic

---

## 🎯 **Comprehensive Usage Guide**

Zoro provides a rich, interactive experience for managing your media consumption. This comprehensive guide covers every aspect of using the plugin effectively.

### **🎮 Interactive Elements & User Interface**

Zoro's interface is designed to be intuitive and responsive, providing multiple ways to interact with your media data.

#### **🖱️ Mouse Interactions**

**Press & Hold (Long Press)**
- **Activation**: Press and hold on cover images for 400ms
- **Function**: Opens detailed media information panel
- **Information Displayed**:
  - Comprehensive media details
  - Cast and crew information
  - Reviews and ratings
  - External links and references
  - Cross-platform data integration
  - Edit options (when authenticated)

**Click Actions**
- **Status Badges**: Click to edit entry status, progress, and scores
- **Cover Images**: Click to open external platform page
- **Title Links**: Navigate to platform-specific pages
- **Edit Buttons**: Quick access to editing interface
- **Favorite Hearts**: Toggle favorite status

**Hover Effects**
- **Card Elevation**: Cards lift slightly for visual feedback
- **Cover Brightness**: Images brighten on hover
- **Button Highlights**: Interactive elements become more prominent
- **Tooltips**: Additional information appears on hover
- **Smooth Transitions**: All effects use smooth animations

#### **⌨️ Keyboard Navigation**

**Tab Navigation**
- **Tab Order**: Logical progression through interactive elements
- **Focus Indicators**: Clear visual feedback for focused elements
- **Skip Links**: Quick navigation to main content areas
- **Accessibility**: Full keyboard support for all features

**Keyboard Shortcuts**
- **Escape**: Close modals and panels
- **Enter**: Activate selected elements
- **Arrow Keys**: Navigate through lists and grids
- **Space**: Toggle selections and checkboxes

#### **📱 Touch Support**

**Mobile Optimization**
- **Touch Targets**: Minimum 44px touch targets for all interactive elements
- **Gesture Support**: Swipe gestures for navigation
- **Responsive Design**: Adapts to different screen sizes
- **Touch Feedback**: Visual feedback for all touch interactions

### **📊 Statistics & Analytics Display**

Zoro's statistics system provides comprehensive insights into your media consumption patterns.

#### **📈 Enhanced Statistics Layout**

```zoro
type: stats
mediaType: anime
layout: enhanced
```

**Comprehensive Analytics Features:**
- **User Profile Display**: Avatar, username, and basic information
- **Overview Cards**: Key metrics at a glance
- **Detailed Breakdowns**: Genre, format, and status analysis
- **Trend Charts**: Visual representation of consumption patterns
- **Comparison Tools**: Cross-platform data comparison
- **Export Options**: Data export for external analysis

**📊 Key Metrics Displayed:**
- **Total Entries**: Complete count of tracked media
- **Average Score**: Mean rating across all entries
- **Completion Rate**: Percentage of completed vs. planned
- **Genre Distribution**: Breakdown by genre preferences
- **Format Analysis**: TV, movie, OVA, special distribution
- **Status Overview**: Current, completed, planning, etc.
- **Time-based Analysis**: Consumption patterns over time

#### **📋 Compact Statistics Layout**

```zoro
type: stats
mediaType: manga
layout: compact
```

**Condensed View Features:**
- **Essential Metrics**: Core statistics without overwhelming detail
- **Quick Overview**: Fast loading for performance
- **Mobile Friendly**: Optimized for smaller screens
- **Minimal Resource Usage**: Efficient for large datasets

#### **📝 Minimal Statistics Layout**

```zoro
type: stats
mediaType: anime
layout: minimal
```

**Simple Text Display:**
- **Text-only Format**: No images or complex layouts
- **Fast Loading**: Minimal resource requirements
- **Accessibility**: Screen reader friendly
- **Export Ready**: Easy to copy and paste

### **📺 Media List Management**

Zoro provides powerful tools for viewing and managing your media lists.

#### **🎬 Current Watching/Reading Lists**

```zoro
type: list
listType: current
mediaType: anime
layout: card
```

**Current List Features:**
- **Progress Tracking**: Episode/chapter progress display
- **Status Updates**: Quick status change options
- **Score Management**: Rating and review capabilities
- **Edit Interface**: In-place editing without leaving Obsidian
- **Sort Options**: Sort by title, score, progress, or date
- **Filter Tools**: Filter by genre, format, or status

**📊 List Types Available:**
- **`current`**: Currently watching/reading
- **`completed`**: Finished titles with completion dates
- **`planning`**: Plan to watch/read list
- **`paused`**: On hold or paused titles
- **`dropped`**: Dropped or abandoned titles
- **`repeating`**: Re-watching/re-reading (AniList only)
- **`all`**: Complete list of all entries

#### **📚 Manga Reading Management**

```zoro
type: list
listType: current
mediaType: manga
layout: table
```

**Manga-Specific Features:**
- **Chapter Progress**: Track individual chapter progress
- **Volume Tracking**: Monitor volume completion
- **Publication Status**: Ongoing vs. completed series
- **Format Support**: Manga, light novel, one-shot, etc.
- **Cross-platform Sync**: AniList and MAL integration

#### **🎭 Multi-media Support (SIMKL)**

```zoro
type: list
listType: current
mediaType: movie
source: simkl
layout: card
```

**Movie & TV Features:**
- **Multi-media Coverage**: Anime, movies, and TV shows
- **Cross-platform Linking**: IMDB, TMDb integration
- **Real-time Sync**: Instant updates across devices
- **Advanced Filtering**: Sophisticated search and filter options
- **Modern Interface**: Contemporary design and user experience

### **🔍 Advanced Search & Discovery**

Zoro's search system provides powerful tools for finding and discovering new content.

#### **🔎 Real-time Search**

```zoro
type: search
search: attack on titan
mediaType: anime
layout: card
```

**Search Features:**
- **Real-time Results**: Instant search as you type
- **Fuzzy Matching**: Intelligent search with typo tolerance
- **Multiple Sources**: Search across all connected platforms
- **Media Type Filtering**: Target specific content types
- **Thumbnail Previews**: Visual identification of results
- **Search History**: Quick access to recent queries
- **Advanced Filters**: Refine results by various criteria

**🔍 Search Capabilities:**
- **Title Search**: Search by English, Japanese, or native titles
- **Genre Filtering**: Filter by specific genres
- **Format Filtering**: TV, movie, OVA, special, etc.
- **Status Filtering**: Airing, finished, not yet aired
- **Year Filtering**: Search by release year
- **Studio Filtering**: Search by production studio
- **Character Search**: Search by character names

#### **📈 Trending Discovery**

```zoro
type: trending
mediaType: anime
source: anilist
```

**Trending Features:**
- **Real-time Data**: Current trending content from platforms
- **Configurable Limits**: Adjust number of results (default: 40)
- **Source-specific Lists**: Platform-specific trending content
- **Cached Results**: Performance optimization for repeated queries
- **Category Filtering**: Filter by genre, format, and more
- **Personalization**: Recommendations based on preferences
- **Export Capabilities**: Save trending lists for analysis

**📊 Trending Data Sources:**
- **AniList**: Popular anime and manga
- **MyAnimeList**: Trending content from MAL
- **SIMKL**: Popular movies and TV shows
- **TMDb**: Movie and TV show trends

### **🎨 Layout System & Customization**

Zoro provides multiple layout options to suit different use cases and preferences.

#### **🃏 Card Layout System**

```zoro
layout: card
```

**Card Layout Features:**
- **Grid-based Display**: Responsive column management
- **Cover Art Integration**: High-quality image display
- **Hover Effects**: Smooth animations and visual feedback
- **Progress Overlays**: Visual completion status indicators
- **Status Badges**: Color-coded status indicators
- **Edit Buttons**: Quick access to editing interface
- **Rating Display**: Star icons and numerical scores
- **Genre Tags**: Quick categorization display
- **Responsive Design**: Adapts to different screen sizes

**🔲 Grid Column Options:**
- **Default (Responsive)**: Automatically adapts to screen size
  - Mobile (< 600px): 2 columns
  - Tablet (600px+): 3 columns
  - Desktop (900px+): 4 columns
  - Large Desktop (1200px+): 5 columns
- **Fixed Columns**: 1-6 columns regardless of screen size
  - **1 Column**: Maximum detail view
  - **2 Columns**: Balanced detail and space usage
  - **3 Columns**: Good balance for most screens
  - **4 Columns**: Efficient space usage
  - **5 Columns**: High-density display
  - **6 Columns**: Maximum content density

#### **📋 Table Layout System**

```zoro
layout: table
```

**Table Layout Features:**
- **Compact Tabular View**: Efficient space usage
- **Sortable Columns**: Sort by title, score, progress, etc.
- **Quick Editing**: Inline controls and status changes
- **Efficient Rendering**: Optimized for large lists
- **Keyboard Navigation**: Full keyboard support
- **Export-friendly**: Easy data export and analysis
- **Minimal Resource Usage**: Performance-critical scenarios

**📊 Table Column Options:**
- **Title**: Media title with external links
- **Format**: TV, movie, OVA, special, etc.
- **Status**: Current, completed, planning, etc.
- **Progress**: Episode/chapter progress display
- **Score**: User ratings and scores
- **Genres**: Genre tags and categories
- **Date**: Start/completion dates

### **🧩 Single Media Display**

Zoro allows you to display individual media entries with detailed information.

#### **📺 Single Anime/Manga Display**

```zoro
source: anilist
type: single
mediaType: anime
username: your_anilist_username
mediaId: 16498
```

**Single Media Features:**
- **Detailed Information**: Comprehensive media details
- **Edit Capabilities**: Full editing when authenticated
- **Cross-platform ID Conversion**: Automatic ID mapping
- **Rich Metadata**: Studios, genres, dates, descriptions
- **External Links**: Platform-specific page links
- **Cover Art**: High-quality image display
- **Status Information**: Current tracking status

#### **🎬 Single Movie/TV Display (SIMKL)**

```zoro
source: simkl
type: single
mediaType: movie
mediaId: 12345
```

**Movie/TV Features:**
- **Multi-media Support**: Movies and TV shows
- **Cross-platform Data**: IMDB, TMDb integration
- **Rich Metadata**: Cast, crew, reviews, ratings
- **External Links**: Multiple platform references
- **Real-time Updates**: Live data synchronization

### **⚙️ Advanced Configuration Options**

#### **🎯 Source Selection**

```zoro
source: anilist  # anilist, mal, simkl
```

**Source Options:**
- **`anilist`**: AniList platform (recommended for anime/manga)
- **`mal`**: MyAnimeList platform (legacy support)
- **`simkl`**: SIMKL platform (multi-media support)

#### **📊 Pagination & Limits**

```zoro
page: 2
perPage: 20
```

**Pagination Features:**
- **Page Control**: Navigate through large datasets
- **Results Per Page**: Adjust display density
- **Performance Optimization**: Efficient loading of large lists
- **Memory Management**: Controlled resource usage

#### **🔍 Search Configuration**

```zoro
search: "attack on titan"
query: "shingeki no kyojin"
```

**Search Options:**
- **Multiple Terms**: Search with various keywords
- **Fuzzy Matching**: Intelligent search algorithms
- **Cross-language**: English, Japanese, native titles
- **Advanced Filters**: Genre, format, status filtering

### **📺 Current Watching List**

```zoro
type: list
listType: current
mediaType: anime
layout: card
```

**List Types Available:**
- `current` - Currently watching/reading
- `completed` - Finished titles
- `planning` - Plan to watch/read
- `paused` - On hold
- `dropped` - Dropped titles
- `repeating` - Re-watching/re-reading (AniList only)
- `all` - All entries

### **📖 Manga Reading**

```zoro
type: list
listType: current
mediaType: manga 
layout: table
```

### **🔍 Search & Discover**

```zoro
type: search
search: attack on titan
mediaType: anime
layout: card
```

**Search Features:**
- **Real-time results** as you type
- **Fuzzy matching** for better results
- **Multiple sources** (AniList, MAL, Simkl)
- **Media type filtering** (anime, manga, movies, TV)

### **📈 Trending Now**

```zoro
type: trending
mediaType: anime
source: anilist
```

**Trending Features:**
- **Real-time data** from multiple platforms
- **Configurable limits** (default: 40 items)
- **Source-specific** trending lists
- **Cached results** for performance

### **🎬 Movies & TV Shows (SIMKL)**

```zoro
type: list
listType: current
mediaType: movie
source: simkl
layout: card
```

---

## 🎨 Layout Options

### **Card Layout (Default)**
- **Grid-based display** with responsive columns
- **Cover images** with hover effects and overlays
- **Progress indicators** showing completion status
- **Status badges** with color coding
- **Edit buttons** for quick modifications
- **Rating display** with star icons

```zoro
layout: card
```

**Grid Column Options:**
- **Default (Responsive)**: Automatically adapts to screen size
  - Mobile (< 600px): 2 columns
  - Tablet (600px+): 3 columns
  - Desktop (900px+): 4 columns
  - Large Desktop (1200px+): 5 columns
- **Fixed Columns**: 1-6 columns regardless of screen size

### **Table Layout**
- **Compact tabular view** for efficient space usage
- **Sortable columns** by title, score, progress, etc.
- **Quick editing** with inline controls
- **Efficient rendering** for large lists
- **Keyboard navigation** support

```zoro
layout: table
```

### **Display Customization**
- **Cover Images**: Toggle on/off for performance
- **Ratings**: Show/hide user scores
- **Progress**: Display completion status
- **Genres**: Show genre tags
- **Plain Titles**: Remove clickable links

---

## 🧩 Single Media
(AniList and MAL)

Render a single entry from your list by AniList or MAL ID. For AniList, either set a default username, authenticate, or provide `username`.

```zoro
# AniList single media example
source: anilist
type: single
mediaType: anime
username: your_anilist_username
mediaId: 16498  # Attack on Titan (example)
```

```zoro
# MAL single media example (requires MAL auth)
source: mal
type: single
mediaType: anime
mediaId: 5114  # Fullmetal Alchemist: Brotherhood (example)
```

**Single Media Features:**
- **Detailed information** display
- **Edit capabilities** (when authenticated)
- **Cross-platform ID conversion**
- **Rich metadata** including studios, genres, dates

---

## 🧑‍💻 Code Block Reference

| Parameter | Aliases | Description | Possible Values | Default Value | Required For | Example Usage |
|-----------|---------|-------------|-----------------|---------------|--------------|---------------|
| **type** | - | Operation type to perform | `stats`, `search`, `single`, `list`, `trending` | `list` | All operations | `type: stats` |
| **source** | `api` | API source to use | `anilist`, `mal`, `simkl` | Plugin default or `anilist` | All operations | `source: mal` |
| **username** | `user` | Username for user-specific operations | Any valid username or authenticated user | Plugin default or authenticated user | `stats`, `list` operations | `username: YourUsername` |
| **mediaType** | `media-type`, `media_type`, `mediatype` | Type of media to work with | `ANIME`, `MANGA`, `MOVIE`, `TV` | `ANIME` | All operations | `mediaType: MANGA` |
| **listType** | `list-type`, `list_type`, `listtype` | Status filter for user lists | `CURRENT`, `COMPLETED`, `PAUSED`, `DROPPED`, `PLANNING`, `ALL`, `REPEATING`* | `CURRENT` | `list` operations | `listType: COMPLETED` |
| **layout** | - | Display layout style | `card`, `table` | Plugin default or `card` | All display operations | `layout: table` |
| **mediaId** | `media-id`, `media_id`, `mediaid`, `id` | Specific media ID for single media operations | Any valid numeric ID | None | `single` operations | `mediaId: 21` |
| **search** | `query` | Search query for search operations | Any search string | None | `search` operations | `search: Attack on Titan` |
| **page** | - | Page number for paginated results | Positive integer | `1` | `search`, paginated operations | `page: 2` |
| **perPage** | `per-page`, `per_page`, `perpage`, `limit` | Number of results per page | Positive integer (typically 1-50) | Varies by operation | Optional for paginated operations | `perPage: 10` |

**Note:** `REPEATING` status is only supported on AniList.

### **Key Features:**

1. **Multiple Aliases**: Most parameters support multiple naming conventions (e.g., `mediaType`, `media-type`, `media_type`, `mediatype`)
2. **Five Operation Types**: `stats`, `search`, `single`, `list`, and `trending`
3. **Three API Sources**: AniList, MyAnimeList (MAL), and Simkl
4. **Flexible Layouts**: Card and table display options
5. **Smart Defaults**: The plugin uses sensible defaults when parameters are omitted

### **Source-Specific Limitations:**

| Feature/Status | AniList | MyAnimeList | Simkl |
|----------------|---------|-------------|-------|
| **ANIME** | ✅ | ✅ | ✅ |
| **MANGA** | ✅ | ✅ | ❌ |
| **MOVIES** | ❌ | ❌ | ✅ |
| **TV SHOWS** | ❌ | ❌ | ✅ |
| **REPEATING** status | ✅ | ❌ | ❌ |
| **Authentication Required** | Optional* | Required | Required |

*AniList works without authentication for public data, but authentication is required for user-specific operations.

The configuration system is very flexible and user-friendly, supporting various naming conventions and providing helpful error messages for invalid configurations.

---

## ⚙️ Configuration

The Zoro plugin settings are organized into several sections in **Settings → Zoro**. Here's what each setting does:

### **👤 Account Section**

**🆔 Public profile**
- **What it does**: Sets your AniList username for viewing public profiles and stats without authentication
- **When to use**: If you want to view public AniList data without logging in
- **Example**: Enter your AniList username to view public lists

**✳️ AniList, 🗾 MyAnimeList, 🎬 SIMKL**
- **What they do**: Connect your accounts for full feature access
- **When to use**: Required for editing lists, accessing private data, and using all features
- **Setup**: Click the authentication buttons and follow the guides

### **🧭 Setup Section**

**⚡ Sample Folder**
- **What it does**: Creates a complete Zoro folder structure with pre-configured notes
- **When to use**: Recommended for new users to get started quickly
- **Creates**: Anime, Manga, Movie, and TV folders with template files

**🕹️ Default Source**
- **What it does**: Chooses which service to use when none is specified in code blocks
- **Options**: AniList, MyAnimeList, SIMKL
- **Recommendation**: AniList (most comprehensive)

### **🗒️ Note Section**

**🗂️ Note path**
- **What it does**: Sets the folder where connected notes will be created
- **Default**: `Zoro/Note`
- **Example**: `Anime/Reviews` would create notes in that folder

**🎴 Media block**
- **What it does**: Automatically inserts a code block showing cover, rating, and details in new notes
- **When to use**: If you want media information automatically added to connected notes

### **📺 Display Section**

**🧊 Layout**
- **What it does**: Sets the default layout for media lists
- **Options**: Card Layout, Table Layout
- **Card Layout**: Grid-based with cover images and hover effects
- **Table Layout**: Compact tabular view with sortable columns

**🔲 Grid Columns**
- **What it does**: Controls how many columns appear in card layouts
- **Options**:
  - **Default (Responsive)**: Automatically adapts to screen size
  - **1-6 Columns**: Forces a specific number regardless of screen size
- **Responsive behavior**:
  - Mobile (< 600px): 2 columns
  - Tablet (600px+): 3 columns
  - Desktop (900px+): 4 columns
  - Large Desktop (1200px+): 5 columns

### **✨ More Section**

**⏳ Loading Icon**
- **What it does**: Shows loading animation during API requests
- **When to use**: Keep enabled for visual feedback during operations

**🔗 Plain Titles**
- **What it does**: Shows titles as plain text instead of clickable links
- **When to use**: If you prefer simpler text without external links

**🌆 Cover**
- **What it does**: Displays cover images for anime/manga
- **When to use**: Disable for better performance on slower devices

**⭐ Ratings**
- **What it does**: Displays user ratings/scores
- **When to use**: Keep enabled to see your scores and average ratings

**📈 Progress**
- **What it does**: Shows progress information (episodes watched, chapters read)
- **When to use**: Essential for tracking your progress

**🎭 Genres**
- **What it does**: Displays genre tags on media cards
- **When to use**: Enable to see genre information at a glance

**🧮 Score Scale**
- **What it does**: Ensures all ratings use the 0–10 point scale
- **When to use**: Keep enabled for consistent rating display

### **🚪 Shortcut Section**

**Open on site**
- **What it does**: Adds customizable external-link buttons to the More Details panel
- **Options**: Add Anime URL, Add Manga URL, Add Movie/TV URL
- **When to use**: If you want quick access to external platform pages

### **💾 Data Section**

**📊 Export to CSV**
- **What it does**: Exports your lists to CSV format for backup or analysis
- **When to use**: For data backup, migration, or external analysis

**📊 Export to XML**
- **What it does**: Exports your lists to XML format compatible with MAL import tools
- **When to use**: For migrating data to MyAnimeList

### **🔁 Cache Section**

**📊 Cache Stats**
- **What it does**: Shows live cache usage and hit-rate information
- **When to use**: For monitoring performance and debugging

**🧹 Clear Cache**
- **What it does**: Deletes all cached data (user, media, search results)
- **When to use**: If you're experiencing issues or want fresh data

### **⚠️ Beta Section**

**TMDb API Key**
- **What it does**: Your The Movie Database API key for enhanced movie & TV features
- **When to use**: If you want additional movie/TV metadata and trending data
- **Get one**: Free at [TMDb](https://www.themoviedb.org/settings/api)

### **Configuration Tips**

**For New Users:**
1. Start with **Sample Folder** to get a complete setup
2. Set **Default Source** to AniList
3. Choose your preferred **Layout** (Card is recommended)
4. Enable **Loading Icon** and **Cover** for best experience

**For Performance:**
- Disable **Cover** if you have a slow connection
- Use **Table Layout** for large lists
- Clear cache periodically if you experience issues

**For Power Users:**
- Set up **Note path** for connected notes
- Enable **Media block** for automatic note creation
- Configure **Custom External URLs** for your preferred sites
- Use **Cache Stats** to monitor performance

---

## 🔧 Advanced Features

### **🔄 Smart Caching System**
- **User Data**: 30 minutes (profile, lists, stats)
- **Media Data**: 10 minutes (details, covers, metadata)
- **Search Results**: 2 minutes (quick access)
- **Airing Data**: 1 hour (schedule information)
- **ID Conversions**: 30 days (cross-platform mapping)
- **Trending Data**: 24 hours (popular content)

### **⚡ Performance Features**
- **Request Queue**: Prevents rate limiting with intelligent queuing
- **Progressive Loading**: Large lists load in chunks of 20 items
- **Background Refresh**: Updates cache silently without interruption
- **Error Recovery**: Automatic retries with exponential backoff
- **Circuit Breakers**: Graceful degradation during API outages

### **📊 Export & Migration**
- **CSV Export**: Standard format for data analysis
- **XML Export**: Compatible with MAL import tools
- **Unified Lists**: Combined anime and manga exports
- **Progress Tracking**: Export with completion status
- **Cross-platform**: Convert between AniList and MAL formats

### **🔗 Connected Notes**
- **Auto-detection**: Finds related notes in your vault
- **Smart Linking**: Connects media to existing notes
- **URL Matching**: Matches against external platform URLs
- **Cross-platform**: Works with AniList, MAL, and Simkl URLs

### **🎨 Theme System**
- **Minimal Theme**: Clean, distraction-free interface
- **Glass Theme**: Modern glassmorphism design
- **Viscosity Theme**: Fluid, dynamic visual effects
- **Custom Themes**: Download and apply additional themes
- **Auto-apply**: Themes apply immediately after download

### **🔍 Custom External URLs**
- **Site-specific Search**: Add buttons for external platforms
- **Auto-formatting**: Intelligent URL template learning
- **Multiple Platforms**: Support for various external sites
- **Template Learning**: Automatically learns URL patterns

---

## 🔍 API Support

### **AniList (GraphQL)**
- **Full GraphQL API** integration
- **OAuth2 Authentication** for secure access
- **Real-time Data** with GraphQL subscriptions
- **Rich Metadata** including studios, genres, dates

```zoro
source: anilist
```

### **MyAnimeList (REST + OAuth2)**
- **Complete REST API** integration
- **OAuth2 Authentication** for secure access
- **Rate Limiting** compliance
- **Cross-platform ID** mapping

```zoro
source: mal
```

### **Simkl (Modern API)**
- **Modern REST API** with OAuth2
- **Multi-media Support** (anime, movies, TV)
- **Real-time Updates** and synchronization
- **Advanced Filtering** and search capabilities

```zoro
source: simkl
```

### **TMDb Integration**
- **Enhanced Movie/TV** data through TMDb API
- **Rich Metadata** including cast, crew, reviews
- **Poster Art** and backdrop images
- **Release Information** and ratings

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### **🐛 Report Bugs**
1. Check [existing issues](https://github.com/zara-kasi/zoro/issues) first
2. Create new issue with detailed reproduction steps
3. Include console logs from Developer Tools (F12)
4. Specify your Obsidian version and platform

### **💡 Feature Requests**
1. Search [existing requests](https://github.com/zara-kasi/zoro/issues) first
2. Submit detailed feature description with use cases
3. Include mockups or examples if possible
4. Consider implementation complexity and user impact

### **🔧 Code Contributions**
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with clear commit messages
4. Test thoroughly across different platforms
5. Push to branch: `git push origin feature/amazing-feature`
6. Open Pull Request with detailed description

### **📚 Documentation**
- Improve existing documentation
- Add examples and tutorials
- Translate to other languages
- Create video guides or screenshots

### **🎨 Design & UX**
- Suggest UI/UX improvements
- Create new themes
- Improve accessibility
- Optimize performance

---

## 🌟 Acknowledgements

- **[Obsidian](https://obsidian.md/)** - The amazing note-taking app that makes this possible
- **[Obsidian Raindrop Plugin](https://github.com/mtopping/obsidian-raindrop)** - Inspiration for plugin architecture
- **[AniList](https://anilist.co/)** - Comprehensive anime and manga database with excellent API
- **[MyAnimeList](https://myanimelist.net/)** - The original anime tracking platform
- **[Simkl](https://simkl.com/)** - Modern tracking platform for all media types
- **[TMDb](https://www.themoviedb.org/)** - Movie and TV database for enhanced metadata

This work would not be possible without these essential tools and services. Special thanks to the Obsidian community for their support and feedback.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

The MIT License allows for:
- ✅ Commercial use
- ✅ Modification
- ✅ Distribution
- ✅ Private use
- ✅ Attribution requirement

---

## 🔗 Links

- **[GitHub Repository](https://github.com/zara-kasi/zoro)**
- **[Releases](https://github.com/zara-kasi/zoro/releases)**
- **[Issues](https://github.com/zara-kasi/zoro/issues)**
- **[Discussions](https://github.com/zara-kasi/zoro/discussions)**
- **[Obsidian Community](https://obsidian.md/plugins?id=zoro)**

---

*Made with ❤️ for the anime and manga community*