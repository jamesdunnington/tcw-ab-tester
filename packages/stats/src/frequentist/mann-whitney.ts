import { normalCdf } from "../math/normal.js";

export interface MannWhitneyResult {
  /** U statistic for sample A. */
  u: number;
  z: number;
  /** Two-tailed p-value (normal approximation with tie correction). */
  p: number;
}

/**
 * Mann-Whitney U test: rank-based, distribution-free companion to Welch's
 * t-test. Robust to the heavy-tailed shape engagement metrics usually have.
 */
export function mannWhitneyU(a: number[], b: number[]): MannWhitneyResult {
  const nA = a.length;
  const nB = b.length;
  if (nA === 0 || nB === 0) throw new RangeError("mannWhitneyU: both samples must be non-empty");

  const tagged = [
    ...a.map((value) => ({ value, group: "a" as const })),
    ...b.map((value) => ({ value, group: "b" as const })),
  ].sort((x, y) => x.value - y.value);

  // Average ranks within tied groups.
  const ranks = new Array<number>(tagged.length);
  const tieGroupSizes: number[] = [];
  let i = 0;
  while (i < tagged.length) {
    let j = i;
    while (j + 1 < tagged.length && tagged[j + 1].value === tagged[i].value) j++;
    const avgRank = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    if (j - i + 1 > 1) tieGroupSizes.push(j - i + 1);
    i = j + 1;
  }

  let rankSumA = 0;
  tagged.forEach((t, idx) => {
    if (t.group === "a") rankSumA += ranks[idx];
  });

  const uA = rankSumA - (nA * (nA + 1)) / 2;
  const n = nA + nB;
  const tieCorrection = tieGroupSizes.reduce((acc, t) => acc + (t ** 3 - t), 0);
  const meanU = (nA * nB) / 2;
  const varianceU = ((nA * nB) / 12) * (n + 1 - tieCorrection / (n * (n - 1)));
  const sd = Math.sqrt(Math.max(varianceU, 0));
  if (sd === 0) return { u: uA, z: 0, p: 1 };

  const diff = uA - meanU;
  const z = (diff - Math.sign(diff) * 0.5) / sd; // continuity correction toward the mean
  return { u: uA, z, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))) };
}
