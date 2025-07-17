const { Modal } = require('obsidian');

class ClientIdModal extends Modal {
  constructor(app, onSubmit) { super(app); this.onSubmit = onSubmit; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    contentEl.createEl('h2', { text: '🔑 Enter Client ID' });
    contentEl.createEl('p', { text: 'Enter your AniList application Client ID', cls: 'auth-modal-desc' });
    const container = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = container.createEl('input', { type: 'text', placeholder: 'Client ID', cls: 'auth-input' });
    const buttons = contentEl.createEl('div', { cls: 'auth-button-container' });
    const save = buttons.createEl('button', { text: 'Save', cls: 'mod-cta auth-button' });
    const cancel = buttons.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    save.onclick = () => { const v = input.value.trim(); if (v) { this.onSubmit(v); this.close(); } };
    cancel.onclick = () => this.close();
    input.onkeypress = e => { if (e.key === 'Enter') save.click(); };
    setTimeout(() => input.focus(), 100);
  }
}

class ClientSecretModal extends Modal {
  constructor(app, onSubmit) { super(app); this.onSubmit = onSubmit; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    contentEl.createEl('h2', { text: '🔐 Enter Client Secret' });
    contentEl.createEl('p', { text: 'Enter your AniList application Client Secret', cls: 'auth-modal-desc' });
    const container = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = container.createEl('input', { type: 'password', placeholder: 'Client Secret', cls: 'auth-input' });
    const buttons = contentEl.createEl('div', { cls: 'auth-button-container' });
    const save = buttons.createEl('button', { text: 'Save', cls: 'mod-cta auth-button' });
    const cancel = buttons.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    save.onclick = () => { const v = input.value.trim(); if (v) { this.onSubmit(v); this.close(); } };
    cancel.onclick = () => this.close();
    input.onkeypress = e => { if (e.key === 'Enter') save.click(); };
    setTimeout(() => input.focus(), 100);
  }
}

class AuthPinModal extends Modal {
  constructor(app, onSubmit) { super(app); this.onSubmit = onSubmit; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal pin-modal');
    contentEl.createEl('h2', { text: '🔓 Complete Authentication' });
    contentEl.createEl('p', { text: 'Copy the authorization code from the browser and paste it below', cls: 'auth-modal-desc' });
    const container = contentEl.createEl('div', { cls: 'auth-input-container' });
    const input = container.createEl('input', { type: 'text', placeholder: 'Paste authorization code here', cls: 'auth-input pin-input' });
    const buttons = contentEl.createEl('div', { cls: 'auth-button-container' });
    const save = buttons.createEl('button', { text: '✅ Complete Authentication', cls: 'mod-cta auth-button submit-button' });
    const cancel = buttons.createEl('button', { text: 'Cancel', cls: 'auth-button' });
    save.onclick = () => { const v = input.value.trim(); if (v) { this.onSubmit(v); this.close(); } };
    cancel.onclick = () => this.close();
    input.onkeypress = e => { if (e.key === 'Enter') save.click(); };
    input.oninput = () => save.classList.toggle('ready', input.value.trim());
    setTimeout(() => input.focus(), 100);
  }
}

module.exports = { ClientIdModal, ClientSecretModal, AuthPinModal };
