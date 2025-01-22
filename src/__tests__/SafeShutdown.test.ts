import Diagnostics from '../Diagnostics';
import LogEvent from '../LogEvent';
import LogEventProcessor from '../LogEventProcessor';
import SpecStore from '../SpecStore';
import { ExplicitStatsigOptions, OptionsWithDefaults } from '../StatsigOptions';
import StatsigServer from '../StatsigServer';
import { InitializeContext } from '../utils/StatsigContext';
import StatsigFetcher from '../utils/StatsigFetcher';
import { getDecodedBody } from './StatsigTestUtils';

jest.mock('node-fetch', () => jest.fn());

const CONFIG_SPEC_RESPONSE = JSON.stringify(
  require('./data/exposure_logging_dcs.json'),
);

describe('Verifies safe shutdown of Statsig SDK', () => {
  const options: ExplicitStatsigOptions = {
    ...OptionsWithDefaults({}),
    ...{
      rulesetsSyncIntervalMs: 100,
      idListsSyncIntervalMs: 100,
      disableDiagnostics: true,
    },
  };
  let fetcher: StatsigFetcher;
  let logger: LogEventProcessor;
  let store: SpecStore;
  let server: StatsigServer;
  let events: { eventName: string }[] = [];
  let isInit: boolean;

  beforeAll(() => {
    Diagnostics.initialize({ logger });
    const fetch = require('node-fetch');
    fetch.mockImplementation(async (url: string, params) => {
      if (url.includes('download_config_specs')) {
        if (isInit) {
          isInit = false;
          return Promise.resolve({ ok: true, text: () => Promise.resolve() });
        } else {
          await new Promise((r) => setTimeout(r, 500));
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(CONFIG_SPEC_RESPONSE),
          });
        }
      }

      if (url.includes('log_event')) {
        await new Promise((r) => setTimeout(r, 500));
        events = events.concat(getDecodedBody(params)['events']);
        return Promise.resolve({
          ok: true,
        });
      }

      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('{}'),
      });
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  beforeEach(() => {
    server = new StatsigServer('secret-key', options);
    // @ts-ignore
    fetcher = server._fetcher;
    // @ts-ignore
    logger = server._logger;
    // Need to manually create store to bypass OptionsWithDefaults
    store = new SpecStore('secret-key', fetcher, options);

    isInit = true;
  });

  afterEach(() => {
    events = [];
  });

  test('LogEventProcessor shutdown', async () => {
    logger.log(new LogEvent('LogEventProcessor shutdown test event'));
    const shutdownPromise = logger.shutdown(5000);
    expect(events).toHaveLength(0);
    // Wait for pending flush
    await shutdownPromise;
    // See that events are logged after shutdown
    expect(events).toHaveLength(1);
  });

  test('LogEventProcessor shutdown async', async () => {
    logger.log(new LogEvent('LogEventProcessor shutdown async test event'));
    const start = Date.now();
    await logger.shutdown(5000);
    const end = Date.now();
    expect(events).toHaveLength(1);
    expect(end - start).toBeGreaterThanOrEqual(499);
  });

  test('StatsigServer shutdown async', async () => {
    logger.log(new LogEvent('StatsigServer shutdown async test event'));
    const start = Date.now();
    await server.shutdownAsync();
    const end = Date.now();
    expect(events).toHaveLength(1);
    expect(end - start).toBeGreaterThanOrEqual(500);
  });

  test('SpecStore shutdown', async () => {
    await store.init(InitializeContext.new({ sdkKey: 'secret-key' }));
    expect(store.getInitReason()).toEqual('Uninitialized');
    // Wait for next sync to start
    await new Promise((r) => setTimeout(r, 100));
    store.shutdown();
    expect(store.getInitReason()).toEqual('Uninitialized');
    // Wait for next sync to finish
    await new Promise((r) => setTimeout(r, 500));
    // See that it continued after shutdown
    expect(store.getInitReason()).toEqual('Network');
  });

  test('SpecStore shutdown async', async () => {
    await store.init(InitializeContext.new({ sdkKey: 'secret-key' }));
    expect(store.getInitReason()).toEqual('Uninitialized');
    const start = Date.now();
    // Wait for next sync to start
    await new Promise((r) => setTimeout(r, 100));
    await store.shutdownAsync();
    const end = Date.now();
    expect(store.getInitReason()).toEqual('Network');
    expect(end - start).toBeGreaterThanOrEqual(500);
  });
});
