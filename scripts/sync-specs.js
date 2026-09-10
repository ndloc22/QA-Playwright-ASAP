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
  const m = source.match(/\.goto\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/);
  return m ? m[2] : null;
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
  let base = comp.name || comp.text || '';
  if (!base && comp.css) {
    const id = comp.primefacesId || comp.css;
    const seg = id
      .replace(/\[id=|["'\]]/g, '')
      .split(/[:.\s>#[\]]+/)
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
function parseCleanLocator(portion) {
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
    const css = strArg.value;
    // Chỉ nhận CSS dựa trên id (#... hoặc [id="..."]) — bỏ qua selector class/combinator
    // của codegen (.ui-chkbox-box, .ui-g-1 > a...) vì chúng là "nhiễu" không bền vững.
    if (!/^\[id=/.test(css) && !/^#/.test(css)) return null;
    let i = strArg.endIdx;
    while (i < portion.length && /\s/.test(portion[i])) i++;
    if (portion[i] !== ')') return null;
    comp.locatorType = 'css';
    comp.css = css;
    comp.primefacesId = extractPrimefacesId(css);
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

  for (const raw of lines) {
    const line = raw.trim();
    if (!/^await\s+page\./.test(line)) continue;

    const isFrame = /contentFrame\(\)/.test(line) && /iframe\[title=/.test(line);
    let portion;
    if (isFrame) {
      const idx = line.lastIndexOf('.contentFrame()');
      portion = line.slice(idx + '.contentFrame()'.length).replace(/^\./, '');
    } else {
      portion = line.replace(/^await\s+page\./, '');
    }
    portion = portion.replace(/;\s*$/, '').trim();

    const parsed = parseCleanLocator(portion);
    if (!parsed) continue;

    const rest = portion.slice(parsed.endIdx);
    const actionMatch = rest.match(
      /^\.(click|dblclick|fill|type|press|check|uncheck|selectOption|hover|focus|tap)\s*\(/
    );
    if (!actionMatch) continue; // còn chain (.filter/.nth/.getBy...) -> nhiễu, bỏ qua

    const action = actionMatch[1];
    const argStart = parsed.endIdx + actionMatch[0].length;
    const strArg = readStringArg(portion, argStart);
    const value = strArg ? strArg.value : null;

    const comp = parsed.comp;
    comp.isFrame = isFrame;
    const sig = [
      isFrame ? 'F' : 'P',
      comp.locatorType,
      comp.role || '',
      comp.name || comp.text || '',
      comp.css || ''
    ].join('|');

    let entry = bySig.get(sig);
    if (!entry) {
      entry = { ...comp, actions: new Set(), values: [] };
      bySig.set(sig, entry);
    }
    entry.actions.add(action);
    if (value != null && value !== '' && !entry.values.includes(value)) {
      entry.values.push(value);
    }
  }

  const locators = Array.from(bySig.values());
  const used = new Set(['page', 'frame', 'constructor']);
  for (const l of locators) {
    l.member = uniqueName(deriveBaseName(l), used);
  }

  return {
    frameTitle,
    hasFrame: locators.some((l) => l.isFrame),
    locators
  };
}

/**
 * Sinh biểu thức locator (không kèm prefix `this.page`/`this.frame`).
 */
function locatorExpr(comp) {
  const t = comp.locatorType;
  if (t === 'role') {
    let s = `.getByRole(${tsString(comp.role)}`;
    if (comp.name != null || comp.exact) {
      const parts = [];
      if (comp.name != null) parts.push(`name: ${tsString(comp.name)}`);
      if (comp.exact) parts.push('exact: true');
      s += `, { ${parts.join(', ')} }`;
    }
    return `${s})`;
  }
  if (t === 'text') {
    return comp.exact
      ? `.getByText(${tsString(comp.text)}, { exact: true })`
      : `.getByText(${tsString(comp.text)})`;
  }
  if (t === 'css') {
    return `.locator(${tsString(comp.css)})`;
  }
  const map = {
    label: 'getByLabel',
    placeholder: 'getByPlaceholder',
    testId: 'getByTestId',
    title: 'getByTitle',
    altText: 'getByAltText'
  };
  const fn = map[t] || 'getByLabel';
  return `.${fn}(${tsString(comp.name)}${comp.exact ? ', { exact: true }' : ''})`;
}

function pascal(member) {
  return member.charAt(0).toUpperCase() + member.slice(1);
}

// Nhận diện locator thuộc form đăng nhập (Username/Password/Login) — dùng để bỏ
// chúng ra khỏi việc chọn "dashboard entry" và để sinh ensureAuthenticated().
function isLoginLocator(l) {
  if (l.locatorType !== 'role') return false;
  if (l.role === 'textbox' && /^(username|password|user name|user)$/i.test(l.name || '')) return true;
  if (l.role === 'button' && /^(login|log in|sign in|anmelden)$/i.test(l.name || '')) return true;
  return false;
}

/**
 * Chọn "dashboard entry locator": phần tử page-level (ngoài iframe) đầu tiên KHÔNG
 * phải form login, ưu tiên role 'link' (thường là link mở process/module). Trả về
 * member hoặc null nếu recording không có phần tử page-level phù hợp.
 */
function pickEntryMember(pageLocators) {
  const candidates = pageLocators.filter((l) => !isLoginLocator(l));
  const link = candidates.find((l) => l.locatorType === 'role' && l.role === 'link');
  const chosen = link || candidates[0] || null;
  return chosen ? chosen.member : null;
}

/**
 * Render toàn bộ nội dung file Page Object Model (TypeScript, strict-safe).
 */
function renderPomClass(pageClass, key, recordingRel, model, baseFallback) {
  const { hasFrame, frameTitle, locators } = model;
  const pageLocators = locators.filter((l) => !l.isFrame);
  const frameLocators = locators.filter((l) => l.isFrame);
  const entryMember = pickEntryMember(pageLocators);
  const baseLiteral = tsString(baseFallback || '');

  // expect là value import (không phải type) — cần cho ensureAuthenticated().
  const imports = ['Page'];
  if (hasFrame) imports.push('FrameLocator');
  imports.push('Locator');
  imports.push('expect');

  const lines = [];
  lines.push(`import { ${imports.join(', ')} } from '@playwright/test';`);
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
    lines.push('    }');
    lines.push("    await this.page.waitForLoadState('networkidle');");
  }
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
    lines.push(`    return this.frame${locatorExpr(l)};`);
    lines.push('  }');
  }

  let methodCount = 0;
  for (const l of locators) {
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
      lines.push(`    await this.${l.member}.${action}(${callArg});`);
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
    cleanseEntryUrl(extractEntryUrl(source))
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
  return out;
}

/**
 * Report kết quả đóng gói POM ra CLI (dùng cho banner của npm run sync-specs).
 */
function reportPom(key, pom) {
  switch (pom.status) {
    case 'created':
      console.log(
        `📦 ${key}: đóng gói POM chuẩn → ${pom.outRel} (class ${pom.pageClass}: ` +
          `${pom.locatorCount} locator, ${pom.methodCount} method).`
      );
      break;
    case 'overwritten':
      console.log(
        `📦 ${key}: ghi đè POM (--force-pom) → ${pom.outRel} (class ${pom.pageClass}: ` +
          `${pom.locatorCount} locator, ${pom.methodCount} method).`
      );
      break;
    case 'exists':
      console.log(
        `↩️  ${key}: POM đã tồn tại ${pom.outRel} → giữ nguyên (dùng --force-pom để ghi đè).`
      );
      break;
    case 'missing':
      console.warn(`⚠️  ${key}: không thấy ${pom.recordingRel} → bỏ qua đóng gói POM.`);
      break;
    case 'empty':
      console.warn(`⚠️  ${key}: recording không có thao tác thật → bỏ qua đóng gói POM.`);
      break;
    case 'no-locators':
      console.warn(`⚠️  ${key}: không bóc tách được locator sạch nào → bỏ qua đóng gói POM.`);
      break;
    default:
      console.warn(`⚠️  ${key}: POM status = ${pom.status}`);
  }
}

/**
 * Report kết quả sinh starter spec ra CLI.
 */
function reportSpec(key, spec) {
  switch (spec.status) {
    case 'created':
      console.log(`🧪 ${key}: sinh starter spec → ${spec.specRel} (import ${spec.pageClass}).`);
      break;
    case 'overwritten':
      console.log(`🧪 ${key}: ghi đè starter spec (--force-spec) → ${spec.specRel}.`);
      break;
    case 'exists':
      console.log(
        `↩️  ${key}: spec đã tồn tại ${spec.specRel} → giữ nguyên (dùng --force-spec để ghi đè).`
      );
      break;
    case 'no-pom':
      console.warn(`⚠️  ${key}: chưa có Page Object → bỏ qua sinh spec (đừng dùng --no-pom).`);
      break;
    case 'missing':
      console.warn(`⚠️  ${key}: không thấy ${spec.recordingRel} → bỏ qua sinh spec.`);
      break;
    case 'empty':
      console.warn(`⚠️  ${key}: recording không có thao tác thật → bỏ qua sinh spec.`);
      break;
    case 'no-locators':
      console.warn(`⚠️  ${key}: không bóc tách được locator sạch nào → bỏ qua sinh spec.`);
      break;
    default:
      console.warn(`⚠️  ${key}: spec status = ${spec.status}`);
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
  // Ticket KEY: first positional that is NOT a known keyword ('force', '--all', etc.)
  const positional = argv.find((a) => !a.startsWith('--') && a.toLowerCase() !== 'force');

  console.log('======================================================');
  console.log(' 🔁 Reverse-Grounding + POM packaging');
  console.log('======================================================');

  let keys = [];
  if (all) {
    keys = listRecordingKeys();
    if (keys.length === 0) {
      console.log('ℹ️  Không tìm thấy recording nào trong tests/recordings/ (bỏ qua).');
      return;
    }
  } else {
    const key = parseTicketKey(positional);
    if (!key) {
      console.log('\n\x1b[33m⚡ Usage: npm run sync-specs <TICKET_KEY> [force] [--no-pom] [--force-pom] [--no-spec] [--force-spec]\x1b[0m');
      console.log('          npm run sync-specs -- --all [force] [--force-pom] [--force-spec]');
      console.log('   Example: npm run sync-specs ADMINISTRATION          # giữ nguyên file hiện có');
      console.log('            npm run sync-specs ADMINISTRATION force     # ghi đè cả POM lẫn spec');
      console.log('            npm run sync-specs:force ADMINISTRATION     # alias 1-click cho force\n');
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
        console.log(`✅ ${key}: bóc tách ${result.componentCount} component sống từ ${result.recordingRel}`);
        break;
      case 'missing':
        console.warn(`⚠️  ${key}: không thấy ${result.recordingRel} (chạy: npm run record:ticket ${key})`);
        break;
      case 'empty':
        console.warn(`⚠️  ${key}: recording chỉ có điều hướng, không có thao tác thật → bỏ qua reverse-grounding.`);
        break;
      case 'no-components':
        console.warn(`⚠️  ${key}: không bóc tách được selector nào → bỏ qua.`);
        break;
      default:
        console.warn(`⚠️  ${key}: ${result.status}`);
    }
  }

  if (changed > 0) {
    finalize(spec);
    console.log('');
    console.log('------------------------------------------------------');
    console.log(`📄 Reverse-Grounding: đã cập nhật ${LIVE_SPEC_REL}`);
    console.log(`   Sync lần này: ${changed} recording, ${totalComponents} live component reverse-grounded.`);
    console.log(`   Tổng cộng: ${spec.recordingCount} recording, ${spec.componentCount} live component.`);
    console.log('   → index.yaml + new-test.prompt.md tự tham chiếu file này khi sinh test ticket mới.');
    console.log('------------------------------------------------------');
  } else {
    console.log('\nℹ️  Không có thay đổi reverse-grounding nào được ghi.');
  }

  // ─── Bước 2: tự động đóng gói Page Object Model chuẩn ───
  if (noPom) {
    console.log('\nℹ️  --no-pom: bỏ qua bước đóng gói Page Object Model.');
  } else {
    console.log('');
    console.log('------------------------------------------------------');
    console.log(' 📦 POM packaging: Recording -> tests/pages/<Key>Page.ts');
    console.log('------------------------------------------------------');
    let pomGenerated = 0;
    for (const key of keys) {
      const pom = generatePom(key, { force: forcePom });
      if (pom.status === 'created' || pom.status === 'overwritten') pomGenerated++;
      reportPom(key, pom);
    }
    console.log('------------------------------------------------------');
    console.log(
      `📦 POM packaging xong: ${pomGenerated}/${keys.length} file được ${forcePom ? 'ghi/ghi đè' : 'sinh mới'}.`
    );
    console.log('------------------------------------------------------');
  }

  // ─── Bước 3 (MỚI): sinh starter E2E spec (có guard chống ghi đè) ───
  if (noSpec) {
    console.log('\nℹ️  --no-spec: bỏ qua bước sinh starter E2E spec.\n');
    return;
  }

  console.log('');
  console.log('------------------------------------------------------');
  console.log(' 🧪 Starter spec: Recording -> tests/e2e/TC-<KEY>.spec.ts');
  console.log('------------------------------------------------------');
  let specGenerated = 0;
  for (const key of keys) {
    const spec = generateSpec(key, { force: forceSpec });
    if (spec.status === 'created' || spec.status === 'overwritten') specGenerated++;
    reportSpec(key, spec);
  }
  console.log('------------------------------------------------------');
  console.log(
    `🧪 Starter spec xong: ${specGenerated}/${keys.length} file được ${forceSpec ? 'ghi/ghi đè' : 'sinh mới'}.`
  );
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
  cleanseEntryUrl,
  extractPomModel,
  LIVE_SPEC_REL
};

if (require.main === module) {
  main();
}
