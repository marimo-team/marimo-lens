import type {
  CompiledMarimoPage,
  MarimoCellRequest,
  MarimoDiagnostic,
  MarimoPageCompiler,
  MarimoPageRequest,
} from "@marimo-team/mdx-marimo/remark";

import { compileMarimoPage } from "@marimo-team/mdx-marimo/node";
import {
  fenceLanguage,
  isMarimoConfigFence,
  isMarimoFence,
  parseFenceOptions,
} from "@marimo-team/mdx-marimo/remark";
import MarkdownIt from "markdown-it";
import { Buffer } from "node:buffer";
import { basename, isAbsolute, relative, sep } from "node:path";

export type MarimoVitePressOptions = {
  cwd?: string;
  compile?: MarimoPageCompiler;
  theme?: "auto" | "light" | "dark";
};

type MarkdownToken = ReturnType<MarkdownIt["parse"]>[number];

type MarimoEdit = {
  start: number;
  end: number;
  startLine: number;
  prefix: string;
  cellIndex?: number;
};

type CollectedPage = {
  cells: MarimoCellRequest[];
  diagnostics: MarimoDiagnostic[];
  edits: MarimoEdit[];
  pyproject?: string;
};

type MarimoPluginContext = {
  warn(message: string): void;
};

export function marimoVitePress({
  cwd = process.cwd(),
  compile = (request) => compileMarimoPage(request, { cwd }),
  theme = "auto",
}: MarimoVitePressOptions = {}) {
  const markdown = new MarkdownIt();
  const compilations = new Map<string, Promise<CompiledMarimoPage>>();

  return {
    name: "marimo-lens:vitepress-marimo",
    enforce: "pre" as const,
    async transform(this: MarimoPluginContext, source: string, id: string) {
      const filePath = id.replace(/\?.*$/, "");
      if (!filePath.endsWith(".md") || !source.includes("marimo")) {
        return null;
      }

      const collected = collectMarimoPage(markdown, source);
      if (collected.edits.length === 0) {
        return null;
      }

      const filename = publicFilename(filePath, cwd);
      for (const diagnostic of collected.diagnostics) {
        this.warn(formatDiagnostic(diagnostic, filename, collected.edits));
      }

      const replacements = new Map<number, string>();
      if (collected.cells.length > 0) {
        const request = pageRequest(filename, collected);
        const page = await compileOnce(compilations, compile, request);
        validateCompiledPage(page, request);
        reportCompilerDiagnostics(this, page.diagnostics, filename, collected.edits);

        for (const cell of page.cells) {
          if (
            !cell.options.render.include ||
            (!cell.options.render.source && !cell.options.render.output)
          ) {
            replacements.set(cell.index, "");
            continue;
          }
          const payload = {
            protocolVersion: page.protocolVersion,
            app: page.app,
            cell,
          };
          const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
          replacements.set(
            cell.index,
            `<MarimoCell encoded-payload="${encodedPayload}" theme="${theme}" />`,
          );
        }
      }

      return {
        code: applyEdits(source, collected.edits, replacements),
        map: null,
      };
    },
  };
}

function collectMarimoPage(markdown: MarkdownIt, source: string): CollectedPage {
  const offsets = lineOffsets(source);
  const cells: MarimoCellRequest[] = [];
  const diagnostics: MarimoDiagnostic[] = [];
  const edits: MarimoEdit[] = [];
  let pyproject: string | undefined;
  let configLine: number | undefined;

  for (const token of markdown.parse(source, {})) {
    if (token.type !== "fence" || !token.map) {
      continue;
    }
    const { language, meta } = fenceInfo(token.info);
    const [startLine, endLine] = token.map;
    const start = offsets[startLine] ?? source.length;
    const end = offsets[endLine] ?? source.length;
    const prefix = fencePrefix(source.slice(start, end), token);

    if (isMarimoConfigFence(language)) {
      if (pyproject === undefined) {
        pyproject = stripFenceTerminator(token.content);
        configLine = startLine + 1;
      } else {
        diagnostics.push({
          severity: "warning",
          line: startLine + 1,
          message: `Duplicate marimo-config fence; first config fence is on line ${configLine ?? "unknown"}`,
        });
      }
      edits.push({ start, end, startLine, prefix });
      continue;
    }

    if (!isMarimoFence(language, meta)) {
      continue;
    }

    const parsed = parseFenceOptions(fenceLanguage(language), meta);
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        cellIndex: cells.length,
        line: startLine + 1,
      });
    }

    const cell: MarimoCellRequest = {
      index: cells.length,
      source: stripFenceTerminator(token.content),
      options: parsed.options,
      startLine: startLine + 1,
      endLine,
    };
    cells.push(cell);
    edits.push({
      start,
      end,
      startLine,
      prefix,
      cellIndex: cell.index,
    });
  }

  return { cells, diagnostics, edits, pyproject };
}

function fenceInfo(info: string): { language: string; meta: string } {
  const trimmed = info.trim();
  const separator = trimmed.search(/\s/);
  if (separator === -1) {
    return { language: trimmed, meta: "" };
  }
  return {
    language: trimmed.slice(0, separator),
    meta: trimmed.slice(separator + 1).trim(),
  };
}

function fencePrefix(source: string, token: MarkdownToken): string {
  const openingLine = source.split(/\r?\n/, 1)[0] ?? "";
  const markupIndex = openingLine.indexOf(token.markup);
  return markupIndex === -1 ? "" : openingLine.slice(0, markupIndex);
}

function stripFenceTerminator(source: string): string {
  return source.endsWith("\n") ? source.slice(0, -1) : source;
}

function lineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function pageRequest(filename: string, page: CollectedPage): MarimoPageRequest {
  return {
    protocolVersion: 1,
    identity: filename,
    filename,
    metadata: page.pyproject === undefined ? {} : { pyproject: page.pyproject },
    cells: page.cells,
  };
}

async function compileOnce(
  compilations: Map<string, Promise<CompiledMarimoPage>>,
  compile: MarimoPageCompiler,
  request: MarimoPageRequest,
): Promise<CompiledMarimoPage> {
  const key = JSON.stringify(request);
  const cached = compilations.get(key);
  if (cached) {
    return cached;
  }

  const pending = Promise.resolve(compile(request));
  compilations.set(key, pending);
  void pending.catch(() => {
    if (compilations.get(key) === pending) {
      compilations.delete(key);
    }
  });
  return pending;
}

function validateCompiledPage(page: CompiledMarimoPage, request: MarimoPageRequest): void {
  const protocolVersion: number = page.protocolVersion;
  if (protocolVersion !== request.protocolVersion) {
    throw new Error(`marimo compiler returned protocol ${protocolVersion}; expected 1`);
  }
  if (page.cells.length !== request.cells.length) {
    throw new Error(
      `marimo compiler returned ${page.cells.length} cells; expected ${request.cells.length}`,
    );
  }
  for (const [index, cell] of page.cells.entries()) {
    const expected = request.cells[index]?.index;
    if (cell.index !== expected) {
      throw new Error(
        `marimo compiler returned cell ${cell.index} at position ${index}; expected ${expected}`,
      );
    }
  }
}

function reportCompilerDiagnostics(
  context: MarimoPluginContext,
  diagnostics: MarimoDiagnostic[],
  filename: string,
  edits: MarimoEdit[],
): void {
  const errors: string[] = [];
  for (const diagnostic of diagnostics) {
    const message = formatDiagnostic(diagnostic, filename, edits);
    if (diagnostic.severity === "error") {
      errors.push(message);
    } else {
      context.warn(message);
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

function formatDiagnostic(
  diagnostic: MarimoDiagnostic,
  filename: string,
  edits: MarimoEdit[],
): string {
  const editLine =
    diagnostic.cellIndex === undefined
      ? undefined
      : edits.find((edit) => edit.cellIndex === diagnostic.cellIndex)?.startLine;
  const line = diagnostic.line ?? (editLine === undefined ? undefined : editLine + 1);
  return `${filename}${line === undefined ? "" : `:${line}`}: ${diagnostic.message}`;
}

function applyEdits(
  source: string,
  edits: MarimoEdit[],
  replacements: Map<number, string>,
): string {
  let output = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    const segment = source.slice(edit.start, edit.end);
    const newlineCount = segment.match(/\n/g)?.length ?? 0;
    const replacement =
      edit.cellIndex === undefined ? "" : `${edit.prefix}${replacements.get(edit.cellIndex) ?? ""}`;
    output =
      output.slice(0, edit.start) +
      replacement +
      "\n".repeat(newlineCount) +
      output.slice(edit.end);
  }
  return output;
}

function publicFilename(filename: string, cwd: string): string {
  if (!isAbsolute(filename)) {
    return filename;
  }
  const candidate = relative(cwd, filename);
  if (!candidate.startsWith("..") && !isAbsolute(candidate)) {
    return candidate.split(sep).join("/");
  }
  return basename(filename);
}
