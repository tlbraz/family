import { describe, expect, it } from 'vitest';
import { sectionOf, splitItems } from './grocery';

describe('splitItems', () => {
  it('splits a spoken or typed list', () => {
    expect(splitItems('leite, pão e 6 ovos')).toEqual(['Leite', 'Pão', '6 ovos']);
    expect(splitItems('milk and bread\nbananas; bananas')).toEqual(['Milk', 'Bread', 'Bananas']);
    expect(splitItems('  ,  ')).toEqual([]);
  });
});

describe('sectionOf', () => {
  it('guesses the aisle in Portuguese and English', () => {
    expect(sectionOf('Leite meio-gordo')).toBe('Dairy & eggs');
    expect(sectionOf('6 ovos')).toBe('Dairy & eggs');
    expect(sectionOf('Maçãs')).toBe('Fruit & veg');
    expect(sectionOf('Pão de forma')).toBe('Bakery');
    expect(sectionOf('Peito de frango')).toBe('Meat & fish');
    expect(sectionOf('Papel higiénico')).toBe('Household');
    expect(sectionOf('Gelado de morango')).toBe('Frozen');
    expect(sectionOf('Toothpaste')).toBe('Personal care');
    expect(sectionOf('Arroz')).toBe('Pantry');
    expect(sectionOf('Batatas fritas')).toBe('Pantry');
    expect(sectionOf('Pilhas AA')).toBe('Household');
    expect(sectionOf('Presente para a Leonor')).toBe('Other');
  });
});
