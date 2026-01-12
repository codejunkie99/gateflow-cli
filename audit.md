# GateFlow CLI - Security & Code Quality Audit

**Date:** January 12, 2026
**Auditor:** Claude Opus 4.5
**Codebase:** GateFlow CLI (AI-powered SystemVerilog development assistant)

---

## Executive Summary

GateFlow CLI is a sophisticated AI-powered SystemVerilog development assistant built with TypeScript, leveraging the Vercel AI SDK 6 for intelligent multi-agent coordination. This audit identified **3 critical**, **3 high**, and **3 medium** severity issues primarily in the tool setup functionality.

**Overall Assessment:** The codebase shows good security awareness in core areas (path validation, subprocess execution in Verilator/Verible), but has critical vulnerabilities in the newer tool setup functionality that require immediate attention.

---

## Critical Security Vulnerabilities

### 1. Command Injection via Shell Execution
**Severity:** CRITICAL
**File:** `src/agent/tool-setup-tools.ts`
**Lines:** 432, 485-489

**Issue:** The `extract_archive` function uses `execSync` with unescaped user-controlled paths, and `run_command` enables shell execution by default:

```typescript
// Line 432
execSync(`unzip -o "${args.archivePath}" -d "${args.destination}"`);

// Line 485-489
const proc = spawn(args.command, [], {
    shell: true,  // DANGEROUS - enables shell injection
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
});
```

**Vulnerability:** If `args.archivePath` or `args.destination` contain shell metacharacters like `; rm -rf /`, the command will execute arbitrary code.

**Recommended Fix:**
```typescript
// For unzip - use spawn with array args:
const proc = spawn('unzip', ['-o', args.archivePath, '-d', args.destination], {
    shell: false,
    stdio: 'pipe'
});

// For run_command - parse the command string properly:
const [cmd, ...cmdArgs] = parseCommand(args.command);
const proc = spawn(cmd, cmdArgs, {
    shell: false,  // Never use shell: true with user input
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
});
```

---

### 2. Path Traversal in AppleScript Command
**Severity:** CRITICAL
**File:** `src/cli/commands.ts`
**Lines:** 737-741

**Issue:** The `waveCommand` function attempts to escape AppleScript strings but the escaping is insufficient:

```typescript
const escapeAppleScript = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const safeCliPath = escapeAppleScript(cliPath);
const safeResolvedPath = escapeAppleScript(resolvedPath);
child = spawn('osascript', ['-e',
    `tell app "Terminal" to do script "node \\"${safeCliPath}\\" wave \\"${safeResolvedPath}\\""`
```

**Vulnerability:** This doesn't escape other shell metacharacters like `$`, backticks, or newlines. An attacker controlling the VCD path could inject commands.

**Recommended Fix:**
```typescript
// Validate paths strictly before passing to AppleScript
if (!/^[a-zA-Z0-9\-_./\\: ]+$/.test(resolvedPath)) {
    throw new Error('Invalid characters in path');
}
```

---

### 3. Unsafe Command Construction in Windows
**Severity:** CRITICAL
**File:** `src/cli/commands.ts`
**Lines:** 727-729, 896

**Issue:** Windows command construction concatenates user-controlled paths directly into command strings:

```typescript
// Line 727-729
child = spawn('cmd', [
    '/c', 'start', '', 'cmd', '/k',
    'node', cliPath, 'wave', resolvedPath  // User-controlled path not escaped
], {

// Line 896
openArgs = ['/c', 'start', url];  // URL from user/server not validated
```

**Recommended Fix:**
```typescript
// Validate URL scheme
const url = `http://localhost:${port}`;
if (!url.match(/^https?:\/\/localhost:\d+$/)) {
    throw new Error('Invalid URL');
}
```

---

## High Severity Issues

### 4. Missing Input Validation on Download URLs (SSRF)
**Severity:** HIGH
**File:** `src/agent/tool-setup-tools.ts`
**Lines:** 532-544

**Issue:** The `download_file` function accepts any URL without validation:

```typescript
download_file: async (args: z.infer<typeof downloadFileSchema>) => {
    const response = await fetch(args.url);  // No URL validation
```

**Vulnerability:** Server-Side Request Forgery (SSRF) - an attacker could make the agent fetch from internal network addresses or file:// URLs.

**Recommended Fix:**
```typescript
const allowedDomains = ['github.com', 'githubusercontent.com'];
const urlObj = new URL(args.url);
if (urlObj.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
}
if (!allowedDomains.some(d => urlObj.hostname.endsWith(d))) {
    throw new Error('URL domain not in allowlist');
}
```

---

### 5. Potential ReDoS in Regex Patterns
**Severity:** HIGH
**File:** `src/fileops/edit.ts`
**Lines:** 344-351

**Issue:** User-controlled regex patterns can cause denial of service:

```typescript
if (options?.isRegex) {
    const flags = (options?.caseSensitive ? '' : 'i') + (options?.all ? 'g' : '');
    regex = new RegExp(search, flags);  // No validation of pattern complexity
}
```

**Vulnerability:** Patterns like `(a+)+b` can cause exponential backtracking.

**Recommended Fix:**
```typescript
if (options?.isRegex) {
    if (search.length > 1000 || (search.match(/[\+\*]/g) || []).length > 10) {
        throw new Error('Regex pattern too complex');
    }
    regex = new RegExp(search, flags);
}
```

---

### 6. Environment Variable Injection
**Severity:** HIGH
**File:** `src/agent/tool-setup-tools.ts`
**Lines:** 576-588

**Issue:** The `set_env_var` function doesn't validate variable names or values:

```typescript
set_env_var: async (args: z.infer<typeof setEnvVarSchema>) => {
    const line = `\n${args.name}=${args.value}\n`;  // No escaping
    await appendFile(envPath, line);
    process.env[args.name] = args.value;
```

**Recommended Fix:**
```typescript
if (!/^[A-Z_][A-Z0-9_]*$/.test(args.name)) {
    throw new Error('Invalid environment variable name');
}
const escapedValue = args.value.replace(/\n/g, '\\n').replace(/"/g, '\\"');
const line = `\n${args.name}="${escapedValue}"\n`;
```

---

## Medium Severity Issues

### 7. Insufficient Path Traversal Protection (Symlinks)
**Severity:** MEDIUM
**Files:** `src/fileops/edit.ts`, `src/fileops/file.ts`
**Lines:** 63-85, 104-126

**Issue:** Path validation doesn't check for symbolic links that point outside the project root.

**Recommended Fix:**
```typescript
const stats = await fs.lstat(resolved);
if (stats.isSymbolicLink()) {
    const realPath = await fs.realpath(resolved);
    if (!realPath.startsWith(normalizedRoot + path.sep)) {
        throw new Error('Symlink points outside project root');
    }
}
```

---

### 8. Missing Timeout on Fetch Requests
**Severity:** MEDIUM
**File:** `src/agent/tool-setup-tools.ts`
**Lines:** 318, 540

**Issue:** The `fetch()` calls don't have timeouts, which could cause hangs.

**Recommended Fix:**
```typescript
const response = await fetch(url, {
    headers: { 'User-Agent': 'gateflow-cli' },
    signal: AbortSignal.timeout(30000)
});
```

---

### 9. Incomplete Error Handling in Subprocess
**Severity:** MEDIUM
**File:** `src/verification/verilator.ts`
**Lines:** 574-644

**Issue:** The simulation function doesn't clean up processes on errors before timeout, potentially leaving zombie processes.

---

## Positive Security Findings

| Area | Status | Notes |
|------|--------|-------|
| Verilator subprocess | ✅ Good | Uses `spawn` with `shell: false` |
| Verible subprocess | ✅ Good | Disables shell execution |
| Path traversal protection | ✅ Good | Core FileTools/EditTools have proper validation |
| User approval system | ✅ Good | Implemented for destructive operations |
| Type safety | ✅ Good | Zod schemas validate tool inputs |
| Policy engine | ✅ Good | Enforces safety contracts on file operations |

---

## Architecture Overview

### Technology Stack
- **Runtime:** Node.js >=18.0.0 (ES Modules)
- **Language:** TypeScript (strict mode)
- **AI SDK:** Vercel AI SDK 6.0
- **LLM:** Claude (via @ai-sdk/anthropic)
- **CLI Framework:** Commander.js
- **Schema Validation:** Zod

### Key Modules (21 total)
```
src/
├── agent/          # AI agent orchestration (multi-agent system)
├── cli/            # CLI entry point & commands
├── approval/       # Safety & policy engine
├── fileops/        # File operations with safety checks
├── indexer/        # SystemVerilog project indexing
├── verification/   # Verilator integration
├── events/         # Event bus architecture
├── ui/             # Terminal rendering
├── config/         # Configuration management
├── context/        # Dynamic context discovery
├── memory/         # Session memory
├── diff/           # Diff generation
├── mcp/            # Model Context Protocol
└── waveform/       # Waveform visualization
```

### Security Architecture
1. **Path Safety:** Enforces project root containment
2. **Policy Engine:** Tool-specific approval rules
3. **User Approval Flow:** Diff preview + confirmation for writes
4. **Zod Validation:** Type-safe parameter validation
5. **Dangerous Patterns:** Blocks system paths (`/etc`, `C:\Windows`, etc.)

---

## Recommended Immediate Actions

| Priority | Action | File | Effort |
|----------|--------|------|--------|
| 🔴 URGENT | Fix command injection in `run_command` | tool-setup-tools.ts:485 | Low |
| 🔴 URGENT | Fix shell injection in `extract_archive` | tool-setup-tools.ts:432 | Low |
| 🔴 URGENT | Improve AppleScript escaping | commands.ts:737 | Low |
| 🟠 HIGH | Add URL validation/allowlist | tool-setup-tools.ts:532 | Low |
| 🟠 HIGH | Validate env variable names | tool-setup-tools.ts:576 | Low |
| 🟠 HIGH | Add regex complexity limits | edit.ts:344 | Low |
| 🟡 MEDIUM | Add symlink protection | file.ts, edit.ts | Medium |
| 🟡 MEDIUM | Add fetch timeouts | tool-setup-tools.ts | Low |
| 🟡 MEDIUM | Clean up zombie processes | verilator.ts | Medium |

---

## Conclusion

The GateFlow CLI demonstrates solid security practices in its core functionality, particularly in file operations and subprocess management for Verilator/Verible. However, the newer tool setup functionality (`tool-setup-tools.ts`) introduces several critical vulnerabilities that should be addressed before production use.

The multi-agent architecture is well-designed with proper separation of concerns, and the event-driven approach provides good extensibility. The codebase would benefit from:

1. Immediate fixes for the command injection vulnerabilities
2. A security review process for new features before merging
3. Integration tests that specifically test security boundaries
4. Consider using a sandboxing library for subprocess execution

---

*Generated by Claude Opus 4.5 - Automated Security Audit*
