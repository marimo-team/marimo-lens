import { fileURLToPath } from "node:url";
import { marimoVitePress } from "@marimo-team/mdx-marimo/vitepress";
import { defineConfig } from "vitepress";

const repository = "https://github.com/marimo-team/marimo-lens";
const siteUrl = "https://marimo-team.github.io/marimo-lens/";
const description =
  "Point to a marimo notebook result and say what should change. Lens grounds your agent's work in the producing cell, related context, and an annotated image.";
const socialDescription = description;
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
    ["meta", { content: "website", property: "og:type" }],
    ["meta", { content: "marimo-lens", property: "og:title" }],
    ["meta", { content: socialDescription, property: "og:description" }],
    ["meta", { content: siteUrl, property: "og:url" }],
    ["meta", { content: socialImage, property: "og:image" }],
    ["meta", { content: "image/png", property: "og:image:type" }],
    ["meta", { content: "2400", property: "og:image:width" }],
    ["meta", { content: "1260", property: "og:image:height" }],
    ["meta", { content: "marimo-lens", property: "og:image:alt" }],
    ["meta", { content: "summary_large_image", name: "twitter:card" }],
    ["meta", { content: socialImage, name: "twitter:image" }],
    ["meta", { content: "marimo-lens", name: "twitter:image:alt" }],
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
    plugins: [marimoVitePress({ cwd: repositoryRoot })],
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
