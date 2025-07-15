export class ClientSecretModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('auth-modal');
    
    contentEl.createEl('h2', { text: '🔐 Enter Client Secret' });
    
    const desc = contentEl.createEl('p');
    desc.setText('Enter your AniList application Client Secret');
    desc.addClass('auth-modal-desc');
    
    const inputContainer = contentEl.createEl('div', { cls: 'auth-input-container' });
    
    const input = inputContainer.createEl('input', {
      type: 'password',
      placeholder: 'Client Secret',
      cls: 'auth-input'
    });
    
    const buttonContainer = contentEl.createEl('div', { cls: 'auth-button-container' });
    
    const submitButton = buttonContainer.createEl('button', {
      text: 'Save',
      cls: 'mod-cta auth-button'
    });
    
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'auth-button'
    });
    
    submitButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (value) {
        this.onSubmit(value);
        this.close();
      }
    });
    
    cancelButton.addEventListener('click', () => {
      this.close();
    });
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        submitButton.click();
      }
    });
    
    setTimeout(() => input.focus(), 100);
  }
}
