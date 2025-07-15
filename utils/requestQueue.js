export function RequestQueue() {
  const queue = [];
  const delay = 730; // ~89 requests/min (AniList limit: 90/min)
  let isProcessing = false;

  async function process() {
    if (isProcessing || !queue.length) return;

    isProcessing = true;
    const { requestFn, resolve } = queue.shift();

    try {
      const result = await requestFn();
      resolve(result);
    } finally {
      setTimeout(() => {
        isProcessing = false;
        process();
      }, delay);
    }
  }

  function add(requestFn) {
    return new Promise((resolve) => {
      queue.push({ requestFn, resolve });
      process();
    });
  }

  return { add };
}