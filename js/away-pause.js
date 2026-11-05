/**
 * 화면을 떠나 있는 동안(다른 탭·창 내리기·휴대폰 홈 화면) 시계를 멈춘다.
 * 이미 다른 이유(능력 고르기 창, 시작 화면)로 멈춘 시계는 건드리지 않고,
 * 떠나서 멈춘 경우에만 돌아올 때 다시 간다.
 *
 * @param {{ isPaused: () => boolean, pause: () => void, resume: () => void }} clock
 */
export function createAwayPause(clock) {
  let pausedByAway = false;
  return {
    onHidden() {
      if (pausedByAway || clock.isPaused()) return;
      clock.pause();
      pausedByAway = clock.isPaused();
    },
    onVisible() {
      if (!pausedByAway) return;
      pausedByAway = false;
      clock.resume();
    },
    reset() {
      pausedByAway = false;
    },
  };
}
