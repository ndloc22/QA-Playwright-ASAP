/**
 * E.ON MD-to-Spec: compile Markdown BDD scenarios -> Playwright spec (0 AI TOKENS)
 *
 * "Compile .md scenarios directly to .spec.ts without AI calls."
 *
 * Reads `tests/testcases/functions/TC-<NAME>.md`, maps ```automation``` steps to Page Object methods/locators, and outputs
 * `tests/e2e/functions/TC-<NAME>.spec.ts`.
 *
 * Runs 100% locally on CPU with zero tokens and deterministic compilation.
 *
 * -- ```automation``` block syntax ----------------------------------------------
 *   Given: <description>   # begins a test.step group (Given/When/Then/And/Setup...)
 *   When:  <description>
 *   Then:  <description>
 *     <methodName>                 -> await pom.methodName();
 *     <methodName> "value"         -> await pom.methodName('value');
 *     <methodName>("a", "b")       -> await pom.methodName('a', 'b');
 *     goto                         -> await page.goto(BASE_URL);
 *     goto "/deep/link"            -> await page.goto(BASE_URL + 'deep/link');
 *     expect <member> visible      -> await expect(pom.member).toBeVisible();
 *     expect <member> hidden       -> toBeHidden()
 *     expect <member> enabled      -> toBeEnabled()
 *     expect <member> disabled     -> toBeDisabled()
 *     expect <member> text "x"     -> toContainText('x')
 *     expect <member> value "x"    -> toHaveValue('x')
 *     expect <member> count 3      -> toHaveCount(3)
 *     expect url "asap"            -> await expect(page).toHaveURL(/asap/)
 *     pause                        -> await page.pause();   (pause for manual SSO)
 *     wait 1500                    -> await page.waitForTimeout(1500);
 *     include TC-<NAME>-01         -> INHERIT all steps from another scenario
 *     # ... / // ...               -> comment (ignored)
 *
 * Usage:
 *   node scripts/md-to-spec.js SEARCH_TELECONTROL
 *   node scripts/md-to-spec.js TC-SEARCH_TELECONTROL.md
 *   npm run md-to-spec SEARCH_TELECONTROL
 *   npm run md-to-spec SEARCH_TELECONTROL -- --stdout   # output to stdout, do not write file
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { toPascalCasePageName } = require('./sync-specs');

dotenv.config();

const ROOT_DIR = path.join(__dirname, '..');

function parseKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim();
  if (!value) return null;
  value = value.split(/[\\/]/).pop();               // strip any path
  value = value.replace(/\.md$/i, '');              // strip .md
  value = value.replace(/^TC-/i, '');               // strip TC- prefix
  const match = value.match(/([A-Za-z0-9_-]+)/);
  return match ? match[1].toUpperCase() : null;
}

/** Resolve where the TC-<KEY>.md scenario lives (functions group first, then flat). */
function resolveMd(key) {
  const grouped = path.join(ROOT_DIR, 'tests', 'testcases', 'functions', `TC-${key}.md`);
  if (fs.existsSync(grouped)) {
    return { mdFull: grouped, mdRel: `tests/testcases/functions/TC-${key}.md`, isFunction: true };
  }
  const flat = path.join(ROOT_DIR, 'tests', 'testcases', `TC-${key}.md`);
  return { mdFull: flat, mdRel: `tests/testcases/TC-${key}.md`, isFunction: false };
}

/** Resolve the Page Object file + import specifier for a spec placed in group/flat. */
function resolvePom(key, isFunction) {
  const pageClass = toPascalCasePageName(key);
  if (isFunction) {
    return {
      pageClass,
      pomFull: path.join(ROOT_DIR, 'tests', 'pages', 'functions', `${pageClass}.ts`),
      pomRel: `tests/pages/functions/${pageClass}.ts`,
      importSpecifier: `../../pages/functions/${pageClass}`
    };
  }
  return {
    pageClass,
    pomFull: path.join(ROOT_DIR, 'tests', 'pages', `${pageClass}.ts`),
    pomRel: `tests/pages/${pageClass}.ts`,
    importSpecifier: `../pages/${pageClass}`
  };
}

/**
 * Introspect Page Object interface to VALIDATE .md steps against live methods/locators.
 */
function introspectPom(pomSource) {
  const methods = new Set();
  const members = new Set();
  const methodRe = /^\s*async\s+([A-Za-z0-9_]+)\s*\(/gm;
  const readonlyRe = /^\s*readonly\s+([A-Za-z0-9_]+)\s*:\s*Locator/gm;
  const getterRe = /^\s*get\s+([A-Za-z0-9_]+)\s*\(\)\s*:\s*(?:Locator|FrameLocator)/gm;
  let m;
  while ((m = methodRe.exec(pomSource))) methods.add(m[1]);
  while ((m = readonlyRe.exec(pomSource))) members.add(m[1]);
  while ((m = getterRe.exec(pomSource))) {
    if (m[1] !== 'frame') members.add(m[1]);
  }
  const baseMatch = pomSource.match(/const\s+BASE_URL_FALLBACK\s*=\s*'((?:[^'\\]|\\.)*)'/);
  const baseFallback = baseMatch ? baseMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : '';
  return { methods, members, baseFallback };
}

/**
 * Parse .md file into scenarios (each heading ### ... TC-<ID> followed by an ```automation``` block).
 */
function parseScenarios(mdSource, key) {
  const lines = mdSource.split(/\r?\n/);
  const scenarios = [];
  const order = [];
  let currentHeading = null;
  let autoIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^#{2,6}\s+(.*)$/);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      continue;
    }
    const fenceMatch = line.match(/^\s*```(\S*)\s*$/);
    if (fenceMatch && fenceMatch[1].toLowerCase() === 'automation') {
      // collect until closing ```
      const body = [];
      i++;
      for (; i < lines.length; i++) {
        if (/^\s*```/.test(lines[i])) break;
        body.push(lines[i]);
      }
      autoIndex++;
      const idMatch = currentHeading && currentHeading.match(/(TC-[A-Za-z0-9_-]+?-\d+)/i);
      const id = idMatch
        ? idMatch[1].toUpperCase()
        : `TC-${key}-${String(autoIndex).padStart(2, '0')}`;
      let title = currentHeading || id;
      // Strip leading "Scenario TC-...:" noise for a clean test title.
      title = title
        .replace(/^Scenario\s+/i, '')
        .replace(/TC-[A-Za-z0-9_-]+?-\d+\s*[::\-]?\s*/i, '')
        .trim();
      if (!title) title = id;
      if (!scenarios.find((s) => s.id === id)) {
        scenarios.push({ id, title, body });
        order.push(id);
      } else {
        // Duplicate id -> append body (still one scenario).
        scenarios.find((s) => s.id === id).body.push(...body);
      }
    }
  }
  return scenarios;
}

/** Tokenize an argument string respecting single/double quotes. Numbers stay numeric. */
function tokenizeArgs(str) {
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1] !== undefined) tokens.push({ type: 'string', value: m[1].replace(/\\"/g, '"') });
    else if (m[2] !== undefined) tokens.push({ type: 'string', value: m[2].replace(/\\'/g, "'") });
    else {
      const raw = m[3];
      if (/^-?\d+(\.\d+)?$/.test(raw)) tokens.push({ type: 'number', value: raw });
      else if (raw === 'true' || raw === 'false') tokens.push({ type: 'boolean', value: raw });
      else tokens.push({ type: 'string', value: raw });
    }
  }
  return tokens;
}

function tsStr(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderArg(tok) {
  if (tok.type === 'number' || tok.type === 'boolean') return tok.value;
  return tsStr(tok.value);
}

const GROUP_RE = /^(Given|When|Then|And|But|Setup|Precondition|Background)\b\s*:?\s*(.*)$/i;

const EXPECT_MATCHERS = {
  visible: () => '.toBeVisible()',
  hidden: () => '.toBeHidden()',
  enabled: () => '.toBeEnabled()',
  disabled: () => '.toBeDisabled()',
  checked: () => '.toBeChecked()',
  text: (v) => `.toContainText(${tsStr(v)})`,
  value: (v) => `.toHaveValue(${tsStr(v)})`,
  count: (v) => `.toHaveCount(${/^\d+$/.test(v) ? v : tsStr(v)})`
};

/**
 * Expand 1 scenario into resolved actions, supporting `include <ID>` inheritance.
 */
function expandScenario(scenario, scenarioMap, pom, errors, seen = new Set()) {
  const items = [];
  if (seen.has(scenario.id)) {
    errors.push(`Include cycle detected in ${scenario.id} -- skipped to prevent infinite recursion.`);
    return items;
  }
  seen.add(scenario.id);

  for (const rawLine of scenario.body) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;

    const groupMatch = line.match(GROUP_RE);
    if (groupMatch) {
      const keyword = groupMatch[1];
      const cap = keyword.charAt(0).toUpperCase() + keyword.slice(1).toLowerCase();
      items.push({ type: 'group', keyword: cap, desc: groupMatch[2].trim() });
      continue;
    }

    // include <ID> -> inline another scenario's items (inheritance)
    const includeMatch = line.match(/^include\s*:?\s+(\S+)/i);
    if (includeMatch) {
      const targetId = includeMatch[1].toUpperCase();
      const target = scenarioMap.get(targetId);
      if (!target) {
        errors.push(`include: scenario "${targetId}" not found (must be declared with heading "### Scenario ${targetId}: ...").`);
        continue;
      }
      items.push(...expandScenario(target, scenarioMap, pom, errors, new Set(seen)));
      continue;
    }

    const code = resolveAction(line, pom, errors, scenario.id);
    if (code) items.push({ type: 'action', code });
  }
  return items;
}

/** Resolve a single action line to TypeScript, validated against Page Object. */
function resolveAction(line, pom, errors, scenarioId) {
  // pause / wait
  if (/^pause$/i.test(line)) return 'await page.pause();';
  const waitMatch = line.match(/^wait\s+(\d+)$/i);
  if (waitMatch) return `await page.waitForTimeout(${waitMatch[1]});`;

  // goto [ "path" ]
  const gotoMatch = line.match(/^goto\b(.*)$/i);
  if (gotoMatch) {
    const rest = gotoMatch[1].trim();
    if (!rest) return 'await page.goto(BASE_URL);';
    const toks = tokenizeArgs(rest);
    const p = toks.length ? String(toks[0].value) : '';
    if (/^https?:\/\//i.test(p)) return `await page.goto(${tsStr(p)});`;
    const clean = p.replace(/^\/+/, '');
    return `await page.goto(BASE_URL + ${tsStr(clean)});`;
  }

  // expect <member> <matcher> [value]
  const expectMatch = line.match(/^expect\s+(\S+)\s+(\S+)\s*(.*)$/i);
  if (expectMatch) {
    const member = expectMatch[1];
    const matcher = expectMatch[2].toLowerCase();
    const rest = expectMatch[3].trim();
    if (member.toLowerCase() === 'url' || member.toLowerCase() === 'page') {
      const toks = tokenizeArgs(rest);
      const v = toks.length ? String(toks[0].value) : '';
      return `await expect(page).toHaveURL(new RegExp(${tsStr(v)}));`;
    }
    if (!pom.members.has(member)) {
      errors.push(`[${scenarioId}] expect: Page Object has no locator "${member}". Valid locators: ${[...pom.members].join(', ') || '(none)'}`);
      return null;
    }
    const build = EXPECT_MATCHERS[matcher];
    if (!build) {
      errors.push(`[${scenarioId}] expect: matcher "${matcher}" is not supported. Use: ${Object.keys(EXPECT_MATCHERS).join(', ')}, url.`);
      return null;
    }
    const toks = tokenizeArgs(rest);
    const v = toks.length ? String(toks[0].value) : '';
    return `await expect(pom.${member})${build(v)};`;
  }

  // method call: `name` | `name "a" 2` | `name("a", 2)`
  let name;
  let argTokens;
  const parenMatch = line.match(/^([A-Za-z_$][\w$]*)\s*\((.*)\)\s*$/);
  if (parenMatch) {
    name = parenMatch[1];
    argTokens = tokenizeArgs(parenMatch[2].replace(/,/g, ' '));
  } else {
    const spaceMatch = line.match(/^([A-Za-z_$][\w$]*)\b(.*)$/);
    if (!spaceMatch) {
      errors.push(`Unrecognized step line: "${line}"`);
      return null;
    }
    name = spaceMatch[1];
    argTokens = tokenizeArgs(spaceMatch[2].trim());
  }

  if (!pom.methods.has(name)) {
    errors.push(`[${scenarioId}] method: Page Object has no method "${name}". Valid methods: ${[...pom.methods].join(', ') || '(none)'}`);
    return null;
  }
  const args = argTokens.map(renderArg).join(', ');
  return `await pom.${name}(${args});`;
}

/** Render the entire .spec.ts content from expanded scenarios. */
function renderSpec(key, pageInfo, baseFallback, scenarios, scenarioMap, mdRel, errors) {
  const L = [];
  L.push("import { test, expect } from '@playwright/test';");
  L.push(`import { ${pageInfo.pageClass} } from '${pageInfo.importSpecifier}';`);
  L.push('');
  L.push('/**');
  L.push(` * TC-${key}: E2E spec generated automatically from Markdown scenario \`${mdRel}\`.`);
  L.push(' *');
  L.push(' * Source of truth is the .md file (automation block). Generated by');
  L.push(` * \`npm run md-to-spec ${key}\` (scripts/md-to-spec.js) -- 0 tokens, NO AI calls.`);
  L.push(' *');
  L.push(' * DO NOT edit manually: edit the .md file and re-run md-to-spec.');
  L.push(' */');
  L.push(`const BASE_URL = (process.env.BASE_URL || ${tsStr(baseFallback || '')}).replace(/\\/+$/, '') + '/';`);
  L.push('');
  L.push(`test.describe('TC-${key}', () => {`);

  scenarios.forEach((scenario, idx) => {
    const items = expandScenario(scenario, scenarioMap, pageInfo.pom, errors);
    const testTitle = `${scenario.id}: ${scenario.title}`;
    L.push(`  test(${tsStr(testTitle)}, async ({ page }) => {`);
    L.push(`    const pom = new ${pageInfo.pageClass}(page);`);

    // Group actions into test.step blocks by Given/When/Then headers.
    const groups = [];
    let current = null;
    for (const item of items) {
      if (item.type === 'group') {
        current = { label: item.desc ? `${item.keyword}: ${item.desc}` : item.keyword, actions: [] };
        groups.push(current);
      } else {
        if (!current) {
          current = { label: 'Steps', actions: [] };
          groups.push(current);
        }
        current.actions.push(item.code);
      }
    }

    if (!groups.length) {
      L.push('    // (Empty automation block -- add steps to .md file and re-run md-to-spec.)');
    }
    for (const g of groups) {
      L.push('');
      L.push(`    await test.step(${tsStr(g.label)}, async () => {`);
      if (!g.actions.length) {
        L.push('      // (no steps in this group)');
      }
      for (const a of g.actions) {
        L.push(`      ${a}`);
      }
      L.push('    });');
    }
    L.push('  });');
    if (idx < scenarios.length - 1) L.push('');
  });

  L.push('});');
  L.push('');
  return L.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const toStdout = argv.includes('--stdout');
  const positional = argv.find((a) => !a.startsWith('--'));
  const key = parseKey(positional);

  console.log('======================================================');
  console.log(' [SPEC] MD-to-Spec (0 token, deterministic)');
  console.log('======================================================');

  if (!key) {
    console.log('\n\x1b[33mUsage: npm run md-to-spec <FUNCTION_NAME> [-- --stdout]\x1b[0m');
    console.log('   Example: npm run md-to-spec SEARCH_TELECONTROL');
    console.log('   (Reads tests/testcases/functions/TC-<NAME>.md -> generates tests/e2e/functions/TC-<NAME>.spec.ts)\n');
    process.exit(1);
  }

  const { mdFull, mdRel, isFunction } = resolveMd(key);
  if (!fs.existsSync(mdFull)) {
    console.error(`\n\x1b[31m[ERROR] Scenario file not found: ${mdRel}\x1b[0m`);
    console.error(`   -> Generate it first: npm run sync-specs ${key}\n`);
    process.exit(1);
  }

  const pageInfo = resolvePom(key, isFunction);
  if (!fs.existsSync(pageInfo.pomFull)) {
    console.error(`\n\x1b[31m[ERROR] Page Object not found: ${pageInfo.pomRel}\x1b[0m`);
    console.error(`   -> Generate it first: npm run sync-specs ${key}\n`);
    process.exit(1);
  }

  const mdSource = fs.readFileSync(mdFull, 'utf-8');
  const pomSource = fs.readFileSync(pageInfo.pomFull, 'utf-8');
  const pom = introspectPom(pomSource);
  pageInfo.pom = pom;

  const scenarios = parseScenarios(mdSource, key);
  if (!scenarios.length) {
    console.error(`\n\x1b[31m[ERROR] No \`\`\`automation\`\`\` block found in ${mdRel}\x1b[0m`);
    console.error('   -> Add an ```automation ... ``` block (see instructions in the .md file).\n');
    process.exit(1);
  }
  const scenarioMap = new Map(scenarios.map((s) => [s.id, s]));

  const errors = [];
  const code = renderSpec(key, pageInfo, pom.baseFallback, scenarios, scenarioMap, mdRel, errors);

  if (errors.length) {
    console.error(`\n\x1b[31m[ERROR] ${errors.length} error(s) translating scenario -- spec was NOT written:\x1b[0m`);
    for (const e of errors) console.error(`   * ${e}`);
    console.error('\n   -> Fix the lines above in the .md file and re-run. (See valid methods/locators in the messages above.)\n');
    process.exit(1);
  }

  if (toStdout) {
    console.log('\n' + code);
    return;
  }

  const specDir = isFunction
    ? path.join(ROOT_DIR, 'tests', 'e2e', 'functions')
    : path.join(ROOT_DIR, 'tests', 'e2e');
  const specRel = isFunction
    ? `tests/e2e/functions/TC-${key}.spec.ts`
    : `tests/e2e/TC-${key}.spec.ts`;
  const specFull = path.join(specDir, `TC-${key}.spec.ts`);
  const existed = fs.existsSync(specFull);
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(specFull, code, 'utf-8');

  console.log(`\n\x1b[32m[OK] ${existed ? 'Updated' : 'Generated'} spec: ${specRel}\x1b[0m`);
  console.log(`   Source: ${mdRel}  |  Page Object: ${pageInfo.pomRel}`);
  console.log(`   Scenarios: ${scenarios.length} (${scenarios.map((s) => s.id).join(', ')})`);
  console.log('\n[NEXT] Run DIRECTLY with UI (supports manual SSO hand-off):');
  console.log(`      npm run test:function ${key}\n`);
}

module.exports = { parseScenarios, introspectPom, resolveAction, expandScenario, renderSpec };

if (require.main === module) {
  main();
}
