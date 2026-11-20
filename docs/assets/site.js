'use strict';

const demo = document.querySelector('[data-demo]');
if (demo) {
  const link = demo.querySelector('[data-demo-play]');
  const label = demo.querySelector('[data-demo-label]');
  const status = demo.querySelector('[data-demo-status]');
  const video = demo.querySelector('video');
  const playLabel = label.textContent;

  function updateLabel() {
    label.textContent = video.paused || video.ended ? playLabel : link.dataset.stop;
  }

  function showError() {
    status.textContent = link.dataset.error;
    updateLabel();
  }

  video.addEventListener('play', updateLabel);
  video.addEventListener('pause', updateLabel);
  video.addEventListener('ended', updateLabel);
  video.addEventListener('error', showError);
  video.querySelector('source').addEventListener('error', showError);

  link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    status.textContent = '';
    if (!video.paused && !video.ended) {
      video.pause();
      video.currentTime = 0;
      return;
    }
    video.play().catch(error => {
      if (error.name !== 'AbortError') showError();
    });
  });
}
