import parser from "@typescript-eslint/parser";
import tseslint from "@typescript-eslint/eslint-plugin";

export default [
    {
        ignores: ["dist", "worker", "node_modules"],
    },
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser,
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            "no-var": "error",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": "warn",
        },
    },
    {
        files: ["src/client/**/*.js", "extension/*.js"],
        rules: {
            "no-var": "error",
            "no-unused-vars": "warn",
        },
    },
];
