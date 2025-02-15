const asyncRetry = require('async/retry');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');

const {addPeer} = require('./../../');
const {createChainAddress} = require('./../../');
const {getChainBalance} = require('./../../');
const {getChannel} = require('./../../');
const {getChannels} = require('./../../');
const {openChannel} = require('./../../');

const baseFee = '1337';
const channelCapacityTokens = 1e6;
const count = 100;
const defaultBaseFee = '1000';
const defaultFee = 1e3;
const defaultVout = 0;
const feeRate = 420;
const giftTokens = 1000;
const interval = 250;
const size = 2;
const times = 1000;
const txIdHexLength = 32 * 2;

// Opening a channel should open a channel
test(`Open channel`, async ({end, equal}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, id, lnd}, target] = nodes;

  const {address} = await createChainAddress({lnd});

  await generate({count});

  const channelOpen = await asyncRetry({interval, times}, async () => {
    await addPeer({lnd, public_key: target.id, socket: target.socket});

    return await openChannel({
      lnd,
      base_fee_mtokens: baseFee,
      chain_fee_tokens_per_vbyte: defaultFee,
      cooperative_close_address: address,
      fee_rate: feeRate,
      give_tokens: giftTokens,
      local_tokens: channelCapacityTokens,
      partner_public_key: target.id,
      socket: target.socket,
    });
  });

  equal(channelOpen.transaction_id.length, txIdHexLength, 'Channel tx id');
  equal(channelOpen.transaction_vout, defaultVout, 'Channel tx output index');

  await asyncRetry({interval, times}, async () => {
    await generate({});

    const {channels} = await getChannels({lnd});

    const [channel] = channels;

    if (!channel) {
      throw new Error('ExpectedChannelOpened');
    }

    const {policies} = await getChannel({lnd, id: channel.id});

    const policy = policies.find(n => n.public_key === id);

    if (!policy.base_fee_mtokens) {
      throw new Error('ExpectedKnownPolicyBaseFeeMtokens');
    }

    // LND 0.15.4 and below do not support setting fees on open
    if (policy.base_fee_mtokens === defaultBaseFee) {
      return;
    }

    equal(policy.base_fee_mtokens, baseFee, 'Base fee is set');
    equal(policy.fee_rate, feeRate, 'Fee rate is set');
  });

  await kill({});

  return end();
});
