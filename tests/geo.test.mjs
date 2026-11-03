import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carveStraits, makeLayout, project, unwrapRing, maskResolution } from '../js/geo.js';
import { keepLargestOcean } from '../js/game.js';

test('해협을 뚫으면 떨어져 있던 두 바다가 이어진다', () => {
  const layout = { ...makeLayout(36, () => 0), latTop: 80 };
  const ocean = new Uint8Array(layout.cols * layout.rows);
  const a = project(layout, -170, 0);
  const b = project(layout, 170, 0);
  const at = ([x, y]) => Math.floor(y) * layout.cols + (Math.floor(x) % layout.cols);
  ocean[at(a)] = 1;
  ocean[at(b)] = 1;
  const straits = [{ name: '시험', path: [[-170, 0], [0, 0], [170, 0]] }];
  const carved = carveStraits(ocean, layout, straits);
  const kept = keepLargestOcean(carved, layout.cols, layout.rows);
  assert.equal(kept[at(a)], 1);
  assert.equal(kept[at(b)], 1);
  assert.equal(ocean.reduce((s, v) => s + v, 0), 2);
});

test('날짜변경선을 건너는 고리는 경도가 이어진다', () => {
  const out = unwrapRing([[179, 60], [-179, 61], [-178, 62]]);
  assert.deepEqual(out.slice(0, 3).map((p) => p[0]), [179, 181, 182]);
});

test('육지 비율을 재는 그림 크기는 휴대폰 한도 안쪽이다', () => {
  assert.ok(maskResolution(800) * 800 <= 3200);
  assert.ok(maskResolution(300) >= 3);
});
