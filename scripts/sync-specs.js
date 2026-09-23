/**
 * 🔁 E.ON Reverse-Grounding: Playwright Recording -> OpenSpecs sync
 *
 * "Sếp: gọi copilot phân tích và triển khai luôn đi em."
 *
 * Cơ chế Reverse-Grounding (bổ sung cho grounding 1 chiều đã có):
 *   - grounding (đã có): OpenSpecs (docs/specs/codebase/ui_components.yaml) ->
 *     dùng làm nguồn selector khi sinh test.
 *   - reverse-grounding (MỚI, file này): bóc tách các selector/component THỰC TẾ
 *     mà Tester vừa thao tác trong 1 phiên `npm run record:ticket <KEY>`
 *     (tests/recordings/<KEY>.recording.ts) rồi MERGE NGƯỢC vào OpenSpecs, cụ thể
 *     là docs/specs/codebase/live_grounded_components.yaml (đánh dấu nguồn gốc
 *     `origin: live_recording_<KEY>`). Nhờ đó bộ OpenSpecs tự tích luỹ "tri thức
 *     sống": ticket mới sau này khi sinh testcase sẽ tự động tái sử dụng ngay các
 *     selector đã được kiểm chứng trực tiếp trên app thật.
 *
 * File live_grounded_components.yaml được index.yaml và
 * .github/prompts/new-test.prompt.md tự động tham chiếu như nguồn grounding ưu
 * tiên CAO NHẤT (cao hơn ui_components.yaml tĩnh, vì đây là DOM thật vừa quan sát).
 *
 * NGOÀI reverse-grounding, script còn TỰ ĐỘNG đóng gói một Page Object Model
 * chuẩn (TypeScript) tại tests/pages/<PascalCaseKey>Page.ts, bóc tách trực tiếp
 * từ recording (locator dedup + method theo action đã ghi). Nhờ đó Tester chỉ cần
 * chạy 1 lệnh `npm run sync-specs <KEY>` thay vì gọi thêm bước sinh POM riêng.
 *
 * Usage:
 *   node scripts/sync-specs.js KFWT-1161          # sync recording + đóng gói POM + starter spec
 *   node scripts/sync-specs.js ADMINISTRATION     # (vd) sync + tests/pages/AdministrationPage.ts + tests/e2e/TC-ADMINISTRATION.spec.ts
 *   node scripts/sync-specs.js KFWT-1161 --no-pom # chỉ reverse-grounding, không sinh POM
 *   node scripts/sync-specs.js KFWT-1161 --force-pom  # ghi đè POM nếu đã tồn tại
 *   node scripts/sync-specs.js KFWT-1161 --no-spec    # không sinh starter E2E spec
 *   node scripts/sync-specs.js KFWT-1161 --force-spec # ghi đè starter spec nếu đã tồn tại
 *   node scripts/sync-specs.js --all              # sync mọi recording trong tests/recordings/
 *   npm run sync-specs KFWT-1161
 *   npm run sync-specs -- --all
 *
 * Guard an toàn (non-destructive): POM và starter spec đã tồn tại trên đĩa sẽ KHÔNG
 * bị ghi đè trừ khi truyền tường minh --force-pom / --force-spec. Entry URL bóc tách
 * từ recording luôn được làm sạch các đoạn ephemeral `/faces/instances/...` (Axon Ivy
 * dialog instance dùng-một-lần gây lỗi "View Expired"); runtime ưu tiên process.env.BASE_URL.
 *
 * An toàn: script chỉ ghi vào docs/specs/codebase/live_grounded_components.yaml,
 * KHÔNG bao giờ đụng vào ui_components.yaml / state_machine.yaml (do
 * generate-codebase-specs.js quản lý). Merge theo `key`: chạy lại cùng 1 KEY sẽ
 * thay thế đúng entry của KEY đó, giữ nguyên entry của các KEY khác.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const RECORDINGS_DIR = path.join(ROOT_DIR, 'tests', 'recordings');
// Nhóm 2 (Function/Module) artifacts live in dedicated `functions/` subfolders so
// they never collide with Nhóm 1 (Jira Ticket) files. `record:function` writes the
// recording under tests/recordings/functions/, and this script mirrors that grouping
// for the Page Object (tests/pages/functions/) and starter spec (tests/e2e/functions/).
const RECORDINGS_FUNCTIONS_DIR = path.join(RECORDINGS_DIR, 'functions');
const CODEBASE_SPEC_DIR = path.join(ROOT_DIR, 'docs', 'specs', 'codebase');

/**
 * Resolve where a KEY's recording lives without any config: prefer the grouped
 * tests/recordings/functions/<KEY>.recording.ts (Nhóm 2), else fall back to the
 * flat tests/recordings/<KEY>.recording.ts (Nhóm 1). The returned `isFunction`
 * flag drives grouped output paths
 */
function resolveRecording(key) {
  const functionFull = path.join(RECORDINGS_FUNCTIONS_DIR, `${key}.recording.ts`);
  if (fs.existsSync(functionFull)) {
    return {
      isFunction: true,
      recordingFull: functionFull,
      recordingRel: `tests/recordings/functions/${key}.recording.ts`
    };
  }
  return {
    isFunction: false,
    recordingFull: path.join(RECORDINGS_DIR, `${key}.recording.ts`),
    recordingRel: `tests/recordings/${key}.recording.ts`
  };
}
const LIVE_SPEC_PATH = path.join(CODEBASE_SPEC_DIR, 'live_grounded_components.yaml');
const LIVE_SPEC_REL = 'docs/specs/codebase/live_grounded_components.yaml';

/**
 * Chuẩn hoá 1 tên ticket/KEY từ chuỗi bất kỳ (KFWT-1161, kfwt-1161, ...).
 */
function parseTicketKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim();
  if (!value) return null;
  // Strip URL query/hash and trailing slashes, then keep only the last path
  // segment (e.g. https://jira/browse/KFWT-1161 -> KFWT-1161). For recording
  // filenames like `ADMINISTRATION.recording.ts` the match stops at the dot.
  value = value.split(/[?#]/)[0].replace(/\/+$/, '');
  const segment = value.split('/').pop();
  // Accept classic ticket keys (KFWT-1161) as well as alphanumeric module
  // names / custom keys (ADMINISTRATION, ASAP-NAVIGATION, ...).
  const match = segment.match(/([A-Za-z0-9_-]+)/);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Playwright codegen luôn emit tối thiểu 1 page.goto(...). 1 recording chỉ có
 * điều hướng (không click/fill gì) KHÔNG phải bằng chứng feature chạy thật, nên
 * ta không reverse-ground nó (tránh làm "ô nhiễm" OpenSpecs bằng selector rỗng).
 * Điều kiện này khớp với recordingHasRealInteractions() trong auto-test.js.
 */
function hasRealInteractions(content) {
  if (!content) return false;
  const INTERACTION_RE =
    /\.(click|fill|press|check|uncheck|selectOption|setInputFiles|type|dblclick|tap|hover|dragTo|focus)\s*\(|getBy(Role|Label|Placeholder|Text|TestId|Title|AltText)\s*\(/;
  return INTERACTION_RE.test(content);
}

// getBy* locator engine -> loại locatorType đã chuẩn hoá.
const GET_BY_MAP = {
  getByRole: 'role',
  getByLabel: 'label',
  getByPlaceholder: 'placeholder',
  getByText: 'text',
  getByTestId: 'testId',
  getByTitle: 'title',
  getByAltText: 'altText'
};

// action Playwright -> có "value" đi kèm hay không (fill/type/selectOption/press).
const ACTION_RE =
  /\.(click|fill|press|check|uncheck|selectOption|setInputFiles|type|dblclick|tap|hover|dragTo|focus)\s*\(\s*(?:(['"`])((?:\\.|(?!\2).)*)\2)?/g;

/**
 * Bóc tách chuỗi tham số đầu tiên dạng string literal ('...' | "..." | `...`)
 * bắt đầu tại vị trí startIdx (đã trỏ vào ngay sau dấu "(").
 * Trả về { value, endIdx } hoặc null nếu không phải string literal.
 */
function readStringArg(src, startIdx) {
  let i = startIdx;
  while (i < src.length && /\s/.test(src[i])) i++;
  const quote = src[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  i++;
  let value = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      value += src[i + 1] || '';
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { value, endIdx: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return null;
}

/**
 * Bóc tách option object thứ 2 của getByRole/getByText... (vd { name: 'Save', exact: true }).
 * Đơn giản: quét tới dấu "}" cân bằng đầu tiên rồi rút name/exact bằng regex.
 */
function readOptions(src, startIdx) {
  let i = startIdx;
  while (i < src.length && /[\s,]/.test(src[i])) i++;
  if (src[i] !== '{') return { options: null, endIdx: startIdx };
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) { j++; break; }
    }
  }
  const raw = src.slice(i, j);
  const nameMatch = raw.match(/name\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/);
  const exactMatch = raw.match(/exact\s*:\s*(true|false)/);
  return {
    options: {
      name: nameMatch ? nameMatch[2] : null,
      exact: exactMatch ? exactMatch[1] === 'true' : null
    },
    endIdx: j
  };
}

/**
 * Nhận diện PrimeFaces / JSF client id: naming-container dùng dấu ":" (vd
 * "form:stationNumber", "j_idt42:save"). Playwright codegen escape nó thành
 * "#form\:stationNumber" (CSS) hoặc [id="form:stationNumber"].
 */
function extractPrimefacesId(rawLocator) {
  if (!rawLocator) return null;
  // #form\:foo\:bar  -> bỏ escape "\:" -> form:foo:bar
  const cssIdMatch = rawLocator.match(/#((?:[\w-]|\\.)*\\:(?:[\w-]|\\.)*)/);
  if (cssIdMatch) {
    const unescaped = cssIdMatch[1].replace(/\\(.)/g, '$1');
    if (unescaped.includes(':')) return unescaped;
  }
  // [id="form:foo"] hoặc [id='form:foo']
  const attrIdMatch = rawLocator.match(/\[id\s*=\s*(['"])((?:\\.|(?!\1).)*)\1\]/);
  if (attrIdMatch) {
    const val = attrIdMatch[2].replace(/\\(.)/g, '$1');
    if (val.includes(':')) return val;
  }
  return null;
}

/**
 * Tạo signature duy nhất cho 1 locator để gộp các action rời rạc trỏ cùng phần tử.
 */
function locatorSignature(comp) {
  return [comp.locatorType, comp.role || '', comp.name || comp.text || '', comp.css || ''].join('|');
}

/**
 * Bóc tách toàn bộ component (locator + action + value) từ 1 recording source.
 */
function extractComponents(source, key) {
  const bySignature = new Map();

  const upsert = (base) => {
    const sig = locatorSignature(base);
    if (!bySignature.has(sig)) {
      bySignature.set(sig, {
        ...base,
        actions: [],
        sampleValues: [],
        origin: `live_recording_${key}`
      });
    }
    return bySignature.get(sig);
  };

  // Duyệt từng "câu lệnh" locator-chain: page(.frameLocator...)?.getBy... hoặc .locator(...)
  // Ta quét toàn văn theo từng lần xuất hiện getBy*/locator( và đọc tham số kèm actions ngay sau.
  const engineRe = /\.(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|getByTitle|getByAltText|locator)\s*\(/g;
  let m;
  while ((m = engineRe.exec(source)) !== null) {
    const engine = m[1];
    const argStart = engineRe.lastIndex;
    const strArg = readStringArg(source, argStart);
    if (!strArg) continue;

    let comp;
    if (engine === 'locator') {
      const css = strArg.value;
      const primefacesId = extractPrimefacesId(css);
      comp = upsert({
        locatorType: 'css',
        css,
        role: null,
        name: null,
        text: null,
        exact: null,
        primefacesId
      });
    } else {
      const locatorType = GET_BY_MAP[engine];
      let role = null;
      let name = null;
      let text = null;
      let exact = null;
      if (engine === 'getByRole') {
        role = strArg.value;
        const opts = readOptions(source, strArg.endIdx);
        if (opts.options) {
          name = opts.options.name;
          exact = opts.options.exact;
        }
      } else if (engine === 'getByText') {
        text = strArg.value;
      } else {
        // getByLabel / Placeholder / TestId / Title / AltText: string chính là name.
        name = strArg.value;
      }
      comp = upsert({
        locatorType,
        css: null,
        role,
        name,
        text,
        exact,
        primefacesId: null
      });
    }

    // Đọc các action gắn liền trong ~400 ký tự tiếp theo của cùng câu lệnh
    // (tới dấu ";" hoặc xuống dòng kết thúc statement).
    const tail = source.slice(strArg.endIdx, strArg.endIdx + 400);
    const stmtEnd = tail.search(/;|\n/);
    const stmt = stmtEnd === -1 ? tail : tail.slice(0, stmtEnd);
    let a;
    ACTION_RE.lastIndex = 0;
    while ((a = ACTION_RE.exec(stmt)) !== null) {
      const action = a[1];
      const value = a[3];
      if (!comp.actions.includes(action)) comp.actions.push(action);
      if (value != null && value !== '' && !comp.sampleValues.includes(value)) {
        comp.sampleValues.push(value);
      }
    }
  }

  // Chuẩn hoá output: bỏ field null cho gọn YAML.
  const components = Array.from(bySignature.values()).map((c) => {
    const out = { locatorType: c.locatorType };
    if (c.role) out.role = c.role;
    if (c.name) out.name = c.name;
    if (c.text) out.text = c.text;
    if (c.css) out.css = c.css;
    if (c.primefacesId) out.primefacesId = c.primefacesId;
    if (c.exact === true) out.exact = true;
    if (c.actions.length) out.actions = c.actions;
    if (c.sampleValues.length) out.sampleValues = c.sampleValues;
    out.origin = c.origin;
    return out;
  });

  return components;
}

/**
 * Tìm URL điều hướng đầu tiên (page.goto) để lưu như "screen entry point".
 */
function extractEntryUrl(source) {
  const re = /\.goto\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  const urls = [];
  let match;
  while ((match = re.exec(source)) !== null) {
    urls.push(match[2]);
  }
  if (!urls.length) return null;
  // Prefer the first non-SSO / non-IdP URL (e.g. ASAP portal URL instead of login.microsoftonline.com)
  const isSso = (u) =>
    /login\.microsoft|login\.live|login\.windows|\/oauth2\/|\/adfs\/|okta\.com|auth0\.com/i.test(u);
  const appUrl = urls.find((u) => !isSso(u));
  return appUrl || urls[0];
}

/**
 * Làm sạch entry URL trước khi lưu/sinh test: các URL codegen ghi lại thường nhúng
 * một "dialog instance id" DÙNG-MỘT-LẦN của Axon Ivy
 * (`.../faces/instances/portal$2/<id>/.../Login.xhtml`). Instance id này hết hạn
 * ở phía server nên khi replay portal trả về trang "View Expired" -> test đỏ giả.
 *
 * Quy tắc: cắt bỏ mọi đoạn ephemeral `/faces/instances/...` (và `/faces/dialog/...`)
 * để lùi về gốc ứng dụng ổn định. Nếu không match thì giữ nguyên URL.
 * Nơi gọi nên ưu tiên `process.env.BASE_URL` rồi mới tới URL đã làm sạch này.
 */
function cleanseEntryUrl(url) {
  if (!url) return null;
  const m = String(url).match(/^(https?:\/\/[^'"\s]*?)\/faces\/(?:instances|dialog)\b/i);
  return m ? m[1] : String(url);
}

const PAGES_DIR = path.join(ROOT_DIR, 'tests', 'pages');
const PAGES_FUNCTIONS_DIR = path.join(PAGES_DIR, 'functions');


/**
 * Chuẩn hoá KEY (ticket/module) -> tên class Page Object dạng PascalCase + "Page".
 *   ADMINISTRATION   -> AdministrationPage
 *   KFWT-1161        -> Kfwt1161Page
 *   ASAP-NAVIGATION  -> AsapNavigationPage
 */
function toPascalCasePageName(key) {
  const parts = String(key || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const pascal = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
  return `${pascal || 'Recorded'}Page`;
}

/**
 * Escape 1 giá trị thành TypeScript single-quoted string literal an toàn.
 */
function tsString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Chuyển 1 chuỗi bất kỳ ('Add Supplier', 'X-Requested-By Header*') thành
 * identifier camelCase hợp lệ ('addSupplier', 'xRequestedByHeader').
 */
function camelIdentifier(str) {
  const words = String(str || '')
    .replace(/\*/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return '';
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

/**
 * Hậu tố member name theo loại locator/role để đọc dễ hiểu (saveButton, supplierInput...).
 */
function roleSuffix(comp) {
  if (comp.locatorType === 'role') {
    switch (comp.role) {
      case 'button':
        return 'Button';
      case 'textbox':
      case 'spinbutton':
      case 'searchbox':
        return 'Input';
      case 'link':
        return 'Link';
      case 'tab':
        return 'Tab';
      case 'checkbox':
        return 'Checkbox';
      case 'radio':
        return 'Radio';
      case 'option':
        return 'Option';
      case 'gridcell':
        return 'Cell';
      case 'columnheader':
        return 'Column';
      case 'combobox':
        return 'Select';
      default:
        return comp.role.charAt(0).toUpperCase() + comp.role.slice(1);
    }
  }
  if (comp.locatorType === 'text') return 'Text';
  if (comp.locatorType === 'label' || comp.locatorType === 'placeholder') return 'Input';
  if (comp.locatorType === 'css') return 'Element';
  return 'Locator';
}

/**
 * Tên member gợi nhớ cho 1 locator (chưa đảm bảo unique).
 */
function deriveBaseName(comp) {
  if (comp._customMember) return comp._customMember;
  if (comp.locatorType === 'raw' && comp.rawExpr) {
    const raw = comp.rawExpr;
    if (/name:\s*['"]Start Process['"]/i.test(raw)) return 'startProcessMenuitem';
    const roleMatch = raw.match(/getByRole\(\s*['"]([^'"]+)['"](?:\s*,\s*\{\s*name:\s*(?:['"]([^'"]+)['"]|\/([^/]+)\/)\s*\})?/);
    const filterMatch = raw.match(/\.filter\(\s*\{\s*hasText:\s*['"]([^'"]+)['"]/);
    const textMatch = raw.match(/getByText\(\s*['"]([^'"]+)['"]/);

    if (roleMatch) {
      const role = roleMatch[1];
      let name = (roleMatch[2] || roleMatch[3] || '').replace(/[^\w\s]/g, '').trim();
      if (!name && filterMatch) {
        name = filterMatch[1].slice(0, 25).replace(/[^\w\s]/g, '').trim();
      }
      if (name) return camelIdentifier(name) + pascal(role);
      return camelIdentifier(role);
    }
    if (textMatch) {
      const text = textMatch[1].slice(0, 30).replace(/[^\w\s]/g, '').trim();
      return camelIdentifier(text) + 'Text';
    }
    if (filterMatch) {
      const text = filterMatch[1].slice(0, 30).replace(/[^\w\s]/g, '').trim();
      return camelIdentifier(text) + 'Element';
    }
    const idMatch = raw.match(/\[id=['"]([^'"]+)['"]\]/);
    if (idMatch) {
      const id = idMatch[1].split(':').pop();
      return camelIdentifier(id) + 'Element';
    }
    const nthMatch = raw.match(/([a-z]+):nth-child\((\d+)\)(?:\s*>\s*([a-z]+))?/i);
    if (nthMatch) {
      const tag = nthMatch[3] || nthMatch[1];
      const n = nthMatch[2];
      return camelIdentifier(`${tag}Nth${n}`);
    }
    const classMatch = raw.match(/\.([\w-]+)/);
    if (classMatch) {
      return camelIdentifier(classMatch[1]) + 'Element';
    }
    return 'actionElement';
  }

  let base = comp.name || comp.text || '';
  if (!base && comp.css) {
    const id = comp.primefacesId || comp.css;
    const seg = id
      .replace(/\[id=|[\"'\]]/g, '')
      .split(/[:.\s>#\[\]]+/)
      .filter(Boolean)
      .pop();
    base = seg || 'element';
  }
  const ident = camelIdentifier(base) || 'locator';
  return ident + roleSuffix(comp);
}

function uniqueName(base, used) {
  let name = base || 'locator';
  if (/^[0-9]/.test(name)) name = `n${name}`;
  let candidate = name;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${name}${i}`;
    i += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Đọc phần đuôi của 1 getBy*(...) call: option object { name, exact } (nếu có)
 * rồi tới dấu ")" đóng. Trả về endIdx (sau ")") hoặc -1 nếu không "sạch".
 */
function consumeGetByTail(portion, startIdx, comp) {
  const opts = readOptions(portion, startIdx);
  if (opts.options) {
    if (opts.options.name != null) comp.name = opts.options.name;
    if (opts.options.exact === true) comp.exact = true;
  }
  let i = opts.endIdx;
  while (i < portion.length && /[\s,]/.test(portion[i])) i++;
  if (portion[i] !== ')') return -1;
  return i + 1;
}

/**
 * Phân tích MỘT locator "sạch" (đúng 1 lời gọi engine, không .filter()/.nth()/...)
 * ở đầu chuỗi `portion`. Trả về { comp, endIdx } hoặc null nếu không sạch/không phù hợp.
 */
function parseCleanLocator(portion, fullSource = '') {
  const m = portion.match(
    /^(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|getByTitle|getByAltText|locator)\(/
  );
  if (!m) return null;
  const engine = m[1];
  const strArg = readStringArg(portion, m[0].length);
  if (!strArg) return null;

  const comp = {
    locatorType: null,
    role: null,
    name: null,
    text: null,
    css: null,
    primefacesId: null,
    exact: false,
    isFrame: false
  };

  if (engine === 'locator') {
    let css = strArg.value;
    // Làm sạch các class hover/focus/active tạm thời do chuột rê sinh ra lúc record
    css = css.replace(/\.ui-state-(?:hover|focus|active)\b/g, '').trim();

    // Nhận diện selector theo ID (#... hoặc [id="..."]) VÀ các component tương tác PrimeFaces (radio, checkbox)
    const isId = /^\[id=/.test(css) || /^#/.test(css);
    const isPrimeFacesInteractive = /\.ui-(?:radiobutton|chkbox)(?:-box|-icon)?\b/.test(css);

    if (!isId && !isPrimeFacesInteractive) return null;

    // ✅ FIXED (FIX 1): Removed bogus context-label heuristic for radio/checkbox.
    // PrimeFaces radio/checkbox are kept as CSS selectors, disambiguated by recording position.
    // The forward/backward 300-char scan produced false labels from surrounding code.

    let i = strArg.endIdx;
    while (i < portion.length && /\s/.test(portion[i])) i++;
    if (portion[i] !== ')') return null;
    comp.locatorType = 'css';
    comp.css = css;
    comp.primefacesId = extractPrimefacesId(css);
    if (isPrimeFacesInteractive) {
      if (css.includes('radiobutton')) comp.role = 'radio';
      else if (css.includes('chkbox')) comp.role = 'checkbox';
    }
    return { comp, endIdx: i + 1 };
  }

  comp.locatorType = GET_BY_MAP[engine];
  if (engine === 'getByRole') {
    comp.role = strArg.value;
  } else if (engine === 'getByText') {
    comp.text = strArg.value;
  } else {
    comp.name = strArg.value;
  }
  const endIdx = consumeGetByTail(portion, strArg.endIdx, comp);
  if (endIdx === -1) return null;
  return { comp, endIdx };
}

// Action Playwright -> mẫu sinh method trong POM.
const POM_ACTION_META = {
  click: { param: null },
  dblclick: { param: null },
  check: { param: null },
  uncheck: { param: null },
  hover: { param: null },
  focus: { param: null },
  tap: { param: null },
  fill: { param: { name: 'value', type: 'string' } },
  type: { param: { name: 'value', type: 'string' } },
  press: { param: { name: 'key', type: 'string' } },
  selectOption: { param: { name: 'value', type: 'string' } }
};

/**
 * Bóc tách "mô hình POM" từ 1 recording: danh sách locator sạch (dedup) kèm frame
 * context và tập action đã ghi lại.
 */
function extractPomModel(source) {
  const frameMatch = source.match(/iframe\[title="([^"]+)"\]/);
  const frameTitle = frameMatch ? frameMatch[1] : null;
  const lines = source.split(/\r?\n/);
  const bySig = new Map();
  const recordedSteps = [];
  const used = new Set(['page', 'frame', 'constructor']);

  let currentRiskAnswerIndex = null;
  let lastCheckboxStepIndex = null;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    const line = raw.trim();
    if (!/^await\s+page\./.test(line)) continue;

    // Skip Microsoft SSO / Login steps (handled exclusively by ensureAuthenticated/ensureInteractiveAuth)
    if (/login\.microsoftonline\.com/.test(line) || /Enter the password/.test(line) || /Sign in/.test(line)) continue;
    // Skip ephemeral navigation URLs (handled by ensureAuthenticated)
    if (/page\.goto\(/.test(line)) continue;

    const actionMatch = line.match(
      /\.(click|dblclick|fill|type|press|check|uncheck|selectOption|hover|focus|tap)\s*\((.*?)\)\s*;?\s*$/
    );
    if (!actionMatch) continue;

    const action = actionMatch[1];
    // Skip redundant keyboard scroll actions on transient Loading headers
    if (action === 'press' && /Loading\.\.\./.test(line)) continue;
    const rawArg = actionMatch[2];
    let value = null;
    if (rawArg) {
      const m = rawArg.match(/^(['"])(.*)\1$/);
      value = m ? m[2] : rawArg.trim();
    }

    const beforeAction = line.slice(0, line.lastIndexOf(actionMatch[0]));
    const isFrame = beforeAction.includes('.contentFrame()');
    let frameSelector = null;
    let locatorPart = beforeAction.replace(/^await\s+page\./, '');

    if (isFrame) {
      // Priority 4: Support multi-level .contentFrame() chains (Task frame -> Modal sub-frame).
      // Outermost frame = before FIRST contentFrame(), locator = after LAST contentFrame().
      const allFrameIdxs = [];
      let _searchPos = 0;
      while (true) {
        const _found = beforeAction.indexOf('.contentFrame()', _searchPos);
        if (_found === -1) break;
        allFrameIdxs.push(_found);
        _searchPos = _found + 1;
      }
      const _firstIdx = allFrameIdxs[0];
      const _lastIdx = allFrameIdxs[allFrameIdxs.length - 1];
      const framePart = beforeAction.slice(0, _firstIdx);
      const selMatch = framePart.match(/\.locator\('([^']+)'\)/) || framePart.match(/\.locator\("([^"]+)"\)/);
      frameSelector = selMatch ? selMatch[1] : (frameTitle ? `iframe[title="${frameTitle}"]` : null);
      locatorPart = beforeAction.slice(_lastIdx + '.contentFrame().'.length);
    }
    locatorPart = locatorPart.replace(/;\s*$/, '').trim();

    // Clean transient hover/focus/active classes
    locatorPart = locatorPart.replace(/\.ui-state-(?:hover|focus|active)\b/g, '');

    let comp = null;
    const parsed = parseCleanLocator(locatorPart, source);
    if (parsed && parsed.endIdx >= locatorPart.length) {
      comp = { ...parsed.comp, chain: '', frameSelector, isFrame };
    } else {
      comp = {
        locatorType: 'raw',
        rawExpr: locatorPart,
        role: null,
        name: null,
        text: null,
        css: null,
        primefacesId: null,
        exact: false,
        isFrame,
        frameSelector,
        chain: ''
      };
      const tm = locatorPart.match(/getByText\(\s*['"]([^'"]+)['"]/);
      if (tm) comp.text = tm[1];
      const rm = locatorPart.match(/getByRole\(\s*['"]([^'"]+)['"](?:\s*,\s*\{\s*name:\s*['"]([^'"]+)['"])/);
      if (rm) { comp.role = rm[1]; comp.name = rm[2]; }
      if (locatorPart.includes('.ui-selectcheckboxmenu-trigger')) {
        const idM = locatorPart.match(/\[id=['"]([^'"]+)['"]\]/);
        if (idM) {
          comp.locatorType = 'css';
          comp.css = `[id="${idM[1]}"] .ui-selectcheckboxmenu-trigger, [id="${idM[1]}"]`;
          comp.name = idM[1].split(':').pop();
          comp.role = 'combobox';
          comp._customMember = camelIdentifier(comp.name) + 'Trigger';
          comp.rawExpr = null;
        }
      }
    }

    // ── Priority 2.5: Enrich sequential PrimeFaces selectonemenu triggers (Questions / riskAnswers) ──
    const riskAnsMatch = line.match(/riskAnswer_(\d+)/);
    if (riskAnsMatch) {
      currentRiskAnswerIndex = parseInt(riskAnsMatch[1], 10);
    } else if (locatorPart.includes('.ui-selectonemenu-trigger') || (locatorPart.includes('gridcell') && /Please select/i.test(line))) {
      const nextRaw = lines[lineIdx + 1] || '';
      if (nextRaw.includes("getByRole('option'")) {
        if (currentRiskAnswerIndex == null) {
          currentRiskAnswerIndex = 0;
        } else if (currentRiskAnswerIndex < 6) {
          currentRiskAnswerIndex += 1;
        }
        comp.locatorType = 'css';
        comp.css = `[id*="riskAnswer_${currentRiskAnswerIndex}"] .ui-selectonemenu-trigger, [id*="riskAnswer_${currentRiskAnswerIndex}_label"], [id*="riskAnswer_${currentRiskAnswerIndex}"]`;
        comp.name = `riskAnswer${currentRiskAnswerIndex}Trigger`;
        comp._customMember = `riskAnswer${currentRiskAnswerIndex}Trigger`;
        comp.rawExpr = null;
      }
    }

    // ── Context Enrichment for PrimeFaces Interactive Elements (Radio / Checkbox) ──
    const isPrimeRadio = comp.role === 'radio' || (comp.css && /.ui-radiobutton/.test(comp.css));
    const isPrimeCheckbox = comp.role === 'checkbox' || (comp.css && /.ui-chkbox/.test(comp.css));

    if (isPrimeRadio && !comp.name) {
      let resolvedLabel = null;
      for (let j = lineIdx + 1; j < Math.min(lines.length, lineIdx + 6); j++) {
        const nextRaw = lines[j];
        const nm = nextRaw.match(/(?:getByRole\('(?:textbox|button|combobox|listbox)',\s*\{\s*name:\s*['"]([^'"]+)['"])/i);
        if (nm) {
          const rawName = nm[1].trim();
          const cleaned = rawName
            .replace(/^(?:Find|Select|Choose|Enter|Search)\s+/i, '')
            .replace(/\s+(?:name|title|code|type|id|selection|dropdown|input|field|box)\b.*$/i, '')
            .trim();
          if (cleaned && cleaned.length >= 3 && /^[A-Z]/.test(cleaned)) {
            resolvedLabel = cleaned;
            break;
          }
        }
        const tm = nextRaw.match(/getBy(?:Text|Label)\(['"]([^'"]+)['"]/);
        if (tm) {
          const t = tm[1].trim();
          if (t.length >= 3 && t.length <= 40 && !/loading|status|error/i.test(t)) {
            resolvedLabel = t;
            break;
          }
        }
      }
      if (!resolvedLabel) {
        for (let j = lineIdx - 1; j >= Math.max(0, lineIdx - 4); j--) {
          const prevRaw = lines[j];
          const tm = prevRaw.match(/getBy(?:Text|Label)\(['"]([^'"]+)['"]/);
          if (tm) {
            const t = tm[1].trim();
            if (t.length >= 3 && t.length <= 40 && !/Start Process|Start|Home/i.test(t)) {
              resolvedLabel = t;
              break;
            }
          }
        }
      }

      if (resolvedLabel) {
        comp.locatorType = 'role';
        comp.name = resolvedLabel;
        comp.role = 'radio';
        comp.exact = true;
        comp._preferRole = true;
      } else {
        comp._stepIndex = lineIdx;
      }
    } else if (isPrimeCheckbox) {
      let isDropdown = false;
      let panelContext = null;
      let panelId = null;
      for (let j = lineIdx - 1; j >= Math.max(0, lineIdx - 4); j--) {
        const prevRaw = lines[j];
        if (/selectcheckboxmenu|selectonemenu/i.test(prevRaw) || /Please select/i.test(prevRaw)) {
          isDropdown = true;
          const idM = prevRaw.match(/\[id=['"]([^'"]+)['"]\]/);
          if (idM) {
            panelId = idM[1];
            panelContext = panelId.split(':').pop();
          } else {
            const pm = prevRaw.match(/(?:Please select|select)\s+([A-Za-z0-9\s]+)/i);
            if (pm) panelContext = pm[1].trim();
          }
          break;
        }
      }
      if (isDropdown) {
        if (panelId) {
          const shortId = panelId.split(':').pop();
          comp.css = `[id*="${shortId}_panel"] .ui-chkbox-box, .ui-selectcheckboxmenu-panel:visible .ui-chkbox-box`;
        } else {
          comp.css = '.ui-selectcheckboxmenu-panel:visible .ui-chkbox-box';
        }
        if (panelContext) {
          comp.name = panelContext;
          comp.role = 'checkbox';
          comp._customMember = camelIdentifier(panelContext) + 'Checkbox';
        }
        comp._stepIndex = lineIdx;
      } else {
        let nearbyLabel = null;
        for (let j = Math.max(0, lineIdx - 5); j <= Math.min(lines.length - 1, lineIdx + 5); j++) {
          const m = lines[j].match(/['"](Confidentiality|Integrity|Availability|Remember me|Accept|Agree)['"]/i);
          if (m) { nearbyLabel = m[1]; break; }
        }
        if (!nearbyLabel) {
          nearbyLabel = 'Confidentiality';
        }
        comp.name = nearbyLabel;
        comp.role = 'checkbox';
        comp._customMember = camelIdentifier(nearbyLabel) + 'Checkbox';
        comp.css = `.ui-selectmanycheckbox td:has-text("${nearbyLabel}") .ui-chkbox-box, [id*="riskTarget"] td:has-text("${nearbyLabel}") .ui-chkbox-box, tr:has-text("${nearbyLabel}") .ui-chkbox-box, .ui-chkbox:has-text("${nearbyLabel}") .ui-chkbox-box`;
      }
    }

    const sig = [
      isFrame ? (frameSelector || 'F') : 'P',
      comp.locatorType,
      comp.rawExpr || '',
      comp.role || '',
      comp.name || comp.text || (comp._stepIndex != null ? `step_${comp._stepIndex}` : ''),
      comp.css || '',
      comp.chain || ''
    ].join('|');

    let entry = bySig.get(sig);
    if (!entry) {
      const baseName = deriveBaseName(comp);
      const member = uniqueName(baseName, used);
      entry = { ...comp, member, actions: new Set(), values: [] };
      bySig.set(sig, entry);
    }

    entry.actions.add(action);
    if (value != null && value !== '' && !entry.values.includes(value)) {
      entry.values.push(value);
    }

    recordedSteps.push({
      member: entry.member,
      action,
      value
    });
  }

  const locators = Array.from(bySig.values());

  return {
    frameTitle,
    hasFrame: locators.some((l) => l.isFrame),
    locators,
    recordedSteps
  };
}

/**
 * Sinh biểu thức locator (không kèm prefix `this.page`/`this.frame`).
 */
/**
 * Detect if a locator name contains an ephemeral BPM task-instance ID
 * (e.g. "RA11359", "APL212475") that changes after each Cancel / Submit.
 * For such names we emit a /regex/i pattern so the locator stays green
 * across re-runs when the system assigns a new task number.
 */
function hasEphemeralId(name) {
  if (!name) return false;
  // Match 4+ consecutive digits optionally preceded by known BPM prefixes.
  return /\b(?:RA|APL|KFWT-?|ASAP-?|TC-?|SR-?|CR-?|CS-?|[A-Z]{2,6}-?)?\d{4,}\b/i.test(name);
}

/**
 * Build a /regex/i pattern for a name containing an ephemeral number.
 * Strategy: use the stable descriptive text that follows the ephemeral ID.
 *
 * "Task start - Prio: NORMAL - Task name: RA11359 - Create risk request for"
 *   => /Create risk request for/i
 */
function stableRegexForEphemeral(name) {
  // If ephemeral ID is embedded anywhere, replace it with a wildcard token
  if (hasEphemeralId(name)) {
    const replaced = name.replace(/\b(?:RA|APL|CS|CR|SR|TC|KFWT|[A-Z]{2,6})?-?\d{4,}\b/gi, '__EPHEMERAL_ID__');
    const esc = replaced
      .replace(/[/\\^$*+?.()|[\]{}]/g, (m) => '\\' + m)
      .replace(/__EPHEMERAL_ID__/g, '[A-Za-z0-9_-]+')
      .replace(/\s+/g, '\\s+');
    return '/' + esc + '/i';
  }
  const afterId = name.replace(/^.*?(?:RA|APL|[A-Z]{1,6}-?)\d{4,}\s*[-:]?\s*/i, '').trim();
  if (afterId.length > 5) {
    const esc = afterId.replace(/[/\\^$*+?.()|[\]{}]/g, (m) => '\\' + m).replace(/\s+/g, '\\s+');
    return '/' + esc + '/i';
  }
  const esc = name.replace(/[/\\^$*+?.()|[\]{}]/g, (m) => '\\' + m).replace(/\d+/g, '\\d+').replace(/\s+/g, '\\s+');
  return '/' + esc + '/i';
}
/**
 * Priority 1: Star Rating recognizer.
 * Converts fragile div:nth-child(N) > a selector into stable .ui-rating-star locator.
 */
function isRatingSelector(raw) {
  return /div:nth-child\(\d+\)\s*>\s*a/i.test(raw || '');
}

function ratingLocatorExpr(raw) {
  const m = (raw || '').match(/div:nth-child\((\d+)\)\s*>\s*a/i);
  if (!m) return null;
  const n = m[1];
  return ".locator('.ui-rating div:nth-child(" + n + ") > a, div:nth-child(" + n + ") > a').first()";
}

function locatorExpr(comp) {
  const t = comp.locatorType;
  if (t === 'raw') {
    // Priority 1: Star Rating — convert nth-child rating selector to semantic form
    if (comp.rawExpr && isRatingSelector(comp.rawExpr)) {
      const re = ratingLocatorExpr(comp.rawExpr);
      if (re) return re;
    }
    let expr = comp.rawExpr || '';
    if (expr && hasEphemeralId(expr)) {
      expr = expr.replace(/\.filter\(\s*\{\s*hasText:\s*['"]([^'"]+)['"]\s*\}\s*\)/g, (match, text) => {
        return `.filter({ hasText: ${stableRegexForEphemeral(text)} })`;
      });
    }
    // Prevent strict mode violations on un-scoped class locators
    if (/^locator\(/.test(expr) && !/\.(first|last|nth)\(/.test(expr) && !/\[id=/.test(expr) && !/^locator\(['"]#/.test(expr)) {
      return '.' + expr + '.first()';
    }
    return '.' + expr;
  }
  // ✅ Priority 0: PrimeFaces radio/checkbox: click via visible <label>, avoiding hidden <input>
  if (comp._preferRole && comp.role && comp.name) {
    if (comp.role === 'radio' || comp.role === 'checkbox') {
      return ".locator('label:has-text(\"" + comp.name.replace(/"/g, '\\"') + "\")').first()";
    }
    return `.getByText(${tsString(comp.name)}, { exact: true })`;
  }
  // Smart PrimeFaces mappings
  if (t === 'role') {
    if (comp.name === 'OK' || comp.member === 'okCell') {
      return `.locator('.ui-dialog:visible button:has-text("OK"), .ui-dialog:visible .ui-button:has-text("OK")').or(this.frame.getByRole('button', { name: 'OK', exact: true })).or(this.frame.getByRole('gridcell', { name: 'OK', exact: true })).first()`;
    }
    if (comp.role === 'button' && /Next|Submit/i.test(comp.name)) {
      return `.getByRole('button', { name: ${tsString(comp.name)} }).filter({ visible: true }).first()`;
    }
    if (comp.role === 'button' && (comp.name === ' ui-button' || /ui-button/i.test(comp.name))) {
      return `.locator('[id*="sendBtn_menuButton"], .ui-splitbutton-menubutton:visible').last()`;
    }
    if (comp.role === 'menuitem' && /save/i.test(comp.name)) {
      return `.locator('[id*="sendBtn_menu"] a:has-text("Save"), .ui-menu:visible a:has-text("Save")').first()`;
    }
    if (comp.role === 'link' && /cancel/i.test(comp.name)) {
      return `.locator('a:visible:has-text("Cancel")').first()`;
    }
    let s = `.getByRole(${tsString(comp.role)}`;
    if (comp.name != null || comp.exact) {
      const parts = [];
      if (comp.name != null) {
        if (hasEphemeralId(comp.name)) {
          parts.push('name: ' + stableRegexForEphemeral(comp.name));
        } else if (comp.role === 'textbox') {
          // Resilient to required asterisk (*) in accessible names like "Risk Title *"
          const escName = comp.name.replace(/[/\\^$*+?.()|[\]{}]/g, (m) => '\\' + m);
          parts.push('name: /^' + escName + '/i');
        } else {
          parts.push(`name: ${tsString(comp.name)}`);
          if (comp.exact) parts.push('exact: true');
        }
      }
      s += `, { ${parts.join(', ')} }`;
    }
    return `${s})`;
  }
  if (t === 'text') {
    if (hasEphemeralId(comp.text)) {
      return `.getByText(${stableRegexForEphemeral(comp.text)})`;
    }
    return comp.exact
      ? `.getByText(${tsString(comp.text)}, { exact: true })`
      : `.getByText(${tsString(comp.text)})`;
  }
  if (t === 'css') {
    const isId = /^\[id=/.test(comp.css) || /^#/.test(comp.css);
    // Priority 1: Star Rating in css locator
    if (isRatingSelector(comp.css)) {
      const re = ratingLocatorExpr(comp.css);
      if (re) return re;
    }
    const expr = `.locator(${tsString(comp.css)})`;
    if (comp.chain) return `${expr}${comp.chain}`;
    if (!isId) return `${expr}.first()`;
    return expr;
  }
  const map = {
    label: 'getByLabel',
    placeholder: 'getByPlaceholder',
    testId: 'getByTestId',
    title: 'getByTitle',
    altText: 'getByAltText'
  };
  const fn = map[t] || 'getByLabel';
  const baseExpr = `.${fn}(${tsString(comp.name)}${comp.exact ? ', { exact: true }' : ''})`;
  return comp.chain ? `${baseExpr}${comp.chain}` : baseExpr;
}

function pascal(member) {
  return member.charAt(0).toUpperCase() + member.slice(1);
}

// Nhận diện locator thuộc form đăng nhập (Username/Password/Login) -- dùng để bỏ
// chúng ra khỏi việc chọn "dashboard entry" và để sinh ensureAuthenticated().
function isLoginLocator(l) {
  if (l.locatorType !== 'role') {
    if (l.css && (l.css.includes('#i0116') || l.css.includes('password') || l.css.includes('passwd'))) return true;
    return false;
  }
  const name = String(l.name || '').trim();
  if (
    l.role === 'textbox' &&
    (/^(username|password|user name|user|email)$/i.test(name) || /enter the password/i.test(name))
  ) {
    return true;
  }
  if (l.role === 'button' && /^(login|log in|sign in|anmelden)$/i.test(name)) return true;
  return false;
}

/**
 * Chọn "dashboard entry locator": phần tử page-level (ngoài iframe) đầu tiên KHÔNG
 * phải form login, ưu tiên role 'link' (thường là link mở process/module). Trả về
 * member hoặc null nếu recording không có phần tử page-level phù hợp.
 */
function pickEntryMember(pageLocators) {
  const candidates = pageLocators.filter((l) => {
    if (isLoginLocator(l)) return false;
    // Exclude dynamic BPM task links that change each run (RA/APL/RAMP IDs)
    const name = String(l.name || l.text || '').trim();
    if (/\b(?:RA|APL|RAMP)\d*\b/i.test(name)) return false;
    if (/Task start|Prio:|Category:|Responsible:|Created:/i.test(name)) return false;
    if (l.rawExpr && /faces\/instances\//.test(l.rawExpr)) return false;
    return true;
  });
  const link = candidates.find((l) => l.locatorType === 'role' && l.role === 'link');
  const chosen = link || candidates[0] || null;
  return chosen ? chosen.member : null;
}

/**
 * Render toàn bộ nội dung file Page Object Model (TypeScript, strict-safe).
 */
function renderPomClass(pageClass, key, recordingRel, model, baseFallback, supportImport) {
  const { hasFrame, frameTitle, locators } = model;
  const pageLocators = locators.filter((l) => !l.isFrame && !isLoginLocator(l));
  const frameLocators = locators.filter((l) => l.isFrame);
  const entryMember = pickEntryMember(pageLocators);
  const baseLiteral = tsString(baseFallback || '');

  // expect là value import (không phải type) -- cần cho ensureAuthenticated().
  const imports = ['Page'];
  if (hasFrame) imports.push('FrameLocator');
  imports.push('Locator');
  imports.push('expect');

  const lines = [];
  lines.push(`import { ${imports.join(', ')} } from '@playwright/test';`);
  lines.push(`import { ensureInteractiveAuth } from '${supportImport || '../support/interactive-auth'}';`);
  const authImportPath = supportImport || '../support/interactive-auth';
  const smartImportPath = authImportPath.replace('interactive-auth', 'smart-action');
  lines.push(`import { smartClick, smartFill, smartPress } from '${smartImportPath}';`);
  lines.push('');
  lines.push('// Credentials come from the environment (.env via playwright.config.ts) so no secret is');
  lines.push('// baked into source. Override per-call by passing arguments to ensureAuthenticated().');
  lines.push('const PORTAL_USERNAME = process.env.TEST_USERNAME || \'\';');
  lines.push('const PORTAL_PASSWORD = process.env.TEST_PASSWORD || \'\';');
  lines.push('// Stable entry URL fallback (recorded ephemeral /faces/instances/... segments stripped).');
  lines.push('// process.env.BASE_URL always takes priority at runtime.');
  lines.push(`const BASE_URL_FALLBACK = ${baseLiteral};`);
  lines.push('');
  lines.push('/**');
  lines.push(` * Page Object Model for the "${key}" module.`);
  lines.push(' *');
  lines.push(` * AUTO-GENERATED by \`npm run sync-specs ${key}\` (scripts/sync-specs.js) from the real`);
  lines.push(` * Playwright codegen recording \`${recordingRel}\`. Every locator below was exercised`);
  lines.push(' * end-to-end on the live application, so it reflects the actual DOM.');
  lines.push(' *');
  lines.push(' * This is a clean STARTER POM: locators are deduplicated and named; recorded actions');
  lines.push(' * are exposed as thin methods. Feel free to compose these into higher-level semantic');
  lines.push(' * flows. Re-run with `--force-pom` to regenerate (this overwrites custom edits).');
  lines.push(' */');
  lines.push(`export class ${pageClass} {`);
  lines.push('  readonly page: Page;');
  for (const l of pageLocators) {
    lines.push(`  readonly ${l.member}: Locator;`);
  }
  lines.push('');
  lines.push('  constructor(page: Page) {');
  lines.push('    this.page = page;');
  for (const l of pageLocators) {
    lines.push(`    this.${l.member} = page${locatorExpr(l)};`);
  }
  // FIX 3: Emit dialog auto-handler into generated POM constructor
  lines.push("    // Auto-dismiss browser dialogs (alert, confirm, beforeunload)");
  lines.push("    this.page.on('dialog', async (dialog) => {");
  lines.push("      console.log('[Auto-Dialog] ' + dialog.type() + ': ' + dialog.message().slice(0, 120));");
  lines.push("      await dialog.accept().catch(() => {});");
  lines.push('    });');
  lines.push('  }');

  // ── ensureAuthenticated(): resilient to "View Expired" / expired sessions ──
  lines.push('');
  lines.push('  /**');
  lines.push('   * Ensure the session is authenticated and the module entry point is reachable,');
  lines.push('   * gracefully recovering from a "View Expired" page or an expired session.');
  lines.push('   *');
  lines.push('   * Never depends on a recorded ephemeral instance URL: it (re)navigates to the');
  lines.push('   * STABLE base URL (process.env.BASE_URL, else BASE_URL_FALLBACK), logs in when a');
  lines.push('   * login form is shown, and finally waits for the entry point to be visible.');
  lines.push('   */');
  lines.push('  async ensureAuthenticated(');
  lines.push('    username: string = PORTAL_USERNAME,');
  lines.push('    password: string = PORTAL_PASSWORD');
  lines.push('  ): Promise<void> {');
  lines.push(
    "    const baseUrl = (process.env.BASE_URL || BASE_URL_FALLBACK).replace(/\\/+$/, '') + '/';"
  );
  lines.push('');
  lines.push('    // 🔐 SSO/MFA hand-off: khi chạy `npm run test:function` (INTERACTIVE_SSO=1), nếu');
  lines.push('    // gặp trang đăng nhập Microsoft SSO/MFA thì DỪNG chờ Tester đăng nhập thủ công,');
  lines.push('    // rồi tự lưu .auth/user.json và chạy tiếp (ASAP không thể tự bypass authen).');
  lines.push("    if (process.env.INTERACTIVE_SSO === '1') {");
  if (entryMember) {
    lines.push(`      await ensureInteractiveAuth(this.page, { baseUrl, readyLocator: this.${entryMember} });`);
  } else {
    lines.push('      await ensureInteractiveAuth(this.page, { baseUrl });');
  }
  lines.push('      return;');
  lines.push('    }');
  lines.push('');
  if (entryMember) {
    // Robust against the portal's client-side redirect chain: after goto(), the login
    // form is NOT visible immediately. Each attempt waits for the page to SETTLE on
    // either the login form or the entry point (whichever wins the race) before acting.
    lines.push('    await this.page.goto(baseUrl);');
    lines.push('    for (let attempt = 0; attempt < 3; attempt++) {');
    lines.push('      await Promise.race([');
    lines.push(
      "        this.page.getByRole('textbox', { name: 'Username' }).waitFor({ state: 'visible', timeout: 30000 }),"
    );
    lines.push(`        this.${entryMember}.waitFor({ state: 'visible', timeout: 30000 })`);
    lines.push('      ]).catch(() => undefined);');
    lines.push(`      if (await this.${entryMember}.isVisible().catch(() => false)) {`);
    lines.push('        return; // Already authenticated on the entry point.');
    lines.push('      }');
    lines.push(
      "      const usernameField = this.page.getByRole('textbox', { name: 'Username' });"
    );
    lines.push('      if (!(await usernameField.isVisible().catch(() => false))) {');
    lines.push('        continue; // Neither settled yet: retry the wait.');
    lines.push('      }');
    lines.push('      await usernameField.fill(username);');
    lines.push("      await this.page.getByRole('textbox', { name: 'Password' }).fill(password);");
    lines.push("      await this.page.getByRole('button', { name: 'Login' }).click();");
    lines.push(
      `      if (await this.${entryMember}.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false)) {`
    );
    lines.push('        return;');
    lines.push('      }');
    lines.push('    }');
    lines.push(`    await expect(this.${entryMember}).toBeVisible({ timeout: 15000 });`);
  } else {
    lines.push('    await this.page.goto(baseUrl);');
    lines.push("    const usernameField = this.page.getByRole('textbox', { name: 'Username' });");
    lines.push('    if (await usernameField.isVisible({ timeout: 5000 }).catch(() => false)) {');
    lines.push('      await usernameField.fill(username);');
    lines.push("      await this.page.getByRole('textbox', { name: 'Password' }).fill(password);");
    lines.push("      await this.page.getByRole('button', { name: 'Login' }).click();");
    lines.push("      await usernameField.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});");
    lines.push('    }');
    lines.push("    await this.page.waitForLoadState('domcontentloaded');");
    lines.push("    await this.page.waitForLoadState('networkidle').catch(() => {});");
  }
  // FIX 4: Emit iframe scroll-fix CSS into ensureAuthenticated
  lines.push("    // Unlock Axon Ivy iframe overflow so all form buttons are reachable");
  lines.push("    await this.page.addStyleTag({");
  lines.push("      content: 'iframe[title=\"Task frame\"], .portal-page-body, .ui-layout-unit-content { overflow: auto !important; max-height: none !important; }'");
  lines.push('    }).catch(() => {});');
  lines.push('  }');

  if (hasFrame && frameTitle) {
    lines.push('');
    lines.push('  /** FrameLocator for the portal task iframe that hosts this module. */');
    lines.push('  get frame(): FrameLocator {');
    lines.push(`    return this.page.frameLocator(${tsString(`iframe[title="${frameTitle}"]`)});`);
    lines.push('  }');
  }

  for (const l of frameLocators) {
    lines.push('');
    lines.push(`  get ${l.member}(): Locator {`);
    if (l.frameSelector && /custom-widget-iframe/.test(l.frameSelector)) {
      lines.push(`    return this.page.frameLocator('iframe[name*="custom-widget"], iframe[src*="CustomMenuWidget"]').locator('a.ui-menuitem-link:has-text("Start Process")').first();`);
    } else if (l.frameSelector && frameTitle && l.frameSelector === `iframe[title="${frameTitle}"]`) {
      lines.push(`    return this.frame${locatorExpr(l)};`);
    } else if (l.frameSelector) {
      lines.push(`    return this.page.frameLocator(${tsString(l.frameSelector)})${locatorExpr(l)};`);
    } else {
      lines.push(`    return this.frame${locatorExpr(l)};`);
    }
    lines.push('  }');
    if (l.member && /^anth\d+/i.test(l.member)) {
      const starNum = l.member.replace(/^anth/i, '');
      lines.push('');
      lines.push(`  /** Semantic alias for ${l.member} */`);
      lines.push(`  get ratingStar${starNum}(): Locator {`);
      lines.push(`    return this.${l.member};`);
      lines.push('  }');
    }
  }

  // Helper: waitForAjax
  lines.push('');
  lines.push('  /**');
  lines.push('   * Wait for Axon Ivy / PrimeFaces global AJAX loading overlay to settle.');
  lines.push('   * Safe to call anytime; resolves immediately if no loader is active.');
  lines.push('   */');
  lines.push('  async waitForAjax(timeout: number = 20000): Promise<void> {');
  lines.push('    await this.page.waitForTimeout(250).catch(() => {});');
  lines.push('    try {');
  lines.push('      await this.page.waitForFunction(() => {');
  lines.push('        const w = window as any;');
  lines.push('        const jqDone = w.$ ? w.$.active === 0 : true;');
  lines.push('        const pfDone = w.PrimeFaces?.ajax?.Queue ? w.PrimeFaces.ajax.Queue.isEmpty() : true;');
  lines.push('        return jqDone && pfDone;');
  lines.push('      }, { timeout: Math.min(timeout, 10000) }).catch(() => {});');
  lines.push('    } catch (_) {}');
  lines.push("    const indicator = this.page.locator('.ajax-status-position, [id*=\"ajax-indicator-ajax-indicator\"]').first();");
  lines.push("    await indicator.waitFor({ state: 'hidden', timeout }).catch(() => {});");
  lines.push('  }');

  // Priority 2: File Upload helper
  if (hasFrame) {
    lines.push('');
    lines.push('  /**');
    lines.push('   * Priority 2 - File Upload (p:fileUpload):');
    lines.push('   * Playwright Codegen cannot capture native OS File Picker dialogs.');
    lines.push('   * Use setInputFiles() on the hidden input[type="file"] instead.');
    lines.push('   * @param fileInput  Locator for input[type="file"] inside the iframe.');
    lines.push('   * @param filePath   Absolute path to the file to upload.');
    lines.push('   */');
    lines.push('  async uploadFile(fileInput: Locator, filePath: string): Promise<void> {');
    lines.push('    await fileInput.setInputFiles(filePath);');
    lines.push('    await this.waitForAjax();');
    lines.push('  }');
  }

  // Priority 3: Dropdown helper
  if (hasFrame) {
    lines.push('');
    lines.push('  /**');
    lines.push('   * Priority 3 - Custom Dropdown / Autocomplete (p:selectOneMenu, p:autoComplete):');
    lines.push('   * Replaces fragile ArrowDown×N + Enter recordings with text-based click.');
    lines.push('   * The panel is appended to <body> outside the iframe, targeted from page level.');
    lines.push('   * @param triggerLocator  Dropdown label locator inside the iframe.');
    lines.push('   * @param optionText       Visible text of the option to select.');
    lines.push('   */');
    lines.push('  async selectDropdownOption(triggerLocator: Locator, optionText: string): Promise<void> {');
    lines.push('    await triggerLocator.click();');
    lines.push("    const panel = this.page.locator('.ui-selectonemenu-panel:visible, .ui-autocomplete-panel:visible').last();");
    lines.push("    await panel.waitFor({ state: 'visible', timeout: 10000 });");
    lines.push("    await panel.locator('.ui-selectonemenu-item, .ui-autocomplete-item').filter({ hasText: optionText }).first().click();");
    lines.push('    await this.waitForAjax();');
    lines.push('  }');
  }

  // Priority 5: DatePicker helper
  if (hasFrame) {
    lines.push('');
    lines.push('  /**');
    lines.push('   * Priority 5 - Date Picker (p:calendar / p:datePicker):');
    lines.push('   * fill+Tab is safer than clicking the popup to avoid Strict Mode Violation');
    lines.push('   * when the same day number appears in adjacent months.');
    lines.push('   * @param inputLocator  Calendar text input locator inside the iframe.');
    lines.push('   * @param dateStr        Date string in the format expected (e.g. "31/12/2025").');
    lines.push('   */');
    lines.push('  async fillDate(inputLocator: Locator, dateStr: string): Promise<void> {');
    lines.push('    await inputLocator.fill(dateStr);');
    lines.push("    await inputLocator.press('Tab');  // Trigger PrimeFaces AJAX date mask");
    lines.push('    await this.waitForAjax();');
    lines.push('  }');
  }

  // Priority 6: Virtual Scroll helper
  if (hasFrame) {
    lines.push('');
    lines.push('  /**');
    lines.push('   * Priority 6 - Virtual Scroll / Lazy DataTable:');
    lines.push('   * Mouse-wheel scroll is NOT captured by Playwright Codegen.');
    lines.push('   * Call before interacting with rows in a lazy/virtual-scroll table.');
    lines.push('   * @param rowLocator  Target row or cell locator inside the DataTable.');
    lines.push('   */');
    lines.push('  async scrollTableRowIntoView(rowLocator: Locator): Promise<void> {');
    lines.push('    await rowLocator.scrollIntoViewIfNeeded();');
    lines.push('  }');
  }

  let methodCount = 0;
  for (const l of locators) {
    if (isLoginLocator(l)) continue;
    const actions = Array.from(l.actions).sort();
    for (const action of actions) {
      const meta = POM_ACTION_META[action];
      if (!meta) continue;
      methodCount += 1;
      const methodName = `${action}${pascal(l.member)}`;
      const param = meta.param ? `${meta.param.name}: ${meta.param.type}` : '';
      const callArg = meta.param ? meta.param.name : '';
      lines.push('');
      lines.push(`  async ${methodName}(${param}): Promise<void> {`);
      if (/okCell|clickOk|dblclickOk/i.test(methodName) || (l.name === 'OK')) {
        lines.push("    await this.waitForAjax();");
        lines.push("    const okBtn = this.frame.locator('.ui-dialog:visible button:has-text(\"OK\"), .ui-dialog:visible .ui-button:has-text(\"OK\"), .ui-dialog:visible [role=\"button\"]:has-text(\"OK\")').first();");
        lines.push("    if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {");
        lines.push("      await okBtn.click({ force: true, timeout: 5000 }).catch(() => {});");
        lines.push("    } else {");
        lines.push(`      await this.${l.member}.click({ force: true, timeout: 5000 }).catch(() => {});`);
        lines.push("    }");
        lines.push("    const _diag = this.frame.locator('.ui-dialog:visible');");
        lines.push("    const _closed = await _diag.waitFor({ state: 'hidden', timeout: 4000 }).then(() => true).catch(() => false);");
        lines.push("    if (!_closed && await _diag.isVisible().catch(() => false)) {");
        lines.push("      await this.waitForAjax();");
        lines.push("      await okBtn.click({ force: true, timeout: 5000 }).catch(() => {});");
        lines.push("      await _diag.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});");
        lines.push("    }");
        lines.push("    await this.waitForAjax();");
        lines.push("    return;");
        lines.push("  }");
        continue;
      }
      if (action === 'click') {
        lines.push("    const ajaxIndicator = this.page.locator('.ajax-status-position, [id*=\"ajax-indicator-ajax-indicator\"]').first();");
        lines.push("    await ajaxIndicator.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});");
      }
      if (action === 'click' && l.role === 'radio' && l.name) {
        lines.push(`    await this.${l.member}.scrollIntoViewIfNeeded().catch(() => {});`);
        const _radioName = (l.name || l.text || l.member || '').replace(/'/g, "\\'");
        const _radioFrame = l.isFrame ? ', frame: this.frame' : '';
        lines.push(`    await smartClick(this.${l.member}, { name: '${_radioName}', role: 'radio'${_radioFrame} });`);
        lines.push('    return;');
        lines.push('  }');
        continue;
      }
      if (action === 'click' && l.frameSelector && /custom-widget-iframe/.test(l.frameSelector)) {
        // FIX 5: 3-layer menu open strategy
        // Playwright Codegen only records the final click, missing hover steps for collapsed menus.
        lines.push("    // [L1] Skip if Task frame already visible (resumed session)");
        lines.push("    const _tf = this.page.frameLocator('iframe[title=\"Task frame\"]');");
        lines.push("    if (await _tf.locator('body').isVisible({ timeout: 2000 }).catch(() => false)) return;");
        lines.push("    // [L2] Wait for widget iframe + body to be rendered");
        lines.push("    await this.page.locator('iframe[name*=\"custom-widget\"], iframe[src*=\"CustomMenuWidget\"], iframe[title*=\"processes\"]').first().waitFor({ state: 'attached', timeout: 60000 }).catch(() => {});");
        lines.push("    const _wf = this.page.frameLocator('iframe[name*=\"custom-widget\"], iframe[src*=\"CustomMenuWidget\"]');");
        lines.push("    await _wf.locator('body').waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});");
        lines.push("    await this.page.locator('.ajax-status-position').first().waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});");
        lines.push("    // [L3] Click Start Process directly if already visible, otherwise hover parent items");
        lines.push("    const _sp = _wf.getByRole('menuitem', { name: 'Start Process' }).or(_wf.locator('a.ui-menuitem-link:has-text(\"Start Process\")')).first();");
        lines.push("    const isDirectlyVisible = await _sp.isVisible({ timeout: 3000 }).catch(() => false);");
        lines.push("    if (!isDirectlyVisible) {");
        lines.push("      const _sm = _wf.getByRole('menuitem', { name: /^Start/i }).first();");
        lines.push("      if (await _sm.isVisible({ timeout: 5000 }).catch(() => false)) {");
        lines.push("        await _sm.hover({ force: true }).catch(() => {});");
        lines.push("        await this.page.waitForTimeout(500);");
        lines.push("      }");
        lines.push("      const _rs = _wf.getByRole('menuitem', { name: /Risk Assessment/i }).first();");
        lines.push("      if (await _rs.isVisible({ timeout: 3000 }).catch(() => false)) {");
        lines.push("        await _rs.hover({ force: true }).catch(() => {});");
        lines.push("        await this.page.waitForTimeout(500);");
        lines.push("      }");
        lines.push("    }");
        lines.push("    // [L4] Execute click with multiple fallbacks");
        lines.push("    await _sp.click({ force: true, timeout: 10000 }).catch(async () => {");
        lines.push("      await _wf.locator('a').filter({ hasText: 'Start Process' }).first().click({ force: true, timeout: 5000 }).catch(async () => {");
        lines.push("        await _wf.locator('a').filter({ hasText: 'Start Process' }).first().evaluate((el: any) => el.click()).catch(() => {});");
        lines.push("      });");
        lines.push("    });");
        lines.push("    await _tf.locator('body').waitFor({ state: 'visible', timeout: 60000 });");
        lines.push('    return;');
        lines.push('  }'); // Close generated async method
        continue; // Skip rest of loop iteration (no default click needed)
      }
      // Priority 6: scrollIntoView for gridcell (Virtual Scroll DataTable rows)
      if (action === 'click' && (l.role === 'gridcell' || (l.rawExpr && l.rawExpr.includes("'gridcell'")) || /gridcell|cell/i.test(l.member))) {
        lines.push(`    await this.${l.member}.scrollIntoViewIfNeeded().catch(() => {});`);
      }
      if (action === 'press') {
        const _pressName = (l.name || l.text || l.member || '').replace(/'/g, "\\'");
        lines.push(`    await smartPress(this.${l.member}, ${callArg}, { name: '${_pressName}' });`);
      } else if (action === 'click') {
        const _clickName = (l.name || l.text || l.member || '').replace(/'/g, "\\'");
        const _clickRole = (l.role || '').replace(/'/g, "\\'");
        const _clickFrame = l.isFrame ? `, frame: this.frame` : '';
        lines.push(`    await smartClick(this.${l.member}, { name: '${_clickName}', role: '${_clickRole}'${_clickFrame} });`);
        if (/cell|gridcell/i.test(l.member) || l.role === 'gridcell') {
          lines.push('    await this.waitForAjax();');
        }
        if (/Ok|Confirm|Close|Dismiss/i.test(_clickName || l.member)) {
          lines.push("    await this.frame.locator('.ui-dialog:visible').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});");
          lines.push('    await this.waitForAjax();');
        } else if (/Next|Submit|Save|Finish/i.test(_clickName || l.member)) {
          lines.push('    await this.waitForAjax();');
        }
        if (/Trigger$/i.test(l.member) || /ui-selectonemenu-trigger/i.test(l.css || '')) {
          lines.push("    await this.frame.locator('.ui-selectonemenu-panel:visible').waitFor({ state: 'visible', timeout: 7000 }).catch(() => {});");
        }
        if (/Checkbox$|Listitem$/i.test(l.member) || l.role === 'listitem') {
          lines.push("    const _closeMenu = this.frame.locator('.ui-selectcheckboxmenu-panel:visible .ui-selectcheckboxmenu-close, .ui-selectcheckboxmenu-panel:visible a[aria-label=\"Close\"]').first();");
          lines.push("    if (await _closeMenu.isVisible({ timeout: 1000 }).catch(() => false)) {");
          lines.push("      await _closeMenu.click({ force: true, timeout: 2000 }).catch(() => {});");
          lines.push("    } else {");
          lines.push("      await this.page.keyboard.press('Escape').catch(() => {});");
          lines.push("    }");
        }
      } else if (action === 'fill') {
        const _fillName = (l.name || l.text || l.member || '').replace(/'/g, "\\'");
        const _fillRole = (l.role || 'textbox').replace(/'/g, "\\'");
        const _fillFrame = l.isFrame ? `, frame: this.frame` : '';
        lines.push(`    await this.${l.member}.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});`);
        lines.push(`    await smartFill(this.${l.member}, ${callArg}, { name: '${_fillName}', role: '${_fillRole}'${_fillFrame} });`);
      } else if (action === 'dblclick') {
        lines.push(`    await this.${l.member}.dblclick();`);
        lines.push("    const _activeDiag = this.frame.locator('.ui-dialog:visible');");
        lines.push("    if (await _activeDiag.isVisible().catch(() => false)) {");
        lines.push("      await _activeDiag.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});");
        lines.push("      await this.waitForAjax();");
        lines.push("    }");
      } else {
        lines.push(`    await this.${l.member}.${action}(${callArg});`);
      }
      lines.push('  }');
      if (action === 'click' && l.member && /^anth\d+/i.test(l.member)) {
        const starNum = l.member.replace(/^anth/i, '');
        lines.push('');
        lines.push(`  /** Semantic alias for ${methodName} */`);
        lines.push(`  async clickRatingStar${starNum}(): Promise<void> {`);
        lines.push(`    await this.${methodName}();`);
        lines.push('  }');
      }
    }
    if (l.member && l.member.endsWith('LabelElement')) {
      const clean = l.member.replace(/LabelElement$/, '');
      const optMethod = 'select' + clean.charAt(0).toUpperCase() + clean.slice(1) + 'Option';
      lines.push('');
      lines.push('  /**');
      lines.push(`   * Priority 3 Semantic Helper: Select option by visible text for ${l.member}.`);
      lines.push('   * Replaces fragile ArrowDown + Enter sequence with direct option click.');
      lines.push('   */');
      lines.push(`  async ${optMethod}(optionText: string): Promise<void> {`);
      lines.push(`    await this.selectDropdownOption(this.${l.member}, optionText);`);
      lines.push('  }');
    }
  }

  lines.push('}');
  lines.push('');
  return { code: lines.join('\n'), methodCount };
}

/**
 * Sinh (đóng gói) file Page Object Model chuẩn từ recording của KEY.
 * options.force = true -> ghi đè file POM đã tồn tại.
 */
function generatePom(key, { force = false } = {}) {
  const pageClass = toPascalCasePageName(key);
  const { isFunction, recordingFull, recordingRel } = resolveRecording(key);
  const outDir = isFunction ? PAGES_FUNCTIONS_DIR : PAGES_DIR;
  const outRel = isFunction ? `tests/pages/functions/${pageClass}.ts` : `tests/pages/${pageClass}.ts`;
  const outFull = path.join(outDir, `${pageClass}.ts`);

  if (!fs.existsSync(recordingFull)) return { status: 'missing', outRel, pageClass, recordingRel };
  const source = fs.readFileSync(recordingFull, 'utf-8');
  if (!hasRealInteractions(source)) return { status: 'empty', outRel, pageClass, recordingRel };

  const model = extractPomModel(source);
  if (!model.locators.length) return { status: 'no-locators', outRel, pageClass, recordingRel };

  const existed = fs.existsSync(outFull);
  if (existed && !force) {
    // Keep the curated POM, but still make sure the proxy stays valid for Nhóm 2.
    return { status: 'exists', outRel, pageClass, recordingRel, isFunction, locatorCount: model.locators.length };
  }

  const { code, methodCount } = renderPomClass(
    pageClass,
    key,
    recordingRel,
    model,
    cleanseEntryUrl(extractEntryUrl(source)),
    isFunction ? '../../support/interactive-auth' : '../support/interactive-auth'
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFull, code, 'utf-8');

  return {
    status: existed ? 'overwritten' : 'created',
    outRel,
    pageClass,
    recordingRel,
    isFunction,
    locatorCount: model.locators.length,
    methodCount
  };
}

const E2E_DIR = path.join(ROOT_DIR, 'tests', 'e2e');
const E2E_FUNCTIONS_DIR = path.join(E2E_DIR, 'functions');

/**
 * Chuẩn hoá KEY -> tiêu đề đọc được cho describe block ("SEARCH_TELECONTROL" ->
 * "Search Telecontrol").
 */
function toTitle(key) {
  return String(key || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/**
 * Render nội dung file starter E2E spec (TypeScript) từ model của recording.
 * Spec import Page Object đã sinh, điều hướng qua process.env.BASE_URL, gọi
 * ensureAuthenticated() rồi thực thi các action đã ghi với assertion an toàn.
 */
function renderSpecFile(pageClass, key, recordingRel, model, baseFallback, importSpecifier) {
  const { locators } = model;
  const pageLocators = locators.filter((l) => !l.isFrame);
  const frameLocators = locators.filter((l) => l.isFrame);
  const entryMember = pickEntryMember(pageLocators);
  const entryLocator = pageLocators.find((l) => l.member === entryMember) || null;

  // Method điều hướng vào module: click trên entry link (nếu có action click).
  let navigateMethod = null;
  if (entryLocator && entryLocator.actions && entryLocator.actions.has('click')) {
    navigateMethod = `click${pascal(entryMember)}`;
  }
  // Phần tử "trong module" để assert sau khi mở (ưu tiên locator trong iframe).
  const moduleMember = frameLocators.length
    ? frameLocators[0].member
    : (pageLocators.find((l) => !isLoginLocator(l) && l.member !== entryMember) || {}).member || null;

  const title = toTitle(key);
  const inst = 'pom';
  const L = [];
  L.push("import { test, expect } from '@playwright/test';");
  L.push(`import { ${pageClass} } from '${importSpecifier || `../pages/${pageClass}`}';`);
  L.push('');
  L.push('/**');
  L.push(` * TC-${key}: clean STARTER E2E spec.`);
  L.push(' *');
  L.push(` * AUTO-GENERATED (0 AI tokens, local CPU) by \`npm run sync-specs ${key}\``);
  L.push(` * (scripts/sync-specs.js) from the real Playwright recording \`${recordingRel}\`.`);
  L.push(' *');
  L.push(` * It authenticates via ${pageClass}.ensureAuthenticated() (which resolves the stable`);
  L.push(' * process.env.BASE_URL and recovers from a "View Expired" page), then exercises the');
  L.push(' * recorded actions with safe visibility assertions. Extend it with real business');
  L.push(' * assertions; re-run with `--force-spec` to regenerate (this overwrites custom edits).');
  L.push(' */');
  L.push(`const BASE_URL = (process.env.BASE_URL || ${tsString(baseFallback || '')}).replace(/\\/+$/, '') + '/';`);
  L.push('');
  L.push(`test.describe('TC-${key}: ${title} (starter)', () => {`);
  L.push(`  test('TC-${key}-01: authenticate and reach the module entry point', async ({ page }) => {`);
  L.push(`    const ${inst} = new ${pageClass}(page);`);
  L.push('');
  L.push("    await test.step('Given the tester opens the stable base URL and authenticates', async () => {");
  L.push('      await page.goto(BASE_URL);');
  L.push(`      await ${inst}.ensureAuthenticated();`);
  L.push('    });');
  if (entryMember) {
    L.push('');
    L.push("    await test.step('Then the module entry point is visible', async () => {");
    L.push(`      await expect(${inst}.${entryMember}).toBeVisible();`);
    L.push('    });');
  }
  if (navigateMethod && moduleMember) {
    L.push('');
    L.push("    await test.step('When the tester opens the module', async () => {");
    L.push(`      await ${inst}.${navigateMethod}();`);
    L.push('    });');
    L.push('');
    L.push("    await test.step('Then a module element is displayed', async () => {");
    L.push(`      await expect(${inst}.${moduleMember}).toBeVisible();`);
    L.push('    });');
  }
  L.push('  });');
  L.push('});');
  L.push('');

  // Scaffold liệt kê mọi action method đã sinh để Tester dễ soạn flow nghiệp vụ thật.
  L.push('// ── Recorded action methods available on ' + pageClass + ' (compose real flows) ──');
  for (const l of locators) {
    const actions = Array.from(l.actions).sort();
    for (const action of actions) {
      const meta = POM_ACTION_META[action];
      if (!meta) continue;
      const arg = meta.param ? `<${meta.param.name}>` : '';
      L.push(`//   await ${inst}.${action}${pascal(l.member)}(${arg});`);
    }
  }
  L.push('');
  return L.join('\n');
}

/**
 * Sinh (đóng gói) starter E2E spec cho KEY. Non-destructive guard: KHÔNG ghi đè
 * file spec đã tồn tại trừ khi options.force = true (--force-spec).
 */
function generateSpec(key, { force = false } = {}) {
  const pageClass = toPascalCasePageName(key);
  const { isFunction, recordingFull, recordingRel } = resolveRecording(key);
  const specDir = isFunction ? E2E_FUNCTIONS_DIR : E2E_DIR;
  const specRel = isFunction ? `tests/e2e/functions/TC-${key}.spec.ts` : `tests/e2e/TC-${key}.spec.ts`;
  const specFull = path.join(specDir, `TC-${key}.spec.ts`);
  // Function specs live one level deeper (tests/e2e/functions/), so the POM import
  // resolves through tests/pages/functions/<Class>.ts
  // '../../pages/<Class>' working, but we point straight at the real file).
  const importSpecifier = isFunction ? `../../pages/functions/${pageClass}` : `../pages/${pageClass}`;
  const pomFull = isFunction
    ? path.join(PAGES_FUNCTIONS_DIR, `${pageClass}.ts`)
    : path.join(PAGES_DIR, `${pageClass}.ts`);

  if (!fs.existsSync(recordingFull)) return { status: 'missing', specRel, pageClass, recordingRel };
  const source = fs.readFileSync(recordingFull, 'utf-8');
  if (!hasRealInteractions(source)) return { status: 'empty', specRel, pageClass, recordingRel };

  const model = extractPomModel(source);
  if (!model.locators.length) return { status: 'no-locators', specRel, pageClass, recordingRel };

  // Spec import Page Object -> cần POM tồn tại để biên dịch được.
  if (!fs.existsSync(pomFull)) return { status: 'no-pom', specRel, pageClass, recordingRel };

  const existed = fs.existsSync(specFull);
  if (existed && !force) {
    return { status: 'exists', specRel, pageClass, recordingRel };
  }

  const code = renderSpecFile(
    pageClass,
    key,
    recordingRel,
    model,
    cleanseEntryUrl(extractEntryUrl(source)),
    importSpecifier
  );
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(specFull, code, 'utf-8');

  return { status: existed ? 'overwritten' : 'created', specRel, pageClass, recordingRel };
}

const TESTCASES_DIR = path.join(ROOT_DIR, 'tests', 'testcases');
const TESTCASES_FUNCTIONS_DIR = path.join(TESTCASES_DIR, 'functions');

/**
 * Render 1 dòng "call" trong khối ```automation``` từ 1 action đã ghi. Với
 * fill/type/press/selectOption sẽ chèn sẵn giá trị thật đã record (nếu có) để
 * Tester chỉ việc chỉnh, còn click/hover... thì không cần tham số.
 */
function renderAutomationCall(member, action, values) {
  const meta = POM_ACTION_META[action];
  if (!meta) return null;
  const methodName = `${action}${pascal(member)}`;
  if (!meta.param) return methodName;
  const sample = Array.isArray(values) && values.length ? values[0] : '';
  return `${methodName} ${JSON.stringify(sample)}`;
}

/**
 * Render nội dung file kịch bản Markdown (BDD) cho 1 KEY từ model của recording.
 *
 * File gồm 2 phần:
 *   1. Phần văn xuôi Given/When/Then để Tester đọc & mô tả nghiệp vụ (KHÔNG parse).
 *   2. Khối ```automation``` MÁY ĐỌC ĐƯỢC -- đây mới là nguồn được
 *      `npm run md-to-spec <KEY>` dịch ra file .spec.ts (0 token, không gọi AI).
 *
 * Khối automation được điền sẵn từ recording nên chạy được ngay; Tester chỉ cần
 * chỉnh sửa (thêm/bớt/đổi giá trị) rồi chạy md-to-spec để sinh lại spec.
 */

/**
 * 🧹 Intelligent Step Cleaner Pipeline:
 * Cleans recording noise and tester mistakes before generating BDD and Spec:
 * 1. Prunes redundant click right before fill on the same input element.
 * 2. Deduplicates consecutive duplicate clicks on checkboxes/toggles and dropdown options.
 * 3. Prunes premature Next/Submit clicks caused by tester realizing a field was missed.
 */
function cleanRecordedSteps(steps, locators) {
  if (!steps || !steps.length) return [];
  const locMap = new Map((locators || []).map((l) => [l.member, l]));
  let result = [...steps];

  // Pass 1: Prune click immediately before fill on the SAME member
  const pass1 = [];
  for (let i = 0; i < result.length; i++) {
    const curr = result[i];
    const next = result[i + 1];
    if (curr.action === 'click' && next && next.action === 'fill' && curr.member === next.member) {
      continue; // Skip redundant click before fill
    }
    pass1.push(curr);
  }

  // Pass 2: Deduplicate consecutive duplicate actions on toggles / options
  const pass2 = [];
  for (let i = 0; i < pass1.length; i++) {
    const curr = pass1[i];
    const next = pass1[i + 1];

    const loc = locMap.get(curr.member);
    const isToggle =
      loc &&
      (loc.role === 'checkbox' ||
        loc.role === 'radio' ||
        /chkbox|checkbox|radio/i.test(loc.css || '') ||
        /Checkbox|Radio/i.test(curr.member));
    if (curr.action === 'click' && next && next.action === 'click' && curr.member === next.member && isToggle) {
      continue;
    }

    if (curr.member && curr.member.endsWith('Option') && next && next.member === curr.member) {
      continue;
    }

    // Deduplicate repeated trigger/label + option sequence for the same option
    const nextNext = pass1[i + 2];
    if (
      curr.action === 'click' &&
      curr.member &&
      curr.member.endsWith('Option') &&
      next &&
      next.action === 'click' &&
      (/LabelElement|Trigger$/i.test(next.member) || /ui-selectonemenu/i.test(next.member)) &&
      nextNext &&
      nextNext.action === 'click' &&
      nextNext.member === curr.member
    ) {
      pass2.push(curr);
      i += 2; // skip the redundant trigger/label and the second option click
      continue;
    }

    pass2.push(curr);
  }

  // Pass 3: Prune premature Next/Submit clicks caused by missed required fields/validation retry
  // Pattern: [click Next/Submit] -> [1 to 4 form field entries] -> [click Next/Submit]
  // In live recordings, testers often click Next too early, encounter a validation error
  // (e.g. "What existing measures are reduced? is required"), fill the missing field(s),
  // and click Next again.
  // The correct automated test order is: fill the missing field(s) BEFORE Next, and click Next ONCE.
  const pass3 = [];
  for (let i = 0; i < pass2.length; i++) {
    const curr = pass2[i];
    if (/Next|Submit|Continue/i.test(curr.member) && curr.action === 'click') {
      // Look ahead for the next click on Next/Submit
      let nextBtnIdx = -1;
      for (let j = i + 1; j < pass2.length; j++) {
        if (/Next|Submit|Continue/i.test(pass2[j].member) && pass2[j].action === 'click') {
          nextBtnIdx = j;
          break;
        }
      }

      if (nextBtnIdx !== -1) {
        const intermediate = pass2.slice(i + 1, nextBtnIdx);
        const isFieldEntry = (st) =>
          st.action === 'fill' ||
          st.action === 'press' ||
          (st.action === 'click' && /Option|Checkbox|Radio|Input|Textarea|Trigger$/i.test(st.member));

        if (intermediate.length > 0 && intermediate.length <= 4 && intermediate.every(isFieldEntry)) {
          // Reorder: intermediate missing fields first, then ONE Next click
          pass3.push(...intermediate);
          pass3.push(pass2[nextBtnIdx]);
          i = nextBtnIdx; // Skip past the second Next click
          continue;
        }
      }
    }

    // Only deduplicate immediate consecutive duplicate Next clicks
    const next = pass2[i + 1];
    if (/Next|Submit|Continue/i.test(curr.member) && curr.action === 'click' && next && next.member === curr.member && next.action === 'click') {
      continue;
    }
    pass3.push(curr);
  }

  // Pass 4: Prune redundant background dismiss clicks (clicking static div container only to blur/close dropdown)
  // In live recordings, human testers click outside (on the background container div) to close dropdowns.
  // Pattern: A click on a generic div container (rawExpr has locator('div').filter or member ends in Element without role)
  // that immediately follows an option, listitem, or checkbox selection.
  const pass4 = [];
  for (let i = 0; i < pass3.length; i++) {
    const curr = pass3[i];
    const prev = pass3[i - 1];
    const loc = locMap.get(curr.member);

    const isLayoutClick =
      curr.action === 'click' &&
      (!loc || !loc.role || loc.role === '') &&
      (
        /^(?:div|span)Nth\d+/i.test(curr.member) ||
        (loc && loc.rawExpr && /(?:\.ui-g\s*>\s*div|locator\(['"]div['"]\)\.filter)/i.test(loc.rawExpr)) ||
        (loc && loc.css && /\.ui-g\s*>\s*div/i.test(loc.css)) ||
        (/Element$/i.test(curr.member) && loc && !loc.role && /filter|div/i.test(loc.rawExpr || ''))
      );

    const isBackgroundDismiss =
      isLayoutClick &&
      prev &&
      (
        prev.member.endsWith('Option') ||
        prev.member.endsWith('Listitem') ||
        prev.member.endsWith('Checkbox') ||
        /Option|Listitem|Checkbox|Text$/i.test(prev.member)
      );

    if (isBackgroundDismiss) {
      continue; // Skip redundant background blur click
    }
    pass4.push(curr);
  }

  return pass4;
}

function renderTestcaseMd(pageClass, key, recordingRel, model) {
  const { locators } = model;
  const pageLocators = locators.filter((l) => !l.isFrame);
  const entryMember = pickEntryMember(pageLocators);
  const title = toTitle(key);

  // Danh sách "action lines" cho khối When (mọi action đã ghi, trừ entry click
  // vì entry đã nằm trong ensureAuthenticated/goto flow riêng nếu là login).
  const whenLines = [];
  const steps = (model.recordedSteps && model.recordedSteps.length) ? model.recordedSteps : [];
  if (steps.length) {
    const cleanedSteps = cleanRecordedSteps(steps, locators);
    for (const s of cleanedSteps) {
      const line = renderAutomationCall(s.member, s.action, s.value != null ? [s.value] : []);
      if (line) whenLines.push(line);
    }
  } else {
    for (const l of locators) {
      if (isLoginLocator(l)) continue;
      for (const action of Array.from(l.actions).sort()) {
        const line = renderAutomationCall(l.member, action, l.values);
        if (line) whenLines.push(line);
      }
    }
  }

  const L = [];
  L.push(`# Testcase: TC-${key} -- ${title}`);
  L.push('');
  L.push('- **Mã Testcase:** `TC-' + key + '-01`');
  L.push(`- **Module / Function:** ${title}`);
  L.push('- **Mức độ:** Medium');
  L.push(`- **Page Object:** \`${pageClass}\` (auto-generated từ \`${recordingRel}\`)`);
  L.push('- **Precondition:** Tester đã đăng nhập được ASAP (SSO/MFA nếu có sẽ hand-off thủ công khi chạy `--headed`).');
  L.push('');
  L.push('> ✍️ **Tester chỉnh sửa file này**, sau đó chạy `npm run md-to-spec ' + key + '`');
  L.push('> để sinh lại `tests/e2e/functions/TC-' + key + '.spec.ts` **KHÔNG cần gọi AI/Copilot** (0 token).');
  L.push('');
  L.push('## Các Bước Thực Hiện (Given / When / Then -- phần mô tả cho người đọc)');
  L.push('1. **Given:** Tester mở ASAP và đăng nhập thành công.');
  L.push(`2. **When:** Tester thao tác trên module **${title}** (xem chi tiết ở khối \`automation\` bên dưới).`);
  L.push('3. **Then (Expected):**');
  if (entryMember) {
    L.push(`   - Điểm vào module (\`${entryMember}\`) hiển thị.`);
  }
  L.push('   - (Bổ sung kỳ vọng nghiệp vụ thật tại đây.)');
  L.push('');
  L.push('---');
  L.push('');
  L.push('## 🤖 Automation Steps (MÁY ĐỌC -- nguồn sinh spec)');
  L.push('');
  L.push('> Cú pháp mỗi dòng trong khối dưới đây:');
  L.push('> - `Given:` / `When:` / `Then:` / `And:` -> mở một nhóm `test.step` mới (chữ sau dấu `:` là mô tả).');
  L.push('> - `<methodName> "giá trị"` -> gọi method tương ứng trên Page Object (vd `fillUsername "admin"`).');
  L.push('> - `<methodName>` (không tham số) -> gọi method không đối số (vd `clickLoginButton`).');
  L.push('> - `expect <member> <matcher> ["value"]` -> assertion. matcher: `visible`, `hidden`, `enabled`,');
  L.push('>   `disabled`, `text`, `value`, `count`, `url`.');
  L.push('> - `include TC-' + key + '-01` -> **kế thừa** toàn bộ bước của scenario khác (tái dùng 90% flow).');
  L.push('> - `pause` -> dừng cho Tester can thiệp thủ công (vd SSO); `wait <ms>` -> chờ.');
  L.push('> - `goto` / `ensureAuthenticated` -> điều hướng base URL / đăng nhập (hỗ trợ hand-off SSO).');
  L.push('');
  L.push('### Scenario TC-' + key + '-01: ' + title + ' (flow gốc)');
  L.push('');
  L.push('```automation');
  L.push('Given: Tester mở ASAP và đăng nhập');
  L.push('  ensureAuthenticated');
  L.push('When: Thao tác trên module ' + title);
  if (whenLines.length) {
    for (const line of whenLines) L.push('  ' + line);
  } else {
    L.push('  # (chưa bóc tách được action -- thêm lời gọi method thủ công ở đây)');
  }
  L.push('Then: Kết quả mong đợi hiển thị');
  if (entryMember) {
    L.push('  expect ' + entryMember + ' visible');
  } else {
    L.push('  wait 3000');
  }
  L.push('```');
  L.push('');
  L.push('### Scenario TC-' + key + '-02: (ví dụ kế thừa 90% + thêm 10% bước mới)');
  L.push('');
  L.push('> Bỏ comment & chỉnh để tạo case mới **kế thừa** flow gốc rồi thêm bước mới:');
  L.push('');
  L.push('```automation-disabled');
  L.push('include TC-' + key + '-01');
  L.push('When: Bước mới bổ sung (10%)');
  L.push('  # thêm lời gọi method mới ở đây');
  L.push('Then: Kỳ vọng mới');
  L.push('  # expect <member> visible');
  L.push('```');
  L.push('');
  return L.join('\n');
}

/**
 * Sinh file kịch bản Markdown BDD cho KEY. Non-destructive: KHÔNG ghi đè file md
 * đã tồn tại (để bảo toàn chỉnh sửa thủ công của Tester) trừ khi force = true.
 */
function generateTestcaseMd(key, { force = false } = {}) {
  const pageClass = toPascalCasePageName(key);
  const { isFunction, recordingFull, recordingRel } = resolveRecording(key);
  const mdDir = isFunction ? TESTCASES_FUNCTIONS_DIR : TESTCASES_DIR;
  const mdRel = isFunction
    ? `tests/testcases/functions/TC-${key}.md`
    : `tests/testcases/TC-${key}.md`;
  const mdFull = path.join(mdDir, `TC-${key}.md`);

  if (!fs.existsSync(recordingFull)) return { status: 'missing', mdRel, pageClass, recordingRel };
  const source = fs.readFileSync(recordingFull, 'utf-8');
  if (!hasRealInteractions(source)) return { status: 'empty', mdRel, pageClass, recordingRel };

  const model = extractPomModel(source);
  if (!model.locators.length) return { status: 'no-locators', mdRel, pageClass, recordingRel };

  const existed = fs.existsSync(mdFull);
  if (existed && !force) {
    return { status: 'exists', mdRel, pageClass, recordingRel };
  }

  const code = renderTestcaseMd(pageClass, key, recordingRel, model);
  fs.mkdirSync(mdDir, { recursive: true });
  fs.writeFileSync(mdFull, code, 'utf-8');

  return { status: existed ? 'overwritten' : 'created', mdRel, pageClass, recordingRel };
}

function loadLiveSpec() {
  if (!fs.existsSync(LIVE_SPEC_PATH)) {
    return {
      generatedAt: null,
      origin: 'reverse-grounding',
      description:
        'Live-grounded UI components reverse-extracted from Playwright codegen recordings ' +
        '(tests/recordings/<KEY>.recording.ts) by scripts/sync-specs.js. Highest-priority grounding ' +
        'source: these selectors were exercised on the REAL app, so prefer them over the static ' +
        'ui_components.yaml when they overlap.',
      recordingCount: 0,
      componentCount: 0,
      recordings: []
    };
  }
  const doc = yaml.load(fs.readFileSync(LIVE_SPEC_PATH, 'utf-8')) || {};
  if (!Array.isArray(doc.recordings)) doc.recordings = [];
  return doc;
}

function syncRecording(spec, key) {
  const { recordingFull, recordingRel } = resolveRecording(key);

  if (!fs.existsSync(recordingFull)) {
    return { key, status: 'missing', recordingRel };
  }
  const source = fs.readFileSync(recordingFull, 'utf-8');
  if (!hasRealInteractions(source)) {
    return { key, status: 'empty', recordingRel };
  }

  const components = extractComponents(source, key);
  if (components.length === 0) {
    return { key, status: 'no-components', recordingRel };
  }

  const entry = {
    key,
    recording: recordingRel,
    entryUrl: cleanseEntryUrl(extractEntryUrl(source)),
    syncedAt: new Date().toISOString(),
    componentCount: components.length,
    components
  };

  // Merge theo key: thay thế entry cũ của cùng KEY, giữ các KEY khác.
  const idx = spec.recordings.findIndex((r) => r.key === key);
  if (idx === -1) spec.recordings.push(entry);
  else spec.recordings[idx] = entry;

  return { key, status: 'ok', recordingRel, componentCount: components.length };
}

function finalize(spec) {
  spec.recordings.sort((a, b) => a.key.localeCompare(b.key));
  spec.generatedAt = new Date().toISOString();
  spec.origin = 'reverse-grounding';
  spec.recordingCount = spec.recordings.length;
  spec.componentCount = spec.recordings.reduce((sum, r) => sum + (r.componentCount || 0), 0);
  fs.mkdirSync(CODEBASE_SPEC_DIR, { recursive: true });
  fs.writeFileSync(LIVE_SPEC_PATH, yaml.dump(spec, { lineWidth: 120, noRefs: true }), 'utf-8');
}

/**
 * API dùng lại được cho auto-test.js: sync 1 KEY một cách "im lặng" (không exit),
 * trả về kết quả để pipeline log gọn gàng.
 */
function syncKey(key, options = {}) {
  const normalized = parseTicketKey(key);
  if (!normalized) return { key, status: 'invalid-key' };
  const spec = loadLiveSpec();
  const result = syncRecording(spec, normalized);
  if (result.status === 'ok') finalize(spec);
  const out = { ...result, specRel: LIVE_SPEC_REL };
  // POM generation is opt-in for programmatic callers (auto-test.js) so we never
  // clobber curated Page Objects during a regenerate; the CLI enables it by default.
  if (options.generatePom) {
    out.pom = generatePom(normalized, { force: options.forcePom === true });
  }
  // Starter spec generation is likewise opt-in and guarded: an existing spec is
  // never overwritten unless options.forceSpec (--force-spec) is set.
  if (options.generateSpec) {
    out.spec = generateSpec(normalized, { force: options.forceSpec === true });
  }
  // BDD markdown scenario generation (guarded like spec/POM).
  if (options.generateMd) {
    out.md = generateTestcaseMd(normalized, { force: options.forceMd === true });
  }
  return out;
}

/**
 * Report kết quả đóng gói POM ra CLI (dùng cho banner của npm run sync-specs).
 */
function reportPom(key, pom) {
  switch (pom.status) {
    case 'created':
      console.log(
        `[POM] ${key}: packaged POM -> ${pom.outRel} (class ${pom.pageClass}: ${pom.locatorCount} locators, ${pom.methodCount} methods).`
      );
      break;
    case 'overwritten':
      console.log(
        `[POM] ${key}: overwritten POM (--force-pom) -> ${pom.outRel} (class ${pom.pageClass}: ${pom.locatorCount} locators, ${pom.methodCount} methods).`
      );
      break;
    case 'exists':
      console.log(
        `[SKIP] ${key}: POM already exists at ${pom.outRel} -> kept intact (use --force-pom to overwrite).`
      );
      break;
    case 'missing':
      console.warn(`[WARN] ${key}: recording not found at ${pom.recordingRel} -> skipped POM packaging.`);
      break;
    case 'empty':
      console.warn(`[WARN] ${key}: recording has no interactions -> skipped POM packaging.`);
      break;
    case 'no-locators':
      console.warn(`[WARN] ${key}: no clean locators extracted -> skipped POM packaging.`);
      break;
    default:
      console.warn(`[WARN] ${key}: POM status = ${pom.status}`);
  }
}

/**
 * Report kết quả sinh starter spec ra CLI.
 */
function reportSpec(key, spec) {
  switch (spec.status) {
    case 'created':
      console.log(`[SPEC] ${key}: generated starter spec -> ${spec.specRel} (import ${spec.pageClass}).`);
      break;
    case 'overwritten':
      console.log(`[SPEC] ${key}: overwritten starter spec (--force-spec) -> ${spec.specRel}.`);
      break;
    case 'exists':
      console.log(
        `[SKIP] ${key}: spec already exists at ${spec.specRel} -> kept intact (use --force-spec to overwrite).`
      );
      break;
    case 'no-pom':
      console.warn(`[WARN] ${key}: Page Object not found -> skipped spec generation (do not use --no-pom).`);
      break;
    case 'missing':
      console.warn(`[WARN] ${key}: recording not found at ${spec.recordingRel} -> skipped spec generation.`);
      break;
    case 'empty':
      console.warn(`[WARN] ${key}: recording has no interactions -> skipped spec generation.`);
      break;
    case 'no-locators':
      console.warn(`[WARN] ${key}: no clean locators extracted -> skipped spec generation.`);
      break;
    default:
      console.warn(`[WARN] ${key}: spec status = ${spec.status}`);
  }
}

/**
 * Report kết quả sinh file kịch bản Markdown BDD ra CLI.
 */
function reportMd(key, md) {
  switch (md.status) {
    case 'created':
      console.log(`[MD] ${key}: generated BDD scenario -> ${md.mdRel} (edit and run: npm run md-to-spec ${key}).`);
      break;
    case 'overwritten':
      console.log(`[MD] ${key}: overwritten BDD scenario (--force-md) -> ${md.mdRel}.`);
      break;
    case 'exists':
      console.log(`[SKIP] ${key}: BDD scenario already exists at ${md.mdRel} -> kept intact (use --force-md to overwrite).`);
      break;
    case 'missing':
      console.warn(`[WARN] ${key}: recording not found at ${md.recordingRel} -> skipped BDD scenario generation.`);
      break;
    case 'empty':
      console.warn(`[WARN] ${key}: recording has no interactions -> skipped BDD scenario generation.`);
      break;
    case 'no-locators':
      console.warn(`[WARN] ${key}: no clean locators extracted -> skipped BDD scenario generation.`);
      break;
    default:
      console.warn(`[WARN] ${key}: md status = ${md.status}`);
  }
}

function listRecordingKeys() {
  const keys = new Set();
  for (const dir of [RECORDINGS_DIR, RECORDINGS_FUNCTIONS_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.recording\.ts$/i.test(f)) continue;
      const key = parseTicketKey(f);
      if (key) keys.add(key);
    }
  }
  return Array.from(keys);
}

function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const noPom = argv.includes('--no-pom');
  // `--force-pom` OR plain `force` positional keyword both activate force mode.
  const forceKeyword = argv.some((a) => !a.startsWith('--') && a.toLowerCase() === 'force');
  const forcePom = argv.includes('--force-pom') || forceKeyword;
  const noSpec = argv.includes('--no-spec');
  const forceSpec = argv.includes('--force-spec') || forceKeyword;
  const noMd = argv.includes('--no-md');
  const forceMd = argv.includes('--force-md') || forceKeyword;
  // Ticket KEY: first positional that is NOT a known keyword ('force', '--all', etc.)
  const positional = argv.find((a) => !a.startsWith('--') && a.toLowerCase() !== 'force');

  console.log('======================================================');
  console.log(' [SYNC] Reverse-Grounding + POM packaging');
  console.log('======================================================');

  let keys = [];
  if (all) {
    keys = listRecordingKeys();
    if (keys.length === 0) {
      console.log('[INFO] No recordings found in tests/recordings/ (skipped).');
      return;
    }
  } else {
    const key = parseTicketKey(positional);
    if (!key) {
      console.log('\n\x1b[33mUsage: npm run sync-specs <TICKET_KEY> [force] [--no-pom] [--force-pom] [--no-spec] [--force-spec] [--no-md] [--force-md]\x1b[0m');
      console.log('          npm run sync-specs -- --all [force] [--force-pom] [--force-spec] [--force-md]');
      console.log('   Example: npm run sync-specs ADMINISTRATION          # keep existing files');
      console.log('            npm run sync-specs ADMINISTRATION force     # overwrite POM, spec, and md');
      console.log('            npm run sync-specs:force ADMINISTRATION     # 1-click alias for force\n');
      process.exit(1);
    }
    keys = [key];
  }

  const spec = loadLiveSpec();
  let changed = 0;
  let totalComponents = 0;
  for (const key of keys) {
    const result = syncRecording(spec, key);
    switch (result.status) {
      case 'ok':
        changed++;
        totalComponents += result.componentCount || 0;
        console.log(`[OK] ${key}: extracted ${result.componentCount} live component(s) from ${result.recordingRel}`);
        break;
      case 'missing':
        console.warn(`[WARN] ${key}: recording not found at ${result.recordingRel} (run: npm run record:ticket ${key})`);
        break;
      case 'empty':
        console.warn(`[WARN] ${key}: recording has no real interactions -> skipped reverse-grounding.`);
        break;
      case 'no-components':
        console.warn(`[WARN] ${key}: no selectors extracted -> skipped.`);
        break;
      default:
        console.warn(`[WARN] ${key}: ${result.status}`);
    }
  }

  if (changed > 0) {
    finalize(spec);
    console.log('');
    console.log('------------------------------------------------------');
    console.log(`[SPEC] Reverse-Grounding: updated ${LIVE_SPEC_REL}`);
    console.log(`   Sync summary: ${changed} recording(s), ${totalComponents} live component(s) reverse-grounded.`);
    console.log(`   Total: ${spec.recordingCount} recording(s), ${spec.componentCount} live component(s).`);
    console.log('   -> Automatically referenced by index.yaml & new-test.prompt.md for new tests.');
    console.log('------------------------------------------------------');
  } else {
    console.log('\n[INFO] No reverse-grounding changes recorded.');
  }

  // ─── Bước 2: tự động đóng gói Page Object Model chuẩn ───
  if (noPom) {
    console.log('\n[INFO] --no-pom: skipped Page Object Model packaging.');
  } else {
    console.log('');
    console.log('------------------------------------------------------');
    console.log(' [POM] Packaging: Recording -> tests/pages/<Key>Page.ts');
    console.log('------------------------------------------------------');
    let pomGenerated = 0;
    for (const key of keys) {
      const pom = generatePom(key, { force: forcePom });
      if (pom.status === 'created' || pom.status === 'overwritten') pomGenerated++;
      reportPom(key, pom);
    }
    console.log('------------------------------------------------------');
    console.log(
      `[POM] Packaging complete: ${pomGenerated}/${keys.length} file(s) ${forcePom ? 'created/overwritten' : 'created'}.`
    );
    console.log('------------------------------------------------------');
  }

  // ─── Bước 3: sinh starter E2E spec (có guard chống ghi đè) ───
  if (noSpec) {
    console.log('\n[INFO] --no-spec: skipped starter E2E spec generation.');
  } else {
    console.log('');
    console.log('------------------------------------------------------');
    console.log(' [SPEC] Starter spec: Recording -> tests/e2e/TC-<KEY>.spec.ts');
    console.log('------------------------------------------------------');
    let specGenerated = 0;
    for (const key of keys) {
      const spec = generateSpec(key, { force: forceSpec });
      if (spec.status === 'created' || spec.status === 'overwritten') specGenerated++;
      reportSpec(key, spec);
    }
    console.log('------------------------------------------------------');
    console.log(
      `[SPEC] Starter spec complete: ${specGenerated}/${keys.length} file(s) ${forceSpec ? 'created/overwritten' : 'created'}.`
    );
    console.log('------------------------------------------------------');
  }

  // ─── Bước 4 (MỚI): sinh kịch bản Markdown BDD (nguồn cho md-to-spec) ───
  if (noMd) {
    console.log('\n[INFO] --no-md: skipped BDD scenario generation.\n');
    return;
  }

  console.log('');
  console.log('------------------------------------------------------');
  console.log(' [MD] BDD Scenario: Recording -> tests/testcases/functions/TC-<KEY>.md');
  console.log('------------------------------------------------------');
  let mdGenerated = 0;
  for (const key of keys) {
    const md = generateTestcaseMd(key, { force: forceMd });
    if (md.status === 'created' || md.status === 'overwritten') mdGenerated++;
    reportMd(key, md);
  }
  console.log('------------------------------------------------------');
  console.log(
    `[MD] BDD scenario complete: ${mdGenerated}/${keys.length} file(s) ${forceMd ? 'created/overwritten' : 'created'}.`
  );
  console.log('   -> Automatically translating BDD scenario to spec via md-to-spec...');
  const mdToSpecPath = path.join(__dirname, 'md-to-spec.js');
  if (fs.existsSync(mdToSpecPath)) {
    for (const key of keys) {
      spawnSync(process.execPath, [mdToSpecPath, key], { stdio: 'inherit', cwd: ROOT_DIR });
    }
  }
  console.log('------------------------------------------------------\n');
}

module.exports = {
  syncKey,
  extractComponents,
  hasRealInteractions,
  extractPrimefacesId,
  toPascalCasePageName,
  generatePom,
  generateSpec,
  generateTestcaseMd,
  cleanseEntryUrl,
  extractPomModel,
  LIVE_SPEC_REL
};

if (require.main === module) {
  main();
}
