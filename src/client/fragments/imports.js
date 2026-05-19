async importBookmarks(event) {
    const file = event.target.files[0];
    if (!file) return;

    this.confirmAction(window.translations.modals.importConfirm, async () => {
        this.isLoading = true;
        const preventUnload = (e) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', preventUnload);

                await this.withLoading(async () => {
                    try {
                        const text = await file.text();
                        await this.apiFetch('/api/import', {
                            method: 'POST',
                            body: text,
                        });

                        this.showToast(window.translations.toast.importSuccess, 'success');
                        await this.loadData();
                        this.showSettingsModal = false;
            } catch (e) {
                this.showToast(window.translations.toast.importError + (e.message || ''), 'error');
            } finally {
                this.isLoading = false;
                window.removeEventListener('beforeunload', preventUnload);
                event.target.value = '';
            }
        });
    });
}
