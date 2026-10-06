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
  infoHash?: string;
  url?: string;
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
  const is720p = t.includes('720P') || t.includes('HD') && !is1080p && !is4k;
  const isHdr = t.includes('HDR') || t.includes('VISION') || t.includes('DV') || t.includes('HDR10');
  const isRemux = t.includes('REMUX');

  let mainQuality = 'SD';
  if (is4k) mainQuality = '4K 2160p';
  else if (is1080p) mainQuality = '1080p';
  else if (is720p) mainQuality = '720p';

  return { is4k, is1080p, is720p, isHdr, isRemux, mainQuality };
}

/**
 * Extracts InfoHash from magnet link
 */
export function extractInfoHash(magnet: string): string {
  if (!magnet) return '';
  const match = magnet.match(/urn:btih:([a-fA-F0-9]{40})/i) || magnet.match(/urn:btih:([a-zA-Z2-7]{32})/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return '';
}

/**
 * Scrapes Knaben mirrors and returns magnet torrent list
 */
export async function scrapeKnaben(
  query: string,
  config: ScraperConfig = {}
): Promise<TorrentItem[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const minSeeds = config.minSeeds ?? 0;
  const maxResults = config.maxResults ?? 50;
  const qualityFilter = config.qualityFilter || 'all';
  const sortBy = config.sortBy || 'seeds';

  const encodedQuery = encodeURIComponent(cleanQuery);
  const items: TorrentItem[] = [];

  // Query Knaben mirrors + Fallback torrent indexes in parallel
  const mirrors = [
    fetchSingleKnabenMirror('https://knaben.org', encodedQuery),
    fetchSingleKnabenMirror('https://knaben.eu', encodedQuery),
    fetchBackupApibay(cleanQuery),
    fetchSolidTorrents(cleanQuery)
  ];

  const settled = await Promise.allSettled(mirrors);
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      items.push(...res.value);
    }
  }

  // Deduplicate by infoHash and preserve the record with higher seed count
  const uniqueMap = new Map<string, TorrentItem>();
  for (const item of items) {
    const existing = uniqueMap.get(item.infoHash);
    if (!existing || existing.seeds < item.seeds) {
      uniqueMap.set(item.infoHash, item);
    }
  }

  let finalItems = Array.from(uniqueMap.values());

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
 * Fetches HTML from single Knaben mirror and parses magnet links
 */
async function fetchSingleKnabenMirror(mirror: string, encodedQuery: string): Promise<TorrentItem[]> {
  try {
    const searchUrl = `${mirror}/q/${encodedQuery}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(4500)
    });

    if (!res.ok) return [];

    const htmlText = await res.text();
    if (!htmlText) return [];

    const $ = cheerio.load(htmlText);
    const mirrorItems: TorrentItem[] = [];

    $('tr, .torrent-item, .result-row, tr.table-row').each((_, element) => {
      const row = $(element);
      const magnetLink = row.find('a[href^="magnet:?"]').attr('href') || row.find('a[href*="urn:btih:"]').attr('href');
      
      if (!magnetLink) return;

      const infoHash = extractInfoHash(magnetLink);
      if (!infoHash) return;

      let title = row.find('a[href*="/details/"]').text().trim() ||
                  row.find('a.title, .torrent-name, td:nth-child(2) a, td:nth-child(1) a').first().text().trim();

      if (!title) {
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

      const rowText = row.text();
      let seeds = 0;
      let leeches = 0;

      const seedEl = row.find('.seeds, .seeders, .text-success, span.green, td.seeds');
      const leechEl = row.find('.leeches, .leechers, .text-danger, span.red, td.leeches');

      if (seedEl.length) seeds = parseInt(seedEl.text().trim().replace(/,/g, ''), 10) || 0;
      if (leechEl.length) leeches = parseInt(leechEl.text().trim().replace(/,/g, ''), 10) || 0;

      if (seeds === 0) {
        const seedLeechMatch = rowText.match(/(\d+)\s*[\/|]\s*(\d+)/) || rowText.match(/S:\s*(\d+).*?L:\s*(\d+)/i);
        if (seedLeechMatch) {
          seeds = parseInt(seedLeechMatch[1], 10) || 0;
          if (seedLeechMatch[2]) leeches = parseInt(seedLeechMatch[2], 10) || 0;
        }
      }

      let sizeStr = '';
      const sizeMatch = rowText.match(/\b(\d+(?:\.\d+)?\s*(?:GiB|MiB|KiB|TiB|GB|MB|KB|TB))\b/i);
      if (sizeMatch) sizeStr = sizeMatch[1];

      // Date match if available
      let dateStr = '';
      const dateMatch = rowText.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d+\s+(?:days?|hours?|mins?)\s+ago)\b/i);
      if (dateMatch) dateStr = dateMatch[1];

      const quality = detectQualityTags(title);

      mirrorItems.push({
        id: `knaben-${infoHash}`,
        title,
        infoHash,
        magnet: magnetLink,
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

    return mirrorItems;
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
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
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
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
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
 * Converts TorrentItem list into standard Stremio Stream objects with magnet links
 */
export function formatStremioStreams(items: TorrentItem[]): StremioStream[] {
  return items.map(item => {
    const seedBadge = item.seeds > 0 ? `🟢 ${item.seeds} seeds` : `⚪ 0 seeds`;
    const leechBadge = `🔴 ${item.leeches} leeches`;
    const qualityTag = item.quality || (item.is4k ? '4K' : item.is1080p ? '1080p' : item.is720p ? '720p' : 'HD');

    const nameLine = `[${qualityTag}] Knaben ⚡\n👥 ${item.seeds} seeds`;
    const titleLine = `${item.title}\n💾 ${item.size} | ${seedBadge} | ${leechBadge}\n⚡ Knaben Magnet Stream`;

    return {
      name: nameLine,
      title: titleLine,
      infoHash: item.infoHash,
      url: item.magnet,
      behaviorHints: {
        bingeGroup: `knaben-${qualityTag.toLowerCase()}`,
        notFast: false
      }
    };
  });
}
