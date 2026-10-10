import { beforeEach, describe } from 'vitest';

import { describeBackendContract, type BackendClient } from '../backend/contract';

import { loadCodeGsBackend, type CodeGsBackend } from './load-code-gs-backend';

/**
 * Code.gs 接假的試算表（fake-spreadsheet.ts）跑後端共同規格（tests/backend/contract.ts），
 * 跟 MSW 假後端同一組案例
 */
let backend: CodeGsBackend;

beforeEach(() => {
  backend = loadCodeGsBackend();
});

const client: BackendClient = {
  post: async (body) => backend.doPost(body),
  get: async (params) => backend.doGet(params),
};

describe('Code.gs', () => {
  describeBackendContract(() => client);
});
