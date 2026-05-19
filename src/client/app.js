window.app = function app() {
    return {
        __APP_FRAGMENTS_PLACEHOLDER__
    };
};

window.__WEB_BOOKMARKS_APP_READY__ = true;
window.dispatchEvent(new Event('web-bookmarks:app-ready'));
