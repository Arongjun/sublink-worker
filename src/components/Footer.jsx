/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
import { APP_NAME } from '../constants.js';

export const Footer = () => {
    const currentYear = new Date().getFullYear();

    return (
        <footer class="mt-12 py-8 border-t border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm">
            <div class="container mx-auto px-4">
                <div class="flex items-center justify-center">
                    <div class="text-gray-600 dark:text-gray-400 text-center">
                        <span class="text-sm">© {currentYear} {APP_NAME}. All rights reserved.</span>
                    </div>
                </div>
            </div>
        </footer>
    );
};
