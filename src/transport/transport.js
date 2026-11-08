// Interface (documentation + no-op base). Implementations must match this surface.
export class Transport {
  async open(spec) {}
  async close() {}
  async write(u8) {}
  onData(cb) {}
  onStatus(cb) {}
  get isOpen() { return false; }
}
