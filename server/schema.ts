import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Fridge notes: short messages for the whole family on the home page.
export const notes = pgTable('notes', {
  id: serial('id').primaryKey(),
  text: text('text').notNull(),
  author: text('author'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
