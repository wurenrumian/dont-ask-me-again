# Selection Floating Menu Design

## Goal

Adjust the selection floating menu so it feels attached to the current markdown tab instead of the global page, stays above the input box, and uses a narrower side-aware layout.

## Scope

This design covers:

- the selection action button and template menu mount hierarchy
- menu horizontal placement relative to the current markdown tab and selection anchor
- menu width and overflow behavior
- text alignment and truncation for menu items

This design does not cover:

- changing template actions or request logic
- redesigning the main floating input box
- changing the selection icon trigger behavior

## Current Issues

- the selection menu is mounted on `document.body`, so it is not visually scoped to the active markdown tab
- the menu is horizontally centered below the trigger, which feels awkward when the selection is near one side
- the menu is wider than needed for short template labels
- menu item text is centered, which reduces scan speed for longer labels
- long labels wrap instead of truncating, making the menu feel bulky

## Recommended Approach

Keep the existing selection action component, but change its host and positioning model:

1. Mount the selection action container under the current markdown tab host instead of `document.body`.
2. Keep the main input box and the selection action as sibling overlays within the same host.
3. Give the selection action a higher z-index than the input box so it always appears above it.
4. Size the template menu to roughly one third of the active markdown tab width, with a reasonable minimum width.
5. Position the menu to the left or right of the selection anchor based on which side of the tab the selection is closer to.
6. If the preferred side does not have enough space, snap the menu to the corresponding left or right edge of the markdown tab.
7. Render menu labels left-aligned on a single line with ellipsis truncation.

This preserves the existing component structure while making the menu feel more local to the editor surface.

## Layout Behavior

### Host and Layering

- `selectionActionEl` should be mounted into the same host container used by the floating input box
- the host should remain `position: relative`
- the selection action should use `position: absolute`
- the selection action z-index should be above the floating input box z-index

### Width

- menu width should default to one third of the active markdown tab width
- keep a minimum width around `220px`
- clamp the width so it never exceeds the tab width minus horizontal padding

### Horizontal Placement

- use the existing selection anchor coordinates as the trigger point
- compare the anchor x-position against the midpoint of the active markdown tab
- if the anchor is on the left half, prefer opening to the right of the trigger
- if the anchor is on the right half, prefer opening to the left of the trigger
- if the preferred placement overflows, snap the menu to the nearest tab edge instead

### Vertical Placement

- keep the current behavior of showing the trigger close to the text selection
- keep the menu opening below the trigger button
- no additional vertical flipping is required for this change

## Visual Treatment

- menu items should be left-aligned
- each item should stay on a single line
- overflowed text should use ellipsis
- reduce horizontal padding and overall panel width slightly compared with the current design
- preserve the existing visual language so the change feels like a refinement, not a redesign

## Implementation Notes

- add a dedicated method on the floating UI for updating selection menu width and horizontal alignment
- reuse the active markdown tab rect already computed by the plugin where possible
- avoid reading global viewport width for menu sizing once the component is hosted inside the tab
- keep the existing hover-open interaction unless implementation reveals a usability issue

## Testing Strategy

Verify manually in these cases:

- selection near the left side of a wide markdown tab
- selection near the right side of a wide markdown tab
- selection in a narrow markdown tab
- selection while the floating input box is visible
- long template labels that should truncate with ellipsis

## Risks and Mitigations

- host-relative positioning can drift if the wrong container rect is used
  use the active host rect consistently for anchor conversion
- narrow tabs may make one-third width too small
  clamp with a minimum width and edge snapping
- higher z-index could overlap more of the editor than before
  keep the menu compact and anchored close to the selection
