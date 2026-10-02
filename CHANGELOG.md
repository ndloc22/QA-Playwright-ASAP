# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-28

### Added
- **Record-First Unified QA Workflow (`npm run qa <KEY>`):** Complete 8-step wizard orchestrating Story fetch, AI summarization, Blocker Gate, DOM recording, Page Object generation, AI Test Matrix synthesis, and Playwright execution.
- **PrimeFaces Capture Bridge (Layer 2):** Automated recording bridge capturing detached/hidden PrimeFaces components (`p:selectOneMenu`, radio buttons, checkboxes) into semantic Playwright locators.
- **Hybrid AI Self-Healing (`scripts/ai-healer.js`):** Resilient offline and agent recovery with `tsc --noEmit` baseline verification and automatic rollback.
- **Reverse-Grounding Engine:** Automatically extracts live recorded selectors into `docs/specs/codebase/live_grounded_components.yaml` for cross-ticket knowledge reuse.
- **Full-featured Documentation:** Comprehensive guides in `README.md`, `docs/analysis/COPILOT_ANALYSIS_RECORD_FIRST.md`, and `docs/analysis/COPILOT_REVIEW_QUY_TRINH_TEST.md`.

### Changed
- Prompts `new-test.prompt.md` and `record-ticket.prompt.md` updated to strictly mandate Page Object reuse and include 3-tier fallback for validation testing.
- `npm run ticket <KEY>` alias remapped to `qa.js` for backwards compatibility.

## [1.0.0] - Initial Release
- Basic Playwright automation starter for ASAP portal.
