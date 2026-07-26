import { fileURLToPath } from "node:url";
import { marimoVitePress } from "@marimo-team/mdx-marimo/vitepress";
import { defineConfig } from "vitepress";

const repository = "https://github.com/marimo-team/marimo-lens";
const siteUrl = "https://marimo-team.github.io/marimo-lens/";
const description =
  "Select a point or region in a live marimo output and give your notebook agent the context behind it.";
const socialDescription =
  "Select a notebook result. Your agent starts with the selection, note, and cells behind it.";
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
      message:
        "Point to a result. Lens gives your agent its notebook context. Review what comes back.",
    },
    logo: {
      alt: "marimo-lens",
      dark: "/brand/marimo-lens-lockup-horizontal-dark.svg",
      light: "/brand/marimo-lens-lockup-horizontal-light.svg",
    },
    nav: [
      { text: "Getting started", link: "/getting-started" },
      { text: "Pair integration", link: "/pair" },
      { text: "Selections", link: "/selections" },
      { text: "How it works", link: "/how-it-works" },
      { text: "Python API", link: "/api" },
    ],
    outline: [2, 3],
    search: { provider: "local" },
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Overview", link: "/" },
          { text: "Getting started", link: "/getting-started" },
        ],
      },
      {
        text: "Use Lens",
        items: [{ text: "Pair integration", link: "/pair" }],
      },
      {
        text: "Learn",
        items: [
          { text: "Selections", link: "/selections" },
          { text: "How it works", link: "/how-it-works" },
        ],
      },
      {
        text: "Reference",
        items: [{ text: "Python API", link: "/api" }],
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
