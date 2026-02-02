/**
 * Rate-limited AI SDK call wrappers.
 * Ensures consistent throttling across generateText/streamText usage.
 */

import {
    generateText as aiGenerateText,
    streamText as aiStreamText,
} from 'ai';
import {
    createRateLimiter,
    estimateMessageTokens,
    estimateTokens,
    type RateLimiter,
} from './rate-limiter.js';

type StreamTextArgs = Parameters<typeof aiStreamText>[0] & { modelId?: string };
type GenerateTextArgs = Parameters<typeof aiGenerateText>[0] & { modelId?: string };

const limiterCache = new Map<string, RateLimiter>();

function normalizeModelId(modelId?: string): string {
    if (!modelId) return 'default';
    const withoutVariant = modelId.split(':')[0];
    const parts = withoutVariant.split('/');
    return parts.length > 1 ? parts[1] : withoutVariant;
}

function getLimiter(modelId?: string): RateLimiter {
    const key = normalizeModelId(modelId);
    const existing = limiterCache.get(key);
    if (existing) return existing;
    const limiter = createRateLimiter(key);
    limiterCache.set(key, limiter);
    return limiter;
}

function estimateTokensFromArgs(args: { prompt?: unknown; messages?: unknown }): number {
    if (typeof args.prompt === 'string') {
        return estimateTokens(args.prompt);
    }
    if (Array.isArray(args.messages)) {
        const messages = args.messages as Array<{ content?: unknown }>;
        const normalized = messages.map((m) => ({
            content: typeof m.content === 'string' ? m.content : '',
        }));
        return estimateMessageTokens(normalized);
    }
    return 0;
}

export async function generateText(
    args: GenerateTextArgs,
): Promise<any> {
    const { modelId, ...callArgs } = args as GenerateTextArgs;
    const limiter = getLimiter(modelId);
    const estimatedTokens = estimateTokensFromArgs(callArgs);

    return limiter.withRateLimit(
        () => aiGenerateText(callArgs as Parameters<typeof aiGenerateText>[0]),
        estimatedTokens,
    );
}

export async function streamText(args: StreamTextArgs): Promise<any> {
    const { modelId, ...callArgs } = args as StreamTextArgs;
    const limiter = getLimiter(modelId);
    const estimatedTokens = estimateTokensFromArgs(callArgs);

    await limiter.acquire(estimatedTokens);
    let released = false;
    const release = () => {
        if (!released) {
            released = true;
            limiter.release();
        }
    };

    let result: any;
    try {
        result = await aiStreamText(callArgs as Parameters<typeof aiStreamText>[0]);
    } catch (error) {
        release();
        throw error;
    }

    const originalStream = result.fullStream;
    const wrappedStream = (async function* () {
        try {
            for await (const part of originalStream) {
                yield part;
            }
        } finally {
            release();
        }
    })();

    const wrappedText = Promise.resolve(result.text).finally(() => {
        release();
    });

    return {
        ...result,
        fullStream: wrappedStream,
        text: wrappedText,
    };
}
