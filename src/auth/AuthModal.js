import { Modal } from 'obsidian';

class AuthModal extends Modal {
  constructor(app, config) {
    super(app);
    this.config = {
      title: '🔑 Authentication',
      description: 'Enter your credentials',
      placeholder: 'Enter value',
      submitText: 'Save',
      inputType: 'text',
      extraClasses: [],
      showReady: false,
      ...config
    };
    this.onSubmit = config.onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal', ...this.config.extraClasses);
    
    this.createHeader();
    this.createInput();
    this.createButtons();
    this.setupEventHandlers();
    
    setTimeout(() => this.input.focus(), 100);
  }

  createHeader() {
    this.contentEl.createEl('h2', { text: this.config.title });
    
    const desc = this.contentEl.createEl('p', { cls: 'auth-modal-desc' });
    desc.setText(this.config.description);
  }

  createInput() {
    const inputContainer = this.contentEl.createEl('div', { cls: 'auth-input-container' });
    
    this.input = inputContainer.createEl('input', {
      type: this.config.inputType,
      placeholder: this.config.placeholder,
      cls: `auth-input ${this.config.inputType === 'text' && this.config.extraClasses.includes('pin-modal') ? 'pin-input' : ''}`
    });
  }

  createButtons() {
    const buttonContainer = this.contentEl.createEl('div', { cls: 'auth-button-container' });
    
    this.submitButton = buttonContainer.createEl('button', {
      text: this.config.submitText,
      cls: `mod-cta auth-button ${this.config.showReady ? 'submit-button' : ''}`
    });
    
    this.cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'auth-button'
    });
  }

  setupEventHandlers() {
    const closeModal = () => this.close();
    
    this.submitButton.addEventListener('click', () => {
      const value = this.input.value.trim();
      if (value) {
        this.onSubmit(value);
        closeModal();
      }
    });
    
    this.cancelButton.addEventListener('click', closeModal);
    
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.submitButton.click();
      }
    });
    
    if (this.config.showReady) {
      this.input.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        this.submitButton.classList.toggle('ready', !!value);
      });
    }
  }

  // Static factory methods for convenience
  static clientId(app, onSubmit) {
    return new AuthModal(app, {
      title: '🔑 Enter Client ID',
      description: 'Enter your application Client ID',
      placeholder: 'Client ID',
      onSubmit
    });
  }

  static clientSecret(app, onSubmit) {
    return new AuthModal(app, {
      title: '🔐 Enter Client Secret',
      description: 'Enter your application Client Secret',
      placeholder: 'Client Secret',
      inputType: 'password',
      onSubmit
    });
  }

  // AniList PIN modal
  static aniListPin(app, onSubmit) {
    return new AuthModal(app, {
      title: '🔓 AniList Authentication',
      description: 'Paste the PIN code from the browser:',
      placeholder: 'Paste PIN code here',
      submitText: '✅ Complete Authentication',
      extraClasses: ['pin-modal'],
      showReady: true,
      onSubmit
    });
  }

  // MAL callback URL modal
  static malCallback(app, onSubmit) {
    return new AuthModal(app, {
      title: '🔓 MAL Authentication',
      description: 'Paste the FULL callback URL from the browser:',
      placeholder: 'Paste callback URL here',
      submitText: '✅ Complete Authentication',
      extraClasses: ['pin-modal'],
      showReady: true,
      onSubmit
    });
  }
}

export { AuthModal };