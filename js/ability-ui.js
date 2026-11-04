// 능력 모드 화면 조각: 능력 칸, 고르기 창 목록. 상태는 main.js 가 갖고 여기서는 그리기만 한다.

import { ABILITIES } from './abilities.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 화면 아래 능력 칸
 * @param {HTMLElement} bar
 * @param {Array<{key:string,uses:number}>} inv
 * @param {string|null} aiming 지금 대상을 고르는 능력
 * @param {(key:string) => void} onUse
 */
export function renderAbilityBar(bar, inv, aiming, onUse) {
  bar.replaceChildren();
  inv.forEach((a, idx) => {
    const def = ABILITIES[a.key];
    const passive = def.target === 'passive';
    const btn = el('button', `ability${passive ? ' passive' : ''}`);
    btn.dataset.key = a.key;
    btn.title = `${def.name}: ${def.desc}`;
    btn.setAttribute('aria-pressed', String(aiming === a.key));
    if (passive) btn.setAttribute('aria-disabled', 'true');
    btn.append(el('span', 'ab-key', String(idx + 1)), el('span', 'ab-icon', def.icon), el('span', 'ab-name', def.name),
      el('span', 'ab-uses', `×${a.uses}`));
    btn.addEventListener('click', (e) => { onUse(a.key); e.currentTarget.blur(); });
    bar.append(btn);
  });
  bar.hidden = inv.length === 0;
}

/**
 * 고르기 창의 후보 버튼들
 * @param {HTMLElement} list
 * @param {string[]} choices
 * @param {(key:string) => void} onPick
 */
export function renderOffer(list, choices, onPick) {
  list.replaceChildren();
  choices.forEach((key, idx) => {
    const def = ABILITIES[key];
    const btn = el('button', 'offer-item');
    btn.dataset.key = key;
    const text = el('span', 'of-text');
    text.append(el('b', '', `${def.name} ×${def.uses}`), el('small', '', def.desc));
    btn.append(el('span', 'of-key', String(idx + 1)), el('span', 'of-icon', def.icon), text);
    btn.addEventListener('click', () => onPick(key));
    list.append(btn);
  });
}

/** 기록 줄에 붙이는 고른 능력 아이콘 */
export function picksBadge(picks) {
  if (!Array.isArray(picks) || !picks.length) return null;
  const span = el('span', 'picks', picks.map((k) => ABILITIES[k]?.icon ?? '').join(''));
  span.title = picks.map((k) => ABILITIES[k]?.name ?? '').join(', ');
  return span;
}
