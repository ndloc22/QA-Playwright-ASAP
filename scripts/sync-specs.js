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
 * Usage:
 *   node scripts/sync-specs.js KFWT-1161          # sync 1 recording
 *   node scripts/sync-specs.js --all              # sync mọi recording trong tests/recordings/
 *   npm run sync-specs KFWT-1161
 *   npm run sync-specs -- --all
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
const CODEBASE_SPEC_DIR = path.join(ROOT_DIR, 'docs', 'specs', 'codebase');
const LIVE_SPEC_PATH = path.join(CODEBASE_SPEC_DIR, 'live_grounded_components.yaml');
const LIVE_SPEC_REL = 'docs/specs/codebase/live_grounded_components.yaml';

/**
 * Chuẩn hoá 1 tên ticket/KEY từ chuỗi bất kỳ (KFWT-1161, kfwt-1161, ...).
 */
function parseTicketKey(arg) {
  if (!arg) return null;
  const cleaned = String(arg).replace(/^https?:\/\/[^\/]+\/browse\//i, '').replace(/[\/\\]+$/, '').trim();
  const match = cleaned.match(/([A-Za-z0-9_-]+)/);
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
  const recordingFull = path.join(RECORDINGS_DIR, `${key}.recording.ts`);
  const recordingRel = `tests/recordings/${key}.recording.ts`;

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
    entryUrl: extractEntryUrl(source),
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
function syncKey(key) {
  const normalized = parseTicketKey(key);
  if (!normalized) return { key, status: 'invalid-key' };
  const spec = loadLiveSpec();
  const result = syncRecording(spec, normalized);
  if (result.status === 'ok') finalize(spec);
  return { ...result, specRel: LIVE_SPEC_REL };
}

function listRecordingKeys() {
  if (!fs.existsSync(RECORDINGS_DIR)) return [];
  return fs
    .readdirSync(RECORDINGS_DIR)
    .filter((f) => /\.recording\.ts$/i.test(f))
    .map((f) => parseTicketKey(f))
    .filter(Boolean);
}

function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const positional = argv.find((a) => !a.startsWith('--'));

  console.log('======================================================');
  console.log(' 🔁 Reverse-Grounding: Recording -> OpenSpecs sync');
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
      console.log('\n\x1b[33m⚡ Usage: npm run sync-specs <TICKET_KEY>   (hoặc)   npm run sync-specs -- --all\x1b[0m');
      console.log('   Example: npm run sync-specs KFWT-1161\n');
      process.exit(1);
    }
    keys = [key];
  }

  const spec = loadLiveSpec();
  let changed = 0;
  for (const key of keys) {
    const result = syncRecording(spec, key);
    switch (result.status) {
      case 'ok':
        changed++;
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
    console.log(`📄 Đã cập nhật: ${LIVE_SPEC_REL}`);
    console.log(`   Tổng: ${spec.recordingCount} recording, ${spec.componentCount} live component.`);
    console.log('   → index.yaml + new-test.prompt.md tự tham chiếu file này khi sinh test ticket mới.');
    console.log('------------------------------------------------------\n');
  } else {
    console.log('\nℹ️  Không có thay đổi nào được ghi.\n');
  }
}

module.exports = { syncKey, extractComponents, hasRealInteractions, extractPrimefacesId, LIVE_SPEC_REL };

if (require.main === module) {
  main();
}
