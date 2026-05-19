import Alpine from 'alpinejs';
import collapse from '@alpinejs/collapse';

Alpine.plugin(collapse);
window.Alpine = Alpine;

const startAlpineWhenAppReady = () => {
    if (window.__ALPINE_STARTED__ || !window.__WEB_BOOKMARKS_APP_READY__) {
        return;
    }

    window.__ALPINE_STARTED__ = true;
    Alpine.start();
};

window.addEventListener('web-bookmarks:app-ready', startAlpineWhenAppReady, { once: true });
startAlpineWhenAppReady();
