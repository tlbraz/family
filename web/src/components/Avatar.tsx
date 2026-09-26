import type { Member } from '../../../shared/types';

// One letter, or two when someone else starts with the same letter (Gonçalo / Guilherme → Go / Gu).
let everyone: Member[] = [];
export const setFamily = (list: Member[]) => (everyone = list);
export function initials(name: string): string {
  const first = name.slice(0, 1).toUpperCase();
  const clash = everyone.some((m) => m.name !== name && m.name.slice(0, 1).toUpperCase() === first);
  return clash ? first + name.slice(1, 2).toLowerCase() : first;
}

export function Avatar({ member, size = 28 }: { member: Member; size?: number }) {
  const text = initials(member.name);
  return (
    <span className="avatar" style={{ background: member.color, width: size, height: size, fontSize: size * (text.length > 1 ? 0.36 : 0.42) }} title={member.name}>
      {text}
    </span>
  );
}

export function AvatarStack({ ids, members, size = 26 }: { ids: number[]; members: Member[]; size?: number }) {
  const list = ids.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => !!m);
  if (list.length && list.length === members.length) return <span className="pill everyone">Everyone</span>;
  return (
    <span className="stack">
      {list.map((m) => (
        <Avatar key={m.id} member={m} size={size} />
      ))}
    </span>
  );
}
