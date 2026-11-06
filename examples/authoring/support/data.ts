/** Owned synthetic data only; no credentials, customer records or leased data. */
export interface DraftData {
  title: string;
  tags: string[];
}

/** Each call returns fresh values; no clock, randomness or global counters. */
export function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    title: overrides.title ?? "Synthetic rehearsal",
    tags: [...(overrides.tags ?? ["synthetic"])],
  };
}
