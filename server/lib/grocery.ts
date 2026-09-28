// Groceries: split what was typed or said into items, and guess the supermarket section
// from Portuguese / English keywords so the list follows a walk through the shop.

// Shop walking order; frozen last so it stays cold.
export const SECTIONS = ['Fruit & veg', 'Bakery', 'Meat & fish', 'Dairy & eggs', 'Pantry', 'Drinks', 'Household', 'Personal care', 'Frozen', 'Other'] as const;
export type Section = (typeof SECTIONS)[number];

// Comma-separated; a phrase ("papel higiénico") beats single words, and Frozen beats everything
// ("gelado de morango" is frozen, not fruit).
const WORDS: [Section, string][] = [
  ['Frozen', 'congelado, congelada, congelados, congeladas, gelado, gelados, douradinhos, ice cream, frozen, pizza'],
  ['Fruit & veg', 'fruta, maçã, maca, banana, laranja, pera, uva, morango, kiwi, limão, limao, melão, melao, melancia, ananás, ananas, manga, abacate, tomate, alface, cebola, alho, batata, cenoura, courgette, curgete, pepino, pimento, brócolos, brocolos, espinafre, couve, cogumelo, abóbora, abobora, legumes, salada, salsa, coentros, fruit, apple, orange, lemon, grape, strawberry, tomato, lettuce, onion, garlic, potato, carrot, cucumber, pepper, broccoli, spinach, mushroom, avocado, veg, herbs'],
  ['Bakery', 'pão, pao, pães, paes, broa, baguete, croissant, bolo, tosta, padaria, bread, bun, rolls, cake'],
  ['Meat & fish', 'carne, frango, peru, porco, vaca, bife, fiambre, presunto, chouriço, chourico, salsicha, bacon, hambúrguer, hamburguer, peixe, bacalhau, salmão, salmao, pescada, dourada, robalo, camarão, camarao, polvo, lulas, meat, chicken, turkey, pork, beef, ham, sausage, fish, salmon, prawns, shrimp'],
  ['Dairy & eggs', 'leite, iogurte, queijo, manteiga, natas, ovo, ovos, requeijão, requeijao, milk, yogurt, yoghurt, cheese, butter, cream, egg, eggs'],
  ['Drinks', 'água, agua, sumo, refrigerante, cerveja, vinho, café, cafe, chá, cha, coca-cola, water, juice, soda, beer, wine, coffee, tea'],
  ['Household', 'detergente, lixívia, lixivia, papel higiénico, papel higienico, papel de cozinha, rolo de cozinha, guardanapos, esponja, sacos do lixo, sacos de lixo, pilhas, pilha, lâmpada, lampada, amaciador, detergent, bleach, toilet paper, kitchen roll, napkins, sponge, bin bags, batteries, light bulb, softener, dishwasher tablets'],
  ['Personal care', 'champô, champo, gel de banho, sabonete, pasta de dentes, escova de dentes, desodorizante, fraldas, toalhitas, creme, pensos, shampoo, shower gel, soap, toothpaste, toothbrush, deodorant, nappies, diapers, wipes, plasters, razor'],
  ['Pantry', 'arroz, massa, esparguete, farinha, açúcar, acucar, sal, azeite, óleo, oleo, vinagre, feijão, feijao, grão, grao, lentilhas, cereais, aveia, mel, compota, chocolate, atum, lata, molho, ketchup, maionese, mostarda, especiarias, bolachas, batatas fritas, snacks, frutos secos, rice, pasta, spaghetti, flour, sugar, salt, olive oil, oil, vinegar, beans, chickpeas, lentils, cereal, oats, honey, jam, tuna, sauce, mayo, mustard, spices, biscuits, cookies, crisps, chips, nuts'],
];

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const INDEX = WORDS.flatMap(([section, list]) => list.split(',').map((k) => ({ section, key: normal(k) })));

/** Best guess of where in the shop this is. */
export function sectionOf(item: string): Section {
  const text = ` ${normal(item)} `;
  // Whole words, allowing a plural "s" ("maçãs", "tomates", "apples").
  const hits = INDEX.filter(({ key }) => text.includes(` ${key} `) || text.includes(` ${key}s `) || text.includes(` ${key}es `));
  if (hits.some((h) => h.section === 'Frozen')) return 'Frozen';
  const words = (k: string) => k.split(' ').length;
  hits.sort((a, b) => words(b.key) - words(a.key) || b.key.length - a.key.length);
  return hits[0]?.section ?? 'Other';
}

/** "leite, pão e 6 ovos" → ["leite", "pão", "6 ovos"]. */
export function splitItems(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(/[,;\n]+|\s+(?:e|and|mais)\s+/i)
    .map((s) => s.trim().replace(/\.$/, '').slice(0, 80))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .slice(0, 30);
}
