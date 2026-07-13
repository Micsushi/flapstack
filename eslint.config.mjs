import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "out/**",
      "dist/**",
      "release/**",
      "coverage/**",
      "resources/bin/**",
      "native/**/target/**",
      "package-lock.json",
      "bun.lock",
      "bun.lockb",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tseslint.parser,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-debugger": "off",
      "no-constant-binary-expression": "error",
      "no-control-regex": "off",
      "no-empty-pattern": "error",
      "no-irregular-whitespace": "error",
      "no-loss-of-precision": "error",
      "no-misleading-character-class": "error",
      "no-new-native-nonconstructor": "error",
      "no-obj-calls": "error",
      "no-prototype-builtins": "off",
      "no-regex-spaces": "error",
      "no-sparse-arrays": "error",
      "no-unexpected-multiline": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
]
