/** Wait for locally embedded fonts/images before taking the printable snapshot. */
export async function waitForPrintAssets(page, timeoutMs = 15_000) {
  await page.evaluate(async (assetTimeoutMs) => {
    let timer;
    try {
      await Promise.race([
        (async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images, (image) => image.decode()));
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Printable assets did not become ready")), assetTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }, timeoutMs);
}
