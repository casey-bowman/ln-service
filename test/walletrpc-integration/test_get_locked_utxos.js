const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');

const {getLockedUtxos} = require('./../../');
const {getUtxos} = require('./../../');
const {lockUtxo} = require('./../../');

const count = 100;
const expiry = () => new Date(Date.now() + (1000 * 60 * 5)).toISOString();

// Locking a UTXO should result in the UTXO being unspendable
test(`Lock UTXO`, async ({end, equal, rejects, strictSame}) => {
  const [{generate, kill, lnd}] = (await spawnLightningCluster({})).nodes;

  try {
    await getLockedUtxos({lnd});
  } catch (err) {
    // LND 0.12.1 does not support getting locked UTXOs
    strictSame(
      err,
      [501, 'BackingLndDoesNotSupportGettingLockedUtxos'],
      'Got unsupported error'
    );

    await kill({});

    return end();
  }

  await generate({count});

  const [utxo] = (await getUtxos({lnd})).utxos;

  try {
    const expiresAt = expiry();

    const lock = await lockUtxo({
      lnd,
      expires_at: expiresAt,
      transaction_id: utxo.transaction_id,
      transaction_vout: utxo.transaction_vout,
    });

    const [locked] = (await getLockedUtxos({lnd})).utxos;

    const got = {
      lock_expires_at: locked.lock_expires_at,
      lock_id: locked.lock_id,
      transaction_id: locked.transaction_id,
      transaction_vout: locked.transaction_vout,
    };

    const expected = {
      lock_expires_at: lock.expires_at,
      lock_id: lock.id,
      transaction_id: utxo.transaction_id,
      transaction_vout: utxo.transaction_vout,
    };

    strictSame(got, expected, 'Got expected UTXO lock');

    // LND 0.15.0 and below do not support locked UTXO output script
    if (!!locked.output_script) {
      equal(locked.output_script, utxo.output_script, 'Got output script');
      equal(locked.tokens, utxo.tokens, 'Got output value');
    }

  } catch (err) {
    strictSame(
      err,
      [501, 'BackingLndDoesNotSupportLockingUtxos'],
      'Got unsupported error'
    );
  }

  await kill({});

  return end();
});
