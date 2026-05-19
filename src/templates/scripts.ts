import type { TemplateTranslations } from './types';

export const scripts = (t: TemplateTranslations) => `
    <script>
        window.translations = ${JSON.stringify(t)};
    </script>
    <script type="module" src="/assets/app.js"></script>
    `;
