// Colour-vision-deficiency helpers for the colour tests (S7). Machado, Oliveira & Fernandes 2009,
// severity 1.0, applied in linear RGB; distances in CIELAB (D65), ΔE*ab (CIE76).
export type Rgb = [number, number, number];
export type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';

const M: Record<Vision, number[][]> = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export const VISIONS = Object.keys(M) as Vision[];

export const hex = (h: string): Rgb => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
};

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Linear RGB (0–1) as seen with the given vision. */
export function simulateLinear(c: Rgb, v: Vision): Rgb {
  const l = c.map(lin);
  return M[v].map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))) as Rgb;
}

/** CIELAB of a colour under the given vision. */
export function lab(c: Rgb, v: Vision = 'normal'): Rgb {
  const [r, g, b] = simulateLinear(c, v);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export const deltaE = (a: Rgb, b: Rgb, v: Vision = 'normal') => {
  const p = lab(a, v);
  const q = lab(b, v);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
