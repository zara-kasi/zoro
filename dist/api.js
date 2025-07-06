var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export class AniListAPI {
    constructor() {
        this.baseUrl = 'https://graphql.anilist.co';
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }
    query(query, variables = {}) {
        return __awaiter(this, void 0, void 0, function* () {
            const cacheKey = `${query}_${JSON.stringify(variables)}`;
            // Check cache first
            const cached = this.cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
            try {
                const response = yield fetch(this.baseUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({
                        query,
                        variables
                    })
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = yield response.json();
                if (data.errors) {
                    throw new Error(data.errors[0].message);
                }
                // Cache the result
                this.cache.set(cacheKey, { data, timestamp: Date.now() });
                return data;
            }
            catch (error) {
                console.error('AniList API error:', error);
                throw error;
            }
        });
    }
    getUserList(username, status = 'CURRENT') {
        return __awaiter(this, void 0, void 0, function* () {
            const query = `
            query ($username: String, $status: MediaListStatus) {
                MediaListCollection(userName: $username, type: ANIME, status: $status) {
                    lists {
                        name
                        entries {
                            id
                            status
                            score
                            progress
                            repeat
                            updatedAt
                            media {
                                id
                                title {
                                    romaji
                                    english
                                    native
                                }
                                coverImage {
                                    large
                                    medium
                                    color
                                }
                                bannerImage
                                format
                                status
                                episodes
                                duration
                                chapters
                                volumes
                                season
                                seasonYear
                                averageScore
                                popularity
                                genres
                                studios {
                                    edges {
                                        node {
                                            name
                                        }
                                    }
                                }
                                siteUrl
                                description
                                startDate {
                                    year
                                    month
                                    day
                                }
                                endDate {
                                    year
                                    month
                                    day
                                }
                            }
                        }
                    }
                }
            }
        `;
            return yield this.query(query, { username, status });
        });
    }
    getMediaById(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const query = `
            query ($id: Int) {
                Media(id: $id) {
                    id
                    title {
                        romaji
                        english
                        native
                    }
                    coverImage {
                        large
                        medium
                        color
                    }
                    bannerImage
                    format
                    status
                    episodes
                    duration
                    chapters
                    volumes
                    season
                    seasonYear
                    averageScore
                    popularity
                    genres
                    studios {
                        edges {
                            node {
                                name
                            }
                        }
                    }
                    siteUrl
                    description
                    startDate {
                        year
                        month
                        day
                    }
                    endDate {
                        year
                        month
                        day
                    }
                }
            }
        `;
            return yield this.query(query, { id });
        });
    }
    getUserStats(username) {
        return __awaiter(this, void 0, void 0, function* () {
            const query = `
            query ($username: String) {
                User(name: $username) {
                    id
                    name
                    avatar {
                        large
                        medium
                    }
                    statistics {
                        anime {
                            count
                            meanScore
                            minutesWatched
                            episodesWatched
                            statuses {
                                status
                                count
                                meanScore
                                minutesWatched
                            }
                            scores {
                                score
                                count
                                meanScore
                                minutesWatched
                            }
                            genres {
                                genre
                                count
                                meanScore
                                minutesWatched
                            }
                        }
                        manga {
                            count
                            meanScore
                            chaptersRead
                            volumesRead
                            statuses {
                                status
                                count
                                meanScore
                                chaptersRead
                            }
                            scores {
                                score
                                count
                                meanScore
                                chaptersRead
                            }
                            genres {
                                genre
                                count
                                meanScore
                                chaptersRead
                            }
                        }
                    }
                }
            }
        `;
            return yield this.query(query, { username });
        });
    }
    searchMedia(search, type = 'ANIME') {
        return __awaiter(this, void 0, void 0, function* () {
            const query = `
            query ($search: String, $type: MediaType) {
                Page(page: 1, perPage: 10) {
                    media(search: $search, type: $type) {
                        id
                        title {
                            romaji
                            english
                            native
                        }
                        coverImage {
                            large
                            medium
                            color
                        }
                        format
                        status
                        episodes
                        chapters
                        volumes
                        season
                        seasonYear
                        averageScore
                        popularity
                        genres
                        siteUrl
                        description(asHtml: false)
                        startDate {
                            year
                            month
                            day
                        }
                    }
                }
            }
        `;
            return yield this.query(query, { search, type });
        });
    }
    getRecentActivity(username) {
        return __awaiter(this, void 0, void 0, function* () {
            const query = `
            query ($username: String) {
                Page(page: 1, perPage: 10) {
                    activities(userId_in: [$username], type: MEDIA_LIST, sort: ID_DESC) {
                        ... on ListActivity {
                            id
                            type
                            status
                            progress
                            createdAt
                            media {
                                id
                                title {
                                    romaji
                                }
                                coverImage {
                                    medium
                                }
                                siteUrl
                            }
                        }
                    }
                }
            }
        `;
            return yield this.query(query, { username });
        });
    }
    getUserFavorites(username) {
        return __awaiter(this, void 0, void 0, function* () {
            const query = `
            query ($username: String) {
                User(name: $username) {
                    favourites {
                        anime {
                            edges {
                                node {
                                    id
                                    title {
                                        romaji
                                        english
                                    }
                                    coverImage {
                                        large
                                        medium
                                    }
                                    averageScore
                                    siteUrl
                                }
                            }
                        }
                        manga {
                            edges {
                                node {
                                    id
                                    title {
                                        romaji
                                        english
                                    }
                                    coverImage {
                                        large
                                        medium
                                    }
                                    averageScore
                                    siteUrl
                                }
                            }
                        }
                    }
                }
            }
        `;
            return yield this.query(query, { username });
        });
    }
    clearCache() {
        this.cache.clear();
    }
}
