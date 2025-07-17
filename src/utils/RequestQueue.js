export default class RequestQueue {
  constructor() {
    this.queue = [];
    this.delay = 700; // ~85 req/min
    this.isProcessing = false;
  }

  add(requestFn) {
    return new Promise(resolve => {
      this.queue.push({ requestFn, resolve });
      this.process();
    });
  }

  async process() {
    if (this.isProcessing || !this.queue.length) return;
    this.isProcessing = true;
    const { requestFn, resolve } = this.queue.shift();
    try {
      const result = await requestFn();
      resolve(result);
    } finally {
      setTimeout(() => {
        this.isProcessing = false;
        this.process();
      }, this.delay);
    }
  }
}
