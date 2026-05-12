import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..', '..');
const workflowPath = resolve(ROOT, '.github', 'workflows', 'release.yml');

describe('Release workflow (.github/workflows/release.yml)', () => {
  it('.github/workflows/ 目录应存在', () => {
    const dirPath = resolve(ROOT, '.github', 'workflows');
    expect(existsSync(dirPath)).toBe(true);
  });

  it('release.yml 文件应存在', () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  it('YAML 语法应有效', () => {
    // Windows 上常见仅有 `python`，Unix 上多为 `python3`；路径用 / 避免 Python 字符串转义问题
    const pathForPy = workflowPath.replace(/\\/g, '/');
    const snippet = `import yaml; yaml.safe_load(open('${pathForPy}', encoding='utf-8'))`;
    let ok = false;
    let lastErr = '';
    for (const py of ['python3', 'python'] as const) {
      try {
        execSync(`${py} -c "${snippet}"`, { encoding: 'utf-8', cwd: ROOT });
        ok = true;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    expect(ok, `YAML 校验失败（需已安装 PyYAML 的 Python）。已尝试 python3、python。${lastErr}`).toBe(
      true,
    );
  });

  describe('workflow 内容验证', () => {
    let content: string;

    it('应能读取文件内容', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toBeTruthy();
    });

    it('name 应为 Release', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('name: Release');
    });

    it('应使用 workflow_dispatch 触发', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('workflow_dispatch:');
    });

    it('应包含 version_type 输入参数', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('version_type:');
      expect(content).toContain("default: 'auto'");
      expect(content).toContain('type: choice');
    });

    it('应包含 auto/patch/minor/major 选项', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('- auto');
      expect(content).toContain('- patch');
      expect(content).toContain('- minor');
      expect(content).toContain('- major');
    });

    it('应设置 contents: write 和 id-token: write 权限', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('contents: write');
      expect(content).toContain('id-token: write');
    });

    it('应在 ubuntu-latest 上运行', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('runs-on: ubuntu-latest');
    });

    it('应使用 actions/checkout@v4 并设置 fetch-depth: 0', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('actions/checkout@v4');
      expect(content).toContain('fetch-depth: 0');
    });

    it('应使用 pnpm/action-setup@v4 版本 10', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('pnpm/action-setup@v4');
      expect(content).toContain('version: 10');
    });

    it('应使用 actions/setup-node@v4 配置 node 22 和 pnpm 缓存', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('actions/setup-node@v4');
      expect(content).toContain('node-version: 22');
      expect(content).toContain("cache: 'pnpm'");
      expect(content).toContain("registry-url: 'https://registry.npmjs.org'");
    });

    it('应运行 pnpm install --frozen-lockfile', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('pnpm install --frozen-lockfile');
    });

    it('应运行测试', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('pnpm test');
    });

    it('应配置 git 用户为 github-actions[bot]', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('git config user.name "github-actions[bot]"');
      expect(content).toContain(
        'git config user.email "github-actions[bot]@users.noreply.github.com"',
      );
    });

    it('应包含 release-it 条件执行逻辑', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('npx release-it --ci --increment "$VERSION_TYPE"');
      expect(content).toContain('npx release-it --ci');
    });

    it('应设置所有必需的环境变量', () => {
      content = readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
      expect(content).toContain('NPM_TOKEN: ${{ secrets.NPM_TOKEN }}');
      expect(content).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');
      expect(content).toContain('LLM_API_KEY: ${{ secrets.LLM_API_KEY }}');
      expect(content).toContain('LLM_API_URL: ${{ secrets.LLM_API_URL }}');
      expect(content).toContain('LLM_MODEL: ${{ secrets.LLM_MODEL }}');
      expect(content).toContain(
        'VERSION_TYPE: ${{ github.event.inputs.version_type }}',
      );
    });
  });
});
