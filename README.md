# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Local development

Use Node 20 LTS (>= 20.19.0) for local dev (Vite requires 20.19+; native modules like `better-sqlite3` are not ready for Node 24).

```bash
nvm install
nvm use
node -v
npm install
npm run dev:all
```

After a restart (new terminal), quick checklist:
- `node -v`
- `npm -v`
- `npm run dev:all`

Sanity check for the engine DB dependency:

```bash
npm run check:engine
```

SQLite notes:
- `data/engine.sqlite*` is local runtime state and is intentionally not tracked by git.
- It will be created automatically on first run (e.g., `npm run dev:all`).

Local dev server host:
- Default host is `127.0.0.1` to avoid EPERM on some macOS setups.
- Override with `HOST=0.0.0.0` only if you want LAN access.

If `better-sqlite3` fails to build on macOS, install the Xcode Command Line Tools:

```bash
xcode-select --install
```

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Testing

Unit tests (Vitest):

```bash
npm run test:unit
```

E2E tests (Playwright):

```bash
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:report
```

Run all tests:

```bash
npm test
```

## Engine report (PL/EN)

In the Engine view, start a session and click **Utwórz raport** in the “Sesja” panel.  
Inside the report view you can use:
- **Print** – opens the print dialog
- **Download PDF** – also opens the print dialog (use “Save as PDF”)
- **Export data (CSV)** – downloads `ideas.csv`, `questions.csv`, `responses.csv`

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Supabase Auth (Vercel + local)

Set these env vars in Vercel project settings and in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

For Vite builds, also mirror them as:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Saved sessions are stored in the Supabase table `user_sessions`; ensure RLS policies are applied (see `supabase.sql`).

If you add server-side write/merge logic later, use a server-only key:

```
SUPABASE_SERVICE_ROLE_KEY=... # do NOT expose to the browser
```
