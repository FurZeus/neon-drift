/** 83.4567 → "1:23.457" */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = Math.floor(rest);
  const ms = Math.floor((rest - whole) * 1000);
  return `${m}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** -0.42 → "−0.420", 1.2 → "+1.200" */
export function formatDelta(d: number): string {
  const sign = d < 0 ? '−' : '+';
  return `${sign}${Math.abs(d).toFixed(3)}`;
}
