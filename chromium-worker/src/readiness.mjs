export async function checkBrowserReady(factory, timeoutMs = 3000) {
  const bounded = (operation) => {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("browser readiness timeout")), timeoutMs)
    })
    return Promise.race([operation, timeout]).finally(() => clearTimeout(timer))
  }
  const browser = await bounded(factory())
  if (browser.isConnected && !browser.isConnected()) throw new Error("browser disconnected")
  await bounded(browser.version())
}
