import type readline from 'readline';
import chalk from 'chalk';

// TUI 模式状态标志
let inTUI = false;

// 重置终端状态
function resetTerminal(): void {
  if (process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
}

// 集中式退出函数
export function exitApp(code: number = 0): void {
  exitTUI();       // 先恢复原始屏幕
  resetTerminal(); // 再重置终端状态
  process.exit(code);
}

// 等待用户按键，返回按键字符
// 注意：Ctrl+C 在此函数中触发 exitApp()，确保任何等待场景下都能安全退出
// exitApp() 内部调用 exitTUI()，inTUI 标志保证非 TUI 上下文中调用也是安全的（no-op）
export function waitForKeypress(): Promise<string> {
  return new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.setRawMode(false);
      const str = data.toString();
      if (str === '\x03') {
        exitApp(0);
      }
      resolve(str);
    });
  });
}

// 判断是否为 Ctrl+C 按键（用于 keypress 事件处理器中）
export function isCtrlC(_str: string | undefined, key: readline.Key): boolean {
  return key.ctrl === true && key.name === 'c';
}

// 注册全局 SIGINT 处理器（非 raw mode 下生效）
export function registerSigintHandler(): void {
  process.on('SIGINT', () => {
    exitApp(0);
  });
}

// 进入 TUI 模式（切换到备用屏幕缓冲区）
// 包含 TTY 检测：非 TTY 环境（管道、CI）下为 no-op，避免输出 ANSI 垃圾
export function enterTUI(): void {
  if (!process.stdout.isTTY) return;
  inTUI = true;
  process.stdout.write('\x1b[?1049h'); // 切换备用屏幕
  process.stdout.write('\x1b[H');      // 光标归位
}

// 退出 TUI 模式（恢复原始屏幕缓冲区）
export function exitTUI(): void {
  if (inTUI) {
    inTUI = false;
    process.stdout.write('\x1b[?25h');   // 确保光标可见（防止隐藏状态泄漏到原始屏幕）
    process.stdout.write('\x1b[?1049l'); // 恢复原始屏幕
  }
}

// 清屏（在备用屏幕中使用，不污染滚动历史）
export function clearScreen(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[2J\x1b[H'); // 擦除整屏 + 光标归位
}

// 屏幕渲染缓冲区（null 表示未处于缓冲渲染模式）
let screenBuffer: string[] | null = null;

// 开始缓冲渲染（后续 printLine 调用将写入缓冲区）
// 若存在未 flush 的旧缓冲（如前次渲染异常中断），自动重置
export function beginRender(): void {
  screenBuffer = [];
}

// 输出一行：缓冲模式下写入缓冲区，否则直接 console.log
export function printLine(text: string = ''): void {
  if (screenBuffer !== null) {
    screenBuffer.push(text);
  } else {
    console.log(text);
  }
}

/** flushRender 可选参数：超出终端高度时保留缓冲区末尾若干行 */
export interface FlushRenderOptions {
  preserveTailLines?: number;
}

// 将缓冲区内容一次性写入屏幕，截断至终端高度，防止溢出滚动
export function flushRender(options?: FlushRenderOptions): void {
  if (screenBuffer === null) return;

  if (!process.stdout.isTTY) {
    process.stdout.write(screenBuffer.join('\n') + '\n');
    screenBuffer = null;
    return;
  }

  const maxRows = (process.stdout.rows || 24) - 1; // 留一行余量防止边界滚动
  const preserveTailLines = options?.preserveTailLines ?? 0;
  let lines = screenBuffer;

  if (lines.length > maxRows && preserveTailLines > 0) {
    const tailLen = Math.min(preserveTailLines, lines.length);
    const tail = lines.slice(-tailLen);
    const sepLines = 1;
    const headBudget = maxRows - tail.length - sepLines;
    if (headBudget >= 1) {
      const head = lines.slice(0, headBudget);
      lines = [...head, chalk.gray('  ...'), ...tail];
    } else {
      lines = tail.slice(-maxRows);
    }
  } else if (lines.length > maxRows) {
    lines = lines.slice(0, maxRows);
  }

  // 合并为单次写入，减少系统调用，确保原子更新
  process.stdout.write(
    '\x1b[?25l'
    + '\x1b[H'
    + lines.map(l => l + '\x1b[K').join('\n')
    + '\x1b[J'
  );

  screenBuffer = null;
}
