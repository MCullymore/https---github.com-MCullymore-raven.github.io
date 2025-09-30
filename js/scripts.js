
const video = document.getElementById('promoVideo');
const overlay = document.getElementById('unmuteOverlay');

overlay.addEventListener('click', () => {
    // Try to unmute and play video
    video.muted = false;

    video.play().then(() => {
        overlay.style.display = 'none'; // Hide overlay if playback succeeded
    }).catch((err) => {
        console.error('Video play failed:', err);
    });
});

  document.addEventListener("DOMContentLoaded", function () {
  const swipeableSections = document.querySelectorAll('.swipeable');

  swipeableSections.forEach(section => {
    let touchStartX = 0;
    let touchEndX = 0;

    section.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    });

    section.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe(section);
    });

    function handleSwipe(section) {
      const swipeDistance = touchEndX - touchStartX;

      if (Math.abs(swipeDistance) > 50) { // only if swipe is big enough
        section.style.transition = 'opacity 0.4s ease-out';
        section.style.opacity = 0;
        setTimeout(() => {
          section.style.display = 'none';
        }, 400);
      }
    }
  });
});