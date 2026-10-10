import { describe, expect, it } from 'vitest';
import { digitalDate, omdbToRatings, pickTrailer, seasonAirs, toCard } from './tmdb';

const rd = (...countries: [string, [number, string][]][]) => ({
  results: countries.map(([iso, dates]) => ({ iso_3166_1: iso, release_dates: dates.map(([type, d]) => ({ type, release_date: `${d}T00:00:00.000Z` })) })),
});

describe('digital release date', () => {
  it('takes the US digital date (type 4), not the cinema one', () => {
    const r = rd(['US', [[3, '2026-07-18'], [4, '2026-09-30'], [5, '2026-11-02']]], ['GB', [[4, '2026-09-20']]]);
    expect(digitalDate(r)).toEqual({ date: '2026-09-30', region: 'US' });
  });

  it('takes the earliest US digital date when there are several', () => {
    expect(digitalDate(rd(['US', [[4, '2026-10-21'], [4, '2026-10-07']]]))).toEqual({ date: '2026-10-07', region: 'US' });
  });

  it('falls back to the earliest digital date anywhere when the US has none', () => {
    const r = rd(['US', [[3, '2026-08-01']]], ['FR', [[4, '2026-10-12']]], ['PT', [[4, '2026-10-01']]]);
    expect(digitalDate(r)).toEqual({ date: '2026-10-01', region: 'PT' });
  });

  it('is null without any digital release', () => {
    expect(digitalDate(rd(['US', [[3, '2026-08-01']]]))).toBeNull();
    expect(digitalDate(undefined)).toBeNull();
  });
});

describe('cards', () => {
  it('maps a TMDB film to a card', () => {
    const card = toCard('movie', { id: 550, title: 'Weapons', release_date: '2026-08-08', poster_path: '/p.jpg', vote_average: 7.456, genre_ids: [27, 9648] }, { date: '2026-09-09', label: null }, null);
    expect(card).toEqual({
      kind: 'movie', id: 550, title: 'Weapons', year: 2026, poster: 'https://image.tmdb.org/t/p/w342/p.jpg', rating: 7.5,
      date: '2026-09-09', dateLabel: null, genres: [27, 9648], status: null,
    });
  });

  it('maps a series (name, first air date) and a missing poster or rating', () => {
    const card = toCard('tv', { id: 9, name: 'Slow Horses', first_air_date: '2022-04-01', poster_path: null, vote_average: 0 }, { date: '2026-09-24', label: 'Season 5' }, { state: 'library', arrId: 3, text: 'In library' });
    expect(card).toMatchObject({ title: 'Slow Horses', year: 2022, poster: null, rating: null, dateLabel: 'Season 5', genres: [], status: { state: 'library' } });
  });
});

describe('series air dates', () => {
  const tv = {
    seasons: [
      { season_number: 0, air_date: '2026-10-01' },
      { season_number: 1, air_date: '2024-03-01' },
      { season_number: 2, air_date: '2026-09-20' },
      { season_number: 3, air_date: '2027-01-15' },
    ],
    last_episode_to_air: { air_date: '2026-10-04', season_number: 2, episode_number: 3 },
    next_episode_to_air: { air_date: '2026-10-11', season_number: 2, episode_number: 4 },
  };

  it('finds the latest season premiere, ignoring specials', () => {
    expect(seasonAirs(tv, '2026-10-10').premiered).toEqual({ date: '2026-09-20', label: 'Season 2' });
  });

  it('finds the next season premiere and the next episode', () => {
    const a = seasonAirs(tv, '2026-10-10');
    expect(a.premiere).toEqual({ date: '2027-01-15', label: 'Season 3' });
    expect(a.nextEpisode).toEqual({ date: '2026-10-11', label: 'S02E04' });
    expect(a.lastEpisode).toEqual({ date: '2026-10-04', label: 'S02E03' });
  });

  it('calls a first season a new series, and uses the next episode 1 when the season has no date yet', () => {
    const a = seasonAirs({ seasons: [{ season_number: 1, air_date: null }], next_episode_to_air: { air_date: '2026-11-03', season_number: 1, episode_number: 1 } }, '2026-10-10');
    expect(a.premiered).toBeNull();
    expect(a.premiere).toEqual({ date: '2026-11-03', label: 'New series' });
  });
});

describe('trailer and ratings', () => {
  it('prefers an official YouTube trailer over teasers and clips', () => {
    expect(
      pickTrailer([
        { key: 'clip', site: 'YouTube', type: 'Clip', official: true },
        { key: 'teaser', site: 'YouTube', type: 'Teaser', official: true },
        { key: 'fan', site: 'YouTube', type: 'Trailer', official: false },
        { key: 'vimeo', site: 'Vimeo', type: 'Trailer', official: true },
        { key: 'official', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en' },
      ]),
    ).toBe('official');
    expect(pickTrailer([{ key: 'clip', site: 'YouTube', type: 'Featurette' }])).toBeNull();
  });

  it('keeps the IMDb, Rotten Tomatoes and Metacritic scores from OMDb', () => {
    expect(omdbToRatings([{ Source: 'Internet Movie Database', Value: '7.8/10' }, { Source: 'Rotten Tomatoes', Value: '91%' }, { Source: 'Metacritic', Value: 'N/A' }])).toEqual([
      { source: 'IMDb', value: '7.8/10' },
      { source: 'Rotten Tomatoes', value: '91%' },
    ]);
  });
});
