// The special key to identify an installation banner
export const INSTALL_BANNER_UUID = "#flora-plugin-install-banner-aa93b13084f7";

/**
 * Remove installation encouragement banner if it exists
 */
function clearInstallBanner(): void {
    const target = document.querySelector(INSTALL_BANNER_UUID);
    if (target) target.remove();
}

export function main() {
    clearInstallBanner();
    let debounceTimer: number;
    const observer = new MutationObserver((mutations) => {
        const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
        if (hasNewNodes) {
            clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(() => {
                clearInstallBanner();
            }, 300);
        }
    });
    observer.observe(document.body, {childList: true, subtree: true});
}

document.addEventListener('DOMContentLoaded', main);
