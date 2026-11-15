// Calendar PNG export. Calendar.tsx registers the mounted chart and its colour range here.
import type * as echarts from 'echarts/core';
import { RAMP, ZERO_COLOR } from './option';

export const live: { chart: echarts.ECharts | null; range: { vmin: number; vmax: number } } = { chart: null, range: { vmin: 0, vmax: 1 } };

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
  const head = 84;
  const foot = 96;
  const cv = document.createElement('canvas');
  cv.width = img.width + 2 * pad;
  cv.height = img.height + head + foot;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#1f1f1f';
  g.font = '600 30px system-ui, sans-serif';
  g.fillText(title, pad, 42);
  g.fillStyle = '#4a4a4a';
  g.font = '22px system-ui, sans-serif';
  g.fillText(subtitle, pad, 72);
  g.drawImage(img, pad, head);
  // legend: zero swatch + log ramp with end labels
  const y = head + img.height + 16;
  g.fillStyle = ZERO_COLOR;
  g.fillRect(pad, y, 22, 18);
  g.fillStyle = '#4a4a4a';
  g.font = '20px system-ui, sans-serif';
  g.fillText('0', pad + 30, y + 16);
  const rx = pad + 60;
  const rw = 360;
  const grad = g.createLinearGradient(rx, 0, rx + rw, 0);
  RAMP.forEach((col, i) => grad.addColorStop(i / (RAMP.length - 1), col));
  g.fillStyle = grad;
  g.fillRect(rx, y, rw, 18);
  const { vmin, vmax } = live.range;
  const lab = (lv: number) => Math.round(10 ** lv - 1).toLocaleString('en-US');
  g.fillStyle = '#4a4a4a';
  g.fillText(lab(vmin), rx, y + 42);
  const hi = lab(vmax);
  g.fillText(hi, rx + rw - g.measureText(hi).width, y + 42);
  g.fillText('FCD / month (log scale, this area)', rx + rw + 16, y + 16);
  g.fillStyle = '#6b6b6b';
  g.font = '18px system-ui, sans-serif';
  g.fillText(footer, pad, cv.height - 14);
  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
}
