const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');

const {disableChannel} = require('./../../');
const {getChannel} = require('./../../');
const {setupChannel} = require('./../macros');

const size = 2;

// Disabling a channel should mark it as disabled
test(`Disable channel`, async ({end, equal}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, id, lnd}, target] = nodes;

  const channel = await setupChannel({generate, lnd, to: target});

  try {
    await disableChannel({
      lnd,
      transaction_id: channel.transaction_id,
      transaction_vout: channel.transaction_vout,
    });

    const details = await getChannel({lnd, id: channel.id});

    const policy = details.policies.find(policy => policy.public_key === id);

    equal(policy.is_disabled, true, 'Forwarding policy is disabled');
  } catch (err) {
    const [code] = err;

    equal(code, 501, 'Method not supported yet');
  }

  await kill({});

  return end();
});
