// 사건을 고를 때 잠깐 떴다 사라지는 그림. 그림 파일이 없으면 이모지로 대신한다.

export const MEMES = {
  hormuz: { src: 'img/hormuz.jpg', fallback: '😬☝️', caption: '호르무즈 해협 봉쇄' },
  continent: { src: 'img/ursus.png', fallback: '🌏', caption: '국국가가' },
};

const SHOW_MS = 2600;

/**
 * @param {HTMLElement} el #meme 덮개 (안에 #memeImg, #memeFallback, #memeCap)
 */
export function createMemes(el) {
  const loaded = Object.fromEntries(Object.entries(MEMES).map(([key, m]) => {
    const img = new Image();
    img.src = m.src; // 미리 받아 두어 처음 띄울 때 늦지 않게 한다
    return [key, img];
  }));
  const img = el.querySelector('#memeImg');
  let timer = 0;

  return {
    show(key) {
      const m = MEMES[key];
      if (!m) return;
      const ready = loaded[key].complete && loaded[key].naturalWidth > 0;
      if (ready) img.src = m.src;
      el.classList.toggle('has-img', ready);
      el.querySelector('#memeFallback').textContent = m.fallback;
      el.querySelector('#memeCap').textContent = m.caption;
      el.classList.remove('show');
      void el.offsetWidth; // 연출을 처음부터 다시 시작한다
      el.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('show'), SHOW_MS);
    },
  };
}
