/**
 * ⚡ E.ON Auto-Test: Unified 1-Command All-in-One Pipeline
 * Usage:
 *   npm run auto-test KFWT-1161
 *   npm run auto-test https://jira.eon.com/browse/KFWT-1161
 *
 * 🏗️ Model-tiering architecture (token/cost optimization):
 *   [1/4] fetch-jira.js            -> 0 token (browser scraping, no AI call)
 *   [2/4] /summarize-story          -> claude-sonnet-5  (cheap extraction: reads
 *                                      ticket + image attachments + Jira comments,
 *                                      cross-references codebase OpenSpecs, and
 *                                      condenses everything into
 *                                      docs/tickets/<KEY>.summary.json)
 *   [3/4] /analyze-story + /new-test -> claude-opus-4.8 (default; deep
 *                                      analysis, conflict resolution,
 *                                      test-matrix design, and Playwright
 *                                      spec generation on the condensed
 *                                      summary.json (~30k tokens) instead of
 *                                      raw images/full YAML, so Opus's extra
 *                                      reasoning depth stays affordable).
 *                                      Override to claude-sonnet-5 via
 *                                      AUTO_TEST_ANALYSIS_MODEL=claude-sonnet-5,
 *                                      or the CLI flags `--sonnet` / `--model <name>`
 *                                      (e.g. `npm run auto-test KFWT-1161 -- --sonnet`).
 *   [4/4] Playwright execution      -> 0 token (local engine); on failure,
 *                                      self-healing diagnosis/fix runs on
 *                                      claude-sonnet-5 (/fix-failed-test),
 *                                      then the spec is re-run once to verify.
 *
 * Windows-safety notes (READ BEFORE EDITING):
 * - `.cmd`/`.bat` shims (npx.cmd, copilot.cmd) MUST NOT be spawned with
 *   `shell: false` on Windows. Node.js historically wraps these internally
 *   via cmd.exe with argument escaping that is either insecure
 *   (CVE-2024-27980) or, on patched Node versions, overly strict and throws
 *   `EINVAL` for perfectly valid arguments (e.g. long text containing quotes
 *   or newlines). The safe, deterministic fix used here is to explicitly set
 *   `shell: true` on Windows and build+quote the full command line ourselves
 *   (see `safeSpawnSync` below), so cmd.exe always receives a single,
 *   correctly-escaped string.
 * - Never pass long, multi-line prompts as a CLI argument. Long prompts are
 *   written to a temp file and Copilot is instructed (with a short argument)
 *   to open and follow that file — this sidesteps both the EINVAL issue and
 *   cmd.exe's ~8191 character command line limit.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');

// Reverse-Grounding: after a recording is used as Grounding Truth to generate a
// test, bóc tách các selector/component thực tế trong recording rồi merge NGƯỢC
// vào docs/specs/codebase/live_grounded_components.yaml (xem scripts/sync-specs.js)
// để OpenSpecs tự tích luỹ tri thức sống, ticket mới sau này tái sử dụng ngay.
const { syncKey: reverseGroundSyncKey, LIVE_SPEC_REL } = require('./sync-specs');

/**
 * Model tiering: each pipeline step is pinned to the AI model appropriate for
 * its actual reasoning depth, not the most expensive model available. This is
 * the core of the token/cost-optimization architecture (see header comment).
 * Override via env vars if a Tester wants to experiment with different tiers
 * without editing this file (e.g. temporarily downgrade/upgrade for a tricky ticket).
 */
const MODEL_SUMMARY = process.env.AUTO_TEST_SUMMARY_MODEL || 'claude-sonnet-5';
const MODEL_SELF_HEAL = process.env.AUTO_TEST_SELF_HEAL_MODEL || 'claude-sonnet-5';

/**
 * Step 3 (/analyze-story + /new-test) model resolution, in priority order:
 *   1. CLI flag: `--model <name>` (explicit) or `--sonnet` (shorthand for
 *      `--model claude-sonnet-5`), e.g. `npm run auto-test KFWT-1161 -- --sonnet`
 *      or `npm run auto-test KFWT-1161 -- --model claude-sonnet-5`.
 *   2. Env var override: AUTO_TEST_ANALYSIS_MODEL (e.g. for CI or a Tester's
 *      shell profile who always wants the cheaper/faster tier without typing
 *      a flag every time).
 *   3. Default: `claude-opus-4.8` -- deep analysis, conflict resolution,
 *      test-matrix design, and Playwright spec generation deserve Opus's
 *      extra reasoning depth; this stays affordable because Step 3 reads the
 *      condensed summary.json (~30k tokens) produced by Step 2 instead of
 *      raw images/full YAML.
 * A Tester can still opt into `claude-sonnet-5` any time the cheaper/faster
 * tier is preferred for a straightforward ticket, via either mechanism above.
 */
function resolveAnalysisModelFromArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sonnet') {
      return 'claude-sonnet-5';
    }
    if (arg === '--model' && argv[i + 1]) {
      return argv[i + 1];
    }
    if (arg.startsWith('--model=')) {
      return arg.slice('--model='.length);
    }
  }
  return null;
}

const MODEL_ANALYSIS =
  resolveAnalysisModelFromArgs(process.argv.slice(2)) ||
  process.env.AUTO_TEST_ANALYSIS_MODEL ||
  'claude-opus-4.8';

/**
 * Quote a single argument for cmd.exe when it is embedded in a full command
 * line string (used only when shell: true on Windows). Wraps the value in
 * double quotes if it contains anything cmd.exe would otherwise split on,
 * and escapes embedded double quotes so they can't break out of the quoting.
 */
function quoteForCmd(value) {
  const str = String(value);
  if (str === '') return '""';
  if (!/[\s"&|<>^%!]/.test(str)) return str;
  const escaped = str.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Cross-platform safe wrapper around spawnSync.
 * - On Windows: forces shell:true and manually builds/quotes the command
 *   line to avoid Node's buggy internal .cmd/.bat handling (EINVAL / CVE-2024-27980).
 * - On other platforms: uses shell:false (default, safe) with the args array.
 */
function safeSpawnSync(command, args, options = {}) {
  if (IS_WINDOWS) {
    const commandLine = [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ');
    return spawnSync(commandLine, { ...options, shell: true });
  }
  return spawnSync(command, args, { ...options, shell: false });
}

/**
 * Resolve the correct Windows executable name for a CLI tool without
 * hardcoding a specific shim extension (`.cmd`, `.exe`, `.bat`, ...).
 *
 * Different install methods produce different shims for the same CLI name:
 *   - npm-installed CLIs on Windows usually ship a `<name>.cmd` shim.
 *   - Some tools (e.g. GitHub Copilot CLI) install a native `<name>.exe`.
 * Hardcoding `.cmd` breaks the `.exe` case with "not recognized as an
 * internal or external command" even though the binary exists on PATH.
 *
 * Strategy: scan PATH for the first existing `<name><ext>` following the
 * user's PATHEXT order (falls back to a sane default). If nothing is found
 * (e.g. running in an unusual shell), fall back to the bare command name --
 * cmd.exe (which we always invoke via `shell:true` in safeSpawnSync) will
 * then resolve it itself using PATHEXT, exactly like typing it interactively.
 */
function resolveWindowsBinary(command) {
  if (!IS_WINDOWS) return command;

  const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean);
  const pathDirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);

  for (const dir of pathDirs) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) {
        return `${command}${ext}`;
      }
    }
  }

  // Not found on PATH via our own scan -- let cmd.exe resolve the bare name
  // itself via PATHEXT, same as a user typing `copilot` at the prompt.
  return command;
}

function printHeader(title) {
  console.log(`\n======================================================`);
  console.log(title);
  console.log(`======================================================\n`);
}

function fail(message, code = 1) {
  console.error(`\n\x1b[31m❌ ${message}\x1b[0m\n`);
  process.exit(code);
}

/**
 * Invoke the Copilot CLI non-interactively with a given prompt and a pinned
 * model tier (see MODEL_* constants above). The prompt is always written to a
 * temp file first (never passed as a raw CLI argument) to sidestep both the
 * Node.js .cmd/.bat EINVAL issue and cmd.exe's ~8191 character command line
 * limit -- consistent with the Windows-safety notes in the header comment.
 * Returns { error, status, output } and never throws; the temp file is always
 * cleaned up before returning.
 */
function runCopilotPrompt(promptText, { model, tmpFileSuffix }) {
  const tmpPromptPath = path.join(ROOT_DIR, `.tmp-copilot-prompt-${tmpFileSuffix}.txt`);
  fs.writeFileSync(tmpPromptPath, promptText, 'utf-8');

  const shortInstruction =
    `Read the file ${path.relative(ROOT_DIR, tmpPromptPath).replace(/\\/g, '/')} in the current working directory ` +
    `and carry out ALL instructions written in it exactly, then generate/update the files it specifies.`;

  console.log(`   🧠 Model: ${model}`);
  console.log(`   📄 Full prompt written to: ${path.relative(ROOT_DIR, tmpPromptPath)}`);

  const copilotBin = resolveWindowsBinary('copilot');
  // NOTE: stdout/stderr are captured (not 'inherit') so callers can inspect
  // Copilot's response afterwards (e.g. to distinguish an intentional SOP
  // "Blocker" stop from a real technical failure). The captured output is
  // echoed to the console right after the process exits, so the Tester still
  // sees everything Copilot said -- just not streamed live, character by character.
  const copilotResult = safeSpawnSync(copilotBin, ['-p', shortInstruction, '--model', model, '--allow-all'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: ROOT_DIR,
    encoding: 'utf-8'
  });

  const copilotStdout = copilotResult.stdout || '';
  const copilotStderr = copilotResult.stderr || '';
  if (copilotStdout) process.stdout.write(copilotStdout);
  if (copilotStderr) process.stderr.write(copilotStderr);

  // Clean up the temp prompt file regardless of outcome (also protected by .gitignore).
  fs.rmSync(tmpPromptPath, { force: true });

  return {
    error: copilotResult.error,
    status: copilotResult.status,
    output: `${copilotStdout}\n${copilotStderr}`
  };
}

/**
 * Patterns that indicate the story was intentionally stopped per the
 * project's mandatory "Blocker & Open Questions" SOP (see README.md,
 * section 11) rather than a real technical failure to produce a spec file.
 * Matched case-insensitively against both the ticket markdown (which should
 * contain the "## 🔴 Open Questions & Blockers" section written by Copilot)
 * and Copilot's own stdout/stderr for this run.
 */
const BLOCKER_MARKERS = [
  /open questions?\s*&\s*blockers/i,
  /blocker/i,
  /st[oó]ry\s*b[iị]\s*ch[aặ]n/i,
  /b[aả]ng\s*c[aâ]u\s*h[oỏ]i/i,
  /clear gate/i,
];

function textLooksLikeBlocker(text) {
  if (!text) return false;
  return BLOCKER_MARKERS.some((re) => re.test(text));
}

/**
 * Detect whether Step 2 stopped because the story is legitimately Blocked
 * (per the mandatory Blocker & Open Questions SOP), as opposed to a real
 * technical failure that happened to also leave the spec file missing.
 *
 * Checks, in order:
 *   1. docs/tickets/<KEY>.md for the "## 🔴 Open Questions & Blockers"
 *      section (or equivalent blocker/clear-gate markers) written by Copilot
 *      while following .github/prompts/analyze-story.prompt.md.
 *   2. Copilot's captured stdout/stderr for this run for the same markers
 *      (covers the case where Copilot reported the blocker in its response
 *      but, for any reason, did not persist it to the ticket file yet).
 */
function detectBlocker(key, copilotOutput) {
  const ticketMdPath = path.join(ROOT_DIR, 'docs', 'tickets', `${key}.md`);
  if (fs.existsSync(ticketMdPath)) {
    try {
      const ticketContent = fs.readFileSync(ticketMdPath, 'utf-8');
      if (textLooksLikeBlocker(ticketContent)) {
        return true;
      }
    } catch (_err) {
      // If we can't read the ticket file for some reason, fall through to
      // checking Copilot's output instead of crashing the pipeline here.
    }
  }
  return textLooksLikeBlocker(copilotOutput);
}

/**
 * `target` (ticket key/URL) and boolean flags (`--sonnet`, `--ground`,
 * `--regenerate`, ...) can appear in any order/position on the CLI, e.g.
 * both `npm run auto-test KFWT-1161 -- --ground` and
 * `npm run auto-test -- --ground KFWT-1161` must work. We scan the whole
 * argv for the first token that looks like a ticket key/URL, and treat every
 * `--flag`-shaped token as a flag regardless of position.
 */
const rawArgs = process.argv.slice(2);
const target = rawArgs.find((arg) => !arg.startsWith('--') && /[A-Z0-9]+-\d+/i.test(arg));
if (!target) {
  console.log('\n\x1b[33m⚡ Usage: npm run auto-test <TICKET_KEY_OR_URL> [-- --sonnet | --model <name> | --ground | --regenerate]\x1b[0m');
  console.log('   Example: npm run auto-test KFWT-1161');
  console.log('            npm run auto-test https://jira.eon.com/browse/KFWT-1161');
  console.log('            npm run auto-test KFWT-1161 -- --sonnet               (Step 3 on claude-sonnet-5)');
  console.log('            npm run auto-test KFWT-1161 -- --model claude-sonnet-5');
  console.log('            npm run auto-test KFWT-1161 -- --ground              (require tests/recordings/<KEY>.recording.ts as Grounding Truth)');
  console.log('            npm run auto-test KFWT-1161 -- --create-subtask       (also create a Jira "Test in DEV <KEY>" sub-task, 0 token)');
  console.log('            npm run regenerate KFWT-1161                         (re-run Step 3+4 only, auto-references the recording if present)\n');
  process.exit(1);
}

const match = target.match(/([A-Z0-9]+-\d+)/i);
if (!match) {
  fail(`Could not parse a Jira ticket key (e.g. KFWT-1161) from "${target}".`);
}
const key = match[1].toUpperCase();

/**
 * `--ground`: makes the presence of tests/recordings/<KEY>.recording.ts
 * MANDATORY (fails fast with actionable guidance if it's missing) instead of
 * the default best-effort auto-detection (used silently when present, no-op
 * when absent). Use this when the Tester explicitly recorded a codegen
 * session and wants a hard guarantee that generation is grounded in it.
 */
const GROUND_REQUIRED = rawArgs.includes('--ground');

/**
 * `--regenerate`: skips Step 1 (fetch-jira) and Step 2 (summarize-story) --
 * assumes docs/tickets/<KEY>.md (and, if present, its .summary.json) already
 * exist from a previous run -- and jumps straight to Step 3 (generate
 * Page Object + Test Spec) + Step 4 (Playwright run). This is exactly the
 * "regenerate" motion a Tester performs after using `npm run record:ticket
 * <KEY>` to capture a real codegen session: fetch/summarize already
 * happened once, only the grounded generation needs to be redone.
 */
const REGENERATE_ONLY = rawArgs.includes('--regenerate');

/**
 * `--create-subtask`: sau khi Step 1 (fetch-jira) xác nhận session Jira còn
 * hợp lệ, tạo luôn một Jira Test Sub-task ("Test in DEV <KEY>", assign to me)
 * cho story hiện tại BẰNG Playwright thuần qua REST API (0 token AI, xem
 * scripts/create-subtask.js). Idempotent: nếu subtask đã tồn tại thì bỏ qua.
 * Không chặn pipeline nếu bước này lỗi (chỉ cảnh báo), để luồng sinh test
 * hiện có không bị gián đoạn.
 */
const CREATE_SUBTASK = rawArgs.includes('--create-subtask');

const RECORDING_REL_PATH = `tests/recordings/${key}.recording.ts`;
const RECORDING_FULL_PATH = path.join(ROOT_DIR, 'tests', 'recordings', `${key}.recording.ts`);

printHeader(`🚀 STARTING ${REGENERATE_ONLY ? 'REGENERATE (Step 3+4 only)' : 'ALL-IN-ONE AUTOMATION'} PIPELINE FOR \x1b[36m${key}\x1b[0m`);

// ── STEP 1: FETCH JIRA TICKET + ATTACHMENTS (0 token) ─────────────
function fetchJira() {
  console.log(`\x1b[1m[1/4] 📥 Ingesting Jira ticket & downloading media...\x1b[0m`);
  const fetchScript = path.join(__dirname, 'fetch-jira.js');
  const nodeBin = process.execPath;

  // Plain node.js binary is never a .cmd/.bat shim, so shell:false is safe here.
  const fetchResult = spawnSync(nodeBin, [fetchScript, target], {
    stdio: 'inherit',
    shell: false,
    cwd: ROOT_DIR
  });

  if (fetchResult.error) {
    fail(`Step 1 (Fetch Jira) could not be started: ${fetchResult.error.message}`);
  }
  if (fetchResult.status !== 0) {
    fail(
      `Step 1 (Fetch Jira) failed with exit code ${fetchResult.status}.\n` +
      `   -> Check your Jira SSO session (.auth/jira-profile) and ticket key "${key}", then retry.\n` +
      `   -> Pipeline stopped: Steps 2-4 were NOT executed.`
    );
  }

  const ticketMdPath = path.join(ROOT_DIR, 'docs', 'tickets', `${key}.md`);
  if (!fs.existsSync(ticketMdPath)) {
    fail(
      `Step 1 (Fetch Jira) reported success but ${path.relative(ROOT_DIR, ticketMdPath)} was not found.\n` +
      `   -> Pipeline stopped: Steps 2-4 were NOT executed.`
    );
  }
  return ticketMdPath;
}

// ── OPTIONAL: CREATE JIRA TEST SUB-TASK (0 token, pure Playwright REST) ──
// Chạy scripts/create-subtask.js trong tiến trình con. Không bao giờ làm
// pipeline dừng lại: mọi lỗi chỉ cảnh báo, vì tạo subtask là việc phụ trợ,
// không thuộc luồng sinh/kiểm thử test chính.
function createSubtask() {
  console.log(`\x1b[1m🧩 Creating Jira test sub-task (0 token) for ${key}...\x1b[0m`);
  const script = path.join(__dirname, 'create-subtask.js');
  const nodeBin = process.execPath;
  const args = [script, target];
  // Trong pipeline auto-test, session SSO đã được Step 1 xác thực => chạy headless.
  if (!rawArgs.includes('--headed')) {
    args.push('--headless');
  }
  const result = spawnSync(nodeBin, args, { stdio: 'inherit', shell: false, cwd: ROOT_DIR });
  if (result.error) {
    console.warn(`\x1b[33m⚠️  Sub-task creation could not be started: ${result.error.message} (bỏ qua, không chặn pipeline)\x1b[0m`);
  } else if (result.status !== 0) {
    console.warn(`\x1b[33m⚠️  Sub-task creation exited with code ${result.status} (bỏ qua, không chặn pipeline)\x1b[0m`);
  }
}

// ── STEP 2: SUMMARIZE STORY CONTENT (cheap model tier, claude-sonnet-5) ───
// Reads the ticket + image attachments + Jira comments + codebase OpenSpecs
// and condenses everything into docs/tickets/<KEY>.summary.json, so Step 3
// doesn't need to re-load the raw, token-heavy sources. This step is
// intentionally non-fatal: /analyze-story has its own fallback path that
// re-reads raw sources if the summary is missing, so a failure here degrades
// gracefully instead of blocking the
// whole pipeline.
function summarizeStory() {
  console.log(`\n\x1b[1m[2/4] 🧾 Summarizing ticket content (images, comments, codebase grounding)...\x1b[0m`);

  const relSummaryPath = `docs/tickets/${key}.summary.json`;
  const fullSummaryPath = path.join(ROOT_DIR, 'docs', 'tickets', `${key}.summary.json`);

  const prompt = `You are executing the "summarize" step of the model-tiered automated test pipeline for ticket ${key}.

Source ticket: docs/tickets/${key}.md
Associated media: docs/tickets/${key}/attachments/ and docs/tickets/${key}/screenshots/ (if any)
Grounding sources (priority order): docs/specs/codebase/live_grounded_components.yaml (reverse-grounded live selectors, HIGHEST priority when present), then docs/specs/codebase/ui_components.yaml and docs/specs/codebase/state_machine.yaml

Instructions:
1. Follow .github/prompts/summarize-story.prompt.md exactly.
2. Write the condensed, structured summary to exactly: ${relSummaryPath}
3. Do NOT classify Blocker/Warning and do NOT generate any testcase/.spec.ts file in this step --
   that reasoning-heavy work happens in the next pipeline step, on a different (more capable) model.

Generate or update this file now.`;

  console.log(`⏳ Extracting & condensing ticket content to cut input tokens for the next step...`);

  const result = runCopilotPrompt(prompt, { model: MODEL_SUMMARY, tmpFileSuffix: `summarize-${key}` });

  if (result.error) {
    console.warn(`\x1b[33m⚠️  Step 2 (Summarize) could not be started: ${result.error.message}\x1b[0m`);
    console.warn(`   -> Continuing without a pre-computed summary; Step 3 will fall back to reading raw ticket content itself.`);
    return null;
  }
  if (result.status !== 0 || !fs.existsSync(fullSummaryPath)) {
    console.warn(`\x1b[33m⚠️  Step 2 (Summarize) did not produce ${relSummaryPath} (exit code ${result.status}).\x1b[0m`);
    console.warn(`   -> Continuing without a pre-computed summary; Step 3 will fall back to reading raw ticket content itself (costs more tokens, but the pipeline still works).`);
    return null;
  }

  console.log(`\x1b[32m✅ Step 2 completed: ${relSummaryPath} generated.\x1b[0m`);
  return relSummaryPath;
}

// ── STEP 3: INVOKE COPILOT TO ANALYZE & GENERATE TESTCASE + SPEC ──
// Default model claude-opus-4.8 (deep reasoning for conflict resolution +
// test-matrix design + Playwright spec generation). Reads
// docs/tickets/<KEY>.summary.json (produced by Step 2, ~30k tokens) instead
// of raw images/full YAML wherever possible, keeping Opus's cost in check.
// Use `--sonnet` / `--model <name>` or AUTO_TEST_ANALYSIS_MODEL to switch to
// claude-sonnet-5 for simpler tickets.
// ── AUTO-REFERENCE GROUNDING: Playwright codegen recording (npm run record:ticket) ──
// If the Tester already captured a real codegen session for this ticket
// (tests/recordings/<KEY>.recording.ts, produced by `npm run record:ticket
// <KEY>` -- see scripts/record-ticket.js), that file is 100% real DOM/
// selector truth from BASE_URL with the logged-in session preloaded. Detect
// it here and, when present, feed it into Step 3's prompt as the HIGHEST
// -priority grounding source (above ui_components.yaml/state_machine.yaml,
// which are static code extractions and can drift from the live app). This
// removes the manual "copy-paste codegen output into chat" step the Tester
// used to have to do before regenerating.
/**
 * Detect whether a recording actually contains recorded user interactions.
 * Playwright codegen ALWAYS emits an initial page.goto(...) to the start URL,
 * so a session the Tester closed immediately -- without clicking/filling
 * anything -- still produces a file on disk, but it is NOT proof the feature
 * is live and reachable. Treating such an empty recording as Grounding Truth
 * would be a dangerous false-negative for the test.fixme() logic: it would
 * instruct Copilot to strip the "Feature not yet deployed" guard off tests
 * for a feature that nobody actually exercised. We therefore require at least
 * one real interaction/locator call, not just navigation, before trusting it.
 */
function recordingHasRealInteractions(content) {
  if (!content) return false;
  const INTERACTION_RE =
    /\.(click|fill|press|check|uncheck|selectOption|setInputFiles|type|dblclick|tap|hover|dragTo|focus)\s*\(|getBy(Role|Label|Placeholder|Text|TestId|Title|AltText)\s*\(/;
  return INTERACTION_RE.test(content);
}

/**
 * Read tests/recordings/<KEY>.recording.ts and classify it without logging or
 * exiting, so it can be reused by BOTH the early `--ground` gate (before any
 * AI credits are spent in Steps 1-2) and Step 3's grounding load:
 *   { status: 'missing' }                                -- file does not exist
 *   { status: 'empty' }                                  -- exists but no real interactions
 *   { status: 'ok', relPath, content, truncated }        -- usable grounding truth
 */
function readRecording() {
  if (!fs.existsSync(RECORDING_FULL_PATH)) {
    return { status: 'missing' };
  }
  const raw = fs.readFileSync(RECORDING_FULL_PATH, 'utf-8');
  if (!recordingHasRealInteractions(raw)) {
    return { status: 'empty' };
  }
  // Cap the amount of recording source embedded in the prompt so an
  // accidentally huge/repeated codegen session doesn't blow up token usage;
  // this is a raw <script> dump, not prose, so a generous character cap is
  // fine -- Copilot only needs the selectors/flow shape, not every byte.
  const MAX_RECORDING_CHARS = 40000;
  const truncated = raw.length > MAX_RECORDING_CHARS;
  const content = truncated ? raw.slice(0, MAX_RECORDING_CHARS) : raw;
  return { status: 'ok', relPath: RECORDING_REL_PATH, content, truncated };
}

function loadRecordingGroundingTruth() {
  const rec = readRecording();
  if (rec.status === 'missing') {
    if (GROUND_REQUIRED) {
      fail(
        `--ground was specified but ${RECORDING_REL_PATH} does not exist.\n` +
        `   -> Record the real flow first: npm run record:ticket ${key}\n` +
        `   -> Then re-run: npm run auto-test ${key} -- --ground   (or) npm run regenerate ${key}`
      );
    }
    return null;
  }
  if (rec.status === 'empty') {
    console.warn(`\x1b[33m⚠️  ${RECORDING_REL_PATH} exists but has no recorded interactions (only the initial navigation).\x1b[0m`);
    console.warn(`   -> It will NOT be used as Grounding Truth and will NOT remove any test.fixme() guard.`);
    console.warn(`   -> Re-record and perform at least one real action: npm run record:ticket ${key}`);
    if (GROUND_REQUIRED) {
      fail(
        `--ground requires a NON-EMPTY recording, but ${RECORDING_REL_PATH} contains no interactions.\n` +
        `   -> Re-record the real flow (click/fill at least one element): npm run record:ticket ${key}`
      );
    }
    return null;
  }
  console.log(`\x1b[32m🎯 Grounding Truth detected: ${RECORDING_REL_PATH} -- auto-referencing recorded selectors/flow.\x1b[0m`);
  return { relPath: rec.relPath, content: rec.content, truncated: rec.truncated };
}

/**
 * REVERSE-GROUNDING (recording -> OpenSpecs): sau khi recording được dùng làm
 * Grounding Truth để sinh test, bóc tách các selector/component thực tế trong nó
 * rồi merge ngược vào docs/specs/codebase/live_grounded_components.yaml
 * (scripts/sync-specs.js, đánh dấu origin: live_recording_<KEY>). Chỉ chạy khi
 * recording tồn tại & có thao tác thật -- nếu không thì im lặng bỏ qua (best-effort,
 * KHÔNG bao giờ làm hỏng pipeline chính).
 */
function reverseGroundFromRecording() {
  const rec = readRecording();
  if (rec.status !== 'ok') return;
  console.log(`\n\x1b[1m🔁 Reverse-Grounding: syncing recorded selectors back into OpenSpecs...\x1b[0m`);
  try {
    const result = reverseGroundSyncKey(key);
    if (result.status === 'ok') {
      console.log(
        `\x1b[32m✅ Merged ${result.componentCount} live component(s) from ${result.recordingRel} -> ${LIVE_SPEC_REL}\x1b[0m`
      );
      console.log(
        `   (origin: live_recording_${key} -- ticket mới sau này sẽ tự tái sử dụng qua index.yaml/new-test.prompt.md)`
      );
    } else {
      console.warn(`\x1b[33m⚠️  Reverse-Grounding skipped (${result.status}).\x1b[0m`);
    }
  } catch (err) {
    console.warn(`\x1b[33m⚠️  Reverse-Grounding failed (non-fatal): ${err.message}\x1b[0m`);
  }
}

function generateTest(summaryRelPath) {
  console.log(`\n\x1b[1m[3/4] 🤖 Calling GitHub Copilot to analyze story & generate test spec (100% English)...\x1b[0m`);

  const relSpecPath = `tests/e2e/TC-${key}.spec.ts`;
  const fullSpecPath = path.join(ROOT_DIR, 'tests', 'e2e', `TC-${key}.spec.ts`);

  const recording = loadRecordingGroundingTruth();
  const groundingBlock = recording
    ? `\n\n### 🎯 GROUNDING TRUTH -- Real Playwright codegen recording (${recording.relPath})\n` +
      `The Tester recorded a real browser session against BASE_URL with the logged-in session preloaded ` +
      `(via \`npm run record:ticket ${key}\`, see scripts/record-ticket.js). This is REAL DOM/selector ` +
      `truth captured directly from the live app -- treat it as HIGHER priority than ` +
      `docs/specs/codebase/ui_components.yaml/state_machine.yaml (those are static extractions and can drift; ` +
      `this recording cannot lie about what actually rendered). Use its selectors/flow verbatim (only tidy ` +
      `them for stability, e.g. prefer the same element via getByRole/getByLabel if codegen emitted a ` +
      `brittle CSS/XPath for the identical element) when building the Page Object and test spec.\n\n` +
      '```ts\n' + recording.content + (recording.truncated ? '\n// ... (recording truncated for prompt size, see full file on disk) ...\n' : '') + '\n```\n'
    : '';

  const fullPrompt = `You are executing the automated end-to-end test generation for ticket ${key}.

Source ticket: docs/tickets/${key}.md
${summaryRelPath
    ? `Condensed summary (PREFER THIS over raw sources below to save tokens): ${summaryRelPath}\n` +
      `Raw sources (fallback only, use them ONLY if the summary is missing a detail you actually need):`
    : `Condensed summary: not available for this run -- read the raw sources below directly:`}
Associated media: docs/tickets/${key}/attachments/ (if any)
Grounding sources (priority order): docs/specs/codebase/live_grounded_components.yaml (reverse-grounded live selectors from prior recordings, HIGHEST priority when present), then docs/specs/codebase/ui_components.yaml and docs/specs/codebase/state_machine.yaml${groundingBlock}
Business specs: docs/specs/process.yaml and docs/specs/roles.yaml

Instructions:
1. Follow .github/prompts/analyze-story.prompt.md to check for conflicts${summaryRelPath ? `, reading ${summaryRelPath} as the primary data source` : ' (no pre-computed summary available -- run its full fallback Multimodal Inspection + Grounding steps)'}.
2. Follow .github/prompts/new-test.prompt.md to generate:
   - tests/testcases/TC-${key}.md (100% English Given/When/Then, keeping German UI labels)
   - tests/pages/<Feature>Page.ts (Page Object if new components are needed)
   - tests/e2e/TC-${key}.spec.ts (Playwright test spec)
3. Language requirement: ALL generated files, titles, test.step() descriptions, and comments MUST be
   written in 100% professional English. Keep original German domain/UI labels from Axon Ivy/KFWT
   verbatim where the real application displays them in German (e.g. "Quelle-Senke-Test") -- do NOT
   translate German UI labels into English, only the surrounding English prose/comments.
4. Modular Test Cases (MANDATORY): DO NOT collapse the whole story into a single testcase, and DO NOT
   force-fit the story into any fixed template from a previous ticket. Instead, act as a senior QA
   Automation Engineer analyzing this ticket independently:
   a. Read the Description, ALL Acceptance Criteria, any diagram/mockup, and resolved Jira Comments.
   b. Identify the independent business aspects actually present in THIS ticket (e.g. happy path,
      negative/validation, UI default state, edge/boundary data, permission/role-based behavior,
      state transition, error handling, admin configuration/skip, calculation/business-rule
      correctness, REST/API status-code and payload behavior -- this list is illustrative only, not
      exhaustive or mandatory; use whatever aspects the ticket actually contains, and skip any that
      don't apply).
   c. Create exactly one sub test case per independent aspect found, numbered TC-${key}-01,
      TC-${key}-02, TC-${key}-03, ... The count is flexible (2, 3, 5, 7, ...) based on the real
      complexity of the ticket -- do not pad to reach a minimum, and do not omit an aspect the
      ticket genuinely requires. Name each TC to reflect the actual business behavior under test.
   In tests/testcases/TC-${key}.md, give each TC-${key}-0X its own Given/When/Then and its own
   Expected Result section -- do not merge steps from different sub test cases into one shared table.
   In tests/e2e/TC-${key}.spec.ts, generate one independent test('TC-${key}-0X: ...', async ({ page })
   => { ... }) block per sub test case, all inside a single test.describe() for the file.
5. Feature-not-deployed safeguard: if the feature/UI described in the ticket is not actually present
   on BASE_URL (grounding sources / live app do not show it yet), DO NOT generate tests that will
   fail red. Instead add a guard at the very top of EVERY individual test('TC-${key}-0X: ...', ...)
   body that calls test.fixme(true, 'Feature not yet deployed on test server'), so the pipeline
   reports a neutral "fixme" status instead of a false failure. Apply this guard per test block, not
   just once for the file.${recording
     ? `\n   EXCEPTION -- Grounding Truth recording present: ${recording.relPath} above proves the feature IS live and\n   reachable on BASE_URL (a Tester just interacted with it end-to-end). Therefore DO NOT add\n   test.fixme(...) to any test block generated from flows covered by that recording. If\n   ${relSpecPath} already exists from a previous run and still contains test.fixme(...) calls for\n   flows now covered by the recording, REMOVE those test.fixme(...) lines (and their preceding\n   "// Skipped: ..." comment) as part of this regeneration -- the recording is proof the guard is\n   no longer needed. Only keep test.fixme(...) for sub test cases whose flow is genuinely NOT\n   covered by the recording and still cannot be confirmed live on BASE_URL.`
     : ''}
6. Output path is exactly: ${relSpecPath}

Generate or update these files now.`;

  console.log(`⏳ Copilot AI is analyzing${summaryRelPath ? ' the condensed summary' : ' attachments/codebase OpenSpecs directly'} and generating Playwright test...`);

  const result = runCopilotPrompt(fullPrompt, { model: MODEL_ANALYSIS, tmpFileSuffix: `generate-${key}` });
  const { error: copilotError, status: copilotStatus, output: copilotOutput } = result;

  if (copilotError) {
    fail(
      `Step 3 (Copilot generate) could not be started: ${copilotError.message}\n` +
      `   -> Make sure "copilot" CLI is installed and on PATH.\n` +
      `   -> Pipeline stopped: Step 4/4 was NOT executed.`
    );
  }
  if (copilotStatus !== 0) {
    fail(
      `Step 3 (Copilot generate) failed with exit code ${copilotStatus}.\n` +
      `   -> Pipeline stopped: Step 4/4 was NOT executed to avoid a confusing test run against a missing/incomplete spec.`
    );
  }
  if (!fs.existsSync(fullSpecPath)) {
    // Before treating this as a technical error, check whether the story was
    // intentionally stopped per the mandatory Blocker & Open Questions SOP
    // (README.md, section 11 - Giai đoạn 1). In that case NOT creating the
    // spec file is the CORRECT, expected behavior, not a pipeline bug.
    if (detectBlocker(key, copilotOutput)) {
      printHeader(`🔴 STORY BỊ CHẶN DO CÓ OPEN QUESTIONS / BLOCKER — \x1b[36m${key}\x1b[0m`);
      console.log(`\x1b[33m🔴 STORY BỊ CHẶN DO CÓ OPEN QUESTIONS / BLOCKER.\x1b[0m`);
      console.log(`\x1b[33mPipeline dừng lại đúng quy trình (xem README.md mục 11 - Giai đoạn 1).\x1b[0m`);
      console.log(`\x1b[33mVui lòng gửi Bảng Câu Hỏi cho PO/BA để làm rõ trước khi sinh test.\x1b[0m`);
      console.log(`\n📄 Xem chi tiết Bảng Câu Hỏi tại: docs/tickets/${key}.md (mục "## 🔴 Open Questions & Blockers").`);
      console.log(`\n➡️  Sau khi PO/BA phản hồi (Giai đoạn 2):`);
      console.log(`   1. Nếu PO sửa Jira      -> npm run fetch-jira ${key}`);
      console.log(`      Nếu PO chốt qua chat -> ghi nhận vào docs/tickets/${key}.md`);
      console.log(`   2. Chạy lại /analyze-story để Clear Gate.`);
      console.log(`   3. Chạy /new-test để sinh testcase + spec.`);
      console.log(`   4. Chạy lại: npm run auto-test ${key}`);
      console.log(`\n\x1b[33m⛔ Đây KHÔNG phải lỗi kỹ thuật -- Pipeline dừng chủ động để bảo vệ chất lượng test.\x1b[0m`);
      console.log(`======================================================\n`);
      // Distinct exit code (2) so this can be told apart from a real crash/error
      // (exit code 1) in CI or by any wrapping script/dashboard.
      process.exit(2);
    }
    fail(
      `Step 3 (Copilot generate) exited successfully but expected spec file was not created:\n` +
      `   ${relSpecPath}\n` +
      `   -> Pipeline stopped: Step 4/4 was NOT executed.`
    );
  }

  console.log(`\x1b[32m✅ Step 3 completed: ${relSpecPath} generated.\x1b[0m`);
  return { relSpecPath, fullSpecPath };
}

// ── STEP 4: RUN PLAYWRIGHT TESTS (local engine, 0 token) ──────────
function runPlaywright(relSpecPath, label = '[4/4] 🧪 Running Playwright test verification...') {
  console.log(`\n\x1b[1m${label}\x1b[0m\n`);

  // Playwright's test matcher expects forward-slash paths regardless of OS.
  const normalizedSpecPath = relSpecPath.split(path.sep).join('/');

  const npxBin = resolveWindowsBinary('npx');
  const testResult = safeSpawnSync(npxBin, ['playwright', 'test', normalizedSpecPath], {
    stdio: 'inherit',
    cwd: ROOT_DIR
  });

  if (testResult.error) {
    fail(`Step 4 (Playwright run) could not be started: ${testResult.error.message}`);
  }

  return testResult.status === 0;
}

// ── STEP 5 (CONDITIONAL, only runs when Step 4 fails): SELF-HEALING ──
// Cheap model tier (claude-sonnet-5): diagnose the failure via
// /fix-failed-test (Baseline Gate + Anti-Drift Guardrail), patch the spec/
// Page Object if it's an authoring/technical issue, or file a Bug Report if
// it's a genuine web bug. Non-fatal on its own failure -- the pipeline simply
// reports the original FAILED result if self-healing can't run or can't fix it.
function selfHealAndRetry(relSpecPath) {
  console.log(`\n\x1b[1m🩺 Self-healing: diagnosing failed test (/fix-failed-test)...\x1b[0m`);

  const normalizedSpecPath = relSpecPath.split(path.sep).join('/');

  const prompt = `The Playwright test ${normalizedSpecPath} just FAILED on its run for ticket ${key}.

Instructions:
1. Follow .github/prompts/fix-failed-test.prompt.md exactly.
2. Inspect the Playwright HTML report (playwright-report/) and test-results/ artifacts (trace,
   screenshot, error context) from the run that just failed to diagnose the root cause.
3. Apply the Baseline Gate from that prompt to decide whether this looks like an authoring/technical
   issue (selector/timing/precondition/wrong assertion) vs a genuine web bug. Do NOT weaken or remove
   assertions just to force a pass.
4. If it is an authoring/technical issue: fix ${normalizedSpecPath} directly (and the related Page
   Object under tests/pages/ if needed), keeping the original Expected Result intent unchanged.
5. If you conclude with high confidence it is a genuine web/application bug (not an authoring issue):
   do NOT modify any assertion -- leave the spec exactly as-is, and append a
   "## 🐞 Bug Report (auto-detected by self-healing)" section to docs/tickets/${key}.md using the Bug
   Report Form (Title, Repro steps, Actual, Expected, Severity) from the prompt.

Only touch: ${normalizedSpecPath}, related Page Object files under tests/pages/, and (only for a
genuine bug) docs/tickets/${key}.md. Do not touch any other file.`;

  const result = runCopilotPrompt(prompt, { model: MODEL_SELF_HEAL, tmpFileSuffix: `fix-${key}` });

  if (result.error || result.status !== 0) {
    console.warn(`\x1b[33m⚠️  Self-healing step could not complete (exit code ${result.status}).\x1b[0m`);
    console.warn(`   -> Reporting the original test result as-is; please diagnose manually with /fix-failed-test.`);
    return false;
  }

  console.log(`\x1b[32m✅ Self-healing attempt completed. Re-running Playwright to verify...\x1b[0m`);
  return true;
}

// ── REGENERATE MODE (--regenerate): skip Step 1/2, reuse what's on disk ──
// Matches the Tester's exact "regenerate" motion: run the full pipeline once,
// record a real codegen session for the flow(s) that need better grounding
// (`npm run record:ticket <KEY>`), then re-run just Step 3+4 so the newly
// recorded selectors are picked up automatically -- no manual copy/paste.
if (REGENERATE_ONLY) {
  const ticketMdPath = path.join(ROOT_DIR, 'docs', 'tickets', `${key}.md`);
  if (!fs.existsSync(ticketMdPath)) {
    fail(
      `--regenerate was specified but docs/tickets/${key}.md does not exist yet.\n` +
      `   -> Run the full pipeline at least once first: npm run auto-test ${key}`
    );
  }
  console.log(`\x1b[1m⏭️  --regenerate: skipping Step 1 (fetch-jira) and Step 2 (summarize-story), reusing existing docs/tickets/${key}.md\x1b[0m`);
}

// Fail fast on --ground BEFORE spending any AI credits on Step 1 (fetch-jira)
// or Step 2 (summarize-story, a paid model call): if the mandatory recording
// is missing or empty there is no point running the earlier steps only to
// stop at Step 3. This also catches an empty recording (no real interactions)
// up front, so a `--ground` run can never silently strip test.fixme() guards
// based on a session the Tester closed without actually exercising the flow.
if (GROUND_REQUIRED) {
  const rec = readRecording();
  if (rec.status === 'missing') {
    fail(
      `--ground was specified but ${RECORDING_REL_PATH} does not exist.\n` +
      `   -> Record the real flow first: npm run record:ticket ${key}\n` +
      `   -> Then re-run: npm run auto-test ${key} -- --ground   (or) npm run regenerate ${key}`
    );
  }
  if (rec.status === 'empty') {
    fail(
      `--ground requires a NON-EMPTY recording, but ${RECORDING_REL_PATH} has no recorded interactions.\n` +
      `   -> Re-record and perform at least one real action: npm run record:ticket ${key}`
    );
  }
}

const summaryFullPath = path.join(ROOT_DIR, 'docs', 'tickets', `${key}.summary.json`);
if (!REGENERATE_ONLY) {
  fetchJira();
}
if (CREATE_SUBTASK) {
  createSubtask();
}
const summaryRelPath = REGENERATE_ONLY
  ? (fs.existsSync(summaryFullPath) ? `docs/tickets/${key}.summary.json` : null)
  : summarizeStory();
const { relSpecPath } = generateTest(summaryRelPath);

// ── REVERSE-GROUNDING: recording -> OpenSpecs (live_grounded_components.yaml) ──
// Ngay sau khi sinh test grounded vào recording, bóc tách các selector/component
// thực tế trong recording và merge ngược vào OpenSpecs. Nhờ đó ticket mới sau này
// (KEY khác) khi sinh test sẽ tự động tái sử dụng các selector đã kiểm chứng thật.
reverseGroundFromRecording();

let passed = runPlaywright(relSpecPath);
let selfHealed = false;

if (!passed) {
  const healApplied = selfHealAndRetry(relSpecPath);
  if (healApplied) {
    selfHealed = true;
    passed = runPlaywright(relSpecPath, '🔁 Re-running Playwright test after self-healing fix...');
  }
}

printHeader(`🎉 ALL-IN-ONE PIPELINE COMPLETED FOR \x1b[36m${key}\x1b[0m!`);
console.log(`📄 Testcase:  tests/testcases/TC-${key}.md`);
console.log(`🧪 Test Spec: ${relSpecPath}`);
if (selfHealed) {
  console.log(`🩺 Self-healing (/fix-failed-test on ${MODEL_SELF_HEAL}) was applied after the first run failed.`);
}
console.log(passed
  ? `\x1b[32m✅ RESULT: Playwright test PASSED\x1b[0m`
  : `\x1b[31m❌ RESULT: Playwright test FAILED (see report above / npm run report)\x1b[0m`);
console.log(`======================================================\n`);

process.exit(passed ? 0 : 1);
