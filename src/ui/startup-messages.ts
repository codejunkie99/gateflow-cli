let startupLines: string[] = [];

export function setStartupLines(lines: string[]): void {
    startupLines = [...lines];
}

export function getStartupLines(): string[] {
    return [...startupLines];
}

export function clearStartupLines(): void {
    startupLines = [];
}
