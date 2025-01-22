import Statsig, { DynamicConfig, StatsigUser } from '../index';
import StatsigInstanceUtils from '../StatsigInstanceUtils';
import { parseLogEvents } from './StatsigTestUtils';

jest.mock('node-fetch', () => jest.fn());

const CONFIG_SPEC_RESPONSE = JSON.stringify(
  require('./data/download_config_spec.json'),
);

const user: StatsigUser = {
  userID: 'a-user',
};

describe('On Default Value Fallback', () => {
  let events: {
    eventName: string;
    time: number;
    metadata: { gate?: string; config?: string; isManualExposure?: string };
  }[] = [];
  let config: DynamicConfig;

  beforeAll(async () => {
    const fetch = require('node-fetch');
    fetch.mockImplementation((url: string, params) => {
      if (url.includes('download_config_specs')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(CONFIG_SPEC_RESPONSE),
        });
      }

      if (url.includes('log_event')) {
        events = events.concat(parseLogEvents(params)['events']);
        return Promise.resolve({
          ok: true,
        });
      }

      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('{}'),
      });
    });

    StatsigInstanceUtils.setInstance(null);
    await Statsig.initialize('secret-key', {disableDiagnostics: true});
  });

  beforeEach(async () => {
    config = await Statsig.getConfig(user, 'test_config');
    await Statsig.flush()
    events = [];
  });

  it('logs an event when falling back to default value', async () => {
    config.get('number', 'a_string');
    await Statsig.flush();
    expect(events.length).toBe(1);

    const event = events[0];
    expect(event).toMatchObject({
      eventName: 'statsig::default_value_type_mismatch',
      metadata: {
        defaultValueType: 'string',
        name: 'test_config',
        parameter: 'number',
        ruleID: 'default',
        valueType: 'number',
      },
    });
  });

  it('logs an event when the typeguard fails', async () => {
    config.get('boolean', 'a_string', (_v): _v is string => false);
    await Statsig.flush();
    expect(events.length).toBe(1);

    const event = events[0];
    expect(event).toMatchObject({
      eventName: 'statsig::default_value_type_mismatch',
      metadata: {
        defaultValueType: 'string',
        name: 'test_config',
        parameter: 'boolean',
        ruleID: 'default',
        valueType: 'boolean',
      },
    });
  });

  it('does not log when returning the correct value', async () => {
    config.get('number', 0);
    await Statsig.flush();
    expect(events.length).toBe(0);
  });

  it('does not log when type guard succeeds', async () => {
    config.get('number', 0, (_v): _v is number => true);
    await Statsig.flush();
    expect(events.length).toBe(0);
  });
});
