import { html, raw } from 'hono/html';
import { APP_NAME } from '../constants.js';

const SCRIPT = `
function adminApp() {
  return {
    token: sessionStorage.getItem('adminToken') || '',
    tokenInput: '', authed: false, loading: false, error: '',
    items: [], cursor: null, q: '', selected: [], revealed: {}, dark: false,
    confirm: { open: false, codes: [] }, toast: '',
    init() {
      this.dark = localStorage.getItem('darkMode') === 'true' || (!('darkMode' in localStorage) && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', this.dark);
      if (this.token) this.load(true);
    },
    toggleDark() { this.dark = !this.dark; localStorage.setItem('darkMode', this.dark); document.documentElement.classList.toggle('dark', this.dark); },
    async api(path, opts = {}) {
      const res = await fetch(path, { ...opts, cache: 'no-store', headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + this.token } });
      if (res.status === 401) { this.logout(); throw new Error('口令错误'); }
      if (res.status === 429) throw new Error('失败次数过多，请稍后再试');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('请求失败 ' + res.status));
      return data;
    },
    async login() {
      this.token = this.tokenInput.trim(); this.tokenInput = '';
      if (!this.token) return;
      await this.load(true);
      if (this.authed) sessionStorage.setItem('adminToken', this.token);
    },
    logout() { sessionStorage.removeItem('adminToken'); this.token = ''; this.authed = false; this.items = []; },
    async load(reset) {
      this.loading = true; this.error = '';
      try {
        if (reset) { this.items = []; this.cursor = null; this.selected = []; }
        const p = new URLSearchParams({ limit: '20' });
        if (this.q.trim()) p.set('q', this.q.trim());
        if (!reset && this.cursor) p.set('cursor', this.cursor);
        const data = await this.api('/admin/api/links?' + p);
        this.authed = true;
        this.items = this.items.concat(data.items.filter(i => !this.items.some(x => x.code === i.code)));
        this.cursor = data.cursor;
      } catch (e) { this.error = e.message; } finally { this.loading = false; }
    },
    mask(s) { return s.length <= 12 ? '••••••' : s.slice(0, 8) + '••••••' + s.slice(-4); },
    toggleSel(code) { this.selected = this.selected.includes(code) ? this.selected.filter(c => c !== code) : this.selected.concat(code); },
    ask(codes) { this.confirm = { open: true, codes }; },
    async doDelete() {
      const codes = this.confirm.codes; this.confirm = { open: false, codes: [] };
      try {
        const data = await this.api('/admin/api/links/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes }) });
        this.items = this.items.filter(i => !data.deleted.includes(i.code));
        this.selected = this.selected.filter(c => !data.deleted.includes(c));
        this.flash('已删除 ' + data.deleted.length + ' 条');
      } catch (e) { this.error = e.message; }
    },
    copy(t) { navigator.clipboard.writeText(t).then(() => this.flash('已复制')); },
    flash(m) { this.toast = m; setTimeout(() => this.toast = '', 1800); }
  };
}`;

export const AdminPage = () => html`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
<title>短链接管理 - ${APP_NAME}</title>
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet" />
<script>tailwind.config = { darkMode: 'class', theme: { extend: { colors: { primary: { 50:'#eef9ff',100:'#dcf2ff',400:'#33c5ff',500:'#0aa3eb',600:'#0082ca',700:'#0068a3',900:'#06496f' } } } } };</script>
<script>${raw(SCRIPT)}</script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.10/dist/cdn.min.js"></script>
<style>[x-cloak]{display:none!important}</style>
</head>
<body class="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen" x-data="adminApp()" x-init="init()">
<nav class="fixed top-0 w-full bg-white/80 dark:bg-gray-900/80 backdrop-blur-md shadow-sm border-b border-gray-200 dark:border-gray-800 z-40">
  <div class="container mx-auto px-4 h-16 flex items-center justify-between">
    <a href="/" class="flex items-center gap-2 text-xl font-bold"><img src="/favicon.ico" alt="" class="w-6 h-6" /><span>${APP_NAME}</span></a>
    <div class="flex items-center gap-2">
      <button x-show="authed" x-cloak x-on:click="logout()" class="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"><i class="fas fa-sign-out-alt mr-1"></i>退出</button>
      <button x-on:click="toggleDark()" class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Toggle dark mode"><i class="fas" x-bind:class="dark ? 'fa-sun' : 'fa-moon'"></i></button>
    </div>
  </div>
</nav>
<main class="container mx-auto px-4 pt-24 pb-12 max-w-4xl">
  <h1 class="text-2xl md:text-3xl font-bold mb-6">短链接管理</h1>
  <div x-show="error" x-cloak class="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm" x-text="error"></div>

  <form x-show="!authed" x-cloak x-on:submit.prevent="login()" class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
    <label class="block font-semibold" for="tk">管理口令</label>
    <input id="tk" type="password" autocomplete="current-password" x-model="tokenInput" class="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-2 focus:ring-primary-500" placeholder="输入 ADMIN_TOKEN" />
    <button class="w-full sm:w-auto px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium" x-bind:disabled="loading">登录</button>
    <p class="text-xs text-gray-500">口令只保存在当前标签页（sessionStorage），关闭标签页即失效。</p>
  </form>

  <div x-show="authed" x-cloak class="space-y-4">
    <form x-on:submit.prevent="load(true)" class="flex flex-col sm:flex-row gap-2">
      <input type="search" x-model="q" placeholder="搜索短码、订阅域名、节点或参数…" class="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500" />
      <div class="flex gap-2">
        <button class="flex-1 sm:flex-none px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg"><i class="fas fa-search mr-1"></i>搜索</button>
        <button type="button" x-show="selected.length" x-on:click="ask(selected.slice())" class="flex-1 sm:flex-none px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"><i class="fas fa-trash mr-1"></i>删除所选 (<span x-text="selected.length"></span>)</button>
      </div>
    </form>

    <template x-if="!loading && items.length === 0"><p class="text-center text-gray-500 py-10">没有找到短链接</p></template>

    <template x-for="item in items" x-bind:key="item.code">
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <label class="flex items-center gap-2 font-mono font-semibold text-lg break-all">
            <input type="checkbox" class="w-4 h-4" x-bind:checked="selected.includes(item.code)" x-on:change="toggleSel(item.code)" />
            <span x-text="item.code"></span>
          </label>
          <button x-on:click="ask([item.code])" class="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><i class="fas fa-trash-alt mr-1"></i>删除</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <template x-for="[target, url] in Object.entries(item.links)" x-bind:key="target">
            <button type="button" x-on:click="copy(url)" class="text-left px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 hover:bg-primary-50 dark:hover:bg-primary-900/20 break-all" title="点击复制">
              <span class="font-medium text-primary-600 dark:text-primary-400" x-text="target"></span>
              <span class="text-gray-500 ml-1" x-text="url"></span>
            </button>
          </template>
        </div>
        <div class="text-sm">
          <div class="flex items-center justify-between mb-1">
            <span class="font-medium">订阅 / 节点 (<span x-text="item.sources.length"></span>)</span>
            <button type="button" x-on:click="revealed[item.code] = !revealed[item.code]" class="text-primary-600 dark:text-primary-400 text-xs"><i class="fas" x-bind:class="revealed[item.code] ? 'fa-eye-slash' : 'fa-eye'"></i> <span x-text="revealed[item.code] ? '隐藏' : '显示'"></span></button>
          </div>
          <div class="text-xs text-gray-500 mb-1" x-show="item.hosts.length">域名：<span x-text="item.hosts.join(', ')"></span></div>
          <ul class="font-mono text-xs space-y-1 max-h-48 overflow-auto">
            <template x-for="(s, i) in item.sources" x-bind:key="i"><li class="break-all bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded" x-text="revealed[item.code] ? s : mask(s)"></li></template>
          </ul>
        </div>
        <details class="text-xs" x-show="Object.keys(item.params).length">
          <summary class="cursor-pointer text-gray-500">其他参数</summary>
          <pre class="mt-1 p-2 bg-gray-50 dark:bg-gray-900 rounded overflow-auto whitespace-pre-wrap break-all" x-text="JSON.stringify(item.params, null, 2)"></pre>
        </details>
      </div>
    </template>

    <div class="text-center">
      <button x-show="cursor && !loading" x-on:click="load(false)" class="px-6 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700">加载更多</button>
      <i x-show="loading" class="fas fa-spinner fa-spin text-gray-400"></i>
    </div>
  </div>
</main>

<div x-show="confirm.open" x-cloak class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" x-on:keydown.escape.window="confirm.open = false">
  <div class="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full space-y-4" x-on:click.outside="confirm.open = false">
    <h2 class="text-lg font-semibold">确认删除</h2>
    <p class="text-sm text-gray-600 dark:text-gray-300">将永久删除 <b x-text="confirm.codes.length"></b> 条短链接（<span class="font-mono break-all" x-text="confirm.codes.join(', ')"></span>），使用它们的订阅将失效，无法恢复。</p>
    <div class="flex justify-end gap-2">
      <button x-on:click="confirm.open = false" class="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700">取消</button>
      <button x-on:click="doDelete()" class="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white">删除</button>
    </div>
  </div>
</div>
<div x-show="toast" x-cloak class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg z-50" x-text="toast"></div>
</body>
</html>`;
