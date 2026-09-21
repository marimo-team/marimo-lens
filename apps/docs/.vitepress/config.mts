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
const devPort = process.env.PORT ? Number(process.env.PORT) : undefined;
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

const gettingStarted = { text: "Getting started", link: "/getting-started" };
const connectAnAgent = { text: "Connect an agent", link: "/agents" };
const guideTasks = [
  { text: "Selections", link: "/selections" },
  { text: "Custom targets", link: "/custom-targets" },
  { text: "Data and trust", link: "/data-and-trust" },
  { text: "Troubleshooting", link: "/troubleshooting" },
];
const introduction = [
  { text: "What is Lens?", link: "/overview" },
  gettingStarted,
  { text: "How Lens works", link: "/how-lens-works" },
];
const guide = [guideTasks[0], connectAnAgent, ...guideTasks.slice(1)];
const reference = [
  { text: "Python API", link: "/api" },
  { text: "LensContext", link: "/reference/context" },
  { text: "HTML attributes", link: "/reference/attributes" },
  { text: "Errors and limits", link: "/reference/errors" },
  { text: "Compatibility", link: "/compatibility" },
];

export default defineConfig({
  base: basePath ? `${basePath}/` : "/",
  cleanUrls: true,
  description,
  head: [
    [
      "link",
      {
        href: publicPath("/brand/marimo-lens-favicon.svg"),
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
    config(md) {
      // "**Select**" names the dock control. Rendered pages show it with the
      // dock's pointer icon; authored Markdown and generated text views stay plain.
      const renderStrongOpen =
        md.renderer.rules.strong_open ??
        ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
      md.renderer.rules.strong_open = (tokens, index, options, env, self) => {
        const text = tokens[index + 1];
        const close = tokens[index + 2];
        if (text?.type === "text" && text.content === "Select" && close?.type === "strong_close") {
          tokens[index]?.attrJoin("class", "lens-select");
        }
        return renderStrongOpen(tokens, index, options, env, self);
      };
    },
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
      message: [
        'marimo-lens is a collaboration of <a href="https://marimo.io/" target="_blank" rel="noopener noreferrer">Marimo Team</a>, <a href="https://ivia.ethz.ch/" target="_blank" rel="noopener noreferrer">ETH Zurich IVIA Lab</a>, and <a href="https://dig.cmu.edu/team" target="_blank" rel="noopener noreferrer">CMU Data Interaction Group</a>.',
        `<a href="${repository}/issues" target="_blank" rel="noopener noreferrer">Issues and support</a> · <a href="${repository}/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">Contributing</a> · <a href="${repository}/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">Security policy</a>`,
      ].join("<br>"),
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
      { text: "Guide", items: [gettingStarted, ...guideTasks] },
      { text: "Agents", link: connectAnAgent.link },
      { text: "Reference", items: reference },
    ],
    outline: [2, 3],
    search: { provider: "local" },
    sidebar: [
      { text: "Introduction", items: introduction },
      { text: "Guide", items: guide },
      { text: "Reference", items: reference },
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
    server: {
      host: "127.0.0.1",
      port: devPort,
      strictPort: devPort !== undefined,
    },
  },
  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag) => tag === "marimo-mdx-island",
      },
    },
  },
});
