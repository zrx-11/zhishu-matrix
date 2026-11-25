import { sanitizeSvg } from './render';

// 批 3.5 A 阶段：mermaid 只在阅读页围栏进入视口后才动态引入，主 entry chunk 不含它（判据 A1/A5）。
type MermaidApi = typeof import('mermaid').default;

const CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict' as const,
  suppressErrorRendering: true,
  theme: 'dark' as const,
  htmlLabels: false,
  fontFamily: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
};

let modulePromise: Promise<MermaidApi> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let uid = 0;
let observer: IntersectionObserver | null = null;

export const mermaidRequested = (): boolean => modulePromise !== null;

function loadMermaid(): Promise<MermaidApi> {
  if (!modulePromise) {
    modulePromise = import('mermaid')
      .then((mod) => {
        const mermaid = mod.default;
        mermaid.initialize(CONFIG);
        return mermaid;
      })
      .catch((err) => {
        // 加载失败不留永久 rejected promise：下一个围栏还能重试
        modulePromise = null;
        throw err;
      });
  }
  return modulePromise;
}

function reason(err: unknown): string {
  const text = String(err instanceof Error ? err.message : err).replace(/\s+/g, ' ').trim();
  return text.slice(0, 160) || '未知错误';
}

/** 串行渲染：mermaid 复用同一批临时 DOM 节点，并发 render 会互相踩 */
function scheduleRender(source: string): Promise<string> {
  const task = queue.then(async () => {
    const mermaid = await loadMermaid();
    const id = `zs-diagram-${(uid += 1)}`;
    const out = await mermaid.render(id, source);
    const svg = typeof out === 'string' ? out : out.svg;
    if (!svg || svg.includes('Syntax error in text')) {
      throw new Error('Mermaid 语法解析失败或该图类型不受支持');
    }
    return sanitizeSvg(svg);
  });
  queue = task.catch(() => undefined);
  return task;
}

export type DiagramResult = { svg: string | null; error: string | null; kind: string };

export function diagramKind(source: string): string {
  const first = source.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first.split(/[\s;{]/)[0].slice(0, 24) || 'unknown';
}

/** 供自检与合成样本直接调：成功给消毒后的 SVG，失败给一行原因 */
export async function renderDiagram(source: string): Promise<DiagramResult> {
  const kind = diagramKind(source);
  try {
    return { svg: await scheduleRender(source), error: null, kind };
  } catch (err) {
    return { svg: null, error: reason(err), kind };
  }
}

function fail(el: HTMLElement, view: HTMLElement, source: string, why: string): void {
  view.innerHTML =
    `<pre class="code"><code>${source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>` +
    `<div class="diagram-err">渲染失败：${why} — 已回退为源码，内容未丢</div>`;
  el.dataset.diagram = 'error';
  const cap = el.querySelector('.diagram-cap');
  if (cap) cap.textContent = `图示 · Mermaid ${diagramKind(source)} · 渲染失败已回退源码`;
}

async function renderInto(el: HTMLElement): Promise<void> {
  const view = el.querySelector<HTMLElement>('.diagram-view');
  const source = (el.querySelector('.diagram-src')?.textContent ?? '').replace(/\s+$/, '');
  if (!view) return;
  if (!source.trim()) {
    el.dataset.diagram = 'empty';
    view.innerHTML = '<div class="diagram-err">围栏为空，源码未收录。</div>';
    return;
  }
  el.dataset.diagram = 'loading';
  el.dataset.kind = diagramKind(source);
  view.innerHTML = `<div class="diagram-hint">图示渲染中 · ${diagramKind(source)}（本地 mermaid 分包，不引 CDN）</div>`;
  const result = await renderDiagram(source);
  if (result.svg) {
    view.innerHTML = result.svg;
    el.dataset.diagram = 'done';
    const cap = el.querySelector('.diagram-cap');
    if (cap) cap.textContent = `图示 · Mermaid ${result.kind} · 本地渲染 SVG`;
  } else {
    fail(el, view, source, result.error ?? '未知错误');
  }
}

function ensureObserver(): void {
  if (observer || typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        void renderInto(entry.target as HTMLElement).catch((err) => {
          const el = entry.target as HTMLElement;
          fail(el, el.querySelector('.diagram-view') ?? el, '', reason(err));
        });
      }
    },
    { root: null, rootMargin: '160px 0px', threshold: 0.01 },
  );
}

/** 正文注入后调用：只登记待渲染围栏，可见那一刻才把 mermaid 拉进运行时 */
export function hydrateDiagrams(root: ParentNode): void {
  ensureObserver();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.diagram[data-diagram="pending"]'))) {
    if (observer) {
      el.dataset.diagram = 'watching';
      observer.observe(el);
    } else {
      void renderInto(el);
    }
  }
}

export function forgetDiagrams(root: ParentNode): void {
  if (!observer) return;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.diagram[data-diagram="watching"]'))) {
    observer.unobserve(el);
  }
}
