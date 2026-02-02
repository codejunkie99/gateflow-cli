import React, { useMemo, useState } from 'react';
import { Box, Text, Static, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import type { InkStore } from './store.js';
import type { PromptController, PromptRequest } from '../prompt-controller.js';
import type { MenuItem, MenuSection } from '../InteractiveMenu.js';

interface InkAppProps {
    store: InkStore;
    promptController: PromptController;
    showTokens?: boolean;
    useSpinner?: boolean;
    unicode?: boolean;
}

function useStoreState(store: InkStore) {
    const [state, setState] = useState(store.getState());
    React.useEffect(() => {
        const unsubscribe = store.subscribe(() => setState(store.getState()));
        return unsubscribe;
    }, [store]);
    return state;
}

function usePromptState(controller: PromptController) {
    const [state, setState] = useState(controller.getState());
    React.useEffect(() => {
        const unsubscribe = controller.subscribe(() => setState(controller.getState()));
        return unsubscribe;
    }, [controller]);
    return state;
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
        <Box marginTop={1}>
            {status ? (
                <Text>
                    {useSpinner ? <Spinner type={spinnerType} /> : bullet}
                    {` ${status.symbol ? chalk.gray(status.symbol) + ' ' : ''}${status.label}`}
                    {suffix}
                </Text>
            ) : (
                suffix ? <Text>{suffix.trim()}</Text> : null
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
    useInput((input, key) => {
        if (key.escape) {
            controller.cancel();
        }
    });

    if (!payload || request.kind !== 'line') return null;

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
    if (request.kind !== 'text') return null;
    const payload = request.payload;
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);

    useInput((_input, key) => {
        if (key.escape) {
            controller.cancel();
        }
    });

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
    if (request.kind !== 'menu') return null;
    const payload = request.payload as { sections: MenuSection<T>[]; options?: any };
    const options = payload.options ?? {};
    const searchable = options.searchable ?? false;
    const maxVisibleItems = options.maxVisibleItems ?? 10;
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);

    const flatItems = useMemo(() => {
        const items: { item: MenuItem<T>; sectionIndex: number; sectionTitle: string }[] = [];
        payload.sections.forEach((section, sectionIndex) => {
            section.items.forEach(item => {
                items.push({ item, sectionIndex, sectionTitle: section.title });
            });
        });
        return items;
    }, [payload.sections]);

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

        if (searchable && key.backspace) {
            setSearchQuery(prev => prev.slice(0, -1));
            setSelectedIndex(0);
            setScrollOffset(0);
            return;
        }
        if (searchable && input && !key.ctrl && !key.meta) {
            if (input.trim().length > 0) {
                setSearchQuery(prev => prev + input);
                setSelectedIndex(0);
                setScrollOffset(0);
            }
        }
    });

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
                {visibleItems.map((entry, idx) => {
                    const absoluteIndex = scrollOffset + idx;
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
                        <Text key={`${entry.sectionIndex}-${entry.item.label}`}>
                            {` ${prefix} ${bullet} ${label}${desc}`}
                        </Text>
                    );
                })}
            </Box>
            {help ? <Text>{help}</Text> : null}
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
    const { stdout } = useStdout();

    const logs = state.logs;
    const stream = state.stream;

    return (
        <Box flexDirection="column" width={stdout.columns || 80}>
            <Static items={logs}>
                {(item) => <Text key={item.id}>{item.text}</Text>}
            </Static>
            {stream ? <Text>{stream}</Text> : null}
            {state.pendingApproval ? (
                <ApprovalBanner
                    action={state.pendingApproval.action}
                    details={state.pendingApproval.details}
                    diff={state.pendingApproval.diff}
                />
            ) : null}
            <StatusBar
                status={state.status}
                tokens={state.tokens}
                cost={state.cost}
                toolCallCount={state.toolCallCount}
                showTokens={showTokens}
                useSpinner={useSpinner && !state.inputPaused}
                unicode={unicode}
            />
            {promptState.current ? (
                <>
                    {promptState.current.kind === 'line' && (
                        <LinePrompt request={promptState.current} controller={promptController} />
                    )}
                    {promptState.current.kind === 'text' && (
                        <TextPrompt request={promptState.current} controller={promptController} />
                    )}
                    {promptState.current.kind === 'menu' && (
                        <MenuPrompt request={promptState.current} controller={promptController} />
                    )}
                </>
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
