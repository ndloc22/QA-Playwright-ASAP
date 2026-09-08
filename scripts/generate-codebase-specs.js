/**
 * ⚡ Axon Ivy Codebase OpenSpecs Extractor
 *
 * Đọc READ-ONLY mã nguồn Axon Ivy (mặc định D:\Projects\kleinfernwirktechnik, hoặc --source <path>),
 * quét *.xhtml (dialogs) + *.p.json (processes) rồi bóc tách thành bộ OpenSpecs nén dạng YAML
 * tại docs/specs/codebase/ để GitHub Copilot "grounding" locator/state-machine 100% chính xác
 * thay vì tự đoán.
 *
 * Usage:
 *   node scripts/generate-codebase-specs.js
 *   node scripts/generate-codebase-specs.js --source "D:\Projects\kleinfernwirktechnik"
 *   npm run generate-codebase-specs
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_SOURCE = 'D:\\Projects\\kleinfernwirktechnik';
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'specs', 'codebase');

const IGNORED_DIR_NAMES = new Set(['.git', 'node_modules', 'target', '.settings', '.metadata', 'dist', 'build']);

// Danh sách PrimeFaces / JSF component tag -> loại component chuẩn hoá
const COMPONENT_TAG_MAP = {
  'p:selectBooleanCheckbox': 'selectBooleanCheckbox',
  'p:inputText': 'inputText',
  'p:inputTextarea': 'inputTextarea',
  'p:inputNumber': 'inputNumber',
  'p:calendar': 'datePicker',
  'p:datePicker': 'datePicker',
  'p:commandButton': 'commandButton',
  'h:commandButton': 'commandButton',
  'p:selectOneMenu': 'selectOneMenu',
  'p:selectOneRadio': 'selectOneRadio',
  'p:autoComplete': 'autoComplete',
  'p:fileUpload': 'fileUpload'
};

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source' && argv[i + 1]) {
      args.source = argv[i + 1];
      i++;
    }
  }
  return args;
}

function walk(dir, extensions, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      walk(path.join(dir, entry.name), extensions, results);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (extensions.some(ext => lower.endsWith(ext))) {
        results.push(path.join(dir, entry.name));
      }
    }
  }
  return results;
}

/**
 * Tách chuoi attribute "name="value"" (ho tro name kieu ns:attr) tu 1 the tag string.
 */
function parseAttributes(tagContent) {
  const attrs = {};
  const attrRegex = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(tagContent)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

/**
 * Rut ra key CMS ngan gon tu bieu thuc ivy.cms.co('/path/to/label') neu co,
 * neu khong tra ve nguyen chuoi (da cat ngan).
 */
function extractLabel(value) {
  if (!value) return null;
  const cmsMatch = value.match(/ivy\.cms\.co\(\s*['"]([^'"]+)['"]/);
  if (cmsMatch) return cmsMatch[1];
  return value.length > 120 ? value.slice(0, 117) + '...' : value;
}

/**
 * Suy ra 1 "label" du phong tu bieu thuc EL binding (vd: ...telecontrolDeviceDigions.nsTransformerMeasurementAvailable)
 * bang cach lay segment cuoi cung.
 */
function deriveLabelFromBinding(value) {
  if (!value) return null;
  const cleaned = value.replace(/[#{}]/g, '');
  const segments = cleaned.split('.');
  return segments[segments.length - 1] || null;
}

function extractXhtmlComponents(content) {
  const components = [];
  const tagNames = Object.keys(COMPONENT_TAG_MAP);
  // Regex chung: <TAGNAME ...attrs...(/>|>)   -  ho tro tag mo/dong tren nhieu dong
  const tagPattern = new RegExp(`<(${tagNames.map(t => t.replace(':', '\\:')).join('|')})\\b([\\s\\S]*?)(/?)>`, 'g');
  let match;

  while ((match = tagPattern.exec(content)) !== null) {
    const tagName = match[1];
    const attrString = match[2];
    const attrs = parseAttributes(attrString);
    const componentType = COMPONENT_TAG_MAP[tagName];

    const label = extractLabel(attrs.itemLabel) || extractLabel(attrs.label) || extractLabel(attrs.value) || deriveLabelFromBinding(attrs.value);

    // Tim doan validator lien quan trong 400 ky tu tiep theo (kiem tra requiredCheckboxValidator hoac required="true")
    const lookaheadStart = match.index;
    const lookaheadEnd = Math.min(content.length, lookaheadStart + attrString.length + 400);
    const lookahead = content.slice(lookaheadStart, lookaheadEnd);
    const hasRequiredValidator = /requiredCheckboxValidator|required\s*=\s*"true"|requiredMessage\s*=/.test(lookahead) || attrs.required === 'true' || !!attrs.requiredMessage;

    components.push({
      id: attrs.id || null,
      type: componentType,
      tag: tagName,
      label: label || null,
      valueBinding: attrs.value || null,
      actionBinding: attrs.action || attrs.actionListener || null,
      rendered: attrs.rendered || null,
      required: hasRequiredValidator,
      styleClass: attrs.styleClass || null
    });
  }
  return components;
}

function extractXhtmlSpec(filePath, sourceRoot) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(sourceRoot, filePath).split(path.sep).join('/');
  const dialogName = path.basename(filePath, '.xhtml');
  const components = extractXhtmlComponents(content);

  if (components.length === 0) return null;

  return {
    name: dialogName,
    path: relativePath,
    componentCount: components.length,
    components
  };
}

/**
 * Duyet de quy toan bo object JSON de tim cac mang "elements" (Ivy p.json co the long nhau
 * qua EmbeddedProcessGroup / SubProcess), gom UserTask va Alternative (transition condition).
 */
function collectProcessElements(node, tasks, transitions, roles) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    node.forEach(item => collectProcessElements(item, tasks, transitions, roles));
    return;
  }

  if (Array.isArray(node.elements)) {
    for (const el of node.elements) {
      if (el && el.type === 'UserTask') {
        const taskCfg = (el.config && el.config.task) || {};
        const responsible = taskCfg.responsible || {};
        let responsibleRole = null;
        if (responsible.type === 'ROLE_FROM_ATTRIBUTE') {
          responsibleRole = `ROLE_FROM_ATTRIBUTE(${responsible.activator || ''})`;
        } else if (responsible.activator) {
          responsibleRole = responsible.activator;
        }
        if (responsibleRole) {
          const roleKey = responsible.activator || responsibleRole;
          roles.add(roleKey);
        }

        const rawName = Array.isArray(el.name) ? el.name.join(' / ') : el.name;

        tasks.push({
          id: el.id,
          name: rawName || null,
          dialog: (el.config && el.config.dialog) || null,
          taskNameExpr: extractLabel(taskCfg.name) || null,
          responsibleRole
        });
      } else if (el && el.type === 'Alternative') {
        const conditions = (el.config && el.config.conditions) || null;
        if (el.name || conditions) {
          transitions.push({
            id: el.id,
            name: el.name || null,
            conditions: conditions || null
          });
        }
      }
      // De quy vao sau moi element (ho tro EmbeddedProcessGroup / SubProcess long nhau)
      collectProcessElements(el, tasks, transitions, roles);
    }
  }

  // De quy cac key khac (phong khi cau truc long sau, vd "config")
  for (const key of Object.keys(node)) {
    if (key === 'elements') continue;
    const val = node[key];
    if (val && typeof val === 'object') {
      collectProcessElements(val, tasks, transitions, roles);
    }
  }
}

function extractProcessSpec(filePath, sourceRoot) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.warn(`   ⚠️  Bỏ qua (JSON lỗi): ${filePath} — ${err.message}`);
    return null;
  }

  const relativePath = path.relative(sourceRoot, filePath).split(path.sep).join('/');
  const processName = path.basename(filePath).replace(/\.p\.json$/i, '');

  const tasks = [];
  const transitions = [];
  const roles = new Set();
  collectProcessElements(json, tasks, transitions, roles);

  if (tasks.length === 0 && transitions.length === 0) return null;

  return {
    name: processName,
    path: relativePath,
    dataClass: (json.config && json.config.data) || null,
    taskCount: tasks.length,
    transitionCount: transitions.length,
    tasks,
    transitions,
    roles: Array.from(roles).sort()
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = args.source;

  console.log('======================================================');
  console.log(' Axon Ivy Codebase OpenSpecs Extractor');
  console.log('======================================================');
  console.log(`Nguồn (READ-ONLY): ${sourceRoot}`);
  console.log(`Đích:              ${path.relative(process.cwd(), OUTPUT_DIR)}`);
  console.log('');

  if (!fs.existsSync(sourceRoot)) {
    console.error(`❌ Không tìm thấy thư mục nguồn: ${sourceRoot}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- 1. Quét *.xhtml ---
  console.log('🔎 Đang quét *.xhtml (dialogs)...');
  const xhtmlFiles = walk(sourceRoot, ['.xhtml'], []);
  const dialogs = [];
  for (const file of xhtmlFiles) {
    try {
      const spec = extractXhtmlSpec(file, sourceRoot);
      if (spec) dialogs.push(spec);
    } catch (err) {
      console.warn(`   ⚠️  Bỏ qua ${file}: ${err.message}`);
    }
  }
  dialogs.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`   ✅ Đã quét ${xhtmlFiles.length} file .xhtml, trích xuất được ${dialogs.length} dialog có component.`);

  const totalComponents = dialogs.reduce((sum, d) => sum + d.componentCount, 0);

  const uiComponentsSpec = {
    generatedAt: new Date().toISOString(),
    source: sourceRoot,
    dialogCount: dialogs.length,
    componentCount: totalComponents,
    dialogs
  };

  // --- 2. Quét *.p.json ---
  console.log('🔎 Đang quét *.p.json (processes)...');
  const processFiles = walk(sourceRoot, ['.p.json'], []);
  const processes = [];
  for (const file of processFiles) {
    try {
      const spec = extractProcessSpec(file, sourceRoot);
      if (spec) processes.push(spec);
    } catch (err) {
      console.warn(`   ⚠️  Bỏ qua ${file}: ${err.message}`);
    }
  }
  processes.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`   ✅ Đã quét ${processFiles.length} file .p.json, trích xuất được ${processes.length} process có task/transition.`);

  const totalTasks = processes.reduce((sum, p) => sum + p.taskCount, 0);
  const totalTransitions = processes.reduce((sum, p) => sum + p.transitionCount, 0);
  const allRoles = new Set();
  processes.forEach(p => p.roles.forEach(r => allRoles.add(r)));

  const stateMachineSpec = {
    generatedAt: new Date().toISOString(),
    source: sourceRoot,
    processCount: processes.length,
    taskCount: totalTasks,
    transitionCount: totalTransitions,
    roles: Array.from(allRoles).sort(),
    processes
  };

  // --- 3. Ghi file YAML ---
  const uiComponentsPath = path.join(OUTPUT_DIR, 'ui_components.yaml');
  const stateMachinePath = path.join(OUTPUT_DIR, 'state_machine.yaml');

  fs.writeFileSync(uiComponentsPath, yaml.dump(uiComponentsSpec, { lineWidth: 120, noRefs: true }), 'utf-8');
  fs.writeFileSync(stateMachinePath, yaml.dump(stateMachineSpec, { lineWidth: 120, noRefs: true }), 'utf-8');

  console.log('');
  console.log('======================================================');
  console.log(' Kết quả');
  console.log('======================================================');
  console.log(`📄 ${path.relative(process.cwd(), uiComponentsPath)}  (${dialogs.length} dialog, ${totalComponents} component)`);
  console.log(`📄 ${path.relative(process.cwd(), stateMachinePath)}  (${processes.length} process, ${totalTasks} task, ${totalTransitions} transition, ${allRoles.size} role)`);
  console.log('\n🎉 Sinh OpenSpecs codebase thành công!\n');
}

main();
