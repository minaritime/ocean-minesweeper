import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAwayPause } from '../js/away-pause.js';

function fakeClock(paused = false) {
  const log = [];
  const clock = {
    paused,
    isPaused: () => clock.paused,
    pause: () => { clock.paused = true; log.push('pause'); },
    resume: () => { clock.paused = false; log.push('resume'); },
    log,
  };
  return clock;
}

test('화면을 떠나면 시계를 멈추고 돌아오면 다시 간다', () => {
  const c = fakeClock();
  const away = createAwayPause(c);
  away.onHidden();
  away.onVisible();
  assert.deepEqual(c.log, ['pause', 'resume']);
});

test('이미 다른 이유(능력 고르기·시작 화면)로 멈춘 시계는 돌아와도 풀지 않는다', () => {
  const c = fakeClock(true);
  const away = createAwayPause(c);
  away.onHidden();
  away.onVisible();
  assert.deepEqual(c.log, []);
  assert.equal(c.paused, true);
});

test('숨김 신호가 두 번 와도 돌아올 때 한 번만 이어 간다', () => {
  const c = fakeClock();
  const away = createAwayPause(c);
  away.onHidden();
  away.onHidden();
  away.onVisible();
  away.onVisible();
  assert.deepEqual(c.log, ['pause', 'resume']);
});

test('새 판을 깔면 떠나서 멈춘 기억을 지운다', () => {
  const c = fakeClock();
  const away = createAwayPause(c);
  away.onHidden();
  away.reset();
  c.paused = false;
  away.onVisible();
  assert.deepEqual(c.log, ['pause']);
});
