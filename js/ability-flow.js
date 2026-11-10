// 능력 모드 흐름: 고르기 창, 능력 쓰기, 사건. 판·시계·저장은 main.js 가 host 로 넘겨준다.

import {
  ABILITIES, MILESTONES, SLOT_KEYS, COUNT_RADIUS, eligibleKeys, offerChoices, milestonesReached, gainOf,
  addAbility, spendAbility, removeAbility, usesOf, probe, scan, scanCells, squareCells, circleCells, thornsCells,
  coastCells, deadEndCells, resolveCells, quantum, isQuantumTarget, countMines, sink,
  sonar, sonarDir, sonarLine, hideCells,
} from './abilities.js';
import { landBoard, allSeaBoard, removeMines } from './events.js';
import { photoOf, boardFromPhoto } from './save.js';
import { hormuzCells, GULF_CENTER, STRAIT_LINE } from './hormuz.js';
import { project } from './geo.js';
import { NUKE_MS } from './effects.js';
import { renderOffer } from './ability-ui.js';

const COLORS = { probe: '#ffb347', count: '#ffd166', coast: '#4dd0e1', unfair: '#ff5252', gulf: '#ff7043' };
const THUNDER_RATIO = 0.3;
const SHARK_BITE_RADIUS = 4; // 상어에 물리면 이 반지름 안의 열린 칸이 다시 덮인다
const SONAR_PREVIEW = 40;
const HORMUZ_SPAN_DEG = 34; // 확대했을 때 화면 폭에 들어오는 경도 (페르시아만·오만만이 다 들어오게)
const HORMUZ_MAX_PX = 40;
const HORMUZ = { fly: 1400, block: 1500 };
const mod = (a, n) => ((a % n) + n) % n;

/**
 * @param {object} host main.js 가 주는 것:
 *   state, $, effects, afterMove(outcome), refresh(), pauseClock(), resumeClock(), scheduleSave(),
 *   showToast(text, kind), swapBoard(board, look), showWorld(), landMask(), density(),
 *   readLost(), clearLost(), installLost(lost, abilities),
 *   hazards, centerOn(x, y), flyTo(x, y, z, ms), showMeme(key), minPlayPx
 */
export function createAbilityFlow(host) {
  const { state, $, effects } = host;
  const board = () => state.game?.board;
  const cols = () => board().cols;
  const isOfferOpen = () => $('offer').classList.contains('show');

  function setAbilities(change) {
    state.abilities = { ...state.abilities, ...change };
  }

  function spend(key) {
    setAbilities({ inv: spendAbility(state.abilities.inv, key) });
  }

  function hideOffer() {
    $('offer').classList.remove('show');
  }

  /* ---------- 받기 ---------- */

  function stageLabel() {
    const a = state.abilities;
    if (a.granted === 0 && a.picks.includes('nuke')) return '☢️ 한 번 더';
    const stage = MILESTONES[a.granted];
    return stage === 0 ? '첫 능력' : `찾아낸 바다 ${Math.round(stage * 100)}% 달성`;
  }

  function offerPool() {
    const a = state.abilities;
    return eligibleKeys({ picks: a.picks, hasLost: Boolean(host.readLost()), look: a.look });
  }

  /** 새로 넘은 단계가 있으면 고르기 창을 띄운다 (한 번에 여러 단계를 넘으면 하나씩 차례로) */
  function checkMilestones() {
    if (state.mode !== 'ability' || state.pendingResume || state.busy || isOfferOpen() || host.isBlocked()) return;
    const b = board();
    if (!b || milestonesReached(b) <= state.abilities.granted) return;
    if (state.abilities.look === 'land') {
      autoPick();
      return;
    }
    const offer = state.abilities.offer ?? offerChoices(Math.random, offerPool());
    setAbilities({ offer });
    state.aiming = null;
    host.pauseClock();
    $('offerStage').textContent = stageLabel();
    renderOffer($('offerList'), offer, pickAbility, (key) => gainOf(key, state.abilities.picks, state.level));
    $('offer').classList.add('show');
    $('offerList').querySelector('button')?.focus();
    host.scheduleSave();
  }

  /** 국국가가 뒤에는 남은 능력을 알아서 고른다 */
  function autoPick() {
    const pool = offerPool().filter((k) => SLOT_KEYS.includes(k));
    const [key] = offerChoices(Math.random, pool, 1);
    const a = state.abilities;
    const picks = [...a.picks, key];
    setAbilities({ inv: addAbility(a.inv, key, gainOf(key, picks, state.level)), granted: a.granted + 1, offer: null, picks });
    host.showToast(`${ABILITIES[key].icon} ${ABILITIES[key].name} 자동 선택`, 'info');
    host.scheduleSave();
    host.refresh();
    checkMilestones();
  }

  function pickAbility(key) {
    const a = state.abilities;
    if (!a.offer?.includes(key)) return;
    hideOffer();
    const picks = [...a.picks, key];
    if (ABILITIES[key].kind === 'event') {
      setAbilities({ granted: key === 'nuke' ? a.granted : a.granted + 1, offer: null, picks });
      runEvent(key);
      return;
    }
    setAbilities({ inv: addAbility(a.inv, key, gainOf(key, picks, state.level)), granted: a.granted + 1, offer: null, picks });
    host.resumeClock();
    host.scheduleSave();
    host.refresh();
    checkMilestones();
  }

  /* ---------- 사건 ---------- */

  function runEvent(key) {
    if (key === 'nuke') {
      nuke();
      return;
    }
    if (key === 'remnant') {
      const lost = host.readLost();
      if (lost) {
        host.clearLost();
        host.installLost(lost, { ...state.abilities, look: lost.abilities.look, counts: [], photo: null });
        effects.add({ kind: 'screen', ms: 1400, icon: '👻', text: '였던것', color: '#5e35b1' });
        host.refresh();
        checkMilestones();
        return;
      }
      host.showToast('진 판을 불러오지 못했습니다');
    }
    host.resumeClock();
    if (key === 'continent') {
      const b = board();
      host.swapBoard(landBoard(host.landMask(), b.cols, b.rows, host.density()), 'land');
      host.showMeme('continent');
      effects.add({ kind: 'screen', ms: 1300, icon: '', text: '', color: '#558b2f' });
      host.afterMove('opened');
      return;
    }
    if (key === 'hormuz') {
      hormuz();
      return;
    }
    if (key === 'thunder') {
      thunder();
      return;
    }
    if (key === 'sharknado') {
      host.hazards.sync();
      effects.add({ kind: 'screen', ms: 1300, icon: '🦈', text: '상어 떼', color: '#0d3b66' });
      host.afterMove('none');
      return;
    }
    if (key === 'unfair') {
      const b = board();
      const cells = deadEndCells(b);
      effects.add({ kind: 'glow', ms: 1100, cols: b.cols, cells, color: COLORS.unfair });
      effects.add({ kind: 'screen', ms: 1100, icon: '🙅', text: '억까 ㄴ', color: '#b71c1c' });
      host.showToast(`막다른 칸 ${cells.length}개를 풀었습니다`, 'info');
      host.afterMove(resolveCells(b, cells) === 'won' ? 'won' : 'opened');
      return;
    }
    host.afterMove('none');
  }

  /** 세기 숫자를 지금 판으로 다시 센다 (지뢰가 줄거나 판이 되돌아간 뒤) */
  function recount() {
    const b = board();
    const counts = state.abilities.counts.filter((c) => b.ocean[c.i]).map((c) => ({ i: c.i, n: countMines(b, c.i) }));
    setAbilities({ counts });
  }

  function thunder() {
    const b = board();
    const before = b.mineCount;
    const outcome = removeMines(b, THUNDER_RATIO);
    recount();
    host.hazards.strikeSoon();
    effects.add({ kind: 'screen', ms: 1300, icon: '⛈️', text: '천둥번개', color: '#263238' });
    host.showToast(`⛈️ 지뢰 ${before - b.mineCount}개가 사라졌습니다`, 'info');
    host.afterMove(outcome === 'won' ? 'won' : 'opened');
  }

  /** 호르무즈 봉쇄: 짤이 떴다 사라지는 동안 해협으로 날아가 봉쇄선을 긋고 만을 푼다 */
  function hormuz() {
    const { layout } = state.game;
    const at = (lonLat) => {
      const [x, y] = project(layout, lonLat[0], lonLat[1]);
      return [mod(x, layout.cols), y];
    };
    state.busy = true;
    host.showMeme('hormuz');
    const [cx, cy] = at(GULF_CENTER);
    const fitZ = state.view.w / (HORMUZ_SPAN_DEG / layout.cellDeg);
    host.flyTo(cx, cy, Math.min(HORMUZ_MAX_PX, Math.max(host.minPlayPx * 1.5, fitZ)), HORMUZ.fly);
    host.refresh();
    setTimeout(() => {
      const b = board();
      const cells = hormuzCells(b, layout);
      const [from, to] = STRAIT_LINE.map(at);
      effects.add({ kind: 'barrier', ms: 2600, cols: b.cols, from, to });
      effects.add({ kind: 'glow', ms: 1500, cols: b.cols, cells, color: COLORS.gulf });
      const outcome = resolveCells(b, cells);
      state.busy = false;
      host.showToast(`🛢️ 페르시아만·오만만 ${cells.length}칸을 풀었습니다`, 'info');
      host.afterMove(outcome === 'won' ? 'won' : 'opened');
    }, HORMUZ.block);
  }

  /** 핵전쟁: 미사일이 다 터지고 번쩍일 때 대륙이 사라진다. 그동안 입력은 막는다 */
  function nuke() {
    state.busy = true;
    host.showWorld();
    effects.nuke(state.game.layout);
    host.refresh();
    setTimeout(() => {
      host.swapBoard(allSeaBoard(board(), host.density()), 'nuke');
      setAbilities({ look: 'nuke', counts: [] });
      host.refresh();
    }, NUKE_MS.flash);
    setTimeout(() => {
      state.busy = false;
      host.scheduleSave();
      checkMilestones();
    }, NUKE_MS.total);
  }

  /* ---------- 쓰기 ---------- */

  function useAbility(key) {
    const b = board();
    if (!b || b.state !== 'playing' || state.busy || isOfferOpen() || usesOf(state.abilities.inv, key) <= 0) return;
    const { target } = ABILITIES[key];
    if (target === 'passive' || host.hazards.radarOn()) return;
    if (target === 'instant') {
      if (key === 'photo') usePhoto();
      else if (key === 'radar') useRadar();
      else useCoast(key);
      return;
    }
    state.aiming = state.aiming === key ? null : key;
    state.aimFirst = -1;
    host.refresh();
  }

  function cancelAim() {
    state.aiming = null;
    state.aimFirst = -1;
    host.refresh();
  }

  function useCoast(key) {
    const b = board();
    const cells = coastCells(b);
    const outcome = resolveCells(b, cells);
    if (outcome === 'none') {
      host.showToast('풀 수 있는 칸이 없습니다', 'info');
      return;
    }
    spend(key);
    effects.add({ kind: 'glow', ms: 1000, cols: b.cols, cells, color: COLORS.coast });
    host.afterMove(outcome === 'won' ? 'won' : 'opened');
  }

  function usePhoto() {
    const had = Boolean(state.abilities.photo);
    spend('photo');
    setAbilities({ photo: photoOf(board()) });
    effects.add({ kind: 'screen', ms: 500, icon: '📸', text: '', color: '#ffffff' });
    host.showToast(had ? '📸 새로 찍었습니다 (이전 사진은 지워짐)' : '📸 지금 판을 찍었습니다', 'info');
    host.scheduleSave();
    host.refresh();
  }

  function useRadar() {
    spend('radar');
    state.aiming = null;
    host.hazards.startRadar();
    host.refresh();
  }

  /** 지뢰가 터졌을 때 사진이 있으면 찍은 때로 돌아간다. 돌아갔으면 true */
  function tryPhoto() {
    const a = state.abilities;
    const b = board();
    if (state.mode !== 'ability' || !a.photo || !b) return false;
    const back = boardFromPhoto(a.photo, b.cols, b.rows, b.exploded);
    setAbilities({ photo: null });
    if (!back) {
      host.showToast('사진을 불러오지 못했습니다');
      return false;
    }
    const { counts } = a;
    host.swapBoard(back, a.look);
    setAbilities({ counts });
    recount();
    effects.add({ kind: 'screen', ms: 900, icon: '📸', text: '찍은 때로 돌아왔습니다', color: '#ffffff' });
    effects.add({ kind: 'ring', ms: 900, cols: back.cols, i: b.exploded, color: '#e53935' });
    host.showToast('📸 사진을 찍은 때로 돌아왔습니다. 터진 지뢰에 깃발을 꽂았습니다', 'info');
    host.afterMove('none');
    return true;
  }

  /** 상어에 물림: 그 자리 둘레의 열린 칸이 다시 덮이고 엉뚱한 곳으로 날아간다 */
  function sharkBite(gx, gy) {
    const b = board();
    const i = Math.floor(gy) * b.cols + mod(Math.floor(gx), b.cols);
    const hidden = hideCells(b, circleCells(b, i, SHARK_BITE_RADIUS));
    const sea = [];
    for (let k = 0; k < b.ocean.length; k += 1) if (b.ocean[k]) sea.push(k);
    const to = sea[Math.floor(Math.random() * sea.length)];
    host.centerOn((to % b.cols) + 0.5, Math.floor(to / b.cols) + 0.5);
    state.aiming = null;
    state.aimFirst = -1;
    effects.add({ kind: 'screen', ms: 900, icon: '🦈', text: '콱!', color: '#37474f' });
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    host.showToast(hidden ? `🦈 상어에 물려 ${hidden}칸이 다시 덮였습니다` : '🦈 상어에 물려 날아갔습니다', 'info');
    host.afterMove('none');
  }

  /** 소나: 첫 칸을 고르고, 두 번째로 누른 쪽 방향으로 쏜다 */
  function useSonar(b, i) {
    const first = state.aimFirst;
    if (first < 0 || first === i) {
      state.aimFirst = first === i || !b.ocean[i] ? -1 : i;
      host.refresh();
      return;
    }
    const r = sonar(b, first, sonarDir(b.cols, first, i));
    state.aimFirst = -1;
    if (r.outcome === 'none') {
      host.showToast('그 방향에는 더 풀 칸이 없습니다', 'info');
      host.refresh();
      return;
    }
    spend('sonar');
    state.aiming = null;
    effects.add({ kind: 'beam', ms: 900, cols: b.cols, a: first, b: r.end });
    if (r.hit >= 0) {
      effects.add({ kind: 'ring', ms: 700, cols: b.cols, i: r.hit, color: '#80deea' });
      host.showToast(`${ABILITIES.sonar.icon} 지뢰를 찾았습니다`, 'info');
    }
    host.afterMove(r.outcome === 'won' ? 'won' : 'opened');
  }

  function useCount(b, i) {
    const n = countMines(b, i);
    if (n < 0) return;
    spend('count');
    const counts = [...state.abilities.counts.filter((c) => c.i !== i), { i, n }];
    setAbilities({ counts });
    effects.add({ kind: 'square', ms: 600, cols: b.cols, i, r: COUNT_RADIUS, color: COLORS.count });
    host.showToast(`${ABILITIES.count.icon} 주변 5×5 지뢰 ${n}개`, 'info');
    state.aiming = null;
    host.afterMove('none');
  }

  /** 양자역학: 첫 칸을 고르고 두 번째 칸에서 발동 */
  function useQuantum(b, i) {
    if (state.aimFirst < 0 || state.aimFirst === i) {
      state.aimFirst = state.aimFirst === i ? -1 : (isQuantumTarget(b, i) ? i : -1);
      host.refresh();
      return;
    }
    const a = state.aimFirst;
    const outcome = quantum(b, a, i);
    if (outcome === 'none') return;
    effects.add({ kind: 'wave', ms: 800, cols: b.cols, a, b: i, ok: outcome !== 'collapse' });
    state.aimFirst = -1;
    state.aiming = null;
    if (outcome === 'collapse') {
      setAbilities({ inv: removeAbility(state.abilities.inv, 'quantum') });
      host.showToast(`${ABILITIES.quantum.icon} 두 칸이 같아 양자역학이 사라졌습니다`, 'info');
      host.afterMove('none');
      return;
    }
    spend('quantum');
    host.afterMove(outcome === 'won' ? 'won' : 'opened');
  }

  /** 대상 고르기 중 i 칸을 눌렀을 때. 효과가 없는 칸이면 쓰지 않는다 */
  function aimAt(i) {
    const b = board();
    const key = state.aiming;
    const { target } = ABILITIES[key];
    if (target === 'count') {
      useCount(b, i);
      return;
    }
    if (target === 'pair') {
      useQuantum(b, i);
      return;
    }
    if (target === 'line') {
      useSonar(b, i);
      return;
    }
    let outcome;
    if (target === 'area') outcome = scan(b, i);
    else if (target === 'circle') outcome = sink(b, circleCells(b, i));
    else outcome = probe(b, i);
    if (outcome === 'none') return;
    spend(key);
    state.aiming = null;
    if (target === 'circle') {
      // 메운 곳의 지뢰가 사라졌으니 세기 숫자를 다시 센다 (육지가 된 칸의 표시는 지운다)
      const counts = state.abilities.counts.filter((c) => b.ocean[c.i]).map((c) => ({ i: c.i, n: countMines(b, c.i) }));
      setAbilities({ counts });
    }
    if (target === 'area') effects.add({ kind: 'square', ms: 600, cols: b.cols, i, r: 1, color: COLORS.probe });
    else if (target === 'circle') effects.add({ kind: 'rise', ms: 1100, cols: b.cols, i, r: 10 });
    else effects.add({ kind: 'ring', ms: 550, cols: b.cols, i, color: COLORS.probe });
    if (outcome === 'flagged' || outcome === 'confirmed') host.showToast(`${ABILITIES[key].icon} 지뢰가 있습니다`, 'info');
    host.afterMove(outcome === 'won' ? 'won' : 'opened');
  }

  /** 대상 고르기 중 마우스가 가리키는 칸에 효과가 닿을 칸들 */
  function aimCells() {
    const b = board();
    if (!state.aiming) return null;
    const first = state.aimFirst >= 0 ? [state.aimFirst] : [];
    if (!b || state.hover < 0) return first;
    const h = state.hover;
    const { target } = ABILITIES[state.aiming];
    if (target === 'area') return scanCells(b, h);
    if (target === 'count') return squareCells(b, h, COUNT_RADIUS);
    if (target === 'circle') return circleCells(b, h);
    if (target === 'pair') return isQuantumTarget(b, h) ? [...first, h] : first;
    if (target === 'line') {
      if (!first.length) return b.ocean[h] ? [h] : [];
      const dir = sonarDir(b.cols, first[0], h);
      return dir ? sonarLine(b, first[0], dir, SONAR_PREVIEW) : first;
    }
    return b.ocean[h] && !b.open[h] ? [h] : [];
  }

  /* ---------- 지뢰를 밟았을 때 ---------- */

  /** 밟은 지뢰를 막을 능력: 가시갑옷이 방패보다 먼저 */
  function guardKey() {
    if (state.mode !== 'ability') return null;
    const { inv } = state.abilities;
    if (usesOf(inv, 'thorns') > 0) return 'thorns';
    if (usesOf(inv, 'shield') > 0) return 'shield';
    return null;
  }

  /** 막은 뒤 처리. afterMove 에 넘길 결과를 돌려준다 */
  function onGuarded(key) {
    const b = board();
    const i = b.guarded;
    spend(key);
    if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
    if (key === 'shield') {
      effects.add({ kind: 'bubble', ms: 700, cols: b.cols, i });
      host.showToast(`${ABILITIES.shield.icon} 방패가 지뢰를 막았습니다`, 'info');
      return 'opened';
    }
    effects.add({ kind: 'spikes', ms: 600, cols: b.cols, i });
    host.showToast(`${ABILITIES.thorns.icon} 가시갑옷이 지뢰를 막았습니다`, 'info');
    return resolveCells(b, thornsCells(b, i)) === 'won' ? 'won' : 'opened';
  }

  return {
    isOfferOpen, hideOffer, checkMilestones, pickAbility, useAbility, cancelAim, aimAt, aimCells, guardKey, onGuarded,
    tryPhoto, sharkBite,
  };
}
