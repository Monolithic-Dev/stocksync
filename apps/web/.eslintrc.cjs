module.exports = {
  extends: ["../../.eslintrc.cjs", "plugin:react-hooks/recommended"],
  plugins: ["react-refresh"],
  env: { node: false, browser: true, es2022: true },
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  },
};
