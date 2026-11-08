import { test } from 'node:test';
import { LoopbackTransport } from '../../src/transport/loopback.js';
import { runTransportContract } from './contract.js';

runTransportContract(test, async () => {
  const [a, b] = LoopbackTransport.pair();
  return { a, b, cleanup: async () => {} };
}, 'loopback');
