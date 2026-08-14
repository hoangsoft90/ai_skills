---
name: type-safety-check
description: Audit data flow for JS key type mismatches. Run when: building nested lookup structures, adding new API endpoints, syncing state between backend/frontend, or debugging "data exists in DB but doesn't show in UI".
metadata:
  author: willshoes
  version: "1.0"
---

# Type Safety Check — Silent Data Loss from Key Type Mismatch

## Problem Pattern

JavaScript treats `"1"` (string) and `1` (number) as different object keys:

```js
const obj = {};
obj["1"] = "hello";
obj[1] = "world";
console.log(obj);  // { "1": "world" } — string key OVERWRITTEN by number key
console.log(obj["1"]); // "world" — not "hello"
```

This causes **silent data loss**: data exists in DB, server returns it, but client lookup returns `undefined` because key types don't match.

## When to Run

- **After writing any code** that builds nested lookup objects (e.g., `{ date: { shift: { empId: data } } }`)
- **When debugging** "data is in DB but doesn't show in UI"
- **Before committing** any change to API response shape or state structure
- **When adding new API endpoints** that return keyed data

## Audit Steps

### Step 1: Map All Write Paths

Find every place that WRITES to the nested structure. For each, record the exact key type:

```
Path 1: server.py get_state() line XXX
  → sh = str(r[1])   ← STRING key
  
Path 2: dashboard.js syncActuals() line XXX  
  → state.actuals[a.date][a.shift][a.employeeId]
  → a.shift from JSON parse ← NUMBER key
```

### Step 2: Map All Read Paths

Find every place that READS from the same structure:

```
Read 1: dashboard.js renderDashboard() line XXX
  → state.actuals[dateStr][sid]
  → sid from SHIFT_IDS = [1,2,3,4] ← NUMBER key

Read 2: dashboard.js refreshCheckinEmpList() line XXX
  → (state.registrations[dateStr] || {})[sid]
  → sid from document.getElementById('ciShift').value ← STRING (from <select>)
```

### Step 3: Compare Types

Build a truth table:

| Path | Key Source | JS Type | Match? |
|------|-----------|---------|--------|
| get_state() write | `str(r[1])` | string | |
| syncActuals() write | `a.shift` from JSON | number | |
| renderDashboard() read | `SHIFT_IDS[i]` | number | |
| refreshCheckinEmpList() read | `<select>.value` | string | |

**If any write type ≠ any read type = BUG.** Fix by normalizing all paths to the same type.

### Step 4: Check JSON Serialization

Python `json.dumps` behavior:
- `json.dumps({"1": x})` → `{"1": x}` — string stays string
- `json.dumps({1: x})` → `{"1": x}` — Python int becomes JSON number... **wait no**:
  - Python `json.dumps({1: "a"})` → `{"1": "a"}` — actually JSON keys are ALWAYS strings
  - But `json.dumps({"shift": 1})` → `{"shift": 1}` — the VALUE is a number

**Critical distinction:**
- Object KEYS: always strings in JSON (but JS differentiates `"1"` vs `1`)
- Object VALUES: preserve type (number stays number)

When server returns `{"actuals": {"2026-07-23": {"1": {...}}}}`:
- The `"1"` is a STRING key (from Python `str(r[1])`)
- Client reads with `state.actuals[date][1]` (number) → **MISMATCH**

### Step 5: Verify Fix

After normalizing types, verify ALL paths:

```python
# Server: ALL key-building code must use the SAME type
# If dashboard reads with number keys:
sh = int(r[1])   # ✅ NUMBER
# NOT:
sh = str(r[1])   # ❌ STRING — will mismatch
```

```js
// Client: check <select>.value returns STRING
const sid = Number(document.getElementById('ciShift').value); // ✅ convert
// NOT:
const sid = document.getElementById('ciShift').value; // ❌ string
```

## Common Trap: `<select>.value` Is Always String

```html
<select id="ciShift"><option value="1">Sáng</option></select>
```

```js
document.getElementById('ciShift').value // "1" — STRING, not number
```

Always wrap with `Number()` or `parseInt()` when comparing with number keys.

## Quick Diagnostic Commands

```bash
# Find all places a nested key structure is written
grep -rn '\[.*shift\]\|\.shift' assets/js/*.js server.py

# Find all places a nested key structure is read  
grep -rn 'state\.actuals\|state\.registrations' assets/js/*.js

# Check Python key type in server response
python3 -c "import json; print(json.dumps({'1': 'a', 1: 'b'}))"
# Output: {"1": "b"} — Python dict dedup, int key becomes string in JSON
```

## Prevention Checklist

Before writing nested lookup code, confirm:

- [ ] All write paths use same key type (number OR string, pick one)
- [ ] All read paths use same key type as write paths
- [ ] `<select>.value` converted with `Number()` before lookup
- [ ] Python `str()` vs `int()` consistent across all query result processing
- [ ] No mixed `str(r[1])` and `r[1]` (raw) in same codebase
