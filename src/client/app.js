try {
    window.translations = JSON.parse(decodeURIComponent(document.body.dataset.translations || '{}'));
} catch (e) {
    console.error("Failed to parse translations from body dataset", e);
}

window.app = function app() {
    return {
        __APP_FRAGMENTS_PLACEHOLDER__
    };
};

window.__WEB_BOOKMARKS_APP_READY__ = true;
window.dispatchEvent(new Event('web-bookmarks:app-ready'));
