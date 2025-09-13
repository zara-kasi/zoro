/**
 * Authentication modal for user credential input
 * Migrated from AuthModal.js → AuthModal.ts
 * - Added comprehensive types for configuration and DOM elements
 * - Typed Obsidian Modal integration
 * - Added proper event handler typing
 */

import type { App } from 'obsidian';
import { Modal } from 'obsidian';

interface AuthModalConfig {
  title?: string;
  description?: string;
  placeholder?: string;
  submitText?: string;
  inputType?: 'text' | 'password' | 'email' | 'url';
  extraClasses?: string[];
  showReady?: boolean;
  onSubmit: (value: string) => void;
}

interface AuthModalElements {
  input: HTMLInputElement;
  submitButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
}

export class AuthModal extends Modal {
  private readonly config: Required<Omit<AuthModalConfig, 'onSubmit'>> & Pick<AuthModalConfig, 'onSubmit'>;
  private readonly onSubmit: (value: string) => void;
  private input!: HTMLInputElement;
  private submitButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;

  constructor(app: App, config: AuthModalConfig) {
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

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('auth-modal', ...this.config.extraClasses);
    
    this.createHeader();
    this.createInput();
    this.createButtons();
    this.setupEventHandlers();
    
    // Focus input after DOM is ready
    setTimeout(() => this.input.focus(), 100);
  }

  private createHeader(): void {
    this.contentEl.createEl('h2', { text: this.config.title });
    
    const desc = this.contentEl.createEl('p', { cls: 'auth-modal-desc' });
    desc.setText(this.config.description);
  }

  private createInput(): void {
    const inputContainer = this.contentEl.createEl('div', { cls: 'auth-input-container' });
    
    const inputClasses = [
      'auth-input',
      // Add pin-input class for text inputs in pin modals
      this.config.inputType === 'text' && this.config.extraClasses.includes('pin-modal') ? 'pin-input' : ''
    ].filter(Boolean);
    
    this.input = inputContainer.createEl('input', {
      type: this.config.inputType,
      placeholder: this.config.placeholder,
      cls: inputClasses.join(' ')
    });
  }

  private createButtons(): void {
    const buttonContainer = this.contentEl.createEl('div', { cls: 'auth-button-container' });
    
    const submitClasses = [
      'mod-cta',
      'auth-button',
      this.config.showReady ? 'submit-button' : ''
    ].filter(Boolean);
    
    this.submitButton = buttonContainer.createEl('button', {
      text: this.config.submitText,
      cls: submitClasses.join(' ')
    });
    
    this.cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'auth-button'
    });
  }

  private setupEventHandlers(): void {
    const closeModal = (): void => this.close();
    
    // Submit button handler
    this.submitButton.addEventListener('click', () => {
      const value = this.input.value.trim();
      if (value) {
        this.onSubmit(value);
        closeModal();
      }
    });
    
    // Cancel button handler
    this.cancelButton.addEventListener('click', closeModal);
    
    // Enter key handler
    this.input.addEventListener('keypress', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        this.submitButton.click();
      }
    });
    
    // Optional ready state indicator
    if (this.config.showReady) {
      this.input.addEventListener('input', (e: Event) => {
        const target = e.target as HTMLInputElement;
        const value = target.value.trim();
        this.submitButton.classList.toggle('ready', !!value);
      });
    }
  }

  // Static factory methods for common authentication scenarios
  static clientId(app: App, onSubmit: (value: string) => void): AuthModal {
    return new AuthModal(app, {
      title: '🔑 Enter Client ID',
      description: 'Enter your application Client ID',
      placeholder: 'Client ID',
      onSubmit
    });
  }

  static clientSecret(app: App, onSubmit: (value: string) => void): AuthModal {
    return new AuthModal(app, {
      title: '🔒 Enter Client Secret',
      description: 'Enter your application Client Secret',
      placeholder: 'Client Secret',
      inputType: 'password',
      onSubmit
    });
  }

  static malCallback(app: App, onSubmit: (value: string) => void): AuthModal {
    return new AuthModal(app, {
      title: '🔐 MAL Authentication',
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
