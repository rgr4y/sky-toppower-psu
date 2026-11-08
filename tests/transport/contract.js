import assert from 'node:assert/strict';

export function runTransportContract(test, makeConnectedPair, label) {
  test(`${label}: write on A is delivered to B onData`, async () => {
    const { a, b, cleanup } = await makeConnectedPair();
    const got = [];
    b.onData((u8) => got.push([...u8]));
    await a.open({ id: 'x' }); await b.open({ id: 'x' });
    await a.write(new Uint8Array([1, 2, 3]));
    await tick();
    assert.deepEqual(got.at(-1), [1, 2, 3]);
    await cleanup();
  });
  test(`${label}: isOpen reflects open/close`, async () => {
    const { a, cleanup } = await makeConnectedPair();
    assert.equal(a.isOpen, false);
    await a.open({ id: 'x' });
    assert.equal(a.isOpen, true);
    await a.close();
    assert.equal(a.isOpen, false);
    await cleanup();
  });
}

const tick = () => new Promise((r) => setTimeout(r, 5));
