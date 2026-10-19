import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './docs.css';

type DocumentKey = 'README.md' | 'ALGORITHM.md' | 'SOURCES.md';
interface DocumentEntry { title: string; path: string }
interface NavigationEntry { title: string; file: DocumentKey; section?: string; description: string }

const documents: Record<DocumentKey, DocumentEntry> = {
  'README.md': { title: '使用指南', path: '../README.md' },
  'ALGORITHM.md': { title: '算法说明', path: 'ALGORITHM.md' },
  'SOURCES.md': { title: '研究来源', path: 'SOURCES.md' },
};
const navigation: NavigationEntry[] = [
  { title: '快速开始', file: 'README.md', section: '启动与构建', description: '安装依赖、启动开发服务和构建静态站点。' },
  { title: '使用指南', file: 'README.md', section: '从颜色到色板', description: '新增颜色、设置规则、编辑色板和导入导出。' },
  { title: '算法说明', file: 'ALGORITHM.md', description: '色彩数学、顺序生长、分布分析和数据运行逻辑。' },
  { title: '研究来源', file: 'SOURCES.md', description: '色彩数学、对比度定义、浏览器能力与依赖许可。' },
];
const root = document.querySelector<HTMLDivElement>('#docs-app')!;
const docsBase = new URL('./', window.location.href);
const portalUrl = new URL('index.html', docsBase);
let currentRequest: AbortController | null = null;
let headingObserver: IntersectionObserver | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function headingSlug(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s]+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
}

function documentHref(file: DocumentKey, section?: string): string {
  const url = new URL(portalUrl);
  url.searchParams.set('file', file);
  if (section) url.hash = headingSlug(section);
  return `${url.pathname}${url.search}${url.hash}`;
}

function shell(): void {
  root.innerHTML = `
    <a class="docs-skip" href="#docs-main">跳到正文</a>
    <header class="docs-header">
      <a class="docs-brand" href="${portalUrl.pathname}" data-doc-link aria-label="色序文档首页"><span class="docs-brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>色序</strong><span class="docs-brand-divider"></span><span>文档</span></a>
      <a class="docs-back" href="../"><span aria-hidden="true">←</span> 回到工作台</a>
    </header>
    <div class="docs-layout">
      <aside class="docs-sidebar">
        <p class="docs-nav-label">项目文档</p>
        <nav id="docs-navigation" aria-label="文档目录">
          <a class="docs-nav-link" href="${portalUrl.pathname}" data-doc-link data-nav-home>文档目录</a>
          ${navigation.map(entry => `<a class="docs-nav-link" href="${documentHref(entry.file, entry.section)}" data-doc-link data-nav-file="${entry.file}" ${entry.section ? `data-nav-section="${headingSlug(entry.section)}"` : ''}>${entry.title}</a>`).join('')}
        </nav>
        <div class="docs-sidebar-note"><span class="docs-status-dot" aria-hidden="true"></span>当前版本的使用与实现说明</div>
      </aside>
      <main id="docs-main" class="docs-main" tabindex="-1"></main>
      <aside id="docs-toc" class="docs-toc" aria-label="本页目录"></aside>
    </div>`;
}

function renderHome(): void {
  document.title = '文档 · 色序';
  document.querySelector('#docs-toc')!.replaceChildren();
  const main = document.querySelector<HTMLElement>('#docs-main')!;
  main.className = 'docs-main docs-home';
  main.innerHTML = `
    <div class="docs-page-eyebrow">Course Color Studio</div>
    <h1>文档目录</h1>
    <p class="docs-lead">查看工作台操作、配色计算、文件格式与实现依据。</p>
    <section class="docs-quickstart" aria-labelledby="quickstart-title">
      <div><h2 id="quickstart-title">启动项目</h2><p>在项目目录中执行。已有依赖时，直接运行 <code>npm run dev</code>。</p></div>
      <pre><code>npm install\nnpm run dev</code></pre>
      <a href="${documentHref('README.md', '启动与构建')}" data-doc-link>环境要求与其他命令 <span aria-hidden="true">→</span></a>
    </section>
    <div class="docs-card-grid">${navigation.map(entry => `<a class="docs-card" href="${documentHref(entry.file, entry.section)}" data-doc-link><h2>${entry.title}<span aria-hidden="true">↗</span></h2><p>${entry.description}</p></a>`).join('')}</div>
    <p class="docs-home-note">文档对应当前实现，正文由项目中的 Markdown 文件渲染。</p>`;
}

function updateNavigation(file: DocumentKey | null): void {
  const hash = safeDecode(window.location.hash.slice(1));
  document.querySelectorAll<HTMLAnchorElement>('#docs-navigation a').forEach(link => {
    const section = link.dataset.navSection;
    const active = file === null ? 'navHome' in link.dataset : link.dataset.navFile === file && (!section || section === hash || (file === 'README.md' && section === headingSlug('从颜色到色板') && hash !== headingSlug('启动与构建')));
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function transformArticle(article: HTMLElement, sourceUrl: URL): void {
  const ids = new Map<string, number>();
  article.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach(heading => {
    const base = headingSlug(heading.textContent || 'section') || 'section';
    const count = ids.get(base) || 0;
    ids.set(base, count + 1);
    heading.id = count ? `${base}-${count}` : base;
    heading.dataset.headingLabel = heading.textContent || '';
    if (heading.tagName !== 'H1') {
      const permalink = document.createElement('a');
      permalink.className = 'docs-heading-link';
      permalink.href = `#${encodeURIComponent(heading.id)}`;
      permalink.setAttribute('aria-label', `链接到：${heading.textContent}`);
      permalink.textContent = '#';
      heading.append(permalink);
    }
  });
  article.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(link => {
    const originalHref = link.getAttribute('href')!;
    if (originalHref.startsWith('#')) return;
    const target = new URL(originalHref, sourceUrl);
    const known = (Object.keys(documents) as DocumentKey[]).find(key => new URL(documents[key].path, docsBase).href === `${target.origin}${target.pathname}`);
    if (known) {
      link.href = documentHref(known);
      if (target.hash) link.hash = target.hash;
      link.dataset.docLink = '';
    } else {
      link.href = target.href;
      if ((target.protocol === 'https:' || target.protocol === 'http:') && target.origin !== window.location.origin) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }
  });
  article.querySelectorAll<HTMLImageElement>('img[src]').forEach(img => {
    const target = new URL(img.getAttribute('src')!, sourceUrl);
    const publicBase = new URL('../public/', docsBase);
    // Repository README images live in public/; Vite serves them at the site root.
    img.src = target.href.startsWith(publicBase.href)
      ? new URL(target.href.slice(publicBase.href.length), new URL('../', docsBase)).href
      : target.href;
    img.loading = 'lazy';
    img.decoding = 'async';
  });
  article.querySelectorAll<HTMLTableElement>('table').forEach(table => {
    const wrapper = document.createElement('div');
    wrapper.className = 'docs-table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '数据表格，可横向滚动');
    table.replaceWith(wrapper);
    wrapper.append(table);
  });
}

function renderToc(article: HTMLElement): void {
  const toc = document.querySelector<HTMLElement>('#docs-toc')!;
  const headings = [...article.querySelectorAll<HTMLHeadingElement>('h2, h3')];
  toc.innerHTML = headings.length ? `<div class="docs-toc-inner"><p class="docs-nav-label">本页目录</p><nav>${headings.map(heading => `<a href="#${encodeURIComponent(heading.id)}" class="docs-toc-link ${heading.tagName === 'H3' ? 'is-nested' : ''}">${escapeHtml(heading.dataset.headingLabel || '')}</a>`).join('')}</nav><a class="docs-top-link" href="#docs-main">回到顶部 ↑</a></div>` : '';
  headingObserver?.disconnect();
  headingObserver = new IntersectionObserver(entries => {
    const firstVisible = entries.find(entry => entry.isIntersecting);
    if (!firstVisible) return;
    toc.querySelectorAll<HTMLAnchorElement>('.docs-toc-link').forEach(link => {
      if (safeDecode(link.hash.slice(1)) === firstVisible.target.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-90px 0px -65% 0px', threshold: 0 });
  headings.forEach(heading => headingObserver!.observe(heading));
}

function scrollToHash(): void {
  const target = document.getElementById(safeDecode(window.location.hash.slice(1)));
  if (target) target.scrollIntoView({ block: 'start' });
}

async function renderRoute(): Promise<void> {
  currentRequest?.abort();
  headingObserver?.disconnect();
  const requested = new URLSearchParams(window.location.search).get('file');
  const main = document.querySelector<HTMLElement>('#docs-main')!;
  main.removeAttribute('aria-busy');
  if (!requested) {
    renderHome();
    updateNavigation(null);
    return;
  }
  const key = Object.hasOwn(documents, requested) ? requested as DocumentKey : null;
  if (!key) {
    document.title = '未找到文档 · 色序';
    main.className = 'docs-main';
    main.innerHTML = `<div class="docs-error" role="alert"><h1>未找到这篇文档</h1><p>请选择目录中列出的项目文档。</p><a href="${portalUrl.pathname}" data-doc-link>返回文档目录</a></div>`;
    document.querySelector('#docs-toc')!.replaceChildren();
    updateNavigation(null);
    return;
  }
  updateNavigation(key);
  const entry = documents[key];
  const sourceUrl = new URL(entry.path, docsBase);
  const request = new AbortController();
  currentRequest = request;
  main.className = 'docs-main';
  main.setAttribute('aria-busy', 'true');
  main.innerHTML = `<p class="docs-loading" role="status">正在读取${entry.title}…</p>`;
  document.querySelector('#docs-toc')!.replaceChildren();
  document.title = `${entry.title} · 色序文档`;
  try {
    const response = await fetch(sourceUrl, { signal: request.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.headers.get('content-type')?.includes('text/html')) throw new Error('服务器返回了页面，而不是 Markdown 文件');
    const markdown = await response.text();
    if (request.signal.aborted) return;
    const article = document.createElement('article');
    article.className = 'docs-article';
    article.innerHTML = DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true }) as string, { USE_PROFILES: { html: true } });
    transformArticle(article, sourceUrl);
    main.innerHTML = `<div class="docs-article-meta"><a href="${portalUrl.pathname}" data-doc-link>文档目录</a><span aria-hidden="true">/</span><span>${entry.title}</span><a class="docs-source-link" href="${sourceUrl.href}">查看 Markdown ↗</a></div>`;
    main.append(article);
    renderToc(article);
    main.removeAttribute('aria-busy');
    requestAnimationFrame(scrollToHash);
  } catch (error) {
    if (request.signal.aborted) return;
    main.removeAttribute('aria-busy');
    const reason = error instanceof Error ? error.message : String(error);
    main.innerHTML = `<div class="docs-error" role="alert"><h1>文档读取失败</h1><p>无法加载 <code>${escapeHtml(entry.path)}</code>：${escapeHtml(reason)}。</p><p>请从开发服务或构建后的站点打开本页，并确认该 Markdown 文件已随站点发布。</p><div class="docs-error-actions"><button type="button" data-retry-document>重新读取</button><a href="${sourceUrl.href}">打开原文件</a><a href="${portalUrl.pathname}" data-doc-link>返回目录</a></div></div>`;
  }
}

shell();
root.addEventListener('click', event => {
  const element = event.target instanceof Element ? event.target : null;
  if (element?.closest('[data-retry-document]')) { void renderRoute(); return; }
  const link = element?.closest<HTMLAnchorElement>('a[data-doc-link]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.pushState(null, '', link.href);
  window.scrollTo({ top: 0 });
  void renderRoute();
});
window.addEventListener('popstate', () => { void renderRoute(); });
window.addEventListener('hashchange', () => {
  const key = new URLSearchParams(location.search).get('file');
  updateNavigation(key && Object.hasOwn(documents, key) ? key as DocumentKey : null);
});
void renderRoute();
