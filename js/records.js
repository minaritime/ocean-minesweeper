// 판 기록: 도전 횟수와 클리어 기록. 항상 새 객체를 돌려준다.

export const MAX_CLEARS_PER_LEVEL = 200;

/** @returns {{ plays: Record<string, number>, clears: Array<{level:string,time:number,at:number,mines:number,cells:number}> }} */
export function emptyHistory() {
  return { plays: {}, clears: [] };
}

/** 저장소에서 읽은 값이 망가져 있어도 쓸 수 있는 모양으로 고친다 */
export function normalizeHistory(raw) {
  if (!raw || typeof raw !== 'object') return emptyHistory();
  const plays = raw.plays && typeof raw.plays === 'object' ? { ...raw.plays } : {};
  const clears = Array.isArray(raw.clears)
    ? raw.clears.filter((c) => c && typeof c.level === 'string' && Number.isFinite(c.time) && Number.isFinite(c.at))
    : [];
  return { plays, clears };
}

export function addPlay(history, level) {
  return { ...history, plays: { ...history.plays, [level]: (history.plays[level] || 0) + 1 } };
}

/** 한 난이도에 기록이 너무 많아지면 가장 느린 기록부터 버린다 */
export function addClear(history, entry) {
  const clears = [...history.clears, entry];
  const same = clears.filter((c) => c.level === entry.level);
  if (same.length <= MAX_CLEARS_PER_LEVEL) return { ...history, clears };
  const slowest = same.reduce((a, b) => (b.time > a.time ? b : a));
  return { ...history, clears: clears.filter((c) => c !== slowest) };
}

export function summarize(history, level) {
  const list = history.clears.filter((c) => c.level === level);
  const byTime = [...list].sort((a, b) => a.time - b.time);
  const recent = [...list].sort((a, b) => b.at - a.at);
  return {
    plays: history.plays[level] || 0,
    clears: list.length,
    best: byTime[0]?.time ?? null,
    byTime,
    recent,
  };
}

/** 이 기록이 같은 난이도에서 몇 위인지 (1부터) */
export function rankOf(history, entry) {
  return summarize(history, entry.level).byTime.findIndex((c) => c.at === entry.at && c.time === entry.time) + 1;
}

export function formatDuration(sec) {
  if (sec < 60) return `${sec.toFixed(1)}초`;
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}시간 ${m}분 ${s}초` : `${m}분 ${s}초`;
}

export function formatClock(sec) {
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
