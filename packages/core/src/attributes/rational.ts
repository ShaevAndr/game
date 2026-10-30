export interface Rational { numerator: bigint; denominator: bigint }
const absolute = (value: bigint) => value < 0n ? -value : value;
function gcd(left: bigint, right: bigint): bigint {
  left = absolute(left); right = absolute(right);
  while (right) { const remainder = left % right; left = right; right = remainder; }
  return left || 1n;
}
export function rational(numerator: bigint | number, denominator: bigint | number = 1): Rational {
  const n = BigInt(numerator), d = BigInt(denominator);
  if (d <= 0n) throw new Error('Знаменатель должен быть положительным');
  const divisor = gcd(n, d);
  return { numerator: n / divisor, denominator: d / divisor };
}
export function add(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}
export function multiply(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}
export function boundedFloor(value: Rational, min: number, max: number): number {
  if (value.numerator <= BigInt(min) * value.denominator) return min;
  if (value.numerator >= BigInt(max) * value.denominator) return max;
  const result = value.numerator / value.denominator;
  return Number(value.numerator < 0n && value.numerator % value.denominator ? result - 1n : result);
}
