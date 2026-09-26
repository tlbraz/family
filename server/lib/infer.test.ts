import { describe, expect, it } from 'vitest';
import { cleanTitle, extractBring, inferPeople, inferType } from './infer';

const family = [
  { id: 1, name: 'Tiago', role: 'parent' },
  { id: 2, name: 'Catarina', role: 'parent' },
  { id: 3, name: 'Gonçalo', role: 'kid' },
  { id: 4, name: 'Matilde', role: 'kid' },
  { id: 5, name: 'Guilherme', role: 'kid' },
];

describe('inferType', () => {
  it('reads Portuguese and English keywords', () => {
    expect(inferType('Dentista Guilherme', null)).toBe('medical');
    expect(inferType('Festa de anos da Leonor', null)).toBe('party');
    expect(inferType('Treino de futebol', null)).toBe('sports');
    expect(inferType('Reunião de pais', null)).toBe('school');
    expect(inferType('Almoço nos avós', null)).toBe('family');
    expect(inferType('Something', 'Consulta no pediatra')).toBe('medical');
    expect(inferType('🎉 Leonor', null)).toBe('party');
    expect(inferType('Pick up parcel', null)).toBe('other');
  });
});

describe('inferPeople', () => {
  it('finds names, accents and short forms', () => {
    expect(inferPeople('Dentista Goncalo', family)).toEqual([3]);
    expect(inferPeople('Gui - natação', family)).toEqual([5]);
    expect(inferPeople('Matilde e Catarina: festa', family).sort()).toEqual([2, 4]);
    expect(inferPeople('Os miúdos: vacinas', family).sort()).toEqual([3, 4, 5]);
    expect(inferPeople('Jantar todos', family)).toEqual([1, 2, 3, 4, 5]);
    expect(inferPeople('Matemática teste', family)).toEqual([]); // "Mat…" inside a longer word is not Matilde
  });
});

describe('extractBring', () => {
  it('turns a Bring/Levar line into a checklist and keeps the rest as notes', () => {
    expect(extractBring('RSVP to Ana\nLevar: prenda, fato de banho e toalha')).toEqual({
      bring: [
        { text: 'prenda', done: false },
        { text: 'fato de banho', done: false },
        { text: 'toalha', done: false },
      ],
      notes: 'RSVP to Ana',
    });
    expect(extractBring('Bring: gift<br>Party at 4')).toEqual({ bring: [{ text: 'gift', done: false }], notes: 'Party at 4' });
  });
});

it('cleans our emoji prefix', () => {
  expect(cleanTitle('⚽ Football')).toBe('Football');
});
