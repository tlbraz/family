import { BP_HIGH, isHigh, partOfDay, type BpReading } from '../../shared/bp';
import { addDays, dateKey, parseDateKey } from './time';

// The doctor report: one self-contained, printable page (chart as inline SVG, no scripts needed).

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const longDate = (key: string) => parseDateKey(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const dayRow = (key: string) => parseDateKey(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

interface Avg {
  systolic: number;
  diastolic: number;
  n: number;
}

export function average(list: Pick<BpReading, 'systolic' | 'diastolic'>[]): Avg | null {
  if (!list.length) return null;
  const sum = list.reduce((a, r) => ({ s: a.s + r.systolic, d: a.d + r.diastolic }), { s: 0, d: 0 });
  return { systolic: Math.round(sum.s / list.length), diastolic: Math.round(sum.d / list.length), n: list.length };
}

const bp = (a: Pick<BpReading, 'systolic' | 'diastolic'>) => `${a.systolic}/${a.diastolic}`;

function period(from: string, to: string) {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (from === to) return longDate(from);
  if (a.getFullYear() !== b.getFullYear()) return `${longDate(from)} – ${longDate(to)}`;
  const left = a.getMonth() === b.getMonth() ? String(a.getDate()) : a.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return `${left} – ${longDate(to)}`;
}

function tile(label: string, a: Avg | null, sub?: string) {
  if (!a) return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value muted">—</div><div class="tile-sub">no readings</div></div>`;
  const high = isHigh(a);
  return `<div class="tile"><div class="tile-label">${label}</div>
    <div class="tile-value">${bp(a)}<span class="unit">mmHg</span></div>
    <div class="tile-sub">${high ? '<span class="flag">▲ above 135/85</span> · ' : ''}${sub ?? `${a.n} reading${a.n === 1 ? '' : 's'}`}</div></div>`;
}

/** Line chart of the daily averages, with every day of the period on the x axis. */
function chart(days: string[], byDay: Map<string, BpReading[]>): string {
  const W = 720, H = 280, L = 44, R = 78, T = 16, B = 44;
  const all = [...byDay.values()].flat();
  const lo = Math.min(60, Math.floor((Math.min(...all.map((r) => r.diastolic)) - 5) / 10) * 10);
  const hi = Math.max(150, Math.ceil((Math.max(...all.map((r) => r.systolic)) + 5) / 10) * 10);
  const x = (i: number) => L + (days.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (days.length - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const out: string[] = [];

  // Grid and y axis labels (every 10 or 20 mmHg).
  const step = hi - lo > 100 ? 20 : 10;
  for (let v = lo; v <= hi; v += step) {
    out.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick${v % 20 ? ' minor' : ''}" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  }
  // Reference lines at the home-measurement threshold.
  for (const [v, name] of [[BP_HIGH.systolic, '135'], [BP_HIGH.diastolic, '85']] as const) {
    out.push(`<line class="ref" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ref-label" x="${L + 6}" y="${y(v) - 5}">${name}</text>`);
  }
  // X labels: about 7 of them, always the first and last day.
  const every = Math.max(1, Math.ceil(days.length / 7));
  days.forEach((d, i) => {
    if (i % every !== 0 && i !== days.length - 1) return;
    if (i === days.length - 1 && i % every !== 0 && i - Math.floor(i / every) * every < every / 2) return; // too close to the previous label
    const label = parseDateKey(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    out.push(`<text class="tick" x="${x(i)}" y="${H - B + 20}" text-anchor="middle">${label}</text>`);
  });
  out.push(`<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`);

  // Forgot-meds days: a small marker under the axis.
  days.forEach((d, i) => {
    if ((byDay.get(d) ?? []).some((r) => r.tags.includes('Forgot meds'))) {
      out.push(`<path class="meds" d="M${x(i)} ${H - B + 26} l5 8 h-10 z"><title>${esc(dayRow(d))}: forgot meds</title></path>`);
    }
  });

  // The two series: a line through the days with readings (gaps where none), and a marker per day.
  for (const key of ['systolic', 'diastolic'] as const) {
    const pts = days.map((d, i) => ({ d, i, a: average(byDay.get(d) ?? []) })).filter((p) => p.a);
    let path = '';
    let prev = -2;
    for (const p of pts) {
      path += `${p.i === prev + 1 ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.a![key]).toFixed(1)} `;
      prev = p.i;
    }
    out.push(`<path class="line ${key}" d="${path.trim()}"/>`);
    for (const p of pts) {
      const list = byDay.get(p.d)!;
      const tip = `${dayRow(p.d)}: ${list.map((r) => `${bp(r)} at ${hhmm(r.at)}`).join(', ')}`;
      out.push(`<g class="pt"><circle class="dot ${key}" cx="${x(p.i)}" cy="${y(p.a![key])}" r="4"/><circle class="hit" cx="${x(p.i)}" cy="${y(p.a![key])}" r="11"/><title>${esc(tip)}</title></g>`);
    }
    // Direct label at the last point.
    const last = pts[pts.length - 1];
    if (last) out.push(`<text class="direct ${key}" x="${x(last.i) + 10}" y="${y(last.a![key]) + (key === 'systolic' ? -8 : 16)}">${key === 'systolic' ? 'Systolic' : 'Diastolic'}</text>`);
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily average blood pressure over the period, systolic and diastolic, with the 135/85 limits">${out.join('')}</svg>`;
}

export function bpReport({ name, from, to, readings, now }: { name: string; from: string; to: string; readings: BpReading[]; now: Date }): string {
  const days: string[] = [];
  for (let d = parseDateKey(from); dateKey(d) <= to; d = addDays(d, 1)) days.push(dateKey(d));
  const byDay = new Map<string, BpReading[]>();
  for (const r of [...readings].sort((a, b) => a.at.localeCompare(b.at))) {
    const k = dateKey(new Date(r.at));
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const mornings = readings.filter((r) => partOfDay(r.at) === 'morning');
  const evenings = readings.filter((r) => partOfDay(r.at) === 'evening');
  const high = readings.filter(isHigh).length;

  // How each tag compares with the readings that had no tags at all.
  const tags = [...new Set(readings.flatMap((r) => r.tags))];
  const plain = average(readings.filter((r) => r.tags.length === 0));
  const tagRows = tags
    .map((t) => ({ t, a: average(readings.filter((r) => r.tags.includes(t))), days: new Set(readings.filter((r) => r.tags.includes(t)).map((r) => dateKey(new Date(r.at)))).size }))
    .sort((a, b) => b.a!.n - a.a!.n)
    .map(({ t, a, days: nDays }) => {
      const diff = plain ? `${a!.systolic - plain.systolic >= 0 ? '+' : '−'}${Math.abs(a!.systolic - plain.systolic)} / ${a!.diastolic - plain.diastolic >= 0 ? '+' : '−'}${Math.abs(a!.diastolic - plain.diastolic)}` : '—';
      return `<tr><td><span class="tag">${esc(t)}</span></td><td class="num">${nDays}</td><td class="num">${a!.n}</td><td class="num ${isHigh(a!) ? 'hi' : ''}">${bp(a!)}</td><td class="num muted">${diff}</td></tr>`;
    });

  const cell = (list: BpReading[]) =>
    list.length
      ? list.map((r) => `<div class="reading${isHigh(r) ? ' hi' : ''}"><b>${bp(r)}</b>${isHigh(r) ? '<span class="up" title="at or above 135/85">▲</span>' : ''} <span class="time">${hhmm(r.at)}</span></div>`).join('')
      : '<span class="muted">—</span>';
  const logRows = days
    .filter((d) => byDay.has(d))
    .map((d) => {
      const list = byDay.get(d)!;
      const tagsOf = [...new Set(list.flatMap((r) => r.tags))].map((t) => `<span class="tag">${esc(t)}</span>`).join(' ');
      const notes = [...new Set(list.map((r) => r.note).filter(Boolean))].map((n) => `<span class="note">${esc(n!)}</span>`).join(' ');
      return `<tr><td class="date">${dayRow(d)}</td><td>${cell(list.filter((r) => partOfDay(r.at) === 'morning'))}</td><td>${cell(list.filter((r) => partOfDay(r.at) === 'evening'))}</td><td>${tagsOf} ${notes}</td></tr>`;
    });

  const body = readings.length
    ? `
  <section class="tiles">
    ${tile('Average', average(readings), `${readings.length} readings on ${byDay.size} day${byDay.size === 1 ? '' : 's'}`)}
    ${tile('Mornings', average(mornings))}
    ${tile('Evenings', average(evenings))}
    <div class="tile"><div class="tile-label">At or above 135/85</div><div class="tile-value">${high}<span class="unit">of ${readings.length}</span></div><div class="tile-sub">${Math.round((100 * high) / readings.length)}% of readings</div></div>
  </section>

  <section>
    <h2>Daily average</h2>
    <div class="legend"><span><i class="swatch systolic"></i>Systolic</span><span><i class="swatch diastolic"></i>Diastolic</span><span><i class="dash"></i>135/85 limit</span>${readings.some((r) => r.tags.includes('Forgot meds')) ? '<span><i class="tri"></i>Forgot meds</span>' : ''}</div>
    ${chart(days, byDay)}
  </section>

  ${tagRows.length ? `<section>
    <h2>Tags</h2>
    <div class="scroll"><table class="tags-table"><thead><tr><th>Tag</th><th class="num">Days</th><th class="num">Readings</th><th class="num">Average</th><th class="num" title="Compared with readings that have no tag${plain ? ` (${bp(plain)})` : ''}">vs. no tag</th></tr></thead><tbody>${tagRows.join('')}</tbody></table></div>${plain ? `<p class="small muted">“vs. no tag” compares with the readings that have no tag at all (average ${bp(plain)}).</p>` : ''}
  </section>` : ''}

  <section>
    <h2>All readings</h2>
    <div class="scroll"><table class="log"><thead><tr><th>Day</th><th>Morning</th><th>Evening</th><th>Tags &amp; notes</th></tr></thead><tbody>${logRows.join('')}</tbody></table></div>
  </section>`
    : `<p class="empty">No readings between these dates.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blood pressure · ${esc(name)} · ${esc(period(from, to))}</title>
<style>
:root { color-scheme: light; --bg: #ffffff; --panel: #f6f5f2; --ink: #1c1b22; --muted: #6b6975; --line: #e4e2dc; --grid: #eeece7;
  --sys: #2a78d6; --dia: #eb6834; --hi: #b42318; --tag: #efeef9; --tag-ink: #3f3a78; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --bg: #16151b; --panel: #211f28; --ink: #f3f2f7; --muted: #a9a6b4;
  --line: #34313e; --grid: #2a2833; --sys: #3987e5; --dia: #d95926; --hi: #ff8a80; --tag: #2e2b45; --tag-ink: #d6d2ff; } }
@media print { :root { color-scheme: light; --bg: #fff; --panel: #f6f5f2; --ink: #1c1b22; --muted: #6b6975; --line: #e4e2dc; --grid: #eeece7;
  --sys: #2a78d6; --dia: #eb6834; --hi: #b42318; --tag: #efeef9; --tag-ink: #3f3a78; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
main { max-width: 820px; margin: 0 auto; padding: 28px 20px 40px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid var(--ink); padding-bottom: 14px; margin-bottom: 20px; }
.eyebrow { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
h1 { font-size: 1.9rem; margin: 2px 0 4px; letter-spacing: -0.01em; }
.period { color: var(--muted); font-weight: 600; }
.print { font: inherit; font-weight: 800; border: 0; border-radius: 20px; padding: 9px 16px; background: var(--ink); color: var(--bg); cursor: pointer; white-space: nowrap; }
h2 { font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 28px 0 10px; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.tile { background: var(--panel); border-radius: 14px; padding: 12px 14px; }
.tile-label { font-size: 0.8rem; font-weight: 700; color: var(--muted); }
.tile-value { font-size: 1.7rem; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.unit { font-size: 0.8rem; font-weight: 700; color: var(--muted); margin-left: 5px; }
.tile-sub { font-size: 0.8rem; color: var(--muted); }
.flag, .hi, .up { color: var(--hi); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.85rem; color: var(--muted); font-weight: 600; margin-bottom: 4px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
.swatch.systolic { background: var(--sys); } .swatch.diastolic { background: var(--dia); }
.dash { width: 16px; border-top: 2px dashed var(--muted); display: inline-block; }
.tri { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid var(--muted); display: inline-block; }
.chart { width: 100%; height: auto; display: block; }
.chart .grid { stroke: var(--grid); stroke-width: 1; }
.chart .axis { stroke: var(--line); stroke-width: 1; }
.chart .tick { fill: var(--muted); font-size: 11px; font-weight: 600; }
.chart .ref { stroke: var(--muted); stroke-width: 1.2; stroke-dasharray: 5 4; }
.chart .ref-label { fill: var(--muted); font-size: 11px; font-weight: 700; }
.chart .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart .line.systolic { stroke: var(--sys); } .chart .line.diastolic { stroke: var(--dia); }
.chart .dot { stroke: var(--bg); stroke-width: 2; } .chart .dot.systolic { fill: var(--sys); } .chart .dot.diastolic { fill: var(--dia); }
.chart .hit { fill: transparent; }
.chart .pt:hover .dot { r: 6; }
.chart .direct { font-size: 12px; font-weight: 800; fill: var(--ink); }
.chart .meds { fill: var(--muted); }
table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
th { text-align: left; font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); font-weight: 800; padding: 6px 8px; border-bottom: 2px solid var(--line); }
td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--panel) 60%, transparent); }
tr { break-inside: avoid; }
thead { display: table-header-group; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.date { white-space: nowrap; font-weight: 700; }
.reading { white-space: nowrap; font-variant-numeric: tabular-nums; }
.reading.hi b { color: var(--hi); }
.up { font-size: 0.7rem; margin-left: 2px; }
.time { color: var(--muted); font-size: 0.85em; }
.tag { display: inline-block; background: var(--tag); color: var(--tag-ink); border-radius: 8px; padding: 1px 8px; font-size: 0.8rem; font-weight: 700; margin: 1px 0; }
.note { color: var(--muted); font-style: italic; font-size: 0.85rem; }
.muted { color: var(--muted); }
.scroll { overflow-x: auto; }
.small { font-size: 0.8rem; margin: 6px 0 0; }
.empty { color: var(--muted); font-size: 1.1rem; padding: 40px 0; text-align: center; }
footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.8rem; }
@media (max-width: 640px) { .chart .tick, .chart .ref-label { font-size: 17px; } .chart .direct, .chart .minor { display: none; } .tag { white-space: nowrap; } .tags-table th, .tags-table td { padding-inline: 5px; } .tags-table th { letter-spacing: 0; } .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } h1 { font-size: 1.5rem; } .log td:first-child, .log th:first-child { padding-left: 4px; } }
@media print { .print { display: none; } main { padding: 0; max-width: none; } body { font-size: 12.5px; } @page { margin: 14mm 12mm; } section { break-inside: auto; } .tiles, .chart { break-inside: avoid; } }
</style></head>
<body><main>
  <header>
    <div>
      <div class="eyebrow">Home blood pressure</div>
      <h1>${esc(name)}</h1>
      <div class="period">${esc(period(from, to))}</div>
    </div>
    <button class="print" onclick="window.print()">Save as PDF</button>
  </header>
  ${body}
  <footer>Measured at home. Morning = before noon. Averages include every reading in the period.
  Dashed lines: 135/85 mmHg, the usual threshold for home measurements (ESH 2023). Generated ${esc(now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}.</footer>
</main></body></html>`;
}
