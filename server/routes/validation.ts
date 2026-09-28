import { z } from 'zod';
import { DOCUMENT_KINDS, type DocumentKind, EVENT_TYPES } from '../../shared/types';

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
    reminders: z.array(z.number().int().min(-1440).max(10080)).max(5).default([]),
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

const optional = (max: number) => z.string().trim().max(max).nullable().transform((s) => s || null);

export const DocumentsSchema = z
  .array(
    z
      .object({
        kind: z.enum(Object.keys(DOCUMENT_KINDS) as [DocumentKind, ...DocumentKind[]]),
        label: optional(40),
        number: z.string().trim().max(60),
        expires: date.nullable(),
        link: optional(500).refine((l) => !l || /^https?:\/\/\S+$/.test(l), 'The link must start with http:// or https://'),
        note: optional(200),
      })
      .refine((d) => d.number || d.link || d.expires || d.note, 'A document needs at least a number or a link'),
  )
  .max(30);

// A small picture, already cropped and shrunk by the browser.
export const PhotoSchema = z.object({
  photo: z
    .string()
    .max(400_000, 'The picture is too big')
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, 'Not a picture'),
});

export const BpInputSchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    systolic: z.number().int().min(60).max(260),
    diastolic: z.number().int().min(30).max(160),
    tags: z.array(z.string().trim().min(1).max(30)).max(12),
    note: z.string().trim().max(300).nullable(),
  })
  .refine((r) => r.systolic > r.diastolic, { message: 'The top number must be higher than the bottom one', path: ['systolic'] });

export const BpSettingsSchema = z.object({ tracking: z.boolean(), telegramId: z.string().trim().max(40).nullable() });

export const RangeSchema = z.object({ from: date, to: date });

/** First validation message, phrased for people. */
export function problem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input';
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}
