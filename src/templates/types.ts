export type TranslationSection = Record<string, string>;

export type TemplateTranslations = {
    lang: string;
    head: TranslationSection;
    loading: TranslationSection;
    login: TranslationSection;
    dashboard: TranslationSection;
    modals: TranslationSection;
    toast: TranslationSection;
};
