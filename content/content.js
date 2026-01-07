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
        // Prioritize lists over other content
        const textContent = [];

        log('=== LOOKING FOR CONTENT ===');
        log(`Clone element: ${clone.tagName}, children: ${clone.children.length}`);
        log(`Clone text length: ${clone.textContent?.length || 0} chars`);

        // FIRST: Check for numbered headings pattern (Top 10 lists, etc.)
        // This is prioritized because it's the most reliable pattern for list articles

        log('=== LOOKING FOR NUMBERED HEADINGS (PRIORITY) ===');

        // Look for numbered headings (e.g., "10) Title", "1. Title", "#1 Title")
        const allHeadings = clone.querySelectorAll('h2, h3');
        log(`Found ${allHeadings.length} h2/h3 headings`);

        const numberedItems = [];

        allHeadings.forEach((heading, idx) => {
            const headingText = heading.textContent.trim();
            log(`Heading ${idx}: "${headingText.substring(0, 50)}..."`);

            // Match patterns like "10)", "10.", "#10", "10 -", "10:"
            const numberMatch = headingText.match(/^[\#]?(\d+)[\)\.\:\-\s]/);

            if (numberMatch) {
                log(`  -> Matched number: ${numberMatch[1]}`);

                // Found a numbered heading, get the next paragraph(s)
                let description = '';
                let nextEl = heading.nextElementSibling;
                let paraCount = 0;

                log(`  -> Looking for paragraphs after heading...`);

                // Skip figures/images and collect paragraphs
                while (nextEl && paraCount < 2) {
                    log(`     Next sibling: ${nextEl.tagName}`);
                    if (nextEl.tagName === 'P') {
                        const paraText = nextEl.textContent.trim();
                        log(`     Paragraph found: ${paraText.length} chars`);
                        if (paraText.length > 20) {
                            description += (description ? ' ' : '') + paraText;
                            paraCount++;
                        }
                    } else if (nextEl.tagName === 'FIGURE' || nextEl.tagName === 'IMG') {
                        log(`     Skipping figure/img`);
                    } else if (nextEl.tagName && nextEl.tagName.match(/^H[1-6]$/)) {
                        log(`     Hit next heading, stopping`);
                        break;
                    }
                    nextEl = nextEl.nextElementSibling;
                }

                log(`  -> Description length: ${description.length}`);

                if (description.length > 30) {
                    if (description.length > 600) {
                        description = description.substring(0, 600) + '...';
                    }
                    numberedItems.push({
                        number: parseInt(numberMatch[1]),
                        title: headingText,
                        description: description
                    });
                    log(`  -> ADDED to numberedItems`);
                }
            }
        });

        log(`Total numbered items found: ${numberedItems.length}`);

        // If we found numbered items, use them
        if (numberedItems.length >= 3) {
            // Sort by number (descending for "top 10" style, ascending for "1-10" style)
            numberedItems.sort((a, b) => b.number - a.number);

            numberedItems.forEach(item => {
                textContent.push(`${item.title}\n${item.description}`);
            });

            const numberedText = textContent.join('\n\n');
            if (numberedText.length > 10000) {
                return numberedText.substring(0, 10000) + '\n\n[Content truncated]';
            }
            return numberedText;
        }

        // Fallback 1: Look for ordered lists (OL) which are usually main content
        log('=== FALLBACK: LOOKING FOR ORDERED LISTS ===');
        const orderedLists = clone.querySelectorAll('ol');
        if (orderedLists.length > 0) {
            let mainList = null;
            let maxItems = 0;
            orderedLists.forEach((list, idx) => {
                const itemCount = list.querySelectorAll('li').length;
                log(`OL ${idx}: ${itemCount} items`);
                if (itemCount > maxItems) {
                    maxItems = itemCount;
                    mainList = list;
                }
            });

            if (mainList && maxItems >= 3) {
                const listItems = mainList.querySelectorAll('li');
                listItems.forEach((item, index) => {
                    let itemText = item.textContent.trim();
                    if (itemText.length > 500) {
                        itemText = itemText.substring(0, 500) + '...';
                    }
                    if (itemText && itemText.length > 10) {
                        textContent.push(`${index + 1}. ${itemText}`);
                    }
                });

                if (textContent.length >= 3) {
                    log(`Using ordered list with ${textContent.length} items`);
                    const listText = textContent.join('\n\n');
                    if (listText.length > 10000) {
                        return listText.substring(0, 10000) + '\n\n[Content truncated]';
                    }
                    return listText;
                }
            }
        }

        // Fallback 2: Look for sections or article items
        const sections = clone.querySelectorAll('section, .slide, .item, .gallery-item');

        if (sections.length >= 3) {
            let itemIndex = 0;
            sections.forEach(section => {
                const heading = section.querySelector('h1, h2, h3, h4, h5');
                const paragraphs = section.querySelectorAll('p');

                if (heading || paragraphs.length > 0) {
                    itemIndex++;
                    let sectionText = '';

                    if (heading) {
                        sectionText = heading.textContent.trim();
                    }

                    if (paragraphs.length > 0) {
                        const paraTexts = Array.from(paragraphs)
                            .map(p => p.textContent.trim())
                            .filter(t => t.length > 20)
                            .slice(0, 2);

                        if (paraTexts.length > 0) {
                            sectionText += (sectionText ? ': ' : '') + paraTexts.join(' ');
                        }
                    }

                    if (sectionText && sectionText.length > 30) {
                        if (sectionText.length > 500) {
                            sectionText = sectionText.substring(0, 500) + '...';
                        }
                        textContent.push(`${itemIndex}. ${sectionText}`);
                    }
                }
            });

            if (textContent.length >= 3) {
                const sectionText = textContent.join('\n\n');
                if (sectionText.length > 10000) {
                    return sectionText.substring(0, 10000) + '\n\n[Content truncated]';
                }
                return sectionText;
            }
        }

        // Fallback: Extract paragraphs directly
        log('=== FALLBACK: EXTRACTING PARAGRAPHS ===');
        const allParagraphs = clone.querySelectorAll('p');
        log(`Found ${allParagraphs.length} paragraph elements`);

        if (allParagraphs.length > 0) {
            let addedCount = 0;
            allParagraphs.forEach((p, idx) => {
                const text = p.textContent.trim();
                if (idx < 5) {
                    log(`Paragraph ${idx}: ${text.length} chars - "${text.substring(0, 50)}..."`);
                }
                // Filter out short and unwanted paragraphs
                if (text.length >= 50) {
                    const lower = text.toLowerCase();
                    if (!lower.includes('cookie') &&
                        !lower.includes('subscribe to') &&
                        !lower.includes('newsletter') &&
                        !lower.includes('follow us on') &&
                        !lower.includes('share this')) {

                        let paraText = text;
                        if (paraText.length > 600) {
                            paraText = paraText.substring(0, 600) + '...';
                        }
                        textContent.push(paraText);
                        addedCount++;
                    }
                }
            });
            log(`Added ${addedCount} paragraphs to content`);
        }

        // If still no content, try raw text extraction as last resort
        if (textContent.length === 0) {
            log('=== LAST RESORT: RAW TEXT EXTRACTION ===');
            const remainingText = clone.textContent || clone.innerText || '';
            log(`Raw text length: ${remainingText.length}`);
            const paragraphs = remainingText
                .split(/\n\s*\n/)
                .map(p => p.trim())
                .filter(p => p.length >= 50)
                .slice(0, 20);

            log(`Split into ${paragraphs.length} text blocks`);

            paragraphs.forEach(para => {
                const trimmed = para.trim();
                if (trimmed && !textContent.includes(trimmed)) {
                    textContent.push(trimmed);
                }
            });
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

        // Limit total content to prevent issues (max 10000 chars)
        if (finalText.length > 10000) {
            return finalText.substring(0, 10000) + '\n\n[Content truncated - 10,000 char limit]';
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

