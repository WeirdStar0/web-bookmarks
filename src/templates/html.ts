import type { TemplateTranslations } from './types';
import { head } from './head';
import { login } from './login';
import { main } from './main';
import { modals } from './modals';
import { loading } from './loading';

export const html = (t: TemplateTranslations) => {
    const translationsJson = encodeURIComponent(JSON.stringify(t));
    return `
<!DOCTYPE html>
<html lang="${t.lang}">
${head(t)}
<body class="bg-gray-100 dark:bg-gray-900 transition-colors duration-200" x-data="app()" x-init="init()" x-cloak data-translations="${translationsJson}">
    ${loading(t)}
    ${login(t)}
    ${main(t)}
    ${modals(t)}
</body>
</html>
`;
};
