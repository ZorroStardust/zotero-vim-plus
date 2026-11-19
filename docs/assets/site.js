'use strict';

const demo = document.querySelector('[data-demo]');
if (demo) {
  const play = demo.querySelector('[data-demo-play]');
  const label = demo.querySelector('[data-demo-label]');
  const status = demo.querySelector('[data-demo-status]');
  const viewport = demo.querySelector('.demo-window');
  const poster = viewport.querySelector('.demo-poster');
  const playLabel = label.textContent;
  let animation;

  function stopDemo() {
    animation?.remove();
    animation = undefined;
    poster.classList.remove('playing');
    label.textContent = playLabel;
    play.removeAttribute('aria-busy');
  }

  play.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    status.textContent = '';
    if (animation) {
      stopDemo();
      return;
    }

    const image = document.createElement('img');
    animation = image;
    image.className = 'demo-animation';
    image.alt = poster.alt;
    label.textContent = play.dataset.pause;
    play.setAttribute('aria-busy', 'true');
    image.addEventListener('load', () => {
      if (animation !== image) return;
      poster.classList.add('playing');
      viewport.appendChild(image);
      play.removeAttribute('aria-busy');
    }, { once: true });
    image.addEventListener('error', () => {
      if (animation !== image) return;
      stopDemo();
      status.textContent = play.dataset.error;
      viewport.appendChild(status);
      status.className = 'demo-error';
    }, { once: true });
    image.src = play.href;
  });
}
