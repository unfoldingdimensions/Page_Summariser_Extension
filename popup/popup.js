// Popup logic for Page Summariser extension

(function () {
    'use strict';

    // ============================================
    // DOM Elements
    // ============================================
    const views = {
        main: document.getElementById('mainView'),
        loading: document.getElementById('loadingView'),
        detail: document.getElementById('detailView'),
        error: document.getElementById('errorView')
    };

    const elements = {
        // Header
        backBtn: document.getElementById('backBtn'),
        headerTitle: document.getElementById('headerTitle'),

        // API Section
        apiHeader: document.getElementById('apiHeader'),
        apiForm: document.getElementById('apiForm'),
        apiStatus: document.getElementById('apiStatus'),
        apiStatusText: document.getElementById('apiStatusText'),
        statusDot: document.getElementById('statusDot'),
        toggleApiSection: document.getElementById('toggleApiSection'),
        apiKeyInput: document.getElementById('apiKey'),
        customCodeInput: document.getElementById('customCode'),
        toggleApiKeyBtn: document.getElementById('toggleApiKey'),

        // Actions
        summarizeBtn: document.getElementById('summarizeBtn'),
        exportBtn: document.getElementById('exportBtn'),
        deleteEntryBtn: document.getElementById('deleteEntryBtn'),
        retryBtn: document.getElementById('retryBtn'),
        clearHistoryBtn: document.getElementById('clearHistoryBtn'),

        // Content areas
        historyList: document.getElementById('historyList'),
        detailMeta: document.getElementById('detailMeta'),
        detailContent: document.getElementById('detailContent'),
        errorMessage: document.getElementById('errorMessage'),
        loadingText: document.getElementById('loadingText'),
        loadingSubtext: document.getElementById('loadingSubtext'),
        modelStatus: document.getElementById('modelStatus'),
        modelStatusText: document.getElementById('modelStatusText')
    };

    // ============================================
    // State
    // ============================================
    let currentView = 'main';
    let currentSummaryId = null;
    let isProcessing = false;
    let summaryHistory = [];

    // ============================================
    // Initialize
    // ============================================
    async function init() {
        // Load saved data
        await loadData();

        // Update API status
        updateApiStatus();

        // Update model status
        await updateModelStatus();

        // Render history
        renderHistory();

        // Event listeners
        setupEventListeners();
    }

    function setupEventListeners() {
        // Navigation
        elements.backBtn.addEventListener('click', goBack);

        // API Section
        elements.apiHeader.addEventListener('click', toggleApiForm);
        elements.toggleApiKeyBtn.addEventListener('click', toggleApiKeyVisibility);
        elements.apiKeyInput.addEventListener('blur', savePreferences);
        elements.apiKeyInput.addEventListener('input', debounce(savePreferences, 1000));
        elements.customCodeInput.addEventListener('blur', savePreferences);
        elements.customCodeInput.addEventListener('input', debounce(savePreferences, 1000));

        // Actions
        elements.summarizeBtn.addEventListener('click', handleSummarize);
        elements.exportBtn.addEventListener('click', handleExport);
        elements.deleteEntryBtn.addEventListener('click', handleDeleteEntry);
        elements.retryBtn.addEventListener('click', () => showView('main'));
        elements.clearHistoryBtn.addEventListener('click', handleClearHistory);

        // Keyboard shortcuts
        elements.apiKeyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSummarize();
        });
        elements.customCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSummarize();
        });
    }

    // ============================================
    // Data Management
    // ============================================
    async function loadData() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['apiKey', 'customCode', 'summaryHistory'], (result) => {
                if (result.apiKey) {
                    elements.apiKeyInput.value = result.apiKey;
                }
                if (result.customCode) {
                    elements.customCodeInput.value = result.customCode;
                }
                summaryHistory = result.summaryHistory || [];
                resolve();
            });
        });
    }

    function savePreferences() {
        const apiKey = elements.apiKeyInput.value.trim();
        const customCode = elements.customCodeInput.value.trim();

        chrome.storage.local.set({
            apiKey: apiKey || null,
            customCode: customCode || null
        });

        updateApiStatus();
    }

    async function saveSummary(summaryData) {
        const entry = {
            id: Date.now().toString(),
            title: summaryData.title || 'Untitled Page',
            url: summaryData.url,
            hostname: new URL(summaryData.url).hostname,
            favicon: `https://www.google.com/s2/favicons?domain=${new URL(summaryData.url).hostname}&sz=32`,
            summary: summaryData.summary,
            wordCount: summaryData.wordCount,
            charCount: summaryData.charCount,
            sourceElement: summaryData.sourceElement,
            modelInfo: summaryData.modelInfo,
            createdAt: new Date().toISOString()
        };

        // Add to beginning of array (newest first)
        summaryHistory.unshift(entry);

        // Keep only last 50 entries
        if (summaryHistory.length > 50) {
            summaryHistory = summaryHistory.slice(0, 50);
        }

        await chrome.storage.local.set({ summaryHistory });
        return entry;
    }

    async function deleteSummary(id) {
        summaryHistory = summaryHistory.filter(entry => entry.id !== id);
        await chrome.storage.local.set({ summaryHistory });
    }

    async function clearAllHistory() {
        summaryHistory = [];
        await chrome.storage.local.set({ summaryHistory });
    }

    // ============================================
    // View Management
    // ============================================
    function showView(viewName) {
        Object.values(views).forEach(view => view.classList.add('hidden'));
        if (views[viewName]) {
            views[viewName].classList.remove('hidden');
        }
        currentView = viewName;

        // Update header
        if (viewName === 'main') {
            elements.backBtn.classList.add('hidden');
            elements.headerTitle.textContent = 'Page Summariser';
        } else if (viewName === 'detail') {
            elements.backBtn.classList.remove('hidden');
            elements.headerTitle.textContent = 'Summary';
        } else if (viewName === 'loading') {
            elements.backBtn.classList.add('hidden');
            elements.headerTitle.textContent = 'Page Summariser';
        } else if (viewName === 'error') {
            elements.backBtn.classList.remove('hidden');
            elements.headerTitle.textContent = 'Page Summariser';
        }
    }

    function goBack() {
        currentSummaryId = null;
        showView('main');
    }

    // ============================================
    // UI Updates
    // ============================================
    function updateApiStatus() {
        const hasApiKey = elements.apiKeyInput.value.trim().length > 0;

        if (hasApiKey) {
            elements.statusDot.classList.add('active');
            elements.apiStatusText.textContent = 'API Key Configured';
        } else {
            elements.statusDot.classList.remove('active');
            elements.apiStatusText.textContent = 'API Key Not Set';
        }
    }

    async function updateModelStatus() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getModelStatus' });

            if (!response) {
                elements.modelStatusText.textContent = 'Model status unavailable';
                return;
            }

            const { exhaustedModels, totalFreeModels, availableModels } = response;
            const available = availableModels?.length || 0;
            const total = totalFreeModels || 5;
            const exhausted = exhaustedModels?.length || 0;

            // Update status display
            elements.modelStatus.classList.remove('warning', 'danger');

            if (available === 0) {
                elements.modelStatus.classList.add('danger');
                elements.modelStatusText.innerHTML = `<strong>All ${total} free models exhausted</strong> • Resets at midnight UTC`;
            } else if (exhausted > 0) {
                elements.modelStatus.classList.add('warning');
                elements.modelStatusText.innerHTML = `<strong>${available}/${total} free models available</strong> • Auto-cycling enabled`;
            } else {
                elements.modelStatusText.innerHTML = `<strong>${available} free models ready</strong> • Auto-cycling enabled`;
            }
        } catch (error) {
            console.log('Could not get model status:', error);
            elements.modelStatusText.textContent = 'Free models with auto-cycling';
        }
    }

    function toggleApiForm() {
        const isHidden = elements.apiForm.classList.contains('hidden');
        elements.apiForm.classList.toggle('hidden');
        elements.toggleApiSection.classList.toggle('rotated', isHidden);
    }

    function toggleApiKeyVisibility() {
        const input = elements.apiKeyInput;
        if (input.type === 'password') {
            input.type = 'text';
            elements.toggleApiKeyBtn.textContent = '🙈';
        } else {
            input.type = 'password';
            elements.toggleApiKeyBtn.textContent = '👁️';
        }
    }

    function updateLoadingText(mainText, subText = '') {
        if (elements.loadingText) {
            elements.loadingText.textContent = mainText;
        }
        if (elements.loadingSubtext) {
            elements.loadingSubtext.textContent = subText;
        }
    }

    // ============================================
    // History Rendering
    // ============================================
    function renderHistory() {
        if (summaryHistory.length === 0) {
            elements.historyList.innerHTML = `
                <div class="empty-history">
                    <span class="empty-icon">📝</span>
                    <p>No summaries yet</p>
                    <small>Summarize a page to see it here</small>
                </div>
            `;
            return;
        }

        elements.historyList.innerHTML = summaryHistory.map(entry => `
            <div class="history-item" data-id="${entry.id}">
                <div class="history-item-title">${escapeHtml(entry.title)}</div>
                <div class="history-item-meta">
                    <span class="history-item-site">
                        <img src="${entry.favicon}" alt="" onerror="this.style.display='none'">
                        ${escapeHtml(entry.hostname)}
                    </span>
                    <span class="history-item-date">${formatDate(entry.createdAt)}</span>
                </div>
            </div>
        `).join('');

        // Add click handlers
        elements.historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => openSummary(item.dataset.id));
        });
    }

    function formatDate(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        const diff = now - date;

        // Today
        if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // Yesterday
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth()) {
            return 'Yesterday';
        }

        // This week
        if (diff < 7 * 24 * 60 * 60 * 1000) {
            return date.toLocaleDateString([], { weekday: 'short' });
        }

        // Older
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // ============================================
    // Summary Detail View
    // ============================================
    function openSummary(id) {
        const entry = summaryHistory.find(e => e.id === id);
        if (!entry) return;

        currentSummaryId = id;

        // Build model info HTML
        let modelBadge = '';
        if (entry.modelInfo && entry.modelInfo.name) {
            const fallbackNote = entry.modelInfo.fallbackUsed ? ' (fallback)' : '';
            modelBadge = `<div class="model-badge">🤖 ${entry.modelInfo.name}${fallbackNote}</div>`;
        } else if (entry.modelInfo && entry.modelInfo.id) {
            modelBadge = `<div class="model-badge">🤖 ${entry.modelInfo.id}</div>`;
        }

        elements.detailMeta.innerHTML = `
            <div class="detail-title">${escapeHtml(entry.title)}</div>
            <div class="detail-info">
                <span class="detail-info-item">
                    🌐 <a href="${entry.url}" target="_blank">${entry.hostname}</a>
                </span>
                <span class="detail-info-item">
                    📅 ${new Date(entry.createdAt).toLocaleString()}
                </span>
                <span class="detail-info-item">
                    📝 ${entry.wordCount?.toLocaleString() || 0} words
                </span>
            </div>
            ${modelBadge}
        `;

        elements.detailContent.textContent = entry.summary;
        showView('detail');
    }

    // ============================================
    // Summarize Action
    // ============================================
    async function handleSummarize() {
        if (isProcessing) return;

        const apiKey = elements.apiKeyInput.value.trim();
        const customCode = elements.customCodeInput.value.trim();

        if (!apiKey) {
            // Show API form if not visible
            if (elements.apiForm.classList.contains('hidden')) {
                toggleApiForm();
            }
            elements.apiKeyInput.focus();
            showToast('Please enter your OpenRouter API key', 'error');
            return;
        }

        // Save preferences
        chrome.storage.local.set({
            apiKey: apiKey,
            customCode: customCode || null
        });

        isProcessing = true;
        showView('loading');
        updateLoadingText('Extracting content...', '');
        elements.summarizeBtn.disabled = true;

        try {
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab) {
                throw new Error('Could not access current tab. Please refresh and try again.');
            }

            // Check if tab URL is accessible
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
                tab.url.startsWith('edge://') || tab.url.startsWith('opera://')) {
                throw new Error('Cannot summarize browser system pages.');
            }

            // Inject content script
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content/content.js']
                });
            } catch (e) {
                console.log('Content script injection note:', e.message);
            }

            await new Promise(resolve => setTimeout(resolve, 100));

            // Extract content
            updateLoadingText('Extracting page content...', '');
            let contentResponse;
            try {
                contentResponse = await chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });
            } catch (e) {
                if (e.message.includes('Could not establish connection')) {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content/content.js']
                    });
                    await new Promise(resolve => setTimeout(resolve, 200));
                    contentResponse = await chrome.tabs.sendMessage(tab.id, { action: 'extractContent' });
                } else {
                    throw new Error('Failed to communicate with page. Please refresh and try again.');
                }
            }

            if (!contentResponse || !contentResponse.success) {
                throw new Error(contentResponse?.error || 'Failed to extract page content.');
            }

            if (!contentResponse.content || contentResponse.content.trim().length === 0) {
                throw new Error('No text content found on this page.');
            }

            // Update loading with content info
            const wordCount = contentResponse.wordCount || 0;
            const estimatedTokens = Math.ceil((contentResponse.charCount || 0) / 4);

            if (estimatedTokens > 3000) {
                updateLoadingText(
                    'Processing large content...',
                    `Using chunking for ${wordCount.toLocaleString()} words`
                );
            } else {
                updateLoadingText(
                    'Summarizing content...',
                    `Processing ${wordCount.toLocaleString()} words`
                );
            }

            // Send to background for summarization
            console.log('=== POPUP: Sending to background ===');
            console.log('Content length:', contentResponse.content?.length);

            const summaryResponse = await chrome.runtime.sendMessage({
                action: 'summarize',
                text: contentResponse.content,
                apiKey: apiKey,
                customCode: customCode || null
            });

            console.log('=== POPUP: Response received ===');
            console.log('Success:', summaryResponse?.success);

            if (!summaryResponse || !summaryResponse.success) {
                throw new Error(summaryResponse?.error || 'Failed to summarize content');
            }

            // Save to history
            const entry = await saveSummary({
                title: contentResponse.title,
                url: contentResponse.url,
                summary: summaryResponse.summary,
                wordCount: contentResponse.wordCount,
                charCount: contentResponse.charCount,
                sourceElement: contentResponse.sourceElement,
                modelInfo: summaryResponse.modelInfo
            });

            // Refresh history and open the new summary
            renderHistory();
            openSummary(entry.id);
            showToast('Summary created successfully!');

        } catch (error) {
            console.error('Summarization error:', error);
            showError(error.message || 'An unexpected error occurred');
        } finally {
            isProcessing = false;
            elements.summarizeBtn.disabled = false;
            // Update model status after each attempt
            await updateModelStatus();
        }
    }

    // ============================================
    // Export Action
    // ============================================
    async function handleExport() {
        const entry = summaryHistory.find(e => e.id === currentSummaryId);
        if (!entry) {
            showToast('No summary to export', 'error');
            return;
        }

        try {
            const sanitizedTitle = sanitizeFilename(entry.title || 'summary');
            const filename = `${sanitizedTitle}.txt`;

            const fileContent = `Page Summary
${'='.repeat(50)}

Title: ${entry.title}
URL: ${entry.url}
Date: ${new Date(entry.createdAt).toLocaleString()}
${entry.modelInfo?.name ? `Model: ${entry.modelInfo.name}` : ''}

${'='.repeat(50)}

${entry.summary}
`;

            // Try File System Access API first
            if ('showSaveFilePicker' in window) {
                try {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [{
                            description: 'Text files',
                            accept: { 'text/plain': ['.txt'] }
                        }]
                    });

                    const writable = await fileHandle.createWritable();
                    await writable.write(fileContent);
                    await writable.close();

                    showToast('File saved successfully!');
                    return;
                } catch (error) {
                    if (error.name === 'AbortError') return;
                }
            }

            // Fallback to Downloads API
            const blob = new Blob([fileContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);

            await chrome.downloads.download({
                url: url,
                filename: filename,
                saveAs: true
            });

            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast('File download started!');

        } catch (error) {
            console.error('Export error:', error);
            showToast('Failed to export file', 'error');
        }
    }

    // ============================================
    // Delete Actions
    // ============================================
    async function handleDeleteEntry() {
        if (!currentSummaryId) return;

        const entry = summaryHistory.find(e => e.id === currentSummaryId);
        if (!entry) return;

        showConfirmModal({
            icon: '🗑️',
            title: 'Delete Summary?',
            message: `Are you sure you want to delete "${truncate(entry.title, 40)}"?`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger-outline',
            onConfirm: async () => {
                await deleteSummary(currentSummaryId);
                renderHistory();
                goBack();
                showToast('Summary deleted');
            }
        });
    }

    async function handleClearHistory() {
        if (summaryHistory.length === 0) return;

        showConfirmModal({
            icon: '⚠️',
            title: 'Clear All History?',
            message: `This will permanently delete all ${summaryHistory.length} summaries. This cannot be undone.`,
            confirmText: 'Clear All',
            confirmClass: 'btn-danger-outline',
            onConfirm: async () => {
                await clearAllHistory();
                renderHistory();
                showToast('History cleared');
            }
        });
    }

    // ============================================
    // Modal & Toast
    // ============================================
    function showConfirmModal({ icon, title, message, confirmText, confirmClass, onConfirm }) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-icon">${icon}</div>
                <div class="modal-title">${title}</div>
                <div class="modal-message">${message}</div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="modalCancel">Cancel</button>
                    <button class="btn ${confirmClass || 'btn-primary'}" id="modalConfirm">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cleanup = () => overlay.remove();

        overlay.querySelector('#modalCancel').addEventListener('click', cleanup);
        overlay.querySelector('#modalConfirm').addEventListener('click', () => {
            cleanup();
            onConfirm();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup();
        });
    }

    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type === 'error' ? 'error' : ''}`;
        toast.innerHTML = `${type === 'success' ? '✓' : '✕'} ${message}`;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    function showError(message) {
        elements.errorMessage.textContent = message;
        showView('error');
    }

    // ============================================
    // Utilities
    // ============================================
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function sanitizeFilename(filename) {
        return filename
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 100)
            .trim() || 'summary';
    }

    function truncate(str, length) {
        if (!str) return '';
        return str.length > length ? str.substring(0, length) + '...' : str;
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // ============================================
    // Initialize on load
    // ============================================
    init();
})();

