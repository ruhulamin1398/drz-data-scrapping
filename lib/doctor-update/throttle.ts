// Shared outbound-request throttle: max 1 request per `minGapMs` per key,
// serialized across concurrent callers in this process via a promise chain.
// (Render worker is a single process; concurrent update runs queue behind it
// instead of bursting the DRX backend / source site.)
const chains = new Map<string, Promise<void>>();
const lastAt = new Map<string, number>();

export async function throttle(key: string, minGapMs: number): Promise<void> {
  const prev = chains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const cur = prev.then(() => new Promise<void>((res) => { release = res; }));
  chains.set(key, cur.catch(() => {}));
  await prev.catch(() => {});
  try {
    const wait = minGapMs - (Date.now() - (lastAt.get(key) ?? 0));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  } finally {
    lastAt.set(key, Date.now());
    release();
  }
}
