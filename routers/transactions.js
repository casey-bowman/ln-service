const {getChainTransactions} = require('./../lightning');
const returnJson = require('./return_json');
const Router = require('./router');
const {sendToChainAddress} = require('./../lightning');

/** Get a transactions router.

  {
    lnd: <LND GRPC API Object>
    log: <Logging Function>
    wss: [<Websocket Server Object>]
  }

  @returns
  <Router Object>
*/
module.exports = ({lnd, log, wss}) => {
  const router = Router({});

  router.get('/', ({}, res) => {
    return getChainTransactions({lnd}, returnJson({log, res}));
  });

  router.post('/', ({body}, res) => {
    return sendToChainAddress({
      lnd,
      wss,
      address: body.address,
      fee_tokens_per_vbyte: body.fee_tokens_per_vbyte || undefined,
      tokens: body.tokens,
    },
    returnJson({log, res}));
  });

  return router;
};
