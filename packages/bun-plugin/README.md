# @ripple-ts/bun-plugin

Bun plugin for compiling Ripple `.tsrx` files.

## Installation

```bash
pnpm add -D @ripple-ts/bun-plugin
```

## Usage

```ts
import { ripple } from '@ripple-ts/bun-plugin';

await Bun.build({
  entrypoints: ['./src/App.tsrx'],
  outdir: './dist',
  target: 'browser',
  plugins: [ripple()],
});
```

The plugin compiles `.tsrx` modules with `@tsrx/ripple`. When a component emits
CSS, the plugin imports a sibling virtual CSS module so Bun can include the styles
in the build graph.

## Testing With `bun:test`

Register the plugin from a Bun test preload file before importing `.tsrx` modules
in tests.

```ts
// test/setup.ts
import { ripple } from '@ripple-ts/bun-plugin';

Bun.plugin(ripple());
```

```toml
# bunfig.toml
[test]
preload = ["./test/setup.ts"]
```

```ts
import { expect, test } from 'bun:test';
import { App } from './App.tsrx';

test('imports a .tsrx module', () => {
  expect(App).toBeDefined();
});
```

## Options

- `mode`: `'auto' | 'client' | 'server'` (default: `'auto'`). Auto mode treats
  Bun's default/browser target as client output and other targets as server
  output.
- `emitCss`: whether to emit virtual CSS imports (default: `true`).
- `dev`, `hmr`, `minifyCss`, `compatKinds`: forwarded to the Ripple compiler.
- `include`, `exclude`: regex filters for source files.
