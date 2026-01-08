// Content script to extract text content from webpage
// Preserves list structure and prioritizes main content areas

(function () {
    'use strict';

    // Debug logging
    const DEBUG = true;
    function log(...args) {
        if (DEBUG) console.log('[PageSummariser]', ...args);
    }

    // Function to extract main content from page
    function extractMainContent() {
        log('=== EXTRACTING MAIN CONTENT ===');

        // Priority selectors for main content
        const contentSelectors = [
            'article',
            'main',
            '[role="main"]',
            '.article-body',
            '.article-content',
            '.post-content',
            '.entry-content',
            '.content-body',
            '.story-content',
            '.page-content',
            '.content',
            '.post',
            '.article',
            '#content',
            '#main-content',
            '.main-content',
            // Slideshow/gallery list pages
            '.gallery-content',
            '.slideshow-content',
            '.list-content'
        ];

        let mainContent = null;
        let usedSelector = null;

        // Try to find main content using priority selectors
        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                mainContent = element;
                usedSelector = selector;
                log(`Found main content with selector: ${selector}`);
                log(`Element tag: ${element.tagName}, classes: ${element.className}`);
                break;
            }
        }

        // Fallback to body if no main content found
        if (!mainContent) {
            mainContent = document.body;
            usedSelector = 'body (fallback)';
            log('No main content found, using body as fallback');
        }

        return { element: mainContent, selector: usedSelector };
    }

    // Function to clean and extract text while preserving structure
    function extractText(element) {
        // Clone the element to avoid modifying the original
        const clone = element.cloneNode(true);

        // Comprehensive list of unwanted elements (ads, navigation, etc.)
        // NOTE: Avoid overly broad patterns like [class*="ad"] which matches "heading", "loading", etc.
        const unwantedSelectors = [
            'script',
            'style',
            'nav',
            'header:not(.article-header):not(.entry-header):not(.post-header)',
            'footer',
            'aside',
            'noscript',
            // Ads and sponsored content - be specific
            '.advertisement',
            '.ad-container',
            '.ad-wrapper',
            '.ad-slot',
            '.ad-unit',
            '.google-ad',
            '.adsbygoogle',
            '[class^="ad-"]',
            '[class$="-ad"]',
            '[class*="advertisement"]',
            '[class*="sponsor"]',
            '[class*="promo-"]',
            '[id^="ad-"]',
            '[id$="-ad"]',
            '[data-ad]',
            '[data-ad-slot]',
            // Sidebars and navigation
            '.sidebar',
            '.navigation',
            '.menu',
            '.breadcrumb',
            '.breadcrumbs',
            // Social and sharing
            '.social-share',
            '.share-buttons',
            '.social-links',
            // Comments and related content
            '.comments',
            '.comment-section',
            '.related-posts',
            '.related-content',
            '.recommended',
            '.recommendations',
            '[class*="next-read"]',
            '[class*="you-may-like"]',
            '[class*="also-read"]',
            '[class*="trending"]',
            '[class*="more-from"]',
            // Newsletter and signup
            '.newsletter',
            '.signup-form',
            '[class*="newsletter"]',
            // Popups and modals
            '.popup',
            '.modal',
            // Cookie notices
            '.cookie-banner',
            '.cookie-notice',
            '[id*="cookie"]',
            // Skip links
            '.skip-link',
            // Media elements
            'iframe',
            'embed',
            'object',
            // Sidebar sections
            '[role="complementary"]',
            '.most-viewed',
            '.most-popular',
            '.trending-now',
            '[class*="most-viewed"]',
            '[class*="sidebar"]'
        ];

        // Remove unwanted elements
        log('=== REMOVING UNWANTED ELEMENTS ===');
        let removedCount = 0;
        unwantedSelectors.forEach(selector => {
            try {
                const elements = clone.querySelectorAll(selector);
                if (elements.length > 0) {
                    log(`Removing ${elements.length} elements matching: ${selector}`);
                    removedCount += elements.length;
                }
                elements.forEach(el => {
                    el.remove();
                });
            } catch (e) {
                // Ignore invalid selectors
            }
        });
        log(`Total removed: ${removedCount} elements`);

        // Remove elements with common ad-related attributes
        const allElements = clone.querySelectorAll('*');
        allElements.forEach(el => {
            // Check for data attributes that indicate ads
            if (el.hasAttribute('data-ad') ||
                el.hasAttribute('data-ad-slot') ||
                el.hasAttribute('data-ad-client')) {
                el.remove();
                return;
            }

            // Check for specific ad-related class patterns (not just containing "ad")
            if (el.className && typeof el.className === 'string') {
                const classes = el.className.toLowerCase();
                if (classes.match(/\bad\b/) || // standalone "ad" class
                    classes.match(/\bad-/) ||   // "ad-" prefix
                    classes.match(/-ad\b/) ||   // "-ad" suffix
                    classes.includes('advert') ||
                    classes.includes('sponsor')) {
                    el.remove();
                    return;
                }
            }
        });

        // Extract text while preserving list structure
        // Linear traversal strategy: walk important block elements in order
        const textContent = [];

        log('=== LOOKING FOR CONTENT ===');
        log(`Clone element: ${clone.tagName}, children: ${clone.children.length}`);

        // Select all meaningful block elements
        // We select them in document order
        const blockSelectors = [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p',
            'li',
            'blockquote',
            'pre',
            'figcaption'
        ];

        const contentNodes = clone.querySelectorAll(blockSelectors.join(','));
        log(`Found ${contentNodes.length} content nodes`);

        let skippedCount = 0;
        let addedCount = 0;

        contentNodes.forEach((node, idx) => {
            // Skip nodes that are inside other nodes we already processed?
            // querySelectorAll returns all descendants.
            // If we process a <p>, we want it. If we process a <li> that contains a <p>, we might get duplicate text if we aren't careful.
            // But usually <li> contains text directly or inline elements.
            // A <p> inside a <p> is invalid.
            // A <p> inside a <li> is valid. 
            // If we verify the node has text content and isn't just a container for other blocks we already grabbed, we are good.
            // Simple heuristic based on text content is usually fine for summarization.

            const text = node.textContent.trim();

            // Filter short/empty content
            if (text.length < 10) {
                skippedCount++;
                return;
            }

            // Exclude noise patterns
            const lower = text.toLowerCase();
            if (lower.includes('cookie') && lower.length < 100 ||
                lower.includes('subscribe to') ||
                lower.includes('all rights reserved') ||
                lower.includes('follow us on') ||
                lower.includes('share this')) {
                skippedCount++;
                return;
            }

            // formatting
            let formattedText = text;

            // Format headings
            if (node.tagName.match(/^H\d$/)) {
                formattedText = `\n## ${text}\n`;
            }
            // Format list items
            else if (node.tagName === 'LI') {
                formattedText = `• ${text}`;
            }
            // Format quotes
            else if (node.tagName === 'BLOCKQUOTE') {
                formattedText = `> ${text}`;
            }

            // Avoid adding identical text if it was just added (deduplication)
            // This helps if <li> contains <p> and we select both. 
            // The querySelectorAll sequence is document order (depth-first usually).
            // Parent comes before child? No, actually traversal order.
            // If we have <ul><li><p>text</p></li></ul>:
            // Matches: LI, P.
            // Order: LI comes first in generic traversal, then P inside it?

            // Actually, simply checking if the text is contained in the *immediately preceding* item is often enough
            // But we need to be careful.
            // Safer to check if the current node contains other selected nodes, but that's expensive.

            // Alternative: use NodeIterator or TreeWalker.
            // Or keep it simple: if we added "Text X" and now we see "Text X" again, skip.

            if (textContent.length > 0) {
                const lastItem = textContent[textContent.length - 1].trim();
                // Check if strict duplicate
                if (lastItem === formattedText.trim()) return;

                // Check if one contains the other (nested case)
                if (lastItem.includes(formattedText.trim()) && formattedText.length > 20) return; // Child text already inside parent
                // Note: If parent text was added, it likely includes child text.
            }

            textContent.push(formattedText);
            addedCount++;
        });

        // Fallback: If structured blocks yielded nothing (e.g. text nodes directly in DIVs), try raw text
        if (addedCount === 0) {
            log('=== FALLBACK: RAW TEXT EXTRACTION ===');
            const remainingText = clone.innerText || clone.textContent || '';
            const paragraphs = remainingText
                .split(/\n\s*\n/)
                .map(p => p.trim())
                .filter(p => p.length >= 50);

            paragraphs.forEach(p => textContent.push(p));
        }

        const finalText = textContent.join('\n\n');

        log('=== FINAL RESULT ===');
        log(`Final text length: ${finalText.length} chars`);
        log(`Final content items: ${textContent.length}`);
        if (finalText.length > 0) {
            log(`Preview: "${finalText.substring(0, 100)}..."`);
        } else {
            log('WARNING: No content extracted!');
        }

        // Limit total content to prevent issues (max 12000 chars)
        if (finalText.length > 12000) {
            return finalText.substring(0, 12000) + '\n\n[Content truncated - 12,000 char limit]';
        }

        return finalText;
    }

    // Function to get page title
    function getPageTitle() {
        return document.title || 'Untitled Page';
    }

    // Function to count words
    function countWords(text) {
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }

    // Function to count characters
    function countCharacters(text) {
        return text.trim().length;
    }

    // Function to get content preview (first 200 characters)
    function getContentPreview(text) {
        const preview = text.trim().substring(0, 200);
        return preview + (text.length > 200 ? '...' : '');
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'extractContent') {
            try {
                const { element: mainContent, selector: usedSelector } = extractMainContent();
                const text = extractText(mainContent);
                const title = getPageTitle();
                const url = window.location.href;
                const wordCount = countWords(text);
                const charCount = countCharacters(text);
                const preview = getContentPreview(text);

                sendResponse({
                    success: true,
                    content: text,
                    title: title,
                    url: url,
                    wordCount: wordCount,
                    charCount: charCount,
                    preview: preview,
                    sourceElement: usedSelector
                });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error.message
                });
            }
        }
        return true; // Keep channel open for async response
    });
})();

