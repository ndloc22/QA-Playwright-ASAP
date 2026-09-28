/**
 * 🔌 CLI Runner — Ổn định hoá tiến trình gọi AI CLI (Copilot / Claude)
 *
 * Mục tiêu (Giai đoạn 4 của AGENT_RECOVERY_ARCHITECTURE_PLAN):
 *   - Gọi BINARY TRỰC TIẾP bằng đường dẫn tuyệt đối, KHÔNG qua `shell: true` để tránh
 *     shim cmd.exe hỏi "Terminate batch job (Y/N)?" và treo tiến trình trên Windows.
 *   - Kiểm soát timeout MỀM: hết giờ thì kill cả cây tiến trình bằng `taskkill /T /F`
 *     (Windows) hoặc SIGKILL (POSIX) — không để lại tiến trình mồ côi.
 *   - Stream log AN TOÀN theo thời gian thực (không mất output khi bị kill).
 *
 * API: async runCli(binary, args, options) -> Promise<{status, stdout, stderr, timedOut, error, signal}>
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';

/**
 * Phân giải một lệnh (vd "copilot") thành ĐƯỜNG DẪN TUYỆT ĐỐI tới file thực thi.
 * Ưu tiên executable gốc (.exe/.com) hơn shim (.cmd/.bat) để có thể spawn KHÔNG shell
 * trên Node hiện đại (Node >= 20.12 chặn spawn .cmd/.bat khi không có shell).
 * Trả về null nếu không tìm thấy.
 */
function resolveBinaryPath(command) {
  if (path.isAbsolute(command) && fs.existsSync(command)) return command;

  const pathDirs = (process.env.PATH || process.env.Path || '')
    .split(path.delimiter)
    .filter(Boolean);

  if (!IS_WINDOWS) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, command);
      try {
        if (fs.existsSync(candidate) && (fs.statSync(candidate).mode & 0o111)) return candidate;
      } catch (_) {}
    }
    return null;
  }

  // Windows: thử theo thứ tự ưu tiên executable gốc trước, shim sau.
  const rawExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean);
  const preferredOrder = ['.EXE', '.COM', '.CMD', '.BAT'];
  const exts = [
    ...preferredOrder.filter((e) => rawExt.map((x) => x.toUpperCase()).includes(e)),
    ...rawExt.filter((e) => !preferredOrder.includes(e.toUpperCase())),
  ];

  // Nếu command đã kèm sẵn đuôi mở rộng.
  if (path.extname(command)) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, command);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  for (const ext of exts) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Kill cả cây tiến trình một cách dứt khoát (không prompt Y/N). */
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (IS_WINDOWS && child.pid) {
      // /T: cả cây con, /F: buộc kết thúc (không hỏi "Terminate batch job (Y/N)?").
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGKILL');
    }
  } catch (_) {}
}

/**
 * Chạy một AI CLI bằng binary trực tiếp.
 *
 * @param {string} command  Tên lệnh ("copilot"/"claude") hoặc đường dẫn tuyệt đối.
 * @param {string[]} args   Tham số dòng lệnh.
 * @param {object} options
 *   - input {string}        Nội dung ghi vào stdin (prompt).
 *   - cwd {string}
 *   - env {object}
 *   - timeoutMs {number}    Mặc định 60000.
 *   - logStream {WritableStream} Ghi output realtime (an toàn khi bị kill).
 *   - onData {(chunk:string)=>void} Callback stream tuỳ chọn.
 *   - maxBuffer {number}    Giới hạn bộ nhớ gom output. Mặc định 32MB.
 * @returns {Promise<{status:number|null, stdout:string, stderr:string, timedOut:boolean, error:Error|null, signal:string|null, binaryPath:string|null}>}
 */
function runCli(command, args, options = {}) {
  const {
    input,
    cwd = process.cwd(),
    env = process.env,
    timeoutMs = 60000,
    logStream = null,
    onData = null,
    maxBuffer = 32 * 1024 * 1024,
  } = options;

  return new Promise((resolve) => {
    const binaryPath = resolveBinaryPath(command);
    if (!binaryPath) {
      resolve({
        status: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        error: new Error(`Không tìm thấy binary "${command}" trong PATH`),
        signal: null,
        binaryPath: null,
      });
      return;
    }

    // Chỉ spawn KHÔNG shell với executable gốc; shim .cmd/.bat cần shell (Node chặn spawn
    // trực tiếp), khi đó rơi về shell:true nhưng vẫn kill bằng taskkill /F để tránh treo.
    const ext = path.extname(binaryPath).toLowerCase();
    const needsShell = IS_WINDOWS && (ext === '.cmd' || ext === '.bat');

    let child;
    try {
      child = spawn(binaryPath, args, {
        cwd,
        env,
        shell: needsShell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        status: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        error: err,
        signal: null,
        binaryPath,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let overflow = false;

    const cleanNoise = (s) =>
      String(s || '').replace(/Terminate batch job \(Y\/N\)\?\s*/gi, '');

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const append = (buf, isErr) => {
      const chunk = cleanNoise(buf.toString('utf8'));
      if (logStream) {
        try { logStream.write(chunk); } catch (_) {}
      }
      if (onData) {
        try { onData(chunk); } catch (_) {}
      }
      if (isErr) {
        if (stderr.length < maxBuffer) stderr += chunk;
        else overflow = true;
      } else {
        if (stdout.length < maxBuffer) stdout += chunk;
        else overflow = true;
      }
    };

    if (child.stdout) child.stdout.on('data', (b) => append(b, false));
    if (child.stderr) child.stderr.on('data', (b) => append(b, true));

    if (input != null && child.stdin) {
      child.stdin.on('error', () => {});
      try {
        child.stdin.write(input);
        child.stdin.end();
      } catch (_) {}
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on('error', (err) => {
      finish({ status: null, stdout, stderr, timedOut, error: err, signal: null, binaryPath });
    });

    child.on('close', (code, signal) => {
      if (overflow) {
        stderr += '\n[cli-runner] ⚠️ Output vượt maxBuffer, đã cắt bớt.';
      }
      finish({
        status: code,
        stdout,
        stderr,
        timedOut,
        error: timedOut ? new Error(`CLI timeout sau ${timeoutMs}ms`) : null,
        signal: signal || null,
        binaryPath,
      });
    });
  });
}

module.exports = { runCli, resolveBinaryPath, killTree };
