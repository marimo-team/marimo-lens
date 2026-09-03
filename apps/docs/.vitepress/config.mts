import { marimoVitePress } from "@marimo-team/mdx-marimo/vitepress";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitepress";
import llmstxt from "vitepress-plugin-llms";

const repository = "https://github.com/marimo-team/marimo-lens";
const siteUrl = "https://marimo-team.github.io/marimo-lens/";
const description =
  "Point to a marimo notebook result and say what should change. Lens connects that selection to the cells and notebook context behind the result.";
const socialImage = `${siteUrl}brand/marimo-lens-og.png`;
const baseName = process.env.BASE_PATH?.trim().replace(/^\/+|\/+$/g, "");
const basePath = baseName ? `/${baseName}` : "";
const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const publicPath = (path: string): string => `${basePath}${path}`;
// The plugin appends VitePress's base path when it builds Markdown URLs.
const llmsDomain = basePath ? new URL(siteUrl).origin : siteUrl.replace(/\/$/, "");
// SAFETY: vitepress-plugin-llms returns two Vite plugins whose standard hooks
// are loaded and executed by this VitePress version during every docs build.
const llmsPlugins = llmstxt({
  customTemplateVariables: {
    description:
      "marimo-lens connects a visual selection to the cells and notebook context behind it.",
  },
  domain: llmsDomain,
  excludeIndexPage: false,
}) as [Plugin, Plugin];

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
  sitemap: {
    hostname: siteUrl,
  },
  srcDir: "../../docs",
  themeConfig: {
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      message:
        'marimo-lens is a collaboration of <a href="https://marimo.io/" target="_blank" rel="noopener noreferrer">Marimo Team</a>, <a href="https://ivia.ethz.ch/" target="_blank" rel="noopener noreferrer">ETH Zurich IVIA Lab</a>, and <a href="https://dig.cmu.edu/team" target="_blank" rel="noopener noreferrer">CMU Data Interaction Group</a>.',
      copyright:
        "Released under the Apache 2.0 License. Copyright © 2026-Present marimo-lens maintainers.",
    },
    logo: {
      alt: "marimo-lens",
      dark: "/brand/marimo-lens-lockup-horizontal-dark.svg",
      light: "/brand/marimo-lens-lockup-horizontal-light.svg",
    },
    nav: [
      {
        text: "Overview",
        items: [
          { text: "What is Lens?", link: "/overview" },
          { text: "Why Lens?", link: "/why-lens" },
          { text: "Getting started", link: "/getting-started" },
          { text: "How Lens works", link: "/how-lens-works" },
        ],
      },
      {
        text: "Core concepts",
        items: [
          { text: "Targets", link: "/concepts/targets" },
          { text: "Selections", link: "/selections" },
          { text: "Context and evidence", link: "/concepts/evidence" },
          { text: "Feedback and History", link: "/concepts/feedback" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Connect an agent", link: "/agents" },
          { text: "Data and trust", link: "/data-and-trust" },
          { text: "Compatibility", link: "/compatibility" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Python API", link: "/api" },
          { text: "LensContext", link: "/reference/context" },
          { text: "Errors and limits", link: "/reference/errors" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Issues and support", link: `${repository}/issues` },
          { text: "Security policy", link: `${repository}/blob/main/SECURITY.md` },
          { text: "Contributing", link: `${repository}/blob/main/CONTRIBUTING.md` },
        ],
      },
    ],
    outline: [2, 3],
    search: { provider: "local" },
    sidebar: [
      {
        text: "Overview",
        items: [
          { text: "What is Lens?", link: "/overview" },
          { text: "Why Lens?", link: "/why-lens" },
          { text: "Getting started", link: "/getting-started" },
          { text: "How Lens works", link: "/how-lens-works" },
        ],
      },
      {
        text: "Core concepts",
        items: [
          { text: "Targets", link: "/concepts/targets" },
          { text: "Selections", link: "/selections" },
          { text: "Context and evidence", link: "/concepts/evidence" },
          { text: "Feedback and History", link: "/concepts/feedback" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Connect an agent", link: "/agents" },
          { text: "Data and trust", link: "/data-and-trust" },
          { text: "Compatibility", link: "/compatibility" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Python API", link: "/api" },
          { text: "LensContext", link: "/reference/context" },
          { text: "Errors and limits", link: "/reference/errors" },
        ],
      },
    ],
    siteTitle: false,
    socialLinks: [{ icon: "github", link: repository }],
  },
  title: "marimo-lens",
  transformPageData(pageData) {
    const pageTitle = String(pageData.frontmatter.title ?? pageData.title ?? "marimo-lens");
    const pageDescription = String(pageData.frontmatter.description ?? description);
    const pagePath =
      pageData.relativePath === "index.md" ? "" : pageData.relativePath.replace(/\.md$/, "");
    const pageUrl = new URL(pagePath, siteUrl).toString();
    pageData.frontmatter.head = [
      ...(pageData.frontmatter.head ?? []),
      ["meta", { property: "og:title", content: pageTitle }],
      ["meta", { property: "og:description", content: pageDescription }],
      ["meta", { property: "og:url", content: pageUrl }],
      ["meta", { name: "twitter:title", content: pageTitle }],
      ["meta", { name: "twitter:description", content: pageDescription }],
    ];
  },
  vite: {
    plugins: [
      ...llmsPlugins,
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
