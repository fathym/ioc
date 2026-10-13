---
FrontmatterVersion: 1
DocumentType: Guide
Title: IoC Agents Guide
Summary: Guardrails for collaborating on the Fathym IoC container pod.
Created: 2025-11-20
Updated: 2025-11-20
Owners:
  - fathym
References:
  - Label: Project README
    Path: ./README.md
  - Label: Project Guide
    Path: ./GUIDE.md
  - Label: 'Projects: Ref-Arch README'
    Path: ../README.md
  - Label: 'Projects: Ref-Arch AGENTS'
    Path: ../AGENTS.md
  - Label: 'Projects: Ref-Arch Guide'
    Path: ../GUIDE.md
  - Label: Root README
    Path: ../../../README.md
  - Label: Root Agents Guide
    Path: ../../../AGENTS.md
  - Label: Root Workspace Guide
    Path: ../../../WORKSPACE_GUIDE.md
---

# AGENTS: IoC Container

Guardrails for humans and AI collaborating on the Fathym IoC container.

## Core Guardrails

1. **Stay scoped.** Keep IoC work under `projects/ref-arch/ioc/` unless
   coordinating with another pod; link cross-pod dependencies when they exist.
2. **Frontmatter required.** Every Markdown doc uses frontmatter and
   document-relative references back to parent guides.
3. **API stability.** Avoid breaking registration/resolution semantics without
   migration notes; document changes that affect consumers (CLI, other
   libraries, micro-frameworks).
4. **Provenance.** Capture upstream sources, release channels, and version pins
   in `UPSTREAM.md` when publishing; prefer upstream-first fixes before
   diverging.
5. **Security & hygiene.** Do not include secrets in tests or docs; keep build
   and test tasks reproducible.

## Communication

- Declare intent before editing; summarize outcomes and next steps in the
  project README or a short log.
- Link implementation branches and consumer pods (CLI, other libraries,
  micro-frameworks) when behavior changes to keep dependencies aligned.
