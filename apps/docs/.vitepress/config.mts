import { fileURLToPath } from "node:url";
import { marimoVitePress } from "@marimo-team/mdx-marimo/vitepress";
import { defineConfig } from "vitepress";

const repository = "https://github.com/marimo-team/marimo-lens";
const siteUrl = "https://marimo-team.github.io/marimo-lens/";
const description =
  "Point to a marimo notebook result and say what should change. Lens grounds your agent's work in the producing cell, related context, and an annotated image.";
const socialDescription =
  "Mark a result. Lens grounds your agent in the cells behind it.";
const socialImage = `${siteUrl}brand/marimo-lens-og.png`;
const baseName = process.env.BASE_PATH?.trim().replace(/^\/+|\/+$/g, "");
const basePath = baseName ? `/${baseName}` : "";
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const publicPath = (path: string): string => `${basePath}${path}`;

export default defineConfig({
  base: basePath ? `${basePath}/` : "/",
  cleanUrls: true,
  description,
  head: [
    [
      "link",
      {
        href: publicPath("/brand/marimo-lens-mark-light.svg"),
        media: "(prefers-color-scheme: light)",
        rel: "icon",
        type: "image/svg+xml",
      },
    ],
    [
      "link",
      {
        href: publicPath("/brand/marimo-lens-mark-dark.svg"),
        media: "(prefers-color-scheme: dark)",
        rel: "icon",
        type: "image/svg+xml",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "marimo-lens" }],
    [
      "meta",
      {
        property: "og:title",
        content: "Visual grounding for your notebook agent",
      },
    ],
    ["meta", { property: "og:description", content: socialDescription }],
    ["meta", { property: "og:url", content: siteUrl }],
    ["meta", { property: "og:image", content: socialImage }],
    ["meta", { property: "og:image:type", content: "image/png" }],
    ["meta", { property: "og:image:width", content: "2400" }],
    ["meta", { property: "og:image:height", content: "1260" }],
    [
      "meta",
      {
        property: "og:image:alt",
        content: "marimo-lens. Let your agent see what you see.",
      },
    ],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: socialImage }],
    ["meta", { name: "twitter:image:alt", content: "marimo-lens" }],
  ],
  lastUpdated: true,
  markdown: {
    languageAlias: {
      "marimo-config": "toml",
    },
  },
  srcDir: "../../docs",
  themeConfig: {
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      copyright:
        "Released under the Apache 2.0 License. Copyright © 2026-Present marimo-lens maintainers.",
    },
    logo: {
      alt: "marimo-lens",
      dark: "/brand/marimo-lens-lockup-horizontal-dark.svg",
      light: "/brand/marimo-lens-lockup-horizontal-light.svg",
    },
    nav: [
      { text: "Overview", link: "/overview" },
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Use with marimo Pair", link: "/pair" },
          { text: "Selections", link: "/selections" },
        ],
      },
      { text: "Reference", link: "/api" },
    ],
    outline: [2, 3],
    search: { provider: "local" },
    sidebar: [
      {
        text: "Overview",
        link: "/overview",
      },
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Use with marimo Pair", link: "/pair" },
          { text: "Selections", link: "/selections" },
        ],
      },
      {
        text: "Reference",
        link: "/api",
      },
    ],
    siteTitle: false,
    socialLinks: [{ icon: "github", link: repository }],
  },
  title: "marimo-lens",
  vite: {
    plugins: [
      marimoVitePress({
        compiler: { cacheDir: false, uvCommand: "uv" },
        cwd: repositoryRoot,
      }),
    ],
    publicDir,
  },
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag === "marimo-mdx-island",
      },
    },
  },
});
