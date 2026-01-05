# GateFlow CLI - Vulnerability Assessment

**Date**: January 3, 2025  
**Version**: 1.0.0  
**Status**: Pre-launch Security Audit

---

## Critical Vulnerabilities

### 1. **Path Traversal via Symlinks** ⚠️ HIGH
**Location**: `cli/src/tools/file.ts:resolvePath()`, `cli/src/policy/engine.ts:checkPathSafety()`

**Issue**: 
- `path.resolve()` follows symlinks, allowing access outside project root
- Policy checks use `startsWith()` which can be bypassed with symlinks
- No symlink resolution check before file operations

**Exploit**:
```bash
# Create symlink pointing outside project
ln -s /etc/passwd ./malicious.sv

# Agent can read/write outside project
gateflow "read_file malicious.sv"
gateflow "write_file malicious.sv 'evil content'"
```

**Impact**: Read/write access to any file system path

**Fix**: Use `fs.realpath()` or `fs.lstat()` to detect symlinks, reject paths outside project root after resolution

---

### 2. **Command Injection in Verilator** ⚠️ CRITICAL
**Location**: `cli/src/verification/verilator.ts:lint()`, `compile()`, `simulate()`

**Issue**:
- File paths are concatenated into shell commands without sanitization
- WSL path conversion doesn't escape special characters
- `execAsync()` runs shell commands directly

**Exploit**:
```bash
# Create file with malicious name
touch "file.sv; rm -rf /"

# Or via WSL path injection
VERILATOR_PATH="/usr/bin/verilator"
gateflow lint "file.sv; echo 'pwned' > /tmp/hacked"
```

**Impact**: Remote code execution (RCE)

**Fix**: Use `spawn()` with array arguments instead of string concatenation, sanitize all paths

---

### 3. **Regex DoS (ReDoS)** ⚠️ MEDIUM
**Location**: `cli/src/tools/file.ts:searchCode()`, `cli/src/context/parser.ts`

**Issue**:
- User-provided regex patterns are executed without timeout
- Catastrophic backtracking possible with patterns like `(a+)+b`
- No regex complexity limits

**Exploit**:
```bash
gateflow "search_code '(a+)+b'"
# Hangs indefinitely on large files
```

**Impact**: Denial of service (DoS), hangs CLI

**Fix**: Add regex timeout, limit pattern complexity, validate patterns

---

### 4. **Unbounded Memory Growth** ⚠️ MEDIUM
**Location**: `cli/src/events/bus.ts`, `cli/src/agent/core.ts`

**Issue**:
- Event history grows unbounded (only capped at 1000)
- Conversation history never cleared
- Large file reads stored in memory

**Exploit**:
```bash
# Read huge files repeatedly
for i in {1..1000}; do
  gateflow "read_file huge_file.sv"
done
# Memory exhaustion
```

**Impact**: Out-of-memory crashes

**Fix**: Implement memory limits, clear old history, stream large files

---

### 5. **API Rate Limit Bypass** ⚠️ MEDIUM
**Location**: `cli/src/agent/core.ts:run()`

**Issue**:
- No rate limiting on API calls
- `maxToolCalls` is 25 but can be exceeded with nested loops
- No cost tracking or budget limits

**Exploit**:
```bash
# Burn through API credits
gateflow "list all files"  # Triggers many tool calls
gateflow "search for every module"  # More API calls
# No protection against runaway costs
```

**Impact**: Unexpected API costs, account depletion

**Fix**: Add rate limiting, cost tracking, budget caps

---

## High-Risk Issues

### 6. **Path Traversal via Relative Paths** ⚠️ HIGH
**Location**: `cli/src/tools/file.ts:resolvePath()`

**Issue**:
- `../` sequences not normalized before `path.resolve()`
- Policy check happens after resolution, can be bypassed

**Exploit**:
```bash
gateflow "read_file ../../.env"
gateflow "write_file ../../../etc/hosts 'evil'"
```

**Impact**: Access files outside project root

**Fix**: Normalize paths before resolution, validate against project root

---

### 7. **Race Condition in File Writes** ⚠️ MEDIUM
**Location**: `cli/src/tools/edit.ts:editLines()`, `searchReplace()`

**Issue**:
- File read → modify → write pattern has race window
- Multiple concurrent edits can corrupt files
- No file locking

**Exploit**:
```bash
# Two concurrent edits
gateflow "edit_lines file.sv ..." &
gateflow "edit_lines file.sv ..." &
# File corruption possible
```

**Impact**: File corruption, data loss

**Fix**: Add file locking or atomic write operations

---

### 8. **Unvalidated Line Numbers** ⚠️ MEDIUM
**Location**: `cli/src/tools/edit.ts:editLines()`

**Issue**:
- Line numbers validated but can be negative or extremely large
- No bounds checking on `startLine`/`endLine` before array access

**Exploit**:
```bash
gateflow "edit_lines file.sv [{startLine: -1, endLine: 999999, newContent: 'evil'}]"
# Potential crash or memory corruption
```

**Impact**: Crashes, undefined behavior

**Fix**: Validate line numbers are positive and within file bounds

---

### 9. **Infinite Fix Loop** ⚠️ MEDIUM
**Location**: `cli/src/verification/fix-loop.ts:run()`

**Issue**:
- Thrashing detection can be bypassed if errors change slightly
- No hard timeout on fix loop duration
- Can run indefinitely

**Exploit**:
```bash
gateflow fix broken_file.sv
# If errors mutate each iteration, loop never stops
```

**Impact**: Resource exhaustion, hangs

**Fix**: Add hard timeout, better thrashing detection

---

### 10. **Unsafe Regex in searchCode** ⚠️ MEDIUM
**Location**: `cli/src/tools/file.ts:searchCode()`

**Issue**:
- User-provided pattern compiled directly without validation
- No protection against malicious regex

**Exploit**:
```bash
gateflow "search_code '.*'"
# Matches entire file, memory issues
gateflow "search_code '(?=.*a)(?=.*b)...'"
# Complex lookahead, slow execution
```

**Impact**: DoS, memory issues

**Fix**: Validate patterns, limit complexity, add timeouts

---

## Medium-Risk Issues

### 11. **Project Root Detection Bypass**
**Location**: `cli/src/cli/commands.ts:detectProjectRoot()`

**Issue**:
- Detection logic can be confused by nested `cli/` directories
- Falls back to current directory if markers not found

**Exploit**:
```bash
cd /tmp
gateflow scan
# May scan wrong directory
```

**Impact**: Wrong project indexed, edits in wrong location

---

### 12. **WSL Path Injection**
**Location**: `cli/src/verification/verilator.ts:toWslPath()`

**Issue**:
- Path conversion doesn't validate input
- Special characters not escaped

**Exploit**:
```bash
VERILATOR_PATH="/usr/bin/verilator"
gateflow lint "file.sv; echo pwned"
# Command injection via WSL
```

**Impact**: Command execution

---

### 13. **Approval Timeout Race**
**Location**: `cli/src/events/bus.ts:requestApproval()`

**Issue**:
- Timeout can fire while approval prompt is displayed
- Race condition between timeout and user input

**Exploit**:
```bash
# Slow approval response
gateflow "edit_lines critical.sv ..."
# Timeout fires, operation fails even if user approves
```

**Impact**: Poor UX, failed operations

---

### 14. **Glob Pattern DoS**
**Location**: `cli/src/tools/file.ts:findFiles()`

**Issue**:
- User-provided glob patterns not validated
- Can match millions of files

**Exploit**:
```bash
gateflow "list_files directory='**/*'"
# Scans entire filesystem if project root is wrong
```

**Impact**: DoS, slow performance

---

### 15. **Unhandled Promise Rejections**
**Location**: Multiple files

**Issue**:
- Many async operations lack error handling
- Unhandled rejections can crash Node.js

**Exploit**:
```bash
gateflow "read_file /nonexistent/file.sv"
# Unhandled rejection if error not caught
```

**Impact**: Crashes

---

## Low-Risk Issues

### 16. **JSON Output Injection**
**Location**: `cli/src/events/bus.ts:toJsonStream()`

**Issue**:
- Event data serialized without sanitization
- Malicious file content could break JSON parsing

**Impact**: JSON parsing errors

---

### 17. **Exit Code Confusion**
**Location**: `cli/src/cli/commands.ts`

**Issue**:
- Exit codes not consistently set
- PowerShell stderr handling causes false positives

**Impact**: CI/CD integration issues

---

### 18. **Large File Handling**
**Location**: `cli/src/tools/file.ts:readFile()`

**Issue**:
- Entire file loaded into memory
- No streaming for large files

**Impact**: Memory exhaustion on huge files

---

## Recommendations

### Immediate Fixes (Before v1.0)

1. **Fix command injection** - Use `spawn()` with array args
2. **Fix path traversal** - Add symlink detection and normalization
3. **Add regex timeouts** - Prevent ReDoS attacks
4. **Add rate limiting** - Protect API costs

### Short-Term Fixes (v1.0.1)

5. **Add file locking** - Prevent race conditions
6. **Improve error handling** - Catch all promise rejections
7. **Add memory limits** - Cap event history and file sizes
8. **Validate all inputs** - Sanitize paths, patterns, line numbers

### Long-Term Improvements (v1.1+)

9. **Add comprehensive tests** - Cover all edge cases
10. **Security audit** - Professional penetration testing
11. **Add sandboxing** - Isolate file operations
12. **Add monitoring** - Track API usage and errors

---

## Testing Scenarios

### Path Traversal Tests
```bash
# Test 1: Relative path escape
gateflow "read_file ../../.env"

# Test 2: Symlink traversal
ln -s /etc/passwd test.sv
gateflow "read_file test.sv"

# Test 3: Absolute path
gateflow "read_file /etc/passwd"
```

### Command Injection Tests
```bash
# Test 1: File name injection
touch "file.sv; echo pwned"
gateflow lint "file.sv; echo pwned"

# Test 2: WSL path injection
VERILATOR_PATH="/usr/bin/verilator"
gateflow lint "file.sv; rm -rf /tmp/test"
```

### ReDoS Tests
```bash
# Test 1: Catastrophic backtracking
gateflow "search_code '(a+)+b'"

# Test 2: Nested quantifiers
gateflow "search_code '(a*)*b'"
```

### Resource Exhaustion Tests
```bash
# Test 1: Large file
dd if=/dev/zero of=huge.sv bs=1M count=1000
gateflow "read_file huge.sv"

# Test 2: Many files
for i in {1..10000}; do touch "file$i.sv"; done
gateflow scan
```

---

## Summary

**Critical**: 2 issues (command injection, path traversal)  
**High**: 4 issues  
**Medium**: 9 issues  
**Low**: 3 issues

**Total**: 18 identified vulnerabilities

**Recommendation**: Fix critical and high-risk issues before v1.0 launch. Medium-risk issues can be addressed in v1.0.1.

