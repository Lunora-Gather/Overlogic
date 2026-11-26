import { GameDatabase } from '../core/GameDatabase.js?v=20260725-4';
import { damageSourceLabel } from '../systems/PostBattleReportBuilder.js?v=20260725-4';
import { entity, t } from '../i18n/I18n.js?v=20260725-4';

const PADDING = 14;
const ROW_HEIGHT = 27;

function leadingEntries(values) {
  return Object.entries(values || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
}

function seriesHeight(rows) {
  return 38 + ROW_HEIGHT * Math.max(1, rows.length);
}

function drawSeries(g, { title, empty, color, rows }, x, y, width, font) {
  const innerWidth = width - 2 * PADDING;
  g.textAlign = 'left';
  g.fillStyle = color;
  g.font = `650 13px ${font}`;
  g.fillText(title, x + PADDING, y + 19, innerWidth);

  g.font = `12px ${font}`;
  g.fillStyle = '#adc0d0';
  if (!rows.length) {
    g.fillText(empty, x + PADDING, y + 46, innerWidth);
    return;
  }

  const labelWidth = Math.min(138, Math.round(innerWidth * 0.43));
  const valueWidth = Math.max(...rows.map(row => g.measureText(row.label).width));
  const barWidth = Math.max(0, innerWidth - labelWidth - valueWidth - 20);
  const barX = x + PADDING + labelWidth + 10;
  const maxValue = Math.max(1, ...rows.map(row => row.value));
  for (const [index, row] of rows.entries()) {
    const rowY = y + 46 + index * ROW_HEIGHT;
    g.textAlign = 'left';
    g.fillStyle = '#adc0d0';
    g.fillText(row.name, x + PADDING, rowY, labelWidth);
    g.fillStyle = '#243447';
    g.fillRect(barX, rowY - 3, barWidth, 6);
    g.fillStyle = color;
    g.fillRect(barX, rowY - 3, barWidth * row.value / maxValue, 6);
    g.textAlign = 'right';
    g.fillStyle = '#eef8ff';
    g.fillText(row.label, x + width - PADDING, rowY);
  }
}

export function drawStatsChart(canvas, report) {
  if (!canvas || !report || !canvas.clientWidth) return;
  const g = canvas.getContext('2d');
  const width = canvas.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  const stacked = width < 560;
  const actionRows = leadingEntries(report.action_usage).map(([id, value]) => ({
    name: entity('action', id, GameDatabase.getAction(id)?.displayName),
    label: `×${value}`,
    value,
  }));
  const damageRows = leadingEntries(report.damage_by_source).map(([source, value]) => ({
    name: damageSourceLabel(source),
    label: t('chart.damageShort', { value: Math.round(value) }),
    value,
  }));
  const actionHeight = seriesHeight(actionRows);
  const damageHeight = seriesHeight(damageRows);
  const height = stacked ? actionHeight + damageHeight : Math.max(actionHeight, damageHeight);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height + 2}px`;

  g.scale(dpr, dpr);
  g.fillStyle = '#0d1724';
  g.fillRect(0, 0, width, height);
  g.fillStyle = '#26384a';
  if (stacked) g.fillRect(0, actionHeight, width, 1);
  else g.fillRect(width / 2, 0, 1, height);

  const font = getComputedStyle(canvas).fontFamily;
  const colWidth = stacked ? width : width / 2;
  g.textBaseline = 'middle';
  drawSeries(g, {
    title: t('chart.actionUsage'), empty: t('chart.noActions'), color: '#78e2d4', rows: actionRows,
  }, 0, 0, colWidth, font);
  drawSeries(g, {
    title: t('chart.damageSource'), empty: t('chart.noDamage'), color: '#ff9b88', rows: damageRows,
  }, stacked ? 0 : colWidth, stacked ? actionHeight : 0, colWidth, font);
}
