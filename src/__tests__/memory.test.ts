/**
 * Memory Module Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { MemoryManager } from "../memory/store/manager.js";
import {
  KnowledgeStore,
  type KnowledgeItem,
} from "../memory/ParentKnowledgeStore.js";
import { EventBus } from "../events/bus.js";
import {
  estimateTokens,
  estimateTokensSimple,
  detectContentType,
  truncateToFit,
  fitsInBudget,
} from "../memory/token-estimator.js";
import {
  TieredKnowledgeStore,
  createTieredStore,
} from "../memory/tiered-store.js";

describe("Memory Module", () => {
  let tmpDir: string;
  let bus: EventBus;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gateflow-memory-test-"));
    bus = new EventBus();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("MemoryManager", () => {
    it("should initialize and create default memory", async () => {
      const manager = new MemoryManager(tmpDir, bus, { memoryDir: tmpDir });
      const memory = await manager.load();

      expect(memory).toBeDefined();
      expect(memory.projectId).toBeDefined();
      expect(memory.context.recentFiles).toHaveLength(0);
      expect(memory.history).toHaveLength(0);
    });

    it("should persistence save and load", async () => {
      const manager1 = new MemoryManager(tmpDir, bus, { memoryDir: tmpDir });
      await manager1.load();

      // Use absolute path so relative path calculation works (relative to tmpDir)
      const testFile = path.join(tmpDir, "test.sv");
      manager1.addRecentFile(testFile);

      manager1.addModuleNote("mod1", "Test note");
      await manager1.save();

      const manager2 = new MemoryManager(tmpDir, bus, { memoryDir: tmpDir });
      const memory2 = await manager2.load();

      // stored relative to projectRoot (tmpDir)
      expect(memory2.context.recentFiles).toContain("test.sv");
      expect(memory2.context.moduleNotes["mod1"]).toBe("Test note");
    });

    it("should handle concurrent saves without data corruption", async () => {
      // Test that concurrent save operations are properly serialized
      const config = { memoryDir: tmpDir, lockTimeout: 5000 };
      const manager1 = new MemoryManager(tmpDir, bus, config);
      const manager2 = new MemoryManager(tmpDir, bus, config);

      await manager1.load();
      await manager2.load();

      // Make concurrent modifications
      manager1.addModuleNote("module1", "note from manager1");
      manager2.addModuleNote("module2", "note from manager2");

      // Concurrent saves should both complete without error
      // (locking ensures they don't corrupt each other)
      await Promise.all([manager1.flush(), manager2.flush()]);

      // Reload and verify data integrity
      const manager3 = new MemoryManager(tmpDir, bus, config);
      const memory = await manager3.load();

      // At minimum, the last write should have persisted
      // (exact behavior depends on timing, but no corruption)
      expect(memory.context.moduleNotes).toBeDefined();
      const notes = Object.keys(memory.context.moduleNotes);
      expect(notes.length).toBeGreaterThan(0);
    });

    it("should maintain strict history limits", async () => {
      const manager = new MemoryManager(tmpDir, bus, {
        memoryDir: tmpDir,
        maxHistory: 2,
      });
      await manager.load();

      manager.addConversation({
        summary: "1",
        timestamp: 1,
        filesModified: [],
        exitCode: 0,
      });
      manager.addConversation({
        summary: "2",
        timestamp: 2,
        filesModified: [],
        exitCode: 0,
      });
      manager.addConversation({
        summary: "3",
        timestamp: 3,
        filesModified: [],
        exitCode: 0,
      });

      const memory = manager.getMemory();
      expect(memory?.history).toHaveLength(2);
      expect(memory?.history[0].summary).toBe("3");
      expect(memory?.history[1].summary).toBe("2");
    });
  });

  describe("KnowledgeStore", () => {
    it("should learn and retrieve knowledge", async () => {
      const store = new KnowledgeStore(tmpDir, bus, { knowledgeDir: tmpDir });
      await store.load();

      store.addKnowledge({
        type: "code_pattern",
        title: "Test Pattern",
        content: "Always use synchronous reset",
        tags: ["verilog", "reset"],
        keywords: ["reset", "sync"],
        scope: { global: false },
        source: { method: "user_provided" },
        confidence: 0.9,
      });

      await store.save();

      const results = store.search({ query: "reset" });
      expect(results).toHaveLength(1);
      expect(results[0].item.title).toBe("Test Pattern");
      expect(results[0].relevance).toBeGreaterThan(0);
    });

    it("should filter by context (tags)", async () => {
      const store = new KnowledgeStore(tmpDir, bus, { knowledgeDir: tmpDir });
      await store.load();

      store.addKnowledge({
        type: "code_pattern",
        title: "Verilog",
        content: "...",
        tags: ["verilog"],
        keywords: [],
        scope: { global: false },
        source: { method: "user_provided" },
        confidence: 1,
      });

      store.addKnowledge({
        type: "code_pattern",
        title: "Python",
        content: "...",
        tags: ["python"],
        keywords: [],
        scope: { global: false },
        source: { method: "user_provided" },
        confidence: 1,
      });

      const results = store.search({ tags: ["verilog"] });
      expect(results).toHaveLength(1);
      expect(results[0].item.title).toBe("Verilog");
    });

    describe("Knowledge Extraction", () => {
      it("should extract patterns from lint sessions", async () => {
        const store = new KnowledgeStore(tmpDir, bus, { knowledgeDir: tmpDir });
        await store.load();

        const errors = [
          { file: "test1.sv", message: 'Signal "foo" is not used' },
          { file: "test2.sv", message: 'Signal "bar" is not used' },
          { file: "test3.sv", message: 'Signal "baz" is not used' },
        ];
        const fixes: Array<{ file: string; original: string; fixed: string }> =
          [];

        const extracted = store.extractFromLintSession(
          "session-1",
          errors,
          fixes,
        );

        expect(extracted).toHaveLength(1);
        expect(extracted[0].type).toBe("lint_fix");
        expect(extracted[0].tags).toContain("lint");
        expect(extracted[0].confidence).toBeGreaterThan(0.6);
      });

      it("should extract patterns from code generation", async () => {
        const store = new KnowledgeStore(tmpDir, bus, { knowledgeDir: tmpDir });
        await store.load();

        const fsmCode = `
                    typedef enum logic [1:0] { IDLE, RUN, DONE } state_t;
                    always_ff @(posedge clk) begin
                        case (state)
                            IDLE: state <= RUN;
                            RUN: state <= DONE;
                        endcase
                    end
                `;

        const result = store.extractFromCodeGen("session-1", fsmCode, {
          type: "fsm",
          moduleName: "controller",
        });

        expect(result).not.toBeNull();
        expect(result?.type).toBe("code_pattern");
        expect(result?.tags).toContain("fsm");
      });

      it("should learn from user corrections", async () => {
        const store = new KnowledgeStore(tmpDir, bus, { knowledgeDir: tmpDir });
        await store.load();

        const result = store.learnFromCorrection(
          "always @(posedge clk) q <= d;",
          "always_ff @(posedge clk) q <= d;",
          { tags: ["style"] },
        );

        expect(result).toBeDefined();
        expect(result.confidence).toBe(0.95);
        expect(result.source.method).toBe("user_provided");
      });
    });
  });

  describe("Token Estimator", () => {
    describe("content detection", () => {
      it("should detect SystemVerilog code", () => {
        const code = `
                    always_ff @(posedge clk) begin
                        if (rst_n) q <= d;
                    end
                `;
        expect(detectContentType(code)).toBe("code");
      });

      it("should detect VHDL code", () => {
        const vhdl = `
                    architecture rtl of counter is
                        signal count : unsigned(7 downto 0);
                    begin
                    end rtl;
                `;
        expect(detectContentType(vhdl)).toBe("code");
      });

      it("should detect natural language", () => {
        const text =
          "This function implements a queue for data buffering and processing.";
        expect(detectContentType(text)).toBe("text");
      });

      it("should detect mixed content", () => {
        // Contains HDL keywords like 'module' and 'signal' but in prose form
        const mixed =
          "The module uses a wire connection and has a clk input signal for timing.";
        expect(detectContentType(mixed)).toBe("mixed");
      });
    });

    describe("token estimation", () => {
      it("should return zero for empty text", () => {
        expect(estimateTokensSimple("")).toBe(0);
        expect(estimateTokensSimple("   ")).toBeGreaterThan(0);
      });

      it("should estimate tokens with breakdown", () => {
        const text = "This is a test description for a knowledge item.";
        const result = estimateTokens(text);

        expect(result.tokens).toBeGreaterThan(0);
        expect(result.breakdown.wordBased).toBeGreaterThan(0);
        expect(result.breakdown.charBased).toBeGreaterThan(0);
        expect(result.breakdown.total).toBe(result.tokens);
      });

      it("should include safety margin", () => {
        const text = "Test content";
        const result = estimateTokens(text);

        expect(result.breakdown.safetyMargin).toBeGreaterThan(0);
      });

      it("should handle HDL code with symbols", () => {
        const code = "always_ff @(posedge clk) begin: label q <= d[7:0]; end";
        const result = estimateTokens(code);

        expect(result.breakdown.symbolAdjustment).toBeGreaterThan(0);
      });
    });

    describe("budget helpers", () => {
      it("should check if content fits in budget", () => {
        const shortText = "Hello world";
        const longText = "A".repeat(10000);

        expect(fitsInBudget(shortText, 100)).toBe(true);
        expect(fitsInBudget(longText, 100)).toBe(false);
      });

      it("should truncate text to fit budget", () => {
        const longText = "A".repeat(1000);
        const truncated = truncateToFit(longText, 50);

        expect(truncated.length).toBeLessThan(longText.length);
        expect(truncated).toContain("[truncated]");
      });

      it("should not truncate text that fits", () => {
        const shortText = "Hello world";
        const result = truncateToFit(shortText, 100);

        expect(result).toBe(shortText);
      });
    });
  });

  describe("Tiered Knowledge Store", () => {
    function createTestItem(
      id: string,
      useCount = 0,
      daysOld = 0,
    ): KnowledgeItem {
      const now = Date.now();
      return {
        id,
        fingerprint: `fp-${id}`,
        type: "code_pattern",
        title: `Test ${id}`,
        content: "Test content",
        tags: ["test"],
        keywords: ["test"],
        scope: { global: false },
        source: { method: "extracted" },
        confidence: 0.8,
        useCount,
        lastAccessed: now - daysOld * 24 * 60 * 60 * 1000,
        created: now,
        updated: now,
      };
    }

    it("should initialize with items", () => {
      const store = createTieredStore({ hotSize: 5 });
      const items = Array.from({ length: 10 }, (_, i) =>
        createTestItem(`item-${i}`),
      );
      const itemMap = new Map(items.map((i) => [i.id, i]));

      store.initialize(items, (id) => itemMap.get(id));

      const stats = store.getStats();
      expect(stats.hotCount).toBe(5);
      expect(stats.warmCount + stats.coldCount).toBe(5);
    });

    it("should return items from hot tier immediately", () => {
      const store = createTieredStore({ hotSize: 5 });
      const items = [createTestItem("hot-item", 10, 0)];
      const itemMap = new Map(items.map((i) => [i.id, i]));

      store.initialize(items, (id) => itemMap.get(id));

      const item = store.getItem("hot-item");
      expect(item).toBeDefined();
      expect(item?.id).toBe("hot-item");
      expect(store.isHot("hot-item")).toBe(true);
    });

    it("should promote items on repeated access", () => {
      // Create items with similar base scores so promotion isn't immediately undone
      const store = createTieredStore({ hotSize: 3, warmThreshold: 2 });

      // All items have same useCount and similar age to have similar base scores
      const items = Array.from(
        { length: 5 },
        (_, i) => createTestItem(`item-${i}`, 5, 5), // Same useCount=5, daysOld=5
      );
      const itemMap = new Map(items.map((i) => [i.id, i]));

      store.initialize(items, (id) => itemMap.get(id));

      // Find a warm/cold item
      const warmItem = items.find((i) => !store.isHot(i.id));
      expect(warmItem).toBeDefined();
      if (warmItem) {
        const initialTier = store.getTier(warmItem.id);
        expect(initialTier === "warm" || initialTier === "cold").toBe(true);

        // Access multiple times to exceed warmThreshold
        // This will also boost the session accessCount bonus in demotion scoring
        for (let i = 0; i < 10; i++) {
          store.getItem(warmItem.id);
        }

        // With 10 accesses (accessCount * 5 = 50 bonus), should be promoted and stay
        expect(store.isHot(warmItem.id)).toBe(true);
      }
    });

    it("should demote items when hot tier is full", () => {
      const store = createTieredStore({ hotSize: 2 });
      const items = [
        createTestItem("item-1", 0, 0),
        createTestItem("item-2", 0, 0),
      ];
      const itemMap = new Map(items.map((i) => [i.id, i]));

      store.initialize(items, (id) => itemMap.get(id));

      // Add a new item (should cause demotion)
      const newItem = createTestItem("new-item", 0, 0);
      itemMap.set("new-item", newItem);
      store.addItem(newItem);

      const stats = store.getStats();
      expect(stats.hotCount).toBe(2);
    });

    it("should track access statistics", () => {
      const store = createTieredStore();
      const item = createTestItem("item-1");
      const itemMap = new Map([[item.id, item]]);

      store.initialize([item], (id) => itemMap.get(id));

      // Access item multiple times
      store.getItem("item-1");
      store.getItem("item-1");
      store.getItem("item-1");

      const stats = store.getStats();
      expect(stats.totalAccesses).toBe(3);
    });

    it("should rebalance tiers", () => {
      const store = createTieredStore({ hotSize: 2 });
      const items = Array.from({ length: 5 }, (_, i) =>
        createTestItem(`item-${i}`, 0, 0),
      );
      const itemMap = new Map(items.map((i) => [i.id, i]));

      store.initialize(items, (id) => itemMap.get(id));

      // Access cold items to change their priority
      store.getItem("item-3");
      store.getItem("item-3");
      store.getItem("item-4");
      store.getItem("item-4");

      // Rebalance
      store.rebalance();

      const stats = store.getStats();
      expect(stats.hotCount).toBe(2);
    });
  });
});
