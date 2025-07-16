const queries = {
  getMediaListQuery(layout = 'card') {
    const baseFields = 'id status score progress';
    const mediaFields = {
      compact: 'id title { romaji } coverImage { medium }',
      card: `
        id title { romaji english native } coverImage { large medium }
        format averageScore status
      `,
      full: `
        id title { romaji english native } coverImage { large medium }
        episodes chapters genres format averageScore status
        startDate { year month day } endDate { year month day }
      `
    };
    const fields = mediaFields[layout] || mediaFields.card;
    return `
      query ($username: String, $status: MediaListStatus, $type: MediaType) {
        MediaListCollection(userName: $username, status: $status, type: $type) {
          lists { entries { ${baseFields} media { ${fields} } } }
        }
      }
    `;
  },

  getSingleMediaQuery(layout = 'card') {
    const baseFields = 'id status score progress';
    const mediaFields = {
      compact: 'id title { romaji } coverImage { medium }',
      card: `
        id title { romaji english native } coverImage { large medium }
        format averageScore status
      `,
      full: `
        id title { romaji english native } coverImage { large medium }
        episodes chapters genres format averageScore status
        startDate { year month day } endDate { year month day }
      `
    };
    const fields = mediaFields[layout] || mediaFields.card;
    return `
      query ($username: String, $mediaId: Int, $type: MediaType) {
        MediaList(userName: $username, mediaId: $mediaId, type: $type) {
          ${baseFields} media { ${fields} }
        }
      }
    `;
  },

  getUserStatsQuery({ mediaType = 'ANIME', layout = 'card' }) {
    const typeKey = mediaType.toLowerCase();
    const statFields = {
      compact: 'count meanScore',
      card: 'count meanScore standardDeviation',
      full: 'count meanScore standardDeviation episodesWatched minutesWatched chaptersRead volumesRead'
    };
    const selected = statFields[layout] || statFields.card;
    return `
      query ($username: String) {
        User(name: $username) {
          id name avatar { large medium }
          statistics { ${typeKey} { ${selected} } }
        }
      }
    `;
  },

  getSearchMediaQuery(layout = 'card') {
    const mediaFields = {
      compact: 'id title { romaji } coverImage { medium }',
      card: `
        id title { romaji english native } coverImage { large medium }
        format averageScore status
      `,
      full: `
        id title { romaji english native } coverImage { large medium }
        episodes chapters genres format averageScore status
        startDate { year month day } endDate { year month day }
      `
    };
    const fields = mediaFields[layout] || mediaFields.card;
    return `
      query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(search: $search, type: $type, sort: POPULARITY_DESC) { ${fields} }
        }
      }
    `;
  }
};

module.exports = queries;
