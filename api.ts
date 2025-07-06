export class AniListAPI {
    private baseUrl = 'https://graphql.anilist.co';
    private cache = new Map<string, { data: any; timestamp: number }>();
    private cacheTimeout = 5 * 60 * 1000; // 5 minutes

    async query(query: string, variables: any = {}): Promise<any> {
        const cacheKey = `${query}_${JSON.stringify(variables)}`;
        
        // Check cache first
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        try {
            const response = await fetch(this.baseUrl, {
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

            const data = await response.json();
            
            if (data.errors) {
                throw new Error(data.errors[0].message);
            }

            // Cache the result
            this.cache.set(cacheKey, { data, timestamp: Date.now() });
            
            return data;
        } catch (error) {
            console.error('AniList API error:', error);
            throw error;
        }
    }

    async getUserList(username: string, status: string = 'CURRENT'): Promise<any> {
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

        return await this.query(query, { username, status });
    }

    async getMediaById(id: number): Promise<any> {
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

        return await this.query(query, { id });
    }

    async getUserStats(username: string): Promise<any> {
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

        return await this.query(query, { username });
    }

    async searchMedia(search: string, type: 'ANIME' | 'MANGA' = 'ANIME'): Promise<any> {
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

        return await this.query(query, { search, type });
    }

    async getRecentActivity(username: string): Promise<any> {
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

        return await this.query(query, { username });
    }

    async getUserFavorites(username: string): Promise<any> {
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

        return await this.query(query, { username });
    }

    clearCache() {
        this.cache.clear();
    }
}