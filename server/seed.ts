import type { Db } from './db';
import { members } from './schema';

// The family, on first start. Everything is editable later on the Family page.
const FAMILY = [
  { name: 'Tiago', role: 'parent', color: '#4c7be8' },
  { name: 'Catarina', role: 'parent', color: '#d9548a' },
  { name: 'Gonçalo', role: 'kid', color: '#1f9a71' },
  { name: 'Matilde', role: 'kid', color: '#8a5cd6' },
  { name: 'Guilherme', role: 'kid', color: '#c97714' },
] as const;

export async function seed(db: Db) {
  const existing = await db.select({ id: members.id }).from(members).limit(1);
  if (existing.length) return;
  await db.insert(members).values(FAMILY.map((m, sort) => ({ ...m, sort })));
  console.log('seeded family members');
}
