// Where this copy of Ledger lives. Normally that is the root of its own address and BASE is empty.
// Inside Home Assistant (the add-on) the pages sit under a longer path that Home Assistant chooses,
// so every address that starts at the root has to be given that path first. `at()` does it for the
// addresses written into the page (pictures, downloads, films); calls made with fetch are covered
// once, below.
export const BASE = location.pathname.replace(/\/[^/]*$/, '');
export const at = (path: string) => (BASE && path.startsWith('/') ? BASE + path : path);

if (BASE) {
  const plain = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => plain(typeof input === 'string' ? at(input) : input, init)) as typeof window.fetch;
}
