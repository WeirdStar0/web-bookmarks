import type { TemplateTranslations } from './types';
import { scripts } from './scripts';

export const head = (t: TemplateTranslations) => `
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%233b82f6' /%3E%3Cstop offset='100%25' style='stop-color:%231e40af' /%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M5 3C3.89543 3 3 3.89543 3 5V21L12 17.5L21 21V5C21 3.89543 20.1046 3 19 3H5Z' fill='url(%23grad)' /%3E%3Cpath d='M3 5L12 17.5L21 5H3Z' fill='rgba(255,255,255,0.1)' /%3E%3C/svg%3E">
    <title>${t.head.title}</title>
    <link rel="stylesheet" href="/assets/app.css">
    ${scripts(t)}
    <script type="module" src="/assets/vendor.js"></script>
    <style>
        [x-cloak] { display: none !important; }
        
        /* Custom Scrollbar */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        
        ::-webkit-scrollbar-track {
            background: transparent;
        }
        
        ::-webkit-scrollbar-thumb {
            background-color: #e5e7eb; /* gray-200 */
            border-radius: 4px;
            border: 2px solid transparent;
            background-clip: content-box;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background-color: #d1d5db; /* gray-300 */
        }
        
        /* Dark mode scrollbar */
        .dark ::-webkit-scrollbar-thumb {
            background-color: #374151; /* gray-700 */
        }
        
        .dark ::-webkit-scrollbar-thumb:hover {
            background-color: #4b5563; /* gray-600 */
        }
    </style>
</head>
`;
