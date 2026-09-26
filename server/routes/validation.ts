import { z } from 'zod';
import { EVENT_TYPES } from '../../shared/types';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const EventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    type: z.enum(EVENT_TYPES),
    allDay: z.boolean(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    location: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    participants: z.array(z.number().int()).max(20),
    bring: z.array(z.object({ text: z.string().trim().min(1).max(80), done: z.boolean() })).max(30),
    repeat: z
      .object({
        freq: z.enum(['weekly', 'monthly', 'yearly']),
        interval: z.number().int().min(1).max(52),
        weekdays: z.array(z.number().int().min(0).max(6)).optional(),
        until: date.nullable().optional(),
      })
      .nullable(),
  })
  .refine((e) => new Date(e.end) > new Date(e.start), { message: 'The end must be after the start', path: ['end'] });

export const TaskInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  due: date,
  memberId: z.number().int().nullable(),
});

export const MemberInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  role: z.enum(['parent', 'kid']),
  color,
  birthday: date.nullable(),
  googleEmail: z.string().trim().email().nullable(),
});

// A small picture, already cropped and shrunk by the browser.
export const PhotoSchema = z.object({
  photo: z
    .string()
    .max(400_000, 'The picture is too big')
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, 'Not a picture'),
});

export const RangeSchema = z.object({ from: date, to: date });

/** First validation message, phrased for people. */
export function problem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input';
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}
