/// <reference types="vite/client" />

import "@marimo-team/mdx-marimo/styles.css";
import type { Theme } from "vitepress";

import DefaultTheme from "vitepress/theme";

import MarimoCell from "./components/MarimoCell.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("MarimoCell", MarimoCell);
  },
} satisfies Theme;
