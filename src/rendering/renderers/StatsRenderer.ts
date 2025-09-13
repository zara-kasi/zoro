/**
 * StatsRenderer
 * Migrated from StatsRenderer.js → StatsRenderer.ts
 * - Added comprehensive types for user statistics and media objects
 * - Typed all renderer methods and DOM manipulation
 * - Added Plugin type from obsidian for parent reference
 */
import type { Plugin } from 'obsidian';
import { DOMHelper } from '../helpers/DOMHelper';

interface MediaTitle {
  english?: string;
  romaji?: string;
  native?: string;
}

interface CoverImage {
  medium?: string;
  large?: string;
}

interface Avatar {
  medium?: string;
  large?: string;
}

interface MediaListOptions {
  scoreFormat?: 'POINT_10' | 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_5';
}

interface StatusCount {
  status: string;
  count: number;
}

interface ScoreCount {
  score: number;
  count: number;
}

interface FormatCount {
  format: string;
  count: number;
}

interface GenreCount {
  genre: string;
  count: number;
}

interface YearCount {
  releaseYear: number;
  count: number;
}

interface MediaStatistics {
  count: number;
  meanScore: number;
  standardDeviation?: number;
  episodesWatched?: number;
  minutesWatched?: number;
  chaptersRead?: number;
  volumesRead?: number;
  statuses?: StatusCount[];
  scores?: ScoreCount[];
  formats?: FormatCount[];
  genres?: GenreCount[];
  releaseYears?: YearCount[];
}

interface FavoriteMedia {
  id: number;
  title: MediaTitle;
  coverImage?: CoverImage;
  meanScore?: number;
}

interface FavoriteNodes {
  nodes: FavoriteMedia[];
}

interface Favourites {
  anime?: FavoriteNodes;
  manga?: FavoriteNodes;
  tv?: FavoriteNodes;
  movie?: FavoriteNodes;
}

interface UserStatistics {
  anime?: MediaStatistics;
  manga?: MediaStatistics;
  tv?: MediaStatistics;
  movie?: MediaStatistics;
}

interface ZoroMeta {
  source?: 'anilist' | 'mal' | 'simkl';
}

interface User {
  name: string;
  avatar?: Avatar;
  statistics: UserStatistics;
  mediaListOptions?: MediaListOptions;
  favourites?: Favourites;
  _zoroMeta?: ZoroMeta;
}

interface RenderOptions {
  layout?: 'minimal' | 'standard' | 'detailed';
  mediaType?: 'ANIME' | 'MANGA' | 'TV' | 'MOVIE' | 'MOVIES';
  showComparisons?: boolean;
  showTrends?: boolean;
}

interface OverviewOptions {
  showComparisons: boolean;
  mediaType: string;
}

interface BreakdownChartOptions {
  showPercentages?: boolean;
  maxItems?: number;
}

interface Insight {
  icon: string;
  text: string;
}

interface ParentRenderer {
  plugin: Plugin & {
    settings: {
      simklUserInfo?: {
        account?: {
          id: string;
        };
      };
    };
  };
  formatter: {
    formatScore(score: number, format: string): string;
    formatWatchTime(minutes: number): string;
    formatTitle(media: FavoriteMedia): string;
  };
}

export class StatsRenderer {
  private parent: ParentRenderer;
  private plugin: ParentRenderer['plugin'];
  private formatter: ParentRenderer['formatter'];

  constructor(parentRenderer: ParentRenderer) {
    this.parent = parentRenderer;
    this.plugin = parentRenderer.plugin;
    this.formatter = parentRenderer.formatter;
  }

  // Force styles directly on DOM elements to override theme interference
  forceImageStyles(imgElement: HTMLImageElement, styles: Record<string, string>): void {
    // Apply styles directly to the element
    Object.entries(styles).forEach(([property, value]) => {
      imgElement.style.setProperty(property, value, 'important');
    });
    
    // Also set up a MutationObserver to re-apply styles if they get overridden
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          // Re-apply our styles if something changed them
          Object.entries(styles).forEach(([property, value]) => {
            if (imgElement.style.getPropertyValue(property) !== value) {
              imgElement.style.setProperty(property, value, 'important');
            }
          });
        }
      });
    });
    
    observer.observe(imgElement, {
      attributes: true,
      attributeFilter: ['style']
    });
    
    // Store observer reference for cleanup
    if (!(imgElement as any)._zoroObserver) {
      (imgElement as any)._zoroObserver = observer;
    }
  }

  render(el: HTMLElement, user: User | null, options: RenderOptions = {}): void {
    const {
      layout = 'standard',
      mediaType = 'ANIME',
      showComparisons = true,
      showTrends = true
    } = options;

    el.empty();
    el.className = `zoro-container zoro-stats-container zoro-stats-${layout}`;

    if (!user || !user.statistics) {
      this.renderError(el, 'No statistics available for this user');
      return;
    }

    const fragment = DOMHelper.createFragment();

    // User header with key info
    this.renderHeader(fragment, user);

    // Main overview cards
    this.renderOverview(fragment, user, { showComparisons, mediaType });

    // Detailed breakdowns based on layout
    if (layout !== 'minimal') {
      this.renderBreakdowns(fragment, user, mediaType);
    }

    // Activity insights
    if (layout === 'detailed' && showTrends) {
      this.renderInsights(fragment, user, mediaType);
    }

    // Favorites showcase
    this.renderFavorites(fragment, user, mediaType);

    el.appendChild(fragment);
  }

  renderError(el: HTMLElement, message: string): void {
    const errorDiv = el.createDiv({ cls: 'zoro-stats-error' });
    errorDiv.createEl('div', { 
      cls: 'zoro-error-icon',
      text: '📊' 
    });
    errorDiv.createEl('h3', { 
      text: 'Stats Unavailable',
      cls: 'zoro-error-title'
    });
    errorDiv.createEl('p', { 
      text: message,
      cls: 'zoro-error-message'
    });
  }

  renderHeader(fragment: DocumentFragment, user: User): void {
    const header = fragment.createDiv({ cls: 'zoro-stats-header' });
    
    const userInfo = header.createDiv({ cls: 'zoro-user-info' });
    
    if (user.avatar?.medium) {
      const avatarImg = userInfo.createEl('img', {
        cls: 'zoro-user-avatar',
        attr: { 
          src: user.avatar.medium,
          alt: `${user.name}'s avatar`
        }
      }) as HTMLImageElement;
      
      // Force avatar styles with JavaScript
      this.forceImageStyles(avatarImg, {
        'width': '50px',
        'height': '50px',
        'border-radius': '50%',
        'border': '2px solid var(--border)',
        'object-fit': 'cover',
        'pointer-events': 'none',
        'cursor': 'default',
        'flex-shrink': '0',
        'display': 'block'
      });
    }

    const userDetails = userInfo.createDiv({ cls: 'zoro-user-details' });
    const userName = userDetails.createEl('h2', { 
      text: user.name,
      cls: 'zoro-user-name zoro-user-name-clickable'
    });

    // Make the user name clickable
    userName.style.cursor = 'pointer';
    userName.addEventListener('click', () => {
      const source = user?._zoroMeta?.source || 'anilist';
      let url = '';
      if (source === 'mal') {
        url = `https://myanimelist.net/profile/${encodeURIComponent(user.name)}`;
      } else if (source === 'simkl') {
        const simklId = this.plugin.settings?.simklUserInfo?.account?.id;
        url = simklId ? `https://simkl.com/${encodeURIComponent(simklId)}/` : `https://simkl.com/`;
      } else {
        url = `https://anilist.co/user/${encodeURIComponent(user.name)}`;
      }
      window.open(url, '_blank');
    });
    
    userName.addEventListener('mouseenter', () => {
      userName.style.textDecoration = 'underline';
    });

    userName.addEventListener('mouseleave', () => {
      userName.style.textDecoration = 'none';
    });
  }

  renderOverview(fragment: DocumentFragment, user: User, options: OverviewOptions): void {
    const { showComparisons, mediaType = 'ANIME' } = options;
    const overview = fragment.createDiv({ cls: 'zoro-stats-overview' });
    
    const statsGrid = overview.createDiv({ cls: 'zoro-stats-grid' });

    // Anime stats
    const animeStats = user.statistics.anime;
    // Extended: Simkl TV and Movie stats
    const tvStats = user.statistics.tv;
    const movieStats = user.statistics.movie;

    // Manga stats (AniList/MAL)
    const mangaStats = user.statistics.manga;
    const upperType = String(mediaType).toUpperCase();
    const showAnime = upperType === 'ANIME';
    const showManga = upperType === 'MANGA';
    const showTv = upperType === 'TV';
    const showMovie = upperType === 'MOVIE' || upperType === 'MOVIES';

    if (showAnime && animeStats && animeStats.count > 0) {
      this.renderMediaTypeCard(statsGrid, 'anime', animeStats, user.mediaListOptions);
    }
    if (showManga && mangaStats && mangaStats.count > 0) {
      this.renderMediaTypeCard(statsGrid, 'manga', mangaStats, user.mediaListOptions);
    }
    if (showTv && tvStats && tvStats.count > 0) {
      this.renderMediaTypeCard(statsGrid, 'tv', tvStats, user.mediaListOptions);
    }
    if (showMovie && movieStats && movieStats.count > 0) {
      this.renderMediaTypeCard(statsGrid, 'movie', movieStats, user.mediaListOptions);
    }

    if (showAnime && showManga && animeStats?.count && animeStats.count > 0 && mangaStats?.count && mangaStats.count > 0 && showComparisons) {
      this.renderComparisonCard(statsGrid, animeStats, mangaStats);
    }
  }

  renderMediaTypeCard(container: HTMLElement, type: string, stats: MediaStatistics, listOptions?: MediaListOptions): void {
    const card = container.createDiv({ 
      cls: `zoro-stat-card zoro-${type}-card`,
      attr: { 'data-type': type }
    });

    // Header
    const header = card.createDiv({ cls: 'zoro-card-header' });
    header.createEl('h3', { 
      text: type.charAt(0).toUpperCase() + type.slice(1),
      cls: 'zoro-card-title'
    });

    // Primary metrics
    const metrics = card.createDiv({ cls: 'zoro-primary-metrics' });
    
    // Total count - most important metric
    const totalMetric = metrics.createDiv({ cls: 'zoro-metric zoro-metric-primary' });
    totalMetric.createEl('div', { 
      text: stats.count.toLocaleString(),
      cls: 'zoro-metric-value'
    });
    totalMetric.createEl('div', { 
      text: 'Total',
      cls: 'zoro-metric-label'
    });

    // Mean score if available
    if (stats.meanScore > 0) {
      const scoreMetric = metrics.createDiv({ cls: 'zoro-metric' });
      const scoreFormat = listOptions?.scoreFormat || 'POINT_10';
      const displayScore = this.formatter.formatScore(stats.meanScore, scoreFormat);
      
      scoreMetric.createEl('div', { 
        text: displayScore,
        cls: 'zoro-metric-value zoro-score-value'
      });
      scoreMetric.createEl('div', { 
        text: 'Avg Score',
        cls: 'zoro-metric-label'
      });
    }

    // Secondary metrics
    const secondaryMetrics = card.createDiv({ cls: 'zoro-secondary-metrics' });
    
    if (type === 'anime') {
      if (stats.episodesWatched) {
        DOMHelper.addSecondaryMetric(secondaryMetrics, 'Episodes', stats.episodesWatched.toLocaleString());
      }
      if (stats.minutesWatched) {
        const timeFormatted = this.formatter.formatWatchTime(stats.minutesWatched);
        DOMHelper.addSecondaryMetric(secondaryMetrics, 'Time Watched', timeFormatted);
      }
    } else {
      if (stats.chaptersRead) {
        DOMHelper.addSecondaryMetric(secondaryMetrics, 'Chapters', stats.chaptersRead.toLocaleString());
      }
      if (stats.volumesRead) {
        DOMHelper.addSecondaryMetric(secondaryMetrics, 'Volumes', stats.volumesRead.toLocaleString());
      }
    }

    if (stats.standardDeviation) {
      DOMHelper.addSecondaryMetric(secondaryMetrics, 'Score Deviation', stats.standardDeviation.toFixed(1));
    }
  }

  renderComparisonCard(container: HTMLElement, animeStats: MediaStatistics, mangaStats: MediaStatistics): void {
    const card = container.createDiv({ cls: 'zoro-stat-card zoro-comparison-card' });

    const header = card.createDiv({ cls: 'zoro-card-header' });
    header.createEl('h3', { 
      text: 'At a Glance',
      cls: 'zoro-card-title'
    });

    const comparisons = card.createDiv({ cls: 'zoro-comparisons' });

    // Total entries
    const totalAnime = animeStats.count || 0;
    const totalManga = mangaStats.count || 0;
    const totalCombined = totalAnime + totalManga;
    
    const totalComp = comparisons.createDiv({ cls: 'zoro-comparison' });
    totalComp.createEl('div', { 
      text: totalCombined.toLocaleString(),
      cls: 'zoro-comparison-value'
    });
    totalComp.createEl('div', { 
      text: 'Total Entries',
      cls: 'zoro-comparison-label'
    });

    // Preference indicator
    if (totalAnime > 0 && totalManga > 0) {
      const preference = totalAnime > totalManga ? 'Anime' : 
                       totalManga > totalAnime ? 'Manga' : 'Balanced';
      const ratio = totalAnime > totalManga ? 
                    (totalAnime / totalManga).toFixed(1) : 
                    (totalManga / totalAnime).toFixed(1);
      
      const prefComp = comparisons.createDiv({ cls: 'zoro-comparison' });
      prefComp.createEl('div', { 
        text: preference,
        cls: 'zoro-comparison-value'
      });
      prefComp.createEl('div', { 
        text: preference === 'Balanced' ? 'Preference' : `${ratio}:1 Ratio`,
        cls: 'zoro-comparison-label'
      });
    }

    // Score comparison
    const animeScore = animeStats.meanScore || 0;
    const mangaScore = mangaStats.meanScore || 0;
    if (animeScore > 0 && mangaScore > 0) {
      const scoreDiff = Math.abs(animeScore - mangaScore);
      const higherType = animeScore > mangaScore ? 'Anime' : 'Manga';
      
      const scoreComp = comparisons.createDiv({ cls: 'zoro-comparison' });
      scoreComp.createEl('div', { 
        text: scoreDiff < 0.5 ? 'Similar' : higherType,
        cls: 'zoro-comparison-value'
      });
      scoreComp.createEl('div', { 
        text: 'Higher Rated',
        cls: 'zoro-comparison-label'
      });
    }
  }

  renderBreakdowns(fragment: DocumentFragment, user: User, mediaType: string): void {
    const type = mediaType.toLowerCase();
    const normalizedType = (type === 'movies') ? 'movie' : type;
    const stats = user.statistics[normalizedType as keyof UserStatistics];
    
    if (!stats || stats.count === 0) return;

    const section = fragment.createDiv({ cls: 'zoro-stats-breakdowns' });
    section.createEl('h3', { 
      text: `${mediaType} Breakdown`,
      cls: 'zoro-section-title'
    });

    const breakdownGrid = section.createDiv({ cls: 'zoro-breakdown-grid' });

    // Status distribution (most useful)
    if (stats.statuses?.length) {
      this.renderBreakdownChart(breakdownGrid, 'Status Distribution', stats.statuses, 'status', {
        showPercentages: true,
        maxItems: 6
      });
    }

    // Score distribution (if user rates)
    if (stats.scores?.length) {
      const validScores = stats.scores.filter(s => s.score > 0 && s.count > 0);
      if (validScores.length >= 3) {
        this.renderScoreDistribution(breakdownGrid, validScores, user.mediaListOptions);
      }
    }

    // Format breakdown
    if (stats.formats?.length) {
      const topFormats = stats.formats.slice(0, 6);
      this.renderBreakdownChart(breakdownGrid, 'Format Distribution', topFormats, 'format', {
        showPercentages: true
      });
    }

    // Release years (activity timeline)
    if (stats.releaseYears?.length) {
      this.renderYearlyActivity(breakdownGrid, stats.releaseYears);
    }
  }

  renderInsights(fragment: DocumentFragment, user: User, mediaType: string): void {
    const type = mediaType.toLowerCase();
    const normalizedType = (type === 'movies') ? 'movie' : type;
    const stats = user.statistics[normalizedType as keyof UserStatistics];
    
    if (!stats) return;

    const insights = fragment.createDiv({ cls: 'zoro-stats-insights' });
    insights.createEl('h3', { 
      text: 'Insights',
      cls: 'zoro-section-title'
    });

    const insightsList = insights.createDiv({ cls: 'zoro-insights-list' });

    // Generate meaningful insights
    const insightData = this.generateInsights(stats, type, user);
    insightData.forEach(insight => {
      const item = insightsList.createDiv({ cls: 'zoro-insight-item' });
      item.createEl('div', { 
        text: insight.icon,
        cls: 'zoro-insight-icon'
      });
      item.createEl('div', { 
        text: insight.text,
        cls: 'zoro-insight-text'
      });
    });
  }

  renderFavorites(fragment: DocumentFragment, user: User, mediaType: string): void {
    const type = mediaType.toLowerCase();
    const favorites = user.favourites?.[type as keyof Favourites]?.nodes;
    
    if (!favorites?.length) return;

    const section = fragment.createDiv({ cls: 'zoro-stats-favorites' });
    section.createEl('h3', { 
      text: `Favorite ${mediaType}`,
      cls: 'zoro-section-title'
    });

    const favGrid = section.createDiv({ cls: 'zoro-favorites-grid' });
    
    favorites.slice(0, 6).forEach(item => {
      const favItem = favGrid.createDiv({ cls: 'zoro-favorite-item' });
      
      if (item.coverImage?.medium) {
        const coverImg = favItem.createEl('img', {
          cls: 'zoro-favorite-cover',
          attr: {
            src: item.coverImage.medium,
            alt: this.formatter.formatTitle(item)
          }
        }) as HTMLImageElement;
        
        // Force cover image styles with JavaScript
        this.forceImageStyles(coverImg, {
          'width': '45px',
          'height': '65px',
          'object-fit': 'cover',
          'border-radius': '6px',
          'border': '1px solid var(--border)',
          'box-shadow': 'var(--shadow)',
          'flex-shrink': '0',
          'display': 'block'
        });
      }
      
      const info = favItem.createDiv({ cls: 'zoro-favorite-info' });
      info.createEl('div', { 
        text: this.formatter.formatTitle(item),
        cls: 'zoro-favorite-title'
      });
      
      if (item.meanScore) {
        info.createEl('div', { 
          text: `★ ${(item.meanScore / 10).toFixed(1)}`,
          cls: 'zoro-favorite-score'
        });
      }
    });
  }

  renderBreakdownChart(container: HTMLElement, title: string, data: any[], keyField: string, options: BreakdownChartOptions = {}): void {
    const { showPercentages = false, maxItems = 8 } = options;
    
    const chartContainer = container.createDiv({ cls: 'zoro-breakdown-chart' });
    chartContainer.createEl('h4', { 
      text: title,
      cls: 'zoro-breakdown-title'
    });

    const chartData = data.slice(0, maxItems);
    const total = chartData.reduce((sum, item) => sum + item.count, 0);
    const maxCount = Math.max(...chartData.map(item => item.count));

    const chart = chartContainer.createDiv({ cls: 'zoro-chart' });
    
    chartData.forEach((item, index) => {
      const barContainer = chart.createDiv({ cls: 'zoro-chart-bar-container' });
      
      const label = barContainer.createDiv({ cls: 'zoro-chart-label' });
      label.textContent = item[keyField] || item.status || item.genre || item.format;
      
      const barSection = barContainer.createDiv({ cls: 'zoro-chart-bar-section' });
      const bar = barSection.createDiv({ cls: 'zoro-chart-bar' });
      
      const percentage = (item.count / maxCount) * 100;
      bar.style.setProperty('--bar-width', `${percentage}%`);
      bar.style.animationDelay = `${index * 0.1}s`;
      
      const value = barSection.createDiv({ cls: 'zoro-chart-value' });
      if (showPercentages && total > 0) {
        const percent = ((item.count / total) * 100).toFixed(1);
        value.textContent = `${item.count} (${percent}%)`;
      } else {
        value.textContent = item.count.toLocaleString();
      }
    });
  }

  renderScoreDistribution(container: HTMLElement, scores: ScoreCount[], listOptions?: MediaListOptions): void {
    const chartContainer = container.createDiv({ cls: 'zoro-breakdown-chart' });
    chartContainer.createEl('h4', { 
      text: 'Score Distribution',
      cls: 'zoro-breakdown-title'
    });

    const chart = chartContainer.createDiv({ cls: 'zoro-score-chart' });
    const maxCount = Math.max(...scores.map(s => s.count));

    scores.forEach((scoreData, index) => {
      const barContainer = chart.createDiv({ cls: 'zoro-score-bar-container' });
      
      const label = barContainer.createDiv({ cls: 'zoro-score-label' });
      const scoreFormat = listOptions?.scoreFormat || 'POINT_10';
      let scoreValue = scoreData.score;
      if (scoreFormat === 'POINT_10' && typeof scoreValue === 'number' && scoreValue <= 10) {
        scoreValue = scoreValue * 10;
      }
      label.textContent = this.formatter.formatScore(scoreValue, scoreFormat);
      
      const bar = barContainer.createDiv({ cls: 'zoro-score-bar' });
      const percentage = (scoreData.count / maxCount) * 100;
      // Fix: Set --bar-height instead of --bar-width for vertical bars
      bar.style.setProperty('--bar-height', `${percentage}%`);
      bar.style.animationDelay = `${index * 0.1}s`;
      
      const value = barContainer.createDiv({ cls: 'zoro-score-value' });
      value.textContent = scoreData.count.toString();
    });
  }

  renderYearlyActivity(container: HTMLElement, yearData: YearCount[]): void {
    const chartContainer = container.createDiv({ cls: 'zoro-breakdown-chart' });
    chartContainer.createEl('h4', { 
      text: 'Activity by Year',
      cls: 'zoro-breakdown-title'
    });

    const recentYears = yearData
      .filter(y => y.releaseYear >= new Date().getFullYear() - 15)
      .slice(0, 8);

    if (recentYears.length === 0) return;

    const timeline = chartContainer.createDiv({ cls: 'zoro-year-timeline' });
    const maxCount = Math.max(...recentYears.map(y => y.count));

    recentYears.forEach((yearData, index) => {
      const yearItem = timeline.createDiv({ cls: 'zoro-year-item' });
      
      yearItem.createEl('div', { 
        text: yearData.releaseYear.toString(),
        cls: 'zoro-year-label'
      });
      
      const bar = yearItem.createDiv({ cls: 'zoro-year-bar' });
      const percentage = (yearData.count / maxCount) * 100;
      bar.style.setProperty('--bar-width', `${percentage}%`);
      bar.style.animationDelay = `${index * 0.1}s`;
      
      yearItem.createEl('div', { 
        text: yearData.count.toString(),
        cls: 'zoro-year-count'
      });
    });
  }

  generateInsights(stats: MediaStatistics, type: string, user: User): Insight[] {
    const insights: Insight[] = [];
    
    // Completion rate insight
    if (stats.statuses) {
      const completed = stats.statuses.find(s => s.status === 'COMPLETED')?.count || 0;
      const total = stats.count;
      const completionRate = (completed / total * 100).toFixed(0);
      
      if (parseInt(completionRate) >= 80) {
        insights.push({
          icon: '🏆',
          text: `High completion rate: ${completionRate}% of your ${type} are completed`
        });
      } else if (parseInt(completionRate) <= 30) {
        insights.push({
          icon: '📚',
          text: `Lots to explore: Only ${completionRate}% completed, plenty of ${type} to discover!`
        });
      }
    }

    // Score distribution insight
    if (stats.meanScore > 0) {
      if (stats.meanScore >= 80) {
        insights.push({
          icon: '⭐',
          text: `You're generous with ratings! Average score: ${(stats.meanScore/10).toFixed(1)}/10`
        });
      } else if (stats.meanScore <= 60) {
        insights.push({
          icon: '🔍',
          text: `Selective taste: You rate ${type} conservatively with ${(stats.meanScore/10).toFixed(1)}/10 average`
        });
      }
    }

    // Volume insight for anime
    if (type === 'anime' && stats.episodesWatched) {
      if (stats.episodesWatched >= 5000) {
        insights.push({
          icon: '🎭',
          text: `Anime veteran: ${stats.episodesWatched.toLocaleString()} episodes watched!`
        });
      }
      
      if (stats.minutesWatched && stats.minutesWatched >= 100000) { // ~69 days
        const days = Math.floor(stats.minutesWatched / (60 * 24));
        insights.push({
          icon: '⏰',
          text: `Time investment: ${days} days worth of anime watched`
        });
      }
    }

    // Genre diversity (if available)
    if (stats.genres && stats.genres.length >= 15) {
      insights.push({
        icon: '🌈',
        text: `Diverse taste: You enjoy ${stats.genres.length} different genres`
      });
    }

    return insights.slice(0, 4); // Limit to 4 insights
  }
}
