import { describe, expect, it } from 'vitest';
import { dueForSearch, etaText, movieStatus, seriesStatus, type RadarrMovie } from './arr';

const now = new Date('2026-10-10T15:00:00');
const movie = (m: Partial<RadarrMovie>): RadarrMovie => ({ id: 1, tmdbId: 550, title: 'Weapons', monitored: true, hasFile: false, ...m });

describe('film status', () => {
  it('is not in the library when Radarr does not have it', () => {
    expect(movieStatus(undefined, [], now)).toEqual({ state: 'none', arrId: null, text: 'Not in the library' });
  });

  it('is downloading while it is in the queue, with progress and ETA', () => {
    const st = movieStatus(movie({}), [{ movieId: 1, size: 1000, sizeleft: 570, estimatedCompletionTime: '2026-10-10T21:30:00' }, { movieId: 2, size: 5 }], now);
    expect(st).toEqual({ state: 'downloading', arrId: 1, text: 'Downloading 43 % · ETA 21:30', progress: 0.43 });
  });

  it('says when a finished download waits to be imported', () => {
    expect(movieStatus(movie({}), [{ movieId: 1, size: 10, sizeleft: 0, trackedDownloadState: 'importPending' }], now).text).toBe('Downloaded · waiting to import');
  });

  it('is in the library once it has a file', () => {
    expect(movieStatus(movie({ hasFile: true }), [], now)).toMatchObject({ state: 'library', text: 'In library' });
  });

  it('is wanted until its digital release, then looked for', () => {
    expect(movieStatus(movie({ digitalRelease: '2026-11-14T00:00:00Z' }), [], now).text).toBe('Wanted — out on 14 Nov');
    expect(movieStatus(movie({ digitalRelease: '2026-10-01T00:00:00Z' }), [], now).text).toBe('Wanted — looking for a copy');
    expect(movieStatus(movie({}), [], now).text).toBe('Wanted — no digital date yet');
  });

  it('is not wanted when unmonitored, but can still be deleted', () => {
    expect(movieStatus(movie({ monitored: false }), [], now)).toEqual({ state: 'none', arrId: 1, text: 'Not in the library' });
  });
});

describe('series status', () => {
  const s = { id: 7, tvdbId: 70, title: 'Slow Horses', monitored: true };
  it('counts the episodes it has', () => {
    expect(seriesStatus({ ...s, statistics: { episodeFileCount: 8, episodeCount: 10 } }, [], now).text).toBe('In library · 8 of 10 episodes');
    expect(seriesStatus({ ...s, statistics: { episodeFileCount: 10, episodeCount: 10 } }, [], now).text).toBe('In library');
  });

  it('shows several episodes downloading together', () => {
    const q = [{ seriesId: 7, size: 100, sizeleft: 50 }, { seriesId: 7, size: 100, sizeleft: 100 }];
    expect(seriesStatus({ ...s, statistics: { episodeFileCount: 3 } }, q, now)).toMatchObject({ state: 'downloading', text: 'Downloading 2 episodes 25 %', progress: 0.25 });
  });

  it('is wanted until the next episode airs', () => {
    expect(seriesStatus({ ...s, nextAiring: '2026-11-03T02:00:00Z' }, [], now)).toMatchObject({ state: 'wanted', text: 'Wanted — next episode on 3 Nov' });
  });
});

describe('ETA', () => {
  it('shows the time today and the weekday later', () => {
    expect(etaText('2026-10-10T18:05:00', now)).toBe('ETA 18:05');
    expect(etaText('2026-10-11T09:00:00', now)).toBe('ETA Sun 09:00');
    expect(etaText('2026-10-10T09:00:00', now)).toBeNull();
    expect(etaText(undefined, now)).toBeNull();
  });
});

describe('daily search for wanted films', () => {
  it('asks for monitored films without a file that are out digitally, once a day', () => {
    const movies = [
      movie({ id: 1, digitalRelease: '2026-10-01T00:00:00Z' }),
      movie({ id: 2, digitalRelease: '2026-12-01T00:00:00Z' }), // not out yet
      movie({ id: 3, digitalRelease: '2026-09-01T00:00:00Z', hasFile: true }),
      movie({ id: 4, digitalRelease: '2026-09-01T00:00:00Z', monitored: false }),
      movie({ id: 5, digitalRelease: '2026-10-09T00:00:00Z' }), // already searched today
      movie({ id: 6 }), // no date
    ];
    expect(dueForSearch(movies, { 5: '2026-10-10', 1: '2026-10-09' }, '2026-10-10')).toEqual([1]);
  });
});
