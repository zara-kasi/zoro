async function fetchAniListData(config) {
  const key = JSON.stringify(config);
  const cached = this.cache.get(key);
  if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
    return cached.data;
  }
  let query = '', variables = {};
  switch (config.type) {
    case 'stats':
      query = getUserStatsQuery();
      variables = { username: config.username };
      break;
    // handle other cases...
  }
  const headers = { 'Content-Type': 'application/json' };
  if (this.settings.accessToken) headers.Authorization = `Bearer ${this.settings.accessToken}`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(res.statusText);
  const json = await res.json();
  this.cache.set(key, { data: json.data, timestamp: Date.now() });
  return json.data;
}

function getUserStatsQuery() {
  return `
    query ($username: String) {
      User(name: $username) {
        id name avatar { large }
      }
    }
  `;
}

// Export
module.exports = {
  fetchAniListData,
  getUserStatsQuery
};
