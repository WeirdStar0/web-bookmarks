// The CSP build evaluates directive expressions through a restricted parser
// instead of `new Function()`, which is what lets the response CSP drop
// 'unsafe-eval'. Its expressions may reference component data only (no
// globals), so the app factory must be registered here instead of being
// called from the x-data attribute.
import Alpine from '@alpinejs/csp';
import collapse from '@alpinejs/collapse';

Alpine.plugin(collapse);
window.Alpine = Alpine;

const startAlpineWhenAppReady = () => {
    if (window.__ALPINE_STARTED__ || !window.__WEB_BOOKMARKS_APP_READY__) {
        return;
    }

    window.__ALPINE_STARTED__ = true;
    Alpine.data('app', () => window.app());
    Alpine.start();
};

window.addEventListener('web-bookmarks:app-ready', startAlpineWhenAppReady, { once: true });
startAlpineWhenAppReady();
