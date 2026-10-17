export function estimateCost(ratePerThousand, quantity) {
  if (!Number.isFinite(ratePerThousand) || !Number.isFinite(quantity) || ratePerThousand < 0 || quantity < 0) {
    throw new RangeError('Rate and quantity must be finite, non-negative numbers.');
  }
  return Math.round(ratePerThousand * quantity / 10) / 100;
}
