import { useState } from 'react';
import type { DocsMeta, PaperlessDetail } from '../../../shared/types';

// Company expenses in the Docs tab. When a receipt's QR code can't be read, Paperless has no amount for it (and maybe
// only a placeholder date, tagged "Date missing"): they're put in by hand here and saved together with the tags.

/** Whether these tags make it a company expense: the Expense tag or one under it (Restaurants, Travel…). */
export function isExpense(tagIds: number[], meta: DocsMeta) {
  if (meta.expenseTag === null) return false;
  const parent = new Map(meta.tags.map((t) => [t.id, t.parent]));
  const under = (id: number | null | undefined, depth = 0): boolean => id != null && depth < 10 && (id === meta.expenseTag || under(parent.get(id), depth + 1));
  return tagIds.some((id) => under(id));
}

/** "12", "12.5", "12,50 €" → 12.5; null when it isn't an amount. */
export function parseAmount(s: string) {
  const m = s.trim().replace(/\s|€/g, '').replace(',', '.').match(/^\d+(\.\d{1,2})?$/);
  return m && Number(m[0]) > 0 ? Number(m[0]) : null;
}

export type ExpenseInput = { date: string; amount: string };

/** What's in Paperless now; a placeholder date isn't offered as the answer. */
export const expenseInput = (doc: PaperlessDetail): ExpenseInput => ({ date: doc.dateMissing ? '' : doc.created, amount: doc.amount === null ? '' : doc.amount.toFixed(2) });

/** The date and amount to send with the tags: only what was entered or changed. */
export function expenseChange(doc: PaperlessDetail, input: ExpenseInput): { created?: string; amount?: number } {
  const amount = parseAmount(input.amount);
  return {
    ...(input.date && (input.date !== doc.created || doc.dateMissing) ? { created: input.date } : {}),
    ...(amount !== null && amount !== doc.amount ? { amount } : {}),
  };
}

/** Date and amount of a company expense. Open by itself when either is missing (the QR wasn't read). */
export function ExpenseFields({ doc, value, onChange }: { doc: PaperlessDetail; value: ExpenseInput; onChange: (v: ExpenseInput) => void }) {
  const missing = doc.amount === null || doc.dateMissing;
  const [open, setOpen] = useState(missing);
  if (!open) {
    return <button type="button" className="link small doc-expense-open" onClick={() => setOpen(true)}>Change the date or amount</button>;
  }
  return (
    <div className="doc-expense">
      {missing && <p className="muted small">The QR code wasn't read: enter the date and the amount from the receipt.</p>}
      <div className="when">
        <label>
          <span>Date</span>
          <input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} aria-invalid={doc.dateMissing && !value.date} />
        </label>
        <label>
          <span>Amount (€)</span>
          <input value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="0.00" aria-invalid={!parseAmount(value.amount)} />
        </label>
      </div>
    </div>
  );
}
