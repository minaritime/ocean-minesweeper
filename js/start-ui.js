// 시작 화면 그리기. 상태는 main.js 가 넘겨주고 여기서는 DOM 만 채운다.

const MODE_ICONS = { basic: '🗺️', ability: '🎁' };
const $ = (id) => document.getElementById(id);

function pickButton(text, icon, data, onClick) {
  const btn = document.createElement('button');
  Object.assign(btn.dataset, data);
  if (icon) {
    const span = document.createElement('span');
    span.className = 'pick-icon';
    span.textContent = icon;
    btn.append(span);
  }
  btn.append(text);
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * 모드·난이도 버튼을 만든다.
 * @param {{ modes: object, levels: object, onPick: (change: {mode?: string, level?: string}) => void }} opts
 */
export function buildStart({ modes, levels, onPick }) {
  Object.entries(modes).forEach(([key, m]) => {
    $('pickMode').append(pickButton(m.label, MODE_ICONS[key], { mode: key }, () => onPick({ mode: key })));
  });
  Object.entries(levels).forEach(([key, lv]) => {
    $('pickLevel').append(pickButton(lv.label, '', { level: key }, () => onPick({ level: key })));
  });
}

/**
 * @param {{ pick: {mode: string, level: string}, continueText: string|null }} opts
 *   continueText 가 있으면 이어하기 팻말을 보인다
 */
export function renderStart({ pick, continueText }) {
  document.querySelectorAll('#pickMode button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === pick.mode));
  });
  document.querySelectorAll('#pickLevel button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.level === pick.level));
  });
  $('continueGo').hidden = !continueText;
  $('continueInfo').textContent = continueText ?? '';
}
