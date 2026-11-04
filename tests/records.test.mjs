import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyHistory, normalizeHistory, addPlay, addClear, summarize, rankOf,
  formatDuration, formatClock, formatDate, MAX_CLEARS_PER_LEVEL,
} from '../js/records.js';

const clear = (level, time, at) => ({ level, time, at, mines: 10, cells: 100 });

test('도전 횟수는 난이도별로 쌓이고 원본은 바뀌지 않는다', () => {
  const h0 = emptyHistory();
  const h1 = addPlay(addPlay(h0, 'easy'), 'easy');
  assert.equal(h1.plays.easy, 2);
  assert.deepEqual(h0.plays, {});
});

test('클리어 기록은 빠른 순·최근 순으로 정리되고 순위가 맞다', () => {
  let h = emptyHistory();
  h = addClear(h, clear('hard', 300, 1));
  h = addClear(h, clear('hard', 120, 2));
  h = addClear(h, clear('easy', 50, 3));
  const e = clear('hard', 200, 4);
  h = addClear(addPlay(h, 'hard'), e);
  const s = summarize(h, 'hard');
  assert.equal(s.clears, 3);
  assert.equal(s.best, 120);
  assert.deepEqual(s.byTime.map((c) => c.time), [120, 200, 300]);
  assert.deepEqual(s.recent.map((c) => c.at), [4, 2, 1]);
  assert.equal(rankOf(h, e), 2);
  assert.equal(summarize(h, 'extreme').best, null);
});

test('한 난이도 기록이 넘치면 가장 느린 기록을 버린다', () => {
  let h = emptyHistory();
  for (let i = 0; i < MAX_CLEARS_PER_LEVEL; i += 1) h = addClear(h, clear('easy', 100 + i, i));
  h = addClear(h, clear('easy', 1, 9999));
  const s = summarize(h, 'easy');
  assert.equal(s.clears, MAX_CLEARS_PER_LEVEL);
  assert.equal(s.best, 1);
  assert.equal(s.byTime.at(-1).time, 100 + MAX_CLEARS_PER_LEVEL - 2);
});

test('망가진 저장값은 빈 기록으로 고쳐 읽는다', () => {
  assert.deepEqual(normalizeHistory(null), emptyHistory());
  assert.deepEqual(normalizeHistory('x'), emptyHistory());
  const h = normalizeHistory({ plays: { easy: 3 }, clears: [clear('easy', 5, 1), { level: 'easy' }, null] });
  assert.equal(h.clears.length, 1);
  assert.equal(h.plays.easy, 3);
});

test('시간 표시', () => {
  assert.equal(formatDuration(12.34), '12.3초');
  assert.equal(formatDuration(754.2), '12분 34초');
  assert.equal(formatDuration(3723), '1시간 2분 3초');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3723), '1:02:03');
  assert.match(formatDate(Date.UTC(2026, 10, 3, 12, 0)), /^2026\.11\.0[34] \d\d:\d\d$/);
});

test('백분율 표시', async () => {
  const { formatPercent } = await import('../js/records.js');
  assert.equal(formatPercent(0.004), '0.4%');
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatPercent(0.456), '45%');
  assert.equal(formatPercent(1), '100%');
});

test('기록과 도전 횟수는 모드별로 따로 센다, 모드 없는 옛 기록은 기본 모드', () => {
  let h = normalizeHistory({ plays: { easy: 4 }, clears: [clear('easy', 90, 1)] });
  h = addPlay(h, 'easy', 'ability');
  h = addClear(h, { ...clear('easy', 30, 2), mode: 'ability', picks: ['probe'] });
  const basic = summarize(h, 'easy');
  const ability = summarize(h, 'easy', 'ability');
  assert.equal(basic.plays, 4);
  assert.equal(basic.best, 90);
  assert.equal(ability.plays, 1);
  assert.equal(ability.best, 30);
  assert.deepEqual(ability.byTime[0].picks, ['probe']);
  assert.equal(rankOf(h, h.clears[1]), 1);
});

test('기록이 넘쳐 버릴 때 다른 모드 기록은 건드리지 않는다', () => {
  let h = addClear(emptyHistory(), { ...clear('easy', 9999, 0), mode: 'ability' });
  for (let i = 0; i <= MAX_CLEARS_PER_LEVEL; i += 1) h = addClear(h, clear('easy', 100 + i, i + 1));
  assert.equal(summarize(h, 'easy').clears, MAX_CLEARS_PER_LEVEL);
  assert.equal(summarize(h, 'easy', 'ability').clears, 1);
});
