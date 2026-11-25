// dsh-ssh-file-manager — Client half.
//
// Registers the sidebar entry "SSH 远程文件" (a panellist icon) and the main
// panel it opens: one directory tree on the left, one preview on the right,
// multi-select, context menu, keyboard shortcuts, drag-and-drop upload and a
// selection bar with download / copy / cut / paste / rename / delete.
//
// It talks to the Host half over `/x-ssh-files/*` (same-origin fetch), so it
// never imports another Harness Client package: React comes from the browser
// module table and every control is local markup styled with theme tokens.
window.__ModuleLoader__.load({
  id: 'dsh-ssh-file-manager',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const BASE = '/x-ssh-files';
    const PANEL_ID = 'ssh-files';
    const NS = 'ssh-files';
    const SOURCE_STORAGE_KEY = 'dsh.ssh-files.source.v1';
    const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg']);

    // ─────────────────────────────────────────────────────────── localization
    const ZH = {
      'panel.title': 'SSH 远程文件',
      'source.label': '来源',
      'source.workspace': '工作区',
      'source.host': '主机',
      'source.none': '还没有可用的 SSH 主机。请先在 设置 → SSH 连接 中添加主机。',
      'source.workspaceMissing': '该工作区对应的主机已不在 SSH 连接列表中。',
      'action.refresh': '刷新',
      'action.upload': '上传文件',
      'action.newFolder': '新建文件夹',
      'action.newFile': '新建文件',
      'action.download': '下载',
      'action.copy': '复制',
      'action.cut': '剪切',
      'action.paste': '粘贴',
      'action.pasteInto': '粘贴到 {dir}',
      'action.rename': '重命名',
      'action.remove': '删除',
      'action.copyPath': '复制路径',
      'action.up': '上级',
      'msg.badPath': '请输入以 / 开头的绝对路径',
      'action.expand': '展开',
      'action.collapse': '收起',
      'action.retry': '重试',
      'action.overwrite': '覆盖',
      'action.skip': '跳过',
      'state.loading': '读取中…',
      'state.empty': '空目录',
      'state.noSelection': '未选择项目',
      'state.selected': '已选 {count} 项',
      'state.noPreview': '选择左侧的文件即可在此预览',
      'state.binary': '二进制文件，无法预览内容',
      'state.truncated': '文件较大，仅显示前 {bytes}',
      'state.truncatedList': '仅显示前 {count} 项',
      'state.imageFailed': '图片加载失败',
      'state.directory': '这是一个目录',
      'state.busy': '处理中…',
      'state.dropHint': '松开即可上传到 {dir}',
      'preview.modified': '修改时间',
      'dialog.newFolderTitle': '新建文件夹',
      'dialog.newFileTitle': '新建文件',
      'dialog.renameTitle': '重命名',
      'dialog.removeTitle': '删除',
      'dialog.name': '名称',
      'dialog.nameRequired': '请输入名称',
      'dialog.target': '目标目录：{dir}',
      'dialog.removeBody': '确定删除 {count} 项？此操作不可恢复。',
      'dialog.removeRecursive': '选中的文件夹及其全部内容都会被删除。',
      'dialog.overwriteRemember': '其余同名文件将沿用本次选择。',
      'dialog.removeBodyOne': '确定删除“{name}”？此操作不可恢复。',
      'dialog.cancel': '取消',
      'dialog.delete': '删除',
      'dialog.create': '创建',
      'dialog.rename': '重命名',
      'msg.copied': '已复制 {count} 项，可在目标目录粘贴',
      'msg.cut': '已剪切 {count} 项，可在目标目录粘贴',
      'msg.pasted': '已粘贴 {count} 项',
      'msg.pastedPartial': '已粘贴 {count} 项，{failed} 项失败：{message}',
      'msg.removed': '已删除 {count} 项',
      'msg.removedPartial': '已删除 {count} 项，{failed} 项失败：{message}',
      'msg.renamed': '已重命名为“{name}”',
      'msg.pathCopied': '路径已复制：{path}',
      'msg.uploading': '正在上传 {name}（{percent}%）',
      'msg.uploaded': '已上传“{name}”',
      'msg.uploadPartial': '已上传 {count} 个文件，{failed} 个失败：{message}',
      'msg.download': '开始下载 {name}',
      'msg.downloadMany': '已开始下载 {count} 项',
      'msg.clipboardOtherHost': '剪贴板来自另一台主机，请重新复制',
      'msg.existsConflict': '目标目录已存在“{name}”，请先重命名或选择其他目录',
      'msg.networkError': '网络连接中断',
      'msg.uploadingMany': '正在上传 {name}（{index}/{total}，{percent}%）',
      'msg.failed': '操作失败：{message}',
      'msg.rootLoaded': '已连接 {host}',
      'msg.created': '已创建 {path}',
      'msg.skipped': '已跳过 {count} 个已存在的文件',
      'dialog.overwriteTitle': '文件已存在',
      'dialog.overwriteBody': '“{name}”已存在于目标目录，是否覆盖？',
      'menu.pasteInto': '粘贴到“{name}”',
    };

    const EN = {
      'panel.title': 'SSH remote files',
      'source.label': 'Source',
      'source.workspace': 'Workspace',
      'source.host': 'Host',
      'source.none': 'No SSH hosts yet. Add one under Settings → SSH connections.',
      'source.workspaceMissing': 'The host behind this workspace is no longer configured.',
      'action.refresh': 'Refresh',
      'action.upload': 'Upload files',
      'action.newFolder': 'New folder',
      'action.newFile': 'New file',
      'action.download': 'Download',
      'action.copy': 'Copy',
      'action.cut': 'Cut',
      'action.paste': 'Paste',
      'action.pasteInto': 'Paste into {dir}',
      'action.rename': 'Rename',
      'action.remove': 'Delete',
      'action.copyPath': 'Copy path',
      'action.up': 'Up',
      'msg.badPath': 'Enter an absolute path starting with /',
      'action.expand': 'Expand',
      'action.collapse': 'Collapse',
      'action.retry': 'Retry',
      'action.overwrite': 'Overwrite',
      'action.skip': 'Skip',
      'state.loading': 'Reading…',
      'state.empty': 'Empty directory',
      'state.noSelection': 'No selection',
      'state.selected': '{count} selected',
      'state.noPreview': 'Select a file on the left to preview it here',
      'state.binary': 'Binary file — no text preview',
      'state.truncated': 'Large file — showing the first {bytes}',
      'state.truncatedList': 'Showing the first {count} entries',
      'state.imageFailed': 'Image failed to load',
      'state.directory': 'This is a directory',
      'state.busy': 'Working…',
      'state.dropHint': 'Drop to upload into {dir}',
      'preview.modified': 'Modified',
      'dialog.newFolderTitle': 'New folder',
      'dialog.newFileTitle': 'New file',
      'dialog.renameTitle': 'Rename',
      'dialog.removeTitle': 'Delete',
      'dialog.name': 'Name',
      'dialog.nameRequired': 'Enter a name',
      'dialog.target': 'Target directory: {dir}',
      'dialog.removeBody': 'Delete {count} items? This cannot be undone.',
      'dialog.removeRecursive': 'Selected folders and everything inside them are deleted.',
      'dialog.overwriteRemember': 'The same choice applies to the remaining conflicts.',
      'dialog.removeBodyOne': 'Delete “{name}”? This cannot be undone.',
      'dialog.cancel': 'Cancel',
      'dialog.delete': 'Delete',
      'dialog.create': 'Create',
      'dialog.rename': 'Rename',
      'msg.copied': 'Copied {count} items — paste into a directory',
      'msg.cut': 'Cut {count} items — paste into a directory',
      'msg.pasted': 'Pasted {count} items',
      'msg.pastedPartial': 'Pasted {count} items; {failed} failed: {message}',
      'msg.removed': 'Deleted {count} items',
      'msg.removedPartial': 'Deleted {count} items; {failed} failed: {message}',
      'msg.renamed': 'Renamed to “{name}”',
      'msg.pathCopied': 'Path copied: {path}',
      'msg.uploading': 'Uploading {name} ({percent}%)',
      'msg.uploaded': 'Uploaded “{name}”',
      'msg.uploadPartial': 'Uploaded {count} files; {failed} failed: {message}',
      'msg.download': 'Downloading {name}',
      'msg.downloadMany': 'Started downloading {count} items',
      'msg.clipboardOtherHost': 'The clipboard belongs to another host; copy again',
      'msg.existsConflict': '“{name}” already exists in the destination; rename it or pick another directory',
      'msg.networkError': 'Network error',
      'msg.uploadingMany': 'Uploading {name} ({index}/{total}, {percent}%)',
      'msg.failed': 'Failed: {message}',
      'msg.rootLoaded': 'Connected to {host}',
      'msg.created': 'Created {path}',
      'msg.skipped': 'Skipped {count} existing files',
      'dialog.overwriteTitle': 'File already exists',
      'dialog.overwriteBody': '“{name}” already exists in the destination. Overwrite it?',
      'menu.pasteInto': 'Paste into “{name}”',
    };

    let translate = (key) => key;
    function t(key, vars) {
      const text = translate(key);
      if (!vars) return text;
      return String(text).replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));
    }

    // ───────────────────────────────────────────────────────────────── styles
    const CSS = `
      .ssf-root { display:flex; flex-direction:column; height:100%; min-height:0; position:relative;
        font-size:13px; line-height:1.5; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); }
      .ssf-top { display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        padding:calc(10px + var(--dsh-frame-top-clearance, 0px)) 16px 10px;
        border-bottom:1px solid var(--dsw-alias-border-l1); flex:none; }
      .ssf-title { font-weight:600; margin-right:2px; }
      .ssf-select { height:28px; padding:0 8px; border:1px solid var(--dsw-alias-border-l1);
        border-radius:var(--dsw-radius-sm, 8px); background:var(--dsw-alias-bg-base);
        color:var(--dsw-alias-label-primary); font:inherit; max-width:360px; }
      .ssf-btn { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 10px;
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-sm, 8px);
        background:transparent; color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; white-space:nowrap; }
      .ssf-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .ssf-btn:disabled { opacity:.45; cursor:default; }
      .ssf-btn:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .ssf-btn--primary { background:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary);
        color:var(--dsw-alias-label-on-color, var(--dsw-alias-bg-base)); }
      .ssf-btn--danger { color:var(--dsw-alias-state-error-primary); border-color:var(--dsw-alias-state-error-primary); }
      .ssf-icon-btn { width:28px; padding:0; justify-content:center; }
      .ssf-crumbs { display:flex; align-items:center; gap:8px; padding:6px 16px; flex:none;
        border-bottom:1px solid var(--dsw-alias-border-l1); color:var(--dsw-alias-label-secondary);
        font-size:12px; white-space:nowrap; overflow:hidden; }
      .ssf-crumbs-input { flex:1 1 auto; min-width:80px; height:24px; padding:0 8px;
        border:1px solid transparent; border-radius:var(--dsw-radius-sm, 8px); background:transparent;
        color:var(--dsw-alias-label-primary); font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size:12px; }
      .ssf-crumbs-input:hover { border-color:var(--dsw-alias-border-l1); }
      .ssf-crumbs-input:focus { outline:none; border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-bg-base); }
      .ssf-main { display:flex; flex:1 1 auto; min-height:0; min-width:0; }
      .ssf-tree-wrap { flex:1 1 auto; min-width:0; overflow:auto; padding:6px 6px 10px; position:relative; }
      .ssf-tree-wrap:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-4px; }
      .ssf-tree-wrap--drop { outline:2px dashed var(--dsw-alias-brand-primary); outline-offset:-8px; }
      .ssf-drop-hint { position:sticky; top:0; z-index:2; margin:0 6px 6px; padding:6px 10px;
        border:1px solid var(--dsw-alias-brand-primary); border-radius:var(--dsw-radius-sm, 8px);
        background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font-size:12px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ssf-preview-wrap { flex:0 0 44%; min-width:0; max-width:760px; border-left:1px solid var(--dsw-alias-border-l1);
        display:flex; flex-direction:column; min-height:0; }
      .ssf-preview-head { display:flex; align-items:center; gap:8px; padding:8px 12px; flex:none;
        border-bottom:1px solid var(--dsw-alias-border-l1); min-width:0; }
      .ssf-preview-name { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ssf-preview-meta { color:var(--dsw-alias-label-secondary); font-size:12px; white-space:nowrap; }
      .ssf-preview-body { flex:1 1 auto; min-height:0; overflow:auto; padding:10px 12px; }
      .ssf-pre { margin:0; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size:12px; line-height:1.55; white-space:pre; tab-size:4; }
      .ssf-img { display:block; max-width:100%; max-height:100%; margin:0 auto; }
      .ssf-pdf { width:100%; height:100%; min-height:320px; border:0; background:var(--dsw-alias-bg-base); }
      .ssf-empty { color:var(--dsw-alias-label-secondary); padding:28px 16px; text-align:center; }
      .ssf-row { display:flex; align-items:center; gap:6px; height:26px; padding:0 10px 0 2px;
        border-radius:var(--dsw-radius-sm, 8px); cursor:default; user-select:none; }
      .ssf-row:hover { background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .ssf-row[aria-selected="true"] { background:var(--dsw-alias-bg-multi-select, var(--dsw-alias-bg-layer-2));
        box-shadow:inset 2px 0 0 var(--dsw-alias-border-selected, var(--dsw-alias-brand-primary)); }
      .ssf-row-name { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ssf-row-size { color:var(--dsw-alias-label-secondary); font-size:11px; font-variant-numeric:tabular-nums; }
      .ssf-row-note { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary);
        font-size:12px; padding:2px 10px; }
      .ssf-row-note--error { color:var(--dsw-alias-state-error-primary); }
      .ssf-chevron { display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px;
        flex:none; padding:0; border:0; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; }
      .ssf-chevron--leaf { visibility:hidden; }
      .ssf-foot { flex:none; display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        padding:8px 16px; min-height:40px; border-top:1px solid var(--dsw-alias-border-l1);
        color:var(--dsw-alias-label-secondary); font-size:12px; }
      .ssf-spacer { flex:1 1 auto; }
      .ssf-status { margin-left:auto; max-width:52%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ssf-status--error { color:var(--dsw-alias-state-error-primary); max-width:60%; }
      .ssf-status--ok { color:var(--dsw-alias-state-success-primary); }
      .ssf-menu { position:fixed; z-index:80; min-width:200px; padding:4px;
        border:1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-border-l1));
        border-radius:var(--dsw-radius-md, 12px); background:var(--dsw-alias-bg-overlay);
        box-shadow:var(--dsw-shadow-lv2, none); }
      .ssf-menu-item { display:flex; align-items:center; gap:8px; width:100%; padding:6px 10px;
        border:0; border-radius:var(--dsw-radius-sm, 8px); background:transparent;
        color:var(--dsw-alias-label-primary); font:inherit; text-align:left; cursor:pointer; }
      .ssf-menu-item:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
      .ssf-menu-item:disabled { opacity:.45; cursor:default; }
      .ssf-menu-item:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-2px; }
      .ssf-menu-sep { height:1px; margin:4px 6px; background:var(--dsw-alias-border-l1); }
      .ssf-backdrop { position:fixed; inset:0; z-index:90; display:flex; align-items:center; justify-content:center;
        background:color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent); }
      .ssf-dialog { width:min(440px, calc(100vw - 32px)); border:1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-border-l1));
        border-radius:var(--dsw-radius-md, 12px); background:var(--dsw-alias-bg-overlay);
        box-shadow:var(--dsw-shadow-lv2, none); overflow:hidden; }
      .ssf-dialog-title { padding:14px 16px 0; font-weight:600; }
      .ssf-dialog-body { padding:10px 16px 0; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
      .ssf-dialog-label { display:block; margin:10px 16px 4px; font-size:12px; color:var(--dsw-alias-label-secondary); }
      .ssf-input { width:calc(100% - 32px); margin:0 16px; height:30px; padding:0 8px;
        border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-sm, 8px);
        background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; }
      .ssf-input:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .ssf-dialog-actions { display:flex; justify-content:flex-end; gap:8px; padding:14px 16px; }
      .ssf-error { color:var(--dsw-alias-state-error-primary); }
      @media (max-width: 760px) {
        .ssf-main { flex-direction:column; }
        .ssf-tree-wrap { flex:1 1 55%; min-height:120px; }
        .ssf-preview-wrap { flex:1 1 45%; min-width:0; max-width:none; border-left:0;
          border-top:1px solid var(--dsw-alias-border-l1); }
        .ssf-status { max-width:100%; margin-left:0; }
        .ssf-top .ssf-select { max-width:100%; flex:1 1 160px; }
      }
    `;

    // ──────────────────────────────────────────────────────────────── helpers
    function qs(params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) for (const item of value) search.append(key, String(item));
        else search.append(key, String(value));
      }
      return search.toString();
    }

    function apiError(payload, response) {
      const error = new Error(payload && payload.message ? String(payload.message) : 'HTTP ' + response.status);
      error.code = payload && payload.code ? String(payload.code) : 'http';
      error.status = response.status;
      return error;
    }

    async function apiGet(path, params) {
      const response = await fetch(BASE + path + '?' + qs(params || {}), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!payload || payload.ok !== true) throw apiError(payload, response);
      return payload.value;
    }

    async function apiPost(path, body) {
      const response = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!payload || payload.ok !== true) throw apiError(payload, response);
      return payload.value;
    }

    function uploadOne(hostId, dir, file, overwrite, onProgress) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', BASE + '/upload?' + qs({ hostId, dir, name: file.name, overwrite: overwrite ? '1' : '' }));
        request.setRequestHeader('content-type', 'application/octet-stream');
        request.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
        };
        request.onerror = () => {
          const error = new Error('network');
          error.code = 'network';
          reject(error);
        };
        request.onload = () => {
          let payload = null;
          try {
            payload = JSON.parse(request.responseText);
          } catch {
            payload = null;
          }
          if (payload && payload.ok === true) resolve(payload.value);
          else reject(apiError(payload, { status: request.status }));
        };
        request.send(file);
      });
    }

    function joinRemote(dir, name) {
      return dir === '/' ? '/' + name : dir.replace(/\/+$/, '') + '/' + name;
    }

    function parentOf(absolutePath) {
      if (absolutePath === '/') return '/';
      const slash = absolutePath.replace(/\/+$/, '').lastIndexOf('/');
      return slash <= 0 ? '/' : absolutePath.slice(0, slash);
    }

    function baseName(absolutePath) {
      if (absolutePath === '/') return '/';
      const trimmed = absolutePath.replace(/\/+$/, '');
      return trimmed.slice(trimmed.lastIndexOf('/') + 1);
    }

    function extOf(name) {
      const dot = name.lastIndexOf('.');
      return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
    }

    function formatSize(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
      if (bytes < 1024) return bytes + ' B';
      const units = ['KB', 'MB', 'GB', 'TB'];
      let value = bytes / 1024;
      let index = 0;
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
      }
      return (value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[index];
    }

    function formatTime(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
      const date = new Date(seconds * 1000);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (value) => String(value).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    function rawUrlOf(hostId, absolutePath) {
      return BASE + '/raw?' + qs({ hostId, path: absolutePath });
    }

    /** Stable DOM id for one tree row (aria-activedescendant target). */
    function nodeIdOf(absolutePath) {
      return 'ssf-node-' + encodeURIComponent(absolutePath).replace(/%/g, '-');
    }

    // ────────────────────────────────────────────────────────────────── icons
    function strokeIcon(children, size) {
      return h('svg', {
        width: size || 16,
        height: size || 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, children);
    }

    function IconChevron({ open }) {
      return strokeIcon(h('path', { d: open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4' }), 14);
    }
    function IconFolder({ size }) {
      return strokeIcon(h('path', { d: 'M2.5 4.5h4l1.3 1.8h5.7v7.2h-11z' }), size || 14);
    }
    function IconFile({ size }) {
      return strokeIcon([
        h('path', { key: 'a', d: 'M4 2.5h5l3 3v8H4z' }),
        h('path', { key: 'b', d: 'M9 2.5v3h3' }),
      ], size || 14);
    }
    function IconRefresh() {
      return strokeIcon([
        h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
        h('path', { key: 'b', d: 'M13 2.6V5.4h-2.8' }),
      ], 14);
    }
    function IconUpload() {
      return strokeIcon([
        h('path', { key: 'a', d: 'M8 11V3' }),
        h('path', { key: 'b', d: 'M5 6l3-3 3 3' }),
        h('path', { key: 'c', d: 'M3 12.8h10' }),
      ], 14);
    }
    function IconDownload() {
      return strokeIcon([
        h('path', { key: 'a', d: 'M8 3v8' }),
        h('path', { key: 'b', d: 'M5 8l3 3 3-3' }),
        h('path', { key: 'c', d: 'M3 13h10' }),
      ], 14);
    }
    function IconPlus() {
      return strokeIcon([h('path', { key: 'a', d: 'M8 3v10' }), h('path', { key: 'b', d: 'M3 8h10' })], 14);
    }
    function IconNewFile() {
      return strokeIcon([
        h('path', { key: 'a', d: 'M4 2.5h5l3 3v8H4z' }),
        h('path', { key: 'b', d: 'M8 8.2v3.6' }),
        h('path', { key: 'c', d: 'M6.2 10h3.6' }),
      ], 14);
    }

    /**
     * Sidebar entry icon: a folder with a terminal prompt. Drawn in
     * currentColor so the sidebar owns the resting/selected/dark colour, and
     * stroked at the same weight as the neighbouring navigation glyphs.
     */
    function PanelIcon({ size }) {
      const edge = size || 18;
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 36 36',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, [
        h('path', { key: 'folder', d: 'M6.5 11.2h8.6l2.3 3.1H29a1.5 1.5 0 0 1 1.5 1.5v10.4A1.5 1.5 0 0 1 29 27.7H7A1.5 1.5 0 0 1 5.5 26.2V12.7a1.5 1.5 0 0 1 1-1.5Z' }),
        h('path', { key: 'prompt', d: 'M13.8 18.6l2.8 2.8-2.8 2.8M19.8 24.2h4.4' }),
      ]);
    }

    // ─────────────────────────────────────────────────────────────── controls
    function Dialog({ title, children, actions, onCancel }) {
      const ref = useRef(null);
      const cancelRef = useRef(onCancel);
      cancelRef.current = onCancel;
      useEffect(() => {
        const node = ref.current;
        const previous = document.activeElement;
        const focusables = () => (node
          ? Array.from(node.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
            .filter((item) => !item.disabled)
          : []);
        const first = focusables()[0];
        if (first) first.focus();
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelRef.current();
            return;
          }
          if (event.key !== 'Tab') return;
          const items = focusables();
          if (items.length === 0) return;
          const index = items.indexOf(document.activeElement);
          const next = event.shiftKey
            ? (index <= 0 ? items.length - 1 : index - 1)
            : (index === -1 || index === items.length - 1 ? 0 : index + 1);
          event.preventDefault();
          items[next].focus();
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
          document.removeEventListener('keydown', onKey, true);
          if (previous && typeof previous.focus === 'function') {
            try {
              previous.focus();
            } catch {
              /* the previous node may be gone */
            }
          }
        };
      }, []);
      return h('div', { className: 'ssf-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) onCancel(); } },
        h('div', {
          ref,
          className: 'ssf-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
        }, [
          h('div', { key: 'title', className: 'ssf-dialog-title' }, title),
          h('div', { key: 'body' }, children),
          h('div', { key: 'actions', className: 'ssf-dialog-actions' }, actions),
        ]));
    }

    function PromptDialog({ title, label, hint, initial, confirmLabel, busy, error, onConfirm, onCancel }) {
      const [value, setValue] = useState(initial || '');
      const [localError, setLocalError] = useState('');
      const submit = () => {
        if (busy) return;
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          setLocalError(t('dialog.nameRequired'));
          return;
        }
        onConfirm(trimmed);
      };
      const message = localError || error || '';
      return h(Dialog, {
        title,
        onCancel,
        actions: [
          h('button', { key: 'cancel', type: 'button', className: 'ssf-btn', onClick: onCancel }, t('dialog.cancel')),
          h('button', {
            key: 'ok',
            type: 'button',
            className: 'ssf-btn ssf-btn--primary',
            disabled: busy === true,
            onClick: submit,
          }, busy ? t('state.busy') : confirmLabel),
        ],
      }, [
        h('label', { key: 'label', className: 'ssf-dialog-label', htmlFor: 'ssf-dialog-input' }, label),
        hint ? h('div', { key: 'hint', className: 'ssf-dialog-body', style: { marginTop: 0 } }, hint) : null,
        h('input', {
          key: 'input',
          id: 'ssf-dialog-input',
          className: 'ssf-input',
          value,
          autoFocus: true,
          spellCheck: false,
          disabled: busy === true,
          onChange: (event) => { setValue(event.target.value); setLocalError(''); },
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          },
        }),
        message ? h('div', { key: 'error', className: 'ssf-dialog-body ssf-error', role: 'alert' }, message) : null,
      ]);
    }

    // ────────────────────────────────────────────────────────────────── panel
    function SshFilesPanel() {
      const [sources, setSources] = useState(null);
      const [sourcesError, setSourcesError] = useState('');
      const [sourcesAttempt, setSourcesAttempt] = useState(0);
      const [sourceKey, setSourceKey] = useState('');
      const [root, setRoot] = useState('');
      const [levels, setLevels] = useState({});
      const [expanded, setExpanded] = useState(() => new Set());
      const [selection, setSelection] = useState([]);
      const [anchorPath, setAnchorPath] = useState('');
      const [preview, setPreview] = useState(null);
      const [clipboard, setClipboard] = useState(null);
      const [status, setStatus] = useState(null);
      const [busy, setBusy] = useState(false);
      const [dialog, setDialog] = useState(null);
      const [menu, setMenu] = useState(null);
      const [dropTarget, setDropTarget] = useState(false);
      const [dropPath, setDropPath] = useState('');
      const fileInput = useRef(null);
      const previewToken = useRef(0);
      const rootRef = useRef(null);
      const menuRef = useRef(null);
      const [pathDraft, setPathDraft] = useState('');

      const notify = useCallback((kind, text) => setStatus({ kind, text }), []);

      const fail = useCallback((error) => {
        notify('error', t('msg.failed', { message: error && error.message ? error.message : String(error) }));
      }, [notify]);

      // Overwrite confirmation that can pause the upload loop and resume it.
      const [overwriteAsk, setOverwriteAsk] = useState(null);
      const askOverwrite = useCallback((name, many) => new Promise((resolve) => setOverwriteAsk({ name, many })), []);

      const hostOf = useMemo(() => {
        if (!sources || !sourceKey) return '';
        if (sourceKey.startsWith('ws:')) {
          const id = sourceKey.slice(3);
          const workspace = sources.workspaces.find((item) => item.id === id);
          return workspace ? workspace.hostId : '';
        }
        return sourceKey.slice(5);
      }, [sources, sourceKey]);

      const hostLabel = useMemo(() => {
        if (!sources || !hostOf) return '';
        const host = sources.hosts.find((item) => item.id === hostOf);
        return host ? (host.name + ' · ' + host.user + '@' + host.host) : hostOf;
      }, [sources, hostOf]);

      // Load the source list once, then restore the last choice.
      useEffect(() => {
        let cancelled = false;
        setSourcesError('');
        apiGet('/sources').then((value) => {
          if (cancelled) return;
          setSources(value);
          setSourcesError('');
          const options = [];
          for (const workspace of value.workspaces) options.push('ws:' + workspace.id);
          for (const host of value.hosts) options.push('host:' + host.id);
          let stored = '';
          try {
            stored = window.localStorage.getItem(SOURCE_STORAGE_KEY) || '';
          } catch {
            stored = '';
          }
          const preferred = options.includes(stored) ? stored : options[0] || '';
          setSourceKey(preferred);
        }).catch((error) => {
          if (cancelled) return;
          setSources({ hosts: [], workspaces: [] });
          setSourcesError(error && error.message ? error.message : String(error));
        });
        return () => { cancelled = true; };
      }, [sourcesAttempt]);

      // Success/info notices clear themselves; failures stay until the next action.
      useEffect(() => {
        if (!status || status.kind === 'error') return undefined;
        const timer = window.setTimeout(() => setStatus(null), 6000);
        return () => window.clearTimeout(timer);
      }, [status]);

      useEffect(() => {
        if (!sourceKey) return;
        try {
          window.localStorage.setItem(SOURCE_STORAGE_KEY, sourceKey);
        } catch {
          /* storage may be unavailable */
        }
      }, [sourceKey]);

      // Resolve the source root: a workspace path, or the host's $HOME.
      useEffect(() => {
        if (!sources || !sourceKey) return undefined;
        let cancelled = false;
        setLevels({});
        setExpanded(new Set());
        setSelection([]);
        setPreview(null);
        setRoot('');
        setStatus(null);
        setClipboard(null);
        if (sourceKey.startsWith('ws:')) {
          const id = sourceKey.slice(3);
          const workspace = sources.workspaces.find((item) => item.id === id);
          if (!workspace || !sources.hosts.some((item) => item.id === workspace.hostId)) {
            notify('error', t('source.workspaceMissing'));
            return undefined;
          }
          setRoot(workspace.remotePath);
          return undefined;
        }
        const hostId = sourceKey.slice(5);
        if (!hostId) return undefined;
        apiGet('/home', { hostId }).then((value) => {
          if (cancelled) return;
          setRoot(value.home);
          notify('ok', t('msg.rootLoaded', { host: hostLabel }));
        }).catch((error) => {
          if (cancelled) return;
          fail(error);
        });
        return () => { cancelled = true; };
      }, [sources, sourceKey, notify, fail, hostLabel]);

      const loadDir = useCallback(async (path) => {
        if (!hostOf || !path) return;
        setLevels((previous) => ({ ...previous, [path]: { ...(previous[path] || {}), state: 'loading' } }));
        try {
          const value = await apiGet('/list', { hostId: hostOf, path });
          setLevels((previous) => ({
            ...previous,
            [path]: { state: 'ready', entries: value.entries, truncated: value.truncated },
          }));
        } catch (error) {
          setLevels((previous) => ({
            ...previous,
            [path]: { state: 'error', message: error && error.message ? error.message : String(error) },
          }));
        }
      }, [hostOf]);

      // Load the root whenever it resolves.
      useEffect(() => {
        if (!root || !hostOf) return;
        if (levels[root]) return;
        loadDir(root);
      }, [root, hostOf, loadDir, levels]);

      const toggleDir = useCallback((path) => {
        setExpanded((previous) => {
          const next = new Set(previous);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
      }, []);

      useEffect(() => {
        for (const dir of expanded) if (!levels[dir]) loadDir(dir);
      }, [expanded, levels, loadDir]);

      // Flatten the expanded tree into rows.
      const rows = useMemo(() => {
        if (!root) return [];
        const output = [];
        const walk = (path, depth) => {
          const level = levels[path];
          if (!level) {
            output.push({ kind: 'note', path: path + '\u0000loading', depth, text: t('state.loading') });
            return;
          }
          if (level.state === 'loading') {
            output.push({ kind: 'note', path: path + '\u0000loading', depth, text: t('state.loading') });
            return;
          }
          if (level.state === 'error') {
            output.push({ kind: 'note', key: path + '\u0000error', depth, text: level.message, error: true, dir: path });
            return;
          }
          if (level.entries.length === 0) {
            output.push({ kind: 'note', key: path + '\u0000empty', depth, text: t('state.empty') });
            return;
          }
          for (const entry of level.entries) {
            const entryPath = joinRemote(path, entry.name);
            output.push({ ...entry, kind: 'entry', path: entryPath, depth });
            if (entry.type === 'directory' && expanded.has(entryPath)) walk(entryPath, depth + 1);
          }
          if (level.truncated) {
            output.push({ kind: 'note', key: path + '\u0000truncated', depth, text: t('state.truncatedList') });
          }
        };
        walk(root, 0);
        return output;
      }, [root, levels, expanded]);

      const entryRows = useMemo(() => rows.filter((row) => row.kind === 'entry'), [rows]);

      const selectionPaths = useMemo(() => new Set(selection.map((entry) => entry.path)), [selection]);

      const anchorEntry = selection.length > 0 ? selection[selection.length - 1] : null;
      const targetDir = useMemo(() => {
        if (!anchorEntry) return root;
        return anchorEntry.type === 'directory' ? anchorEntry.path : parentOf(anchorEntry.path);
      }, [anchorEntry, root]);

      const resolveDropDir = useCallback((event) => {
        const node = event.target && typeof event.target.closest === 'function'
          ? event.target.closest('[data-ssf-path]')
          : null;
        if (node) {
          const path = node.getAttribute('data-ssf-path');
          const row = entryRows.find((item) => item.path === path);
          if (row) return row.type === 'directory' ? row.path : parentOf(row.path);
        }
        return targetDir;
      }, [entryRows, targetDir]);

      const refreshDirs = useCallback(async (paths) => {
        const unique = [...new Set(paths.filter(Boolean))];
        await Promise.all(unique.map((path) => loadDir(path)));
      }, [loadDir]);

      const refreshAll = useCallback(() => {
        const paths = [root, ...expanded];
        refreshDirs(paths);
      }, [root, expanded, refreshDirs]);

      // Keep the editable path in sync with the resolved root.
      useEffect(() => {
        setPathDraft(root || '');
      }, [root]);

      const navigateTo = useCallback((next) => {
        const value = typeof next === 'string' ? next.trim() : '';
        if (!value.startsWith('/')) {
          notify('error', t('msg.badPath'));
          return;
        }
        if (!hostOf) return;
        const normalized = value.replace(/\/+$/, '') || '/';
        setRoot(normalized);
        setLevels({});
        setExpanded(new Set());
        setSelection([]);
        setPreview(null);
        setStatus(null);
        setPathDraft(normalized);
      }, [hostOf, notify]);

      // Preview the single selected file.
      useEffect(() => {
        if (selection.length !== 1 || !hostOf) {
          setPreview(null);
          return undefined;
        }
        const entry = selection[0];
        if (entry.type === 'directory') {
          setPreview({ kind: 'directory', name: entry.name, path: entry.path, mtime: entry.mtime });
          return undefined;
        }
        if (entry.type !== 'file' && entry.type !== 'link') {
          setPreview({ kind: 'binary', name: entry.name, path: entry.path, size: entry.size, mtime: entry.mtime });
          return undefined;
        }
        const token = ++previewToken.current;
        const ext = extOf(entry.name);
        if (IMAGE_EXTS.has(ext)) {
          setPreview({ kind: 'image', name: entry.name, path: entry.path, size: entry.size, mtime: entry.mtime, url: rawUrlOf(hostOf, entry.path) });
          return undefined;
        }
        if (ext === 'pdf') {
          setPreview({ kind: 'pdf', name: entry.name, path: entry.path, size: entry.size, mtime: entry.mtime, url: rawUrlOf(hostOf, entry.path) });
          return undefined;
        }
        setPreview({ kind: 'loading', name: entry.name, path: entry.path });
        apiGet('/text', { hostId: hostOf, path: entry.path }).then((value) => {
          if (previewToken.current !== token) return;
          if (value.binary) {
            setPreview({ kind: 'binary', name: entry.name, path: entry.path, size: value.size, mtime: value.mtime });
            return;
          }
          setPreview({
            kind: 'text',
            name: entry.name,
            path: entry.path,
            text: value.text,
            truncated: value.truncated,
            size: value.size,
            mtime: value.mtime,
            readBytes: value.readBytes,
          });
        }).catch((error) => {
          if (previewToken.current !== token) return;
          setPreview({ kind: 'error', name: entry.name, path: entry.path, message: error && error.message ? error.message : String(error) });
        });
        return undefined;
      }, [selection, hostOf]);

      // Move focus into an opened menu, and close it on any outside gesture.
      useEffect(() => {
        if (!menu) return undefined;
        const close = (event) => {
          if (event && event.target && typeof event.target.closest === 'function' && event.target.closest('.ssf-menu')) return;
          setMenu(null);
        };
        const onKey = (event) => { if (event.key === 'Escape') setMenu(null); };
        const menuNode = menuRef.current;
        if (menuNode) {
          const first = menuNode.querySelector('[role="menuitem"]:not(:disabled)');
          if (first) first.focus();
        }
        const onMenuKey = (event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          const node = menuRef.current;
          if (!node) return;
          const items = Array.from(node.querySelectorAll('[role="menuitem"]:not(:disabled)'));
          if (items.length === 0) return;
          event.preventDefault();
          const index = items.indexOf(document.activeElement);
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const next = index < 0 ? (delta > 0 ? 0 : items.length - 1) : (index + delta + items.length) % items.length;
          items[next].focus();
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('scroll', close, true);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('keydown', onMenuKey);
        return () => {
          document.removeEventListener('mousedown', close);
          document.removeEventListener('scroll', close, true);
          document.removeEventListener('keydown', onKey, true);
          document.removeEventListener('keydown', onMenuKey);
        };
      }, [menu]);

      // ───────────────────────────────────────────────────────────── selection
      const selectRow = useCallback((row, event) => {
        if (row.kind !== 'entry') return;
        if (rootRef.current) {
          try {
            rootRef.current.focus({ preventScroll: true });
          } catch {
            rootRef.current.focus();
          }
        }
        const additive = event && (event.metaKey || event.ctrlKey);
        const range = event && event.shiftKey;
        if (range && anchorPath) {
          const paths = entryRows.map((item) => item.path);
          const from = paths.indexOf(anchorPath);
          const to = paths.indexOf(row.path);
          if (from >= 0 && to >= 0) {
            const [start, end] = from <= to ? [from, to] : [to, from];
            setSelection(entryRows.slice(start, end + 1).map((item) => ({ ...item })));
            return;
          }
        }
        if (additive) {
          setSelection((previous) => {
            const exists = previous.some((item) => item.path === row.path);
            if (exists) return previous.filter((item) => item.path !== row.path);
            return [...previous, { ...row }];
          });
          setAnchorPath(row.path);
          return;
        }
        setSelection([{ ...row }]);
        setAnchorPath(row.path);
      }, [anchorPath, entryRows]);

      const openRow = useCallback((row) => {
        if (row.kind !== 'entry') return;
        if (row.type === 'directory') toggleDir(row.path);
        else setSelection([{ ...row }]);
      }, [toggleDir]);

      const clearSelection = useCallback(() => {
        setSelection([]);
        setAnchorPath('');
        setPreview(null);
      }, []);

      // ────────────────────────────────────────────────────────────── actions
      const downloadEntries = useCallback(async (entries) => {
        if (!hostOf || entries.length === 0) return;
        const groups = new Map();
        for (const entry of entries) {
          const dir = parentOf(entry.path);
          if (!groups.has(dir)) groups.set(dir, []);
          groups.get(dir).push(entry);
        }
        let started = 0;
        for (const [dir, group] of groups) {
          try {
            // Check first: a failed /download answers JSON, and an anchor without a
            // suggested name would replace the GUI with that JSON page.
            for (const entry of group) await apiGet('/stat', { hostId: hostOf, path: entry.path });
          } catch (error) {
            fail(error);
            continue;
          }
          const names = group.map((entry) => entry.name);
          const only = group.length === 1 ? group[0] : null;
          const suggested = only && only.type !== 'directory'
            ? only.name
            : ((dir === '/' ? 'root' : baseName(dir)) || 'files') + '.tar.gz';
          const link = document.createElement('a');
          link.href = BASE + '/download?' + qs({ hostId: hostOf, dir, name: names });
          link.download = suggested;
          link.rel = 'noopener';
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          link.remove();
          started += 1;
          if (started > 1) await new Promise((resolve) => { window.setTimeout(resolve, 400); });
        }
        if (started === 0) return;
        if (entries.length === 1) notify('ok', t('msg.download', { name: entries[0].name }));
        else notify('ok', t('msg.downloadMany', { count: started }));
      }, [hostOf, notify, fail]);

      const copySelection = useCallback((mode) => {
        if (!hostOf || selection.length === 0) return;
        setClipboard({ mode, hostId: hostOf, items: selection.map((entry) => ({ ...entry })) });
        notify('ok', t(mode === 'copy' ? 'msg.copied' : 'msg.cut', { count: selection.length }));
      }, [hostOf, selection, notify]);

      const pasteInto = useCallback(async (destination) => {
        if (!clipboard || !hostOf || !destination) return;
        if (clipboard.hostId !== hostOf) {
          notify('error', t('msg.clipboardOtherHost'));
          return;
        }
        const mode = clipboard.mode;
        setBusy(true);
        try {
          const response = await apiPost(mode === 'copy' ? '/copy' : '/move', {
            hostId: hostOf,
            destDir: destination,
            items: clipboard.items.map((entry) => entry.path),
          });
          const done = response.done.length;
          const failed = response.failed;
          if (failed.length > 0) {
            const message = failed[0].code === 'exists' ? t('msg.existsConflict', { name: baseName(failed[0].path) }) : failed[0].message;
            notify('error', t('msg.pastedPartial', { count: done, failed: failed.length, message }));
          } else {
            notify('ok', t('msg.pasted', { count: done }));
          }
          if (mode === 'cut' && failed.length === 0) setClipboard(null);
          const parents = clipboard.items.map((entry) => parentOf(entry.path));
          await refreshDirs([destination, ...parents]);
          setSelection([]);
        } catch (error) {
          fail(error);
        } finally {
          setBusy(false);
        }
      }, [clipboard, hostOf, notify, fail, refreshDirs]);

      const removeEntries = useCallback(async (entries) => {
        if (!hostOf || entries.length === 0) return;
        setBusy(true);
        try {
          const response = await apiPost('/remove', { hostId: hostOf, paths: entries.map((entry) => entry.path) });
          if (response.failed.length > 0) {
            notify('error', t('msg.removedPartial', {
              count: response.done.length,
              failed: response.failed.length,
              message: response.failed[0].message,
            }));
          } else {
            notify('ok', t('msg.removed', { count: response.done.length }));
          }
          await refreshDirs(entries.map((entry) => parentOf(entry.path)));
          setSelection([]);
          setPreview(null);
        } catch (error) {
          fail(error);
        } finally {
          setBusy(false);
        }
      }, [hostOf, notify, fail, refreshDirs]);

      const renameEntry = useCallback(async (entry, name) => {
        if (!hostOf || !entry) return;
        setDialog((previous) => (previous && previous.kind === 'rename' ? { ...previous, busy: true, error: '' } : previous));
        setBusy(true);
        try {
          await apiPost('/rename', { hostId: hostOf, path: entry.path, name });
          notify('ok', t('msg.renamed', { name }));
          await refreshDirs([parentOf(entry.path)]);
          setSelection([{ ...entry, path: joinRemote(parentOf(entry.path), name), name }]);
          setDialog(null);
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          setDialog((previous) => (previous && previous.kind === 'rename' ? { ...previous, busy: false, error: message } : previous));
          fail(error);
        } finally {
          setBusy(false);
        }
      }, [hostOf, notify, fail, refreshDirs]);

      const createEntry = useCallback(async (kind, name, dir) => {
        if (!hostOf || !dir) return;
        const dialogKind = kind === 'folder' ? 'mkdir' : 'newfile';
        setDialog((previous) => (previous && previous.kind === dialogKind ? { ...previous, busy: true, error: '' } : previous));
        setBusy(true);
        try {
          const created = kind === 'folder'
            ? await apiPost('/mkdir', { hostId: hostOf, dir, name })
            : await apiPost('/newfile', { hostId: hostOf, dir, name, content: '' });
          setDialog(null);
          await refreshDirs([dir]);
          if (kind === 'folder') setExpanded((previous) => new Set(previous).add(created.path));
          notify('ok', t('msg.created', { path: created.path }));
          setSelection([{ kind: 'entry', path: created.path, name, type: kind === 'folder' ? 'directory' : 'file' }]);
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          setDialog((previous) => (previous && previous.kind === dialogKind ? { ...previous, busy: false, error: message } : previous));
          fail(error);
        } finally {
          setBusy(false);
        }
      }, [hostOf, notify, fail, refreshDirs]);

      const uploadFiles = useCallback(async (fileList, dir) => {
        if (!hostOf || !dir || !fileList || fileList.length === 0) return;
        const files = Array.from(fileList);
        setBusy(true);
        let uploaded = 0;
        let skipped = 0;
        let conflictChoice = ''; // '' | 'overwrite' | 'skip' — reused for the rest of this batch
        const failures = [];
        for (const [index, file] of files.entries()) {
          const attempt = (overwrite) => uploadOne(hostOf, dir, file, overwrite, (percent) => {
            notify('info', t(files.length > 1 ? 'msg.uploadingMany' : 'msg.uploading', {
              name: file.name,
              percent,
              index: index + 1,
              total: files.length,
            }));
          });
          try {
            try {
              await attempt(false);
            } catch (error) {
              if (error && error.code === 'exists') {
                if (conflictChoice === 'overwrite') {
                  await attempt(true);
                } else if (conflictChoice === 'skip') {
                  skipped += 1;
                  continue;
                } else {
                  const overwrite = await askOverwrite(file.name, files.length > 1);
                  conflictChoice = overwrite ? 'overwrite' : 'skip';
                  if (!overwrite) {
                    skipped += 1;
                    continue;
                  }
                  await attempt(true);
                }
              } else {
                throw error;
              }
            }
            uploaded += 1;
            notify('ok', t('msg.uploaded', { name: file.name }));
          } catch (error) {
            failures.push({
              name: file.name,
              message: error && error.code === 'network'
                ? t('msg.networkError')
                : (error && error.message ? error.message : String(error)),
            });
          }
        }
        await refreshDirs([dir]);
        if (failures.length > 0) {
          notify('error', t('msg.uploadPartial', { count: uploaded, failed: failures.length, message: failures[0].message }));
        } else if (uploaded === 0 && skipped > 0) {
          notify('ok', t('msg.skipped', { count: skipped }));
        }
        setBusy(false);
      }, [hostOf, notify, refreshDirs, askOverwrite]);

      const copyPath = useCallback(async (absolutePath) => {
        try {
          await navigator.clipboard.writeText(absolutePath);
          notify('ok', t('msg.pathCopied', { path: absolutePath }));
        } catch (error) {
          fail(error);
        }
      }, [notify, fail]);

      // ──────────────────────────────────────────────────────────────── menus
      const openMenuAt = useCallback((row, clientX, clientY) => {
        const x = Math.min(clientX, window.innerWidth - 220);
        const y = Math.min(clientY, window.innerHeight - 300);
        if (row && row.kind === 'entry' && !selectionPaths.has(row.path)) {
          setSelection([{ ...row }]);
          setAnchorPath(row.path);
        }
        setMenu({ x, y, row: row && row.kind === 'entry' ? row : null });
      }, [selectionPaths]);

      const openMenu = useCallback((event, row) => {
        event.preventDefault();
        event.stopPropagation();
        openMenuAt(row, event.clientX, event.clientY);
      }, [openMenuAt]);

      const copySelectionFor = useCallback((entries, mode) => {
        if (!hostOf || entries.length === 0) return;
        setClipboard({ mode, hostId: hostOf, items: entries.map((entry) => ({ ...entry })) });
        notify('ok', t(mode === 'copy' ? 'msg.copied' : 'msg.cut', { count: entries.length }));
      }, [hostOf, notify]);

      const menuItems = useMemo(() => {
        const row = menu ? menu.row : null;
        const items = [];
        const add = (id, label, action, options) => items.push({ id, label, action, ...options });
        // Right-clicking a row that is part of a multi-selection acts on the whole
        // selection, so the highlighted set and the acted-on set never diverge.
        const rowSelected = row ? selection.some((entry) => entry.path === row.path) : false;
        const entries = row ? (rowSelected && selection.length > 1 ? selection : [row]) : selection;
        const blocked = busy === true;
        if (row && row.type === 'directory' && entries.length === 1) {
          add('toggle', expanded.has(row.path) ? t('action.collapse') : t('action.expand'), () => toggleDir(row.path), { disabled: blocked });
          add('paste', t('menu.pasteInto', { name: row.name }), () => pasteInto(row.path), {
            disabled: blocked || !clipboard || clipboard.hostId !== hostOf,
          });
          items.push({ separator: true });
          add('newFolder', t('action.newFolder'), () => setDialog({ kind: 'mkdir', dir: row.path }), { disabled: blocked });
          add('newFile', t('action.newFile'), () => setDialog({ kind: 'newfile', dir: row.path }), { disabled: blocked });
        }
        if (entries.length > 0) {
          add('download', entries.length === 1 ? t('action.download') : t('action.download') + ' (' + entries.length + ')',
            () => downloadEntries(entries), { disabled: blocked });
          add('copy', t('action.copy'), () => copySelectionFor(entries, 'copy'), { disabled: blocked });
          add('cut', t('action.cut'), () => copySelectionFor(entries, 'cut'), { disabled: blocked });
          if (entries.length === 1) {
            add('rename', t('action.rename'), () => setDialog({ kind: 'rename', entry: entries[0] }), { disabled: blocked });
            add('copyPath', t('action.copyPath'), () => copyPath(entries[0].path), { disabled: blocked });
          }
          items.push({ separator: true });
          add('remove', t('action.remove') + (entries.length > 1 ? ' (' + entries.length + ')' : ''),
            () => setDialog({ kind: 'remove', items: entries }), { danger: true, disabled: blocked });
        }
        if (!row) {
          add('newFolder', t('action.newFolder'), () => setDialog({ kind: 'mkdir', dir: root }), { disabled: blocked });
          add('newFile', t('action.newFile'), () => setDialog({ kind: 'newfile', dir: root }), { disabled: blocked });
          add('paste', t('action.paste'), () => pasteInto(root), {
            disabled: blocked || !clipboard || clipboard.hostId !== hostOf,
          });
          add('refresh', t('action.refresh'), refreshAll, { disabled: blocked });
        }
        return items.filter((item, index, list) => !(item.separator && (index === 0 || index === list.length - 1)));
      }, [menu, selection, busy, expanded, clipboard, hostOf, root, toggleDir, pasteInto, downloadEntries, copyPath, refreshAll, copySelectionFor]);

      // ──────────────────────────────────────────────────────────── dialogs
      const dialogNode = (() => {
        if (!dialog) return null;
        if (dialog.kind === 'mkdir') {
          return h(PromptDialog, {
            title: t('dialog.newFolderTitle'),
            label: t('dialog.name'),
            hint: t('dialog.target', { dir: dialog.dir }),
            initial: '',
            confirmLabel: t('dialog.create'),
            busy: dialog.busy === true,
            error: dialog.error,
            onCancel: () => setDialog(null),
            onConfirm: (name) => createEntry('folder', name, dialog.dir),
          });
        }
        if (dialog.kind === 'newfile') {
          return h(PromptDialog, {
            title: t('dialog.newFileTitle'),
            label: t('dialog.name'),
            hint: t('dialog.target', { dir: dialog.dir }),
            initial: '',
            confirmLabel: t('dialog.create'),
            busy: dialog.busy === true,
            error: dialog.error,
            onCancel: () => setDialog(null),
            onConfirm: (name) => createEntry('file', name, dialog.dir),
          });
        }
        if (dialog.kind === 'rename') {
          return h(PromptDialog, {
            title: t('dialog.renameTitle'),
            label: t('dialog.name'),
            initial: dialog.entry.name,
            confirmLabel: t('dialog.rename'),
            busy: dialog.busy === true,
            error: dialog.error,
            onCancel: () => setDialog(null),
            onConfirm: (name) => renameEntry(dialog.entry, name),
          });
        }
        if (dialog.kind === 'remove') {
          const items = dialog.items;
          const hasDirectory = items.some((item) => item.type === 'directory');
          const body = (items.length === 1
            ? t('dialog.removeBodyOne', { name: items[0].name })
            : t('dialog.removeBody', { count: items.length }))
            + (hasDirectory ? ' ' + t('dialog.removeRecursive') : '');
          return h(Dialog, {
            title: t('dialog.removeTitle'),
            onCancel: () => setDialog(null),
            actions: [
              h('button', { key: 'cancel', type: 'button', className: 'ssf-btn', onClick: () => setDialog(null) }, t('dialog.cancel')),
              h('button', {
                key: 'ok',
                type: 'button',
                className: 'ssf-btn ssf-btn--danger',
                onClick: () => { setDialog(null); removeEntries(items); },
              }, t('dialog.delete')),
            ],
          }, h('p', { key: 'body', className: 'ssf-dialog-body' }, body));
        }
        return null;
      })();

      // ─────────────────────────────────────────────────────────── keyboard
      const onKeyDown = useCallback((event) => {
        const target = event.target;
        const tag = target && target.tagName ? target.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;
        // Keep the tree's shortcuts out of toolbars, the source select, menus and
        // ordinary anchors (Enter on a button must press the button).
        if (target && typeof target.closest === 'function'
          && target.closest('button, select, a, [role="menuitem"], .ssf-menu, .ssf-dialog')) return;
        if (dialog || menu) return;
        const meta = event.metaKey || event.ctrlKey;
        const selectedRow = selection.length === 1 ? selection[0] : null;
        const scrollToRow = (row) => {
          const nodes = rootRef.current ? rootRef.current.querySelectorAll('[data-ssf-path]') : [];
          for (const node of nodes) {
            if (node.getAttribute('data-ssf-path') === row.path) {
              if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
              break;
            }
          }
        };
        if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && selectedRow) {
          event.preventDefault();
          const nodes = rootRef.current ? rootRef.current.querySelectorAll('[data-ssf-path]') : [];
          let rect = { left: 24, bottom: 24, top: 24 };
          for (const node of nodes) {
            if (node.getAttribute('data-ssf-path') === selectedRow.path) {
              rect = node.getBoundingClientRect();
              break;
            }
          }
          openMenuAt(selectedRow, rect.left + 12, Math.min(rect.bottom, window.innerHeight - 40));
          return;
        }
        if (meta && (event.key === 'c' || event.key === 'C')) {
          if (selection.length > 0) { event.preventDefault(); copySelection('copy'); }
          return;
        }
        if (meta && (event.key === 'x' || event.key === 'X')) {
          if (selection.length > 0) { event.preventDefault(); copySelection('cut'); }
          return;
        }
        if (meta && (event.key === 'v' || event.key === 'V')) {
          if (clipboard && clipboard.hostId === hostOf) { event.preventDefault(); pasteInto(targetDir); }
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          if (entryRows.length === 0) return;
          event.preventDefault();
          const index = anchorPath ? entryRows.findIndex((row) => row.path === anchorPath) : -1;
          let next;
          if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = entryRows.length - 1;
          else {
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            next = index < 0 ? (delta > 0 ? 0 : entryRows.length - 1) : index + delta;
          }
          next = Math.max(0, Math.min(entryRows.length - 1, next));
          const row = entryRows[next];
          setSelection([{ ...row }]);
          setAnchorPath(row.path);
          scrollToRow(row);
          return;
        }
        if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && selectedRow && selectedRow.type === 'directory') {
          event.preventDefault();
          const open = expanded.has(selectedRow.path);
          if (event.key === 'ArrowRight' && !open) toggleDir(selectedRow.path);
          if (event.key === 'ArrowLeft' && open) toggleDir(selectedRow.path);
          return;
        }
        if (event.key === 'Enter' && selection.length === 1) {
          event.preventDefault();
          openRow(selection[0]);
          return;
        }
        if (event.key === 'F2' && selection.length === 1) {
          event.preventDefault();
          setDialog({ kind: 'rename', entry: selection[0] });
          return;
        }
        if (event.key === 'Delete' && selection.length > 0) {
          event.preventDefault();
          setDialog({ kind: 'remove', items: selection });
          return;
        }
        if (event.key === 'Escape') {
          if (selection.length > 0) {
            event.preventDefault();
            clearSelection();
          }
        }
      }, [dialog, menu, selection, anchorPath, entryRows, clipboard, hostOf, targetDir, copySelection, pasteInto, openRow, clearSelection, expanded, toggleDir, openMenuAt]);

      // ──────────────────────────────────────────────────────────── rendering
      const styleNode = h('style', { key: 'ssf-style' }, CSS);

      const renderRow = (row) => {
        if (row.kind === 'note') {
          return h('div', {
            key: row.key || row.path,
            className: 'ssf-row-note' + (row.error ? ' ssf-row-note--error' : ''),
            style: { paddingLeft: (2 + row.depth * 16) + 'px' },
          }, [
            h('span', { key: 'text' }, row.text),
            row.error ? h('button', {
              key: 'retry',
              type: 'button',
              className: 'ssf-btn',
              onClick: () => loadDir(row.dir),
            }, t('action.retry')) : null,
          ]);
        }
        const selected = selectionPaths.has(row.path);
        const isDir = row.type === 'directory';
        const open = expanded.has(row.path);
        return h('div', {
          key: row.path,
          id: nodeIdOf(row.path),
          className: 'ssf-row',
          role: 'treeitem',
          'aria-level': row.depth + 1,
          'aria-selected': selected ? 'true' : 'false',
          'aria-expanded': isDir ? (open ? 'true' : 'false') : undefined,
          'data-ssf-path': row.path,
          tabIndex: -1,
          title: row.path,
          style: { paddingLeft: (2 + row.depth * 16) + 'px' },
          onClick: (event) => selectRow(row, event),
          onDoubleClick: () => openRow(row),
          onContextMenu: (event) => openMenu(event, row),
        }, [
          h('button', {
            key: 'chevron',
            type: 'button',
            className: 'ssf-chevron' + (isDir ? '' : ' ssf-chevron--leaf'),
            tabIndex: -1,
            'aria-label': isDir ? (open ? t('action.collapse') : t('action.expand')) : undefined,
            onClick: (event) => {
              event.stopPropagation();
              if (isDir) toggleDir(row.path);
              if (rootRef.current) {
                try {
                  rootRef.current.focus({ preventScroll: true });
                } catch {
                  rootRef.current.focus();
                }
              }
            },
          }, isDir ? h(IconChevron, { open }) : null),
          h('span', { key: 'icon', style: { display: 'inline-flex', color: isDir ? 'var(--dsw-alias-label-secondary)' : 'inherit' } },
            isDir ? h(IconFolder) : h(IconFile)),
          h('span', { key: 'name', className: 'ssf-row-name' }, row.name),
          h('span', { key: 'size', className: 'ssf-row-size' }, isDir ? formatTime(row.mtime) : formatSize(row.size)),
        ]);
      };

      const renderPreview = () => {
        if (!preview) {
          return h('div', { className: 'ssf-empty' }, t('state.noPreview'));
        }
        const head = h('div', { key: 'head', className: 'ssf-preview-head' }, [
          h('span', { key: 'icon', style: { display: 'inline-flex' } }, h(IconFile)),
          h('span', { key: 'name', className: 'ssf-preview-name', title: preview.path }, preview.name),
          h('span', { key: 'spacer', className: 'ssf-spacer' }),
          typeof preview.size === 'number' ? h('span', { key: 'meta', className: 'ssf-preview-meta' }, formatSize(preview.size)) : null,
          preview.mtime ? h('span', { key: 'mtime', className: 'ssf-preview-meta', title: t('preview.modified') }, formatTime(preview.mtime)) : null,
          h('button', {
            key: 'download',
            type: 'button',
            className: 'ssf-btn ssf-icon-btn',
            title: t('action.download'),
            'aria-label': t('action.download'),
            onClick: () => downloadEntries([preview]),
          }, h(IconDownload)),
        ]);
        let body;
        if (preview.kind === 'loading') {
          body = h('div', { className: 'ssf-empty' }, t('state.loading'));
        } else if (preview.kind === 'image') {
          body = h('img', {
            src: preview.url,
            alt: preview.name,
            className: 'ssf-img',
            onError: () => setPreview((current) => (current && current.kind === 'image'
              ? { kind: 'error', name: current.name, path: current.path, message: t('state.imageFailed') }
              : current)),
          });
        } else if (preview.kind === 'directory') {
          body = h('div', { className: 'ssf-empty' }, [
            h('div', { key: 'text' }, t('state.directory')),
            h('div', { key: 'meta', className: 'ssf-preview-meta', style: { paddingTop: 6 } },
              t('preview.modified') + '：' + formatTime(preview.mtime)),
          ]);
        } else if (preview.kind === 'pdf') {
          body = h('iframe', { src: preview.url, className: 'ssf-pdf', title: preview.name });
        } else if (preview.kind === 'binary') {
          body = h('div', { className: 'ssf-empty' }, t('state.binary'));
        } else if (preview.kind === 'error') {
          body = h('div', { className: 'ssf-empty ssf-error' }, preview.message);
        } else {
          body = h('div', {}, [
            h('pre', { key: 'pre', className: 'ssf-pre' }, preview.text),
            preview.truncated ? h('div', { key: 'trunc', className: 'ssf-preview-meta', style: { paddingTop: '8px' } },
              t('state.truncated', { bytes: formatSize(preview.readBytes) })) : null,
          ]);
        }
        const pdf = preview.kind === 'pdf';
        return h('div', { className: 'ssf-preview-wrap' }, [
          head,
          h('div', {
            key: 'body',
            className: 'ssf-preview-body',
            style: pdf ? { padding: 0, overflow: 'hidden' } : undefined,
          }, body),
        ]);
      };

      const sourceOptions = useMemo(() => {
        if (!sources) return [];
        const options = [];
        for (const workspace of sources.workspaces) {
          const host = sources.hosts.find((item) => item.id === workspace.hostId);
          const hostName = host ? host.name : workspace.hostId;
          options.push({ value: 'ws:' + workspace.id, label: t('source.workspace') + ' · ' + workspace.title + ' — ' + hostName, group: 'workspace' });
        }
        for (const host of sources.hosts) {
          options.push({ value: 'host:' + host.id, label: t('source.host') + ' · ' + host.name + ' — ' + host.user + '@' + host.host, group: 'host' });
        }
        return options;
      }, [sources]);

      const hasSources = sourceOptions.length > 0;
      const empty = !sources ? t('state.loading') : (!hasSources ? (sourcesError || t('source.none')) : '');

      return h('div', { className: 'ssf-root', role: 'region', 'aria-label': t('panel.title') }, [
        styleNode,
        h('div', { key: 'top', className: 'ssf-top' }, [
          h('span', { key: 'title', className: 'ssf-title' }, t('panel.title')),
          h('select', {
            key: 'source',
            className: 'ssf-select',
            value: sourceKey,
            'aria-label': t('source.label'),
            disabled: !hasSources,
            onChange: (event) => setSourceKey(event.target.value),
          }, [
            !hasSources ? h('option', { key: 'none', value: '' }, t('source.label')) : null,
            ...sourceOptions.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          ]),
          h('span', { key: 'spacer', className: 'ssf-spacer' }),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'ssf-btn ssf-icon-btn',
            title: t('action.refresh'),
            'aria-label': t('action.refresh'),
            disabled: !root || busy,
            onClick: refreshAll,
          }, h(IconRefresh)),
          h('button', {
            key: 'upload',
            type: 'button',
            className: 'ssf-btn',
            disabled: !root || busy,
            onClick: () => { if (fileInput.current) fileInput.current.click(); },
          }, [h(IconUpload, { key: 'icon' }), h('span', { key: 'label' }, t('action.upload'))]),
          h('button', {
            key: 'newFolder',
            type: 'button',
            className: 'ssf-btn',
            disabled: !root || busy,
            onClick: () => setDialog({ kind: 'mkdir', dir: targetDir }),
          }, [h(IconPlus, { key: 'icon' }), h('span', { key: 'label' }, t('action.newFolder'))]),
          h('button', {
            key: 'newFile',
            type: 'button',
            className: 'ssf-btn',
            disabled: !root || busy,
            onClick: () => setDialog({ kind: 'newfile', dir: targetDir }),
          }, [h(IconNewFile, { key: 'icon' }), h('span', { key: 'label' }, t('action.newFile'))]),
          h('input', {
            key: 'file',
            ref: fileInput,
            type: 'file',
            multiple: true,
            style: { display: 'none' },
            onChange: (event) => {
              const files = event.target.files;
              event.target.value = '';
              uploadFiles(files, targetDir);
            },
          }),
        ]),
        h('div', { key: 'crumbs', className: 'ssf-crumbs' }, [
          h('button', {
            key: 'up',
            type: 'button',
            className: 'ssf-btn ssf-icon-btn',
            title: t('action.up'),
            'aria-label': t('action.up'),
            disabled: !root || root === '/' || !hostOf,
            onClick: () => navigateTo(parentOf(root)),
          }, strokeIcon(h('path', { key: 'a', d: 'M8 13V4M4.5 7.5L8 4l3.5 3.5' }), 14)),
          h('input', {
            key: 'path',
            className: 'ssf-crumbs-input',
            value: pathDraft,
            spellCheck: false,
            'aria-label': t('source.label'),
            placeholder: '/',
            onChange: (event) => setPathDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                navigateTo(pathDraft);
              }
            },
          }),
          hostLabel ? h('span', { key: 'host', title: hostLabel, style: { opacity: .9, whiteSpace: 'nowrap' } }, hostLabel) : null,
        ]),
        h('div', { key: 'main', className: 'ssf-main' }, [
          h('div', {
            key: 'tree',
            ref: rootRef,
            tabIndex: 0,
            className: 'ssf-tree-wrap' + (dropTarget ? ' ssf-tree-wrap--drop' : ''),
            role: 'tree',
            'aria-label': t('panel.title'),
            'aria-multiselectable': 'true',
            'aria-activedescendant': selection.length === 1 ? nodeIdOf(selection[0].path) : undefined,
            onKeyDown,
            onContextMenu: (event) => { if (event.target === event.currentTarget) openMenu(event, null); },
            onDragOver: (event) => {
              event.preventDefault();
              const next = resolveDropDir(event);
              setDropPath(next);
              if (!dropTarget) setDropTarget(true);
            },
            onDragLeave: (event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              setDropTarget(false);
            },
            onDrop: (event) => {
              event.preventDefault();
              const destination = resolveDropDir(event);
              setDropTarget(false);
              if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                uploadFiles(event.dataTransfer.files, destination);
              }
            },
          }, [
            dropTarget ? h('div', { key: 'drophint', className: 'ssf-drop-hint' },
              t('state.dropHint', { dir: dropPath || targetDir })) : null,
            ...(root ? rows.map(renderRow) : [h('div', { key: 'empty', className: 'ssf-empty' }, [
              h('div', { key: 'text' }, sourcesError || empty || t('state.loading')),
              (sourcesError || (sources && !hasSources)) ? h('button', {
                key: 'retry',
                type: 'button',
                className: 'ssf-btn',
                onClick: () => setSourcesAttempt((attempt) => attempt + 1),
              }, t('action.retry')) : null,
            ])]),
          ]),
          preview ? renderPreview() : h('div', { key: 'preview', className: 'ssf-preview-wrap' },
            h('div', { className: 'ssf-empty' }, t('state.noPreview'))),
        ]),
        h('div', { key: 'foot', className: 'ssf-foot' }, [
          h('span', { key: 'count', className: 'ssf-preview-meta' },
            selection.length > 0 ? t('state.selected', { count: selection.length }) : t('state.noSelection')),
          h('button', {
            key: 'download',
            type: 'button',
            className: 'ssf-btn',
            disabled: selection.length === 0 || !hostOf || busy,
            onClick: () => downloadEntries(selection),
          }, [h(IconDownload, { key: 'icon' }), h('span', { key: 'label' }, t('action.download'))]),
          h('button', {
            key: 'copy',
            type: 'button',
            className: 'ssf-btn',
            disabled: selection.length === 0 || busy,
            onClick: () => copySelection('copy'),
          }, t('action.copy')),
          h('button', {
            key: 'cut',
            type: 'button',
            className: 'ssf-btn',
            disabled: selection.length === 0 || busy,
            onClick: () => copySelection('cut'),
          }, t('action.cut')),
          h('button', {
            key: 'paste',
            type: 'button',
            className: 'ssf-btn',
            disabled: !clipboard || !hostOf || busy || clipboard.hostId !== hostOf,
            title: clipboard && clipboard.hostId === hostOf ? t('action.pasteInto', { dir: targetDir }) : t('action.paste'),
            onClick: () => pasteInto(targetDir),
          }, t('action.paste')),
          h('button', {
            key: 'rename',
            type: 'button',
            className: 'ssf-btn',
            disabled: selection.length !== 1 || busy,
            onClick: () => setDialog({ kind: 'rename', entry: selection[0] }),
          }, t('action.rename')),
          h('button', {
            key: 'remove',
            type: 'button',
            className: 'ssf-btn ssf-btn--danger',
            disabled: selection.length === 0 || busy,
            onClick: () => setDialog({ kind: 'remove', items: selection }),
          }, t('action.remove')),
          h('span', { key: 'spacer', className: 'ssf-spacer' }),
          h('span', {
            key: 'status',
            className: 'ssf-status ssf-status--' + (status ? status.kind : 'idle'),
            role: 'status',
            'aria-live': 'polite',
            title: status ? status.text : undefined,
          }, status ? status.text : (busy ? t('state.busy') : '')),
        ]),
        menu ? h('div', {
          key: 'menu',
          ref: menuRef,
          className: 'ssf-menu',
          role: 'menu',
          style: { left: menu.x + 'px', top: menu.y + 'px' },
          onMouseDown: (event) => event.stopPropagation(),
          onContextMenu: (event) => event.preventDefault(),
        }, menuItems.map((item, index) => item.separator
          ? h('div', { key: 'sep-' + index, className: 'ssf-menu-sep', role: 'separator' })
          : h('button', {
            key: item.id,
            type: 'button',
            role: 'menuitem',
            className: 'ssf-menu-item' + (item.danger ? ' ssf-error' : ''),
            disabled: item.disabled === true,
            onClick: () => { setMenu(null); item.action(); },
          }, item.label))) : null,
        dialogNode,
        overwriteAsk ? h(Dialog, {
          key: 'overwrite',
          title: t('dialog.overwriteTitle'),
          onCancel: () => { const ask = overwriteAsk; setOverwriteAsk(null); ask.resolve(false); },
          actions: [
            h('button', {
              key: 'skip',
              type: 'button',
              className: 'ssf-btn',
              onClick: () => { const ask = overwriteAsk; setOverwriteAsk(null); ask.resolve(false); },
            }, t('action.skip')),
            h('button', {
              key: 'overwrite',
              type: 'button',
              className: 'ssf-btn ssf-btn--primary',
              onClick: () => { const ask = overwriteAsk; setOverwriteAsk(null); ask.resolve(true); },
            }, t('action.overwrite')),
          ],
        }, h('p', { className: 'ssf-dialog-body' },
          t('dialog.overwriteBody', { name: overwriteAsk.name })
          + (overwriteAsk.many ? ' ' + t('dialog.overwriteRemember') : ''))) : null,
      ]);
    }

    // ─────────────────────────────────────────────────────────────────── entry
    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-ssh-file-manager: locale');
      const tBound = ctx.locale.bind(NS);
      translate = (key) => tBound(key);

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 60,
        label: () => t('panel.title'),
      }, PanelIcon));

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
      }, SshFilesPanel));
    }

    return {
      name: 'dsh-ssh-file-manager',
      inject,
      apply,
      // Exported for the rendering smoke test only; the module loader reads
      // name / inject / apply and ignores everything else.
      Panel: SshFilesPanel,
      Icon: PanelIcon,
    };
  },
});
