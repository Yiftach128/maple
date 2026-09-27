# @maple-kit/lint

## 0.1.2

### Patch Changes

- @maple-kit/core@0.12.0

## 0.1.1

### Patch Changes

- Updated dependencies [b7a0f25]
- Updated dependencies [2bf7ed3]
- Updated dependencies [b7a0f25]
- Updated dependencies [6ac8d9b]
- Updated dependencies [b7a0f25]
  - @maple-kit/core@0.11.0

## 0.1.0

### Minor Changes

- f76c3e7: `lintRendered({ url, tokenFiles, viewports, bypassHeaders })` runs Chromium
  over a deployed preview and reports what only a laid-out page can show: colours
  and font sizes off the token set, touch targets under 24px, WCAG AA contrast
  failures, motion on properties other than `opacity` and `transform`, and motion
  that survives `prefers-reduced-motion`. Findings carry the anchor cascade's own
  `Anchor`, and `findingComment()` turns one into a `Comment` the overlay pins
  where it was found.

  Colours are read as hex in all four lengths, `rgb()`, `hsl()`, `color(srgb …)`
  and the 148 named colours; anything wider is named in a warning rather than
  silently narrowing what the run checked. A run that
  found no token of a kind reports nothing for that rule and says so, rather than
  reporting every value on the page.

### Patch Changes

- Updated dependencies [0606059]
- Updated dependencies [4493ac7]
- Updated dependencies [2271457]
- Updated dependencies [5d832df]
- Updated dependencies [4b8e7c9]
- Updated dependencies [1cb2f6f]
- Updated dependencies [a02a975]
- Updated dependencies [b66c3c0]
- Updated dependencies [eccf75c]
- Updated dependencies [decec98]
- Updated dependencies [c597ef7]
- Updated dependencies [2abe3f0]
- Updated dependencies [78f0692]
- Updated dependencies [264e019]
- Updated dependencies [9591b2d]
- Updated dependencies [4acc6db]
- Updated dependencies [2abe3f0]
- Updated dependencies [4ae5179]
  - @maple-kit/core@0.10.0
