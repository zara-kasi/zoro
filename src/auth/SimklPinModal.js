const { Notice, Modal } = require('obsidian');

class SimklPinModal extends Modal {
  constructor(app, deviceData, onCancel) {
    super(app);
    this.deviceData = deviceData;
    this.onCancel = onCancel;
    this.countdownInterval = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('simkl-pin-modal');

    contentEl.createEl('h2', { 
      text: '🔐 SIMKL Authentication',
      attr: { style: 'text-align: center; margin-bottom: 20px;' }
    });

    const instructionsEl = contentEl.createEl('div', {
      attr: { style: 'text-align: center; padding: 20px;' }
    });

    instructionsEl.createEl('h3', { 
      text: 'Your PIN Code:',
      attr: { style: 'margin-bottom: 15px;' }
    });

    // Large PIN code display
    const codeEl = instructionsEl.createEl('div', {
      text: this.deviceData.user_code,
      cls: 'simkl-pin-code',
      attr: { 
        style: 'font-size: 3em; font-weight: bold; color: var(--interactive-accent); margin: 30px 0; padding: 20px; border: 3px solid var(--interactive-accent); border-radius: 12px; font-family: monospace; letter-spacing: 5px;'
      }
    });

    // Instructions
    const steps = instructionsEl.createEl('ol', {
      attr: { style: 'text-align: left; max-width: 400px; margin: 0 auto 20px auto;' }
    });
    steps.createEl('li', { text: 'The SIMKL PIN page should have opened in your browser' });
    steps.createEl('li', { text: 'Enter the code shown above' });
    steps.createEl('li', { text: 'This dialog will close automatically when complete' });

    // Buttons
    const buttonContainer = instructionsEl.createEl('div', {
      attr: { style: 'margin-top: 20px;' }
    });

    const copyButton = buttonContainer.createEl('button', {
      text: '📋 Copy Code',
      cls: 'mod-cta',
      attr: { style: 'margin: 5px;' }
    });

    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      attr: { style: 'margin: 5px;' }
    });

    // Countdown
    const countdownEl = instructionsEl.createEl('div', {
      attr: { style: 'margin-top: 15px; font-size: 0.9em; color: var(--text-muted);' }
    });

    // Event handlers
    copyButton.onclick = () => {
      navigator.clipboard.writeText(this.deviceData.user_code);
      new Notice('📋 Code copied to clipboard!');
    };

    cancelButton.onclick = () => {
      this.close();
      if (this.onCancel) this.onCancel();
      new Notice('Authentication cancelled.');
    };

    // Start countdown
    let timeLeft = this.deviceData.expires_in || 900;
    const updateCountdown = () => {
      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft % 60;
      countdownEl.textContent = `⏰ Code expires in: ${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      if (timeLeft > 0) {
        timeLeft--;
      } else {
        this.close();
        if (this.onCancel) this.onCancel();
      }
    };
    
    updateCountdown();
    this.countdownInterval = setInterval(updateCountdown, 1000);
  }

  onClose() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
  }
}

module.exports = { SimklPinModal };