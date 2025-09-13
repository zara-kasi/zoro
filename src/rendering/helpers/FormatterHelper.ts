type ScoreFormat = 'POINT_100' | 'POINT_10' | 'POINT_5' | 'POINT_3';

interface MediaTitle {
  english?: string | null;
  romaji?: string | null;
}

interface Media {
  title?: MediaTitle | null;
}

interface Genre {
  // TODO: confirm actual structure of genre objects
  name?: string;
  [key: string]: unknown;
}

function isValidScoreFormat(format: unknown): format is ScoreFormat {
  return typeof format === 'string' && 
    ['POINT_100', 'POINT_10', 'POINT_5', 'POINT_3'].includes(format);
}

export class FormatterHelper {
  formatScore(score: number, scoreFormat: ScoreFormat = 'POINT_10'): string {
    switch (scoreFormat) {
      case 'POINT_100':
        return `${Math.round(score * 10)}/100`;
      case 'POINT_10':
        // If score is already out of 10 (like TMDb), don't divide
        if (score <= 10) {
          return `${Math.round(score)}/10`;  // Changed from .toFixed(1) to Math.round()
        }
        // If score is out of 100 (like AniList), divide by 10
        return `${Math.round(score / 10)}/10`;  // Changed from .toFixed(1) to Math.round()
      case 'POINT_5':
        return `${Math.round(score / 20)}/5`;
      case 'POINT_3':
        return score >= 70 ? '😊' : score >= 40 ? '😐' : '😞';
      default:
        return `${Math.round(score / 10)}/10`;  // Changed from .toFixed(1) to Math.round()
    }
  }

  formatWatchTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 365) {
      const years = (days / 365).toFixed(1);
      return `${years} years`;
    } else if (days > 30) {
      const months = Math.floor(days / 30);
      return `${months} months`;
    } else if (days > 0) {
      return `${days} days`;
    } else {
      return `${hours} hours`;
    }
  }

  formatProgress(current: number | null | undefined, total: number | null | undefined): string {
    return `${current || 0}/${total || '?'}`;
  }

  formatRating(score: number | null | undefined, isSearch = false): string | null {
    if (score == null) return null;
    
    if (isSearch) {
      return `★ ${Math.round(score / 10)}`;
    } else {
      if (score > 10) {
        return `★ ${Math.round(score / 10)}`;
      } else {
        return `★ ${Math.round(score)}`;
      }
    }
  }

  getStatusClass(status: string | null | undefined): string {
    return status ? status.toLowerCase() : 'unknown';
  }

  getStatusText(status: string | null | undefined): string {
    return status || 'Unknown';
  }

  formatGenres(genres: Genre[] | null | undefined, maxCount = 3): Genre[] {
    if (!genres?.length) return [];
    return genres.slice(0, maxCount);
  }

  formatTitle(media: Media): string {
    return media.title?.english || media.title?.romaji || 'Unknown';
  }

  formatFormat(format: string | null | undefined): string {
    return format ? format.toUpperCase() : '';
  }
}
