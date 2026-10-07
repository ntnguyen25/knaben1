import * as cheerio from 'cheerio';

export interface TorrentItem {
  id: string;
  title: string;
  infoHash: string;
  magnet: string;
  seeds: number;
  leeches: number;
  size: string;
  sizeBytes?: number;
  category: string;
  date?: string;
  source: string;
  quality?: string;
  is4k?: boolean;
  is1080p?: boolean;
  is720p?: boolean;
  isHdr?: boolean;
  isRemux?: boolean;
}

export interface StremioStream {
  name: string;
  title: string;
  infoHash: string;
  externalUrl?: string;
  sources?: string[];
  behaviorHints?: {
    bingeGroup?: string;
    notFast?: boolean;
  };
}

export interface ScraperConfig {
  minSeeds?: number;
  maxResults?: number;
  qualityFilter?: string; // 'all' | '4k' | '1080p' | '720p'
  sortBy?: 'seeds' | 'size' | 'title';
}

export interface MediaResolution {
  primaryQuery: string;
  fallbackQuery?: string | null;
  season?: number;
  episode?: number;
  imdbId?: string;
  name?: string;
  year?: string;
}

/**
 * Resolves Stremio Media IDs (IMDb IDs like tt1375666 or tt0903747:1:1) into searchable titles via Cinemeta
 */
export async function resolveStremioMedia(type: string, id: string): Promise<MediaResolution> {
  const decodedId = decodeURIComponent(id).trim();

  // Non-IMDb custom ID (e.g. knaben:Inception or raw search)
  if (!decodedId.startsWith('tt')) {
    const cleanId = decodedId.replace(/^(knaben:|kna:)/i, '');
    return {
      primaryQuery: cleanId,
    };
  }

  const parts = decodedId.split(':');
  const imdbId = parts[0];
  const season = parts[1] ? parseInt(parts[1], 10) : undefined;
  const episode = parts[2] ? parseInt(parts[2], 10) : undefined;
  const cinemetaType = (type === 'series' || season !== undefined) ? 'series' : 'movie';

  try {
    const res = await fetch(`https://v3-cinemeta.strem.io/meta/${cinemetaType}/${imdbId}.json`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3500)
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
            year: meta.year
          };
        }

        const year = meta.year ? String(meta.year).slice(0, 4) : '';
        return {
          primaryQuery: year ? `${cleanName} ${year}` : cleanName,
          fallbackQuery: cleanName,
          imdbId,
          name: meta.name,
          year: meta.year
        };
      }
    }
  } catch (err) {
    console.warn('[Cinemeta resolve warning]', (err as Error).message);
  }

  // Fallback to IMDb ID if Cinemeta is unreachable
  return {
    primaryQuery: imdbId,
    imdbId,
    season,
    episode
  };
}

/**
 * Checks if a torrent title matches the requested TV series episode
 */
export function matchesEpisode(title: string, season?: number, episode?: number): boolean {
  if (season === undefined || episode === undefined) return true;
  const t = title.toUpperCase();

  // Direct episode matches: S01E01, S1E1, 1x01, 1x1
  const exactPatterns = [
    new RegExp(`S0*${season}[.\\s-]*E0*${episode}\\b`, 'i'),
    new RegExp(`\\b${season}X0*${episode}\\b`, 'i')
  ];

  if (exactPatterns.some(p => p.test(t))) {
    return true;
  }

  // Season packs (e.g. S01 Complete, Season 1) that do not explicitly name a different episode
  const isSeasonPack = new RegExp(`\\bS0*${season}\\b`, 'i').test(t) || new RegExp(`SEASON\\s*0*${season}\\b`, 'i').test(t);
  const mentionsOtherEpisode = new RegExp(`E(?!(0*${episode}\\b))\\d+`, 'i').test(t);

  if (isSeasonPack && !mentionsOtherEpisode) {
    return true;
  }

  return false;
}

/**
 * Parses size string like "2.45 GB", "850 MB" into bytes for sorting
 */
export function parseSizeBytes(sizeStr: string): number {
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

/**
 * Extracts quality tags from torrent title
 */
export function detectQualityTags(title: string) {
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

function base32ToHex(base32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (let i = 0; i < base32.length; i++) {
    const val = alphabet.indexOf(base32[i].toUpperCase());
    if (val === -1) return '';
    bits += val.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.substring(i, i + 4), 2).toString(16);
  }
  return hex.toLowerCase();
}

/**
 * Extracts InfoHash from magnet link (supports both 40-char hex and 32-char base32)
 */
export function extractInfoHash(magnet: string): string {
  if (!magnet) return '';
  const match40 = magnet.match(/urn:btih:([a-fA-F0-9]{40})/i);
  if (match40 && match40[1]) {
    return match40[1].toLowerCase();
  }
  const match32 = magnet.match(/urn:btih:([a-zA-Z2-7]{32})/i);
  if (match32 && match32[1]) {
    const converted = base32ToHex(match32[1]);
    if (converted && converted.length === 40) return converted;
  }
  return '';
}

/**
 * Parses Knaben HTML search table
 */
function parseKnabenHtml(htmlText: string): TorrentItem[] {
  if (!htmlText) return [];
  const $ = cheerio.load(htmlText);
  const items: TorrentItem[] = [];

  $('tr[data-id], tr.text-nowrap').each((_, element) => {
    const row = $(element);
    let infoHash = (row.attr('data-id') || '').toLowerCase();
    
    // Magnet link
    const magnetLink = row.find('a[href^="magnet:?"]').attr('href') ||
                       row.find('a[href*="urn:btih:"]').attr('href');
    
    if (!infoHash && magnetLink) {
      infoHash = extractInfoHash(magnetLink);
    }
    if (!infoHash) return;

    // Title
    let title = row.find('td.text-wrap a[title]').attr('title') ||
                row.find('a[href*="/details/"]').text().trim() ||
                row.find('td.text-wrap a').first().text().trim() ||
                row.find('a.title, .torrent-name').text().trim();

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
    if (!title) return;

    const finalMagnet = magnetLink || `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce`;

    // Size
    let sizeStr = row.find('td[title*="Bytes"]').first().text().trim();
    if (!sizeStr) {
      const rowText = row.text();
      const sizeMatch = rowText.match(/\b(\d+(?:\.\d+)?\s*(?:GiB|MiB|KiB|TiB|GB|MB|KB|TB))\b/i);
      if (sizeMatch) sizeStr = sizeMatch[1];
    }

    // Seeds & Leeches
    let seeds = 0;
    let leeches = 0;
    const colorTds = row.find('td[style*="color"]');
    if (colorTds.length >= 1) {
      seeds = parseInt($(colorTds[0]).text().trim().replace(/,/g, ''), 10) || 0;
      if (colorTds.length >= 2) {
        leeches = parseInt($(colorTds[1]).text().trim().replace(/,/g, ''), 10) || 0;
      }
    }

    if (seeds === 0) {
      const seedEl = row.find('.seeds, .seeders, .text-success, span.green, td.seeds');
      const leechEl = row.find('.leeches, .leechers, .text-danger, span.red, td.leeches');
      if (seedEl.length) seeds = parseInt(seedEl.text().trim().replace(/,/g, ''), 10) || 0;
      if (leechEl.length) leeches = parseInt(leechEl.text().trim().replace(/,/g, ''), 10) || 0;
    }

    if (seeds === 0) {
      const rowText = row.text();
      const seedLeechMatch = rowText.match(/(\d+)\s*[\/|]\s*(\d+)/) || rowText.match(/S:\s*(\d+).*?L:\s*(\d+)/i);
      if (seedLeechMatch) {
        seeds = parseInt(seedLeechMatch[1], 10) || 0;
        if (seedLeechMatch[2]) leeches = parseInt(seedLeechMatch[2], 10) || 0;
      }
    }

    // Date
    let dateStr = row.find('td[title*="-"]').first().text().trim();
    if (!dateStr) {
      const rowText = row.text();
      const dateMatch = rowText.match(/\b(\d{4}-\d{2}-\d{2})\b/i);
      if (dateMatch) dateStr = dateMatch[1];
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
      date: dateStr,
      source: 'Knaben.org',
      quality: quality.mainQuality,
      is4k: quality.is4k,
      is1080p: quality.is1080p,
      is720p: quality.is720p,
      isHdr: quality.isHdr,
      isRemux: quality.isRemux
    });
  });

  return items;
}

/**
 * Fetches HTML from single Knaben mirror and parses magnet links
 */
async function fetchSingleKnabenMirror(mirror: string, cleanQuery: string): Promise<TorrentItem[]> {
  try {
    const encoded = encodeURIComponent(cleanQuery);
    // Sort by seeds directly: /search/{query}/0/1/seeds
    const searchUrl = `${mirror}/search/${encoded}/0/1/seeds`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(4500)
    });

    if (res.ok) {
      const htmlText = await res.text();
      const items = parseKnabenHtml(htmlText);
      if (items.length > 0) return items;
    }

    // Fallback search endpoint: /search/index.php?q=...
    const fallbackUrl = `${mirror}/search/index.php?q=${encoded}`;
    const fallbackRes = await fetch(fallbackUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(3500)
    });

    if (fallbackRes.ok) {
      return parseKnabenHtml(await fallbackRes.text());
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Backup Torrent API (Apibay Engine)
 */
async function fetchBackupApibay(query: string): Promise<TorrentItem[]> {
  try {
    const cleanQ = encodeURIComponent(query);
    const url = `https://apibay.org/q.php?q=${cleanQ}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return [];
    
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((item: any) => item.info_hash && item.name && item.info_hash !== '0000000000000000000000000000000000000000')
      .map((item: any) => {
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
          isRemux: quality.isRemux
        };
      });
  } catch {
    return [];
  }
}

/**
 * Backup Torrent API (SolidTorrents)
 */
async function fetchSolidTorrents(query: string): Promise<TorrentItem[]> {
  try {
    const url = `https://solidtorrents.to/api/v1/search?q=${encodeURIComponent(query)}&category=all`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];

    const json = await res.json();
    if (!json || !Array.isArray(json.results)) return [];

    return json.results.map((t: any) => {
      const infoHash = t.infohash?.toLowerCase();
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
        isRemux: quality.isRemux
      };
    }).filter((item: TorrentItem) => item.infoHash);
  } catch {
    return [];
  }
}

/**
 * Scrapes Knaben mirrors and returns magnet torrent list
 */
export async function scrapeKnaben(
  query: string,
  config: ScraperConfig = {},
  mediaMeta?: { season?: number; episode?: number; imdbId?: string; fallbackQuery?: string | null }
): Promise<TorrentItem[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const minSeeds = config.minSeeds ?? 0;
  const maxResults = config.maxResults ?? 50;
  const qualityFilter = config.qualityFilter || 'all';
  const sortBy = config.sortBy || 'seeds';

  const items: TorrentItem[] = [];

  // Query primary Knaben + Apibay in parallel
  const searchTasks: Promise<TorrentItem[]>[] = [
    fetchSingleKnabenMirror('https://knaben.org', cleanQuery),
    fetchBackupApibay(cleanQuery)
  ];

  // If fallback query exists, add it to Knaben search
  if (mediaMeta?.fallbackQuery && mediaMeta.fallbackQuery !== cleanQuery) {
    searchTasks.push(fetchSingleKnabenMirror('https://knaben.org', mediaMeta.fallbackQuery));
  }

  // If IMDb ID exists, query Apibay with raw IMDb ID too
  if (mediaMeta?.imdbId && mediaMeta.imdbId !== cleanQuery) {
    searchTasks.push(fetchBackupApibay(mediaMeta.imdbId));
  }

  // SolidTorrents as additional backup
  searchTasks.push(fetchSolidTorrents(cleanQuery));

  const settled = await Promise.allSettled(searchTasks);
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      items.push(...res.value);
    }
  }

  // Deduplicate by infoHash and preserve higher seed count
  const uniqueMap = new Map<string, TorrentItem>();
  for (const item of items) {
    const existing = uniqueMap.get(item.infoHash);
    if (!existing || existing.seeds < item.seeds) {
      uniqueMap.set(item.infoHash, item);
    }
  }

  let finalItems = Array.from(uniqueMap.values());

  // Filter series episode if applicable
  if (mediaMeta?.season !== undefined && mediaMeta?.episode !== undefined) {
    finalItems = finalItems.filter(i => matchesEpisode(i.title, mediaMeta.season, mediaMeta.episode));
  }

  // Filter by minimum seeds
  if (minSeeds > 0) {
    finalItems = finalItems.filter(i => i.seeds >= minSeeds);
  }

  // Quality Filter
  if (qualityFilter === '4k') {
    finalItems = finalItems.filter(i => i.is4k);
  } else if (qualityFilter === '1080p') {
    finalItems = finalItems.filter(i => i.is1080p);
  } else if (qualityFilter === '720p') {
    finalItems = finalItems.filter(i => i.is720p);
  }

  // Sorting
  if (sortBy === 'size') {
    finalItems.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  } else if (sortBy === 'title') {
    finalItems.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    // Default sort by seeds descending (highest seeds first)
    finalItems.sort((a, b) => b.seeds - a.seeds);
  }

  return finalItems.slice(0, maxResults);
}

/**
 * Converts TorrentItem list into standard Stremio Stream objects with magnet links
 */
export function formatStremioStreams(items: TorrentItem[]): StremioStream[] {
  return items.map(item => {
    const seedBadge = item.seeds > 0 ? `🟢 ${item.seeds} seeds` : `⚪ 0 seeds`;
    const leechBadge = item.leeches > 0 ? `🔴 ${item.leeches} leeches` : '';
    const qualityTag = item.quality || (item.is4k ? '4K' : item.is1080p ? '1080p' : item.is720p ? '720p' : 'HD');

    const nameLine = `[${qualityTag}] Knaben ⚡\n👥 ${item.seeds} seeds`;
    const titleLine = `${item.title}\n💾 ${item.size} | ${seedBadge} ${leechBadge ? '| ' + leechBadge : ''}\n⚡ Knaben Magnet Stream`;

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
        `dht:${item.infoHash.toLowerCase()}`
      ],
      behaviorHints: {
        bingeGroup: `knaben-${qualityTag.toLowerCase()}`,
        notFast: false
      }
    };
  });
}

/**
 * Fetches popular trending movies and series for the Stremio Knaben Catalog
 */
export async function fetchCatalogMetas(type: string, id: string, searchQuery?: string): Promise<any[]> {
  const cinemetaType = type === 'series' ? 'series' : 'movie';
  let targetUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top`;
  if (searchQuery) {
    targetUrl += `/search=${encodeURIComponent(searchQuery)}.json`;
  } else {
    targetUrl += '.json';
  }

  try {
    const res = await fetch(targetUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      return data.metas || [];
    }
  } catch (err) {
    console.warn('[Catalog error]', (err as Error).message);
  }
  return [];
}


