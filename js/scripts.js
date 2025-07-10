
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