import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Arrival, arrivalBatcher, arrivalMessage, hookTokenMatches, parseArrHook } from './arrivals';

const radarr = {
  eventType: 'Download',
  isUpgrade: false,
  movie: { id: 12, title: 'Weapons', year: 2025, tmdbId: 1078605, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/p.jpg' }] },
  remoteMovie: { tmdbId: 1078605, title: 'Weapons', year: 2025 },
  movieFile: { id: 301, relativePath: 'Weapons (2025).mkv' },
};
const sonarr = (eps: [number, number][], file = 1) => ({
  eventType: 'Download',
  isUpgrade: false,
  series: { id: 7, title: 'Slow Horses & Co', tvdbId: 393199, tmdbId: 95480, year: 2022 },
  episodes: eps.map(([seasonNumber, episodeNumber]) => ({ seasonNumber, episodeNumber })),
  episodeFile: { id: file },
});

describe('Radarr/Sonarr webhook', () => {
  it('reads an imported film', () => {
    expect(parseArrHook(radarr)).toEqual({
      batch: 'movie:12', kind: 'movie', title: 'Weapons', year: 2025, tmdbId: 1078605,
      poster: 'https://image.tmdb.org/t/p/original/p.jpg', episodes: [], keys: ['arrived:movie:1078605:301'], upgrade: false, titleKey: 'arrived:movie:1078605:',
    });
  });

  it('reads imported episodes', () => {
    expect(parseArrHook(sonarr([[2, 5]], 88))).toMatchObject({ batch: 'series:7', kind: 'tv', tmdbId: 95480, episodes: [{ season: 2, episode: 5 }], keys: ['arrived:series:393199:88'] });
  });

  it('answers tests, flags upgrades and ignores other events', () => {
    expect(parseArrHook({ eventType: 'Test' })).toBe('test');
    expect(parseArrHook({ ...radarr, isUpgrade: true })).toMatchObject({ upgrade: true, titleKey: expect.stringMatching(/^arrived:movie:\d+:$/) });
    expect(parseArrHook(radarr)).toMatchObject({ upgrade: false });
    expect(parseArrHook({ ...radarr, eventType: 'Grab' })).toBeNull();
    expect(parseArrHook(null)).toBeNull();
    expect(parseArrHook({ eventType: 'Download' })).toBeNull();
  });

  it('checks the token', () => {
    process.env.ARR_WEBHOOK_TOKEN = 'a-long-shared-secret';
    expect(hookTokenMatches('a-long-shared-secret')).toBe(true);
    expect(hookTokenMatches('nope')).toBe(false);
    expect(hookTokenMatches(undefined)).toBe(false);
    delete process.env.ARR_WEBHOOK_TOKEN;
    expect(hookTokenMatches('')).toBe(false);
  });
});

describe('arrival messages', () => {
  const tv = (eps: [number, number][]) => parseArrHook(sonarr(eps)) as Arrival;

  it('names the film and year', () => {
    expect(arrivalMessage(parseArrHook(radarr) as Arrival)).toBe('🎬 <b>Weapons (2025)</b> is ready on Jellyfin');
  });

  it('names one episode, escaping the title', () => {
    expect(arrivalMessage(tv([[2, 5]]))).toBe('📺 <b>Slow Horses &amp; Co</b> S02E05 is ready');
  });

  it('counts several episodes, with the range', () => {
    expect(arrivalMessage(tv([[2, 5], [2, 6], [2, 7], [2, 8]]))).toBe('📺 <b>Slow Horses &amp; Co</b>: 4 new episodes are ready (S02E05–E08)');
    expect(arrivalMessage(tv([[1, 10], [2, 1]]))).toBe('📺 <b>Slow Horses &amp; Co</b>: 2 new episodes are ready (S01E10, S02E01)');
  });
});

describe('batching episodes', () => {
  afterEach(() => vi.useRealTimers());

  it('sends episodes of a series that arrive within minutes as one batch', () => {
    vi.useFakeTimers();
    const sent: Arrival[] = [];
    const b = arrivalBatcher((a) => sent.push(a), 120_000, 600_000);
    b.add(parseArrHook(sonarr([[2, 6]], 2)) as Arrival);
    vi.advanceTimersByTime(60_000);
    b.add(parseArrHook(sonarr([[2, 5]], 1)) as Arrival);
    b.add(parseArrHook(sonarr([[2, 6]], 2)) as Arrival); // the same file again
    b.add(parseArrHook(radarr) as Arrival);
    vi.advanceTimersByTime(119_000);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(sent.map((a) => a.batch)).toEqual(['series:7', 'movie:12']);
    expect(sent[0]!.episodes).toEqual([{ season: 2, episode: 5 }, { season: 2, episode: 6 }]);
    expect(sent[0]!.keys).toEqual(['arrived:series:393199:2', 'arrived:series:393199:1']);
    expect(b.size).toBe(0);
  });

  it('does not hold a batch longer than the maximum while episodes keep coming', () => {
    vi.useFakeTimers();
    const sent: Arrival[] = [];
    const b = arrivalBatcher((a) => sent.push(a), 120_000, 300_000);
    for (let i = 1; i <= 6; i++) {
      b.add(parseArrHook(sonarr([[1, i]], i)) as Arrival);
      vi.advanceTimersByTime(60_000);
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]!.episodes).toHaveLength(5);
  });
});
