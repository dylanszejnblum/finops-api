// Sum in integer cents so float drift never shows up in totals.
export const sumMoney = (values: number[]) =>
  values.reduce((cents, v) => cents + Math.round(v * 100), 0) / 100;

export const round2 = (v: number) => Math.round(v * 100) / 100;

export function totalsByCurrency<T extends { currency: string }>(
  items: T[],
  fields: (keyof T)[],
): Record<string, number | string>[] {
  const groups = Map.groupBy(items, (i) => i.currency);
  return [...groups].map(([currency, rows]) => ({
    currency,
    ...Object.fromEntries(
      fields.map((f) => [f, sumMoney(rows.map((r) => Number(r[f])))]),
    ),
  }));
}
