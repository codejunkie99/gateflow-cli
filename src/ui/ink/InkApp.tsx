import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Box, Text, useInput, useStdout, type Key } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import stringWidth from 'string-width';
import type { InkStore } from './store.js';
import type { PromptController, PromptRequest } from '../prompt-controller.js';
import type { MenuItem, MenuSection } from '../InteractiveMenu.js';

// Strip ANSI SGR codes (colors/styles). Prompts sometimes come in pre-colored via chalk.
const STRIP_ANSI_SGR = /\x1B\[[0-9;]*m/g;
function stripAnsiSgr(value: string): string {
    return value.replace(STRIP_ANSI_SGR, '');
}
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

interface InkAppProps {
    store: InkStore;
    promptController: PromptController;
    showTokens?: boolean;
    useSpinner?: boolean;
    unicode?: boolean;
}

/**
 * Hook to track terminal size and trigger re-renders on resize
 * The renderer handles clearing - this just provides dimensions
 */
function useTerminalSize(): { columns: number; rows: number } {
    const { stdout } = useStdout();
    const [size, setSize] = useState({
        columns: stdout.columns || 80,
        rows: stdout.rows || 24
    });

    React.useEffect(() => {
        const handleResize = () => {
            setSize({
                columns: stdout.columns || 80,
                rows: stdout.rows || 24
            });
        };

        stdout.on('resize', handleResize);
        return () => {
            stdout.off('resize', handleResize);
        };
    }, [stdout]);

    return size;
}

function useStoreState(store: InkStore) {
    const [state, setState] = useState(() => store.getState());
    React.useEffect(() => {
        const unsubscribe = store.subscribe(() => setState(store.getState()));
        return unsubscribe;
    }, [store]);
    return state;
}

function usePromptState(controller: PromptController) {
    const [state, setState] = useState(() => controller.getState());
    React.useEffect(() => {
        const unsubscribe = controller.subscribe(() => setState(controller.getState()));
        return unsubscribe;
    }, [controller]);
    return state;
}

const GRAPHEME_SEGMENTER =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;

function* iterateGraphemes(value: string): Generator<string> {
    if (!GRAPHEME_SEGMENTER) {
        yield* value;
        return;
    }
    for (const segment of GRAPHEME_SEGMENTER.segment(value)) {
        yield segment.segment;
    }
}

const splitGraphemes = (value: string): string[] => {
    return Array.from(iterateGraphemes(value));
};

function wrapInputLines(inputText: string, firstLineWidth: number, lineWidth: number): string[] {
    if (!inputText) return [''];

    const lines: string[] = [''];
    let currentLineIndex = 0;
    let currentWidth = 0;

    for (const segment of iterateGraphemes(inputText)) {
        // Handle hard newlines (typically from paste). Enter submits, so users
        // won't normally type these, but we should render them correctly.
        if (segment === '\n') {
            lines.push('');
            currentLineIndex += 1;
            currentWidth = 0;
            continue;
        }
        if (segment === '\r') {
            continue;
        }

        const segmentWidth = stringWidth(segment);
        let maxWidth = currentLineIndex === 0 ? firstLineWidth : lineWidth;

        if (maxWidth <= 0) {
            // If the prompt consumes the entire first line width, fall back to
            // starting input on the next line (which has full lineWidth).
            if (currentLineIndex === 0 && lineWidth > 0) {
                lines.push('');
                currentLineIndex = 1;
                currentWidth = 0;
                maxWidth = lineWidth;
            } else {
                return [''];
            }
        }

        if (currentWidth + segmentWidth > maxWidth && currentWidth > 0) {
            lines.push('');
            currentLineIndex += 1;
            currentWidth = 0;
            maxWidth = lineWidth;
        }

        lines[currentLineIndex] += segment;
        currentWidth += segmentWidth;
    }

    return lines.length > 0 ? lines : [''];
}

function StatusBar({
    status,
    tokens,
    cost,
    toolCallCount,
    showTokens,
    useSpinner,
    unicode
}: {
    status: { phase: string; label: string; symbol?: string } | null;
    tokens: { input: number; output: number; cached: number };
    cost: number;
    toolCallCount: number;
    showTokens?: boolean;
    useSpinner?: boolean;
    unicode?: boolean;
}) {
    if (!status && !showTokens) return null;
    const suffix = showTokens
        ? buildStatusSuffix(tokens, cost, toolCallCount, unicode ?? true)
        : '';
    const spinnerType = (unicode ?? true) ? 'dots' : 'line';
    const bullet = (unicode ?? true) ? '•' : '*';
    return (
        <Box flexShrink={0}>
            {status ? (
                <Text wrap="truncate">
                    {useSpinner ? <Spinner type={spinnerType} /> : bullet}
                    {` ${status.symbol ? chalk.gray(status.symbol) + ' ' : ''}${status.label}`}
                    {suffix}
                </Text>
            ) : (
                suffix ? <Text wrap="truncate">{suffix.trim()}</Text> : null
            )}
        </Box>
    );
}

function ApprovalBanner({
    action,
    details,
    diff
}: {
    action: string;
    details: string;
    diff?: string;
}) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">Approval Required</Text>
            <Text>{`  ${action}: ${details}`}</Text>
            {diff ? (
                <Text>
                    {diff}
                </Text>
            ) : null}
            <Text>{chalk.gray('  [Y]es  [N]o  [A]ll  [S]kip')}</Text>
        </Box>
    );
}

function LinePrompt({ request, controller }: { request: PromptRequest; controller: PromptController }) {
    const payload = request.kind === 'line' ? request.payload : null;
    const [value, setValue] = useState('');
    const valueRef = useRef(value);
    const { columns, rows } = useTerminalSize();

    React.useEffect(() => {
        valueRef.current = value;
    }, [value]);

    // Reset input between prompt requests so each new prompt starts clean.
    React.useEffect(() => {
        setValue('');
    }, [request.id]);

    const useBox = Boolean(payload?.useBox);

    const handleInput = useCallback((input: string, key: Key) => {
        if (key.escape) {
            controller.cancel();
            return;
        }
        if (key.ctrl && input === 'c') {
            controller.cancel();
            return;
        }
        if (!useBox) {
            return;
        }
        // Some terminals send Backspace as Ctrl+H (input === 'h' with key.ctrl === true)
        // rather than setting key.backspace. Handle it explicitly so deletion always works.
        const isBackspace =
            key.backspace ||
            key.delete ||
            input === '\b' ||
            input === '\x7f' ||
            (key.ctrl && input === 'h');

        if (key.return) {
            controller.submit(valueRef.current);
            return;
        }
        if (isBackspace) {
            setValue((prev) => {
                if (!prev) return prev;
                const graphemes = splitGraphemes(prev);
                graphemes.pop();
                return graphemes.join('');
            });
            return;
        }
        if (input && !key.ctrl && !key.meta && !CONTROL_CHAR_PATTERN.test(input)) {
            setValue((prev) => prev + input);
        }
    }, [useBox, controller]);

    useInput(handleInput);

    if (!payload || request.kind !== 'line') return null;

    // Box mode - custom chatbox with border
    if (useBox) {
        const prompt = stripAnsiSgr(payload.question ?? '> ');
        const innerWidth = Math.max(1, columns - 4); // border + padding
        const promptWidth = stringWidth(prompt);
        const firstLineWidth = Math.max(0, innerWidth - promptWidth);
        const allLines = wrapInputLines(value, firstLineWidth, innerWidth);
        const maxVisibleInputLines = Math.max(1, rows - 10); // keep a bit of room for logs/status
        const startIndex = Math.max(0, allLines.length - maxVisibleInputLines);
        const lines = allLines.slice(startIndex);
        const showPrompt = startIndex === 0;
        const showHelp = !payload.isApproval;

        return (
            <Box flexDirection="column" flexShrink={0}>
                {payload.diff ? <Text>{payload.diff}</Text> : null}
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="cyan"
                    width="100%"
                    paddingX={1}
                    flexShrink={0}
                >
                    {lines.map((line, idx) => (
                        <Text key={startIndex + idx} wrap="truncate">
                            {showPrompt && idx === 0 ? <Text color="cyan">{prompt}</Text> : null}
                            {line}
                            {idx === lines.length - 1 ? <Text color="gray">▌</Text> : null}
                        </Text>
                    ))}
                    {showHelp ? <Text color="gray">Enter:send  Esc:cancel</Text> : null}
                </Box>
            </Box>
        );
    }

    // Standard prompt mode (choices, approval, etc.)
    const question = payload.question?.trim();
    const choices = payload.choices?.length ? payload.choices : null;
    const defaultLabel = payload.defaultAnswer ? chalk.gray(`(default: ${payload.defaultAnswer})`) : '';
    const approvalHint = payload.isApproval
        ? chalk.gray('  [Y]es  [N]o  [A]ll  [S]kip')
        : null;

    return (
        <Box flexDirection="column" marginTop={1}>
            {payload.diff ? <Text>{payload.diff}</Text> : null}
            {question ? <Text>{question} {defaultLabel}</Text> : null}
            {choices ? (
                <Text>
                    {choices.map((choice, idx) => `${chalk.cyan(`[${idx + 1}]`)} ${choice}`).join('  ')}
                </Text>
            ) : null}
            {approvalHint ? <Text>{approvalHint}</Text> : null}
            <TextInput
                value={value}
                onChange={setValue}
                onSubmit={(val) => controller.submit(val)}
                placeholder={payload.defaultAnswer || ''}
            />
        </Box>
    );
}

function TextPrompt({ request, controller }: { request: PromptRequest; controller: PromptController }) {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);

    React.useEffect(() => {
        setValue('');
        setError(null);
    }, [request.id]);

    useInput((_input, key) => {
        if (request.kind !== 'text') return;
        if (key.escape) {
            controller.cancel();
        }
    });

    if (request.kind !== 'text') return null;
    const payload = request.payload;

    const handleSubmit = (val: string) => {
        if (payload.validate) {
            const result = payload.validate(val);
            if (result !== true) {
                setError(typeof result === 'string' ? result : 'Invalid value');
                return;
            }
        }
        controller.submit({ submitted: true, value: val });
    };

    return (
        <Box flexDirection="column" marginTop={1}>
            <Text>{payload.prompt}</Text>
            <TextInput
                value={value}
                onChange={(next) => {
                    setError(null);
                    setValue(next);
                }}
                onSubmit={handleSubmit}
                mask={payload.mask ? '*' : undefined}
                placeholder={payload.placeholder}
            />
            {error ? <Text color="red">{error}</Text> : null}
        </Box>
    );
}

function MenuPrompt<T>({
    request,
    controller
}: {
    request: PromptRequest;
    controller: PromptController;
}) {
    const isMenu = request.kind === 'menu';
    const payload = isMenu ? (request.payload as { sections: MenuSection<T>[]; options?: any }) : null;
    const options = payload?.options ?? {};
    const searchable = options.searchable ?? false;
    const maxVisibleItems = options.maxVisibleItems ?? 10;
    const sections = payload?.sections;

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);

    React.useEffect(() => {
        setSearchQuery('');
        setSelectedIndex(0);
        setScrollOffset(0);
    }, [request.id]);

    const flatItems = useMemo(() => {
        if (!sections) return [];
        const items: {
            item: MenuItem<T>;
            sectionIndex: number;
            sectionTitle: string;
            sectionHeaderColor?: (text: string) => string;
        }[] = [];
        sections.forEach((section, sectionIndex) => {
            section.items.forEach(item => {
                items.push({
                    item,
                    sectionIndex,
                    sectionTitle: section.title,
                    sectionHeaderColor: section.headerColor
                });
            });
        });
        return items;
    }, [sections]);

    const filteredItems = useMemo(() => {
        if (!searchable || !searchQuery) return flatItems;
        const q = searchQuery.toLowerCase();
        return flatItems.filter(({ item }) =>
            item.label.toLowerCase().includes(q) ||
            (item.description?.toLowerCase().includes(q) ?? false)
        );
    }, [flatItems, searchQuery, searchable]);

    const visibleItems = useMemo(() => {
        const end = scrollOffset + maxVisibleItems;
        return filteredItems.slice(scrollOffset, end);
    }, [filteredItems, scrollOffset, maxVisibleItems]);

    const visibleRows = useMemo(() => {
        const rows: Array<
            | {
                kind: 'header';
                key: string;
                title: string;
                color?: (text: string) => string;
            }
            | {
                kind: 'item';
                key: string;
                entry: (typeof visibleItems)[number];
                absoluteIndex: number;
            }
        > = [];

        visibleItems.forEach((entry, idx) => {
            const absoluteIndex = scrollOffset + idx;
            const prevEntry = filteredItems[absoluteIndex - 1];
            const isSectionBoundary =
                !prevEntry || prevEntry.sectionIndex !== entry.sectionIndex;

            if (isSectionBoundary && entry.sectionTitle.trim().length > 0) {
                rows.push({
                    kind: 'header',
                    key: `header-${absoluteIndex}-${entry.sectionIndex}`,
                    title: entry.sectionTitle,
                    color: entry.sectionHeaderColor
                });
            }

            rows.push({
                kind: 'item',
                key: `item-${absoluteIndex}-${entry.sectionIndex}-${entry.item.label}`,
                entry,
                absoluteIndex
            });
        });

        return rows;
    }, [filteredItems, scrollOffset, visibleItems]);

    const moveSelection = (delta: number) => {
        if (filteredItems.length === 0) return;
        let next = selectedIndex + delta;
        if (next < 0) next = filteredItems.length - 1;
        if (next >= filteredItems.length) next = 0;
        setSelectedIndex(next);

        if (next < scrollOffset) {
            setScrollOffset(next);
        } else if (next >= scrollOffset + maxVisibleItems) {
            setScrollOffset(next - maxVisibleItems + 1);
        }
    };

    useInput((input, key) => {
        if (!isMenu) return;
        if (key.escape) {
            controller.cancel();
            return;
        }
        if (key.upArrow) {
            moveSelection(-1);
            return;
        }
        if (key.downArrow) {
            moveSelection(1);
            return;
        }
        if (key.return) {
            const selected = filteredItems[selectedIndex];
            if (selected && !selected.item.disabled) {
                controller.submit({
                    selected: true,
                    value: selected.item.value,
                    item: selected.item,
                    sectionIndex: selected.sectionIndex
                });
            } else {
                controller.cancel();
            }
            return;
        }

        const isBackspace =
            key.backspace ||
            key.delete ||
            input === '\b' ||
            input === '\x7f' ||
            (key.ctrl && input === 'h');

        if (searchable && isBackspace) {
            setSearchQuery(prev => prev.slice(0, -1));
            setSelectedIndex(0);
            setScrollOffset(0);
            return;
        }
        if (searchable && input && !key.ctrl && !key.meta) {
            if (!CONTROL_CHAR_PATTERN.test(input) && input.trim().length > 0) {
                setSearchQuery(prev => prev + input);
                setSelectedIndex(0);
                setScrollOffset(0);
            }
        }
    });

    if (!isMenu) return null;

    const title = options.title ? String(options.title) : '';
    const help = options.showHelp !== false
        ? chalk.gray('Use Up/Down, Enter to select, Esc to cancel')
        : '';

    return (
        <Box flexDirection="column" marginTop={1}>
            {title ? <Text>{title}</Text> : null}
            {searchable ? (
                <Text>{chalk.gray(options.searchPlaceholder || 'Type to search...')} {searchQuery}</Text>
            ) : null}
            <Box flexDirection="column" marginTop={1}>
                {visibleRows.map((row) => {
                    if (row.kind === 'header') {
                        const title = row.color ? row.color(row.title) : chalk.cyan(row.title);
                        return <Text key={row.key}>{title}</Text>;
                    }

                    const { entry, absoluteIndex } = row;
                    const isSelected = absoluteIndex === selectedIndex;
                    const bullet = entry.item.disabled ? 'o' : '*';
                    const prefix = isSelected ? chalk.cyan('>') : ' ';
                    const label = entry.item.disabled
                        ? chalk.dim(entry.item.label)
                        : isSelected
                        ? chalk.bold(entry.item.label)
                        : entry.item.label;
                    const desc = entry.item.description ? `  ${chalk.gray(entry.item.description)}` : '';
                    return (
                        <Text key={row.key}>
                            {` ${prefix} ${bullet} ${label}${desc}`}
                        </Text>
                    );
                })}
            </Box>
            {help ? <Text>{help}</Text> : null}
        </Box>
    );
}

/**
 * Scrollable log viewport using flexGrow to fill available space
 */
function LogViewport({ logs }: { logs: { id: number; text: string }[] }) {
    if (logs.length === 0) return null;

    return (
        <Box flexDirection="column" flexGrow={1} overflow="hidden" justifyContent="flex-end">
            {logs.map((item) => (
                <Text key={item.id} wrap="truncate">{item.text}</Text>
            ))}
        </Box>
    );
}

export function InkApp({
    store,
    promptController,
    showTokens = true,
    useSpinner = true,
    unicode = true
}: InkAppProps) {
    const state = useStoreState(store);
    const promptState = usePromptState(promptController);
    const { columns, rows } = useTerminalSize();

    const logs = state.logs;
    const stream = state.stream;

    return (
        // Full-screen container that adapts to terminal size
        <Box
            flexDirection="column"
            width={columns}
            height={rows}
        >
            {/* Logs area - grows to fill available space */}
            <LogViewport logs={logs} />

            {/* Stream output */}
            {stream ? <Text wrap="truncate">{stream}</Text> : null}

            {/* Approval banner */}
            {state.pendingApproval ? (
                <ApprovalBanner
                    action={state.pendingApproval.action}
                    details={state.pendingApproval.details}
                    diff={state.pendingApproval.diff}
                />
            ) : null}

            {/* Status bar - fixed at bottom (hidden while input is active) */}
            {!state.inputPaused ? (
                <StatusBar
                    status={state.status}
                    tokens={state.tokens}
                    cost={state.cost}
                    toolCallCount={state.toolCallCount}
                    showTokens={showTokens}
                    useSpinner={useSpinner}
                    unicode={unicode}
                />
            ) : null}

            {/* Input prompt - fixed at bottom */}
            {promptState.current ? (
                <Box flexDirection="column" flexShrink={0}>
                    {promptState.current.kind === 'line' && (
                        <LinePrompt
                            key={promptState.current.id}
                            request={promptState.current}
                            controller={promptController}
                        />
                    )}
                    {promptState.current.kind === 'text' && (
                        <TextPrompt
                            key={promptState.current.id}
                            request={promptState.current}
                            controller={promptController}
                        />
                    )}
                    {promptState.current.kind === 'menu' && (
                        <MenuPrompt
                            key={promptState.current.id}
                            request={promptState.current}
                            controller={promptController}
                        />
                    )}
                </Box>
            ) : null}
        </Box>
    );
}

function formatTokens(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return `${count}`;
}

function formatCost(cost: number): string {
    if (cost < 0.01) return '<$0.01';
    return `$${cost.toFixed(2)}`;
}

function buildStatusSuffix(
    tokens: { input: number; output: number; cached: number },
    cost: number,
    toolCallCount: number,
    unicode: boolean
): string {
    const parts: string[] = [];
    const sep = unicode ? '\u{2502}' : '|';

    if (tokens.input > 0 || tokens.output > 0) {
        const inputLabel = unicode
            ? `\u{2191}${formatTokens(tokens.input)}`
            : `in:${formatTokens(tokens.input)}`;
        const outputLabel = unicode
            ? `\u{2193}${formatTokens(tokens.output)}`
            : `out:${formatTokens(tokens.output)}`;
        parts.push(chalk.blue(inputLabel) + ' ' + chalk.green(outputLabel));
    }

    if (cost > 0) {
        parts.push(chalk.yellow(formatCost(cost)));
    }

    if (toolCallCount > 0) {
        parts.push(chalk.gray(`${toolCallCount} tools`));
    }

    if (parts.length === 0) return '';
    return chalk.gray(` ${sep} `) + parts.join(chalk.gray(` ${sep} `));
}
