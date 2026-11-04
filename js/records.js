// 판 기록: 도전 횟수와 클리어 기록. 항상 새 객체를 돌려준다.
// 모드(mode)가 없는 기록은 기본 모드. 기본 모드 도전 횟수는 예전처럼 plays[level] 에 둔다.

export const MAX_CLEARS_PER_LEVEL = 200;

/** @returns {{ plays: Record<string, number>, clears: Array<{level:string,mode?:string,time:number,at:number,mines:number,cells:number,picks?:string[]}> }} */
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

export const modeOf = (entry) => entry.mode || 'basic';

const playKey = (level, mode) => (mode === 'basic' ? level : `${mode}:${level}`);

const sameSlot = (level, mode) => (c) => c.level === level && modeOf(c) === mode;

export function addPlay(history, level, mode = 'basic') {
  const key = playKey(level, mode);
  return { ...history, plays: { ...history.plays, [key]: (history.plays[key] || 0) + 1 } };
}

/** 한 난이도·모드에 기록이 너무 많아지면 가장 느린 기록부터 버린다 */
export function addClear(history, entry) {
  const clears = [...history.clears, entry];
  const same = clears.filter(sameSlot(entry.level, modeOf(entry)));
  if (same.length <= MAX_CLEARS_PER_LEVEL) return { ...history, clears };
  const slowest = same.reduce((a, b) => (b.time > a.time ? b : a));
  return { ...history, clears: clears.filter((c) => c !== slowest) };
}

export function summarize(history, level, mode = 'basic') {
  const list = history.clears.filter(sameSlot(level, mode));
  const byTime = [...list].sort((a, b) => a.time - b.time);
  const recent = [...list].sort((a, b) => b.at - a.at);
  return {
    plays: history.plays[playKey(level, mode)] || 0,
    clears: list.length,
    best: byTime[0]?.time ?? null,
    byTime,
    recent,
  };
}

/** 이 기록이 같은 난이도·모드에서 몇 위인지 (1부터) */
export function rankOf(history, entry) {
  return summarize(history, entry.level, modeOf(entry)).byTime.findIndex((c) => c.at === entry.at && c.time === entry.time) + 1;
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

/** 0~1 비율을 백분율로. 10% 미만은 소수 한 자리까지 */
export function formatPercent(ratio) {
  const pct = ratio * 100;
  return pct < 10 ? `${(Math.floor(pct * 10) / 10).toFixed(1)}%` : `${Math.floor(pct)}%`;
}
