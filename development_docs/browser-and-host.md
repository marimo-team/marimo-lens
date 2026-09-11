# Browser and host

The widget locates notebook outputs and configured DOM roots as targets owned
by one browser document. It uses the same resolved surface for selection,
availability, annotated capture, and layout observation.

Python receives validated target records. All
[Document Object Model](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model)
queries, geometry reads, portals, focus, scrolling, and rasterization remain in
the browser packages.

## Notebook output roots

`packages/widget/src/notebook/output-root-rules.ts` maps supported rendered
hosts to exact graph cell IDs.

The current rules recognize:

- Elements with IDs in the `output-<cell-id>` form.
- Elements with `data-marimo-lens-output-cell-id`.
- marimo documentation islands with their cell identity.

`output-root.ts` turns those rules into canonical output lookup and enumeration.
It also tracks the output containing a Lens host so the widget does not make its
own output selectable.

A notebook target records exactly one producing cell ID, the browser-document
identity, and the document pathname.

## Configured DOM roots

`Lens(dom_selector=...)` adds light-DOM roots that match one CSS selector. A
selector can use normal CSS grouping to identify several roots. The host
integration owns the selector and the meaning of every matched region.

A configured root:

- Must be an `HTMLElement` in the document light DOM.
- Must be visible and distinct from Lens UI or a Lens host.
- Uses a unique authored ID or a generated element-lifetime locator.
- Infers producing cells from its own and nested `data-runtime-cell-id`
  attributes.
- Reads resolved Studio projection kind and target metadata for exact value selectors.
- Resolves `data-marimo-sources` as a bounded list of unique projection host IDs
  in the same document. An explicit region owns its complete input set;
  otherwise Lens collects contained projections, treating native output subtrees
  as opaque. Missing, duplicate, unbound, or chained references are unavailable.
- Skips regions with an `aria-busy="true"` ancestor or on the region itself.
- Stores inferred IDs as a sorted unique set.

Configured roots outrank nested notebook outputs. This makes the host-authored
region the target when a larger application view contains several notebook
renderers.

The exact selector is a locator, not public host policy. Reattachment also
checks that the element still matches the configured selector and has the same
producing cell IDs.

Reattachment requires the same producing cells and symbolic selectors. A value
update stays attached; a different selector from the same cell makes the target
unavailable. The target is revalidated before captured image bytes are committed.

Each `target.sources` entry has `cellId` and `selector`. `selector: null` identifies
a cell output or generic cell-only metadata. Sources are evidence, not permission
to read or mutate the kernel. The transport preserves them in selections,
context, and History. No runtime identities or value revisions are copied from
Studio: document ownership scopes the target, and current notebook graph context
is inspected separately from the captured image.

Stable element IDs support remountable targets. Unkeyed elements receive an
element-lifetime locator, so replacing or reordering an unrelated sibling cannot
silently redirect a selection.

## Target-picking indicator

`@marimo-lens/protocol` defines `TargetInfo` (`label`, optional `detail`) and its
attribute names. The notebook adapter reads consumer text, source-host references,
and native fallbacks. The selection overlay renders a compact, non-interactive
label attached to the active target, clamped to the viewport. This presentation
exists only in the armed workflow; it creates no Python state or transport fields.

Consumers such as Studio publish the attributes. Lens's presentation has no
framework or Studio-specific knowledge. The existing layout observer refreshes
labels after metadata changes, scrolling, and resize. Keyboard navigation uses
the same label model for announcements. Selection identity is independent of
consumer display text.

## Target resolution

`selection-target.ts` combines notebook and configured target candidates. It
uses the event composed path for pointer targeting and walks across open shadow
hosts for element targeting.

One located `TargetSurface` contains:

- A validated target record.
- Its current `HTMLElement`.
- A stable serialized key for browser reconciliation.

A stored target belongs to a document only when both its opaque document ID and
pathname match. The pathname comes from `document.location.pathname`. Query and
fragment changes do not create a new stored path. Replacing the browser document
creates a new opaque ID even when the pathname remains the same.

A target can remain stored while no surface is found. The UI reports that the
target is unavailable and reattaches it when the matching surface returns.

## Documents, iframes, and shadow roots

The widget derives its document and window from the AnyWidget host element's
`ownerDocument`. It never assumes the ambient top-level `window` or `document`.

Gesture targeting observes:

- The owning document.
- Same-origin iframe documents inside active target trees.
- Open shadow roots reachable inside target trees.

The observer refreshes when relevant attributes, children, frames, or open
shadow trees change. During a selection gesture it coordinates pointer and
touch-action locks across the active surfaces.

Closed shadow roots are outside Lens inspection. Cross-origin iframe documents
remain opaque browser boundaries. While selection mode is active, an
inaccessible frame becomes a pointer boundary so its enclosing target can still
receive the gesture. The frame cannot supply DOM or raster content and can make
selection-image capture fail.

## `NotebookDomAdapter`

`NotebookDomAdapter` owns browser operations that depend on a particular
document:

- Canonical output and target lookup.
- Document and window access.
- Portal creation.
- Focus restoration.
- Viewport and nested scroll calculations.
- Layout and output-tree observation.
- Target activity and reveal positioning.
- Paint scheduling for capture.

One shared layout subscription coordinates document scroll, nested scroll,
window resize, output resize, target resize, and output-tree changes. Anchored
surfaces use that subscription for placement and viewport clamping.

Keep target discovery in `notebook/selection-target.ts`, canonical output
discovery in `notebook/output-root*.ts`, and document operations in
`notebook-dom.tsx`. A feature should not bypass these paths with an unrelated
query or ambient global.

## Browser view ownership

One Python `Lens` model can have several AnyWidget browser views. The first Lens
view registered in a document owns selection interaction, portals, global
styles, output capture, and transient presentation. Later views in that document
render a conflict surface.

The registry is stored on the owning `Document` through a global symbol. This
lets separate AnyWidget module instances coordinate. When the owner view
tears down, the next registered view becomes owner. Another document has an
independent registry and owner.

Browser readiness follows the interaction owner. The owner mounts the output
capture handler and sends ready or unready events as that handler connects or
releases. Conflict views render their ownership notice without a capture
handler. Python considers the Lens mounted in the current marimo runtime while
at least one document's interaction owner remains ready.

## Selection interaction

Selection is a one-shot workflow. The dock can arm it through its button or the
`Option/Alt+L` shortcut. Pointer input creates a point for a click and a
normalized rectangle for a drag. Keyboard input can move between target roots
and create a centered point.

The browser reducer owns temporary gesture, note-edit, list, focus, announcement,
and mutation presentation state. Revisioned selection actions own requests to
Python and reconcile the resulting synchronized state.

Escape closes the most local active interaction first. Note editing, list
presentation, and armed selection therefore release in a predictable order.

## Target attention

Activity and reveal share one `TargetAttentionController`.

- A selection address finds its trusted target from synchronized state on
  every layout change.
- A cell address targets the rendered cell when present and falls back to its
  canonical output.
- Activity keeps the current scroll position for a visible target.
- Activity frames an offscreen or near-top target and can correct the frame
  after target growth.
- An unsuccessful frame settles to a quiet dock notice.
- Reveal replaces the current presentation, scrolls once, holds for the
  supplied duration, and exits.
- Labels appear above the target at its top-right edge and have accessible
  announcement equivalents.

An owning document ignores attention for another document. A temporarily
unavailable target produces a bounded notice in its own document and can
reattach when the surface returns.

Selection-addressed events wait until synchronized state reaches their address
revision. The browser preserves event order across coalesced model updates and
can use a later state revision while the same immutable selection target remains
open. Resolution events follow the same document boundary. Each document
presents a receipt containing the resolved targets it owns.

## Rasterization and the `html-to-image` patch

`@marimo-lens/image-capture` uses
[`html-to-image@1.11.13`](https://github.com/bubkoo/html-to-image) to clone and rasterize
DOM content. The repository applies
`patches/html-to-image@1.11.13.patch` through `pnpm-workspace.yaml`.

The patch is part of the capture contract. It preserves:

- DOM constructor checks in the node's owning realm.
- Owner-document element, canvas, style, image, and serializer creation.
- Same-origin iframe body cloning exactly once.
- Relative resource resolution against each iframe document's base URL.
- Nested same-origin iframe resources.
- Open-shadow content.
- Live scroll viewport geometry.
- Hidden-document capture that cannot wait on suspended animation frames.
- Cross-realm cancellation and decode failures.

Before changing the `html-to-image` version or patch:

1. Read the upstream source for every patched module.
2. Rebase the patch against the selected exact version.
3. Run the dedicated patch tests in
   `packages/image-capture/tests/evidence/html-to-image-patch.test.ts`.
4. Run the remaining image-capture tests.
5. Rebuild the Python widget resources.
6. Capture normal output, scrolled output, same-origin iframe output, open
   shadow content, and a cross-origin failure in a real browser.
7. Run `make package` to prove the patched dependency reaches the distribution
   build.

Do not remove the patch because jsdom tests pass against one ambient document.
The owner-realm and iframe cases are the compatibility contract.

## Host adapter seams

| Capability                                | Seam                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| marimo graph and cell status              | `packages/marimo-lens/src/marimo_lens/_marimo_runtime.py`            |
| Native marimo control state               | `packages/marimo-lens/src/marimo_lens/_marimo_control_state.py`      |
| Widget-aware Python disposal              | `Lens._bind_comm_close()` in `widget.py`                             |
| AnyWidget model and messages              | `packages/widget/src/anywidget/`                                     |
| Output-root rules                         | `packages/widget/src/notebook/output-root-rules.ts`                  |
| Document operations and target navigation | `packages/widget/src/notebook/notebook-dom.tsx`                      |
| Target construction and reattachment      | `packages/widget/src/notebook/selection-target.ts`                   |
| Document and open-tree interaction        | `packages/widget/src/notebook/interaction-documents.ts`              |
| Target attention                          | `packages/widget/src/transient/target-attention.ts`                  |
| DOM rasterization                         | `packages/image-capture/src/evidence/` and the `html-to-image` patch |
| Browser-to-Python selection requests      | `packages/widget/src/anywidget/request-client.ts`                    |

Adopt a new native marimo or AnyWidget capability by replacing the narrow seam
that owns it. Preserve target identity, selection state, protocol, and public
Python behavior unless the product contract changes too.

## Browser validation

Widget and image-capture unit tests run in
[jsdom](https://github.com/jsdom/jsdom). They prove state, contracts,
and DOM algorithms, but they do not prove raster pixels, browser layout,
scrolling, responsive placement, or pointer behavior.

Use the real-browser matrix in [Testing](testing.md#real-browser-evidence) after
changing any file covered by this page.
