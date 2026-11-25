import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// 铁律 2：渲染结果不得在运行时发起任何网络请求。
// 因此 Three.js 走 npm 依赖由 Vite 打进 bundle，数据走同源目录，不引任何 CDN。

/** 库里实际出现的图型（docs/pitfalls.md 37）：mermaid.core.mjs 按 id→模块分块动态 import */
const KEEP_DIAGRAM_IDS = new Set(['flowchart-v2', 'flowchart-elk', 'sequence', 'mindmap', 'xychart']);

/**
 * mermaid 白名单裁剪：把非保留图型的动态 `import("./chunks/mermaid.core/xxx.mjs")` 换成一条必定失败的表达式，
 * Rollup 便不再产出那些分包。类型侦测仍在，未打包的图型走到 loader 即抛错，
 * 由 src/diagram.ts 的既有回退支接住（源码 + 一行原因，不空容器）。
 */
function mermaidWhitelist(): Plugin {
  // 模块名（mermaid 的分包名带大写哈希，如 flowDiagram-MALGAFMO）→ 剔除原因
  const drop = new Map<string, string>();
  let mapped = false;
  const IMPORT_RE = /import\("(?:\.\/chunks\/mermaid\.core\/|\.\/)([^"]+)\.mjs"\)/g;
  const strip = (mod: string) => mod.replace(/-[A-Z0-9]{6,}$/, '');
  // 图型注册在 mermaid.core.mjs，chunk 里的引用是相对的；先把那张表读出来，不依赖 hook 顺序
  const buildMap = (distDir: string) => {
    mapped = true;
    const entry = path.join(distDir, 'mermaid.core.mjs');
    if (!existsSync(entry)) return;
    const code = readFileSync(entry, 'utf8');
    // 每个图型插件块的形态固定：var idN = "<type>"; … await import("./chunks/mermaid.core/<mod>.mjs")
    const ids = [...code.matchAll(/\bvar id\d* = "([^"]+)";/g)];
    const keep = new Set<string>();
    const pending = new Map<string, string>();
    ids.forEach((m, i) => {
      const from = m.index ?? 0;
      const to = i + 1 < ids.length ? (ids[i + 1].index ?? code.length) : code.length;
      const mod = /await import\("\.\/chunks\/mermaid\.core\/([^"]+)\.mjs"\)/.exec(code.slice(from, to));
      if (!mod) return;
      if (KEEP_DIAGRAM_IDS.has(m[1])) keep.add(mod[1]);
      else pending.set(mod[1], m[1]);
    });
    pending.forEach((type, mod) => {
      if (!keep.has(mod)) drop.set(mod, `图类型 "${type}" 未打包（只保留 flowchart / graph / sequenceDiagram / mindmap / xychart-beta）`);
    });
    // 布局包只留实测用到的：flowchart→elk、mindmap→cose-bilkent、LAST_RESORT→dagre；
    // swimlane 布局全库 0 处使用（120KB），剔掉后 getRegisteredLayoutAlgorithm 自行回落
    drop.set('swimlanes', '布局 "swimlane" 未打包');
  };
  return {
    name: 'zhishu:mermaid-whitelist',
    enforce: 'pre',
    transform(code, id) {
      const file = id.replace(/\\/g, '/');
      const at = file.lastIndexOf('/node_modules/mermaid/dist/');
      if (at < 0 || !file.endsWith('.mjs')) return null;
      if (!mapped) buildMap(path.resolve(file.slice(0, at + '/node_modules/mermaid/dist'.length)));
      if (!drop.size) return null;
      let hit = 0;
      const out = code.replace(IMPORT_RE, (all, mod: string) => {
        const why = drop.get(mod) ?? drop.get(strip(mod));
        if (!why) return all;
        hit += 1;
        return `Promise.reject(new Error(${JSON.stringify(`zhishu: ${why}`)}))`;
      });
      if (hit) this.info(`mermaid 白名单：${path.posix.basename(file)} 剔除 ${hit} 处动态 import`);
      return hit ? { code: out, map: null } : null;
    },
  };
}

/**
 * 数据落盘策略（批 6 阶段 B）：不再整份复制 data/，只放运行时会取的那些族，且 JSON 预压成 .gz。
 * 运行时拼的是 `<path>.json.gz`，由 src/data.ts 用 DecompressionStream 还原；
 * dev 没有 .gz，src/data.ts 在开发态自动走明文，两边都不用改代码。
 */
const SHIP: Array<{ dir: string; match: RegExp; compress: boolean }> = [
  { dir: '', match: /^manifest\.json$/, compress: false },
  { dir: 'bodies', match: /\.json$/, compress: true },
  { dir: 'sites', match: /\.json$/, compress: true },
  // 结构分片 tools.json 在批 1 就没产过（tools 区 0 本），这里按实际存在的文件放，不凭空造
  { dir: 'dist', match: /\.json$/, compress: true },
];

function shipData(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'zhishu:ship-data',
    apply: 'build',
    configResolved(cfg) {
      root = cfg.root;
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      const src = path.resolve(root, 'data');
      let raw = 0;
      let shipped = 0;
      let files = 0;
      const missing: string[] = [];
      for (const rule of SHIP) {
        const from = path.join(src, rule.dir);
        if (!existsSync(from)) {
          missing.push(rule.dir || '/');
          continue;
        }
        const to = path.join(outDir, rule.dir);
        mkdirSync(to, { recursive: true });
        for (const name of readdirSync(from)) {
          const p = path.join(from, name);
          if (!statSync(p).isFile() || !rule.match.test(name)) continue;
          const bytes = readFileSync(p);
          raw += bytes.length;
          const body = rule.compress ? gzipSync(bytes, { level: 9 }) : bytes;
          writeFileSync(path.join(to, rule.compress ? `${name}.gz` : name), body);
          shipped += body.length;
          files += 1;
        }
      }
      const skipped = ['_report.json', 'raw/'].filter((n) => existsSync(path.join(src, n)));
      this.info(
        `数据落盘：${files} 个文件 ${(raw / 1048576).toFixed(2)}MiB → ${(shipped / 1048576).toFixed(2)}MiB` +
          `（跳过 ${skipped.join(' / ') || '无'}${missing.length ? ` · 源缺 ${missing.join(' / ')}` : ''}）`,
      );
    },
  };
}

export default defineConfig(({ command }) => ({
  root: '.',
  // dev 仍整目录暴露 data/（明文，改一处就看得见）；build 由 zhishu:ship-data 精挑
  publicDir: command === 'serve' ? 'data' : false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
  plugins: [mermaidWhitelist(), shipData()],
}));
