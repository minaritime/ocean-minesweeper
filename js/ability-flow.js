// 능력 모드 흐름: 고르기 창, 능력 쓰기, 사건. 판·시계·저장은 main.js 가 host 로 넘겨준다.

import {
  ABILITIES, MILESTONES, SLOT_KEYS, COUNT_RADIUS, eligibleKeys, offerChoices, milestonesReached, gainOf,
  addAbility, spendAbility, removeAbility, usesOf, probe, scan, scanCells, squareCells, circleCells, thornsCells,
  coastCells, deadEndCells, resolveCells, quantum, isQuantumTarget, countMines, sink,
} from './abilities.js';
import { landBoard, allSeaBoard } from './events.js';
import { NUKE_MS } from './effects.js';
import { renderOffer } from './ability-ui.js';

const COLORS = { probe: '#ffb347', count: '#ffd166', coast: '#4dd0e1', unfair: '#ff5252' };

/**
 * @param {object} host main.js 가 주는 것:
 *   state, $, effects, afterMove(outcome), refresh(), pauseClock(), resumeClock(), scheduleSave(),
 *   showToast(text, kind), swapBoard(board, look), showWorld(), landMask(), density(),
 *   readLost(), clearLost(), installLost(lost, abilities)
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
    return stage === 0 ? '첫 능력' : `찾아낸 바다 ${Math.floor(stage * 100)}% 달성`;
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
    renderOffer($('offerList'), offer, pickAbility, (key) => gainOf(key, state.abilities.picks));
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
    setAbilities({ inv: addAbility(a.inv, key, gainOf(key, picks)), granted: a.granted + 1, offer: null, picks });
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
    setAbilities({ inv: addAbility(a.inv, key, gainOf(key, picks)), granted: a.granted + 1, offer: null, picks });
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
        host.installLost(lost, { ...state.abilities, look: lost.abilities.look, counts: [] });
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
      effects.add({ kind: 'screen', ms: 1300, icon: '🌏', text: '국국가가', color: '#558b2f' });
      host.afterMove('opened');
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
    if (target === 'passive') return;
    if (target === 'instant') {
      useCoast(key);
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
  };
}
