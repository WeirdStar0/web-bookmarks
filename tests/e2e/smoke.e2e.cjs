const { test, expect } = require('@playwright/test');

const ADMIN_PASSWORD = 'local-development-only';

function alpineClick(page, expression) {
    return page.locator(`button[\\@click="${expression}"]`).first();
}

test('critical browser journey works without Alpine or CSP errors', async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
            window.__cspViolations.push({
                blockedURI: event.blockedURI,
                violatedDirective: event.violatedDirective,
            });
        });
    });

    await page.goto('/');

    await expect(page.locator('#loginUsername')).toBeVisible();
    await page.locator('#loginUsername').fill('admin');
    await page.locator('#loginPassword').fill(ADMIN_PASSWORD);
    await page.locator('#loginUsername').locator('xpath=ancestor::form').locator('button[type="submit"]').click();

    await expect(page.locator('[x-show="loggedIn"]')).toBeVisible();

    // Exercise method calls, modal state, writes, and x-for rendering.
    await alpineClick(page, 'openFolderModal()').click();
    await expect(page.locator('#folderNameInput')).toBeVisible();
    await page.locator('#folderNameInput').fill('E2E Folder');
    await alpineClick(page, 'createFolder()').click();
    await expect(page.locator('#folderNameInput')).toBeHidden();
    await expect(page.getByText('E2E Folder', { exact: true }).first()).toBeVisible();

    await alpineClick(page, 'openBookmarkModal()').click();
    await expect(page.locator('#bookmarkTitleInput')).toBeVisible();
    await page.locator('#bookmarkTitleInput').fill('E2E Bookmark');
    await page.locator('#bookmarkUrlInput').fill('https://example.com/e2e');
    await page.locator('#bookmarkFolderSelect').click();
    await page.getByRole('option', { name: 'E2E Folder', exact: true }).click();
    await alpineClick(page, 'createBookmark()').click();
    await expect(page.locator('#bookmarkTitleInput')).toBeHidden();

    // Enter the folder through rendered UI and verify the bookmark binding.
    await page.getByText('E2E Folder', { exact: true }).first().click();
    await expect(page.locator('a[href="https://example.com/e2e"]')).toBeVisible();

    // Exercise assignment expressions and settings modal wiring.
    await alpineClick(page, 'settingsMenuOpen = !settingsMenuOpen').click();
    await alpineClick(page, 'openSettingsModal()').click();
    await expect(page.locator('#settingsUsernameInput')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settingsUsernameInput')).toBeHidden();

    // Exercise the trash view switch.
    await alpineClick(page, 'goToTrash()').click();

    const cspViolations = await page.evaluate(() => window.__cspViolations);
    expect(cspViolations, 'CSP violations').toEqual([]);
    expect(pageErrors, 'uncaught browser errors').toEqual([]);
    expect(consoleErrors, 'browser console errors').toEqual([]);
});
