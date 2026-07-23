<script setup lang="ts">
import { onMounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    encodedPayload: string;
    theme?: "auto" | "light" | "dark";
  }>(),
  {
    theme: "auto",
  },
);

const loadError = ref<string>();

onMounted(async () => {
  try {
    await import("@marimo-team/mdx-marimo/element/auto");
  } catch (error: unknown) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }
});
</script>

<template>
  <p v-if="loadError" class="marimo-cell-error" role="alert">
    The marimo cell could not start: {{ loadError }}
  </p>
  <marimo-mdx-island
    v-else
    :key="encodedPayload"
    class="marimo-island-host marimo-docs-cell"
    aria-label="Live marimo cell"
    data-marimo-docs-cell
    data-marimo-host="mdx"
    data-marimo-payload-encoding="base64url"
    :data-marimo-payload="encodedPayload"
    :data-marimo-theme-mode="theme"
  />
</template>

<style scoped>
.marimo-docs-cell {
  --marimo-island-background: var(--vp-c-bg);
  --marimo-island-foreground: var(--vp-c-text-1);
  --marimo-island-surface: var(--vp-c-bg-elv);
  --marimo-island-muted-surface: var(--vp-c-bg-soft);
  --marimo-island-muted-foreground: var(--vp-c-text-2);
  --marimo-island-border: var(--vp-c-divider);
  --marimo-island-accent: var(--vp-c-brand-1);
  --marimo-island-accent-foreground: var(--vp-button-brand-text);
  --marimo-island-focus-ring: var(--vp-c-brand-2);
  --marimo-island-code-background: var(--vp-code-block-bg);
  --marimo-island-code-foreground: var(--vp-c-text-1);
  --marimo-island-margin-block: 14px;
  --marimo-island-radius: 6px;
}

.marimo-cell-error {
  border-left: 3px solid var(--vp-c-danger-1);
  padding-left: 12px;
  color: var(--vp-c-text-1);
}
</style>
