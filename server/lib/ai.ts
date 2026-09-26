import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { EVENT_TYPES, type EventDraft } from '../../shared/types';
import { dateKey } from './time';

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const Draft = z.object({
  title: z.string().describe('Short event title, e.g. "Leonor\'s birthday party" or "Dentist"'),
  type: z.enum(EVENT_TYPES),
  date: z.string().describe('YYYY-MM-DD'),
  allDay: z.boolean(),
  startTime: z.string().nullable().describe('HH:MM, 24h; null if all day'),
  endTime: z.string().nullable().describe('HH:MM, 24h; null if unknown'),
  location: z.string().nullable(),
  participants: z.array(z.string()).describe('Names of family members involved, exactly as listed'),
  bring: z.array(z.string()).describe('Things to bring or prepare, if mentioned'),
  notes: z.string().nullable().describe('Other useful details (RSVP, contact, dress code), short'),
});

export type ImageInput = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string };

/** Reads an invite, school note, appointment card or a typed sentence and proposes one event. */
export async function draftEvent(input: { text?: string; image?: ImageInput }, family: { name: string; role: string }[], now = new Date()): Promise<EventDraft> {
  const client = new Anthropic();
  const today = `${dateKey(now)} (${now.toLocaleDateString('en-GB', { weekday: 'long' })})`;
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) content.push({ type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: input.image.data } });
  content.push({
    type: 'text',
    text: [
      input.image ? 'This photo shows an invite, school note, appointment card or similar.' : `The parent typed: "${input.text}"`,
      input.image && input.text ? `The parent added: "${input.text}"` : '',
      'Propose one calendar event for our family planner.',
      `Today is ${today}, in Lisbon, Portugal. Resolve relative dates ("next Tuesday", "dia 3") to the next matching date.`,
      `Family: ${family.map((m) => `${m.name} (${m.role})`).join(', ')}. Only list participants that are clearly meant; a child's party invite is for the child named or addressed.`,
      'Text may be in Portuguese; write the title and notes in English, keep names and places as written.',
      `Types: ${EVENT_TYPES.join(', ')}. Birthday parties are "party"; doctors, dentists and vaccines are "medical".`,
    ].filter(Boolean).join('\n'),
  });

  let response;
  try {
    response = await client.messages.parse({
      // Pulling one event out of a note or screenshot is simple extraction: the small model is plenty.
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      output_config: { format: zodOutputFormat(Draft) },
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    throw new AiError(friendly(e));
  }
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new AiError("Couldn't read an event from that. Try a clearer photo or type it in.");
  }
  return response.parsed_output;
}

/** An error whose message can be shown to the parent as is. */
export class AiError extends Error {}

function friendly(e: unknown): string {
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) {
    return 'No Claude credit left: add credit at console.anthropic.com (Plans & Billing), then try again.';
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return 'The Claude API key was refused: it may have been revoked. Set a new one on ops.';
  }
  if (e instanceof Anthropic.RateLimitError) return 'Claude is busy right now. Try again in a minute.';
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the internet connection and try again.";
  console.error('ai draft:', e instanceof Error ? e.message : e);
  return 'Reading that failed. Try again in a moment.';
}
