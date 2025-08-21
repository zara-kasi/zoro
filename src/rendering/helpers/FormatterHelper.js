// No obsidian imports needed here

class FormatterHelper {
  formatScore(score, scoreFormat = 'POINT_10') {
    switch (scoreFormat) {
      case 'POINT_100':
        return `${Math.round(score * 10)}/100`;
      case 'POINT_10':
        return `${(score / 10).toFixed(1)}/10`;
      case 'POINT_5':
        return `${Math.round(score / 20)}/5`;
      case 'POINT_3':
        return score >= 70 ? '😊' : score >= 40 ? '😐' : '😞';
      default:
        return `${Math.round(score / 10)}/10`;
    }
  }

  formatWatchTime(minutes) {
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

  formatProgress(current, total) {
    return `${current || 0}/${total || '?'}`;
  }

  formatRating(score, isSearch = false) {
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

  getStatusClass(status) {
    return status ? status.toLowerCase() : 'unknown';
  }

  getStatusText(status) {
    return status || 'Unknown';
  }

  formatGenres(genres, maxCount = 3) {
    if (!genres?.length) return [];
    return genres.slice(0, maxCount);
  }

  formatTitle(media) {
    return media.title?.english || media.title?.romaji || 'Unknown';
  }

  formatFormat(format) {
    return format ? format.substring(0, 2).toUpperCase() : '';
  }
}

export { FormatterHelper };