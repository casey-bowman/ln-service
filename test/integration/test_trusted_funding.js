const asyncRetry = require('async/retry');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');

const {addPeer} = require('./../../');
const {broadcastChainTransaction} = require('./../../');
const {closeChannel} = require('./../../');
const {createInvoice} = require('./../../');
const {fundPendingChannels} = require('./../../');
const {fundPsbt} = require('./../../');
const {getChannels} = require('./../../');
const {getClosedChannels} = require('./../../');
const {getEphemeralChannelIds} = require('./../../');
const {getPendingChannels} = require('./../../');
const {openChannels} = require('./../../');
const {pay} = require('./../../');
const {signPsbt} = require('./../../');
const {subscribeToChannels} = require('./../../');
const {subscribeToOpenRequests} = require('./../../');

const capacity = 1e6;
const interval = 10;
const maturity = 100;
const size = 2;
const times = 2000;

// Opening unconfirmed channels should in immediate channel opening
test(`Open unconfirmed channels`, async ({end, equal, match, strictSame}) => {
  // Unconfirmed channels are not supported on LND 0.15.0 and below
  {
    const {kill, nodes} = await spawnLightningCluster({});

    const [{lnd}] = nodes;

    try {
      await getEphemeralChannelIds({lnd});
    } catch (err) {
      strictSame(err, [501, 'ListAliasesMethodNotSupported']);

      await kill({});

      return end();
    }
  }

  const {kill, nodes} = await spawnLightningCluster({
    size,
    lnd_configuration: [
      '--maxpendingchannels=10',
      '--protocol.option-scid-alias',
      '--protocol.zero-conf',
    ],
  });

  const [{generate, lnd}, target] = nodes;

  try {
    // Make some funds to use
    await generate({count: maturity});

    // Connect to the peer
    await addPeer({lnd, public_key: target.id, socket: target.socket});

    // Wait for channel to be receptive to opens
    await asyncRetry({interval, times}, async () => {
      return await openChannels({
        lnd,
        channels: [{capacity, partner_public_key: target.id}],
      });
    });

    const acceptSub = subscribeToOpenRequests({lnd: target.lnd});
    const channelsSub = subscribeToChannels({lnd});

    const closings = [];
    const opened = [];

    channelsSub.on('channel_closed', update => closings.push(update));
    channelsSub.on('channel_opened', update => opened.push(update));

    acceptSub.on('channel_request', request => {
      equal(request.is_trusted_funding, true, 'Request is trusted funding');

      return request.accept({is_trusted_funding: true});
    });

    // Propose the channel to the peer
    const {pending} = await openChannels({
      lnd,
      channels: [{
        capacity,
        is_trusted_funding: true,
        partner_public_key: target.id,
      }],
    });

    // Setup funding to the 2:2 output
    const fundTarget = await fundPsbt({lnd, outputs: pending});

    // Sign the funding to the 2:2 output
    const {psbt, transaction} = await signPsbt({lnd, psbt: fundTarget.psbt});

    // Fund the channel
    await fundPendingChannels({
      lnd,
      channels: pending.map(({id}) => id),
      funding: psbt,
    });

    const invoice = await createInvoice({
      lnd: target.lnd,
      tokens: 100,
    });

    const channel = await asyncRetry({interval, times}, async () => {
      const {channels} = await getChannels({lnd, is_active: true});

      if (!channels.length) {
        throw new Error('ExpectedTrustedChannelToAppear');
      }

      const [channel] = channels;

      return channel;
    });

    // Make sure the channel reflects that it is trusted funding
    strictSame(channel.other_ids, [], 'Got no ephemeral ids');
    match(channel.id, /16000000x0/, 'Channel id is faked');
    equal(channel.is_trusted_funding, true, 'Channel funding is trusted');

    // Make sure the open channel event reflected that it was trusted funding
    const [event] = opened;

    strictSame(event.other_ids, [], 'Got no event ephemeral ids');
    match(event.id, /16000000x0/, 'Channel event id is faked');
    equal(event.is_trusted_funding, true, 'Channel event funding is trusted');

    // Make sure the channel can be used immediately
    await pay({lnd, request: invoice.request});

    // Generate the channel into a block
    await broadcastChainTransaction({lnd, transaction});

    const confirmed = await asyncRetry({interval, times}, async () => {
      await generate({});

      const [confirmed] = (await getChannels({lnd})).channels;

      if (confirmed.id === channel.id) {
        throw new Error('ExpectedChangeToRealChannelId');
      }

      return confirmed;
    });

    equal(confirmed.id, '102x1x0', 'Channel id is real now');
    equal(confirmed.is_trusted_funding, true, 'Channel funding was trusted');
    equal(confirmed.other_ids.length, 1, 'Got ephemeral id');

    const [otherId] = confirmed.other_ids;

    match(otherId, /16000000x0/, 'Got ephemeral id');

    await asyncRetry({interval, times}, async () => {
      await closeChannel({lnd, id: confirmed.id});
    });

    // Propose a private channel to the peer
    const openPrivate = await asyncRetry({interval, times}, async () => {
      return await openChannels({
        lnd,
        channels: [{
          capacity,
          is_private: true,
          is_trusted_funding: true,
          partner_public_key: target.id,
        }],
      });
    });

    // Setup funding to the 2:2 output for the private channel
    const fundPrivate = await fundPsbt({lnd, outputs: openPrivate.pending});

    // Sign the private funding
    const signedPrivate = await signPsbt({lnd, psbt: fundPrivate.psbt});

    // Fund the private channel
    await fundPendingChannels({
      lnd,
      channels: openPrivate.pending.map(({id}) => id),
      funding: signedPrivate.psbt,
    });

    // Generate the channel into a block
    await broadcastChainTransaction({
      lnd,
      transaction: signedPrivate.transaction,
    });

    const privateConfirmed = await asyncRetry({interval, times}, async () => {
      await generate({});

      const [confirmed] = (await getChannels({lnd})).channels;

      const shut = await getClosedChannels({lnd});

      if (!shut.channels.length) {
        throw new Error('ExpectedClosedChannel');
      }

      if (!confirmed.other_ids.length) {
        throw new Error('ExpectedChangeToRealPrivateChannelId');
      }

      return confirmed;
    });

    equal(privateConfirmed.other_ids.length, 1, 'Got private ephemeral ids');

    const [privateOtherId] = privateConfirmed.other_ids;

    match(privateOtherId, /16000000x0/, 'Got private id');

    const [closedChannel] = (await getClosedChannels({lnd})).channels;

    equal(closedChannel.id, confirmed.id, 'Closed channel shows confirmed id');
    strictSame(closedChannel.other_ids, confirmed.other_ids, 'Saved temp id');

    const [closeEvent] = closings;

    equal(closeEvent.id, confirmed.id, 'Closed event shows confirmed id');
    strictSame(closeEvent.other_ids, confirmed.other_ids, 'Got temporary id');

    const ephemeralIds = await getEphemeralChannelIds({lnd});

    equal(ephemeralIds.channels.length, 2, 'Got ephemeral channel ids');

    const [firstChannel, secondChannel] = ephemeralIds.channels;

    match(firstChannel.reference_id, /16000000x0/, 'Got first channel id');
    match(secondChannel.reference_id, /16000000x0/, 'Got second channel id');
  } catch (err) {
    equal(err, null, 'No error is reported');
  } finally {
    return await kill({});
  }

  return end();
});
