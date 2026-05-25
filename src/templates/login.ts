import type { TemplateTranslations } from './types';

export const login = (t: TemplateTranslations) => `
    <!-- Login Form -->
    <div x-show="!loggedIn && !isCheckingAuth" class="min-h-screen flex items-center justify-center px-4" x-cloak>
        <div class="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 transform transition-all">
            <div class="text-center mb-8">
                <div class="inline-block p-3 rounded-full bg-blue-100 dark:bg-blue-900 mb-4">
                    <svg class="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                </div>
                <h1 class="text-2xl font-bold text-gray-900 dark:text-white">${t.login.welcome}</h1>
                <p class="text-gray-500 dark:text-gray-400 text-sm mt-2">${t.login.subtitle}</p>
            </div>
            <form @submit.prevent="login">
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.login.username}</label>
                        <input type="text" x-model="loginForm.username" autocomplete="username" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" placeholder="${t.login.usernamePlaceholder}">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.login.password}</label>
                        <input type="password" x-model="loginForm.password" autocomplete="current-password" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" placeholder="${t.login.passwordPlaceholder}">
                    </div>
                </div>
                <div class="mt-6">
                    <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg shadow-lg transition-all transform hover:scale-[1.02]">${t.login.loginButton}</button>
                </div>
                <p x-show="loginError" class="text-red-500 text-sm text-center mt-4" x-text="loginError"></p>
            </form>
        </div>
    </div>
`;
