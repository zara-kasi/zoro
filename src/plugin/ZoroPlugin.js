class RequestQueue {
  constructor(delay = 700) {
    this.queue = [];
    this.delay = delay;
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
      resolve(await requestFn());
    } finally {
      setTimeout(() => {
        this.isProcessing = false;
        this.process();
      }, this.delay);
    }
  }
}

module.exports.RequestQueue = RequestQueue;