# NPU Study Guide

Standalone GitHub Pages project for AI accelerator and compiler study notes.

Live site: https://buicongnguyen.github.io/NPU/

Every study page uses the same book-style reader: a fixed chapter rail on
desktop, an accessible off-canvas chapter drawer on mobile, an in-page outline,
whole-book search, chapter bookmarks, previous/next chapter links, reading
position, and a persisted light/dark theme. `index.html` is the canonical
overview; `npu.html` remains a supported alias.

The guide covers NPU, VPU, LPU, GPU, and TPU accelerator tradeoffs, AI model
deployment paths, LLVM/MLIR compiler concepts, Tenstorrent notes, and related
interview practice pages.

The Analog CIM learning path adds a source-critical Mythic case study:

- Architecture: https://buicongnguyen.github.io/NPU/analog-cim-architecture.html
- Accuracy evidence and issues: https://buicongnguyen.github.io/NPU/analog-cim-evidence.html
- Hardware/software co-design solutions: https://buicongnguyen.github.io/NPU/analog-cim-hardware-software-codesign.html
- iHW patent and evidence study: https://buicongnguyen.github.io/NPU/analog-cim-ihw-patents.html
- SDK and compiler implementation guide: https://buicongnguyen.github.io/NPU/analog-cim-sdk-toolchain.html
- QEMU/co-simulation, host/device boot, UMD/KMD, firmware, PCIe, logs, and YOLO bring-up: https://buicongnguyen.github.io/NPU/analog-cim-board-bringup.html#full-chain
- Mythic and Videantis acquisition case study: https://buicongnguyen.github.io/NPU/analog-cim-mythic-videantis.html
- Tenstorrent architecture pattern study: https://buicongnguyen.github.io/NPU/analog-cim-tenstorrent-reuse.html
- TT-Metal-inspired accelerator repository, test, build, and Tracy profiling blueprint: https://buicongnguyen.github.io/NPU/accelerator-repository-blueprint.html
- Host Tracy and cycle-correlated ACiM device profiling: https://buicongnguyen.github.io/NPU/accelerator-repository-blueprint.html#profiling
- Minimal CMake/GCC/Clang/MSVC ACiM example: https://github.com/buicongnguyen/NPU/tree/main/examples/acim-minimal
- Scale-out, fault tolerance, and LLM inference: https://buicongnguyen.github.io/NPU/analog-cim-scaleout-llm.html
- Interview study: https://buicongnguyen.github.io/NPU/analog-cim-interview.html
- Interactive MCQ lab: https://buicongnguyen.github.io/NPU/analog-cim-quiz.html

Reusable learning data lives in `data/analog-cim-architecture.json`,
`data/analog-cim-evidence.json`, and `data/analog-cim-mcq.json`. The ordered
reader structure and generated search corpus live in `data/book-manifest.json`
and `data/book-search-index.json`.

The NPU platform engineering path adds two English-only references without
duplicating the existing accelerator, LLVM/MLIR, graph, C, Git, or Analog CIM
material:

- NPU and SoC software architecture: https://buicongnguyen.github.io/NPU/npu-soc-software-architecture.html
- Framework, compiler, ISA, and tooling skills: https://buicongnguyen.github.io/NPU/npu-framework-compiler-skills.html

## Validate site changes

Site validation uses Node.js 22 and a pinned npm lockfile. Install Chromium once,
then run the complete check used by the GitHub Pages deployment:

```console
npm ci
npx playwright install chromium
npm run check:ci
```

For a faster local pass that omits the dependency audit and Lighthouse, run
`npm run check`.

`npm run build:pages` stages the exact public site in `build/pages-site`.
The build excludes repository tooling and native examples, canonicalizes selected
text sources to UTF-8 with LF line endings, and gives runtime CSS, JavaScript, and
JSON files one content-derived release suffix. JSON documents also receive stable
aliases for human links so an already-open page remains useful across deployments.
Every published content file is bound to its source in `asset-manifest.json`.

The complete check covers dependency advisories, HTML structure, JSON schemas and
source references, deterministic Pages packaging, every rendered internal link
and fragment, navigation and mobile smoke tests, JSON-backed views, practice
filtering, quiz state transitions, chapter-manifest coverage, desktop and mobile
reader behavior, theme persistence, axe WCAG A/AA rules in both the closed and
open-drawer states, and Lighthouse performance, accessibility, best-practices,
and SEO budgets.
