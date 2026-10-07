/**
 * Knaben Stremio Addon - Cloudflare Worker (Standalone 1-File Edition)
 * Tự động cào Magnet links từ Knaben.org, Apibay, SolidTorrents & sắp xếp Seeds cao nhất
 * 
 * Hướng dẫn triển khai nhanh trên Cloudflare Dashboard (Không cần cài phần mềm):
 * 1. Đăng nhập https://dash.cloudflare.com -> Chọn "Workers & Pages" -> "Create Application" -> "Create Worker".
 * 2. Đặt tên (VD: knaben-stremio) -> Nhấn "Deploy".
 * 3. Chọn "Edit Code" -> Xóa hết code cũ và DÁN TOÀN BỘ file này vào -> Nhấn "Save and deploy".
 * 4. Copy URL Worker (VD: https://knaben-stremio.yourname.workers.dev/manifest.json) và dán vào Stremio!
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function parseSizeBytes(sizeStr) {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/([\d.]+)\s*([a-zA-Z]+)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit.startsWith('T')) return num * 1024 * 1024 * 1024 * 1024;
  if (unit.startsWith('G')) return num * 1024 * 1024 * 1024;
  if (unit.startsWith('M')) return num * 1024 * 1024;
  if (unit.startsWith('K')) return num * 1024;
  return num;
}

function detectQualityTags(title) {
  const t = title.toUpperCase();
  const is4k = t.includes('4K') || t.includes('2160P') || t.includes('UHD');
  const is1080p = t.includes('1080P') || t.includes('FHD');
  const is720p = t.includes('720P') || (t.includes('HD') && !is1080p && !is4k);
  const isHdr = t.includes('HDR') || t.includes('VISION') || t.includes('DV') || t.includes('HDR10');
  const isRemux = t.includes('REMUX');

  let mainQuality = 'SD';
  if (is4k) mainQuality = '4K 2160p';
  else if (is1080p) mainQuality = '1080p';
  else if (is720p) mainQuality = '720p';

  return { is4k, is1080p, is720p, isHdr, isRemux, mainQuality };
}

function extractInfoHash(magnet) {
  if (!magnet) return '';
  const match = magnet.match(/urn:btih:([a-fA-F0-9]{40})/i) || magnet.match(/urn:btih:([a-zA-Z2-7]{32})/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return '';
}

function parseConfig(configStr, searchParams) {
  const config = {
    minSeeds: searchParams?.get('minSeeds') ? parseInt(searchParams.get('minSeeds'), 10) : 0,
    maxResults: searchParams?.get('maxResults') ? parseInt(searchParams.get('maxResults'), 10) : 50,
    qualityFilter: searchParams?.get('qualityFilter') || 'all',
    sortBy: searchParams?.get('sortBy') || 'seeds',
  };

  if (configStr && configStr !== 'manifest.json') {
    if (configStr.includes('=')) {
      const params = new URLSearchParams(configStr);
      if (params.has('minSeeds')) config.minSeeds = parseInt(params.get('minSeeds'), 10);
      if (params.has('maxResults')) config.maxResults = parseInt(params.get('maxResults'), 10);
      if (params.has('qualityFilter')) config.qualityFilter = params.get('qualityFilter');
      if (params.has('sortBy')) config.sortBy = params.get('sortBy');
    } else {
      try {
        const jsonStr = atob(configStr);
        const parsed = JSON.parse(jsonStr);
        if (typeof parsed === 'object' && parsed !== null) {
          if (parsed.minSeeds !== undefined) config.minSeeds = parseInt(parsed.minSeeds, 10);
          if (parsed.maxResults !== undefined) config.maxResults = parseInt(parsed.maxResults, 10);
          if (parsed.qualityFilter) config.qualityFilter = parsed.qualityFilter;
          if (parsed.sortBy) config.sortBy = parsed.sortBy;
        }
      } catch {
        // Ignore invalid base64
      }
    }
  }

  return config;
}

function getManifest(config, origin, configStr) {
  let name = 'Knaben Torrent Streams';
  if (config && config.minSeeds && config.minSeeds > 0) {
    name += ` (${config.minSeeds}+ seeds)`;
  }
  if (config && config.qualityFilter && config.qualityFilter !== 'all') {
    name += ` [${config.qualityFilter.toUpperCase()}]`;
  }

  const configurationURL = origin ? (configStr ? `${origin}/${configStr}/configure` : `${origin}/configure`) : undefined;

  return {
    id: 'community.knaben.torrents',
    version: '2.2.1',
    name: name,
    description: 'Cào và phát trực tiếp magnet torrent từ Knaben.org, sắp xếp theo số lượng seeds cao nhất. Tự động nhận diện phim & tập phim series từ IMDb / Cinemeta.',
    resources: ['stream'],
    types: ['movie', 'series', 'other'],
    idPrefixes: ['tt', 'kna', 'knaben'],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      ...(configurationURL ? { configurationURL } : {})
    },
    config: [
      {
        key: 'minSeeds',
        type: 'select',
        title: 'Số Seeds tối thiểu',
        default: '0',
        options: ['0', '5', '10', '20', '50']
      },
      {
        key: 'qualityFilter',
        type: 'select',
        title: 'Bộ lọc chất lượng (Quality)',
        default: 'all',
        options: ['all', '4k', '1080p', '720p']
      },
      {
        key: 'sortBy',
        type: 'select',
        title: 'Sắp xếp kết quả (Sort)',
        default: 'seeds',
        options: ['seeds', 'size', 'title']
      },
      {
        key: 'maxResults',
        type: 'select',
        title: 'Số lượng kết quả tối đa',
        default: '50',
        options: ['20', '50', '100']
      }
    ],
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920',
    logo: 'https://knaben.org/favicon.ico',
  };
}
      {
        key: 'minSeeds',
        type: 'select',
        title: 'Số Seeds tối thiểu',
        default: '0',
        options: ['0', '5', '10', '20', '50']
      },
      {
        key: 'qualityFilter',
        type: 'select',
        title: 'Bộ lọc chất lượng (Quality)',
        default: 'all',
        options: ['all', '4k', '1080p', '720p']
      },
      {
        key: 'sortBy',
        type: 'select',
        title: 'Sắp xếp kết quả (Sort)',
        default: 'seeds',
        options: ['seeds', 'size', 'title']
      },
      {
        key: 'maxResults',
        type: 'select',
        title: 'Số lượng kết quả tối đa',
        default: '50',
        options: ['20', '50', '100']
      }
    ],
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920',
    logo: 'https://knaben.org/favicon.ico',
  };
}

// Fetch catalog items from Cinemeta
async function handleCatalogRequest(type, id, searchQuery) {
  const cinemetaType = type === 'series' ? 'series' : 'movie';
  let targetUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top`;
  if (searchQuery) {
    targetUrl += `/search=${encodeURIComponent(searchQuery)}.json`;
  } else {
    targetUrl += '.json';
  }

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      return { metas: data.metas || [] };
    }
  } catch (err) {
    console.warn('[Catalog error]', err.message);
  }
  return { metas: [] };
}

// Scrape Knaben HTML mirror
async function fetchKnabenMirror(mirror, query) {
  try {
    const encoded = encodeURIComponent(query.trim());
    const searchUrl = `${mirror}/search/${encoded}/0/1/seeds`;
    let res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) {
      const fallbackUrl = `${mirror}/search/index.php?q=${encoded}`;
      res = await fetch(fallbackUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(3500),
      });
    }

    if (!res.ok) return [];
    const html = await res.text();
    if (!html) return [];

    const items = [];
    const rowRegex = /<tr[^>]*data-id="([a-fA-F0-9]{40})"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
      const infoHash = match[1].toLowerCase();
      const rowContent = match[2];

      const magnetMatch = rowContent.match(/href="(magnet:\?[^"]+)"/i);
      const magnetLink = magnetMatch ? magnetMatch[1].replace(/&amp;/g, '&') : '';

      let title = '';
      const titleAttrMatch = rowContent.match(/<a[^>]*title="([^"]+)"/i);
      if (titleAttrMatch) title = titleAttrMatch[1].trim();

      if (!title) {
        const titleLinkMatch = rowContent.match(/<a[^>]*href="[^"]*\/details\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
        if (titleLinkMatch) {
          title = titleLinkMatch[1].replace(/<[^>]+>/g, '').trim();
        }
      }

      if (!title) {
        const wrapMatch = rowContent.match(/<td[^>]*class="[^"]*text-wrap[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
        if (wrapMatch) {
          title = wrapMatch[1].replace(/<[^>]+>/g, '').trim();
        }
      }

      if (!title && magnetLink) {
        const dnMatch = magnetLink.match(/dn=([^&]+)/);
        if (dnMatch) {
          try {
            title = decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ');
          } catch {
            title = dnMatch[1].replace(/\+/g, ' ');
          }
        }
      }
      if (!title) continue;

      const finalMagnet = magnetLink || `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce`;

      let sizeStr = '';
      const sizeAttrMatch = rowContent.match(/<td[^>]*title="[^"]*Bytes"[^>]*>([\s\S]*?)<\/td>/i);
      if (sizeAttrMatch) {
        sizeStr = sizeAttrMatch[1].replace(/<[^>]+>/g, '').trim();
      } else {
        const sizeMatch = rowContent.match(/\b(\d+(?:\.\d+)?\s*(?:GiB|MiB|KiB|TiB|GB|MB|KB|TB))\b/i);
        if (sizeMatch) sizeStr = sizeMatch[1];
      }

      let seeds = 0;
      let leeches = 0;
      const colorMatches = [...rowContent.matchAll(/<td[^>]*style="[^"]*color[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)];
      if (colorMatches.length >= 1) {
        seeds = parseInt(colorMatches[0][1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim(), 10) || 0;
        if (colorMatches.length >= 2) {
          leeches = parseInt(colorMatches[1][1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim(), 10) || 0;
        }
      }

      if (seeds === 0) {
        const seedMatch = rowContent.match(/class="[^"]*(?:seeds|seeders|green|text-success)[^"]*"[^>]*>([\s\S]*?)<\//i);
        if (seedMatch) seeds = parseInt(seedMatch[1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim(), 10) || 0;
        const leechMatch = rowContent.match(/class="[^"]*(?:leeches|leechers|red|text-danger)[^"]*"[^>]*>([\s\S]*?)<\//i);
        if (leechMatch) leeches = parseInt(leechMatch[1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim(), 10) || 0;
      }

      const quality = detectQualityTags(title);

      items.push({
        id: `knaben-${infoHash}`,
        title,
        infoHash,
        magnet: finalMagnet,
        seeds,
        leeches,
        size: sizeStr || 'N/A',
        sizeBytes: parseSizeBytes(sizeStr),
        category: 'Knaben.org',
        source: 'Knaben.org',
        quality: quality.mainQuality,
        is4k: quality.is4k,
        is1080p: quality.is1080p,
        is720p: quality.is720p,
        isHdr: quality.isHdr,
        isRemux: quality.isRemux,
      });
    }

    return items;
  } catch {
    return [];
  }
}

// Backup Apibay Torrent Engine
async function fetchApibay(query) {
  try {
    const res = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((item) => item.info_hash && item.name && item.info_hash !== '0000000000000000000000000000000000000000')
      .map((item) => {
        const infoHash = item.info_hash.toLowerCase();
        const seeds = parseInt(item.seeders, 10) || 0;
        const leeches = parseInt(item.leechers, 10) || 0;
        const sizeBytes = parseInt(item.size, 10) || 0;
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
        const sizeStr = sizeBytes > 1073741824 ? `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : `${sizeMB} MB`;
        const title = item.name;
        const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce`;
        const quality = detectQualityTags(title);

        return {
          id: `apibay-${infoHash}`,
          title,
          infoHash,
          magnet,
          seeds,
          leeches,
          size: sizeStr,
          sizeBytes,
          category: 'Knaben Torrent Index',
          source: 'Knaben Engine (Apibay)',
          quality: quality.mainQuality,
          is4k: quality.is4k,
          is1080p: quality.is1080p,
          is720p: quality.is720p,
          isHdr: quality.isHdr,
          isRemux: quality.isRemux,
        };
      });
  } catch {
    return [];
  }
}

// Backup SolidTorrents Engine
async function fetchSolidTorrents(query) {
  try {
    const res = await fetch(`https://solidtorrents.to/api/v1/search?q=${encodeURIComponent(query)}&category=all`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json || !Array.isArray(json.results)) return [];

    return json.results
      .map((t) => {
        const infoHash = t.infohash?.toLowerCase();
        if (!infoHash) return null;
        const title = t.title;
        const seeds = parseInt(t.swarm?.seeders, 10) || 0;
        const leeches = parseInt(t.swarm?.leechers, 10) || 0;
        const sizeBytes = parseInt(t.size, 10) || 0;
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
        const sizeStr = sizeBytes > 1073741824 ? `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : `${sizeMB} MB`;
        const quality = detectQualityTags(title);

        return {
          id: `solid-${infoHash}`,
          title,
          infoHash,
          magnet: t.magnet || `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`,
          seeds,
          leeches,
          size: sizeStr,
          sizeBytes,
          category: t.category || 'Knaben Torrent Index',
          source: 'Knaben Engine (Solid)',
          quality: quality.mainQuality,
          is4k: quality.is4k,
          is1080p: quality.is1080p,
          is720p: quality.is720p,
          isHdr: quality.isHdr,
          isRemux: quality.isRemux,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Check if title matches TV series episode
function matchesEpisode(title, season, episode) {
  if (season === undefined || episode === undefined || season === null || episode === null) return true;
  const t = title.toUpperCase();

  const exactPatterns = [
    new RegExp(`S0*${season}[.\\s-]*E0*${episode}\\b`, 'i'),
    new RegExp(`\\b${season}X0*${episode}\\b`, 'i'),
  ];

  if (exactPatterns.some((p) => p.test(t))) {
    return true;
  }

  const isSeasonPack = new RegExp(`\\bS0*${season}\\b`, 'i').test(t) || new RegExp(`SEASON\\s*0*${season}\\b`, 'i').test(t);
  const mentionsOtherEpisode = new RegExp(`E(?!(0*${episode}\\b))\\d+`, 'i').test(t);

  if (isSeasonPack && !mentionsOtherEpisode) {
    return true;
  }

  return false;
}

// Resolves Stremio IMDb IDs into titles via Cinemeta
async function resolveStremioMedia(type, id) {
  const decodedId = decodeURIComponent(id).trim();

  if (!decodedId.startsWith('tt')) {
    return {
      primaryQuery: decodedId.replace(/^(knaben:|kna:)/i, ''),
    };
  }

  const parts = decodedId.split(':');
  const imdbId = parts[0];
  const season = parts[1] ? parseInt(parts[1], 10) : undefined;
  const episode = parts[2] ? parseInt(parts[2], 10) : undefined;
  const cinemetaType = (type === 'series' || season !== undefined) ? 'series' : 'movie';

  try {
    const res = await fetch(`https://v3-cinemeta.strem.io/meta/${cinemetaType}/${imdbId}.json`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3500),
    });

    if (res.ok) {
      const data = await res.json();
      const meta = data?.meta;
      if (meta?.name) {
        const cleanName = meta.name.replace(/[:'’]/g, ' ').replace(/\s+/g, ' ').trim();
        if (season !== undefined && episode !== undefined) {
          const s = String(season).padStart(2, '0');
          const e = String(episode).padStart(2, '0');
          return {
            primaryQuery: `${cleanName} S${s}E${e}`,
            fallbackQuery: `${cleanName} S${s}`,
            season,
            episode,
            imdbId,
            name: meta.name,
            year: meta.year,
          };
        }

        const year = meta.year ? String(meta.year).slice(0, 4) : '';
        return {
          primaryQuery: year ? `${cleanName} ${year}` : cleanName,
          fallbackQuery: cleanName,
          imdbId,
          name: meta.name,
          year: meta.year,
        };
      }
    }
  } catch (err) {
    console.warn('[Cinemeta resolve warning]', err.message);
  }

  return {
    primaryQuery: imdbId,
    imdbId,
    season,
    episode,
  };
}

async function scrapeKnaben(query, config = {}, mediaMeta = null) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const minSeeds = config.minSeeds ?? 0;
  const maxResults = config.maxResults ?? 50;
  const qualityFilter = config.qualityFilter || 'all';
  const sortBy = config.sortBy || 'seeds';

  const items = [];

  const searchTasks = [
    fetchKnabenMirror('https://knaben.org', cleanQuery),
    fetchApibay(cleanQuery),
  ];

  if (mediaMeta?.fallbackQuery && mediaMeta.fallbackQuery !== cleanQuery) {
    searchTasks.push(fetchKnabenMirror('https://knaben.org', mediaMeta.fallbackQuery));
  }

  if (mediaMeta?.imdbId && mediaMeta.imdbId !== cleanQuery) {
    searchTasks.push(fetchApibay(mediaMeta.imdbId));
  }

  searchTasks.push(fetchSolidTorrents(cleanQuery));

  const settled = await Promise.allSettled(searchTasks);
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      items.push(...res.value);
    }
  }

  const uniqueMap = new Map();
  for (const item of items) {
    const existing = uniqueMap.get(item.infoHash);
    if (!existing || existing.seeds < item.seeds) {
      uniqueMap.set(item.infoHash, item);
    }
  }

  let finalItems = Array.from(uniqueMap.values());

  if (mediaMeta?.season !== undefined && mediaMeta?.episode !== undefined) {
    finalItems = finalItems.filter((i) => matchesEpisode(i.title, mediaMeta.season, mediaMeta.episode));
  }

  if (minSeeds > 0) {
    finalItems = finalItems.filter((i) => i.seeds >= minSeeds);
  }

  if (qualityFilter === '4k') {
    finalItems = finalItems.filter((i) => i.is4k);
  } else if (qualityFilter === '1080p') {
    finalItems = finalItems.filter((i) => i.is1080p);
  } else if (qualityFilter === '720p') {
    finalItems = finalItems.filter((i) => i.is720p);
  }

  if (sortBy === 'size') {
    finalItems.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  } else if (sortBy === 'title') {
    finalItems.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    finalItems.sort((a, b) => b.seeds - a.seeds);
  }

  return finalItems.slice(0, maxResults);
}

function formatStremioStreams(items) {
  return items.map((item) => {
    const seedBadge = item.seeds > 0 ? `🟢 ${item.seeds} seeds` : `⚪ 0 seeds`;
    const leechBadge = item.leeches > 0 ? `🔴 ${item.leeches} leeches` : ``;
    const qualityTag = item.quality || (item.is4k ? '4K' : item.is1080p ? '1080p' : item.is720p ? '720p' : 'HD');

    const nameLine = `[${qualityTag}] Knaben ⚡\n👥 ${item.seeds} seeds`;
    const titleLine = `${item.title}\n💾 ${item.size} | ${seedBadge} ${leechBadge ? '| ' + leechBadge : ''}\n⚡ Knaben Magnet Stream (Cloudflare)`;

    return {
      name: nameLine,
      title: titleLine,
      infoHash: item.infoHash.toLowerCase(),
      externalUrl: item.magnet,
      sources: [
        'tracker:udp://tracker.opentrackr.org:1337/announce',
        'tracker:udp://open.demonii.com:1337/announce',
        'tracker:udp://open.stealth.si:80/announce',
        'tracker:udp://tracker.torrent.eu.org:451/announce',
        'tracker:udp://vito-tracker.space:6969/announce',
        'tracker:udp://vito-tracker.duckdns.org:6969/announce',
        'tracker:udp://tracker.theoks.net:6969/announce',
        'tracker:udp://tracker.srv00.com:6969/announce',
        `dht:${item.infoHash.toLowerCase()}`,
      ],
      behaviorHints: {
        bingeGroup: `knaben-${qualityTag.toLowerCase()}`,
        notFast: false,
      },
    };
  });
}

function getLandingHtml(origin, initialConfig = {}) {
  const currentMinSeeds = initialConfig.minSeeds ?? 0;
  const currentQuality = initialConfig.qualityFilter || 'all';
  const currentSortBy = initialConfig.sortBy || 'seeds';
  const currentMaxResults = initialConfig.maxResults || 50;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cấu hình Knaben Stremio Addon</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #020617; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body class="min-h-screen flex flex-col justify-between selection:bg-purple-600 selection:text-white">
  <div class="max-w-4xl mx-auto px-4 py-10 w-full space-y-8">
    
    <!-- Header -->
    <div class="text-center space-y-3">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-semibold">
        <span>⚡ Cloudflare Workers Serverless</span>
        <span>•</span>
        <span class="text-emerald-400">24/7 Sẵn sàng</span>
        <span>•</span>
        <span class="text-cyan-400">Hỗ trợ IMDb & Cinemeta</span>
      </div>
      <h1 class="text-3xl sm:text-4xl font-black tracking-tight text-white">
        Cấu hình Knaben Stremio Addon
      </h1>
      <p class="text-slate-400 text-sm max-w-xl mx-auto">
        Tự động cào Magnet link từ Knaben.org, sắp xếp theo số lượng seeds cao nhất và hỗ trợ stream torrent mượt mà trên Stremio.
      </p>
    </div>

    <!-- Configuration Box -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
      <div class="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 class="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <span>⚙️ Tùy chỉnh bộ lọc Addon</span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Thay đổi thiết lập bên dưới, link cài đặt sẽ tự động cập nhật ngay lập tức.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Min seeds -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-slate-300">Số Seeds tối thiểu:</label>
          <select id="minSeedsSelect" onchange="updateManifestUrl()" class="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500">
            <option value="0" ${currentMinSeeds === 0 ? 'selected' : ''}>Tất cả (0+ seeds)</option>
            <option value="5" ${currentMinSeeds === 5 ? 'selected' : ''}>Tối thiểu 5 seeds</option>
            <option value="10" ${currentMinSeeds === 10 ? 'selected' : ''}>Tối thiểu 10 seeds</option>
            <option value="20" ${currentMinSeeds === 20 ? 'selected' : ''}>Tối thiểu 20 seeds (Nhanh)</option>
            <option value="50" ${currentMinSeeds === 50 ? 'selected' : ''}>Tối thiểu 50 seeds (Siêu nhanh)</option>
          </select>
        </div>

        <!-- Quality filter -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-slate-300">Chất lượng video:</label>
          <select id="qualitySelect" onchange="updateManifestUrl()" class="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500">
            <option value="all" ${currentQuality === 'all' ? 'selected' : ''}>Tất cả chất lượng (All)</option>
            <option value="4k" ${currentQuality === '4k' ? 'selected' : ''}>Chỉ 4K UHD (2160p)</option>
            <option value="1080p" ${currentQuality === '1080p' ? 'selected' : ''}>Chỉ 1080p Full HD</option>
            <option value="720p" ${currentQuality === '720p' ? 'selected' : ''}>Chỉ 720p HD</option>
          </select>
        </div>

        <!-- Sort by -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-slate-300">Sắp xếp theo:</label>
          <select id="sortSelect" onchange="updateManifestUrl()" class="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500">
            <option value="seeds" ${currentSortBy === 'seeds' ? 'selected' : ''}>Seeds cao nhất trước</option>
            <option value="size" ${currentSortBy === 'size' ? 'selected' : ''}>Dung lượng file lớn nhất</option>
            <option value="title" ${currentSortBy === 'title' ? 'selected' : ''}>Tên tệp (A-Z)</option>
          </select>
        </div>

        <!-- Max results -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-slate-300">Số kết quả tối đa:</label>
          <select id="maxResultsSelect" onchange="updateManifestUrl()" class="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500">
            <option value="20" ${currentMaxResults === 20 ? 'selected' : ''}>20 kết quả</option>
            <option value="50" ${currentMaxResults === 50 ? 'selected' : ''}>50 kết quả (Khuyên dùng)</option>
            <option value="100" ${currentMaxResults === 100 ? 'selected' : ''}>100 kết quả</option>
          </select>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col sm:flex-row gap-3 pt-2">
        <a id="stremioInstallBtn" href="#" class="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-600/30 transition-all active:scale-95">
          <span>🚀 Cài vào Stremio (1-Click Install)</span>
        </a>
        <a id="stremioWebBtn" href="#" target="_blank" class="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-semibold text-sm transition-all">
          <span>Mở Stremio Web</span>
        </a>
      </div>

      <!-- Manifest URL Copy -->
      <div class="space-y-2 pt-2">
        <label class="text-xs font-semibold text-slate-400">Link Manifest cài đặt thủ công (Dán vào ô tìm kiếm Addon trong Stremio):</label>
        <div class="flex gap-2">
          <input type="text" readonly id="manifestInput" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-purple-300 select-all" />
          <button onclick="navigator.clipboard.writeText(document.getElementById('manifestInput').value); alert('Đã sao chép link manifest!')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer">
            Copy Link
          </button>
        </div>
      </div>
    </div>

    <!-- Live Test Search Tool -->
    <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
      <h3 class="text-sm font-bold text-slate-200 flex items-center gap-2">
        <span>🔍 Thử nghiệm cào torrent ngay trên trang web</span>
      </h3>
      <p class="text-xs text-slate-400">Nhập từ khóa, tên phim hoặc mã IMDb (vd: <code class="text-purple-300 font-mono">Inception</code>, <code class="text-purple-300 font-mono">tt1375666</code>, <code class="text-purple-300 font-mono">Breaking Bad S01E01</code>) để kiểm tra:</p>
      
      <div class="flex gap-2">
        <input type="text" id="testQueryInput" value="Inception 2010" placeholder="Nhập tên phim hoặc mã IMDb..." class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500" />
        <button onclick="runTestSearch()" id="testSearchBtn" class="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all">
          Tìm Kiếm
        </button>
      </div>

      <div class="flex flex-wrap gap-2 text-xs">
        <span class="text-slate-500">Mẫu thử:</span>
        <button type="button" onclick="setTestQuery('Inception 2010')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">Inception 2010</button>
        <button type="button" onclick="setTestQuery('tt1375666')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">tt1375666</button>
        <button type="button" onclick="setTestQuery('Breaking Bad S01E01')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">Breaking Bad S01E01</button>
        <button type="button" onclick="setTestQuery('tt0903747:1:1')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">tt0903747:1:1</button>
      </div>

      <div id="testResultsBox" class="hidden space-y-2 pt-2 border-t border-slate-800 text-xs">
        <div id="testStatusText" class="text-slate-400 font-mono"></div>
        <div id="testItemsList" class="space-y-2 max-h-72 overflow-y-auto pr-1"></div>
      </div>
    </div>

  </div>

  <footer class="text-center py-6 text-xs text-slate-600 border-t border-slate-900">
    Knaben Stremio Addon • Serverless on Cloudflare Workers Global Edge
  </footer>

  <script>
    const ORIGIN = '${origin}';

    function updateManifestUrl() {
      const minSeeds = document.getElementById('minSeedsSelect').value;
      const quality = document.getElementById('qualitySelect').value;
      const sortBy = document.getElementById('sortSelect').value;
      const maxResults = document.getElementById('maxResultsSelect').value;

      const params = new URLSearchParams();
      if (minSeeds !== '0') params.set('minSeeds', minSeeds);
      if (quality !== 'all') params.set('qualityFilter', quality);
      if (sortBy !== 'seeds') params.set('sortBy', sortBy);
      if (maxResults !== '50') params.set('maxResults', maxResults);

      const paramStr = params.toString();
      const manifestUrl = paramStr ? (ORIGIN + '/' + paramStr + '/manifest.json') : (ORIGIN + '/manifest.json');
      const stremioDeepLink = manifestUrl.replace(/^https?:\\/\\//, 'stremio://');
      const stremioWebLink = 'https://web.stremio.com/#/addon/detail?addon=' + encodeURIComponent(manifestUrl);

      document.getElementById('manifestInput').value = manifestUrl;
      document.getElementById('stremioInstallBtn').href = stremioDeepLink;
      document.getElementById('stremioWebBtn').href = stremioWebLink;
    }

    function setTestQuery(q) {
      document.getElementById('testQueryInput').value = q;
      runTestSearch();
    }

    async function runTestSearch() {
      const q = document.getElementById('testQueryInput').value.trim();
      if (!q) return;

      const btn = document.getElementById('testSearchBtn');
      const box = document.getElementById('testResultsBox');
      const statusText = document.getElementById('testStatusText');
      const list = document.getElementById('testItemsList');

      btn.disabled = true;
      btn.innerText = 'Đang tìm...';
      box.classList.remove('hidden');
      statusText.innerText = 'Đang gửi truy vấn cào magnet...';
      list.innerHTML = '';

      try {
        const minSeeds = document.getElementById('minSeedsSelect').value;
        const quality = document.getElementById('qualitySelect').value;
        const sortBy = document.getElementById('sortSelect').value;
        const maxResults = document.getElementById('maxResultsSelect').value;

        const url = ORIGIN + '/api/knaben/search?q=' + encodeURIComponent(q) +
          '&minSeeds=' + minSeeds + '&qualityFilter=' + quality + '&sortBy=' + sortBy + '&maxResults=' + maxResults;

        const res = await fetch(url);
        const data = await res.json();

        btn.disabled = false;
        btn.innerText = 'Tìm Kiếm';

        if (!data.success) {
          statusText.innerText = 'Lỗi: ' + (data.error || 'Không thể cào dữ liệu');
          return;
        }

        const count = data.items ? data.items.length : 0;
        statusText.innerText = 'Tìm thấy ' + count + ' kết quả (Đã chuyển đổi: ' + (data.resolvedQuery || q) + '):';

        if (count === 0) {
          list.innerHTML = '<div class=\"text-slate-500 py-2\">Không tìm thấy torrent nào phù hợp với bộ lọc.</div>';
          return;
        }

        list.innerHTML = data.items.map(item => \`
          <div class=\"p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2\">
            <div class=\"space-y-1 flex-1\">
              <div class=\"font-semibold text-slate-200 line-clamp-1\">\${item.title}</div>
              <div class=\"flex gap-3 text-[11px] text-slate-400 font-mono\">
                <span class=\"text-emerald-400 font-bold\">🟢 \${item.seeds} seeds</span>
                <span>🔴 \${item.leeches} leeches</span>
                <span>💾 \${item.size}</span>
                <span class=\"text-purple-300\">[\${item.quality || 'HD'}]</span>
              </div>
            </div>
            <button onclick=\"navigator.clipboard.writeText('\${item.magnet}'); alert('Đã sao chép link magnet!')\" class=\"shrink-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold\">
              Copy Magnet
            </button>
          </div>
        \`).join('');
      } catch (err) {
        btn.disabled = false;
        btn.innerText = 'Tìm Kiếm';
        statusText.innerText = 'Lỗi kết nối mạng: ' + err.message;
      }
    }

    updateManifestUrl();
  </script>
</body>
</html>`;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const origin = url.origin;

    // 1. Root & Configure endpoints (/, /configure, /:config/configure)
    const isConfigurePath = pathname === '/' || pathname === '' || pathname === '/configure' || pathname.endsWith('/configure');
    if (isConfigurePath) {
      let configStr;
      const configConfigureMatch = pathname.match(/^\/([^/]+)\/configure$/);
      if (configConfigureMatch) {
        configStr = configConfigureMatch[1];
      }
      const initialConfig = parseConfig(configStr, url.searchParams);
      return new Response(getLandingHtml(origin, initialConfig), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
      });
    }

    // 2. Health check
    if (pathname === '/api/health') {
      return jsonResponse({
        status: 'online',
        service: 'Knaben Stremio Addon (Cloudflare Worker)',
        version: '2.2.0',
        timestamp: new Date().toISOString(),
        region: request.cf?.colo || 'Global',
      });
    }

    // 3. Manifest endpoints (/manifest.json or /:config/manifest.json)
    if (pathname === '/manifest.json') {
      const config = parseConfig(undefined, url.searchParams);
      return jsonResponse(getManifest(config));
    }

    const manifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json$/);
    if (manifestMatch) {
      const configStr = manifestMatch[1];
      const config = parseConfig(configStr, url.searchParams);
      return jsonResponse(getManifest(config));
    }

    // 4. Catalog endpoints (catch-all for Stremio catalog probes)
    if (pathname.includes('/catalog/')) {
      const rootCatalogMatch = pathname.match(/^\/catalog\/([^/]+)\/([^/]+?)(?:\/search=([^/]+))?\.json$/);
      const configCatalogMatch = pathname.match(/^\/([^/]+)\/catalog\/([^/]+)\/([^/]+?)(?:\/search=([^/]+))?\.json$/);

      if (rootCatalogMatch || configCatalogMatch) {
        let type;
        let id;
        let searchQuery;

        if (configCatalogMatch) {
          type = configCatalogMatch[2];
          id = configCatalogMatch[3];
          searchQuery = configCatalogMatch[4];
        } else {
          type = rootCatalogMatch[1];
          id = rootCatalogMatch[2];
          searchQuery = rootCatalogMatch[3];
        }

        const catalogData = await handleCatalogRequest(type, id, searchQuery);
        return jsonResponse(catalogData);
      }
      return jsonResponse({ metas: [] });
    }

    // 4b. Meta endpoints (catch-all for Stremio meta requests)
    if (pathname.includes('/meta/')) {
      return jsonResponse({ meta: null });
    }

    // 5. Streams endpoints (/stream/:type/:id.json or /:config/stream/:type/:id.json)
    const rootStreamMatch = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
    const configStreamMatch = pathname.match(/^\/([^/]+)\/stream\/([^/]+)\/([^/]+)\.json$/);

    if (rootStreamMatch || configStreamMatch) {
      let configStr;
      let type;
      let id;

      if (configStreamMatch) {
        configStr = configStreamMatch[1];
        type = configStreamMatch[2];
        id = configStreamMatch[3];
      } else {
        type = rootStreamMatch[1];
        id = rootStreamMatch[2];
      }

      const config = parseConfig(configStr, url.searchParams);

      try {
        const mediaMeta = await resolveStremioMedia(type, id);
        const searchQuery = mediaMeta.primaryQuery;

        if (!searchQuery || !searchQuery.trim()) {
          return jsonResponse({ streams: [] });
        }

        const torrents = await scrapeKnaben(searchQuery, config, mediaMeta);
        const streams = formatStremioStreams(torrents);

        return jsonResponse({ streams });
      } catch (err) {
        return jsonResponse({ streams: [] });
      }
    }

    // 6. Search REST API
    if (pathname === '/api/knaben/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) {
        return jsonResponse({ success: true, count: 0, items: [] });
      }

      const config = parseConfig(undefined, url.searchParams);
      try {
        const mediaMeta = await resolveStremioMedia('other', q);
        const searchQuery = mediaMeta.primaryQuery || q;
        const items = await scrapeKnaben(searchQuery, config, mediaMeta);
        return jsonResponse({
          success: true,
          query: q,
          resolvedQuery: searchQuery,
          count: items.length,
          config,
          items,
        });
      } catch (err) {
        return jsonResponse(
          { success: false, error: err.message || 'Lỗi khi cào magnet từ Knaben' },
          500
        );
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

