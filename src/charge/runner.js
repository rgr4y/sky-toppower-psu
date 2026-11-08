import { initState, tick } from './engine.js';

export class ChargeRunner {
  constructor({ apply, now }) { this.apply = apply; this.now = now; this.state = null; this.startMs = 0; this.stageMs = 0; this.cb = () => {}; }
  get stage() { return this.state ? this.state.stage : 'IDLE'; }
  onChange(cb) { this.cb = cb; }
  start(job, env) { this.state = initState(job, env); this.state.started = true; this.startMs = this.now(); this.stageMs = this.now(); this.cb(this.state, []); }
  abort() { if (this.state) { this.apply({ type: 'OUTPUT', value: false }); this.state = initState(this.state.job, this.state.env); this.cb(this.state, []); } }
  feed(tele) {
    if (!this.state) return;
    const prevStage = this.state.stage;
    const inputs = { ...tele, elapsedS: (this.now() - this.startMs) / 1000, stageElapsedS: (this.now() - this.stageMs) / 1000 };
    const r = tick(this.state, inputs);
    for (const w of r.writes) this.apply(w);
    if (r.state.stage !== prevStage) this.stageMs = this.now();
    this.state = r.state;
    this.cb(this.state, r.events);
  }
}
