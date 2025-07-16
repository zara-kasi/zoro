  // Function to get appropriate grid columns based on screen size
function getDefaultGridColumns() {
  // Check if we're in a browser environment (Obsidian desktop/mobile)
  if (typeof window !== 'undefined') {
    // Use a breakpoint - you can adjust this value
    const mobileBreakpoint = 768; // pixels
    return window.innerWidth >= mobileBreakpoint ? 5 : 2;
  }
  // Fallback if window is not available
  return 2;
}

export const DEFAULT_SETTINGS = {
  defaultUsername: '',
  defaultLayout: 'card',
  showCoverImages: true,
  showRatings: true,
  showProgress: true,
  showGenres: false,
  gridColumns: getDefaultGridColumns(), // Dynamic value
  clientId: '',
  clientSecret: '',
  redirectUri: 'https://anilist.co/api/v2/oauth/pin',
  accessToken: '',
};