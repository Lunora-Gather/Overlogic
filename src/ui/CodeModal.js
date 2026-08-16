// CodeModal.js — themed share/import dialog for build codes.
// Keeps clipboard fallbacks and focus handling in one reusable UI boundary.

import { AudioManager } from '../systems/AudioManager.js?v=20260725-4';
import { trapDialogFocus } from './focusTrap.js?v=20260725-4';
import { t } from '../i18n/I18n.js?v=20260725-4';
import { copyText } from './Clipboard.js?v=20260725-4';

export class CodeModal {
  constructor() {
    this.overlay = document.getElementById('code-overlay');
    this.title = document.getElementById('code-title');
    this.description = document.getElementById('code-description');
    this.textarea = document.getElementById('code-textarea');
    this.primary = document.getElementById('btn-code-primary');
    this.copy = document.getElementById('btn-code-copy');
    this.cancel = document.getElementById('btn-code-cancel');
    this._mode = null;
    this._resolver = null;
    this._returnFocus = null;
    this._descriptionKey = null;

    trapDialogFocus(this.overlay);
    this.primary?.addEventListener('click', () => {
      this._close(this._mode === 'import' ? (this.textarea?.value || '') : null);
    });
    this.copy?.addEventListener('click', () => this._copyToClipboard());
    this.cancel?.addEventListener('click', () => this._close(null));
    this.overlay?.addEventListener('click', (event) => {
      if (event.target === this.overlay) this._close(null);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.overlay && !this.overlay.classList.contains('hidden')) {
        event.preventDefault();
        this._close(null);
      }
    });
    window.addEventListener('overlogic:localechange', () => this._renderCopy());
  }

  openExport(code) {
    if (!this._ready()) return;
    if (this._resolver) this._close(null);
    this._mode = 'export';
    this._descriptionKey = 'editor.shareDescription';
    this._returnFocus = document.activeElement;
    this.textarea.value = String(code || '');
    this.textarea.readOnly = true;
    this.textarea.classList.add('readonly');
    this._renderCopy();
    this._show();
    this.copy.focus();
    // Preserve the fast path players expect, while leaving a visible code
    // field for manual copying on devices without clipboard permission.
    this._copyToClipboard({ quiet: true });
  }

  openImport() {
    if (!this._ready()) return Promise.resolve(null);
    if (this._resolver) this._close(null);
    this._mode = 'import';
    this._descriptionKey = 'editor.importDescription';
    this._returnFocus = document.activeElement;
    this.textarea.value = '';
    this.textarea.readOnly = false;
    this.textarea.classList.remove('readonly');
    this._renderCopy();
    this._show();
    this.textarea.focus();
    return new Promise((resolve) => { this._resolver = resolve; });
  }

  _ready() {
    return !!(this.overlay && this.textarea && this.primary && this.copy && this.cancel);
  }

  _show() {
    this.overlay.classList.remove('hidden');
    this.overlay.setAttribute('aria-hidden', 'false');
  }

  _renderCopy() {
    if (!this._ready()) return;
    const importing = this._mode === 'import';
    this.title.textContent = t(importing ? 'editor.importTitle' : 'editor.codeTitle');
    this.description.textContent = t(this._descriptionKey || (importing ? 'editor.importDescription' : 'editor.shareDescription'));
    this.primary.textContent = t(importing ? 'editor.import' : 'common.close');
    this.primary.classList.remove('hidden');
    this.copy.textContent = t('editor.copy');
    this.copy.classList.toggle('hidden', importing);
    this.cancel.classList.toggle('hidden', !importing);
    this.copy.classList.toggle('primary', !importing);
    this.copy.classList.toggle('secondary', importing);
  }

  async _copyToClipboard({ quiet = false } = {}) {
    if (!this.textarea) return false;
    const copied = await copyText(this.textarea.value);
    if (!copied) {
      this.textarea.focus();
      this.textarea.select();
    }
    if (!quiet) {
      this.copy.textContent = t(copied ? 'editor.copied' : 'editor.copyFailed');
      AudioManager.play(copied ? 'rule_add' : 'button_click');
      window.setTimeout(() => this._renderCopy(), 1400);
    }
    return copied;
  }

  _close(value) {
    if (!this.overlay || !this._mode) return;
    const resolve = this._resolver;
    this._resolver = null;
    this._mode = null;
    this._descriptionKey = null;
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    if (this._returnFocus instanceof HTMLElement) this._returnFocus.focus();
    this._returnFocus = null;
    AudioManager.play('button_click');
    if (resolve) resolve(value);
  }
}
