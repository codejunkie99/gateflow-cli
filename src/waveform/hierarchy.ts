/**
 * Hierarchy Browser
 * Manages the signal hierarchy tree from VCD scopes
 */

import type { WaveformData, WaveformScope, WaveformSignal, HierarchyNode } from './types.js';

export class HierarchyBrowser {
    private root: HierarchyNode;
    private flatList: HierarchyNode[] = [];
    private signalMap: Map<string, WaveformSignal>;

    constructor() {
        this.root = {
            name: 'root',
            fullPath: '',
            type: 'scope',
            expanded: true,
            children: [],
            depth: 0,
        };
        this.signalMap = new Map();
    }

    buildFromData(data: WaveformData): void {
        // Build signal map for quick lookup
        this.signalMap.clear();
        for (const signal of data.signals) {
            this.signalMap.set(signal.id, signal);
        }

        // Build tree from scope hierarchy
        this.root = this.buildNode(data.rootScope, '', 0);
        this.root.expanded = true;

        // Rebuild flat list
        this.rebuildFlatList();
    }

    private buildNode(scope: WaveformScope, parentPath: string, depth: number): HierarchyNode {
        const fullPath = parentPath ? `${parentPath}.${scope.name}` : scope.name;

        const node: HierarchyNode = {
            name: scope.name,
            fullPath,
            type: 'scope',
            expanded: depth < 2, // Expand first two levels by default
            children: [],
            depth,
        };

        // Add child scopes
        for (const childScope of scope.children) {
            node.children.push(this.buildNode(childScope, fullPath, depth + 1));
        }

        // Add signals in this scope
        for (const signalId of scope.signals) {
            const signal = this.signalMap.get(signalId);
            if (signal) {
                node.children.push({
                    name: signal.name,
                    fullPath: `${fullPath}.${signal.name}`,
                    type: 'signal',
                    expanded: false,
                    children: [],
                    signal,
                    depth: depth + 1,
                });
            }
        }

        return node;
    }

    private rebuildFlatList(): void {
        this.flatList = [];
        this.flattenNode(this.root);
    }

    private flattenNode(node: HierarchyNode): void {
        // Skip the root node itself but include its children
        if (node !== this.root) {
            this.flatList.push(node);
        }

        if (node.expanded || node === this.root) {
            for (const child of node.children) {
                this.flattenNode(child);
            }
        }
    }

    getFlatList(): HierarchyNode[] {
        return this.flatList;
    }

    getVisibleSignals(): WaveformSignal[] {
        const signals: WaveformSignal[] = [];
        for (const node of this.flatList) {
            if (node.type === 'signal' && node.signal) {
                signals.push(node.signal);
            }
        }
        return signals;
    }

    toggle(node: HierarchyNode): void {
        if (node.type === 'scope') {
            node.expanded = !node.expanded;
            this.rebuildFlatList();
        }
    }

    expand(node: HierarchyNode): void {
        if (node.type === 'scope' && !node.expanded) {
            node.expanded = true;
            this.rebuildFlatList();
        }
    }

    collapse(node: HierarchyNode): void {
        if (node.type === 'scope' && node.expanded) {
            node.expanded = false;
            this.rebuildFlatList();
        }
    }

    expandAll(): void {
        this.setExpandedRecursive(this.root, true);
        this.rebuildFlatList();
    }

    collapseAll(): void {
        this.setExpandedRecursive(this.root, false);
        this.root.expanded = true; // Keep root expanded
        this.rebuildFlatList();
    }

    private setExpandedRecursive(node: HierarchyNode, expanded: boolean): void {
        if (node.type === 'scope') {
            node.expanded = expanded;
            for (const child of node.children) {
                this.setExpandedRecursive(child, expanded);
            }
        }
    }

    findByPath(path: string): HierarchyNode | null {
        return this.findNodeByPath(this.root, path);
    }

    private findNodeByPath(node: HierarchyNode, path: string): HierarchyNode | null {
        if (node.fullPath === path) return node;

        for (const child of node.children) {
            const found = this.findNodeByPath(child, path);
            if (found) return found;
        }

        return null;
    }

    search(query: string): HierarchyNode[] {
        const results: HierarchyNode[] = [];
        const lowerQuery = query.toLowerCase();

        this.searchRecursive(this.root, lowerQuery, results);

        return results;
    }

    private searchRecursive(node: HierarchyNode, query: string, results: HierarchyNode[]): void {
        if (node.name.toLowerCase().includes(query) || node.fullPath.toLowerCase().includes(query)) {
            results.push(node);
        }

        for (const child of node.children) {
            this.searchRecursive(child, query, results);
        }
    }

    getRoot(): HierarchyNode {
        return this.root;
    }
}
