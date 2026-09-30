(() => {
  const splash = document.querySelector('#kyotoSplash');
  if (!splash) return;
  const variants = ['travel', 'map', 'wakeup'];
  let timer;

  function closeSplash() {
    clearTimeout(timer);
    splash.classList.add('is-leaving');
    setTimeout(() => { splash.hidden = true; splash.classList.remove('is-playing', 'is-leaving'); }, 340);
  }

  function playSplash(choice = 'travel', options = {}) {
    const variant = choice === 'random' ? variants[Math.floor(Math.random() * variants.length)] : choice;
    splash.dataset.variant = variants.includes(variant) ? variant : 'travel';
    splash.hidden = false;
    requestAnimationFrame(() => splash.classList.add('is-playing'));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer = setTimeout(closeSplash, reduced ? 650 : (options.duration || 2050));
  }

  const skipBtn = splash.querySelector('.splash__skip');
  if (skipBtn) skipBtn.addEventListener('click', closeSplash);
  window.KyotoSplash = { play: playSplash, close: closeSplash };
})();
