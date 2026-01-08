// Background service worker for handling OpenRouter API calls
// With robust logging, error handling, and automatic model fallback
// VERSION 2.5 - Auto model cycling

const SW_VERSION = '2.7';
console.log(`=== PAGE SUMMARISER SERVICE WORKER v${SW_VERSION} LOADED ===`);
console.log('Timestamp:', new Date().toISOString());

// Configuration
const CONFIG = {
    CHUNK_SIZE: 1500,           // Characters per chunk (~375 tokens)
    DELAY_BETWEEN_CHUNKS: 4000, // 4 seconds between API calls
    MAX_RETRIES: 1,             // Retries per model before trying next
    RETRY_BASE_DELAY: 3000,     // 3 second delay before retry
    MAX_TOKENS_PER_CHUNK: 500,  // Max tokens for each chunk summary
    DEFAULT_MODEL: 'deepseek/deepseek-chat-v3.1',
    DEBUG: true
};

// Free models to cycle through (in order of preference) - Updated January 2026
const FREE_MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1:free',
    'qwen/qwen-2.5-coder-32b-instruct:free',
    'cognitivecomputations/dolphin-mistral-24b-venice-edition:free'
];

// Track exhausted models for the day (resets at midnight UTC)
let exhaustedModels = new Set();
let lastResetDate = new Date().toUTCString().split(' ').slice(0, 4).join(' ');

// Model information lookup - Updated January 2026
const MODEL_INFO = {
    // Free models
    'google/gemini-2.0-flash-exp:free': { name: 'Gemini 2.0 Flash', context: '1M tokens', provider: 'Google' },
    'meta-llama/llama-3.3-70b-instruct:free': { name: 'Llama 3.3 70B', context: '128K tokens', provider: 'Meta' },
    'deepseek/deepseek-r1:free': { name: 'DeepSeek R1', context: '128K tokens', provider: 'DeepSeek' },
    'qwen/qwen-2.5-coder-32b-instruct:free': { name: 'Qwen 2.5 Coder 32B', context: '32K tokens', provider: 'Alibaba' },
    'cognitivecomputations/dolphin-mistral-24b-venice-edition:free': { name: 'Dolphin Mistral 24B', context: '32K tokens', provider: 'Cognitive Computations' },
    // Paid models
    'openai/gpt-3.5-turbo': { name: 'GPT-3.5 Turbo', context: '16K tokens', provider: 'OpenAI' },
    'openai/gpt-4o-mini': { name: 'GPT-4o Mini', context: '128K tokens', provider: 'OpenAI' },
    'anthropic/claude-3-haiku': { name: 'Claude 3 Haiku', context: '200K tokens', provider: 'Anthropic' }
};

// Check and reset exhausted models at midnight
function checkDailyReset() {
    const currentDate = new Date().toUTCString().split(' ').slice(0, 4).join(' ');
    if (currentDate !== lastResetDate) {
        log('info', `New day detected. Resetting exhausted models. Previous: ${exhaustedModels.size} models`);
        exhaustedModels.clear();
        lastResetDate = currentDate;
        // Also clear from storage
        chrome.storage.local.remove('exhaustedModels');
    }
}

// Load exhausted models from storage
async function loadExhaustedModels() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['exhaustedModels', 'exhaustedModelsDate'], (result) => {
            const storedDate = result.exhaustedModelsDate;
            const currentDate = new Date().toUTCString().split(' ').slice(0, 4).join(' ');

            if (storedDate === currentDate && result.exhaustedModels) {
                exhaustedModels = new Set(result.exhaustedModels);
                log('info', `Loaded ${exhaustedModels.size} exhausted models from storage`);
            } else {
                exhaustedModels.clear();
                log('info', 'Starting fresh - no exhausted models');
            }
            lastResetDate = currentDate;
            resolve();
        });
    });
}

// Save exhausted models to storage
async function saveExhaustedModels() {
    const currentDate = new Date().toUTCString().split(' ').slice(0, 4).join(' ');
    await chrome.storage.local.set({
        exhaustedModels: Array.from(exhaustedModels),
        exhaustedModelsDate: currentDate
    });
}

// Mark a model as exhausted
async function markModelExhausted(modelId) {
    exhaustedModels.add(modelId);
    await saveExhaustedModels();
    log('info', `Model ${modelId} marked as exhausted. Total exhausted: ${exhaustedModels.size}/${FREE_MODELS.length}`);
}

// Get next available free model
function getNextAvailableModel(currentModel) {
    checkDailyReset();

    // Find current model index
    const currentIndex = FREE_MODELS.indexOf(currentModel);

    // Try each model after the current one
    for (let i = 1; i <= FREE_MODELS.length; i++) {
        const nextIndex = (currentIndex + i) % FREE_MODELS.length;
        const nextModel = FREE_MODELS[nextIndex];

        if (!exhaustedModels.has(nextModel)) {
            return nextModel;
        }
    }

    return null; // All models exhausted
}

// Get first available model
function getFirstAvailableModel() {
    checkDailyReset();

    for (const model of FREE_MODELS) {
        if (!exhaustedModels.has(model)) {
            return model;
        }
    }

    return null;
}

// Get model info
function getModelInfo(modelId) {
    if (MODEL_INFO[modelId]) {
        return { ...MODEL_INFO[modelId], id: modelId };
    }
    const parts = modelId.split('/');
    const provider = parts[0] || 'Unknown';
    const name = parts[1] || modelId;
    const isFree = modelId.includes(':free');
    return {
        id: modelId,
        name: name + (isFree ? ' (Free)' : ''),
        context: 'Unknown',
        provider: provider.charAt(0).toUpperCase() + provider.slice(1)
    };
}

// Logging utility
function log(level, message, data = null) {
    const prefix = `[PS ${level.toUpperCase()}]`;
    if (CONFIG.DEBUG || level === 'error') {
        if (data) {
            console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2));
        } else {
            console.log(`${prefix} ${message}`);
        }
    }
}

// Initialize
loadExhaustedModels();

console.log('=== SERVICE WORKER: Setting up message listener ===');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('=== MESSAGE RECEIVED ===', request?.action);

    if (request.action === 'summarize') {
        log('info', 'Received summarize request');
        // Don't await here to return true immediately for async response
        handleSummarize(request, sendResponse);
        return true;
    }

    if (request.action === 'ping') {
        log('info', 'Keep-alive ping received');
        sendResponse({ status: 'alive' });
        return true;
    }

    if (request.action === 'getModelStatus') {
        sendResponse({
            exhaustedModels: Array.from(exhaustedModels),
            totalFreeModels: FREE_MODELS.length,
            availableModels: FREE_MODELS.filter(m => !exhaustedModels.has(m))
        });
        return true;
    }
});

console.log('=== SERVICE WORKER READY ===');

// Keep-alive connection handler
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'keepAlive') {
        log('info', 'Keep-alive port connected');
        port.onDisconnect.addListener(() => {
            log('info', 'Keep-alive port disconnected');
        });
    }
});

async function handleSummarize(request, sendResponse) {
    try {
        // Ensure state is loaded
        await loadExhaustedModels();

        const { text, apiKey, customCode } = request;

        log('info', `Request details: textLength=${text?.length || 0}, hasApiKey=${!!apiKey}, customCode=${customCode || 'default'}`);

        if (!apiKey) {
            sendResponse({ success: false, error: 'API key is required' });
            return;
        }

        if (!text || text.trim().length === 0) {
            sendResponse({ success: false, error: 'No content found on this page.' });
            return;
        }

        // Determine if using custom model or cycling through free models
        const isUsingFreeModels = !customCode || FREE_MODELS.includes(customCode);
        let model = customCode || getFirstAvailableModel();

        if (!model) {
            sendResponse({
                success: false,
                error: 'All free models exhausted for today!\n\nOptions:\n• Wait until midnight UTC for reset\n• Add credits to OpenRouter\n• Use a paid model (e.g., openai/gpt-4o-mini)'
            });
            return;
        }

        const textLength = text.length;
        const inputTokens = Math.ceil(textLength / 4);

        log('info', `Content: ${textLength} chars, ~${inputTokens} tokens`);
        log('info', `Starting with model: ${model}`);
        log('info', `Free model cycling: ${isUsingFreeModels ? 'enabled' : 'disabled (custom model)'}`);

        let summary;
        let chunksUsed = 1;
        let actualModel = model;
        let attempts = 0;
        const maxAttempts = isUsingFreeModels ? FREE_MODELS.length : 1;

        while (attempts < maxAttempts) {
            attempts++;

            try {
                log('info', `Attempt ${attempts}/${maxAttempts} with model: ${actualModel}`);

                if (textLength > CONFIG.CHUNK_SIZE) {
                    log('info', 'Using chunking strategy');
                    const result = await summarizeWithChunking(text, apiKey, actualModel);
                    summary = result.summary || result;
                    chunksUsed = result.chunks || Math.ceil(textLength / CONFIG.CHUNK_SIZE);
                } else {
                    log('info', 'Single request (small content)');
                    summary = await summarizeSingleChunk(text, apiKey, actualModel, 'full');
                }

                // Success!
                const modelInfo = getModelInfo(actualModel);
                const outputTokens = Math.ceil(summary.length / 4);

                log('info', `✓ Success with ${actualModel}: ${summary.length} chars`);

                sendResponse({
                    success: true,
                    summary: summary,
                    modelInfo: {
                        id: actualModel,
                        name: modelInfo.name + ' (Free)',
                        provider: modelInfo.provider,
                        contextWindow: modelInfo.context,
                        inputTokens: inputTokens,
                        outputTokens: outputTokens,
                        chunksUsed: chunksUsed,
                        fallbackUsed: actualModel !== model
                    }
                });
                return;

            } catch (error) {
                log('error', `Model ${actualModel} failed: ${error.message}`);

                // Check if this is a rate limit / daily limit error
                const isRateLimit = error.message.includes('Rate limit') ||
                    error.message.includes('daily limit') ||
                    error.message.includes('exhausted') ||
                    error.message.includes('429') ||
                    error.isRateLimited;

                if (isRateLimit && isUsingFreeModels) {
                    // Mark this model as exhausted and try next
                    await markModelExhausted(actualModel);

                    const nextModel = getNextAvailableModel(actualModel);
                    if (nextModel) {
                        log('info', `Switching to fallback model: ${nextModel}`);
                        actualModel = nextModel;
                        // Small delay before trying next model
                        await delay(1000);
                        continue;
                    } else {
                        // All models exhausted
                        sendResponse({
                            success: false,
                            error: `All free models exhausted for today!\n\nTried ${exhaustedModels.size} models.\n\nOptions:\n• Wait until midnight UTC\n• Add credits to OpenRouter\n• Use a paid model`
                        });
                        return;
                    }
                } else {
                    // Non-rate-limit error or custom model - don't fallback
                    throw error;
                }
            }
        }

        // Should not reach here, but just in case
        sendResponse({
            success: false,
            error: 'Failed to summarize after trying all available models.'
        });

    } catch (error) {
        log('error', 'Summarization failed', { message: error.message, stack: error.stack });
        sendResponse({
            success: false,
            error: error.message || 'Failed to summarize content'
        });
    }
}

// Split text into chunks
function splitIntoChunks(text, chunkSize = CONFIG.CHUNK_SIZE) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= chunkSize) {
            chunks.push(remaining.trim());
            break;
        }

        let breakPoint = chunkSize;
        const chunk = remaining.substring(0, chunkSize);
        const lastPeriod = Math.max(
            chunk.lastIndexOf('. '),
            chunk.lastIndexOf('! '),
            chunk.lastIndexOf('? '),
            chunk.lastIndexOf('.\n'),
            chunk.lastIndexOf('\n\n')
        );

        if (lastPeriod > chunkSize * 0.5) {
            breakPoint = lastPeriod + 1;
        } else {
            // Fallback: try to split by space if no good sentence break found
            const lastSpace = chunk.lastIndexOf(' ');
            if (lastSpace > chunkSize * 0.5) {
                breakPoint = lastSpace + 1;
            }
            // Else default to strict chunkSize split (which might break a word, but prevents infinite loop)
        }

        chunks.push(remaining.substring(0, breakPoint).trim());
        remaining = remaining.substring(breakPoint).trim();
    }

    log('info', `Split into ${chunks.length} chunks`);
    return chunks;
}

// Summarize with chunking
async function summarizeWithChunking(text, apiKey, model) {
    const chunks = splitIntoChunks(text);
    const summaries = [];

    for (let i = 0; i < chunks.length; i++) {
        log('info', `Processing chunk ${i + 1}/${chunks.length}`);

        if (i > 0) {
            await delay(CONFIG.DELAY_BETWEEN_CHUNKS);
        }

        const chunkSummary = await summarizeSingleChunk(
            chunks[i],
            apiKey,
            model,
            `part ${i + 1} of ${chunks.length}`
        );
        summaries.push(chunkSummary);
    }

    if (summaries.length === 1) {
        return { summary: summaries[0], chunks: 1 };
    }

    // Combine summaries
    log('info', 'Combining chunk summaries...');
    await delay(CONFIG.DELAY_BETWEEN_CHUNKS);

    const combinedText = summaries.join('\n\n---\n\n');

    if (combinedText.length > CONFIG.CHUNK_SIZE * 2) {
        return {
            summary: summaries.join('\n\n'),
            chunks: chunks.length
        };
    }

    const finalSummary = await combineSummaries(combinedText, apiKey, model);
    return { summary: finalSummary, chunks: chunks.length };
}

// Summarize single chunk
async function summarizeSingleChunk(text, apiKey, model, chunkInfo) {
    log('info', `summarizeSingleChunk: ${text.length} chars, ${chunkInfo}`);

    const prompt = `Summarize the following content as bullet points. Format rules:
- Use bullet points (•) for each item
- Each bullet should be a concise 1-2 sentence summary
- If the content has numbered items (like "Top 10"), keep the numbers (1., 2., etc.)
- Output ONLY the bullet points - no introductions, no preambles, no "Here is a summary"
- Start directly with the first bullet point

Content:
${text}`;

    return await makeApiRequest(prompt, apiKey, model, CONFIG.MAX_TOKENS_PER_CHUNK);
}

// Combine summaries
async function combineSummaries(combinedSummaries, apiKey, model) {
    log('info', `combineSummaries: ${combinedSummaries.length} chars`);

    const prompt = `Combine these summaries into one clean bullet-point list. Format rules:
- Use bullet points (•) or numbered list if items have rankings
- Each bullet should be concise (1-2 sentences)
- Remove any duplicate information
- Output ONLY the bullet points - no introductions, no preambles
- Start directly with the first bullet point

Summaries to combine:
${combinedSummaries}`;

    return await makeApiRequest(prompt, apiKey, model, 1000);
}

// Make API request
async function makeApiRequest(prompt, apiKey, model, maxTokens, retryCount = 0) {
    const promptLength = prompt.length;
    log('info', `API Request: ${promptLength} chars, maxTokens=${maxTokens}, retry=${retryCount}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': chrome.runtime.getURL(''),
                'X-Title': 'Page Summariser Extension'
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                model: model,
                messages: [
                    { role: 'system', content: prompt.split('\n\nContent:')[0].trim() },
                    { role: 'user', content: 'Content:\n' + prompt.split('\n\nContent:')[1] }
                ],
                temperature: 0.7,
                max_tokens: maxTokens
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        log('info', `Response status: ${response.status}`);

        if (!response.ok) {
            const errorInfo = await handleApiError(response, model);

            // Retry once for temporary errors
            if (errorInfo.shouldRetry && retryCount < CONFIG.MAX_RETRIES) {
                log('info', `Retrying in ${CONFIG.RETRY_BASE_DELAY / 1000}s...`);
                await delay(CONFIG.RETRY_BASE_DELAY);
                return await makeApiRequest(prompt, apiKey, model, maxTokens, retryCount + 1);
            }

            const error = new Error(errorInfo.message);
            error.isRateLimited = errorInfo.isRateLimited;
            throw error;
        }

        const data = await response.json();

        if (!data.choices?.[0]?.message?.content) {
            throw new Error('Invalid response from API');
        }

        const summary = data.choices[0].message.content.trim();
        log('info', `Got ${summary.length} char response`);
        return summary;

    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            throw new Error('Request timed out. Please try again.');
        }
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Network error. Check your connection.');
        }

        throw error;
    }
}

// Handle API errors
async function handleApiError(response, model) {
    let message = `API error: ${response.status}`;
    let shouldRetry = false;
    let isRateLimited = false;

    log('error', `API Error: ${response.status}`);

    try {
        const errorText = await response.text();
        log('error', 'Error body:', errorText);

        let errorData;
        try {
            errorData = JSON.parse(errorText);
        } catch {
            errorData = { rawText: errorText };
        }

        const rawMessage = errorData.error?.message || '';
        const metadata = errorData.error?.metadata || {};

        if (response.status === 429) {
            isRateLimited = true;

            // Check for daily limit
            if (rawMessage.includes('free-models-per-day') ||
                metadata.headers?.['X-RateLimit-Remaining'] === '0') {
                message = `Daily limit reached for ${model}`;
                shouldRetry = false;
            } else if (rawMessage.includes('temporarily rate-limited')) {
                message = `${model} temporarily busy`;
                shouldRetry = true; // Might recover
            } else {
                message = 'Rate limit hit';
                shouldRetry = false; // Assume daily limit, try next model
            }
        } else if (response.status === 503 || response.status === 502) {
            message = 'Server temporarily unavailable';
            shouldRetry = true;
        } else if (response.status === 401) {
            message = 'Invalid API key. Please check your OpenRouter API key.';
        } else if (response.status === 402) {
            message = 'Insufficient credits. Add credits to OpenRouter.';
        } else if (response.status === 400) {
            if (rawMessage.includes('not a valid model')) {
                message = `Invalid model: ${model}`;
            } else {
                message = rawMessage || 'Bad request';
            }
        } else {
            message = rawMessage || message;
        }

    } catch (e) {
        log('error', 'Failed to parse error', e);
    }

    return { message, shouldRetry, isRateLimited };
}

// Delay utility
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
