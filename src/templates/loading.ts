import type { TemplateTranslations } from './types';

export const loading = (t: TemplateTranslations) => `
    <!-- Loading Overlay -->
    <div x-show="isLoading" class="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center" x-cloak>
        <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-2xl flex flex-col items-center">
            <svg class="animate-spin h-10 w-10 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-gray-700 dark:text-gray-200 font-medium">${t.loading.wait}</p>
        </div>
    </div>

    <!-- Toast Notification -->
    <div x-show="toast.show" 
         x-transition:enter="transition ease-out duration-300"
         x-transition:enter-start="opacity-0 transform translate-y-2"
         x-transition:enter-end="opacity-100 transform translate-y-0"
         x-transition:leave="transition ease-in duration-200"
         x-transition:leave-start="opacity-100 transform translate-y-0"
         x-transition:leave-end="opacity-0 transform translate-y-2"
         class="fixed bottom-6 right-6 z-[70]" x-cloak>
        <div :class="{'bg-green-500': toast.type === 'success', 'bg-red-500': toast.type === 'error'}" class="text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-2">
            <span x-text="toast.message"></span>
        </div>
    </div>
`;
