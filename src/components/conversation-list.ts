// src/components/conversation-list.ts
import chalk from 'chalk';
import readline from 'readline';
import { writeFile } from 'fs/promises';
import { formatDateTime, formatSize, formatTokens, formatDuration } from '../utils/format.js';
import { t, type Language } from '../utils/i18n.js';
import { exportConversation, getFileExtension } from '../exporters/index.js';
import { parseConversation } from '../core/parser.js';
import { analyzeConversation, formatAnalysisResult } from '../llm/analyzer.js';
import type { Project, ConversationSummary, ExportOptions } from '../models/types.js';
import { showBanner } from './banner.js';
import { getLanguage, getActiveLLMProvider } from '../utils/settings.js';
import { waitForKeypress, isCtrlC, beginRender, printLine, flushRender } from '../utils/terminal.js';
import { deleteConversationFromDisk, removeConversationFromProject } from '../core/conversation-delete.js';

// 获取当前语言
function getLang(): Language {
  return getLanguage();
}

// 对话列表操作结果
export type ConversationListResult =
  | { action: 'back' }
  | { action: 'main' }
  | { action: 'quit' };

// 格式化对话显示
function formatConversationItem(
  index: number,
  conv: ConversationSummary,
  lang: Language
): string {
  const time = formatDateTime(conv.startTime);
  const title = conv.slug || conv.sessionId.slice(0, 8);
  const msgs = `${conv.messageCount} ${t('msgs', lang)}`;
  return `  ${(index + 1).toString().padStart(2)}. ${time}  ${title} (${msgs})`;
}

// 渲染信息面板（10 行）
function renderInfoPanel(conv: ConversationSummary): void {
  const lang = getLang();
  const width = Math.min(process.stdout.columns || 60, 60);
  const line = '─'.repeat(width);

  printLine(chalk.gray(line));
  printLine(chalk.bold(` ${t('conversationInfo', lang)}`));
  printLine(chalk.gray(line));

  // 第一行：开始时间 + 时长
  const startTimeLabel = `${t('startTime', lang)}:`;
  const durationLabel = `${t('duration', lang)}:`;
  printLine(` ${chalk.gray(startTimeLabel)} ${formatDateTime(conv.startTime)}    ${chalk.gray(durationLabel)} ${formatDuration(conv.duration)}`);

  // 第二行：消息数量 + 文件大小
  const msgCountLabel = `${t('messageCount', lang)}:`;
  const sizeLabel = `${t('fileSize', lang)}:`;
  printLine(` ${chalk.gray(msgCountLabel)} ${conv.messageCount}    ${chalk.gray(sizeLabel)} ${formatSize(conv.fileSize)}`);

  // 第三行：Token 统计
  const inputLabel = t('inputTokens', lang);
  const outputLabel = t('outputTokens', lang);
  printLine(` ${chalk.gray('Token:')} ${inputLabel} ${formatTokens(conv.totalTokens.input_tokens)} / ${outputLabel} ${formatTokens(conv.totalTokens.output_tokens)}`);

  printLine(chalk.gray(line));

  // 首条消息
  printLine(` ${chalk.gray(t('firstMessage', lang) + ':')}`);
  printLine(` ${chalk.dim(conv.firstUserMessage || t('none', lang))}`);
  printLine(chalk.gray(line));
}

// AI 分析
async function performAnalysis(
  project: Project,
  conv: ConversationSummary
): Promise<void> {
  const lang = getLang();
  const provider = getActiveLLMProvider();

  // 检查 LLM 配置
  if (!provider) {
    console.log(chalk.yellow(`\n  ${t('llmNotConfigured', lang)}`));
    await waitForKeypress();
    return;
  }

  // 解析完整会话
  const conversation = await parseConversation(conv.filePath, project.originalPath);

  if (conversation.messages.length === 0) {
    console.log(chalk.yellow(`\n  ${t('analysisNoData', lang)}`));
    await waitForKeypress();
    return;
  }

  console.log();

  // 定义分析阶段名称
  const phaseNames: Record<string, string> = {
    timeline: t('analysisTimeline', lang),
    patterns: t('analysisPatterns', lang),
    knowledge: t('analysisKnowledge', lang),
    quality: t('analysisQuality', lang),
  };

  let currentPhase = '';

  try {
    // 流式输出分析结果
    const result = await analyzeConversation(
      conversation,
      provider,
      lang,
      (phase, chunk) => {
        if (phase !== currentPhase) {
          currentPhase = phase;
          console.log();
          console.log(chalk.bold.cyan(`  ── ${phaseNames[phase] || phase} ──`));
          console.log();
        }
        process.stdout.write(chunk);
      }
    );

    console.log('\n');

    // 询问是否保存
    console.log(`  ${t('analysisSavePrompt', lang)} [y/n]`);
    const key = await waitForKeypress();

    if (key.toLowerCase() === 'y') {
      const markdown = formatAnalysisResult(result, conversation, lang);
      const outputPath = `${conv.slug || conv.sessionId}-analysis.md`;
      await writeFile(outputPath, markdown, 'utf-8');
      console.log(chalk.green(`  ✓ ${t('analysisSaved', lang)} ${outputPath}`));
      await waitForKeypress();
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n  Error: ${errMsg}`));
    await waitForKeypress();
  }
}

// 快速导出（使用默认格式 Markdown）
async function quickExport(
  project: Project,
  conv: ConversationSummary
): Promise<void> {
  const conversation = await parseConversation(conv.filePath, project.originalPath);
  const outputPath = `${conv.slug || conv.sessionId}.md`;

  const exportOptions: ExportOptions = {
    format: 'markdown',
    includeThinking: true,
    includeToolCalls: true,
    includeSubagents: false,
    outputPath,
    verboseTools: false,
    language: getLang(),
  };

  await exportConversation(conversation, exportOptions);
  console.log(chalk.green(`✓ ${t('exported', getLang())}: ${outputPath}`));

  await waitForKeypress();
}

// 导出选项（选择格式）
async function exportWithOptions(
  project: Project,
  conv: ConversationSummary
): Promise<void> {
  console.log();
  console.log(`${t('exportFormat', getLang())}: [M]arkdown  [J]SON  [H]TML`);

  const key = await waitForKeypress();
  let format: 'markdown' | 'json' | 'html' = 'markdown';

  if (key === 'j' || key === 'J') {
    format = 'json';
  } else if (key === 'h' || key === 'H') {
    format = 'html';
  }

  const conversation = await parseConversation(conv.filePath, project.originalPath);
  const outputPath = `${conv.slug || conv.sessionId}${getFileExtension(format)}`;

  const exportOptions: ExportOptions = {
    format,
    includeThinking: true,
    includeToolCalls: true,
    includeSubagents: false,
    outputPath,
    verboseTools: false,
    language: getLang(),
  };

  await exportConversation(conversation, exportOptions);
  console.log(chalk.green(`✓ ${t('exported', getLang())}: ${outputPath}`));

  await waitForKeypress();
}

// 确认后删除本地对话文件
async function confirmAndDelete(project: Project, conv: ConversationSummary): Promise<void> {
  const lang = getLang();
  console.log();
  console.log(chalk.yellow(`  ${t('deleteConversationConfirm', lang)}`));
  const key = await waitForKeypress();
  if (key.toLowerCase() !== 'y') {
    console.log(chalk.gray(`  ${t('deleteCancelled', lang)}`));
    await waitForKeypress();
    return;
  }
  try {
    await deleteConversationFromDisk(project, conv);
    removeConversationFromProject(project, conv);
    console.log(chalk.green(`  ${t('deleteSuccess', lang)}`));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`  ${t('deleteFailed', lang)}: ${errMsg}`));
  }
  await waitForKeypress();
}

// 渲染对话列表界面
function renderList(
  project: Project,
  conversations: ConversationSummary[],
  selectedIndex: number,
  searchTerm: string
): void {
  beginRender();
  showBanner();

  // 标题
  const deletedTag = project.isDeleted ? chalk.red(` [${t('deleted', getLang())}]`) : '';
  printLine(chalk.bold.blue(`📁 ${project.name}`) + deletedTag);
  printLine(chalk.gray(`  ${project.originalPath}`));
  printLine(chalk.bold('─'.repeat(40)));
  printLine();

  // 搜索栏
  if (searchTerm) {
    printLine(chalk.cyan(`${t('searchPlaceholder', getLang())}: ${searchTerm}_`));
    printLine();
  }

  // 动态计算可见行数（修正：banner 实际为 6 行，非注释中的 4 行）
  const termRows = process.stdout.rows || 24;
  const bannerHeight = 6;
  const projectHeaderHeight = 4;  // name + path + separator + empty
  const searchHeight = searchTerm ? 2 : 0;
  const infoBoxHeight = 10;       // renderInfoPanel 固定 10 行
  const footerHeight = 2;         // 空行 + 快捷键
  const overhead = bannerHeight + projectHeaderHeight + searchHeight + infoBoxHeight + footerHeight;
  const maxVisible = Math.min(15, Math.max(3, termRows - overhead));

  // 对话列表
  if (conversations.length === 0) {
    printLine(chalk.yellow(searchTerm ? t('noMatchingConversations', getLang()) : t('noConversationsFound', getLang())));
  } else {
    // 计算滚动视口的起始位置，确保选中项始终可见
    let startIndex = 0;
    if (selectedIndex >= maxVisible) {
      startIndex = selectedIndex - maxVisible + 1;
    }
    const endIndex = Math.min(startIndex + maxVisible, conversations.length);

    // 显示上方省略提示
    if (startIndex > 0) {
      printLine(chalk.gray(`  ... ${startIndex} ${t('moreItemsAbove', getLang())}`));
    }

    for (let i = startIndex; i < endIndex; i++) {
      const line = formatConversationItem(i, conversations[i], getLang());
      if (i === selectedIndex) {
        printLine(chalk.bgBlue.white(line));
      } else {
        printLine(line);
      }
    }

    // 显示下方省略提示
    if (endIndex < conversations.length) {
      printLine(chalk.gray(`  ... ${conversations.length - endIndex} ${t('more', getLang())}`));
    }
  }

  printLine();

  // 渲染信息面板
  if (conversations.length > 0) {
    renderInfoPanel(conversations[selectedIndex]);
  }

  // 快捷键提示
  printLine(chalk.gray(searchTerm ? t('shortcutsSearch', getLang()) : t('shortcuts', getLang())));

  // 缓冲区超出终端高度时保留末尾：列表与信息区之间的空行 + 信息面板 + 底部快捷键
  const tailLines =
    conversations.length > 0 ? 12 : 3;
  flushRender({ preserveTailLines: tailLines });
}

// 主函数：显示对话列表
export async function showConversationList(
  project: Project
): Promise<ConversationListResult> {
  let selectedIndex = 0;
  let searchTerm = '';
  let filteredConversations = [...project.conversations];

  // 过滤对话
  function filterConversations(): void {
    if (!searchTerm) {
      filteredConversations = [...project.conversations];
    } else {
      const term = searchTerm.toLowerCase();
      filteredConversations = project.conversations.filter(c =>
        (c.slug && c.slug.toLowerCase().includes(term)) ||
        c.sessionId.toLowerCase().includes(term)
      );
    }
    // 重置选择索引
    selectedIndex = Math.min(selectedIndex, Math.max(0, filteredConversations.length - 1));
  }

  // 设置终端为 raw mode
  process.stdin.setRawMode(true);
  process.stdin.resume();
  readline.emitKeypressEvents(process.stdin);

  return new Promise(resolve => {
    const handleKeypress = async (str: string | undefined, key: readline.Key) => {
      // Ctrl+C 安全退出
      if (isCtrlC(str, key)) {
        process.stdin.removeListener('keypress', handleKeypress);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve({ action: 'quit' });
        return;
      }

      // 计算可见行数用于翻页（与 renderList 保持一致）
      const termRows = process.stdout.rows || 24;
      const bannerHeight = 6;
      const projectHeaderHeight = 4;
      const searchHeight = searchTerm ? 2 : 0;
      const infoBoxHeight = 10;
      const footerHeight = 2;
      const overhead = bannerHeight + projectHeaderHeight + searchHeight + infoBoxHeight + footerHeight;
      const maxVisible = Math.min(15, Math.max(3, termRows - overhead));

      // 搜索模式下的按键处理
      if (searchTerm !== '') {
        if (key.name === 'escape') {
          searchTerm = '';
          filterConversations();
          renderList(project, filteredConversations, selectedIndex, searchTerm);
          return;
        }
        if (key.name === 'return') {
          // 搜索模式下按回车仅重新渲染（信息已自动显示）
          renderList(project, filteredConversations, selectedIndex, searchTerm);
          return;
        }
        if (key.name === 'backspace') {
          searchTerm = searchTerm.slice(0, -1);
          filterConversations();
          renderList(project, filteredConversations, selectedIndex, searchTerm);
          return;
        }
        if (str && str.length === 1 && !key.ctrl && !key.meta) {
          if (str === '/' && searchTerm === '') {
            // 进入搜索模式
            renderList(project, filteredConversations, selectedIndex, searchTerm);
            return;
          }
          searchTerm += str;
          filterConversations();
          renderList(project, filteredConversations, selectedIndex, searchTerm);
          return;
        }
      }

      // 普通模式下的按键处理
      switch (key.name) {
        case 'up':
          selectedIndex = Math.max(0, selectedIndex - 1);
          renderList(project, filteredConversations, selectedIndex, searchTerm);
          break;
        case 'down':
          selectedIndex = Math.min(filteredConversations.length - 1, selectedIndex + 1);
          renderList(project, filteredConversations, selectedIndex, searchTerm);
          break;
        case 'left':
          // 向上翻页
          selectedIndex = Math.max(0, selectedIndex - maxVisible);
          renderList(project, filteredConversations, selectedIndex, searchTerm);
          break;
        case 'right':
          // 向下翻页
          selectedIndex = Math.min(filteredConversations.length - 1, selectedIndex + maxVisible);
          renderList(project, filteredConversations, selectedIndex, searchTerm);
          break;
        default:
          // 字符按键
          if (str) {
            // 大写 E：选择导出格式（须在 toLowerCase 之前判断，否则与 e 混淆）
            if (str === 'E' && !key.ctrl && !key.meta) {
              if (filteredConversations.length > 0) {
                process.stdin.removeListener('keypress', handleKeypress);
                process.stdin.setRawMode(false);
                await exportWithOptions(project, filteredConversations[selectedIndex]);
                process.stdin.setRawMode(true);
                process.stdin.on('keypress', handleKeypress);
                renderList(project, filteredConversations, selectedIndex, searchTerm);
              }
              return;
            }

            const char = str.toLowerCase();

            // 数字快捷选择 1-9
            if (char >= '1' && char <= '9') {
              const idx = parseInt(char) - 1;
              if (idx < filteredConversations.length) {
                selectedIndex = idx;
                renderList(project, filteredConversations, selectedIndex, searchTerm);
              }
              return;
            }

            switch (char) {
              case 'b':
                // 返回
                process.stdin.removeListener('keypress', handleKeypress);
                process.stdin.setRawMode(false);
                resolve({ action: 'back' });
                return;
              case 'q':
                process.stdin.removeListener('keypress', handleKeypress);
                process.stdin.setRawMode(false);
                process.stdin.pause();
                resolve({ action: 'quit' });
                return;
              case 'h':
                process.stdin.removeListener('keypress', handleKeypress);
                process.stdin.setRawMode(false);
                resolve({ action: 'main' });
                return;
              case 'e':
                if (filteredConversations.length > 0) {
                  process.stdin.removeListener('keypress', handleKeypress);
                  process.stdin.setRawMode(false);
                  await quickExport(project, filteredConversations[selectedIndex]);
                  process.stdin.setRawMode(true);
                  process.stdin.on('keypress', handleKeypress);
                  renderList(project, filteredConversations, selectedIndex, searchTerm);
                }
                break;
              case 'a':
                if (filteredConversations.length > 0) {
                  process.stdin.removeListener('keypress', handleKeypress);
                  process.stdin.setRawMode(false);
                  await performAnalysis(project, filteredConversations[selectedIndex]);
                  process.stdin.setRawMode(true);
                  process.stdin.on('keypress', handleKeypress);
                  renderList(project, filteredConversations, selectedIndex, searchTerm);
                }
                break;
              case 'd':
                if (filteredConversations.length > 0) {
                  process.stdin.removeListener('keypress', handleKeypress);
                  process.stdin.setRawMode(false);
                  await confirmAndDelete(project, filteredConversations[selectedIndex]);
                  filterConversations();
                  selectedIndex = Math.min(
                    selectedIndex,
                    Math.max(0, filteredConversations.length - 1)
                  );
                  process.stdin.setRawMode(true);
                  process.stdin.on('keypress', handleKeypress);
                  renderList(project, filteredConversations, selectedIndex, searchTerm);
                }
                break;
            }
          }
      }
    };

    process.stdin.on('keypress', handleKeypress);

    // 初始渲染
    renderList(project, filteredConversations, selectedIndex, searchTerm);
  });
}
