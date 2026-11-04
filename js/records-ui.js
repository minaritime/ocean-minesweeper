// 기록 창 그리기. 상태는 main.js 가 넘겨주고 여기서는 DOM 만 채운다.

import { summarize, formatDuration, formatDate } from './records.js';
import { picksBadge } from './ability-ui.js';

const RECORD_LIST_LIMIT = 50;
const $ = (id) => document.getElementById(id);

function markPressed(selector, attr, value) {
  document.querySelectorAll(selector).forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset[attr] === value));
  });
}

function recordRow(entry, rankNo, isFresh) {
  const li = document.createElement('li');
  if (isFresh) li.classList.add('fresh');
  const parts = [['rank', String(rankNo)], ['t', formatDuration(entry.time)], ['d', formatDate(entry.at)]];
  for (const [cls, text] of parts) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    li.append(span);
  }
  const badge = picksBadge(entry.picks);
  if (badge) li.querySelector('.t').append(badge);
  return li;
}

/**
 * @param {{ history: object, level: string, mode: string, sort: 'time'|'recent', lastClear: object|null }} opts
 */
export function renderRecords({ history, level, mode, sort, lastClear }) {
  const sum = summarize(history, level, mode);
  markPressed('#recordTabs button', 'level', level);
  markPressed('#recordModes button', 'mode', mode);
  markPressed('.sort button', 'sort', sort);
  $('recBest').textContent = sum.best === null ? '없음' : formatDuration(sum.best);
  $('recClears').textContent = `${sum.clears}번`;
  $('recPlays').textContent = `${sum.plays}번`;
  const list = (sort === 'time' ? sum.byTime : sum.recent).slice(0, RECORD_LIST_LIMIT);
  const ol = $('recList');
  ol.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 클리어 기록이 없습니다';
    ol.append(li);
    return;
  }
  list.forEach((entry) => ol.append(recordRow(entry, sum.byTime.indexOf(entry) + 1, entry === lastClear)));
}
