// Calendar PNG export. Calendar.tsx registers the mounted chart and its colour range here.
import type * as echarts from 'echarts/core';
import { RAMP, ZERO_COLOR } from './option';

export const live: { chart: echarts.ECharts | null; range: { vmin: number; vmax: number } } = { chart: null, range: { vmin: 0, vmax: 1 } };

/** Greedy word wrap for canvas text. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Calendar PNG: the ECharts canvas (getDataURL, 2× pixel ratio) framed with a title, the colour legend
 * and a source line, so the image stands on its own.
 */
export async function calendarPng(title: string, subtitle: string, footer: string): Promise<Blob | null> {
  const c = live.chart;
  if (!c || c.isDisposed()) return null;
  const img = new Image();
  img.src = c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
  await img.decode();
  const pad = 32;
  const width = Math.max(img.width + 2 * pad, 1100);
  const textW = width - 2 * pad;
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d')!;
  const fonts = { title: '600 30px system-ui, sans-serif', sub: '22px system-ui, sans-serif', legend: '20px system-ui, sans-serif', foot: '18px system-ui, sans-serif' };
  g.font = fonts.title;
  const titleL = wrap(g, title, textW);
  g.font = fonts.sub;
  const subL = wrap(g, subtitle, textW);
  g.font = fonts.foot;
  const footL = wrap(g, footer, textW);
  const head = 20 + titleL.length * 38 + subL.length * 28 + 12;
  const legendH = 70;
  cv.width = width;
  cv.height = head + img.height + legendH + footL.length * 24 + 16;

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, cv.width, cv.height);
  let y = 20;
  g.fillStyle = '#1f1f1f';
  g.font = fonts.title;
  for (const l of titleL) g.fillText(l, pad, (y += 38) - 8);
  g.fillStyle = '#4a4a4a';
  g.font = fonts.sub;
  for (const l of subL) g.fillText(l, pad, (y += 28) - 6);
  g.drawImage(img, pad, head);

  // legend: zero swatch + log ramp with end labels
  y = head + img.height + 16;
  g.fillStyle = ZERO_COLOR;
  g.fillRect(pad, y, 22, 18);
  g.fillStyle = '#4a4a4a';
  g.font = fonts.legend;
  g.fillText('0', pad + 30, y + 16);
  const rx = pad + 60;
  const rw = 360;
  const grad = g.createLinearGradient(rx, 0, rx + rw, 0);
  RAMP.forEach((col, i) => grad.addColorStop(i / (RAMP.length - 1), col));
  g.fillStyle = grad;
  g.fillRect(rx, y, rw, 18);
  const { vmin, vmax } = live.range;
  const lab = (lv: number) => Math.max(1, Math.round(10 ** lv - 1)).toLocaleString('en-US');
  g.fillStyle = '#4a4a4a';
  g.fillText(`≤ ${lab(vmin)}`, rx, y + 42);
  const hi = lab(vmax);
  g.fillText(hi, rx + rw - g.measureText(hi).width, y + 42);
  g.fillText('FCD / month (log scale, this area)', rx + rw + 16, y + 16);

  g.fillStyle = '#6b6b6b';
  g.font = fonts.foot;
  y = head + img.height + legendH;
  for (const l of footL) g.fillText(l, pad, (y += 24) - 4);
  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
}
