# NPU Study Guide

Standalone GitHub Pages project for AI accelerator and compiler study notes.

Live site: https://buicongnguyen.github.io/NPU/

The guide covers NPU, VPU, LPU, GPU, and TPU accelerator tradeoffs, AI model
deployment paths, LLVM/MLIR compiler concepts, Tenstorrent notes, and related
interview practice pages.

The Analog CIM learning path adds a source-critical Mythic case study:

- Architecture: https://buicongnguyen.github.io/NPU/analog-cim-architecture.html
- Accuracy evidence and issues: https://buicongnguyen.github.io/NPU/analog-cim-evidence.html
- Hardware/software co-design solutions: https://buicongnguyen.github.io/NPU/analog-cim-hardware-software-codesign.html
- iHW patent and evidence study: https://buicongnguyen.github.io/NPU/analog-cim-ihw-patents.html
- SDK and compiler implementation guide: https://buicongnguyen.github.io/NPU/analog-cim-sdk-toolchain.html
- PCIe board, UMD/KMD, firmware, and YOLO bring-up: https://buicongnguyen.github.io/NPU/analog-cim-board-bringup.html
- Mythic and Videantis acquisition case study: https://buicongnguyen.github.io/NPU/analog-cim-mythic-videantis.html
- Tenstorrent architecture pattern study: https://buicongnguyen.github.io/NPU/analog-cim-tenstorrent-reuse.html
- TT-Metal-inspired accelerator repository, test, build, and Tracy profiling blueprint: https://buicongnguyen.github.io/NPU/accelerator-repository-blueprint.html
- Host Tracy and cycle-correlated ACiM device profiling: https://buicongnguyen.github.io/NPU/accelerator-repository-blueprint.html#profiling
- Minimal CMake/GCC/Clang/MSVC ACiM example: https://github.com/buicongnguyen/NPU/tree/main/examples/acim-minimal
- Scale-out, fault tolerance, and LLM inference: https://buicongnguyen.github.io/NPU/analog-cim-scaleout-llm.html
- Interview study: https://buicongnguyen.github.io/NPU/analog-cim-interview.html
- Interactive MCQ lab: https://buicongnguyen.github.io/NPU/analog-cim-quiz.html

Reusable learning data lives in `data/analog-cim-architecture.json`,
`data/analog-cim-evidence.json`, and `data/analog-cim-mcq.json`.

The NPU platform engineering path adds two English-only references without
duplicating the existing accelerator, LLVM/MLIR, graph, C, Git, or Analog CIM
material:

- NPU and SoC software architecture: https://buicongnguyen.github.io/NPU/npu-soc-software-architecture.html
- Framework, compiler, ISA, and tooling skills: https://buicongnguyen.github.io/NPU/npu-framework-compiler-skills.html
