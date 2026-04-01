---
applyTo: "**/*.{js,ts,jsx,tsx}"
---

# Coding Style Rules

## JavaScript

### Variable Declaration
- Never use `var` — always use `const` or `let`
- Prefer `const` by default; use `let` only when reassignment is needed

### Async / Error Handling
- Always wrap async operations in `try/catch`
- Never leave a promise unhandled

```js
// ✅ Good
async function fetchData() {
  try {
    const result = await getData()
    return result
  } catch (error) {
    console.error('fetchData failed:', error)
  }
}

// ❌ Bad
async function fetchData() {
  const result = await getData()
  return result
}
```

### IIFE
- All immediately invoked logic must be wrapped inside an IIFE

```js
// ✅ Good
;(async () => {
  await init()
  await bootstrap()
})()

// ❌ Bad
await init()
await bootstrap()
```

---

## TypeScript

### Naming Conventions
- Type aliases must be prefixed with uppercase `T`
- Interfaces must be prefixed with uppercase `I`

```ts
// ✅ Good
type TUser = {
  id: number
  name: string
}

interface IUser {
  id: number
  name: string
}

// ❌ Bad
type User = { ... }
interface User { ... }
```

### Type vs Interface
- Always prefer `type` over `interface`
- Use `interface` only when necessary (e.g., declaration merging, extending third-party types)

```ts
// ✅ Good
type TProduct = {
  id: number
  name: string
}

// ⚠️ Only use interface when truly required
interface IPlugin extends ThirdPartyPlugin {
  customMethod(): void
}
```

---

## General TypeScript / JavaScript

### Avoid `any`
- Do not use `any` unless there is a well-justified reason
- Prefer `unknown` when the type is truly uncertain, then narrow it down

```ts
// ✅ Good
function parse(input: unknown): string {
  if (typeof input === 'string') return input
  throw new Error('Invalid input')
}

// ❌ Bad
function parse(input: any): any {
  return input
}
```

### `undefined` vs `null`
- Prefer `undefined` over `null` by default
- Use `null` only when integrating with external APIs that explicitly require it

```ts
// ✅ Good
type TConfig = {
  timeout?: number        // undefined when not set
  callback?: () => void
}

// ✅ Acceptable — external API requires null
const payload = {
  userId: 123,
  deletedAt: null         // required by API contract
}

// ❌ Bad
type TConfig = {
  timeout: number | null
  callback: (() => void) | null
}
```
